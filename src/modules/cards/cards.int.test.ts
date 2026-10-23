/**
 * Integration: izipay mock + Relay (REAL read-only quotes) + RelayStubDepository on the anvil fork.
 * create card -> invoice -> relay quote -> stub deposit -> webhooks -> issued; top-up -> completed;
 * reveal; apple-pay OTP; fault 500 -> review. Leaves the fork clean via evm_snapshot/evm_revert.
 * Needs: anvil fork on 127.0.0.1:7245, Postgres/Redis (defaults), network access to api.relay.link.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { createWalletClient, encodeFunctionData, http, parseAbi } from 'viem';
import { account } from '../../../dev/lib/accounts';
import { ANVIL_URL, chain, publicClient, rpc } from '../../../dev/lib/chain';
import { FORK_SKIP_MESSAGE, forkHealthy } from '../../../test/fork';
import { cardOperations, cards } from '../../db/schema';
import { KEEPER_LAST_NONCE_KEY } from '../../lib/keeper';
import { closeQueues } from '../../lib/queue';
import { closeRedis, getRedis } from '../../lib/redis';
import { dbRef } from '../auth/constants';
import { chainDeps, pollRelayOrders } from '../relay/orders';
import { processOneEvent, submitOne, syncOneCard } from './reconcile';
import { cardSettings } from './settings';
import { bootCards, type Kit } from './testkit';

const healthy = await forkHealthy();
if (!healthy) console.warn(`[skip] ${import.meta.file}: ${FORK_SKIP_MESSAGE}`);

const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168' as const;
const POOL = '0x69bfaf19c9f377bb306a89aed9f6b07e2c1a8d9a' as const;
const stubEnv = readFileSync(
  new URL('../../../../../../docs/deploy/backend.env.dev', import.meta.url),
  'utf8',
).match(/^RELAY_STUB_ADDRESS=(0x[0-9a-fA-F]{40})/m);
if (!stubEnv) throw new Error('RELAY_STUB_ADDRESS missing from backend.env.dev');
const STUB = stubEnv[1]?.toLowerCase() as `0x${string}`;
const user = account(3);
const userAddr = user.address.toLowerCase();
const wallet = createWalletClient({ account: user, chain, transport: http(ANVIL_URL) });
const erc20 = parseAbi(['function transfer(address,uint256) returns (bool)']);

let kit: Kit;
let snapshot: string | undefined;
let liquidityGap = false;
const realChain = { ...chainDeps };

beforeAll(async () => {
  if (!healthy) return;
  snapshot = await rpc<string>('evm_snapshot');
  const code = Bun.spawnSync(
    ['forge', 'inspect', 'src/dev/RelayStubDepository.sol:RelayStubDepository', 'deployedBytecode'],
    {
      cwd: new URL('../../../contracts', import.meta.url).pathname,
    },
  )
    .stdout.toString()
    .trim();
  await rpc('anvil_setCode', [STUB, code]);
  // fund the test user with USDG from the pool (bootstrap approach)
  await rpc('anvil_setBalance', [POOL, '0x56bc75e2d63100000']);
  await rpc('anvil_impersonateAccount', [POOL]);
  const hash = await rpc<string>('eth_sendTransaction', [
    {
      from: POOL,
      to: USDG,
      data: encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [user.address, 500_000_000n] }),
    },
  ]);
  await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` });
  await rpc('anvil_stopImpersonatingAccount', [POOL]);
  await rpc('anvil_setBalance', [user.address, '0x8ac7230489e80000']);

  // fixed test address: clear this module's per-user rate-limit counters from earlier runs
  for (const k of await getRedis().keys('rl:cards_*')) await getRedis().del(k);
  kit = await bootCards({ stepDelayMs: 50 });
  Object.assign(cardSettings, {
    relayMode: 'stub',
    relayStubAddress: STUB,
    usdgAddress: USDG,
    originChainId: 4663,
    relayApiUrl: 'https://api.relay.link',
    relayApiKey: '',
  });
  chainDeps.getReceipt = (hash) => publicClient.getTransactionReceipt({ hash });
  chainDeps.getTransaction = (hash) => publicClient.getTransaction({ hash });
}, 60_000);

afterAll(async () => {
  if (!healthy) return;
  Object.assign(chainDeps, realChain);
  await kit?.stop();
  if (snapshot) await rpc('evm_revert', [snapshot]);
  await getRedis().del(KEEPER_LAST_NONCE_KEY); // reverted chain nonce < remembered last-sent nonce
  await closeQueues().catch(() => {});
  await closeRedis();
});

const json = async (r: Response) => (await r.json()) as any;
const row = async (id: string) =>
  (await dbRef.db.select().from(cardOperations).where(eq(cardOperations.id, id)))[0]!;
async function drain() {
  await kit.mock.hooks.idle();
  for (let i = 0; i < 20; i++) if (!(await processOneEvent())) break;
}

/** Quote (real Relay), sign approve + deposit on the fork, report, poll until the op leaves awaiting_payment. */
async function pay(u: Awaited<ReturnType<Kit['as']>>, opId: string): Promise<boolean> {
  const res = await u.call('POST', `/v1/app/card-operations/${opId}/relay-quote`);
  if (res.status === 409 && (await json(res)).error?.code === 'INSUFFICIENT_LIQUIDITY') {
    liquidityGap = true;
    console.warn('Relay reported INSUFFICIENT_LIQUIDITY for this amount; skipping the dependent assertions');
    return false;
  }
  expect(res.status).toBe(200);
  const quote = await json(res);
  expect(quote.steps.map((s: any) => s.id)).toEqual(['approve', 'deposit']);
  expect(quote.steps[1].items[0].to).toBe(STUB);
  for (const step of quote.steps) {
    const item = step.items[0];
    const hash = await wallet.sendTransaction({ to: item.to, data: item.data, value: BigInt(item.value) });
    await publicClient.waitForTransactionReceipt({ hash });
    const ack = await u.call('POST', `/v1/app/relay-orders/${quote.relayOrderId}/submitted`, {
      step: step.id,
      txHash: hash,
    });
    expect(ack.status).toBe(200);
  }
  await pollRelayOrders();
  return true;
}

describe.skipIf(!healthy)('card flows end to end (mock izipay + real Relay quotes + stub deposit)', () => {
  test('issue -> topup -> reveal -> apple pay -> fault', async () => {
    const u = await kit.as(userAddr);

    // ---- issue
    const created = await json(
      await u.call('POST', '/v1/app/cards', {
        product: 'mastercard',
        email: 'int@example.com',
        alias: 'Int Test',
      }),
    );
    await submitOne();
    const waiting = await json(await u.call('GET', `/v1/app/card-operations/${created.operation.id}`));
    expect(waiting.operation.status).toBe('awaiting_payment');
    expect(waiting.operation.invoice.network).toBe('bsc');
    if (!(await pay(u, created.operation.id))) return;
    // The bridge fill alone is not "issued": the op is processing until the izipay webhooks arrive.
    const mid = await row(created.operation.id);
    expect(['processing', 'completed']).toContain(mid.status);
    await drain();
    expect((await row(created.operation.id)).status).toBe('completed');
    await syncOneCard();
    const list = await json(await u.call('GET', '/v1/app/cards'));
    expect(list[0].status).toBe('issued');
    expect(list[0].last4).toMatch(/^\d{4}$/);
    const cardId = list[0].id as string;

    // ---- top up (TRON)
    const top = await json(
      await u.call('POST', `/v1/app/cards/${cardId}/topups`, { amountUsdCents: '1000' }),
    );
    await submitOne();
    // The mock's TRON addresses are not base58check-valid, which the real Relay rejects: swap in a valid one.
    const topRow = await row(top.operation.id);
    await dbRef.db
      .update(cardOperations)
      .set({ invoice: { ...(topRow.invoice as object), payAddress: 'TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy' } })
      .where(eq(cardOperations.id, top.operation.id));
    const topWaiting = await json(await u.call('GET', `/v1/app/card-operations/${top.operation.id}`));
    expect(topWaiting.operation.invoice.network).toBe('tron');
    if (await pay(u, top.operation.id)) {
      await drain();
      expect((await row(top.operation.id)).status).toBe('completed');
    }

    // ---- reveal
    const reveal = await u.call('POST', `/v1/app/cards/${cardId}/reveal`);
    expect(reveal.status).toBe(200);
    expect(reveal.headers.get('cache-control')).toContain('no-store');
    expect((await json(reveal)).number).toMatch(/^\d{13,19}$/);

    // ---- apple pay OTP
    // izipay sends card.otp on its own (no arm); the mock emits it on demand
    const providerCardId = (await dbRef.db.select().from(cards).where(eq(cards.id, cardId)))[0]
      ?.providerCardId;
    await fetch(`${kit.mock.url}/__mock/otp`, {
      method: 'POST',
      body: JSON.stringify({ card_id: providerCardId }),
    });
    const otp = await json(await u.call('GET', `/v1/app/cards/${cardId}/apple-pay`));
    expect(otp.status).toBe('delivered');
    expect(otp.expiresInSec).toBeGreaterThan(590);
    expect(otp.code).toMatch(/^\d{6}$/);

    // ---- provider fault: 500 on a top-up POST -> review, no retry
    const before = (await row(top.operation.id)).status;
    expect(before).toBe('completed');
    const faulty = await json(
      await u.call('POST', `/v1/app/cards/${cardId}/topups`, { amountUsdCents: '1000' }),
    );
    kit.mock.state.stickyFaults = new Set(['500']);
    await submitOne();
    kit.mock.state.stickyFaults = new Set();
    expect((await row(faulty.operation.id)).status).toBe('review');
    expect(await submitOne()).toBe(false);
    const [card] = await dbRef.db.select().from(cards).where(eq(cards.id, cardId));
    expect(card?.status).toBe('issued');
    expect(liquidityGap).toBe(false);
  }, 120_000);
});
