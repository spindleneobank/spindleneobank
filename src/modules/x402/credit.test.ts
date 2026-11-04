/**
 * Regression tests for audit findings H-2 and M-7. A payment that fails to settle costs the serving nodes, so an
 * unproven wallet gets very little credit and more only as it pays. Credit counts real use, so idle sessions
 * cannot lock other buyers out.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import fc from 'fast-check';
import type { Address, Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { x402Payments } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { closeRedis, getRedis } from '../../lib/redis';
import { dbRef } from '../auth/constants';
import { addressOverride } from './challenge';
import { closeSession, reserveSession, settleSessionUse } from './sessions';
import { chainDeps, creditLimit, resetPayerCache, verifyAndOpen, x402Limits } from './verify';

const USD = 1_000_000n;
const SIGNED = 20n * USD;
let t: TestDb;
const origChain = { ...chainDeps };
const origLimits = { ...x402Limits };

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
  addressOverride.current = {
    usdg: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
    vault: '0x969aa7de33fdfdab7c11ade6a0288ec79f12fb19',
    permit2: '0x000000000022d473030f116ddee9f6b43ac78ba3',
  };
  chainDeps.verifySignature = async () => true;
  chainDeps.nonceUsed = async () => false;
  chainDeps.payerState = async () => ({ balance: 100n * USD, allowance: 100n * USD });
});
afterAll(async () => {
  Object.assign(chainDeps, origChain);
  Object.assign(x402Limits, origLimits);
  addressOverride.current = undefined;
  await t.close();
  await closeRedis();
});
beforeEach(async () => {
  await t.reset();
  resetPayerCache();
  Object.assign(x402Limits, origLimits, { newPayerCredit: 50_000n, creditPerSettledBps: 1000n });
});

const fresh = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as Address;
const open = (
  payer: Address,
  o: { scheme?: 'exact' | 'session'; cap?: bigint; surcharge?: bigint; clientIp?: string } = {},
) =>
  verifyAndOpen({
    scheme: o.scheme ?? 'exact',
    payer,
    paymentId: `0x${crypto.randomUUID().replaceAll('-', '').padEnd(64, '0')}` as Hex,
    cap: o.cap ?? 40_000n,
    surcharge: o.surcharge ?? 5_000n,
    nonce: 1n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    validAfter: 0n,
    signature: '0x00',
    ...(o.clientIp ? { clientIp: o.clientIp } : {}),
    consume: async () => true,
  });
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => (e instanceof AppError ? e.message : String(e)),
  );
const settled = (payer: Address, usedMicros: bigint) =>
  t.db.insert(x402Payments).values({
    paymentId: `0x${crypto.randomUUID().replaceAll('-', '').padEnd(64, '0')}`,
    payer,
    scheme: 'exact',
    capMicros: usedMicros,
    surchargeMicros: 0n,
    usedMicros,
    nonce: String(Math.floor(Math.random() * 1e9)),
    deadline: 9_999_999_999n,
    validAfter: 0n,
    signature: '0x00',
    permit: {},
    status: 'settled',
  });
const reserve = async (payer: Address, amount: bigint) => {
  const { id } = await open(payer, { scheme: 'session', cap: 5n * USD });
  const [row] = await t.db.select().from(x402Payments).where(sqlId(id));
  return { row, r: await reserveSession(row as never, amount, 60_000) };
};
const sqlId = (id: string) => eq(x402Payments.id, id);

test('M-7: 25 unused $20 sessions no longer lock an honest buyer out', async () => {
  for (let i = 0; i < 25; i++) await open(fresh(), { scheme: 'session', cap: SIGNED });
  expect(await refusal(open(fresh()))).toBeNull();
});

test('real use still stops at the global limit', async () => {
  x402Limits.maxGlobalUnsettled = 100_000n;
  expect(await refusal(open(fresh(), { cap: 45_000n }))).toBeNull();
  expect(await refusal(open(fresh(), { cap: 45_000n }))).toBeNull();
  expect(await refusal(open(fresh(), { cap: 45_000n }))).toContain('at capacity');
});

test('a session reservation counts toward the global limit', async () => {
  x402Limits.maxGlobalUnsettled = 40_000n;
  const a = await reserve(fresh(), 30_000n);
  expect('remaining' in a.r).toBe(true);
  const b = await reserve(fresh(), 30_000n);
  expect(b.r).toEqual({ refused: 'capacity' });
});

test('H-2: a new wallet gets only its small credit, however large the signed cap', async () => {
  const payer = fresh();
  expect(await refusal(open(payer, { cap: 60_000n }))).toContain('credit limit');
  const { r } = await reserve(payer, 40_000n);
  expect('remaining' in r).toBe(true);
  const [row] = await t.db.select().from(x402Payments);
  expect(await reserveSession(row as never, 40_000n, 60_000)).toEqual({ refused: 'credit' });
});

test('a refused reservation leaves nothing reserved, in Redis or the database', async () => {
  const { row, r } = await reserve(fresh(), 60_000n);
  expect(r).toEqual({ refused: 'credit' });
  const [after] = await t.db
    .select()
    .from(x402Payments)
    .where(sqlId(row?.id as string));
  expect(after?.reservedMicros).toBe(0n);
  expect(await getRedis().hget(`x402:session:${row?.paymentId}`, 'reserved')).toBe('0');
});

test('credit grows with what a wallet has settled, stays below it, and stops at the payer cap', async () => {
  expect(creditLimit(0n)).toBe(50_000n);
  expect(creditLimit(1n * USD)).toBe(150_000n);
  expect(creditLimit(1_000n * USD)).toBe(20n * USD);
  const payer = fresh();
  await settled(payer, 1n * USD);
  expect(await refusal(open(payer, { cap: 150_000n }))).toBeNull();
  expect(await refusal(open(payer, { cap: 10_000n }))).toContain('credit limit');
});

test('farming history through your own node costs more than the credit it earns', () => {
  for (const paid of [0n, USD, 10n * USD, 80n * USD]) {
    const earned = creditLimit(paid) - x402Limits.newPayerCredit;
    // 80% comes back to an operator who served their own job, so history costs them 20%
    expect(earned).toBeLessThanOrEqual((paid * 2_000n) / 10_000n);
  }
});

test('one IP can bring only a few new wallets a day', async () => {
  x402Limits.maxNewPayersPerIpDay = 2;
  const ip = `test-${crypto.randomUUID()}`;
  const first = fresh();
  expect(await refusal(open(first, { clientIp: ip }))).toBeNull();
  expect(await refusal(open(fresh(), { clientIp: ip }))).toBeNull();
  expect(await refusal(open(fresh(), { clientIp: ip }))).toContain('new x402 wallets');
  // a wallet it already brought is not a new one
  expect(await refusal(open(first, { clientIp: ip, cap: 5_000n, surcharge: 1_000n }))).toBeNull();
  // nor is one that has paid
  const proven = fresh();
  await settled(proven, USD);
  expect(await refusal(open(proven, { clientIp: ip }))).toBeNull();
});

test('closing a session with a job in flight still counts that job against the limit', async () => {
  const payer = fresh();
  const first = await reserve(payer, 40_000n);
  expect('remaining' in first.r).toBe(true);
  await closeSession(first.row?.id as string);
  const second = await open(payer, { scheme: 'session', cap: 5n * USD, surcharge: 0n });
  const [row] = await t.db.select().from(x402Payments).where(sqlId(second.id));
  expect(await reserveSession(row as never, 40_000n, 60_000)).toEqual({ refused: 'credit' });
});

test('a closed session reports it can settle only when its last job has finished', async () => {
  const payer = fresh();
  const { row } = await reserve(payer, 20_000n);
  const id = row?.id as string;
  await t.db.update(x402Payments).set({ status: 'open' }).where(sqlId(id));
  const [fresher] = await t.db.select().from(x402Payments).where(sqlId(id));
  await reserveSession(fresher as never, 20_000n, 60_000);
  await closeSession(id);
  expect((await settleSessionUse(id, 20_000n, 10_000n)).settleable).toBe(false);
  expect((await settleSessionUse(id, 20_000n, 10_000n)).settleable).toBe(true);
});

test('IPv6: one /64 is one client', async () => {
  x402Limits.maxNewPayersPerIpDay = 1;
  const net = crypto.randomUUID().replaceAll('-', '').slice(0, 4);
  expect(await refusal(open(fresh(), { clientIp: `2001:db8:${net}:1::1` }))).toBeNull();
  expect(await refusal(open(fresh(), { clientIp: `2001:db8:${net}:1:aaaa:bbbb:cccc:dddd` }))).toContain(
    'new x402 wallets',
  );
  expect(await refusal(open(fresh(), { clientIp: `2001:db8:${net}:2::1` }))).toBeNull();
});

test('model: whatever a wallet does in any order, its credit in use stays within its limit', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.oneof(
          fc.record({ op: fc.constant('open' as const) }),
          fc.record({ op: fc.constant('reserve' as const), amount: fc.bigInt({ min: 1n, max: 40_000n }) }),
          fc.record({ op: fc.constant('finish' as const), charge: fc.bigInt({ min: 0n, max: 40_000n }) }),
          fc.record({ op: fc.constant('close' as const) }),
        ),
        { maxLength: 25 },
      ),
      async (ops) => {
        await t.reset();
        const payer = fresh();
        const sessions: string[] = [];
        const held: { id: string; amount: bigint }[] = [];
        const limit = creditLimit(0n);
        for (const o of ops) {
          const last = sessions.at(-1);
          if (o.op === 'open') {
            const r = await open(payer, { scheme: 'session', cap: 5n * USD, surcharge: 1_000n }).catch(
              () => null,
            );
            if (r) sessions.push(r.id);
          } else if (o.op === 'close' && last) {
            await closeSession(last);
          } else if (o.op === 'reserve' && last) {
            const [row] = await t.db.select().from(x402Payments).where(sqlId(last));
            const r = await reserveSession(row as never, o.amount, 60_000);
            if ('remaining' in r) held.push({ id: last, amount: o.amount });
          } else if (o.op === 'finish') {
            const job = held.shift();
            if (job) await settleSessionUse(job.id, job.amount, o.charge);
          }
          const rows = await t.db.select().from(x402Payments);
          const inUse = rows.reduce(
            (a, p) => a + p.usedMicros + p.reservedMicros + (p.surchargeMicros ?? 0n),
            0n,
          );
          expect(inUse).toBeLessThanOrEqual(limit);
        }
      },
    ),
    { numRuns: 25 },
  );
}, 60_000);
