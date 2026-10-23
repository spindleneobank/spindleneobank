import { afterAll, describe, expect, test } from 'bun:test';
import { rhc } from '@spindle/shared/chain';
import { Redis } from 'ioredis';
import { createPublicClient, createWalletClient, http, parseTransaction } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createKeeper, KEEPER_LAST_NONCE_KEY, KEEPER_LOCK_KEY, type KeeperDeps } from './keeper';

const ANVIL = process.env.ANVIL_URL ?? 'http://127.0.0.1:7245';
const REDIS = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:7279';
// anvil default dev account #0 (public test key, no value)
const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const SINK = '0x000000000000000000000000000000000000dEaD';

const anvilUp = await fetch(ANVIL, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
})
  .then((r) => r.ok)
  .catch(() => false);
const redis = new Redis(REDIS, { maxRetriesPerRequest: 1, lazyConnect: true });
const redisUp = await redis
  .connect()
  .then(() => true)
  .catch(() => false);
const up = anvilUp && redisUp;
if (!up)
  console.warn(
    `SKIP: keeper tests need anvil (${ANVIL}) and redis (${REDIS}); anvil=${anvilUp} redis=${redisUp}`,
  );
afterAll(() => {
  redis.disconnect();
});

const client = createPublicClient({ chain: rhc, transport: http(ANVIL) });
const wallet = () =>
  createWalletClient({ account, chain: rhc, transport: http(ANVIL) }) as unknown as ReturnType<
    KeeperDeps['wallet']
  >;

describe.skipIf(!up)('sendKeeperTx', () => {
  test('serializes concurrent sends with sequential nonces', async () => {
    const keeper = createKeeper({
      redis: () => redis,
      account: () => account,
      client,
      wallet,
      receiptTimeoutMs: 30_000,
    });
    const start = await client.getTransactionCount({ address: account.address, blockTag: 'pending' });
    const results = await Promise.all(
      [0, 1, 2].map((i) => keeper.sendKeeperTx({ to: SINK, value: 1n, label: `test-${i}` })),
    );
    const nonces: number[] = [];
    for (const r of results) {
      expect(r.status).toBe('success');
      nonces.push((await client.getTransaction({ hash: r.hash })).nonce);
    }
    expect(nonces.sort((a, b) => a - b)).toEqual([start, start + 1, start + 2]);
    expect(await redis.get(KEEPER_LOCK_KEY)).toBeNull();
  }, 30_000);

  test('returns unknown on receipt timeout without resending', async () => {
    let sends = 0;
    const keeper = createKeeper({
      redis: () => redis,
      account: () => account,
      client: {
        ...client,
        getTransactionCount: client.getTransactionCount,
        estimateGas: client.estimateGas,
        getGasPrice: client.getGasPrice,
        waitForTransactionReceipt: async () => {
          throw new Error('timed out');
        },
      } as unknown as KeeperDeps['client'],
      wallet: () => {
        const w = wallet();
        return {
          signTransaction: w.signTransaction,
          sendRawTransaction: (args: Parameters<typeof w.sendRawTransaction>[0]) => {
            sends++;
            return w.sendRawTransaction(args);
          },
        } as ReturnType<KeeperDeps['wallet']>;
      },
      receiptTimeoutMs: 10,
    });
    const r = await keeper.sendKeeperTx({ to: SINK, value: 1n, label: 'timeout' });
    expect(r.status).toBe('unknown');
    expect(r.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(sends).toBe(1);
    expect(await redis.get(KEEPER_LOCK_KEY)).toBeNull();
  });

  test('uses max(pending, last+1) when a backend returns a stale pending nonce', async () => {
    await redis.del(KEEPER_LAST_NONCE_KEY);
    const mk = (stale?: number) =>
      createKeeper({
        redis: () => redis,
        account: () => account,
        client: {
          ...client,
          getTransactionCount: async (a: { blockTag?: string; address: `0x${string}` }) => {
            const real = await client.getTransactionCount(a as never);
            return a.blockTag === 'pending' && stale !== undefined ? stale : real;
          },
          estimateGas: client.estimateGas,
          getGasPrice: client.getGasPrice,
          waitForTransactionReceipt: client.waitForTransactionReceipt,
        } as unknown as KeeperDeps['client'],
        wallet,
        receiptTimeoutMs: 30_000,
      });
    const first = await mk().sendKeeperTx({ to: SINK, value: 1n, label: 'n1' });
    const n1 = (await client.getTransaction({ hash: first.hash })).nonce;
    // stale pending (as if a lagging backend); chain latest has not been reconciled past last
    await redis.set(KEEPER_LAST_NONCE_KEY, String(n1 + 5), 'EX', 60);
    const seen: number[] = [];
    const k = createKeeper({
      redis: () => redis,
      account: () => account,
      client: {
        getTransactionCount: async (a: { blockTag?: string }) => (a.blockTag === 'pending' ? n1 : n1 + 1),
        estimateGas: async () => 21000n,
        getGasPrice: client.getGasPrice,
        waitForTransactionReceipt: async () => {
          throw new Error('timeout');
        },
      } as unknown as KeeperDeps['client'],
      wallet: () => {
        const w = wallet();
        return {
          signTransaction: w.signTransaction,
          sendRawTransaction: async (a: { serializedTransaction: `0x${string}` }) => {
            seen.push(parseTransaction(a.serializedTransaction).nonce ?? -1);
            throw new Error('already known');
          },
        } as ReturnType<KeeperDeps['wallet']>;
      },
      receiptTimeoutMs: 10,
    });
    const r = await k.sendKeeperTx({ to: SINK, value: 1n, label: 'stale' });
    expect(seen).toEqual([n1 + 6]);
    expect(r.status).toBe('unknown');
    expect(r.hash).toMatch(/^0x[0-9a-f]{64}$/);
    await redis.del(KEEPER_LAST_NONCE_KEY);
  }, 30_000);
});
