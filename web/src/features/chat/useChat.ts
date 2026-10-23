import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/errors';
import {
  type ChatMsg,
  type Conversation,
  loadHistory,
  newConversation,
  saveHistory,
  titleFrom,
} from './history';
import { type PayMode, streamChat } from './sse';

export type ChatErrorKind =
  | 'no_capacity'
  | 'insufficient_balance'
  | 'session_exhausted'
  | 'disabled'
  | 'other';

export function classifyError(e: unknown): { kind: ChatErrorKind; message: string } {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'NO_CAPACITY':
        return { kind: 'no_capacity', message: 'No node is serving this model right now.' };
      case 'INSUFFICIENT_BALANCE':
        return { kind: 'insufficient_balance', message: 'Your prepaid balance is too low for this message.' };
      case 'SESSION_EXHAUSTED':
        return { kind: 'session_exhausted', message: 'This session has no spendable budget left.' };
      case 'X402_DISABLED':
        return {
          kind: 'disabled',
          message: 'x402 payments are switched off right now. Use prepaid balance.',
        };
      default:
        return { kind: 'other', message: e.message };
    }
  }
  return { kind: 'other', message: e instanceof Error ? e.message : 'Request failed.' };
}

const uid = () => crypto.randomUUID();

/**
 * Conversation state + streaming. One in-flight request at a time; `runId` invalidates callbacks of a
 * previous run (account switch / unmount) and the AbortController cancels the fetch.
 */
export function useChat(address: string | undefined) {
  const qc = useQueryClient();
  const [list, setList] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<{ kind: ChatErrorKind; message: string } | null>(null);
  const active = useRef<AbortController | null>(null);
  const runId = useRef(0);
  const listRef = useRef<Conversation[]>([]);
  listRef.current = list;

  useEffect(() => {
    const gen = ++runId.current;
    active.current?.abort();
    active.current = null;
    setBusy(false);
    setLastError(null);
    if (!address) {
      setList([]);
      setActiveId(null);
      return;
    }
    const loaded = loadHistory(address);
    setList(loaded);
    setActiveId(loaded[0]?.id ?? null);
    return () => {
      if (runId.current === gen) {
        runId.current++;
        active.current?.abort();
        active.current = null;
      }
    };
  }, [address]);

  const persist = useCallback(
    (next: Conversation[]) => {
      setList(next);
      listRef.current = next;
      if (address) saveHistory(address, next);
    },
    [address],
  );

  const conversation = list.find((c) => c.id === activeId) ?? null;

  const update = useCallback(
    (id: string, fn: (c: Conversation) => Conversation, save: boolean) => {
      const next = listRef.current.map((c) => (c.id === id ? fn(c) : c));
      if (save) persist(next);
      else {
        setList(next);
        listRef.current = next;
      }
    },
    [persist],
  );

  const send = useCallback(
    async (
      text: string,
      opts: {
        model: string;
        lane: 'open' | 'sealed';
        mode: PayMode;
        sessionToken?: string;
        onSettled?: () => void;
      },
    ) => {
      const content = text.trim();
      if (!content || active.current) return;
      let convo = listRef.current.find((c) => c.id === activeId);
      if (!convo) {
        convo = newConversation();
        persist([convo, ...listRef.current]);
        setActiveId(convo.id);
      }
      const id = convo.id;
      const user: ChatMsg = { id: uid(), role: 'user', content };
      const reply: ChatMsg = { id: uid(), role: 'assistant', content: '', model: opts.model, partial: true };
      const history = [...convo.messages.filter((m) => !m.partial && !m.error), user];
      update(
        id,
        (c) => ({
          ...c,
          title: c.messages.length === 0 ? titleFrom(content) : c.title,
          model: opts.model,
          updatedAt: Date.now(),
          messages: [...c.messages, user, reply],
        }),
        false,
      );
      const gen = runId.current;
      const ac = new AbortController();
      active.current = ac;
      setBusy(true);
      setLastError(null);
      const current = () => gen === runId.current;
      const patch = (p: Partial<ChatMsg>, save: boolean) =>
        update(
          id,
          (c) => ({ ...c, messages: c.messages.map((m) => (m.id === reply.id ? { ...m, ...p } : m)) }),
          save,
        );
      try {
        const r = await streamChat({
          model: opts.model,
          lane: opts.lane,
          mode: opts.mode,
          sessionToken: opts.sessionToken,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          signal: ac.signal,
          onDelta: (c) => {
            if (current()) patch({ content: c }, false);
          },
        });
        if (!current()) return;
        patch(
          {
            content: r.content,
            partial: false,
            chargeMicros: r.spindle?.chargeMicros,
            tokens: r.usage?.total_tokens,
            jobId: r.spindle?.jobId ?? r.jobId,
            receiptUrl: r.spindle?.receiptUrl ?? r.receiptHeader,
          },
          true,
        );
        void qc.invalidateQueries({ queryKey: ['app', 'summary'] });
        void qc.invalidateQueries({ queryKey: ['chat', 'buyer'] });
        opts.onSettled?.();
      } catch (e) {
        if (!current()) return;
        if (ac.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
          // Stopped: keep whatever streamed. The job may still be billed; the receipt appears in Activity.
          patch(
            { partial: false, error: 'Stopped. Any usage is billed by the server and shows in Activity.' },
            true,
          );
          opts.onSettled?.();
        } else {
          const err = classifyError(e);
          setLastError(err);
          patch({ partial: false, error: err.message }, true);
          opts.onSettled?.();
        }
      } finally {
        if (current()) {
          active.current = null;
          setBusy(false);
        }
      }
    },
    [activeId, persist, qc, update],
  );

  return {
    list,
    conversation,
    activeId,
    busy,
    lastError,
    clearError: () => setLastError(null),
    send,
    stop: () => active.current?.abort(),
    select: (id: string) => {
      if (!busy) setActiveId(id);
    },
    newChat: () => {
      if (busy) return;
      const empty = listRef.current.find((c) => c.messages.length === 0);
      if (empty) return setActiveId(empty.id);
      const c = newConversation();
      persist([c, ...listRef.current]);
      setActiveId(c.id);
    },
    clearAll: () => {
      if (busy) return;
      persist([]);
      setActiveId(null);
    },
  };
}
