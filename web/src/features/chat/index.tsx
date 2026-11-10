import * as api from '@spindle/shared/api';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { erc20Abi, maxUint256 } from 'viem';
import { useAccount } from 'wagmi';
import { apiFetch } from '../../api/client';
import { useMe } from '../../api/hooks';
import { CTA } from '../../components/CTA';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { formatMicros } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { StatusPill } from '../../components/StatusPill';
import { TxButton } from '../../components/TxButton';
import { env } from '../../config';
import { CAP_OPTIONS_MICROS, DEFAULT_CAP_MICROS } from '../../lib/x402';
import { countdown, PageHead, useNow } from '../shell/ui';
import './chat.css';
import type { ChatMsg } from './history';
import { Markdown } from './Markdown';
import type { PayMode } from './sse';
import { useChat } from './useChat';
import { useX402Session } from './useSession';

const usd = (micros: string | bigint, digits = 2) => `$${formatMicros(micros, { fractionDigits: digits })}`;
/** Server-reported amounts can be sub-cent: show every micro below one cent, else three decimals. */
const usdPrecise = (micros: string | bigint) => {
  const v = BigInt(micros);
  return v === 0n ? '$0.00' : usd(v, v < 10_000n ? 6 : 3);
};
const receiptHref = (u: string) => (u.startsWith('/') ? `${env.apiUrl}${u}` : u);

function Message({ m, streaming }: { m: ChatMsg; streaming: boolean }) {
  return (
    <article className={`chat-msg ${m.role}`} aria-label={m.role === 'user' ? 'You' : 'Assistant'}>
      <small>{m.role === 'user' ? 'You' : (m.model ?? 'Assistant')}</small>
      <div className="chat-bubble">
        {m.role === 'user' ? (
          m.content
        ) : (
          <>
            {m.content ? <Markdown>{m.content}</Markdown> : null}
            {streaming ? <span className="chat-cursor" aria-hidden="true" /> : null}
          </>
        )}
        {m.error ? <p className="chat-note chat-bad">{m.error}</p> : null}
      </div>
      {m.chargeMicros !== undefined ? (
        <div className="chat-foot">
          <span>Cost {usdPrecise(m.chargeMicros)}</span>
          {m.tokens !== undefined ? <span>{m.tokens.toLocaleString('en-US')} tokens</span> : null}
          {m.receiptUrl ? (
            <a href={receiptHref(m.receiptUrl)} target="_blank" rel="noreferrer noopener">
              Receipt
            </a>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export default function ChatTab() {
  const me = useMe();
  const account = useAccount();
  const address = account.address;
  const historyKey = me.data?.address ?? address;
  const models = useQuery({
    queryKey: ['chat', 'models'],
    retry: false,
    queryFn: () => apiFetch('/v1/models', { schema: api.GetModelsRes }),
  });
  const buyer = useQuery({
    queryKey: ['chat', 'buyer'],
    retry: false,
    queryFn: () => apiFetch('/v1/app/buyer', { schema: api.GetBuyerRes }),
  });
  const chat = useChat(historyKey);
  const x402 = useX402Session(address);
  const now = useNow(1000);
  const [model, setModel] = useState('');
  const [lane, setLane] = useState<'open' | 'sealed'>('open');
  const [mode, setMode] = useState<PayMode | null>(null);
  const [cap, setCap] = useState<bigint>(DEFAULT_CAP_MICROS);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);

  const chatModels = (models.data?.data ?? []).filter((m) => m.kind === 'chat' && m.available);
  const selected = chatModels.find((m) => m.id === model);
  // live: the sealed lane is on, the model supports it and a registered sealed node serving it is online
  const sealedOk = selected?.sealed_available === true;
  const balance = buyer.data ? BigInt(buyer.data.balanceMicros) : 0n;
  const x402On = buyer.data?.x402.enabled ?? false;
  const surcharge = buyer.data ? BigInt(buyer.data.x402.currentSurchargeMicros) : 0n;

  // sensible defaults once data arrives
  useEffect(() => {
    if (!model && chatModels[0]) setModel(chatModels[0].id);
    if (model && models.data && !chatModels.some((m) => m.id === model)) setModel(chatModels[0]?.id ?? '');
  }, [model, chatModels, models.data]);
  useEffect(() => {
    if (!sealedOk && lane === 'sealed') setLane('open');
  }, [sealedOk, lane]);
  useEffect(() => {
    if (mode !== null || !buyer.data) return;
    setMode(x402On ? 'session' : balance > 0n ? 'balance' : 'session');
  }, [mode, buyer.data, x402On, balance]);
  useEffect(() => {
    if (!x402On && buyer.data && mode === 'session' && balance > 0n) setMode('balance');
  }, [x402On, buyer.data, mode, balance]);

  const msgCount = chat.conversation?.messages.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [msgCount, chat.conversation?.messages.at(-1)?.content]);

  // errors that change what the user must do
  const { lastError } = chat;
  const endSession = x402.end;
  useEffect(() => {
    if (lastError?.kind === 'session_exhausted')
      endSession('Session exhausted. Start a new one to keep chatting.');
    if (lastError?.kind === 'disabled') void buyer.refetch();
  }, [lastError, endSession, buyer.refetch]);

  // expiry: the server also refuses, this just clears the UI on time
  const left = x402.session ? countdown(x402.session.expiresAt, now) : null;
  useEffect(() => {
    if (x402.session && !left) endSession('Session expired. Start a new one to keep chatting.');
  }, [x402.session, left, endSession]);

  const messages = chat.conversation?.messages ?? [];
  const busyAuth = x402.phase === 'creating' || x402.phase === 'signing' || x402.phase === 'opening';
  const ready =
    !!model && !chat.busy && (mode === 'balance' ? balance > 0n : mode === 'session' && !!x402.session);

  const submit = () => {
    if (!ready || !text.trim() || !mode) return;
    const t = text;
    setText('');
    void chat.send(t, {
      model,
      lane,
      contextLength: selected?.context_length,
      mode,
      sessionToken: x402.session?.token,
      onSettled: () => x402.refreshMeter(),
    });
  };

  if (models.isPending || buyer.isPending) {
    return (
      <div className="sd-overview" aria-busy="true">
        <Skeleton height={64} />
        <Skeleton height={420} />
      </div>
    );
  }
  if (models.isError || buyer.isError) {
    return (
      <ErrorState
        title="Chat unavailable"
        message={(models.error ?? buyer.error)?.message}
        onRetry={() => {
          void models.refetch();
          void buyer.refetch();
        }}
      />
    );
  }

  const capNeedsApproval = x402.allowance !== undefined && x402.allowance < cap;
  const used = x402.usedMicros;
  const capBig = x402.session ? BigInt(x402.session.capMicros) : 0n;
  const fee = x402.session ? BigInt(x402.session.surchargeMicros) : 0n;
  const pct = (v: bigint) => (capBig > 0n ? `${Number((v * 10000n) / capBig) / 100}%` : '0%');

  return (
    <div className="sd-overview">
      <PageHead eyebrow="PAY PER MESSAGE" line1="Talk to the" line2="network.">
        Sign one session, or spend your credit balance. <br />
        You are charged for actual usage, never more.
      </PageHead>
      <section className="sd-box sd-flat chat-box">
        {chatModels.length === 0 ? (
          <EmptyState icon="agent" title="No node is serving models right now">
            Chat opens up as soon as a node comes online.
          </EmptyState>
        ) : (
          <>
            <div className="chat-bar">
              <label>
                <small>Model</small>
                <select
                  className="chat-select"
                  aria-label="Model"
                  value={model}
                  disabled={chat.busy}
                  onChange={(e) => setModel(e.target.value)}
                >
                  {chatModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id} ({m.lanes.join(' + ')})
                    </option>
                  ))}
                </select>
              </label>
              <div className="chat-group">
                <small>Lane</small>
                <div className="sd-seg" role="group" aria-label="Lane">
                  <button type="button" aria-pressed={lane === 'open'} onClick={() => setLane('open')}>
                    Open
                  </button>
                  <button
                    type="button"
                    aria-pressed={lane === 'sealed'}
                    disabled={!sealedOk}
                    title={sealedOk ? undefined : 'No sealed node is online for this model right now'}
                    onClick={() => setLane('sealed')}
                  >
                    Sealed{sealedOk ? '' : ' (no node available)'}
                  </button>
                </div>
              </div>
              <div className="chat-group">
                <small>Payment</small>
                <div className="sd-seg" role="group" aria-label="Payment mode">
                  <button
                    type="button"
                    aria-pressed={mode === 'session'}
                    disabled={chat.busy || (!x402On && balance > 0n)}
                    title={x402On ? undefined : 'x402 sessions are unavailable right now'}
                    onClick={() => setMode('session')}
                  >
                    Session (x402)
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === 'balance'}
                    disabled={balance === 0n || chat.busy}
                    title={balance === 0n ? 'Your credit balance is empty' : undefined}
                    onClick={() => setMode('balance')}
                  >
                    Credit {usd(balance)}
                  </button>
                </div>
              </div>
              <span className="chat-spacer" />
              <div className="chat-group">
                <small>History (this browser)</small>
                <div className="chat-row">
                  {chat.list.length > 0 ? (
                    <select
                      className="chat-select"
                      aria-label="Conversation"
                      value={chat.activeId ?? ''}
                      disabled={chat.busy}
                      onChange={(e) => chat.select(e.target.value)}
                      style={{ minWidth: 160 }}
                    >
                      {chat.list.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <button type="button" className="sd-link" disabled={chat.busy} onClick={chat.newChat}>
                    New chat
                  </button>
                  <button
                    type="button"
                    className="sd-link"
                    disabled={chat.busy || chat.list.length === 0}
                    onClick={chat.clearAll}
                  >
                    Clear history
                  </button>
                </div>
              </div>
            </div>
            {!x402On ? (
              <p className="chat-hint chat-bad" role="status">
                x402 sessions are switched off right now (the settlement keeper is paused). Credit balance
                still works.
              </p>
            ) : null}
            {selected ? (
              <p className="chat-hint">
                Price <b>{usd(selected.pricing.buyerMicrosPerUnit)}</b> per 1M tokens. The cost shown under
                each answer is what the server charged.
              </p>
            ) : null}

            {mode === 'session' && !x402.session ? (
              <div className="chat-setup" role="group" aria-label="Session setup">
                <h3>Start a session</h3>
                {!x402On ? (
                  <p>
                    x402 sessions are unavailable right now.{' '}
                    {balance > 0n ? (
                      'Switch to Credit balance to chat.'
                    ) : (
                      <>
                        Add funds under{' '}
                        <Link to="/dashboard/$tab" params={{ tab: 'developers' }}>
                          Developers
                        </Link>{' '}
                        to chat with credit balance.
                      </>
                    )}
                  </p>
                ) : !address ? (
                  <p>Connect your wallet to sign a session.</p>
                ) : (
                  <>
                    <p>
                      You sign once; Spindle charges actual usage up to the cap. The settlement fee of{' '}
                      {usd(surcharge)} is included in the cap and charged once per session. The session lasts
                      1 hour.
                    </p>
                    <div className="sd-seg" role="group" aria-label="Spending cap">
                      {CAP_OPTIONS_MICROS.map((c) => (
                        <button
                          key={c.toString()}
                          type="button"
                          aria-pressed={cap === c}
                          disabled={busyAuth}
                          onClick={() => setCap(c)}
                        >
                          {usd(c)}
                        </button>
                      ))}
                    </div>
                    <div className="chat-row">
                      {x402.allowanceLoading ? (
                        <Skeleton width={220} height={40} />
                      ) : x402.allowanceError ? (
                        <>
                          <span className="chat-note chat-bad">Could not read your Permit2 allowance.</span>
                          <button type="button" className="sd-link" onClick={x402.refetchAllowance}>
                            Retry
                          </button>
                        </>
                      ) : capNeedsApproval ? (
                        <TxButton
                          label="Approve USDG for Permit2 (once)"
                          request={{
                            address: env.addresses.usdg,
                            abi: erc20Abi,
                            functionName: 'approve',
                            args: [env.addresses.permit2, maxUint256],
                          }}
                          onConfirmed={x402.refetchAllowance}
                        />
                      ) : (
                        <CTA
                          icon=""
                          disabled={busyAuth || x402.unresolved}
                          onClick={() => void x402.start(cap)}
                        >
                          {x402.phase === 'creating'
                            ? 'Preparing…'
                            : x402.phase === 'signing'
                              ? 'Confirm in wallet…'
                              : x402.phase === 'opening'
                                ? 'Opening session…'
                                : `Authorize ${usd(cap)} session`}
                        </CTA>
                      )}
                    </div>
                    {capNeedsApproval ? (
                      <p className="chat-note">
                        Permit2 needs permission to move USDG once. It spends only what you sign for each
                        session.
                      </p>
                    ) : null}
                    {x402.unresolved ? (
                      <p className="chat-note chat-bad" role="status">
                        A previous session request did not finish.{' '}
                        <button type="button" className="sd-link" onClick={x402.dismissUnresolved}>
                          Dismiss
                        </button>
                      </p>
                    ) : null}
                  </>
                )}
                {x402.note ? (
                  <p className="chat-note" role="status">
                    {x402.note}
                  </p>
                ) : null}
                {x402.error ? (
                  <p className="chat-note chat-bad" role="alert">
                    {x402.error}
                  </p>
                ) : null}
              </div>
            ) : null}

            {mode === 'session' && x402.session ? (
              <div className="chat-meter" role="group" aria-label="Session meter">
                <div className="chat-row">
                  <h3>Session</h3>
                  <StatusPill tone="ok">Open</StatusPill>
                  <span className="chat-spacer" />
                  <CTA variant="secondary" icon="" onClick={() => void x402.close()} disabled={chat.busy}>
                    Close session
                  </CTA>
                </div>
                <div
                  className="chat-meter-bar"
                  role="progressbar"
                  aria-label="Session usage"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={capBig > 0n ? Number((used * 100n) / capBig) : 0}
                >
                  <i style={{ width: pct(used + fee) }} className="fee" />
                  <i style={{ width: pct(used) }} />
                </div>
                <div className="chat-meter-facts">
                  <span>
                    Used {usdPrecise(used)} of {usd(capBig)}
                  </span>
                  <span>Fee {usd(fee)}</span>
                  <span>Left to spend {usdPrecise(x402.spendableMicros)}</span>
                  <span>Expires in {left ?? 'now'}</span>
                </div>
                {x402.error ? (
                  <p className="chat-note chat-bad" role="alert">
                    {x402.error}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="chat-thread" role="log" aria-label="Conversation" aria-busy={chat.busy}>
              {messages.length === 0 ? (
                <div className="chat-empty">
                  <EmptyState icon="agent" title={model ? 'Say something' : 'Pick a model to start'}>
                    {model
                      ? 'Your messages stay in this browser. Nothing is stored on the server.'
                      : 'Choose a model above.'}
                  </EmptyState>
                </div>
              ) : (
                messages.map((m) => <Message key={m.id} m={m} streaming={!!m.partial && chat.busy} />)
              )}
              <div ref={end} className="chat-end" />
            </div>

            {chat.omitted > 0 ? (
              <p className="chat-note chat-trim" role="status">
                {chat.omitted === 1 ? '1 older message was' : `${chat.omitted} older messages were`} left out
                of the last request to fit the model&apos;s{' '}
                {selected?.context_length ? `${selected.context_length.toLocaleString()}-token ` : ''}
                context window.
              </p>
            ) : null}

            {chat.lastError && chat.lastError.kind !== 'other' ? (
              <div className="chat-error" role="alert">
                <span>{chat.lastError.message}</span>
                {chat.lastError.kind === 'insufficient_balance' ? (
                  <Link to="/dashboard/$tab" params={{ tab: 'developers' }}>
                    Add funds in Developers
                  </Link>
                ) : null}
                {chat.lastError.kind === 'session_exhausted' ? (
                  <button type="button" className="sd-link" onClick={chat.clearError}>
                    Start a new session above
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="chat-composer">
              {mode === 'session' && !x402.session ? (
                <p className="chat-hint">Authorize a session above to send messages.</p>
              ) : null}
              {mode === 'balance' && balance === 0n ? (
                <p className="chat-hint">Your credit balance is empty.</p>
              ) : null}
              <label className="sp-sr-only" htmlFor="chat-input">
                Message
              </label>
              <textarea
                id="chat-input"
                value={text}
                placeholder={ready || chat.busy ? 'Type a message…' : 'Authorize payment to start chatting'}
                disabled={!model || (!ready && !chat.busy)}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <div className="chat-row">
                {chat.busy ? (
                  <CTA variant="secondary" icon="" onClick={chat.stop}>
                    Stop
                  </CTA>
                ) : (
                  <CTA icon="" disabled={!ready || !text.trim()} onClick={submit}>
                    Send
                  </CTA>
                )}
                <span className="chat-note">
                  {mode === 'balance' ? 'Paid from credit balance' : 'Paid from your x402 session'} ·{' '}
                  {lane === 'open' ? 'Open lane' : 'Sealed lane'}
                </span>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
