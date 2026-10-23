import { ApiError } from '../../errors';
import type { MockFixtures } from '../mock';
import { readMockSession } from './auth';

/**
 * Time-driven mock of card operations + Relay orders, kept in sessionStorage so a reload resumes.
 * `?scenario=` : `refund` | `failed` | `review` (after the deposit is reported) or `liquidity` (relay-quote fails).
 */
type Rec = {
  id: string;
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
  if (dt < 11_000) return { operation: op('processing'), relay: rel('success') };
  return { operation: op('completed'), relay: rel('success') };
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
  'POST /v1/app/cards/:id/topups': ({ body }) => {
    need();
    const cents = (body as { amountUsdCents: string }).amountUsdCents;
    const id = `op_${Math.random().toString(36).slice(2, 10)}`;
    const m = load();
    m[id] = { id, cents, createdAt: Date.now() };
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
