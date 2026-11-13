import { ApiError } from '../../errors';
import type { MockFixtures } from '../mock';
import { readMockSession } from './auth';

/**
 * Time-driven mock of card operations + Relay orders, kept in sessionStorage so a reload resumes.
 * `?scenario=` : `refund` | `failed` | `review` (after the deposit is reported) or `liquidity` (relay-quote fails).
 */
type Rec = {
  id: string;
  /** Card the top-up is for (absent on records saved before this field existed). */
  cardId?: string;
  cents: string;
  createdAt: number;
  relayOrderId?: string;
  approveAt?: number;
  depositAt?: number;
  depositTx?: string;
};
const KEY = 'spindle.mock.cardops';
const load = (): Record<string, Rec> => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Record<string, Rec>;
  } catch {
    return {};
  }
};
const save = (m: Record<string, Rec>) => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    // mock only
  }
};
const scenario = () => new URLSearchParams(window.location.search).get('scenario');
const need = () => {
  if (!readMockSession()) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
};
const getRec = (id: string) => {
  const r = load()[id];
  if (!r) throw new ApiError('NOT_FOUND', 'Operation not found', 404);
  return r;
};
export const patchRec = (id: string, patch: Partial<Rec>) => {
  const m = load();
  m[id] = { ...getRec(id), ...patch };
  save(m);
};
export const recForOrder = (orderId: string) => Object.values(load()).find((r) => r.relayOrderId === orderId);
export { getRec };

const payAmountFor = (cents: string) => ((Number(cents) + 170) / 100).toFixed(2);
export const originMicrosFor = (cents: string) =>
  BigInt(Math.round(Number(payAmountFor(cents)) * 1e6) + 690_000);

function view(r: Rec) {
  const now = Date.now();
  const sc = scenario();
  const invoice = {
    payAddress: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
    payAmount: payAmountFor(r.cents),
    payCurrency: 'usdttrc20',
    network: 'tron' as const,
    expiresAt: new Date(r.createdAt + 30 * 60_000).toISOString(),
  };
  const base = { id: r.id, kind: 'topup' as const, amountUsdCents: r.cents, error: null as string | null };
  const relayBase = r.relayOrderId
    ? {
        id: r.relayOrderId,
        requestId: `0x${'ab'.repeat(32)}`,
        originAmountMicros: originMicrosFor(r.cents).toString(),
        depositTx: r.depositTx ?? null,
        expiresAt: new Date(now + 60_000).toISOString(),
      }
    : null;
  if (now - r.createdAt < 1500)
    return { operation: { ...base, status: 'submitting' as const, invoice: null }, relay: null };
  if (!r.depositAt) {
    const expired = now > Date.parse(invoice.expiresAt);
    const relayStatus = r.approveAt ? ('signing' as const) : ('quoted' as const);
    return {
      operation: { ...base, status: expired ? ('expired' as const) : ('awaiting_payment' as const), invoice },
      relay: relayBase ? { ...relayBase, status: relayStatus } : null,
    };
  }
  const dt = now - r.depositAt;
  const op = (
    status: 'awaiting_payment' | 'processing' | 'completed' | 'failed' | 'review',
    error: string | null = null,
  ) => ({
    ...base,
    status,
    error,
    invoice,
  });
  const rel = (status: 'submitted' | 'pending' | 'success' | 'refund') =>
    relayBase ? { ...relayBase, status } : null;
  if (dt < 3000) return { operation: op('awaiting_payment'), relay: rel('submitted') };
  if (dt < 6000) return { operation: op('awaiting_payment'), relay: rel('pending') };
  if (sc === 'refund') return { operation: op('awaiting_payment'), relay: rel('refund') };
  if (sc === 'failed')
    return { operation: op('failed', 'izipay rejected the payment (mock)'), relay: rel('success') };
  if (sc === 'review') return { operation: op('review'), relay: rel('success') };
  if (dt < COMPLETED_AFTER_MS) return { operation: op('processing'), relay: rel('success') };
  return { operation: op('completed'), relay: rel('success') };
}

const COMPLETED_AFTER_MS = 11_000;
/** Like production: the new balance arrives with the next provider sync, a few seconds after completion. */
const BALANCE_SYNC_AFTER_MS = 15_000;

/** What completed mock top-ups did to a card: cents already in its balance, and whether a sync is pending. */
export function topupEffect(cardId: string): { creditedCents: bigint; refreshPending: boolean } {
  if (scenario()) return { creditedCents: 0n, refreshPending: false };
  const now = Date.now();
  let creditedCents = 0n;
  let refreshPending = false;
  for (const r of Object.values(load())) {
    if (r.cardId !== cardId || !r.depositAt) continue;
    const dt = now - r.depositAt;
    if (dt >= BALANCE_SYNC_AFTER_MS) creditedCents += BigInt(r.cents);
    else if (dt >= COMPLETED_AFTER_MS) refreshPending = true;
  }
  return { creditedCents, refreshPending };
}

export const cardOperationFixtures: MockFixtures = {
  'GET /v1/app/cards/pricing': () => {
    need();
    return {
      products: [
        { id: 'mastercard', label: 'Virtual Mastercard', issueFeeUsdCents: '2000', available: true },
      ],
      topupFeeNote: 'Top-up fees are set by izipay and are included in the invoice amount shown above.',
      minTopupCents: '1000',
      maxTopupCents: '1000000',
    };
  },
  'POST /v1/app/cards/:id/topups': ({ params, body }) => {
    need();
    const cents = (body as { amountUsdCents: string }).amountUsdCents;
    const id = `op_${Math.random().toString(36).slice(2, 10)}`;
    const m = load();
    m[id] = { id, cardId: params.id as string, cents, createdAt: Date.now() };
    save(m);
    return {
      operation: { id, kind: 'topup', status: 'created', amountUsdCents: cents, invoice: null, error: null },
    };
  },
  'GET /v1/app/card-operations/:id': ({ params, mode }) => {
    need();
    if (mode === 'empty') throw new ApiError('NOT_FOUND', 'Operation not found', 404);
    return view(getRec(params.id as string));
  },
};
