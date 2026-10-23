// Integration: real contracts on the anvil RHC fork (dev compose + bootstrap). Restores chain state afterwards.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { buyerVaultAbi, erc20Abi, spindleRegistryAbi, spindleStakingAbi } from '@spindle/shared/abi';
import { nodeBindingTypedData } from '@spindle/shared/binding';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { createPublicClient, createWalletClient, getAddress, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { account } from '../../../dev/lib/accounts';
import { ANVIL_URL, chain, rpc } from '../../../dev/lib/chain';
import type { TestDb } from '../../../test/db-setup';
import { buyerBalances, buyers, nodes, users } from '../../db/schema';
import { requireAddress } from '../../lib/contracts';
import { readCursor } from './cursor';
import { defaultDeps, type IndexerDeps, runIndexOnce, viemIndexerClient } from './indexer';

let t: TestDb;
let snap: string;
let redis: Redis;
let deps: IndexerDeps;
const pub = createPublicClient({ chain, transport: http(ANVIL_URL) });
const wallet = (i: number) => createWalletClient({ account: account(i), chain, transport: http(ANVIL_URL) });
const mine = (n: number) => rpc('anvil_mine', [`0x${n.toString(16)}`]);
const send = async (hash: `0x${string}`) => pub.waitForTransactionReceipt({ hash });

beforeAll(async () => {
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
  await t.reset();
  snap = await rpc<string>('evm_snapshot');
  const ru = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:7279');
  if (ru.hostname === 'redis') {
    ru.hostname = '127.0.0.1';
    ru.port = '7279';
  }
  redis = new Redis(ru.toString());
  await redis.del('lock:indexer');
  const start = Number(await pub.getBlockNumber()) + 1;
  deps = { ...defaultDeps(), db: t.db, redis, client: viemIndexerClient(), deployBlock: start };
});
afterAll(async () => {
  if (snap) await rpc('evm_revert', [snap]);
  await redis?.quit();
  await t?.close();
});

describe('indexer on anvil', () => {
  setDefaultTimeout(120_000);
  const buyer = account(5);
  const owner = account(6);
  const nodeKey = privateKeyToAccount(generatePrivateKey());

  test('deposit credited only once 12 blocks deep', async () => {
    const usdg = requireAddress('usdg');
    const vault = requireAddress('vault');
    const w = wallet(5);
    await send(
      await w.writeContract({
        address: usdg,
        abi: erc20Abi,
        functionName: 'approve',
        args: [vault, 2_000_000n],
      }),
    );
    await send(
      await w.writeContract({
        address: vault,
        abi: buyerVaultAbi,
        functionName: 'deposit',
        args: [2_000_000n],
      }),
    );
    await mine(5);
    await runIndexOnce(deps);
    const lc = buyer.address.toLowerCase();
    expect(await t.db.select().from(buyers).where(eq(buyers.address, lc))).toHaveLength(0);
    await mine(10);
    await runIndexOnce(deps);
    const [b] = await t.db.select().from(buyers).where(eq(buyers.address, lc));
    const [bal] = await t.db.select().from(buyerBalances).where(eq(buyerBalances.buyerId, b!.id));
    expect(bal?.balanceUsdgMicros).toBe(2_000_000n);
    await runIndexOnce(deps);
    const [again] = await t.db.select().from(buyerBalances).where(eq(buyerBalances.buyerId, b!.id));
    expect(again?.balanceUsdgMicros).toBe(2_000_000n);
    const head = Number(await pub.getBlockNumber());
    expect((await readCursor(t.db, deps.deployBlock)).lastSafeBlock).toBe(head - 12);
  });

  test('register node then stake updates the nodes row', async () => {
    const registry = requireAddress('registry');
    const staking = requireAddress('staking');
    const spdl = requireAddress('spdl');
    const [u] = await t.db
      .insert(users)
      .values({ address: owner.address.toLowerCase() } as never)
      .returning();
    const [n] = await t.db
      .insert(nodes)
      .values({
        owner: owner.address.toLowerCase(),
        userId: u!.id,
        nodeKey: nodeKey.address.toLowerCase(),
        nodePubkey: 'pk',
        name: 'int',
        engine: 'ollama',
        gpuClass: 1,
        lane: 'open',
        status: 'offline',
      })
      .returning();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 86_400 * 365);
    const sig = await nodeKey.signTypedData(
      nodeBindingTypedData({
        registry,
        chainId: 4663,
        owner: getAddress(owner.address),
        nodeKey: nodeKey.address,
        gpuClass: 1,
        ccCapable: false,
        deadline,
      }),
    );
    const w = wallet(6);
    await send(
      await w.writeContract({
        address: registry,
        abi: spindleRegistryAbi,
        functionName: 'registerNode',
        args: [nodeKey.address, 1, false, `0x${'00'.repeat(32)}`, deadline, sig],
      }),
    );
    await mine(12);
    await runIndexOnce(deps);
    const [reg] = await t.db.select().from(nodes).where(eq(nodes.id, n!.id));
    expect(reg?.registered).toBe(true);
    expect(reg?.onchainId).not.toBeNull();

    const amount = 1_000n * 10n ** 18n;
    await send(
      await w.writeContract({
        address: spdl,
        abi: erc20Abi,
        functionName: 'approve',
        args: [staking, amount],
      }),
    );
    await send(
      await w.writeContract({
        address: staking,
        abi: spindleStakingAbi,
        functionName: 'stake',
        args: [reg!.onchainId!, amount],
      }),
    );
    await mine(12);
    await runIndexOnce(deps);
    const [staked] = await t.db.select().from(nodes).where(eq(nodes.id, n!.id));
    expect(staked?.stakeSpdl).toBe(amount.toString());
    expect(staked?.stakePending).toBe('0');
  });
});
