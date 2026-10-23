import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  type Abi,
  type Address,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  type Hex,
  type Log,
  pad,
  toHex,
} from 'viem';
import type { TestDb } from '../../../test/db-setup';
import {
  auditLog,
  buyerBalances,
  buyerLedger,
  buyers,
  claims,
  epochs,
  nodes,
  users,
  x402Payments,
} from '../../db/schema';
import { buyerAbis } from './abis';
import { readCursor } from './cursor';
import { type IndexerClient, type IndexerDeps, runIndexOnce } from './indexer';

const REG = '0x00000000000000000000000000000000000000a1' as Address;
const STK = '0x00000000000000000000000000000000000000a2' as Address;
const CLM = '0x00000000000000000000000000000000000000a3' as Address;
const VLT = '0x00000000000000000000000000000000000000a4' as Address;
const BUYER = getAddress('0x00000000000000000000000000000000000000b1');
const hash = (n: number, salt = 0) => pad(toHex(n * 1000 + salt), { size: 32 });

let t: TestDb;
beforeAll(async () => {
  // Own database: other test files truncate the shared spindle_test concurrently.
  const u = new URL(
    process.env.TEST_DATABASE_URL ?? 'postgres://spindle:spindle@127.0.0.1:7232/spindle_test',
  );
  if (u.hostname === 'postgres') {
    u.hostname = '127.0.0.1';
    u.port = '7232';
  }
  u.pathname = '/spindle_test_b6';
  process.env.TEST_DATABASE_URL = u.toString();
  const { setupTestDb } = await import('../../../test/db-setup');
  t = await setupTestDb();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

type Ev = {
  block: number;
  address: Address;
  name: string;
  args: Record<string, unknown>;
  tx?: number;
  idx?: number;
};

function encode(e: Ev): Log {
  const item = (buyerAbis as Abi).find((x) => x.type === 'event' && x.name === e.name);
  if (!item || item.type !== 'event') throw new Error(`no event ${e.name}`);
  const topics = encodeEventTopics({ abi: [item], eventName: e.name, args: e.args as never }) as Hex[];
  const nonIndexed = item.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(nonIndexed, nonIndexed.map((i) => e.args[i.name as string]) as never);
  return {
    address: e.address,
    topics: topics as [Hex],
    data,
    blockNumber: BigInt(e.block),
    logIndex: e.idx ?? 0,
    transactionHash: hash(e.tx ?? e.block, 7),
    blockHash: hash(e.block),
    transactionIndex: 0,
    removed: false,
  } as Log;
}

function mockClient(opts: { head: number; events: Ev[]; hashSalt?: () => number; maxRange?: number }) {
  const calls: Array<[number, number]> = [];
  const state = { head: opts.head, events: opts.events, salt: 0, maxRange: opts.maxRange ?? Infinity };
  const client: IndexerClient = {
    getBlockNumber: async () => BigInt(state.head),
    getBlock: async ({ blockNumber }) => ({
      number: blockNumber,
      hash: hash(Number(blockNumber), state.salt),
      timestamp: 1_700_000_000n + blockNumber,
    }),
    getLogs: async ({ fromBlock, toBlock }) => {
      calls.push([Number(fromBlock), Number(toBlock)]);
      if (Number(toBlock - fromBlock) + 1 > state.maxRange) throw new Error('query exceeds max block range');
      return state.events
        .filter((e) => e.block >= fromBlock && e.block <= toBlock)
        .map(encode)
        .sort((a, b) => Number(a.blockNumber! - b.blockNumber!) || a.logIndex! - b.logIndex!);
    },
    readStake: async () => {
      throw new Error('no state');
    },
  };
  return { client, calls, state };
}

function fakeRedis() {
  const held = new Map<string, string>();
  const published: string[] = [];
  return {
    published,
    held,
    set: (async (k: string, v: string, ..._r: unknown[]) => {
      if (held.has(k)) return null;
      held.set(k, v);
      return 'OK';
    }) as never,
    eval: (async (_s: string, _n: number, k: string, v: string) => {
      if (held.get(k) === v) held.delete(k);
      return 1;
    }) as never,
    publish: (async (_c: string, m: string) => {
      published.push(m);
      return 1;
    }) as never,
  };
}

function deps(client: IndexerClient, redis = fakeRedis(), logChunk = 5000): IndexerDeps {
  const noop = () => undefined;
  return {
    client,
    db: t.db,
    redis,
    logger: { info: noop, warn: noop, error: noop } as never,
    addresses: [REG, STK, CLM, VLT],
    deployBlock: 100,
    confirmations: 12,
    logChunk,
  };
}

const deposit = (block: number, amount: bigint, idx = 0): Ev => ({
  block,
  idx,
  address: VLT,
  name: 'Deposited',
  args: { buyer: BUYER, payer: BUYER, amount, toClaims: 0n, toTreasury: 0n },
});

async function balance() {
  const [b] = await t.db.select().from(buyers).where(eq(buyers.address, BUYER.toLowerCase()));
  if (!b) return null;
  const [r] = await t.db.select().from(buyerBalances).where(eq(buyerBalances.buyerId, b.id));
  return r?.balanceUsdgMicros ?? null;
}

describe('indexer', () => {
  test('deposit credited once across a double run; lowercase address; cursor advances', async () => {
    const m = mockClient({ head: 130, events: [deposit(110, 5_000_000n)] });
    await runIndexOnce(deps(m.client));
    expect(await balance()).toBe(5_000_000n);
    await runIndexOnce(deps(m.client));
    expect(await balance()).toBe(5_000_000n);
    expect((await t.db.select().from(buyerLedger)).length).toBe(1);
    expect((await readCursor(t.db, 100)).lastSafeBlock).toBe(118);
    // force a re-scan of the same range: still no double credit
    await t.sql`delete from kv where key = 'indexer:cursor'`;
    await runIndexOnce(deps(m.client));
    expect(await balance()).toBe(5_000_000n);
  });

  test('only blocks <= head - 12 applied', async () => {
    const m = mockClient({ head: 121, events: [deposit(110, 1n), deposit(110, 1n, 1), deposit(111, 7n)] });
    await runIndexOnce(deps(m.client));
    expect(await balance()).toBeNull(); // safe = 109: blocks 110, 111 not yet confirmed
    m.state.head = 122; // safe = 110
    await runIndexOnce(deps(m.client));
    expect(await balance()).toBe(2n);
  });

  test('lock prevents concurrent runs', async () => {
    const m = mockClient({ head: 130, events: [] });
    const r = fakeRedis();
    r.held.set('lock:indexer', 'other');
    expect((await runIndexOnce(deps(m.client, r))).skipped).toBe('locked');
    expect(m.calls.length).toBe(0);
  });

  test('chunk shrinking on range errors, terminates', async () => {
    const m = mockClient({ head: 1100, events: [deposit(120, 3n)], maxRange: 100 });
    await runIndexOnce(deps(m.client, fakeRedis(), 5000));
    expect(await balance()).toBe(3n);
    expect(m.calls[0]).toEqual([100, 1088]);
    expect(m.calls.some(([a, b]) => b - a + 1 <= 100)).toBe(true);
    await t.reset();
    const bad = mockClient({ head: 1100, events: [], maxRange: 5 });
    await expect(runIndexOnce(deps(bad.client, fakeRedis(), 640))).rejects.toThrow();
    expect(bad.calls.at(-1)).toEqual([100, 109]); // floor of 10 reached, then gives up
  });

  test('unrelated errors are not retried by shrinking', async () => {
    const m = mockClient({ head: 200, events: [] });
    m.client.getLogs = async () => {
      throw new Error('connection refused');
    };
    await expect(runIndexOnce(deps(m.client))).rejects.toThrow('connection refused');
  });

  test('failed chunk leaves no partial state (atomic with cursor)', async () => {
    const m = mockClient({ head: 130, events: [deposit(110, 9n)] });
    // an Epoch-less RootPosted is only a warning; force a failing statement instead via bad kv write
    const d = deps(m.client);
    const origGetBlock = m.client.getBlock;
    m.client.getBlock = async (a) => {
      if (a.blockNumber === 118n) throw new Error('boom');
      return origGetBlock(a);
    };
    await expect(runIndexOnce(d)).rejects.toThrow('boom');
    expect(await balance()).toBeNull();
    expect((await readCursor(t.db, 100)).lastSafeBlock).toBe(99);
  });

  test('reorg: hash mismatch reverses the deposit and re-applies the new chain', async () => {
    const m = mockClient({ head: 130, events: [deposit(110, 5n), deposit(112, 4n)] });
    await runIndexOnce(deps(m.client));
    expect(await balance()).toBe(9n);
    // chain reorganised: block hashes differ, deposit at 112 vanished, new head further on
    m.state.salt = 1;
    m.state.events = [deposit(110, 5n)];
    m.state.head = 131;
    const res = await runIndexOnce(deps(m.client));
    expect(res.rolledBackTo).toBe(99);
    expect(await balance()).toBe(5n);
    expect((await t.db.select().from(buyerLedger)).length).toBe(1);
    const j = await t.db.select().from(auditLog).where(eq(auditLog.action, 'indexer.event'));
    expect(j.length).toBe(1);
  });

  test('Claimed upsert and RootPosted/RootVetoed', async () => {
    await t.db.insert(epochs).values({
      epoch: 7n,
      root: '0x01',
      totalEarnedUsdgMicros: 10n,
      owners: 1,
      treePath: 'x',
      status: 'posting',
    });
    const owner = getAddress('0x00000000000000000000000000000000000000c1');
    const claimEv: Ev = {
      block: 112,
      address: CLM,
      name: 'Claimed',
      args: { owner, epoch: 7n, amount: 42n, claimedTotal: 42n },
    };
    // pre-existing submitted claim keyed by the same tx hash
    await t.db.insert(claims).values({
      owner: owner.toLowerCase(),
      epoch: 7n,
      amountUsdgMicros: 42n,
      txHash: hash(112, 7),
      status: 'submitted',
    });
    const m = mockClient({
      head: 140,
      events: [
        {
          block: 110,
          address: CLM,
          name: 'RootPosted',
          args: { epoch: 7n, root: hash(1), totalEarned: 10n },
        },
        claimEv,
        { block: 113, address: CLM, name: 'RootVetoed', args: { epoch: 7n } },
      ],
    });
    await runIndexOnce(deps(m.client));
    await t.sql`delete from kv where key = 'indexer:cursor'`;
    await runIndexOnce(deps(m.client));
    const cl = await t.db.select().from(claims);
    expect(cl.length).toBe(1);
    expect(cl[0]?.status).toBe('confirmed');
    expect(cl[0]?.blockNumber).toBe(112n);
    const [e] = await t.db.select().from(epochs);
    expect(e?.status).toBe('vetoed');
    expect(e?.txHash).toBe(hash(110, 7));
    expect(e?.postedAt?.getTime()).toBe((1_700_000_000 + 110) * 1000);
  });

  test('Settled / SettleFailed update x402_payments', async () => {
    const mk = (id: Hex) =>
      t.db
        .insert(x402Payments)
        .values({ paymentId: id, payer: BUYER.toLowerCase(), scheme: 'exact', status: 'settling' });
    await mk(hash(1));
    await mk(hash(2));
    const m = mockClient({
      head: 140,
      events: [
        {
          block: 110,
          address: VLT,
          name: 'Settled',
          args: { paymentId: hash(1), payer: BUYER, used: 99n, surcharge: 1n },
        },
        {
          block: 111,
          address: VLT,
          name: 'SettleFailed',
          args: { paymentId: hash(2), payer: BUYER, reason: '0xdeadbeef' },
        },
      ],
    });
    await runIndexOnce(deps(m.client));
    const rows = await t.db.select().from(x402Payments);
    const a = rows.find((r) => r.paymentId === hash(1));
    const b = rows.find((r) => r.paymentId === hash(2));
    expect(a?.status).toBe('settled');
    expect(a?.usedMicros).toBe(99n);
    expect(a?.settleTx).toBe(hash(110, 7));
    expect(b?.status).toBe('failed');
    expect(b?.failReason).toBe('0xdeadbeef');
  });

  test('registration, stake deltas (read unavailable), eligibility events, unknown node warning', async () => {
    const [u] = await t.db
      .insert(users)
      .values({ address: '0x00000000000000000000000000000000000000d1' } as never)
      .returning();
    const key = getAddress('0x00000000000000000000000000000000000000e1');
    const [n] = await t.db
      .insert(nodes)
      .values({
        owner: '0x00000000000000000000000000000000000000d1',
        userId: u!.id,
        nodeKey: key.toLowerCase(),
        nodePubkey: 'pk',
        name: 'n',
        engine: 'ollama',
        gpuClass: 1,
        lane: 'open',
        status: 'offline',
      })
      .returning();
    const owner = getAddress('0x00000000000000000000000000000000000000d2');
    const m = mockClient({
      head: 140,
      events: [
        {
          block: 110,
          address: REG,
          name: 'NodeRegistered',
          args: { nodeId: 5n, owner, nodeKey: key, gpuClass: 1, ccCapable: false, attestationRef: hash(0) },
        },
        { block: 111, address: STK, name: 'Staked', args: { nodeId: 5n, owner, amount: 1000n } },
        {
          block: 112,
          address: STK,
          name: 'UnstakeStarted',
          args: { nodeId: 5n, amount: 300n, unlockAt: 9n },
        },
        { block: 113, address: STK, name: 'Staked', args: { nodeId: 99n, owner, amount: 1n } },
        { block: 114, address: REG, name: 'IdentityLinked', args: { nodeId: 5n, agentId: 77n } },
      ],
    });
    const r = fakeRedis();
    await runIndexOnce(deps(m.client, r));
    const [row] = await t.db.select().from(nodes).where(eq(nodes.id, n!.id));
    expect(row?.registered).toBe(true);
    expect(row?.onchainId).toBe(5n);
    expect(row?.owner).toBe(owner.toLowerCase());
    expect(row?.stakeSpdl).toBe('700');
    expect(row?.stakePending).toBe('300');
    expect((row?.benchmark as { identity: string } | null)?.identity).toBe('77');
    expect(r.published.map((p) => JSON.parse(p))).toContainEqual({ type: 'eligibility', nodeId: n!.id });
    const warns = await t.db.select().from(auditLog).where(eq(auditLog.action, 'indexer.unknown_node'));
    expect(warns.length).toBe(1);
  });
});
