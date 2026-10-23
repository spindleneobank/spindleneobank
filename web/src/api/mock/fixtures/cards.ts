import { ApiError } from '../../errors';
import type { MockFixtures } from '../mock';
import { readMockSession } from './auth';

/**
 * Mock card backend (stateful, in memory). Page-URL switches for QA:
 *   ?op=<id>            opens the tracker on a seeded operation (see SEEDED below: op_created ... op_refund)
 *   ?cardmode=live-off  issue / top-up POSTs answer 409 LIVE_WRITES_DISABLED
 *   ?apple=busy|expired Apple Pay poll answers busy / expired
 * Magic top-up amounts: $666.66 -> the operation lands in `review` (unknown provider outcome),
 * $9.99 -> 429 RATE_LIMITED, $13.13 -> 409 CONFLICT (open invoice exists).
 */
const need = () => {
  if (!readMockSession()) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
};
const flag = (k: string) => new URLSearchParams(location.search).get(k);
const iso = (ms: number) => new Date(ms).toISOString();
const hex = (c: string) => `0x${c.repeat(64)}`;
const ago = (ms: number) => iso(Date.now() - ms);

type OpStatus =
  | 'created'
  | 'submitting'
  | 'awaiting_payment'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'review';
type RelayStatus =
  | 'quoted'
  | 'signing'
  | 'submitted'
  | 'pending'
  | 'success'
  | 'refund'
  | 'failed'
  | 'expired';
interface Op {
  id: string;
  kind: 'issue' | 'topup';
  cardId: string;
  status: OpStatus;
  amountUsdCents: string;
  error: string | null;
  invoice: boolean;
  relay: { status: RelayStatus; depositTx: string | null } | null;
  /** Live ops created through the mock advance with time after the deposit. */
  live?: { t0: number; depositAt: number | null };
  credited?: boolean;
  /** Shown as the card's pendingOperation in the list. */
  listed?: boolean;
}
interface Card {
  id: string;
  product: string;
  last4: string | null;
  status: 'pending_payment' | 'paid_pending_issue' | 'issued' | 'failed';
  balanceUsdCents: string;
  finish: string | null;
  createdAt: string;
}

const mkOp = (
  id: string,
  kind: Op['kind'],
  cardId: string,
  status: OpStatus,
  extra: Partial<Op> = {},
): Op => ({
  id,
  kind,
  cardId,
  status,
  amountUsdCents: kind === 'issue' ? '2000' : '5000',
  error: null,
  invoice: status !== 'created' && status !== 'submitting',
  relay: null,
  ...extra,
});

const SEEDED: Op[] = [
  mkOp('op_created', 'issue', 'card_pending', 'created'),
  mkOp('op_submitting', 'issue', 'card_pending', 'submitting'),
  mkOp('op_awaiting_payment', 'issue', 'card_pending', 'awaiting_payment', { listed: true }),
  mkOp('op_bridging', 'topup', 'card_issued', 'awaiting_payment', {
    relay: { status: 'pending', depositTx: hex('d') },
  }),
  mkOp('op_refund', 'topup', 'card_issued', 'awaiting_payment', {
    relay: { status: 'refund', depositTx: hex('e') },
  }),
  mkOp('op_processing', 'issue', 'card_pending', 'processing', {
    relay: { status: 'success', depositTx: hex('f') },
  }),
  mkOp('op_topup_processing', 'topup', 'card_issued', 'processing', {
    relay: { status: 'success', depositTx: hex('9') },
  }),
  mkOp('op_completed', 'topup', 'card_issued', 'completed', {
    relay: { status: 'success', depositTx: hex('a') },
  }),
  mkOp('op_issue_completed', 'issue', 'card_issued', 'completed', {
    relay: { status: 'success', depositTx: hex('c') },
  }),
  mkOp('op_failed', 'issue', 'card_failed', 'failed', {
    error: 'izipay rejected the cardholder email (422). Nothing was charged.',
  }),
  mkOp('op_expired', 'topup', 'card_issued', 'expired'),
  mkOp('op_review', 'topup', 'card_issued', 'review', { relay: { status: 'success', depositTx: hex('b') } }),
];

let ops: Op[] = [];
let cards: Card[] = [];
const txExtra = 0;

function seed() {
  ops = SEEDED.map((o) => ({ ...o, relay: o.relay ? { ...o.relay } : null }));
  cards = [
    {
      id: 'card_issued',
      product: 'mastercard',
      last4: '4242',
      status: 'issued',
      balanceUsdCents: '12500',
      finish: 'orchid',
      createdAt: ago(12 * 864e5),
    },
    {
      id: 'card_pending',
      product: 'mastercard',
      last4: null,
      status: 'pending_payment',
      balanceUsdCents: '0',
      finish: 'garnet',
      createdAt: ago(20 * 60_000),
    },
    {
      id: 'card_failed',
      product: 'mastercard',
      last4: null,
      status: 'failed',
      balanceUsdCents: '0',
      finish: 'slate',
      createdAt: ago(3 * 864e5),
    },
  ];
}
seed();

/** Advance live ops by elapsed time since the deposit was reported. */
function tick(op: Op): Op {
  const l = op.live;
  if (!l) return op;
  const now = Date.now();
  if (l.depositAt === null) {
    op.status = now - l.t0 < 1200 ? 'created' : 'awaiting_payment';
    op.invoice = op.status === 'awaiting_payment';
    return op;
  }
  const d = now - l.depositAt;
  if (d < 2500) {
    op.status = 'awaiting_payment';
    if (op.relay) op.relay.status = 'pending';
  } else {
    if (op.relay) op.relay.status = 'success';
    if (d < 6000) op.status = 'processing';
    else {
      op.status = 'completed';
      const card = cards.find((c) => c.id === op.cardId);
      if (card && op.kind === 'issue' && card.status !== 'issued') {
        card.status = 'issued';
        card.last4 = '7731';
      }
      if (card && op.kind === 'topup' && !op.credited) {
        op.credited = true;
        card.balanceUsdCents = String(BigInt(card.balanceUsdCents) + BigInt(op.amountUsdCents));
      }
    }
  }
  return op;
}

const invoiceOf = (op: Op) =>
  op.invoice
    ? {
        payAddress: op.kind === 'issue' ? `0x${'7'.repeat(40)}` : 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        payAmount: op.kind === 'issue' ? '20.00' : (Number(op.amountUsdCents) / 100 + 2.5).toFixed(2),
        payCurrency: op.kind === 'issue' ? 'usdtbsc' : 'usdttrc20',
        network: op.kind === 'issue' ? 'bsc' : 'tron',
        expiresAt:
          op.status === 'expired'
            ? ago(5 * 60_000)
            : iso(Date.now() + (op.id === 'op_awaiting_payment' ? 7 : 24) * 60_000),
      }
    : null;

const opView = (op: Op) => {
  tick(op);
  return {
    id: op.id,
    kind: op.kind,
    status: op.status,
    amountUsdCents: op.amountUsdCents,
    invoice: invoiceOf(op),
    error: op.error,
  };
};
const relayView = (op: Op) =>
  op.relay
    ? {
        id: `rel_${op.id}`,
        requestId: `0x${'c'.repeat(64)}`,
        status: op.relay.status,
        originAmountMicros: op.kind === 'issue' ? '20350000' : '52690000',
        depositTx: op.relay.depositTx,
        expiresAt: iso(Date.now() + 5 * 60_000),
      }
    : null;

const cardView = (c: Card) => {
  const pending = ops.find(
    (o) =>
      o.listed &&
      o.cardId === c.id &&
      ['created', 'submitting', 'awaiting_payment', 'processing', 'review'].includes(tick(o).status),
  );
  return { ...c, ...(pending ? { pendingOperation: opView(pending) } : {}) };
};

const TXS = [
  ['Anthropic API', '-1850', 'settled', 1],
  ['Hetzner Cloud', '-2490', 'settled', 2],
  ['Top-up', '5000', 'settled', 4],
  ['Cloudflare', '-500', 'pending', 5],
  ['Vercel', '-2000', 'settled', 7],
  ['Top-up', '10000', 'settled', 9],
  ['GitHub', '-400', 'declined', 10],
] as const;

let apple: { armedAt: number; until: number } | null = null;

export const cardFixtures: MockFixtures = {
  'GET /v1/app/cards/pricing': () => {
    need();
    return {
      products: [
        {
          id: 'mastercard',
          label: 'Mastercard (Apple Pay ready)',
          issueFeeUsdCents: '2000',
          available: true,
        },
        { id: 'visa', label: 'Visa', issueFeeUsdCents: '2000', available: false },
      ],
      topupFeeNote:
        'izipay charges a percentage plus a network fee. The exact amount is shown on the invoice.',
      minTopupCents: '1000',
      maxTopupCents: '1000000',
    };
  },
  'GET /v1/app/cards': ({ mode }) => {
    need();
    if (mode === 'empty') return [];
    return cards.map(cardView);
  },
  'POST /v1/app/cards': ({ body }) => {
    need();
    if (flag('cardmode') === 'live-off') {
      throw new ApiError('LIVE_WRITES_DISABLED', 'Live card writes are disabled in this environment.', 409);
    }
    const b = body as { product: string; finish?: string };
    const id = `card_${Math.random().toString(36).slice(2, 8)}`;
    const card: Card = {
      id,
      product: b.product,
      last4: null,
      status: 'pending_payment',
      balanceUsdCents: '0',
      finish: b.finish ?? null,
      createdAt: iso(Date.now()),
    };
    cards.unshift(card);
    const op = mkOp(`op_${id}`, 'issue', id, 'created', {
      live: { t0: Date.now(), depositAt: null },
      invoice: false,
      listed: true,
    });
    ops.push(op);
    return { card: cardView(card), operation: opView(op) };
  },
  'POST /v1/app/cards/:id/topups': ({ params, body }) => {
    need();
    if (flag('cardmode') === 'live-off') {
      throw new ApiError('LIVE_WRITES_DISABLED', 'Live card writes are disabled in this environment.', 409);
    }
    const cents = (body as { amountUsdCents: string }).amountUsdCents;
    if (cents === '999') throw new ApiError('RATE_LIMITED', 'Daily card operation limit reached.', 429);
    if (cents === '1313')
      throw new ApiError('CONFLICT', 'An open invoice already exists for this card.', 409);
    const op = mkOp(
      `op_t${Math.random().toString(36).slice(2, 8)}`,
      'topup',
      params.id as string,
      'created',
      {
        amountUsdCents: cents,
        live: { t0: Date.now(), depositAt: null },
        invoice: false,
        listed: true,
      },
    );
    if (cents === '66666') {
      op.status = 'review';
      op.live = undefined;
      op.invoice = false;
      op.error = null;
    }
    ops.push(op);
    return { operation: opView(op) };
  },
  'GET /v1/app/card-operations/:id': ({ params }) => {
    need();
    const op = ops.find((o) => o.id === params.id);
    if (!op) throw new ApiError('NOT_FOUND', 'Operation not found', 404);
    return { operation: opView(op), relay: relayView(op) };
  },
  'POST /v1/app/card-operations/:id/relay-quote': ({ params }) => {
    need();
    const op = ops.find((o) => o.id === params.id);
    if (!op) throw new ApiError('NOT_FOUND', 'Operation not found', 404);
    if (flag('quote') === 'liquidity') {
      throw new ApiError('INSUFFICIENT_LIQUIDITY', 'Relay has no liquidity for this amount right now.', 409);
    }
    op.relay = { status: 'quoted', depositTx: null };
    const item = (c: string) => ({
      to: `0x${c.repeat(40)}`,
      data: `0x${'ab'.repeat(36)}`,
      value: '0',
      chainId: 4663,
    });
    return {
      relayOrderId: `rel_${op.id}`,
      requestId: `0x${'c'.repeat(64)}`,
      originAmountMicros: op.kind === 'issue' ? '20350000' : '52690000',
      feesUsd: '0.35',
      timeEstimateSec: 2,
      steps: [
        { id: 'approve', kind: 'transaction', items: [item('1')] },
        { id: 'deposit', kind: 'transaction', items: [item('2')] },
      ],
      expiresAt: iso(Date.now() + 5 * 60_000),
    };
  },
  'POST /v1/app/relay-orders/:id/submitted': ({ params, body }) => {
    need();
    const op = ops.find((o) => `rel_${o.id}` === params.id);
    if (!op) throw new ApiError('NOT_FOUND', 'Relay order not found', 404);
    const b = body as { step: 'approve' | 'deposit'; txHash: string };
    if (b.step === 'approve') {
      if (op.relay) op.relay.status = 'signing';
      return { status: 'signing' };
    }
    if (op.relay) {
      op.relay.status = 'submitted';
      op.relay.depositTx = b.txHash;
    }
    if (op.live) op.live.depositAt = Date.now();
    return { status: 'submitted' };
  },
  'GET /v1/app/cards/:id/transactions': ({ params, mode, query }) => {
    need();
    if (mode === 'empty' || params.id !== 'card_issued') return { items: [], nextCursor: null };
    const start = Number(query.get('cursor') ?? 0);
    const page = TXS.slice(start, start + 4);
    return {
      items: page.map(([merchant, amountCents, status, d], i) => ({
        id: `tx_${start + i + txExtra}`,
        amountCents,
        currency: 'USD',
        merchant: merchant === 'Top-up' ? null : merchant,
        status,
        occurredAt: ago(d * 864e5),
      })),
      nextCursor: start + 4 < TXS.length ? String(start + 4) : null,
    };
  },
  'POST /v1/app/cards/:id/reveal': () => {
    const s = readMockSession();
    if (!s) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
    if (s.freshUntil <= Date.now())
      throw new ApiError('REAUTH_REQUIRED', 'Please confirm with your wallet.', 403);
    return { number: '5412751234567731', exp: '09/29', cvv: '482', holder: 'SPINDLE USER' };
  },
  'POST /v1/app/cards/:id/apple-pay': () => {
    const s = readMockSession();
    if (!s) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
    if (s.freshUntil <= Date.now())
      throw new ApiError('REAUTH_REQUIRED', 'Please confirm with your wallet.', 403);
    apple = { armedAt: Date.now(), until: Date.now() + 10 * 60_000 };
    return { armedUntil: iso(apple.until) };
  },
  'GET /v1/app/cards/:id/apple-pay': () => {
    need();
    const f = flag('apple');
    if (f === 'busy') return { status: 'busy', expiresAt: null };
    if (f === 'expired' || !apple) return { status: 'expired', expiresAt: null };
    if (Date.now() > apple.until) return { status: 'expired', expiresAt: iso(apple.until) };
    if (Date.now() - apple.armedAt < 8000) return { status: 'armed', expiresAt: iso(apple.until) };
    return { status: 'code', code: '482913', expiresAt: iso(apple.until) };
  },
};
