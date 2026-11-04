import { describe, expect, test } from 'bun:test';
import { chainFor, KNOWN } from '@spindle/shared/chain';
import { type Address, createTestClient, createWalletClient, http, parseEther, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { FORK_SKIP_MESSAGE, forkHealthy } from '../../../test/fork';
import { config } from '../../config';
import { erc20Abi, peripheryAbi, stockAddresses, swapRouter02Abi } from './abi';
import { chainQuoteDeps, quote } from './quote';
import { verifyStockToken } from './verify';

const appChain = chainFor(config.CHAIN_ID);

const healthy = await forkHealthy();
if (!healthy) console.warn(`[skip] ${import.meta.file}: ${FORK_SKIP_MESSAGE}`);

// Runs against the anvil RHC fork (RPC_URLS[0], default 127.0.0.1:7245 when not set).
const rpcUrl = config.RPC_URLS[0] ?? 'http://127.0.0.1:7245';
const NVDA = KNOWN.NVDA.toLowerCase() as Address;
const a = stockAddresses();

const test_ = createTestClient({ chain: appChain, mode: 'anvil', transport: http(rpcUrl) }).extend(
  publicActions,
);
const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const wallet = createWalletClient({ account, chain: appChain, transport: http(rpcUrl) });

describe.skipIf(!healthy)('stocks on the RHC fork', () => {
  test('periphery addresses have code and point at the pinned factory', async () => {
    for (const addr of [a.quoter, a.router]) {
      expect(((await test_.getCode({ address: addr })) ?? '0x').length).toBeGreaterThan(2);
      const f = await test_.readContract({ address: addr, abi: peripheryAbi, functionName: 'factory' });
      expect(f.toLowerCase()).toBe(a.factory);
    }
  });

  test('NVDA verifies against the deepest USDG pool', async () => {
    const v = await verifyStockToken(NVDA);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.symbol).toBe('NVDA');
      expect(v.decimals).toBe(18);
      expect([100, 500, 3000, 10000]).toContain(v.poolFee);
    }
  });

  test('quote 20 USDG -> NVDA, approve + swap executes, NVDA balance > 0', async () => {
    const v = await verifyStockToken(NVDA);
    if (!v.ok) throw new Error(v.reason);
    const row = {
      address: NVDA,
      symbol: v.symbol,
      name: v.name,
      decimals: v.decimals,
      poolFee: v.poolFee,
      poolAddress: v.poolAddress,
      enabled: true,
    };

    // Fund the test account: ETH for gas, 100 USDG moved from the (impersonated) pool.
    await test_.setBalance({ address: account.address, value: parseEther('10') });
    await test_.setBalance({ address: v.poolAddress as Address, value: parseEther('1') });
    await test_.impersonateAccount({ address: v.poolAddress as Address });
    const pool = createWalletClient({
      account: v.poolAddress as Address,
      chain: appChain,
      transport: http(rpcUrl),
    });
    const fundHash = await pool.writeContract({
      address: a.usdg,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [account.address, 100_000_000n],
    });
    await test_.waitForTransactionReceipt({ hash: fundHash });
    await test_.stopImpersonatingAccount({ address: v.poolAddress as Address });

    const q = await quote(
      chainQuoteDeps(async (t) => (t === NVDA ? row : undefined)),
      {
        token: NVDA,
        amountInMicros: '20000000',
        user: account.address,
      },
    );
    expect(BigInt(q.amountOut)).toBeGreaterThan(0n);
    expect(q.priceImpactBps).toBeLessThan(200);
    expect(q.warnImpact).toBe(false);
    expect(q.approve).toBeDefined();

    const before = await test_.readContract({
      address: NVDA,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    });
    const approveHash = await wallet.writeContract({
      address: a.usdg,
      abi: erc20Abi,
      functionName: 'approve',
      args: [q.approve?.args[0] as Address, BigInt(q.approve?.args[1] as string)],
    });
    await test_.waitForTransactionReceipt({ hash: approveHash });

    const swapHash = await wallet.writeContract({
      address: q.swap.to as Address,
      abi: swapRouter02Abi,
      functionName: 'multicall',
      args: [BigInt(q.swap.args[0] as string), q.swap.args[1] as `0x${string}`[]],
    });
    const receipt = await test_.waitForTransactionReceipt({ hash: swapHash });
    expect(receipt.status).toBe('success');

    const after = await test_.readContract({
      address: NVDA,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    });
    expect(after - before).toBeGreaterThanOrEqual(BigInt(q.minOut));
    expect(after).toBeGreaterThan(0n);
  }, 60_000);

  test('a non-curated address (USDG itself) is never quoted', async () => {
    const err = await quote(
      chainQuoteDeps(async () => undefined),
      {
        token: a.usdg,
        amountInMicros: '1000000',
        user: account.address,
      },
    ).catch((e) => e);
    expect(err.status).toBe(400);
  });
});
