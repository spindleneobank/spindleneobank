import { login, runJob, type Session } from '../lib/api';
import { sendRaw } from '../lib/chain';
import { psql } from '../lib/db';
import { MOCK } from '../lib/env';
import { sleep, until } from '../lib/chain';
import { assert, eq, type Scenario } from '../lib/harness';
import { admin } from '../lib/fixtures';

const op = (s: Session, id: string) => s.get(`/v1/app/card-operations/${id}`);

async function pay(s: Session, id: string, c: { step: (m: string) => void; ev: (n: string, d: unknown) => void }, tag: string) {
  const quote = await s.post(`/v1/app/card-operations/${id}/relay-quote`);
  c.ev(`relay-quote-${tag}`, { relayOrderId: quote.relayOrderId, feesUsd: quote.feesUsd, originAmountMicros: quote.originAmountMicros, steps: quote.steps.map((x: any) => ({ id: x.id, to: x.items[0].to })) });
  for (const step of quote.steps) {
    const item = step.items[0];
    const hash = await sendRaw(s.index, { to: item.to, data: item.data, value: BigInt(item.value) });
    await s.post(`/v1/app/relay-orders/${quote.relayOrderId}/submitted`, { step: step.id, txHash: hash });
    c.step(`${tag}: ${step.id} tx ${hash}`);
  }
  return quote;
}
async function until_(s: Session, id: string, want: string[], a: Session) {
  return until(async () => {
    await runJob(a, 'cards-reconcile').catch(() => {});
    const o = (await op(s, id)).operation;
    return want.includes(o.status) ? o : undefined;
  }, 180_000, 3000);
}

export const s09: Scenario = {
  n: 9,
  name: 'Card issue + top-up',
  async run(c) {
    const s = await login(9);
    const a = await admin();
    await fetch(`${MOCK}/__mock/reset`, { method: 'POST' });
    const pricing = await s.get('/v1/app/cards/pricing');
    const product = pricing.products.find((p: any) => p.available)?.id ?? pricing.products[0].id;
    const created = await s.post('/v1/app/cards', { product, email: 'e2e@example.com', alias: 'E2E' });
    c.ev('create', created);
    const waiting = await until_(s, created.operation.id, ['awaiting_payment'], a);
    assert(waiting.invoice?.network === 'bsc', 'issue invoice on bsc');
    c.step(`invoice ${waiting.invoice.payAddress} ${waiting.invoice.payAmount} ${waiting.invoice.payCurrency}`);
    await pay(s, created.operation.id, c, 'issue');
    const done = await until_(s, created.operation.id, ['completed', 'failed', 'review'], a);
    eq(done.status, 'completed', 'issue operation completed');
    const card = await until(async () => (await s.get('/v1/app/cards')).find((x: any) => x.status === 'issued'), 120_000, 3000);
    c.ev('card', card);
    c.step(`card issued last4 ${card.last4}`);

    // top up
    const top = await s.post(`/v1/app/cards/${card.id}/topups`, { amountUsdCents: '1000' });
    await until_(s, top.operation.id, ['awaiting_payment'], a);
    // the mock's TRON pay address is not base58check-valid, which the real Relay API rejects: use a valid one (fixture)
    await psql(`update card_operations set invoice = jsonb_set(invoice, '{payAddress}', '"TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy"') where id = '${top.operation.id}'`);
    await pay(s, top.operation.id, c, 'topup');
    const topDone = await until_(s, top.operation.id, ['completed', 'failed', 'review'], a);
    eq(topDone.status, 'completed', 'top-up completed');

    // reveal (re-sign) + apple pay
    await s.reauth();
    const rr = await fetch(`http://127.0.0.1:7200/v1/app/cards/${card.id}/reveal`, { method: 'POST', headers: { origin: 'http://localhost:7000', 'x-spindle': '1', cookie: s.cookie } });
    eq(rr.status, 200, 'reveal 200');
    assert((rr.headers.get('cache-control') ?? '').includes('no-store'), 'reveal no-store');
    const rev = (await rr.json()) as any;
    assert(/^\d{13,19}$/.test(rev.number), 'mock PAN');
    c.ev('reveal', { numberLast4: String(rev.number).slice(-4), exp: rev.exp, holder: rev.holder, headers: { 'cache-control': rr.headers.get('cache-control') } });
    await s.post(`/v1/app/cards/${card.id}/apple-pay`);
    const otp = await until(async () => {
      const x = await s.get(`/v1/app/cards/${card.id}/apple-pay`);
      return x.status === 'code' ? x : undefined;
    }, 60_000, 1500);
    assert(/^\d{6}$/.test(otp.code), 'apple pay mock code');
    c.ev('apple-pay', { status: otp.status, code: 'REDACTED-6-digits' });

    // fault: 500 on top-up -> review, exactly one top-up POST
    await fetch(`${MOCK}/__mock/faults`, { method: 'POST', body: JSON.stringify({ faults: ['500'] }) });
    const before = ((await (await fetch(`${MOCK}/__mock/requests`)).json()) as any).data.requests.length;
    const bad = await s.post(`/v1/app/cards/${card.id}/topups`, { amountUsdCents: '1000' });
    const review = await until_(s, bad.operation.id, ['review', 'failed', 'completed'], a);
    await sleep(15_000); // no retry must follow
    await runJob(a, 'cards-reconcile').catch(() => {});
    await sleep(3000);
    await fetch(`${MOCK}/__mock/faults`, { method: 'POST', body: JSON.stringify({ faults: [] }) });
    const reqs = ((await (await fetch(`${MOCK}/__mock/requests`)).json()) as any).data.requests.slice(before);
    c.ev('mock-requests-after-fault', reqs);
    const topPosts = reqs.filter((r: any) => r.method === 'POST' && /top-?up/i.test(r.path));
    eq(review.status, 'review', 'fault 500 leaves the operation in review');
    eq(topPosts.length, 1, 'exactly one top-up POST reached the mock');
    c.step(`fault: operation ${review.status}, mock saw ${topPosts.length} top-up POST`);
  },
};
