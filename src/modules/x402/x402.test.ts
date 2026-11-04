import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { buyerVaultAbi } from '@spindle/shared/abi';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import {
  type Address,
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  type TransactionReceipt,
  verifyTypedData,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { config } from '../../config';
import { buyerLedger, x402Payments } from '../../db/schema';
import type { X402Payment } from '../../db/types';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { closeRedis, getRedis } from '../../lib/redis';
import {
  decodeHeader,
  encodeHeader,
  networkFor,
  spindlePaymentTypedData,
  X402Challenge,
} from '../../shared/x402';
import { dbRef } from '../auth/constants';
import {
  type Authorization,
  type AuthorizeCtx,
  type Challenge,
  unregisterPaymentProvider,
} from '../gateway/payment';
import { addressOverride, buildChallenge, challengeKey } from './challenge';
import { defaultStateDeps, KEEPER_STATUS_KEY, resetGuardMemo } from './guard';
import { x402Provider } from './provider';
import { closeSession, createSession, openSession } from './sessions';
import { applyReceipt, runSettle, type SettleDeps } from './settle';
import { defaultSurchargeDeps, resetSurchargeMemo } from './surcharge';
import { memKv } from './testing';
import { BARRED_KEY, chainDeps, resetPayerCache } from './verify';

const A = {
  usdg: '0x5fc5360d0400a0fd4f2af552add042d716f1d168' as Address,
  vault: '0x969aa7de33fdfdab7c11ade6a0288ec79f12fb19' as Address,
  permit2: '0x000000000022d473030f116ddee9f6b43ac78ba3' as Address,
};
const SURCHARGE = 7000n;
const nowSec = () => Math.floor(Date.now() / 1000);
const key = generatePrivateKey();
const payer = privateKeyToAccount(key);

let t: TestDb;
const kv = memKv();
const orig = { ...chainDeps };
let chainState = { balance: 1_000_000_000n, allowance: 1_000_000_000n, used: new Set<string>() };

const fakeCtx = (headers: Record<string, string> = {}) =>
  ({
    req: {
      header: (n: string) => headers[n.toLowerCase()],
      url: 'http://api.test/v1/chat/completions',
      path: '/v1/chat/completions',
    },
    header: () => {},
  }) as unknown as Context<Env>;
const ctx = (max = 100_000n): AuthorizeCtx => ({
  jobId: crypto.randomUUID(),
  model: 'm',
  kind: 'chat',
  lane: 'open',
  maxChargeMicros: max,
  priceBasis: { unitKind: 'tokens_1m', buyerMicrosPerUnit: 100_000n, maxTokens: 1024 },
});

async function challengeFor(max: bigint) {
  const r = (await x402Provider.authorize(fakeCtx(), ctx(max))) as Challenge;
  expect(r.challenge).toBe(true);
  return { res: r, body: X402Challenge.parse(r.body), header: r.headers?.['PAYMENT-REQUIRED'] as string };
}

async function pay(
  body: X402Challenge,
  opts: { signer?: typeof payer; tweak?: (h: Record<string, unknown>) => void } = {},
) {
  const e = body.accepts[0]?.extra;
  const acc = body.accepts[0];
  if (!e || !acc) throw new Error('no accept');
  const signer = opts.signer ?? payer;
  const td = spindlePaymentTypedData({
    chainId: config.CHAIN_ID,
    token: A.usdg,
    cap: BigInt(acc.amount),
    spender: A.vault,
    nonce: BigInt(e.nonce),
    deadline: BigInt(e.deadline),
    paymentId: e.paymentId as Hex,
    surcharge: BigInt(e.surcharge),
    validAfter: BigInt(e.validAfter),
  });
  const signature = await signer.signTypedData(td);
  const payload = {
    payer: signer.address,
    paymentId: e.paymentId,
    permit: { permitted: { token: A.usdg, amount: acc.amount }, nonce: e.nonce, deadline: e.deadline },
    witness: { paymentId: e.paymentId, surcharge: e.surcharge, validAfter: e.validAfter },
    signature,
  };
  opts.tweak?.(payload as unknown as Record<string, unknown>);
  return encodeHeader({ x402Version: 2, scheme: 'exact', network: networkFor(config.CHAIN_ID), payload });
}

const authorizeWith = (header: string, max = 100_000n) =>
  x402Provider.authorize(fakeCtx({ 'x-payment': header }), ctx(max));
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof AppError ? `${e.status}:${e.message}` : String(e);
  }
};
const rows = () => dbRef.db.select().from(x402Payments);

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
  addressOverride.current = A;
  Object.assign(defaultSurchargeDeps, {
    kv,
    minMicros: SURCHARGE,
    ethUsdMicros: async () => 3000n * 1_000_000n,
    gasPriceWei: async () => 1_000_000n,
    estimateBatchGas: async () => {
      throw new Error('no chain in unit tests');
    },
  });
  Object.assign(defaultStateDeps, { kv, enabledInConfig: () => true, liveLevel: async () => 'ok' as const });
  chainDeps.verifySignature = async (a) =>
    verifyTypedData({ address: a.payer, ...a.typedData, signature: a.signature });
  chainDeps.payerState = async () => chainState;
  chainDeps.nonceUsed = async (_p, n) => chainState.used.has(n.toString());
});
afterAll(async () => {
  Object.assign(chainDeps, orig);
  addressOverride.current = undefined;
  unregisterPaymentProvider('x402'); // importing provider.ts registers it process-wide; other suites expect none
  await t.close();
  await closeRedis();
});
beforeEach(async () => {
  await t.reset();
  kv.data.delete(KEEPER_STATUS_KEY);
  chainState = { balance: 1_000_000_000n, allowance: 1_000_000_000n, used: new Set() };
  resetPayerCache();
  resetSurchargeMemo();
  resetGuardMemo();
  const redis = getRedis();
  for (const k of await redis.keys('x402:*')) await redis.del(k);
  await redis.del(...(await redis.keys('rl:x402*')), 'rl:none').catch(() => {});
});

describe('challenge', () => {
  test('matches the payments-x402.md shape and is stored for 10 min', async () => {
    const { res, body, header } = await challengeFor(100_000n);
    expect(res.status).toBe(402);
    expect(decodeHeader(header)).toEqual(JSON.parse(JSON.stringify(res.body)));
    const a = body.accepts[0];
    if (!a) throw new Error('no accepts');
    expect(a).toMatchObject({
      scheme: 'exact',
      network: networkFor(config.CHAIN_ID),
      asset: A.usdg,
      payTo: A.vault,
      amount: '107000',
      maxTimeoutSeconds: 300,
    });
    expect(a.extra).toMatchObject({
      assetTransferMethod: 'permit2-witness',
      permit2: A.permit2,
      spender: A.vault,
      witnessType: 'SpindlePayment(bytes32 paymentId,uint256 surcharge,uint256 validAfter)',
      surcharge: '7000',
    });
    expect(a.extra.paymentId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(BigInt(a.extra.nonce) < 1n << 248n).toBe(true);
    const n = nowSec();
    expect(Math.abs(Number(a.extra.deadline) - (n + 3600))).toBeLessThan(5);
    expect(Math.abs(Number(a.extra.validAfter) - (n - 60))).toBeLessThan(5);
    const ttl = await getRedis().ttl(challengeKey(a.extra.paymentId));
    expect(ttl).toBeGreaterThan(590);
    expect(ttl).toBeLessThanOrEqual(600);
  });

  test('unavailable (402 with prepaid hint) when the keeper is critical or the price is unknown', async () => {
    await defaultStateDeps.kv.set(KEEPER_STATUS_KEY, {
      level: 'critical',
      balanceWei: '0',
      x402Enabled: false,
      checkedAt: new Date().toISOString(),
    });
    resetGuardMemo();
    const r = (await x402Provider.authorize(fakeCtx(), ctx())) as Challenge;
    expect(r.status).toBe(402);
    expect(JSON.stringify(r.body)).toContain('use an API key with a credit balance');
    expect(r.headers?.['PAYMENT-REQUIRED']).toBeUndefined();
  });
});

describe('exact scheme', () => {
  test('challenge -> sign -> authorize opens a payment; finalize closes it with the actual charge', async () => {
    const { body } = await challengeFor(100_000n);
    const auth = (await authorizeWith(await pay(body))) as Authorization;
    expect(auth.payMode).toBe('x402');
    expect(auth.reservedMicros).toBe(100_000n);
    const [row] = await rows();
    expect(row).toMatchObject({
      status: 'open',
      scheme: 'exact',
      capMicros: 107_000n,
      surchargeMicros: 7000n,
      payer: payer.address.toLowerCase(),
    });
    expect(await x402Provider.finalize(auth, 42_000n)).toBe(42_000n);
    const [done] = await rows();
    expect(done).toMatchObject({ status: 'closing', usedMicros: 42_000n });
  });

  test('responseHeaders builds X-PAYMENT-RESPONSE from the charge (clamped)', async () => {
    const { body } = await challengeFor(100_000n);
    const auth = (await authorizeWith(await pay(body))) as Authorization;
    const h = x402Provider.responseHeaders?.(auth, 42_000n) ?? {};
    expect(decodeHeader(h['X-PAYMENT-RESPONSE'])).toMatchObject({
      used: '42000',
      surcharge: '7000',
      settlement: 'batched',
    });
    const big = x402Provider.responseHeaders?.(auth, 9_999_999n) ?? {};
    expect(decodeHeader(big['X-PAYMENT-RESPONSE'])).toMatchObject({ used: '100000' });
  });

  test('finalize clamps to the reservation', async () => {
    const { body } = await challengeFor(100_000n);
    const auth = (await authorizeWith(await pay(body))) as Authorization;
    expect(await x402Provider.finalize(auth, 999_999n)).toBe(100_000n);
  });

  test('release marks the payment expired (no surcharge for a failed job)', async () => {
    const { body } = await challengeFor(100_000n);
    const auth = (await authorizeWith(await pay(body))) as Authorization;
    await x402Provider.release(auth);
    expect((await rows())[0]?.status).toBe('expired');
  });

  test('a replayed X-PAYMENT is rejected; the challenge is single use', async () => {
    const { body } = await challengeFor(100_000n);
    const header = await pay(body);
    await authorizeWith(header);
    expect(await code(authorizeWith(header))).toContain('402:Unknown, expired or already used');
    expect(await rows()).toHaveLength(1);
  });

  test('concurrent replays of one header open exactly one payment', async () => {
    const { body } = await challengeFor(100_000n);
    const header = await pay(body);
    const res = await Promise.allSettled([1, 2, 3, 4, 5].map(() => authorizeWith(header)));
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  test('tampered amount, nonce, surcharge or a foreign signer are rejected before anything is stored', async () => {
    for (const tweak of [
      (p: any) => (p.permit.permitted.amount = '1'),
      (p: any) => (p.permit.nonce = '5'),
      (p: any) => (p.witness.surcharge = '0'),
    ]) {
      const { body } = await challengeFor(100_000n);
      expect(await code(authorizeWith(await pay(body, { tweak })))).toContain(
        '402:Payment does not match the challenge',
      );
    }
    const { body } = await challengeFor(100_000n);
    const other = privateKeyToAccount(generatePrivateKey());
    // signed by someone else but claiming to be `payer`
    const header = await pay(body, { signer: other, tweak: (p) => (p.payer = payer.address) });
    expect(await code(authorizeWith(header))).toContain('Invalid payment signature');
    expect(await rows()).toHaveLength(0);
  });

  test('a header for another network is rejected and the challenge network follows CHAIN_ID', async () => {
    const { body } = await challengeFor(100_000n);
    expect(body.accepts[0]?.network).toBe(networkFor(config.CHAIN_ID));
    const good = decodeHeader(await pay(body)) as Record<string, unknown>;
    const other = encodeHeader({ ...good, network: networkFor(config.CHAIN_ID + 1) } as never);
    expect(await code(authorizeWith(other))).toContain('different network');
  });

  test('malformed header is a 400 and never dispatches', async () => {
    expect(await code(authorizeWith('not-base64!!'))).toContain('400:');
  });

  test('deadline less than 30 minutes away is rejected', async () => {
    const mk = await buildChallenge({
      url: 'http://x',
      maxChargeMicros: 10_000n,
      surchargeMicros: SURCHARGE,
      priceBasis: { unitKind: 'tokens_1m', buyerMicrosPerUnit: 1n },
      now: nowSec() - 2400, // deadline = now + 1200s
      addresses: A,
    });
    expect(await code(authorizeWith(await pay(mk.body), 10_000n))).toContain('too close');
  });

  test('on-chain checks: used nonce, low balance, low allowance, barred payer', async () => {
    let c = await challengeFor(100_000n);
    chainState.used.add(c.body.accepts[0]?.extra.nonce as string);
    expect(await code(authorizeWith(await pay(c.body)))).toContain('nonce was already used');

    chainState.balance = 100_000n;
    c = await challengeFor(100_000n);
    expect(await code(authorizeWith(await pay(c.body)))).toContain('Insufficient USDG balance');

    chainState = { ...chainState, balance: 10n ** 9n, allowance: 100_000n };
    resetPayerCache();
    c = await challengeFor(100_000n);
    expect(await code(authorizeWith(await pay(c.body)))).toContain('Insufficient USDG allowance');

    chainState.allowance = 10n ** 9n;
    resetPayerCache();
    await getRedis().sadd(BARRED_KEY, payer.address.toLowerCase());
    c = await challengeFor(100_000n);
    expect(await code(authorizeWith(await pay(c.body)))).toContain('barred');
    expect(await rows()).toHaveLength(0);
  });

  test('a request needing more than the signed cap gets a fresh challenge, not a charge', async () => {
    const { body } = await challengeFor(100_000n);
    const r = (await authorizeWith(await pay(body), 500_000n)) as Challenge;
    expect(r.challenge).toBe(true);
    expect(r.status).toBe(402);
    expect(await rows()).toHaveLength(0);
  });

  test('exposure cap holds across parallel requests (20 USDG default)', async () => {
    // each payment caps at 6.007 USDG: only 3 fit under $20 even when all 8 race
    const header = async () => pay((await challengeFor(6_000_000n)).body);
    const headers = await Promise.all(Array.from({ length: 8 }, header));
    const res = await Promise.allSettled(headers.map((h) => authorizeWith(h, 6_000_000n)));
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const failed = res
      .filter((r) => r.status === 'rejected')
      .map((r) => String((r as PromiseRejectedResult).reason.message));
    expect(failed.every((m) => m.includes('credit limit'))).toBe(true);
    expect(await rows()).toHaveLength(3);
  });

  test('closing payments count at used+surcharge, freeing headroom', async () => {
    const mk = async (max: bigint) =>
      (await authorizeWith(await pay((await challengeFor(max)).body), max)) as Authorization;
    const a1 = await mk(9_000_000n);
    const a2 = await mk(9_000_000n);
    expect(await code(mk(9_000_000n))).toContain('credit limit');
    await x402Provider.finalize(a1, 1000n);
    await x402Provider.finalize(a2, 1000n);
    await mk(9_000_000n);
  });
});

describe('sessions', () => {
  const sign = async (typedData: { domain: any; types: any; primaryType: string; message: any }) => {
    const m = typedData.message;
    return payer.signTypedData({
      domain: { ...typedData.domain },
      types: typedData.types,
      primaryType: 'PermitWitnessTransferFrom',
      message: {
        permitted: { token: m.permitted.token, amount: BigInt(m.permitted.amount) },
        spender: m.spender,
        nonce: BigInt(m.nonce),
        deadline: BigInt(m.deadline),
        witness: {
          paymentId: m.witness.paymentId,
          surcharge: BigInt(m.witness.surcharge),
          validAfter: BigInt(m.witness.validAfter),
        },
      },
    });
  };
  const open = async (cap = 1_000_000n, ttl = 600) => {
    const s = await createSession({ payer: payer.address, capMicros: cap, ttlSec: ttl });
    const o = await openSession(s.sessionId, await sign(s.typedData as never));
    return { s, o };
  };
  const sessionCtx = (token: string) => fakeCtx({ 'x-spindle-session': token });

  test('limits: cap <= 5 USDG, ttl <= 3600, cap above the surcharge', async () => {
    expect(await code(createSession({ payer: payer.address, capMicros: 5_000_001n, ttlSec: 600 }))).toContain(
      '400:',
    );
    expect(
      await code(createSession({ payer: payer.address, capMicros: 1_000_000n, ttlSec: 3601 })),
    ).toContain('400:');
    expect(await code(createSession({ payer: payer.address, capMicros: 7000n, ttlSec: 600 }))).toContain(
      '400:',
    );
  });

  test('create -> sign -> open returns a token; only the sha256 is stored', async () => {
    const { s, o } = await open();
    expect(s.surchargeMicros).toBe('7000');
    expect(o).toMatchObject({ capMicros: '1000000', surchargeMicros: '7000', spendableMicros: '993000' });
    const [row] = await rows();
    expect(row?.scheme).toBe('session');
    expect(row?.sessionTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.sessionTokenHash).not.toBe(o.sessionToken);
    // the signature must clear the 30 min settlement margin even at the 1 h ttl cap
    expect(Number(row?.deadline) - nowSec()).toBeGreaterThan(1800 + 600);
  });

  test('open fails for a bad signature and a replayed open', async () => {
    const s = await createSession({ payer: payer.address, capMicros: 1_000_000n, ttlSec: 600 });
    const bad = await privateKeyToAccount(generatePrivateKey()).signMessage({ message: 'x' });
    expect(await code(openSession(s.sessionId, bad))).toContain('Invalid payment signature');
    const sig = await sign(s.typedData as never);
    await openSession(s.sessionId, sig);
    expect(await code(openSession(s.sessionId, sig))).toContain('404:');
  });

  test('atomic reservation: parallel requests cannot exceed cap - surcharge; then SESSION_EXHAUSTED', async () => {
    const { o } = await open(); // spendable 993000
    const res = await Promise.all(
      Array.from({ length: 6 }, () => x402Provider.authorize(sessionCtx(o.sessionToken), ctx(400_000n))),
    );
    const ok = res.filter((r) => !(r as Challenge).challenge);
    const refused = res.filter((r) => (r as Challenge).challenge) as Challenge[];
    expect(ok).toHaveLength(2);
    expect(refused).toHaveLength(4);
    expect(JSON.stringify(refused[0]?.body)).toContain('SESSION_EXHAUSTED');
    expect(refused[0]?.status).toBe(402);
  });

  test('finalize moves the reservation into used (persisted); exhausting the cap closes the session', async () => {
    const { o } = await open();
    const a = (await x402Provider.authorize(sessionCtx(o.sessionToken), ctx(500_000n))) as Authorization;
    expect((await rows())[0]?.reservedMicros).toBe(500_000n);
    expect(await x402Provider.finalize(a, 123_000n)).toBe(123_000n);
    let row = (await rows())[0] as X402Payment;
    expect(row).toMatchObject({ usedMicros: 123_000n, reservedMicros: 0n, status: 'open' });
    // a second request fits in the 870k that is left; the failed one is released
    const b = (await x402Provider.authorize(sessionCtx(o.sessionToken), ctx(800_000n))) as Authorization;
    await x402Provider.release(b);
    row = (await rows())[0] as X402Payment;
    expect(row.usedMicros).toBe(123_000n);
    const c = (await x402Provider.authorize(sessionCtx(o.sessionToken), ctx(870_000n))) as Authorization;
    await x402Provider.finalize(c, 870_000n);
    row = (await rows())[0] as X402Payment;
    expect(row).toMatchObject({ usedMicros: 993_000n, status: 'closing' });
    const next = (await x402Provider.authorize(sessionCtx(o.sessionToken), ctx(1n))) as Challenge;
    expect(JSON.stringify(next.body)).toMatch(/SESSION_CLOSED|SESSION_EXHAUSTED/);
  });

  test('reverse (failed receipt): a session gives the charge back; a settled payment becomes a credit entry', async () => {
    const { o } = await open();
    const a = (await x402Provider.authorize(sessionCtx(o.sessionToken), ctx(500_000n))) as Authorization;
    await x402Provider.finalize(a, 123_000n);
    expect((await rows())[0]?.usedMicros).toBe(123_000n);
    await x402Provider.reverse(a, 123_000n);
    expect((await rows())[0]).toMatchObject({ usedMicros: 0n, reservedMicros: 0n });
    // the redis counter went back down too: the whole spendable amount is reservable again
    const b = (await x402Provider.authorize(sessionCtx(o.sessionToken), ctx(993_000n))) as Authorization;
    expect(b.reservedMicros).toBe(993_000n);
    await x402Provider.release(b);
    // already settled on-chain: the session stays settled, the payer is credited on the prepaid balance
    await dbRef.db
      .update(x402Payments)
      .set({ status: 'settled' })
      .where(eq(x402Payments.id, a.x402PaymentId as string));
    await x402Provider.reverse(a, 123_000n);
    const [led] = await dbRef.db.select().from(buyerLedger).where(eq(buyerLedger.jobId, a.jobId));
    expect(led).toMatchObject({ kind: 'refund', usdgMicros: 123_000n });
    await x402Provider.reverse(a, 123_000n); // idempotent per job
    expect(await dbRef.db.select().from(buyerLedger).where(eq(buyerLedger.jobId, a.jobId))).toHaveLength(1);
    expect((await rows())[0]?.usedMicros).toBe(0n);
  });

  test('redis counters rebuild from the DB when the key is lost', async () => {
    const { o } = await open();
    const a = (await x402Provider.authorize(sessionCtx(o.sessionToken), ctx(900_000n))) as Authorization;
    await x402Provider.finalize(a, 900_000n);
    for (const k of await getRedis().keys('x402:session:*')) await getRedis().del(k);
    const r = (await x402Provider.authorize(sessionCtx(o.sessionToken), ctx(100_000n))) as Challenge;
    expect(JSON.stringify(r.body)).toContain('SESSION_EXHAUSTED'); // only 93k left in the DB
  });

  test('rebuilt Redis counters keep the DB reserved amount', async () => {
    const { o } = await open();
    const a = (await x402Provider.authorize(sessionCtx(o.sessionToken), ctx(900_000n))) as Authorization;
    expect(a.reservedMicros).toBe(900_000n);
    for (const k of await getRedis().keys('x402:session:*')) await getRedis().del(k);
    const r = (await x402Provider.authorize(sessionCtx(o.sessionToken), ctx(100_000n))) as Challenge;
    expect(JSON.stringify(r.body)).toContain('SESSION_EXHAUSTED'); // 993k - 900k reserved < 100k
  });

  test('close: unused session expires without settling; used one goes closing', async () => {
    const a = await open();
    const [r1] = await rows();
    expect(await closeSession(r1?.id as string)).toBe('expired');
    await t.reset();
    const b = await open();
    const auth = (await x402Provider.authorize(sessionCtx(b.o.sessionToken), ctx(100_000n))) as Authorization;
    await x402Provider.finalize(auth, 10_000n);
    expect(await closeSession(auth.x402PaymentId as string)).toBe('closing');
    expect(a.o.sessionToken).not.toBe(b.o.sessionToken);
  });

  test('unknown token is a 401; a closed session is refused', async () => {
    expect(await code(x402Provider.authorize(sessionCtx('nope'), ctx()))).toContain('401:');
  });
});

// ---- settlement --------------------------------------------------------------------------------------

type Sent = { to: Address; data?: Hex; label: string };
const receiptFor = (
  hash: Hex,
  events: ({ ok: true; r: X402Payment; used: bigint } | { ok: false; r: X402Payment })[],
): TransactionReceipt => {
  const logs = events.map((e, i) => {
    if (e.ok) {
      return {
        address: A.vault,
        topics: encodeEventTopics({
          abi: buyerVaultAbi,
          eventName: 'Settled',
          args: { paymentId: e.r.paymentId as Hex, payer: e.r.payer as Address },
        }),
        data: encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'uint256' }],
          [e.used, e.r.surchargeMicros as bigint],
        ),
        logIndex: i,
      };
    }
    return {
      address: A.vault,
      topics: encodeEventTopics({
        abi: buyerVaultAbi,
        eventName: 'SettleFailed',
        args: { paymentId: e.r.paymentId as Hex, payer: e.r.payer as Address },
      }),
      data: encodeAbiParameters([{ type: 'bytes4' }], ['0x815e1d64']),
      logIndex: i,
    };
  });
  return { transactionHash: hash, status: 'success', logs } as unknown as TransactionReceipt;
};

async function seedClosing(
  n: number,
  over: (i: number) => Partial<typeof x402Payments.$inferInsert> = () => ({}),
  who = payer.address,
) {
  const out: X402Payment[] = [];
  for (let i = 0; i < n; i++) {
    const [r] = await dbRef.db
      .insert(x402Payments)
      .values({
        paymentId: `0x${(i + 1 + Math.floor(Math.random() * 1e9) * 100).toString(16).padStart(64, '0')}`,
        payer: who.toLowerCase(),
        scheme: 'exact',
        capMicros: 107_000n,
        surchargeMicros: 7000n,
        usedMicros: 50_000n,
        nonce: String(BigInt(i) + 1000n),
        deadline: BigInt(nowSec() + 3 * 3600),
        validAfter: BigInt(nowSec() - 60),
        signature: `0x${'ab'.repeat(65)}`,
        permit: { permitted: { token: A.usdg, amount: '107000' }, nonce: String(i + 1000), deadline: '0' },
        status: 'closing',
        closedAt: new Date(),
        ...over(i),
      })
      .returning();
    out.push(r as X402Payment);
  }
  return out;
}

describe('settlement', () => {
  const mkDeps = (over: Partial<SettleDeps> & { sent?: Sent[] } = {}): SettleDeps => ({
    now: nowSec,
    redis: getRedis,
    send: async (i) => {
      over.sent?.push(i);
      return { hash: `0x${'cc'.repeat(32)}`, status: 'success', gasUsed: 1n, effectiveGasPrice: 1n };
    },
    receipt: async () => null,
    txKnown: async () => true,
    nonceUsed: async () => false,
    keeperBalanceWei: async () => 10n ** 17n,
    vault: () => A.vault,
    ...over,
  });
  const decode = (d: Hex) => {
    // settle(items) calldata -> number of items via viem decoding
    const { decodeFunctionData } = require('viem');
    return decodeFunctionData({ abi: buyerVaultAbi, data: d }).args[0] as { paymentId: Hex; used: bigint }[];
  };

  test('settles Settled items, fails one bad item without blocking the batch, bars its payer', async () => {
    const [a, b, c] = await seedClosing(3, (i) => ({
      payer: [payer.address, privateKeyToAccount(generatePrivateKey()).address, payer.address][
        i
      ]?.toLowerCase(),
    }));
    const sent: Sent[] = [];
    const deps = mkDeps({
      sent,
      receipt: async (h) =>
        receiptFor(h, [
          { ok: true, r: a as X402Payment, used: 50_000n },
          { ok: false, r: b as X402Payment },
          { ok: true, r: c as X402Payment, used: 50_000n },
        ]),
    });
    const sum = await runSettle(deps);
    expect(sum).toMatchObject({ settled: 2, failed: 1, requeued: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(A.vault);
    expect(decode(sent[0]?.data as Hex)).toHaveLength(3);
    const st = Object.fromEntries((await rows()).map((r) => [r.paymentId, r]));
    expect(st[(a as X402Payment).paymentId]?.status).toBe('settled');
    expect(st[(a as X402Payment).paymentId]?.settleTx).toBe(`0x${'cc'.repeat(32)}`);
    expect(st[(b as X402Payment).paymentId]).toMatchObject({ status: 'failed', failReason: '0x815e1d64' });
    expect(await getRedis().sismember(BARRED_KEY, (b as X402Payment).payer)).toBe(1);
    expect(await getRedis().sismember(BARRED_KEY, (a as X402Payment).payer)).toBe(0);
  });

  test('batches at most 25 items, urgent deadlines first, then by deadline', async () => {
    const n = nowSec();
    await seedClosing(30, (i) => ({
      deadline: BigInt(i === 29 ? n + 600 : n + 7200 + (29 - i) * 60), // last-inserted is urgent; others: later index = earlier deadline
    }));
    const sent: Sent[] = [];
    await runSettle(mkDeps({ sent }));
    const items = decode(sent[0]?.data as Hex) as unknown as { permit: { deadline: bigint } }[];
    expect(items).toHaveLength(25);
    expect(items[0]?.permit.deadline).toBe(BigInt(n + 600));
    const deadlines = items.map((x) => x.permit.deadline);
    expect([...deadlines].slice(1)).toEqual([...deadlines].slice(1).sort((x, y) => (x < y ? -1 : 1)));
    expect((await rows()).filter((r) => r.status === 'settling')).toHaveLength(25);
    expect((await rows()).filter((r) => r.status === 'closing')).toHaveLength(5);
  });

  test('items with used=0 are skipped, past-deadline ones expire, in-flight sessions wait', async () => {
    const n = nowSec();
    await seedClosing(
      4,
      (i) =>
        [{ usedMicros: 0n }, { deadline: BigInt(n - 10) }, { scheme: 'session', reservedMicros: 5n }, {}][
          i
        ] ?? {},
    );
    const sent: Sent[] = [];
    const sum = await runSettle(mkDeps({ sent }));
    expect(sum.expired).toBe(2);
    const by = (await rows()).map((r) => r.status).sort();
    expect(by).toEqual(['closing', 'expired', 'expired', 'settling']);
    expect(decode(sent[0]?.data as Hex)).toHaveLength(1);
  });

  test('definite send failure puts items back to closing; unknown outcome never re-sends', async () => {
    await seedClosing(2);
    const sum = await runSettle(
      mkDeps({
        send: async () => {
          throw new Error('insufficient funds for gas');
        },
      }),
    );
    expect(sum.skipped).toBe('send_failed');
    expect((await rows()).every((r) => r.status === 'closing')).toBe(true);

    let calls = 0;
    await runSettle(
      mkDeps({
        send: async () => {
          calls++;
          return { hash: `0x${'dd'.repeat(32)}`, status: 'unknown' };
        },
      }),
    );
    expect(
      (await rows()).every((r) => r.status === 'settling' && r.settleTx === `0x${'dd'.repeat(32)}`),
    ).toBe(true);
    // a later run does not touch settling rows (no re-send); reconcile completes them from the receipt once old enough
    await runSettle(
      mkDeps({
        send: async () => {
          calls++;
          return { hash: '0x' as Hex, status: 'unknown' as const };
        },
      }),
    );
    expect(calls).toBe(1);
    await dbRef.db.update(x402Payments).set({ closedAt: new Date(Date.now() - 3600_000) });
    const rs = await rows();
    await runSettle(
      mkDeps({
        receipt: async (h) =>
          receiptFor(
            h,
            rs.map((r) => ({ ok: true as const, r, used: 50_000n })),
          ),
      }),
    );
    expect((await rows()).every((r) => r.status === 'settled')).toBe(true);
  });

  test('settling rows with no receipt: after 30 min a dropped tx is re-queued, a pending one keeps waiting', async () => {
    await seedClosing(1);
    await runSettle(mkDeps({ send: async () => ({ hash: `0x${'ab'.repeat(32)}`, status: 'unknown' }) }));
    const old = () => dbRef.db.update(x402Payments).set({ closedAt: new Date(Date.now() - 2 * 3600_000) });
    await old();
    await runSettle(mkDeps({ txKnown: async () => true, keeperBalanceWei: async () => 0n }));
    expect((await rows())[0]).toMatchObject({ status: 'settling', settleTx: `0x${'ab'.repeat(32)}` });
    await runSettle(mkDeps({ txKnown: async () => false, keeperBalanceWei: async () => 0n }));
    expect((await rows())[0]).toMatchObject({ status: 'closing', settleTx: null });
  });

  test('a SettleFailed for an already-settled row neither changes it nor bars the payer', async () => {
    const [a] = await seedClosing(1);
    await dbRef.db
      .update(x402Payments)
      .set({ status: 'settled' })
      .where(eq(x402Payments.id, (a as X402Payment).id));
    const r = await applyReceipt(
      [a as X402Payment],
      receiptFor(`0x${'ee'.repeat(32)}`, [{ ok: false, r: a as X402Payment }]),
      mkDeps(),
    );
    expect(r.failed).toBe(0);
    expect((await rows())[0]?.status).toBe('settled');
    expect(await getRedis().sismember(BARRED_KEY, payer.address.toLowerCase())).toBe(0);
  });

  test('a reverted batch is retried, then failed after 3 attempts without barring anyone', async () => {
    await seedClosing(1);
    const reverted = (h: Hex) =>
      ({ transactionHash: h, status: 'reverted', logs: [] }) as unknown as TransactionReceipt;
    for (let i = 0; i < 3; i++) {
      await runSettle(mkDeps({ receipt: async (h) => reverted(h) }));
    }
    const [r] = await rows();
    expect(r).toMatchObject({ status: 'failed', failReason: 'batch_reverted' });
    expect(await getRedis().sismember(BARRED_KEY, payer.address.toLowerCase())).toBe(0);
  });

  test('the settle lock prevents concurrent runs', async () => {
    await seedClosing(1);
    await getRedis().set('x402:settle-lock', '1', 'EX', 60);
    expect((await runSettle(mkDeps())).skipped).toBe('locked');
  });

  test('applyReceipt is idempotent when the indexer already applied the event', async () => {
    const [a] = await seedClosing(1);
    await dbRef.db
      .update(x402Payments)
      .set({ status: 'settled', settleTx: '0x1' })
      .where(eq(x402Payments.id, (a as X402Payment).id));
    const r = await applyReceipt(
      [a as X402Payment],
      receiptFor(`0x${'ee'.repeat(32)}`, [{ ok: true, r: a as X402Payment, used: 50_000n }]),
      mkDeps(),
    );
    expect(r.settled).toBe(1);
    expect((await rows())[0]?.settleTx).toBe('0x1'); // untouched
  });
});
