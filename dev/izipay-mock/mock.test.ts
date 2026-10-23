import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createMock, signRequest } from './server';

const KEY = 'test-key';
const SECRET = 'test-secret';
const HOOK_SECRET = 'hook-secret';

interface Received {
  body: string;
  signature: string | null;
  json: { id: string; type: string; data: Record<string, unknown> };
}
let received: Received[] = [];
let receiver: ReturnType<typeof Bun.serve>;
let mock: ReturnType<typeof createMock>;

beforeAll(() => {
  receiver = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.text();
      received.push({ body, signature: req.headers.get('x-izipay-signature'), json: JSON.parse(body) });
      return new Response('{"received":true}');
    },
  });
  mock = createMock({
    port: 0,
    apiKey: KEY,
    apiSecret: SECRET,
    webhookSecret: HOOK_SECRET,
    webhookUrl: `http://127.0.0.1:${receiver.port}/v1/webhooks/izipay`,
    stepDelayMs: 10,
    otpDelayMs: 10,
    timeoutMs: 400,
  });
});
afterAll(() => {
  mock.stop();
  receiver.stop(true);
});
beforeEach(async () => {
  await mock.hooks.idle();
  received = [];
  await fetch(`${mock.url}/__mock/reset`, { method: 'POST' });
});

let nonce = 0;
async function call(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  // vary the timestamp so identical requests never reuse a signature (the mock has a replay guard)
  const ts = String(Math.floor(Date.now() / 1000) - (nonce++ % 200));
  const full = `/api/v1${path}`;
  const res = await fetch(`${mock.url}${full}`, {
    method,
    body: method === 'POST' ? raw : undefined,
    headers: {
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
      'x-timestamp': ts,
      'x-signature': signRequest(SECRET, ts, method, full, raw),
      ...headers,
    },
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function issueCard(ref = 'ref-1', cardType = 'mastercard') {
  const r = await call('POST', '/cards/issue', {
    cardholder_email: 'a@example.com',
    client_card_ref: ref,
    card_type: cardType,
    pay_currency: 'usdtbsc',
  });
  return r.json.data;
}
const confirm = (payment_id: string, amount?: number) =>
  call('POST', '/sandbox/confirm', amount === undefined ? { payment_id } : { payment_id, amount });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function issued(ref = 'ref-1', cardType = 'mastercard') {
  const c = await issueCard(ref, cardType);
  await confirm(c.payment.payment_id);
  await mock.hooks.idle();
  return c.card_id as string;
}

describe('izipay mock', () => {
  test('rejects bad signature', async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const bad = await fetch(`${mock.url}/api/v1/balance`, {
      headers: { authorization: `Bearer ${KEY}`, 'x-timestamp': ts, 'x-signature': 'a'.repeat(64) },
    });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toMatchObject({ success: false, error: { code: 'INVALID_SIGNATURE' } });
    const none = await fetch(`${mock.url}/api/v1/balance`);
    expect(none.status).toBe(401);
    const oldTs = String(Math.floor(Date.now() / 1000) - 1000);
    const stale = await fetch(`${mock.url}/api/v1/balance`, {
      headers: {
        authorization: `Bearer ${KEY}`,
        'x-timestamp': oldTs,
        'x-signature': signRequest(SECRET, oldTs, 'GET', '/api/v1/balance', ''),
      },
    });
    expect(stale.status).toBe(401);
    // query string is part of the signed path
    const ts2 = String(Math.floor(Date.now() / 1000) - 7);
    const q = await fetch(`${mock.url}/api/v1/cards?page=1`, {
      headers: {
        authorization: `Bearer ${KEY}`,
        'x-timestamp': ts2,
        'x-signature': signRequest(SECRET, ts2, 'GET', '/api/v1/cards', ''),
      },
    });
    expect(q.status).toBe(401);
    expect((await call('GET', '/balance')).status).toBe(200);
  });

  test('balance returns pricing and limits', async () => {
    const r = await call('GET', '/balance');
    expect(r.json.success).toBe(true);
    expect(r.json.data.pricing.mastercard_issue_usd).toBe('20');
    expect(r.json.data.limits.rate_limit_per_min).toBe(30);
  });

  test('issue returns BSC invoice; duplicate ref returns no invoice', async () => {
    const first = await issueCard('dup-ref');
    expect(first.issue_status).toBe('pending_payment');
    expect(first.payment.pay_address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(first.payment.pay_currency).toBe('usdtbsc');
    expect(first.payment.pay_amount).toBeGreaterThan(0);
    expect(first.payment.payment_id).toBeTruthy();
    expect(new Date(first.payment.expires_at).getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
    const second = await issueCard('dup-ref');
    expect(second.card_id).toBe(first.card_id);
    expect(second.payment).toBeUndefined();
  });

  test('pay address is deterministic per payment id', async () => {
    const a = await issueCard('d1');
    await fetch(`${mock.url}/__mock/reset`, { method: 'POST' });
    const b = await issueCard('d2');
    expect(a.payment.payment_id).toBe(b.payment.payment_id);
    expect(a.payment.pay_address).toBe(b.payment.pay_address);
  });

  test('topup before issued → 409', async () => {
    const c = await issueCard();
    const r = await call('POST', `/cards/${c.card_id}/topup`, { amount_usd: 50, pay_currency: 'usdtbep20' });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('CARD_NOT_READY');
  });

  test('topup returns TRON invoice; repeated POST duplicates', async () => {
    const id = await issued();
    const t1 = await call('POST', `/cards/${id}/topup`, { amount_usd: 50, pay_currency: 'usdtbep20' });
    expect(t1.status).toBe(200);
    expect(t1.json.data.payment.pay_address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(t1.json.data.payment.pay_currency).toBe('usdttrc20');
    const t2 = await call(
      'POST',
      `/cards/${id}/topup`,
      { amount_usd: 50, pay_currency: 'usdtbep20' },
      { 'x-idempotency-key': 'same' },
    );
    const t3 = await call(
      'POST',
      `/cards/${id}/topup`,
      { amount_usd: 50, pay_currency: 'usdtbep20' },
      { 'x-idempotency-key': 'same' },
    );
    // HAZARD (mirrors live izipay): the same POST creates a new top-up and a new invoice every time
    const ids = new Set([t1, t2, t3].map((t) => t.json.data.payment.payment_id));
    expect(ids.size).toBe(3);
    expect(new Set([t1, t2, t3].map((t) => t.json.data.topup_id)).size).toBe(3);
  });

  test('card reads: live reveals number, list and transactions', async () => {
    const id = await issued();
    const plain = await call('GET', `/cards/${id}`);
    expect(plain.json.data.issue_status).toBe('issued');
    expect(plain.json.data.card.number).toBeUndefined();
    const live = await call('GET', `/cards/${id}?live=1`);
    expect(live.json.data.card.number).toMatch(/^\d{4} \d{4} \d{4} \d{4}$/);
    expect(live.json.data.card.exp).toMatch(/^\d{2}\/\d{2}$/);
    expect(live.json.data.card.cvv).toMatch(/^\d{3}$/);
    const list = await call('GET', '/cards?page=1&limit=10');
    expect(list.json.data.cards.length).toBe(1);
    expect(list.json.data.total).toBe(1);
    expect((await call('GET', `/cards/${id}/transactions`)).json.data.pagination.total).toBe(0);
    expect((await call('GET', '/cards/nope')).status).toBe(404);
  });

  test('confirm triggers signed webhooks in order', async () => {
    const c = await issueCard();
    expect((await confirm(c.payment.payment_id)).json.data.status).toBe('paid');
    await mock.hooks.idle();
    expect(received.map((r) => r.json.type)).toEqual(['card.paid', 'card.issued']);
    for (const r of received) {
      const expected = createHmac('sha256', HOOK_SECRET).update(r.body).digest();
      expect(timingSafeEqual(expected, Buffer.from(r.signature ?? '', 'hex'))).toBe(true);
      expect(r.json.data.card_id).toBe(c.card_id);
    }
    expect((await call('GET', `/cards/${c.card_id}`)).json.data.issue_status).toBe('issued');

    received = [];
    const t = await call('POST', `/cards/${c.card_id}/topup`, { amount_usd: 100, pay_currency: 'usdtbep20' });
    await confirm(t.json.data.payment.payment_id);
    await mock.hooks.idle();
    expect(received.map((r) => r.json.type)).toEqual(['card.paid', 'topup.completed']);
    const done = received[1]?.json.data;
    expect(Object.keys(done ?? {}).sort()).toEqual(['card_id', 'transaction_id']);
    const card = await call('GET', `/cards/${c.card_id}`);
    expect(card.json.data.balance).toBe(95.3); // 3% + $1.70 network fee, as live
    expect(
      (await call('GET', `/cards/${c.card_id}/transactions`)).json.data.transactions[0].transaction_id,
    ).toBe(done?.transaction_id);
  });

  test('apple pay arm leads to card.otp', async () => {
    const id = await issued('ap', 'mastercard');
    received = [];
    expect((await call('POST', `/cards/${id}/apple-pay-code`)).json.data.armed).toBe(true);
    await mock.hooks.idle();
    expect(received.map((r) => r.json.type)).toEqual(['card.otp']);
    expect(Object.keys(received[0]?.json.data ?? {}).sort()).toEqual(['card_id', 'code', 'kind', 'last4']);
    expect(received[0]?.json.data.code).toMatch(/^\d{6}$/);
    expect((await call('GET', `/cards/${id}/apple-pay-code`)).json.data.status).toBe('delivered');
    const visa = await issued('v1', 'visa');
    expect((await call('POST', `/cards/${visa}/apple-pay-code`)).status).toBe(409);
  });

  test('partial payment produces no card.paid', async () => {
    const c = await issueCard();
    const half = c.payment.pay_amount / 2;
    const r = await confirm(c.payment.payment_id, half);
    expect(r.json.data.status).toBe('partially_paid');
    await mock.hooks.idle();
    await sleep(50);
    expect(received.length).toBe(0);
    expect((await call('GET', `/cards/${c.card_id}`)).json.data.issue_status).toBe('pending_payment');
    // paying the rest completes it
    expect((await confirm(c.payment.payment_id, half)).json.data.status).toBe('paid');
    await mock.hooks.idle();
    expect(received.map((x) => x.json.type)).toEqual(['card.paid', 'card.issued']);
  });

  test('faults', async () => {
    expect((await call('GET', '/balance', undefined, { 'x-mock-fault': '429' })).status).toBe(429);
    expect((await call('GET', '/balance', undefined, { 'x-mock-fault': '500' })).status).toBe(500);
    const t0 = Date.now();
    const slow = await call('GET', '/balance', undefined, { 'x-mock-fault': 'timeout' });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(390);
    expect(slow.status).toBe(200);

    const noInv = await call(
      'POST',
      '/cards/issue',
      { cardholder_email: 'a@example.com', client_card_ref: 'ni', pay_currency: 'usdtbsc' },
      { 'x-mock-fault': 'no-invoice' },
    );
    expect(noInv.json.data.card_id).toBeTruthy();
    expect(noInv.json.data.payment).toBeUndefined();

    // dup-webhook: same event id delivered twice
    const c = await issueCard('dw');
    await call(
      'POST',
      '/sandbox/confirm',
      { payment_id: c.payment.payment_id },
      { 'x-mock-fault': 'dup-webhook' },
    );
    await mock.hooks.idle();
    expect(received.map((r) => r.json.type)).toEqual([
      'card.paid',
      'card.paid',
      'card.issued',
      'card.issued',
    ]);
    expect(received[0]?.json.id).toBe(received[1]?.json.id);
    expect(received[0]?.body).toBe(received[1]?.body);

    // sticky faults via admin endpoint
    await fetch(`${mock.url}/__mock/faults`, { method: 'POST', body: JSON.stringify({ faults: ['500'] }) });
    expect((await call('GET', '/balance')).status).toBe(500);
    expect((await call('GET', '/balance')).status).toBe(500);
    await fetch(`${mock.url}/__mock/faults`, { method: 'POST', body: JSON.stringify({ faults: [] }) });
    expect((await call('GET', '/balance')).status).toBe(200);
    const bad = await fetch(`${mock.url}/__mock/faults`, {
      method: 'POST',
      body: JSON.stringify({ faults: ['nope'] }),
    });
    expect(bad.status).toBe(400);

    // partial fault on confirm
    const p = await issueCard('pf');
    const r = await call(
      'POST',
      '/sandbox/confirm',
      { payment_id: p.payment.payment_id },
      { 'x-mock-fault': 'partial' },
    );
    expect(r.json.data.status).toBe('partially_paid');
  });

  test('reset clears state', async () => {
    await issueCard('x');
    expect((await call('GET', '/cards')).json.data.total).toBe(1);
    await fetch(`${mock.url}/__mock/reset`, { method: 'POST' });
    expect((await call('GET', '/cards')).json.data.total).toBe(0);
  });
});
