import type { Address } from 'viem';
import { z } from 'zod';

/** Pending sign-requests expire server-side after 10 min, so an unresolved record older than this is dead. */
export const PENDING_TTL_MS = 10 * 60_000;

const Record = z.object({
  id: z.string(),
  status: z.enum(['signing', 'signed', 'open', 'closed']),
  account: z.string(),
  chainId: z.number().int().positive(),
  token: z.string(),
  spender: z.string(),
  capMicros: z.string(),
  createdAt: z.number(),
});
export type SessionJournalRecord = z.infer<typeof Record>;

export class JournalError extends Error {
  constructor(
    message: string,
    readonly code: 'STORAGE_UNAVAILABLE' | 'UNRESOLVED' | 'MISMATCH',
  ) {
    super(message);
    this.name = 'JournalError';
  }
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function browserStore(): Store | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Durable record of the one in-flight signature per account and chain. Written BEFORE the wallet is asked to
 * sign, so a reload, a lost response or a second tab can never leave a signed permit nobody knows about.
 * Refuses (throws) when storage is unavailable, like the payment journal this was ported from.
 */
export class SessionJournal {
  private readonly key: string;
  private readonly store: Store | undefined;
  constructor(
    private readonly account: Address,
    private readonly chainId: number,
    store: Store | null | undefined = browserStore(),
  ) {
    this.store = store ?? undefined;
    this.key = `spindle.x402.session.v1:${chainId}:${account.toLowerCase()}`;
  }

  current(now = Date.now()): SessionJournalRecord | null {
    if (!this.store) return null;
    const raw = this.store.getItem(this.key);
    if (!raw) return null;
    let rec: SessionJournalRecord;
    try {
      rec = Record.parse(JSON.parse(raw));
    } catch {
      this.store.removeItem(this.key);
      return null;
    }
    if (rec.account.toLowerCase() !== this.account.toLowerCase() || rec.chainId !== this.chainId) {
      throw new JournalError('Saved payment does not match this wallet and network.', 'MISMATCH');
    }
    // A signature that never reached `open` cannot be opened after the server's pending window.
    if ((rec.status === 'signing' || rec.status === 'signed') && now - rec.createdAt > PENDING_TTL_MS) {
      this.store.removeItem(this.key);
      return null;
    }
    if (rec.status === 'closed') return null;
    return rec;
  }

  /** Begin a request. Throws if storage is unusable or another unresolved record exists. */
  begin(rec: Omit<SessionJournalRecord, 'status' | 'createdAt'>, now = Date.now()): SessionJournalRecord {
    if (!this.store) {
      throw new JournalError(
        'Browser storage is unavailable. Enable local storage before authorizing a session.',
        'STORAGE_UNAVAILABLE',
      );
    }
    const prev = this.current(now);
    if (prev && (prev.status === 'signing' || prev.status === 'signed')) {
      throw new JournalError(
        'A previous session request is still unresolved. Wait a few minutes or dismiss it first.',
        'UNRESOLVED',
      );
    }
    const next: SessionJournalRecord = { ...rec, status: 'signing', createdAt: now };
    this.write(next);
    return next;
  }

  advance(status: SessionJournalRecord['status']): void {
    const prev = this.current();
    if (prev) this.write({ ...prev, status });
  }

  /** Remove the record (user rejected the signature, session closed, or user dismissed). */
  clear(): void {
    this.store?.removeItem(this.key);
  }

  private write(rec: SessionJournalRecord) {
    if (!this.store) throw new JournalError('Browser storage is unavailable.', 'STORAGE_UNAVAILABLE');
    this.store.setItem(this.key, JSON.stringify(rec));
  }
}
