import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { CardOpStatus } from '../../shared/enums';

export type Network = 'bsc' | 'tron';
export const PAY_CURRENCY: Record<Network, string> = { bsc: 'usdtbsc', tron: 'usdttrc20' };
/** Live top-ups always return a TRON invoice regardless of the requested rail. */
export const topupNetworks = (_product: string): Network[] => ['tron'];

export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const str = (value: unknown, max = 256): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
export const identifier = (value: unknown): string | null => {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : str(value, 128);
  return text && /^[A-Za-z0-9_-]+$/.test(text) ? text : null;
};
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

/** Canonical non-negative (or signed) decimal text, or null. Never goes through floats. */
export function decimal(value: unknown, signed = false): string | null {
  if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER))
    return null;
  const text = typeof value === 'number' ? String(value) : value;
  if (
    typeof text !== 'string' ||
    !(signed ? /^-?\d{1,20}(\.\d{1,18})?$/ : /^\d{1,20}(\.\d{1,18})?$/).test(text)
  ) {
    return null;
  }
  const [integer = '0', fraction = ''] = text.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return integer.replace(/^(-?)0+(?=\d)/, '$1') + (trimmed ? `.${trimmed}` : '');
}

/** Decimal text -> integer units at `decimals`, rounding UP when there are extra digits. */
export function decimalToUnits(text: string, decimals: number): bigint {
  const [whole = '0', fraction = ''] = text.split('.');
  const kept = fraction.slice(0, decimals).padEnd(decimals, '0');
  let units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(kept || '0');
  if (/[1-9]/.test(fraction.slice(decimals))) units += 1n;
  return units;
}
export const centsToDecimal = (cents: bigint) =>
  `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
export function decimalToCents(text: string | null): bigint | null {
  if (!text) return null;
  const [whole = '0', fraction = ''] = text.split('.');
  return (
    BigInt(whole) * 100n +
    BigInt(fraction.slice(0, 2).padEnd(2, '0')) +
    (/[1-9]/.test(fraction.slice(2)) ? 1n : 0n)
  );
}

export function iso(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]/.test(value)) return null;
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function signRequest(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  body: string,
): string {
  return createHmac('sha256', secret).update(`${timestamp}\n${method}\n${path}\n${body}`).digest('hex');
}
export function verifyWebhook(secret: string, body: Buffer, signature: unknown): boolean {
  if (!secret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

/** Preserves JSON number lexemes as strings so invoice quantities never round through IEEE754. */
export function parseProviderJson(raw: string): unknown {
  return JSON.parse(
    raw.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (token) =>
      token.startsWith('"') ? token : JSON.stringify(token),
    ),
  );
}

export function invoiceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      ['izipay.me', 'nowpayments.io'].includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

// Provider docs, issuance and live top-up responses label the same USDT rail differently.
// Compare alphanumerics only, never across rails.
const providerCode = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const currencyAliases: Record<Network, string[]> = {
  tron: ['usdttrc20', 'usdttrx', 'usdttron'],
  bsc: ['usdtbsc', 'usdtbep20', 'usdtbnb'],
};
const networkAliases: Record<Network, string[]> = {
  tron: ['tron', 'trc20', 'trx'],
  bsc: ['bsc', 'bep20', 'bnb', 'bnbsmartchain', 'binancesmartchain', 'bnbchain'],
};

export function normalizeInvoice(data: unknown, network: Network) {
  const root = record(data);
  const payment = Object.keys(record(root.payment)).length ? record(root.payment) : root;
  const currency = str(payment.pay_currency);
  const providerNetwork = str(payment.network);
  if (
    (currency && !currencyAliases[network].includes(providerCode(currency))) ||
    (providerNetwork && !networkAliases[network].includes(providerCode(providerNetwork)))
  ) {
    throw new Error('Invoice network mismatch');
  }
  // A missing currency cannot establish that an address is safe for the requested chain.
  return {
    paymentId: identifier(payment.payment_id ?? root.payment_id),
    topupId: identifier(root.topup_id),
    payAddress: currency ? str(payment.deposit_address ?? payment.pay_address, 256) : null,
    payAmount: currency ? decimal(payment.pay_amount) : null,
    payCurrency: PAY_CURRENCY[network],
    network,
    expiresAt: iso(payment.expires_at),
    url: currency ? invoiceUrl(payment.invoice_url) : null,
    amountUsd: decimal(payment.amount_usd ?? root.amount_usd),
    amountOnCardUsd: decimal(root.amount_on_card ?? payment.amount_on_card),
  };
}

export function normalizeCard(value: unknown) {
  const data = record(value);
  const card = record(data.card);
  const issue = str(data.issue_status);
  const issueStatus =
    issue === 'issued' || issue === 'failed' || issue === 'pending_payment' || issue === 'paid_pending_issue'
      ? issue
      : 'unknown';
  const last4 = str(card.last4 ?? data.last4);
  return {
    providerCardId: identifier(data.card_id),
    clientCardRef: identifier(data.client_card_ref),
    issueStatus,
    last4: last4 && /^\d{4}$/.test(last4) ? last4 : null,
    balanceUsd: decimal(card.balance ?? data.balance),
    issuedAt: iso(data.issued_at),
  };
}

export function normalizeTransaction(value: unknown) {
  const data = record(value);
  const providerTxnId = identifier(data.transaction_id ?? data.id);
  const amount = decimal(data.amount, true);
  const occurredAt = iso(data.occurred_at ?? data.date ?? data.created_at);
  const currency = str(data.currency, 8);
  if (!providerTxnId || amount === null || !occurredAt || !currency || !/^[A-Z]{3,8}$/.test(currency))
    return null;
  const rawStatus = str(data.status)?.toLowerCase();
  const status =
    rawStatus &&
    ['pending', 'success', 'failed', 'reversed', 'settled', 'completed', 'declined'].includes(rawStatus)
      ? rawStatus
      : 'unknown';
  return {
    providerTxnId,
    amountCents: decimalToCents(amount.replace(/^-/, '')) ?? 0n,
    direction: (typeof data.is_credit === 'boolean' ? (data.is_credit ? 'credit' : 'debit') : 'debit') as
      | 'credit'
      | 'debit',
    currency,
    merchant: str(data.merchant, 200),
    status,
    occurredAt,
  };
}

/** Final evidence (completed/failed) is sticky; review is only left by authoritative progress. */
export function advanceStatus(current: CardOpStatus, incoming: CardOpStatus): CardOpStatus {
  if (current === 'completed') return 'completed';
  if (incoming === 'completed') return incoming;
  if (current === 'failed' && incoming !== 'processing') return 'failed';
  if (
    current === 'processing' &&
    ['created', 'submitting', 'awaiting_payment', 'expired'].includes(incoming)
  ) {
    return 'processing';
  }
  if (current === 'review' && ['created', 'submitting', 'awaiting_payment', 'expired'].includes(incoming)) {
    return 'review';
  }
  if (current === 'expired' && ['created', 'submitting', 'awaiting_payment'].includes(incoming))
    return 'expired';
  return incoming;
}

export const handledEventTypes = [
  'card.created',
  'card.paid',
  'card.issued',
  'card.failed',
  'topup.completed',
  'card.transaction',
];

/** Redacted structure of an undocumented event: field names with type/length/class only. */
export function eventShape(value: unknown, depth = 0): unknown {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return depth >= 4
      ? `array(${value.length})`
      : [`array(${value.length})`, ...value.slice(0, 1).map((v) => eventShape(v, depth + 1))];
  }
  if (typeof value === 'object') {
    if (depth >= 4) return 'object';
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 40)
        .map(([k, v]) => [/^[A-Za-z0-9_.-]{1,40}$/.test(k) ? k : '?', eventShape(v, depth + 1)]),
    );
  }
  if (typeof value !== 'string') return typeof value;
  const kind = /^\d+$/.test(value) ? 'digits' : /^[A-Za-z0-9]+$/.test(value) ? 'alnum' : 'text';
  return `string(${value.length},${kind})`;
}

/** The OTP of a `card.otp` event, read from the verified raw body only; never persisted. */
export function otpFromEvent(value: unknown) {
  const root = record(value);
  const data = record(root.data);
  const cardId = identifier(data.card_id);
  const code = str(data.code, 12);
  if (root.type !== 'card.otp' || !cardId || !code || !/^\d{4,10}$/.test(code)) return null;
  return { cardId, code };
}

/** Allowlisted, OTP-free payload for the webhook inbox. */
export function sanitizeEvent(value: unknown) {
  const root = record(value);
  const data = record(root.data);
  const eventId = identifier(root.id);
  const type = str(root.type, 80);
  if (!eventId || !type || !/^[a-z][a-z0-9_.]+$/.test(type)) throw new Error('Invalid event');
  const payload: Record<string, unknown> = {};
  for (const k of ['card_id', 'client_card_ref', 'payment_id', 'topup_id', 'transaction_id']) {
    const id = identifier(data[k]);
    if (id) payload[k] = id;
  }
  if (type === 'card.transaction') payload.transaction = serializableTx(normalizeTransaction(data));
  if (!handledEventTypes.includes(type) && type !== 'card.otp') payload.shape = eventShape(root);
  return { eventId, type, payload };
}
function serializableTx(tx: ReturnType<typeof normalizeTransaction>) {
  return tx ? { ...tx, amountCents: tx.amountCents.toString() } : null;
}
