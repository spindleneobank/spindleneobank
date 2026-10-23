/**
 * x402 against the anvil RHC fork and the locally deployed BuyerVault (`bun run dev:bootstrap`):
 * challenge -> real Permit2 witness signature -> authorize -> batch settle through the keeper module ->
 * Settled event, 80/20 vault split, surcharge to the treasury, and one revoked-allowance item that
 * only fails itself (SettleFailed, payer barred).
 * Skipped while the fork is unhealthy or nothing is deployed.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { erc20Abi } from '@spindle/shared/abi';
import { KNOWN, rhc } from '@spindle/shared/chain';
import { type Address, createWalletClient, type Hex, http, maxUint256 } from 'viem';
import { account } from '../../../dev/lib/accounts';
import { readDeployment } from '../../../dev/lib/chain';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { FORK_SKIP_MESSAGE, forkHealthy, syncChainTime } from '../../../test/fork';
import { x402Payments } from '../../db/schema';
import { createKeeper } from '../../lib/keeper';
import { closeRedis, getRedis } from '../../lib/redis';
import { publicClient } from '../../lib/viem';
import { encodeHeader, spindlePaymentTypedData, X402Challenge } from '../../shared/x402';
import { dbRef } from '../auth/constants';
import {
  type Authorization,
  type AuthorizeCtx,
  type Challenge,
  unregisterPaymentProvider,
} from '../gateway/payment';
import { addressOverride } from './challenge';
import { defaultStateDeps } from './guard';
import { x402Provider } from './provider';
import { defaultSettleDeps, runSettle } from './settle';
import { defaultSurchargeDeps, refreshSurcharge, resetSurchargeMemo } from './surcharge';
import { memKv } from './testing';
import { BARRED_KEY, resetPayerCache } from './verify';

// anvil auto-mines every 2s: setup txs wait for blocks
setDefaultTimeout(120_000);

const dep = readDeployment();
const healthy = (await forkHealthy()) && dep !== null;
if (!healthy) console.warn(`[skip] ${import.meta.file}: ${FORK_SKIP_MESSAGE} (or no local deployment)`);

const rpcUrl = process.env.ANVIL_URL ?? process.env.RPC_URLS?.split(',')[0] ?? 'http://127.0.0.1:7245';
const USDG = (dep?.addresses.usdg ?? KNOWN.USDG) as Address;
const PERMIT2 = (dep?.addresses.permit2 ?? KNOWN.PERMIT2) as Address;
const VAULT = dep?.addresses.vault as Address;
const CLAIMS = dep?.addresses.claims as Address;
const TREASURY = account(2).address; // anvil role: guardian + treasury
const keeperAcct = account(1);
const [P0, P1, P2] = [account(3), account(4), account(5)] as const; // never the deployer/keeper/treasury accounts
const payers = [P0, P1, P2];

let t: TestDb;
const bal = (a: Address) =>
  publicClient.readContract({ address: USDG, abi: erc20Abi, functionName: 'balanceOf', args: [a] });
const ctx = (max: bigint): AuthorizeCtx => ({
  jobId: crypto.randomUUID(),
  model: 'm',
  kind: 'chat',
  lane: 'open',
  maxChargeMicros: max,
  priceBasis: { unitKind: 'tokens_1m', buyerMicrosPerUnit: 100_000n, maxTokens: 1024 },
});
const fakeCtx = (headers: Record<string, string> = {}) =>
  ({
    req: {
      header: (n: string) => headers[n.toLowerCase()],
      url: 'http://api.test/v1/chat/completions',
      path: '/v1/chat/completions',
    },
    header: () => {},
  }) as never;

describe.skipIf(!healthy)('x402 on the RHC fork', () => {
  beforeAll(async () => {
    await syncChainTime();
    t = await setupTestDb();
    dbRef.db = t.db;
    addressOverride.current = {
      usdg: USDG.toLowerCase() as Address,
      vault: VAULT.toLowerCase() as Address,
      permit2: PERMIT2.toLowerCase() as Address,
    };
    const kv = memKv();
    Object.assign(defaultSurchargeDeps, { kv });
    Object.assign(defaultStateDeps, {
      kv,
      enabledInConfig: () => true,
      liveLevel: async () => 'ok' as const,
    });
    // approve USDG -> Permit2 once per payer (normal txs paid by the payer)
    for (const p of payers) {
      const w = createWalletClient({ account: p, chain: rhc, transport: http(rpcUrl) });
      const h = await w.writeContract({
        address: USDG,
        abi: erc20Abi,
        functionName: 'approve',
        args: [PERMIT2, maxUint256],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }
    resetPayerCache();
    resetSurchargeMemo();
    await t.reset();
    await getRedis().del(BARRED_KEY);
  });
  afterAll(async () => {
    addressOverride.current = undefined;
    unregisterPaymentProvider('x402'); // importing provider.ts registers it process-wide; other suites expect none
    await t?.close();
    await closeRedis();
  });

  test('live surcharge covers 2x measured settle gas at the current gas price (records total gas per item)', async () => {
    const rec = await refreshSurcharge({
      ...defaultSurchargeDeps,
      estimateBatchGas: defaultSurchargeDeps.estimateBatchGas,
    });
    console.log('[x402] surcharge record', JSON.stringify(rec));
    expect(rec.surchargeMicros).not.toBeNull();
    expect(BigInt(rec.surchargeMicros as string)).toBeGreaterThanOrEqual(5000n);
  });

  test('exact payments settle through BuyerVault: 80/20 split, surcharge to treasury, one bad item isolated', async () => {
    const surcharge = BigInt((await refreshSurcharge()).surchargeMicros as string);
    const used = [60_000n, 90_000n, 40_000n];
    const auths: Authorization[] = [];
    for (const [i, p] of payers.entries()) {
      const ch = (await x402Provider.authorize(fakeCtx(), ctx(200_000n))) as Challenge;
      const body = X402Challenge.parse(ch.body);
      const acc = body.accepts[0];
      if (!acc) throw new Error('no accept');
      const e = acc.extra;
      const signature = await p.signTypedData(
        spindlePaymentTypedData({
          chainId: 4663,
          token: USDG,
          cap: BigInt(acc.amount),
          spender: VAULT,
          nonce: BigInt(e.nonce),
          deadline: BigInt(e.deadline),
          paymentId: e.paymentId as Hex,
          surcharge: BigInt(e.surcharge),
          validAfter: BigInt(e.validAfter),
        }),
      );
      const header = encodeHeader({
        x402Version: 2,
        scheme: 'exact',
        network: 'eip155:4663',
        payload: {
          payer: p.address,
          paymentId: e.paymentId,
          permit: { permitted: { token: USDG, amount: acc.amount }, nonce: e.nonce, deadline: e.deadline },
          witness: { paymentId: e.paymentId, surcharge: e.surcharge, validAfter: e.validAfter },
          signature,
        },
      });
      const a = (await x402Provider.authorize(
        fakeCtx({ 'x-payment': header }),
        ctx(200_000n),
      )) as Authorization;
      await x402Provider.finalize(a, used[i] as bigint);
      auths.push(a);
    }
    // payer #2 revokes its Permit2 allowance after signing -> only its item fails
    const w = createWalletClient({ account: P1, chain: rhc, transport: http(rpcUrl) });
    await publicClient.waitForTransactionReceipt({
      hash: await w.writeContract({
        address: USDG,
        abi: erc20Abi,
        functionName: 'approve',
        args: [PERMIT2, 0n],
      }),
    });

    const before = { treasury: await bal(TREASURY), claims: await bal(CLAIMS), vault: await bal(VAULT) };
    const keeper = createKeeper({
      redis: getRedis,
      account: () => keeperAcct,
      client: publicClient,
      wallet: (a) => createWalletClient({ account: a, chain: rhc, transport: http(rpcUrl) }) as never,
      receiptTimeoutMs: 60_000,
    });
    const sum = await runSettle({
      ...defaultSettleDeps,
      send: keeper.sendKeeperTx,
      vault: () => VAULT,
      keeperBalanceWei: async () => 10n ** 18n,
    });
    expect(sum).toMatchObject({ settled: 2, failed: 1 });

    const rows = await dbRef.db.select().from(x402Payments);
    const by = new Map(rows.map((r) => [r.payer, r]));
    expect(by.get(P0.address.toLowerCase())?.status).toBe('settled');
    expect(by.get(P2.address.toLowerCase())?.status).toBe('settled');
    expect(by.get(P1.address.toLowerCase())?.status).toBe('failed');
    expect(await getRedis().sismember(BARRED_KEY, P1.address.toLowerCase())).toBe(1);

    const totalUsed = (used[0] as bigint) + (used[2] as bigint);
    const toClaims = ((used[0] as bigint) * 8000n) / 10000n + ((used[2] as bigint) * 8000n) / 10000n;
    const toTreasury = totalUsed - toClaims + 2n * surcharge;
    expect((await bal(CLAIMS)) - before.claims).toBe(toClaims);
    expect((await bal(TREASURY)) - before.treasury).toBe(toTreasury);
    expect(await bal(VAULT)).toBe(before.vault); // vault keeps nothing
    expect(auths).toHaveLength(3);
  });
});
