// Integration: build -> post (keeper, prechecks against the deployed SpindleClaims) -> warp 3601s -> claim.
// Skips when the anvil fork is unhealthy.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { erc20Abi, spindleClaimsAbi } from '@spindle/shared/abi';
import { Redis } from 'ioredis';
import { createPublicClient, createWalletClient, type Hex, http } from 'viem';
import { account } from '../../../dev/lib/accounts';
import { ANVIL_URL, chain, rpc } from '../../../dev/lib/chain';
import type { TestDb } from '../../../test/db-setup';
import { FORK_SKIP_MESSAGE, forkHealthy } from '../../../test/fork';
import { earningEvents, epochs } from '../../db/schema';
import { requireAddress } from '../../lib/contracts';
import { createKeeper } from '../../lib/keeper';
import { proofFor, treeFromJson } from '../../shared/merkle';
import { dbRef } from '../auth/constants';
import { getProof, type ProofDeps } from '../claims/service';
import { buildEpoch } from './builder';
import { defaultPosterDeps, postEpoch } from './poster';
import { epochSettings, treePathOf } from './service';

const healthy = await forkHealthy();
if (!healthy) console.warn(`[skip] ${import.meta.file}: ${FORK_SKIP_MESSAGE}`);

let t: TestDb;
let snap: string;
let redis: Redis;
const pub = createPublicClient({ chain, transport: http(ANVIL_URL) });
const wallet = (i: number) => createWalletClient({ account: account(i), chain, transport: http(ANVIL_URL) });

beforeAll(async () => {
  if (!healthy) return;
  const u = new URL(
    process.env.TEST_DATABASE_URL ?? 'postgres://spindle:spindle@127.0.0.1:7232/spindle_test_b8',
  );
  if (u.hostname === 'postgres') {
    u.hostname = '127.0.0.1';
    u.port = '7232';
  }
  process.env.TEST_DATABASE_URL = u.toString();
  const { setupTestDb } = await import('../../../test/db-setup');
  t = await setupTestDb();
  await t.reset();
  dbRef.db = t.db;
  epochSettings.treesDir = (await import('node:fs')).mkdtempSync('/tmp/b8-trees-');
  snap = await rpc<string>('evm_snapshot');
  const ru = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:7279');
  if (ru.hostname === 'redis') {
    ru.hostname = '127.0.0.1';
    ru.port = '7279';
  }
  redis = new Redis(ru.toString());
});
afterAll(async () => {
  if (!healthy) return;
  if (snap) await rpc('evm_revert', [snap]);
  await redis?.quit();
  await t?.close();
});

describe.skipIf(!healthy)('epochs on anvil', () => {
  setDefaultTimeout(120_000);
  test('build -> postRoot via keeper -> warp 1h -> claim succeeds, double claim reverts', async () => {
    const claims = requireAddress('claims');
    const usdg = requireAddress('usdg');
    const user = account(4);
    const amount = 5_000_000n;

    // The claims pool must be solvent: treasury (account 0) tops it up.
    await pub.waitForTransactionReceipt({
      hash: await wallet(0).writeContract({
        address: usdg,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [claims, 50_000_000n],
      }),
    });

    const block = await pub.getBlock();
    const now = new Date(Number(block.timestamp) * 1000);
    await t.db.insert(earningEvents).values({
      ts: new Date(now.getTime() - 2 * 3600_000),
      nodeId: '00000000-0000-4000-8000-000000000001',
      owner: user.address.toLowerCase(),
      kind: 'job',
      usdgMicros: amount,
    });
    const built = await buildEpoch(
      BigInt(Math.floor(Number(block.timestamp) / epochSettings.epochSeconds) - 1) +
        (await pub.readContract({ address: claims, abi: spindleClaimsAbi, functionName: 'maxPostedEpoch' })),
      { now },
    );
    expect(built.kind).toBe('built');
    if (built.kind !== 'built') return;

    const keeper = createKeeper({
      redis: () => redis,
      account: () => account(1),
      client: pub,
      wallet: (a) => createWalletClient({ account: a, chain, transport: http(ANVIL_URL) }) as never,
      receiptTimeoutMs: 60_000,
    });
    const base = defaultPosterDeps();
    const out = await postEpoch(built.epoch, {
      ...base,
      send: keeper.sendKeeperTx,
      chain: { ...base.chain, keeperEth: () => pub.getBalance({ address: account(1).address }) },
    });
    expect(out.kind).toBe('posted');
    if (out.kind === 'posted') console.log(`postRoot gasUsed=${out.gasUsed}`);
    const [row] = await t.db.select().from(epochs);
    expect(row?.status).toBe('posted');

    // Inside the delay: contract refuses.
    const tree = treeFromJson(JSON.parse(await Bun.file(treePathOf(row?.treePath ?? '')).text()));
    const proof = proofFor(tree, user.address);
    await expect(
      pub.simulateContract({
        account: user,
        address: claims,
        abi: spindleClaimsAbi,
        functionName: 'claim',
        args: [built.epoch, amount, proof as Hex[], amount],
      }),
    ).rejects.toThrow();

    await rpc('evm_increaseTime', [3601]);
    await rpc('evm_mine');
    const proofDeps: ProofDeps = {
      now: () => new Date(Date.now() + 3601_000),
      claimsAddress: () => claims,
      claimedOnchain: async (o) =>
        (await pub.readContract({
          address: claims,
          abi: spindleClaimsAbi,
          functionName: 'claimed',
          args: [o],
        })) as bigint,
    };
    epochSettings.claimMinMicros = 1n;
    const p = await getProof(user.address, proofDeps);
    expect(p.claimableMicros).toBe(amount.toString());
    const args = [
      BigInt(p.epoch),
      BigInt(p.cumulativeMicros),
      p.proof as Hex[],
      BigInt(p.claimableMicros),
    ] as const;
    const before = (await pub.readContract({
      address: usdg,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [user.address],
    })) as bigint;
    const rc = await pub.waitForTransactionReceipt({
      hash: await wallet(4).writeContract({
        address: claims,
        abi: spindleClaimsAbi,
        functionName: 'claim',
        args,
      }),
    });
    expect(rc.status).toBe('success');
    const after = (await pub.readContract({
      address: usdg,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [user.address],
    })) as bigint;
    expect(after - before).toBe(amount);
    await expect(
      pub.simulateContract({
        account: user,
        address: claims,
        abi: spindleClaimsAbi,
        functionName: 'claim',
        args,
      }),
    ).rejects.toThrow();
  });
});
