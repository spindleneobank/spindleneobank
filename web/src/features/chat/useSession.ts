import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Address, erc20Abi, maxUint256 } from 'viem';
import { useAccount, useReadContract, useSignTypedData, useSwitchChain } from 'wagmi';
import { ApiError } from '../../api/errors';
import { isUserRejection } from '../../components/TxButton';
import { chain, env } from '../../config';
import {
  clearStoredSession,
  JournalError,
  loadStoredSession,
  SessionJournal,
  type StoredSession,
  saveStoredSession,
  TypedDataMismatch,
  validateSessionTypedData,
  x402Sessions,
} from '../../lib/x402';

export type Phase = 'idle' | 'creating' | 'signing' | 'opening' | 'open';

export interface SessionState {
  phase: Phase;
  session: StoredSession | null;
  /** server-reported (GET session) */
  usedMicros: bigint;
  spendableMicros: bigint;
  /** 'open' | 'closing' | 'settled' ... from the server; null before the first read */
  serverStatus: string | null;
  error: string | null;
  note: string | null;
  allowance: bigint | undefined;
  allowanceLoading: boolean;
  allowanceError: boolean;
  /** an unresolved signature record from an earlier attempt */
  unresolved: boolean;
}

const mapError = (e: unknown): string => {
  if (e instanceof TypedDataMismatch) return e.message;
  if (e instanceof JournalError) return e.message;
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : 'Something went wrong.';
};

/**
 * One x402 session per wallet: ensure Permit2 allowance, create -> validate -> sign once -> open.
 * The token lives in sessionStorage only. Used/spendable always come from `GET session`.
 */
export function useX402Session(address: Address | undefined) {
  const account = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [phase, setPhase] = useState<Phase>('idle');
  const [session, setSession] = useState<StoredSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  const run = useRef(0);
  const abort = useRef<AbortController | null>(null);

  const allowance = useReadContract({
    address: env.addresses.usdg,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, env.addresses.permit2] : undefined,
    query: { enabled: !!address && !env.mock },
  });

  // restore (sessionStorage) and bind to the account; abort on unmount / account change
  useEffect(() => {
    const gen = ++run.current;
    abort.current?.abort();
    setError(null);
    setNote(null);
    if (!address) {
      setSession(null);
      setPhase('idle');
      return;
    }
    const stored = loadStoredSession(address);
    setSession(stored);
    setPhase(stored ? 'open' : 'idle');
    try {
      const j = new SessionJournal(address, chain.id).current();
      setUnresolved(!!j && (j.status === 'signing' || j.status === 'signed'));
    } catch {
      setUnresolved(false);
    }
    return () => {
      if (run.current === gen) {
        run.current++;
        abort.current?.abort();
      }
    };
  }, [address]);

  const meter = useQuery({
    queryKey: ['chat', 'session', session?.sessionId],
    enabled: !!session && phase === 'open',
    refetchInterval: 20_000,
    retry: false,
    queryFn: ({ signal }) =>
      x402Sessions.get((session as StoredSession).sessionId, (session as StoredSession).token, signal),
  });

  const end = useCallback(
    (message: string | null) => {
      if (address) {
        clearStoredSession(address);
        try {
          new SessionJournal(address, chain.id).clear();
        } catch {
          // ignore
        }
      }
      setSession(null);
      setPhase('idle');
      setNote(message);
    },
    [address],
  );

  // a 404/401 on the meter means the server no longer knows the session
  useEffect(() => {
    const e = meter.error;
    if (e instanceof ApiError && (e.status === 404 || e.status === 401))
      end('This session is no longer available.');
  }, [meter.error, end]);
  useEffect(() => {
    if (meter.data && meter.data.status !== 'open' && phase === 'open') {
      end(
        meter.data.status === 'closing'
          ? 'Session closed. Settling in the next batch.'
          : `Session ${meter.data.status}.`,
      );
    }
  }, [meter.data, phase, end]);

  const start = useCallback(
    async (capMicros: bigint) => {
      if (!address) return;
      const gen = run.current;
      const ac = new AbortController();
      abort.current = ac;
      const live = () => gen === run.current;
      setError(null);
      setNote(null);
      let journal: SessionJournal | null = null;
      try {
        if (account.chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
        setPhase('creating');
        const created = await x402Sessions.create(address, capMicros, undefined, ac.signal);
        // refuse before the wallet ever sees it
        const typed = validateSessionTypedData(created.typedData, {
          chainId: chain.id,
          permit2: env.addresses.permit2,
          token: env.addresses.usdg,
          spender: env.addresses.vault,
          capMicros,
          sessionId: created.sessionId,
          surchargeMicros: BigInt(created.surchargeMicros),
        });
        journal = new SessionJournal(address, chain.id);
        journal.begin({
          id: created.sessionId,
          account: address,
          chainId: chain.id,
          token: env.addresses.usdg,
          spender: env.addresses.vault,
          capMicros: capMicros.toString(),
        });
        if (live()) setPhase('signing');
        const signature = await signTypedDataAsync(typed);
        journal.advance('signed');
        if (!live()) return;
        setPhase('opening');
        try {
          const opened = await x402Sessions.open(created.sessionId, signature, ac.signal);
          journal.advance('open');
          const s: StoredSession = {
            sessionId: created.sessionId,
            token: opened.sessionToken,
            address,
            capMicros: opened.capMicros,
            surchargeMicros: opened.surchargeMicros,
            expiresAt: opened.expiresAt,
          };
          saveStoredSession(s);
          if (live()) {
            setSession(s);
            setPhase('open');
            setUnresolved(false);
          }
        } catch (e) {
          // a definite API refusal means the permit was not consumed; anything else stays journaled
          if (e instanceof ApiError && e.status >= 400 && e.status < 500) journal.clear();
          throw e;
        }
      } catch (e) {
        if (!live()) return;
        if (isUserRejection(e)) {
          journal?.clear();
          setNote('Signature rejected. Nothing was sent.');
        } else {
          setError(mapError(e));
        }
        setPhase('idle');
        try {
          const j = new SessionJournal(address, chain.id).current();
          setUnresolved(!!j && (j.status === 'signing' || j.status === 'signed'));
        } catch {
          setUnresolved(false);
        }
      }
    },
    [address, account.chainId, signTypedDataAsync, switchChainAsync],
  );

  const close = useCallback(async () => {
    if (!session) return;
    try {
      await x402Sessions.close(session.sessionId, session.token);
      end('Session closed. Settling in the next batch.');
    } catch (e) {
      setError(mapError(e));
    }
  }, [session, end]);

  const dismissUnresolved = useCallback(() => {
    if (!address) return;
    try {
      new SessionJournal(address, chain.id).clear();
    } catch {
      // ignore
    }
    setUnresolved(false);
  }, [address]);

  const cap = session ? BigInt(session.capMicros) : 0n;
  const surcharge = session ? BigInt(session.surchargeMicros) : 0n;
  const used = meter.data ? BigInt(meter.data.usedMicros) : 0n;
  const state: SessionState = {
    phase,
    session,
    usedMicros: used,
    spendableMicros: meter.data ? BigInt(meter.data.spendableMicros) : cap - surcharge,
    serverStatus: meter.data?.status ?? null,
    error,
    note,
    allowance: env.mock ? maxUint256 : allowance.data,
    allowanceLoading: !env.mock && allowance.isPending && !!address,
    allowanceError: !env.mock && allowance.isError,
    unresolved,
  };
  return {
    ...state,
    start,
    close,
    end,
    dismissUnresolved,
    refreshMeter: () => void meter.refetch(),
    refetchAllowance: () => void allowance.refetch(),
    setError,
  };
}
