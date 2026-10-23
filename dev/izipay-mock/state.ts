import { createHash } from 'node:crypto';

export type Network = 'bsc' | 'tron';
export type Fault = '429' | '500' | 'timeout' | 'dup-webhook' | 'no-invoice' | 'partial';
export const FAULTS: readonly Fault[] = ['429', '500', 'timeout', 'dup-webhook', 'no-invoice', 'partial'];

export interface Payment {
  payment_id: string;
  card_id: string;
  kind: 'issue' | 'topup';
  topup_id?: string;
  amount_usd: number;
  pay_address: string;
  pay_amount: number;
  pay_currency: string;
  network: string;
  expires_at: string;
  status: 'waiting' | 'partially_paid' | 'paid';
  paid_amount: number;
}

export interface Card {
  card_id: string;
  client_card_ref: string;
  cardholder_email: string;
  cardholder_alias: string | null;
  card_type: string;
  issue_status: 'pending_payment' | 'paid_pending_issue' | 'issued' | 'failed';
  payment_status: 'waiting' | 'paid';
  balance: number;
  pending_topup: number;
  is_frozen: boolean;
  number: string;
  last4: string;
  exp: string;
  cvv: string;
  created_at: string;
  issued_at: string | null;
}

export interface Transaction {
  transaction_id: string;
  type: string;
  status: string;
  amount: number;
  currency: string;
  is_credit: boolean;
  merchant: string | null;
  date: string;
}

export const sha = (s: string) => createHash('sha256').update(s).digest();

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Deterministic pay address from the payment id: `0x` + 40 hex (BSC) or `T` + 33 base58 (TRON). */
export function payAddress(network: Network, paymentId: string): string {
  const h = sha(`pay:${network}:${paymentId}`);
  if (network === 'bsc') return `0x${h.subarray(0, 20).toString('hex')}`;
  let s = 'T';
  for (let i = 0; i < 33; i++) s += B58[(h[i % h.length] as number) % B58.length];
  return s;
}

export class MockState {
  cards = new Map<string, Card>();
  refs = new Map<string, string>(); // client_card_ref -> card_id
  payments = new Map<string, Payment>();
  txs = new Map<string, Transaction[]>();
  otpArmed = new Map<string, { expiresAt: number; code: string | null }>();
  seenSignatures = new Map<string, number>();
  stickyFaults = new Set<Fault>();
  private seq = { card: 0, payment: 0, topup: 0, tx: 0, event: 0 };

  reset(): void {
    this.cards.clear();
    this.refs.clear();
    this.payments.clear();
    this.txs.clear();
    this.otpArmed.clear();
    this.seenSignatures.clear();
    this.stickyFaults.clear();
    this.seq = { card: 0, payment: 0, topup: 0, tx: 0, event: 0 };
  }

  nextEventId = () => `evt_mock_${String(++this.seq.event).padStart(6, '0')}`;

  newCard(input: { ref: string; email: string; alias: string | null; cardType: string }): Card {
    const n = ++this.seq.card;
    const card_id = `card_mock_${String(n).padStart(6, '0')}`;
    const last4 = String(1000 + (sha(card_id)[0] as number) * 31 + n).slice(-4);
    const card: Card = {
      card_id,
      client_card_ref: input.ref,
      cardholder_email: input.email,
      cardholder_alias: input.alias,
      card_type: input.cardType,
      issue_status: 'pending_payment',
      payment_status: 'waiting',
      balance: 0,
      pending_topup: 0,
      is_frozen: false,
      number: `5258 4700 0000 ${last4}`,
      last4,
      exp: '07/29',
      cvv: String(100 + ((sha(`${card_id}:cvv`)[0] as number) % 900)),
      created_at: new Date().toISOString(),
      issued_at: null,
    };
    this.cards.set(card_id, card);
    this.refs.set(input.ref, card_id);
    this.txs.set(card_id, []);
    return card;
  }

  newPayment(
    card: Card,
    kind: 'issue' | 'topup',
    network: Network,
    payCurrency: string,
    amountUsd: number,
    payAmount: number,
  ): Payment {
    const payment_id = String(90_000_000 + ++this.seq.payment);
    const p: Payment = {
      payment_id,
      card_id: card.card_id,
      kind,
      ...(kind === 'topup' ? { topup_id: `topup_mock_${String(++this.seq.topup).padStart(6, '0')}` } : {}),
      amount_usd: amountUsd,
      pay_address: payAddress(network, payment_id),
      pay_amount: payAmount,
      pay_currency: payCurrency,
      network: network === 'tron' ? 'trc20' : 'bep20',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      status: 'waiting',
      paid_amount: 0,
    };
    this.payments.set(payment_id, p);
    if (kind === 'topup') card.pending_topup += amountUsd;
    return p;
  }

  addTx(card_id: string, t: Omit<Transaction, 'transaction_id' | 'date'>): Transaction {
    const tx: Transaction = {
      ...t,
      transaction_id: `tx_mock_${String(++this.seq.tx).padStart(6, '0')}`,
      date: new Date().toISOString(),
    };
    this.txs.get(card_id)?.unshift(tx);
    return tx;
  }
}

/** Public invoice shape (as returned by izipay): numbers are JSON numbers. */
export const invoice = (p: Payment) => ({
  provider: 'nowpayments',
  payment_id: p.payment_id,
  invoice_url: `https://nowpayments.io/payment?iid=${p.payment_id}`,
  pay_address: p.pay_address,
  pay_amount: p.pay_amount,
  pay_currency: p.pay_currency,
  network: p.network,
  amount_usd: p.amount_usd,
  expires_at: p.expires_at,
});

export const publicCard = (c: Card, reveal = false) => ({
  card_id: c.card_id,
  client_card_ref: c.client_card_ref,
  cardholder_email: c.cardholder_email,
  cardholder_alias: c.cardholder_alias,
  card_type: c.card_type,
  issue_status: c.issue_status,
  payment_status: c.payment_status,
  last4: c.last4,
  balance: c.balance,
  pending_topup: c.pending_topup,
  is_frozen: c.is_frozen,
  created_at: c.created_at,
  issued_at: c.issued_at,
});
