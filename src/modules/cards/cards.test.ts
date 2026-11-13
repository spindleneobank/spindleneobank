import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { cardOperations, cardProfiles, cards, cardWebhookEvents, sessions, users } from '../../db/schema';
import { closeQueues } from '../../lib/queue';
import { closeRedis, getRedis } from '../../lib/redis';
import { dbRef } from '../auth/constants';
import { provider } from './provider';
import {
  expireInvoices,
  processOneEvent,
  recoverUnmatchedCards,
  runCardsMaintenance,
  submitOne,
  syncOneCard,
} from './reconcile';
import { invoiceOf } from './service';
import { cardSettings, cardsEnabled, providerScope } from './settings';
import { bootCards, HOOK_SECRET, type Kit } from './testkit';

let kit: Kit;
const realFetch = globalThis.fetch;
const calls: { method: string; url: string }[] = [];
const only = (frag: string) => calls.filter((c) => c.url.includes(frag));

beforeAll(async () => {
  kit = await bootCards();
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url: String(input) });
    return realFetch(input, init);
  }) as typeof fetch;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await kit.stop();
  await closeQueues().catch(() => {});
  await closeRedis();
});
afterEach(async () => {
  kit.mock.state.stickyFaults = new Set();
  calls.length = 0;
  // unsubmitted leftovers must not be claimed by the next test's submitOne()
  await dbRef.db.update(cardOperations).set({ status: 'failed' }).where(eq(cardOperations.status, 'created'));
});

const body = (r: Response) => r.json() as Promise<any>;
async function settle() {
  await kit.mock.hooks.idle();
  for (let i = 0; i < 20; i++) if (!(await processOneEvent())) break;
}
const opRow = async (id: string) =>
  (await dbRef.db.select().from(cardOperations).where(eq(cardOperations.id, id)))[0]!;
const cardRow = async (id: string) => (await dbRef.db.select().from(cards).where(eq(cards.id, id)))[0]!;

async function issued(addr: `0x${string}` = kit.newUser(), email = 'holder@example.com') {
  const u = await kit.as(addr);
  const res = await u.call('POST', '/v1/app/cards', {
    product: 'mastercard',
    email,
    cardholderName: 'Ada L',
  });
  expect(res.status).toBe(200);
  const { card, operation } = await body(res);
  await submitOne();
  const op = await opRow(operation.id);
  const inv = invoiceOf(op);
  expect(inv).not.toBeNull();
  await provider.sandboxConfirm(inv?.paymentId as string);
  await settle();
  return { u, cardId: card.id as string, opId: operation.id as string };
}

describe('issue flow', () => {
  test('create -> invoice persisted from first response -> webhooks -> issued; email only encrypted', async () => {
    const addr = kit.newUser();
    const u = await kit.as(addr);
    const res = await u.call('POST', '/v1/app/cards', {
      product: 'mastercard',
      email: 'secret.person@example.com',
      cardholderName: 'Ada L',
    });
    const { card, operation } = await body(res);
    expect(operation.status).toBe('created');
    expect(card.status).toBe('pending_payment');
    // email is never stored in clear
    const profiles = await dbRef.db.select().from(cardProfiles);
    expect(JSON.stringify(profiles)).not.toContain('secret.person');
    expect((await opRow(operation.id)).fundingWallet).toBe(addr);

    await submitOne();
    const waiting = await opRow(operation.id);
    expect(waiting.status).toBe('awaiting_payment');
    const inv = invoiceOf(waiting);
    expect(inv?.network).toBe('bsc');
    expect(inv?.payAddress).toMatch(/^0x[0-9a-f]{40}$/i);
    expect(inv?.paymentId).toBeTruthy();
    const view = await body(await u.call('GET', `/v1/app/card-operations/${operation.id}`));
    expect(view.operation.invoice.payAddress).toBe(inv?.payAddress);
    expect(view.relay).toBeNull();

    // No success without provider confirmation: nothing is completed yet.
    expect((await cardRow(card.id)).status).toBe('pending_payment');
    await provider.sandboxConfirm(inv?.paymentId as string);
    await settle();
    expect((await opRow(operation.id)).status).toBe('completed');
    expect((await cardRow(card.id)).status).toBe('issued');
    await syncOneCard();
    const list = await body(await u.call('GET', '/v1/app/cards'));
    expect(list[0].last4).toMatch(/^\d{4}$/);
  });

  test('top-up: only topup.completed completes it (card_id + transaction_id only)', async () => {
    const { u, cardId } = await issued();
    const res = await u.call('POST', `/v1/app/cards/${cardId}/topups`, { amountUsdCents: '2500' });
    expect(res.status).toBe(200);
    const { operation } = await body(res);
    // one open operation per card
    expect((await u.call('POST', `/v1/app/cards/${cardId}/topups`, { amountUsdCents: '2500' })).status).toBe(
      409,
    );
    await submitOne();
    const waiting = await opRow(operation.id);
    const inv = invoiceOf(waiting);
    expect(inv?.network).toBe('tron');
    expect(inv?.payAddress).toMatch(/^T/);
    expect(waiting.status).toBe('awaiting_payment');
    await provider.sandboxConfirm(inv?.paymentId as string);
    await settle();
    expect((await opRow(operation.id)).status).toBe('completed');
  });
});

describe('provider outcomes and the never-resend rule', () => {
  test('topup timeout -> review; reconcile ticks never send a second top-up POST', async () => {
    const { u, cardId } = await issued();
    const { operation } = await body(
      await u.call('POST', `/v1/app/cards/${cardId}/topups`, { amountUsdCents: '1000' }),
    );
    calls.length = 0;
    kit.mock.state.stickyFaults = new Set(['timeout']);
    await submitOne();
    expect(only('/topup').length).toBe(1);
    expect((await opRow(operation.id)).status).toBe('review');
    kit.mock.state.stickyFaults = new Set();
    for (let i = 0; i < 3; i++) await runCardsMaintenance();
    expect(only('/topup').length).toBe(1);
    expect((await opRow(operation.id)).status).toBe('review');
    // Even a forced `created` row with a spent attempt is never claimed (DB-level guard).
    await dbRef.db
      .update(cardOperations)
      .set({ status: 'created' })
      .where(eq(cardOperations.id, operation.id));
    expect(await submitOne()).toBe(false);
    expect(only('/topup').length).toBe(1);
  });

  for (const fault of ['429', '500'] as const) {
    test(`topup ${fault} -> review, not resent`, async () => {
      const { u, cardId } = await issued();
      const { operation } = await body(
        await u.call('POST', `/v1/app/cards/${cardId}/topups`, { amountUsdCents: '1000' }),
      );
      calls.length = 0;
      kit.mock.state.stickyFaults = new Set([fault]);
      await submitOne();
      kit.mock.state.stickyFaults = new Set();
      await submitOne();
      expect(only('/topup').length).toBe(1);
      const op = await opRow(operation.id);
      expect(op.status).toBe('review');
      expect(op.error).toContain('Do not make another payment');
      await getRedis().del(`cards:provider:${providerScope()}:cooldown`);
    });
  }

  test('4xx rejection -> failed', async () => {
    const { u, cardId } = await issued();
    Object.assign(cardSettings, { minTopupCents: 100n });
    try {
      const { operation } = await body(
        await u.call('POST', `/v1/app/cards/${cardId}/topups`, { amountUsdCents: '100' }),
      );
      await submitOne();
      expect((await opRow(operation.id)).status).toBe('failed');
    } finally {
      Object.assign(cardSettings, { minTopupCents: 500n });
    }
  });

  test('issue with a missing invoice -> review (invoice cannot be recovered), card recovered by client_card_ref', async () => {
    const u = await kit.as(kit.newUser());
    kit.mock.state.stickyFaults = new Set(['no-invoice']);
    const { card, operation } = await body(
      await u.call('POST', '/v1/app/cards', {
        product: 'mastercard',
        email: 'a@example.com',
        cardholderName: 'Test Holder',
      }),
    );
    await submitOne();
    expect((await opRow(operation.id)).status).toBe('review');
    expect((await cardRow(card.id)).providerCardId).toBeTruthy();
    // a lost-correlation card is recovered read-only
    await dbRef.db.update(cards).set({ providerCardId: null }).where(eq(cards.id, card.id));
    await recoverUnmatchedCards();
    expect((await cardRow(card.id)).providerCardId).toBeTruthy();
  });
});

describe('limits and guards', () => {
  test('LIVE_WRITES_DISABLED: refused before any provider call, operation failed', async () => {
    const prev = {
      mode: cardSettings.mode,
      liveWrites: cardSettings.liveWrites,
      apiKey: cardSettings.apiKey,
      baseUrl: cardSettings.baseUrl,
    };
    const u = await kit.as(kit.newUser());
    try {
      Object.assign(cardSettings, { mode: 'live', liveWrites: false, apiKey: 'izpk_live_unit', baseUrl: '' });
      // pricing is a cached read; prime it so this test never contacts the real provider
      await getRedis().set(
        `cards:pricing:${providerScope()}`,
        JSON.stringify({ issueFeeUsdCents: '2000', fetchedAt: Date.now() }),
        'EX',
        60,
      );
      calls.length = 0;
      const res = await u.call('POST', '/v1/app/cards', {
        product: 'mastercard',
        email: 'live@example.com',
        cardholderName: 'Test Holder',
      });
      expect(res.status).toBe(409);
      expect((await body(res)).error.code).toBe('LIVE_WRITES_DISABLED');
      expect(calls).toHaveLength(0);
      // a refused issue persists nothing: no card, no operation, no profile
      const ops = await dbRef.db
        .select()
        .from(cardOperations)
        .where(eq(cardOperations.fundingWallet, u.address));
      expect(ops).toHaveLength(0);
      const refusedUser = await dbRef.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.address, u.address));
      const owned = refusedUser[0]
        ? await dbRef.db.select().from(cards).where(eq(cards.userId, refusedUser[0].id))
        : [];
      expect(owned).toHaveLength(0);
      expect(
        refusedUser[0]
          ? await dbRef.db.select().from(cardProfiles).where(eq(cardProfiles.userId, refusedUser[0].id))
          : [],
      ).toHaveLength(0);
      // provider-level guard as well, independent of the service
      await expect(Promise.resolve().then(() => provider.issue('{}', 'k'))).rejects.toMatchObject({
        code: 'LIVE_WRITES_DISABLED',
      });
      expect(() => provider.topup('c1', '{}', 'k')).toThrow();
      expect(calls).toHaveLength(0);
      // reads stay allowed (hits the live origin; answered by a canned response here)
      globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
        calls.push({ method: 'GET', url: String(input) });
        return new Response(JSON.stringify({ success: true, data: { ok: 1 } }), {
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch;
      expect(await provider.pricing()).toEqual({ ok: '1' });
      expect(
        calls[0]?.url.startsWith('https://izipay.me/api/v1/balance') || calls[0]?.url.includes('/balance'),
      ).toBe(true);
    } finally {
      globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        calls.push({ method: init?.method ?? 'GET', url: String(input) });
        return realFetch(input, init);
      }) as typeof fetch;
      Object.assign(cardSettings, prev);
    }
  });

  test('L-5: mock mode refuses a live key and never reaches izipay', async () => {
    const saved = { mode: cardSettings.mode, apiKey: cardSettings.apiKey, baseUrl: cardSettings.baseUrl };
    const realFetch = globalThis.fetch;
    let sent = 0;
    globalThis.fetch = (async () => {
      sent++;
      return new Response('{}');
    }) as unknown as typeof fetch;
    try {
      Object.assign(cardSettings, { mode: 'mock', apiKey: 'izpk_live_x' });
      expect(cardsEnabled()).toBe(false);
      // even with a harmless key, an unset base URL must not fall through to the real API
      Object.assign(cardSettings, { apiKey: 'test-key', baseUrl: '' });
      await expect(provider.pricing()).rejects.toThrow();
      expect(sent).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(cardSettings, saved);
    }
  });

  test('live mode requires an izpk_live_ key', async () => {
    const prev = { mode: cardSettings.mode, apiKey: cardSettings.apiKey };
    try {
      Object.assign(cardSettings, { mode: 'live', apiKey: 'izpk_test_x' });
      const u = await kit.as(kit.newUser());
      expect(
        (
          await u.call('POST', '/v1/app/cards', {
            product: 'mastercard',
            email: 'k@example.com',
            cardholderName: 'Test Holder',
          })
        ).status,
      ).toBe(503);
    } finally {
      Object.assign(cardSettings, prev);
    }
  });

  test('velocity: one unpaid invoice, 3 ops/day, $2,000/day', async () => {
    const u = await kit.as(kit.newUser());
    const first = await u.call('POST', '/v1/app/cards', {
      product: 'mastercard',
      email: 'v@example.com',
      cardholderName: 'Test Holder',
    });
    expect(first.status).toBe(200);
    const second = await u.call('POST', '/v1/app/cards', {
      product: 'mastercard',
      email: 'v@example.com',
      cardholderName: 'Test Holder',
    });
    expect(second.status).toBe(409);
    // daily count
    const w = await kit.as(kit.newUser());
    const [user] = await dbRef.db
      .select()
      .from((await import('../../db/schema')).users)
      .where(eq((await import('../../db/schema')).users.address, w.address));
    const [c] = await dbRef.db
      .insert(cards)
      .values({
        userId: user?.id as string,
        product: 'x',
        status: 'issued',
        providerCardId: `p${Math.random()}`,
      })
      .returning();
    for (let i = 0; i < 3; i++) {
      await dbRef.db.insert(cardOperations).values({
        cardId: c?.id as string,
        userId: user?.id as string,
        kind: 'topup',
        status: 'completed',
        amountUsdCents: 1000n,
      });
    }
    const blocked = await w.call('POST', `/v1/app/cards/${c?.id}/topups`, { amountUsdCents: '1000' });
    expect(blocked.status).toBe(429);
  });

  test('daily USD cap', async () => {
    const { u: w, cardId } = await issued();
    const res = await w.call('POST', `/v1/app/cards/${cardId}/topups`, { amountUsdCents: '250000' });
    expect(res.status).toBe(429);
  });

  test('owner checks: another user gets 404', async () => {
    const { cardId, opId } = await issued();
    const other = await kit.as(kit.newUser());
    expect(
      (await other.call('POST', `/v1/app/cards/${cardId}/topups`, { amountUsdCents: '1000' })).status,
    ).toBe(404);
    expect((await other.call('GET', `/v1/app/card-operations/${opId}`)).status).toBe(404);
    expect((await other.call('POST', `/v1/app/cards/${cardId}/reveal`)).status).toBe(404);
  });

  test('expired invoice -> expired (nothing paid)', async () => {
    const u = await kit.as(kit.newUser());
    const { card, operation } = await body(
      await u.call('POST', '/v1/app/cards', {
        product: 'mastercard',
        email: 'e@example.com',
        cardholderName: 'Test Holder',
      }),
    );
    await submitOne();
    const op = await opRow(operation.id);
    await dbRef.db
      .update(cardOperations)
      .set({ invoice: { ...invoiceOf(op), expiresAt: new Date(Date.now() - 1000).toISOString() } })
      .where(eq(cardOperations.id, op.id));
    await expireInvoices();
    expect((await opRow(op.id)).status).toBe('expired');
    expect((await cardRow(card.id)).status).toBe('failed');
  });
});

describe('webhook route', () => {
  const post = (raw: string, sig?: string) =>
    kit.app.request('/v1/webhooks/izipay', {
      method: 'POST',
      body: raw,
      headers: { 'content-type': 'application/json', ...(sig ? { 'x-izipay-signature': sig } : {}) },
    });
  const sign = (raw: string, secret = HOOK_SECRET) => createHmac('sha256', secret).update(raw).digest('hex');

  test('bad signature -> 401 and nothing stored', async () => {
    const before = (await dbRef.db.select().from(cardWebhookEvents)).length;
    const raw = JSON.stringify({ id: 'evt-bad', type: 'card.issued', data: { card_id: 'x' } });
    expect((await post(raw, sign(raw, 'wrong'))).status).toBe(401);
    expect((await post(raw)).status).toBe(401);
    expect((await dbRef.db.select().from(cardWebhookEvents)).length).toBe(before);
  });

  test('valid signature is stored once (dedupe) with an allowlisted payload; no CSRF needed', async () => {
    const raw = JSON.stringify({
      id: 'evt-ok-1',
      type: 'card.issued',
      data: { card_id: 'nomatch', email: 'leak@example.com' },
    });
    expect(await body(await post(raw, sign(raw)))).toEqual({ received: true });
    await post(raw, sign(raw));
    const rows = (await dbRef.db.select().from(cardWebhookEvents)).filter(
      (r) => r.providerEventId === 'evt-ok-1',
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]?.payload)).not.toContain('leak@example.com');
    // unmatched events are deferred, not lost
    await processOneEvent();
    const after = (await dbRef.db.select().from(cardWebhookEvents)).find(
      (r) => r.providerEventId === 'evt-ok-1',
    );
    expect(after?.processedAt).toBeNull();
  });
});

describe('reveal and Apple Pay', () => {
  test('reveal: fresh-auth only, no-store, PAN/CVV never stored', async () => {
    const { u, cardId } = await issued();
    const res = await u.call('POST', `/v1/app/cards/${cardId}/reveal`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const d = await body(res);
    expect(d.number).toMatch(/^\d{13,19}$/);
    expect(d.cvv).toMatch(/^\d{3,4}$/);
    expect(d.holder).toBeTruthy();
    // nothing sensitive in the card tables
    const dump = JSON.stringify(
      [
        await dbRef.db.select().from(cards),
        await dbRef.db.select().from(cardOperations),
        await dbRef.db.select().from(cardWebhookEvents),
      ],
      (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    );
    expect(dump).not.toContain(d.number);
    // stale session -> re-auth required
    await dbRef.db.update(sessions).set({ freshUntil: new Date(Date.now() - 1000) });
    const again = await u.call('POST', `/v1/app/cards/${cardId}/reveal`);
    expect(again.status).toBe(403);
    expect((await body(again)).error.code).toBe('REAUTH_REQUIRED');
  });

  const otpEvent = (id: string, providerCardId: string | null, code: string, created?: number) =>
    JSON.stringify({
      id,
      type: 'card.otp',
      ...(created === undefined ? {} : { created }),
      data: { card_id: providerCardId, code, kind: 'apple_pay', last4: '4242' },
    });
  const sendHook = (raw: string) =>
    kit.app.request('/v1/webhooks/izipay', {
      method: 'POST',
      body: raw,
      headers: {
        'content-type': 'application/json',
        'x-izipay-signature': createHmac('sha256', HOOK_SECRET).update(raw).digest('hex'),
      },
    });
  const applePay = async (a: Awaited<ReturnType<typeof issued>>) =>
    body(await a.u.call('GET', `/v1/app/cards/${a.cardId}/apple-pay`));
  const nowSec = () => Math.floor(Date.now() / 1000);
  const eid = () => `otp-${Math.random().toString(36).slice(2)}`;

  test('a code delivered without an arm is shown, encrypted in Redis, never in the DB; no provider calls', async () => {
    const a = await issued();
    expect((await applePay(a)).status).toBe('idle');
    calls.length = 0;
    const pcid = (await cardRow(a.cardId)).providerCardId as string;
    expect((await sendHook(otpEvent(eid(), pcid, '482913', nowSec()))).status).toBe(200);
    const got = await applePay(a);
    expect(got.status).toBe('delivered');
    expect(got.code).toBe('482913');
    expect(got.expiresInSec).toBeGreaterThan(595);
    expect(got.expiresInSec).toBeLessThanOrEqual(600);
    const stored = await getRedis().get(`cards:applepay:code:${providerScope()}:${a.cardId}`);
    expect(stored).not.toContain('482913');
    expect(JSON.stringify(await dbRef.db.select().from(cardWebhookEvents))).not.toContain('482913');
    expect(only('apple-pay-code')).toHaveLength(0);
    // arming is only a waiting window and never reaches izipay
    const b = await issued();
    const armed = await body(await b.u.call('POST', `/v1/app/cards/${b.cardId}/apple-pay`));
    expect(armed.status).toBe('waiting');
    expect(armed.expiresInSec).toBeGreaterThan(595);
    expect(only('apple-pay-code')).toHaveLength(0);
  });

  test('TTL is anchored to the event time', async () => {
    const a = await issued();
    const pcid = (await cardRow(a.cardId)).providerCardId as string;
    await sendHook(otpEvent(eid(), pcid, '111222', nowSec() - 300));
    const got = await applePay(a);
    expect(got.expiresInSec).toBeGreaterThan(290);
    expect(got.expiresInSec).toBeLessThanOrEqual(300);
    const ttl = await getRedis().ttl(`cards:applepay:code:${providerScope()}:${a.cardId}`);
    expect(ttl).toBeGreaterThan(290);
    expect(ttl).toBeLessThanOrEqual(301);
    // a future event time never extends the lifetime
    const b = await issued();
    await sendHook(
      otpEvent(eid(), (await cardRow(b.cardId)).providerCardId as string, '333444', nowSec() + 3600),
    );
    expect((await applePay(b)).expiresInSec).toBeLessThanOrEqual(600);
  });

  test('a stale code is rejected', async () => {
    const a = await issued();
    const pcid = (await cardRow(a.cardId)).providerCardId as string;
    expect((await sendHook(otpEvent(eid(), pcid, '555666', nowSec() - 700))).status).toBe(200);
    expect((await applePay(a)).status).toBe('idle');
    expect(await getRedis().get(`cards:applepay:code:${providerScope()}:${a.cardId}`)).toBeNull();
  });

  test('an older retried event never overwrites a newer code', async () => {
    const a = await issued();
    const pcid = (await cardRow(a.cardId)).providerCardId as string;
    await sendHook(otpEvent(eid(), pcid, '200200', nowSec() - 5));
    await sendHook(otpEvent(eid(), pcid, '100100', nowSec() - 60));
    expect((await applePay(a)).code).toBe('200200');
    await sendHook(otpEvent(eid(), pcid, '300300', nowSec()));
    expect((await applePay(a)).code).toBe('300300');
  });

  test('duplicate event id: same payload is a no-op, different payload is 409', async () => {
    const a = await issued();
    const pcid = (await cardRow(a.cardId)).providerCardId as string;
    const id = eid();
    const created = nowSec() - 2;
    expect((await sendHook(otpEvent(id, pcid, '777888', created))).status).toBe(200);
    expect((await sendHook(otpEvent(id, pcid, '777888', created))).status).toBe(200);
    expect(
      (await dbRef.db.select().from(cardWebhookEvents)).filter((e) => e.providerEventId === id),
    ).toHaveLength(1);
    const clash = await sendHook(otpEvent(id, pcid, '999000', created));
    expect(clash.status).toBe(409);
    expect((await applePay(a)).code).toBe('777888');
    const row = (await dbRef.db.select().from(cardWebhookEvents)).find((e) => e.providerEventId === id);
    expect(row?.providerScope).toBe(providerScope());
    expect(row?.eventAt?.getTime()).toBe(created * 1000);
  });

  test('a card id from another provider scope is ignored', async () => {
    const a = await issued();
    await dbRef.db.update(cards).set({ providerScope: 'izipay:live:other' }).where(eq(cards.id, a.cardId));
    const pcid = (await cardRow(a.cardId)).providerCardId as string;
    expect((await sendHook(otpEvent(eid(), pcid, '121212', nowSec()))).status).toBe(200);
    expect((await applePay(a)).status).toBe('idle');
    // an unknown card id is acknowledged and ignored too
    expect((await sendHook(otpEvent(eid(), 'nope', '121212', nowSec()))).status).toBe(200);
  });

  test('two cards hold their codes independently', async () => {
    const a = await issued();
    const b = await issued();
    await sendHook(otpEvent(eid(), (await cardRow(a.cardId)).providerCardId as string, '111111', nowSec()));
    expect((await applePay(b)).status).toBe('idle');
    await sendHook(otpEvent(eid(), (await cardRow(b.cardId)).providerCardId as string, '222222', nowSec()));
    expect((await applePay(a)).code).toBe('111111');
    expect((await applePay(b)).code).toBe('222222');
  });

  test('only an issued mastercard owned by the caller can read or arm', async () => {
    const a = await issued();
    const other = await kit.as(kit.newUser());
    expect((await other.call('GET', `/v1/app/cards/${a.cardId}/apple-pay`)).status).toBe(404);
    await dbRef.db.update(cards).set({ product: 'visa' }).where(eq(cards.id, a.cardId));
    expect((await a.u.call('GET', `/v1/app/cards/${a.cardId}/apple-pay`)).status).toBe(409);
  });
});

describe('review-gate fixes', () => {
  const hook = (raw: string) =>
    kit.app.request('/v1/webhooks/izipay', {
      method: 'POST',
      body: raw,
      headers: {
        'content-type': 'application/json',
        'x-izipay-signature': createHmac('sha256', HOOK_SECRET).update(raw).digest('hex'),
      },
    });

  test('replayed topup.completed transaction_id never completes another top-up', async () => {
    const { u, cardId } = await issued();
    const a = await body(await u.call('POST', `/v1/app/cards/${cardId}/topups`, { amountUsdCents: '1000' }));
    await submitOne();
    await provider.sandboxConfirm(invoiceOf(await opRow(a.operation.id))?.paymentId as string);
    await settle();
    const doneA = await opRow(a.operation.id);
    expect(doneA.status).toBe('completed');
    expect(doneA.providerTxnId).toBeTruthy();
    const b = await body(await u.call('POST', `/v1/app/cards/${cardId}/topups`, { amountUsdCents: '1000' }));
    // identical signed requests within one second trip the replay guard (safely retried), so space them out
    await new Promise((r) => setTimeout(r, 1100));
    await submitOne();
    expect((await opRow(b.operation.id)).status).toBe('awaiting_payment');
    const providerCardId = (await cardRow(cardId)).providerCardId;
    await hook(
      JSON.stringify({
        id: 'replay-1',
        type: 'topup.completed',
        data: { card_id: providerCardId, transaction_id: doneA.providerTxnId },
      }),
    );
    await settle();
    expect((await opRow(b.operation.id)).status).toBe('awaiting_payment');
    const ev = (await dbRef.db.select().from(cardWebhookEvents)).find(
      (e) => e.providerEventId === 'replay-1',
    );
    expect(ev?.error).toBe('duplicate transaction_id');
    // an id-less completion is never guessed onto the open top-up
    await hook(
      JSON.stringify({ id: 'replay-2', type: 'topup.completed', data: { card_id: providerCardId } }),
    );
    await settle();
    expect((await opRow(b.operation.id)).status).toBe('awaiting_payment');
  });

  test('processing past invoice expiry + grace goes to review, never completed or failed', async () => {
    const { u, cardId } = await issued();
    const t = await body(await u.call('POST', `/v1/app/cards/${cardId}/topups`, { amountUsdCents: '1000' }));
    await submitOne();
    const op = await opRow(t.operation.id);
    const old = new Date(Date.now() - 31 * 60_000).toISOString();
    await dbRef.db
      .update(cardOperations)
      .set({ status: 'processing', invoice: { ...invoiceOf(op), expiresAt: old } })
      .where(eq(cardOperations.id, op.id));
    await expireInvoices();
    expect((await opRow(op.id)).status).toBe('review');
    // within grace it stays processing
    const t2Card = await issued();
    const t2 = await body(
      await t2Card.u.call('POST', `/v1/app/cards/${t2Card.cardId}/topups`, { amountUsdCents: '1000' }),
    );
    await submitOne();
    const op2 = await opRow(t2.operation.id);
    await dbRef.db
      .update(cardOperations)
      .set({
        status: 'processing',
        invoice: { ...invoiceOf(op2), expiresAt: new Date(Date.now() - 60_000).toISOString() },
      })
      .where(eq(cardOperations.id, op2.id));
    await expireInvoices();
    expect((await opRow(op2.id)).status).toBe('processing');
  });

  test('input validation: email, cardholder name, finish, product', async () => {
    const u = await kit.as(kit.newUser());
    const bad = (b: object) =>
      u.call('POST', '/v1/app/cards', {
        product: 'mastercard',
        email: 'v@example.com',
        cardholderName: 'Val Holder',
        ...b,
      });
    expect((await bad({ email: `${'a'.repeat(250)}@example.com` })).status).toBe(400);
    expect((await bad({ email: 'not-an-email' })).status).toBe(400);
    expect((await bad({ cardholderName: 'x'.repeat(65) })).status).toBe(400);
    // the cardholder name is required and must look like a name
    expect((await bad({ cardholderName: undefined })).status).toBe(400);
    expect((await bad({ cardholderName: '   ' })).status).toBe(400);
    expect((await bad({ cardholderName: 'A' })).status).toBe(400);
    expect((await bad({ cardholderName: '12345' })).status).toBe(400);
    expect((await bad({ finish: 'bad finish!' })).status).toBe(400);
    expect((await bad({ product: 'visa' })).status).toBe(400);
  });

  test('issue operation snapshots its profile, so cards never cross emails', async () => {
    const { opId } = await issued();
    const op = await opRow(opId);
    const profileId = (op.invoice as { profileId?: string }).profileId;
    expect(profileId).toBeTruthy();
    expect(
      (
        await dbRef.db
          .select()
          .from(cardProfiles)
          .where(eq(cardProfiles.id, profileId as string))
      ).length,
    ).toBe(1);
  });
});
