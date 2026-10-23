/**
 * Fork health probe for integration tests that read upstream (Robinhood Chain) state through the shared anvil
 * fork. When the fork's upstream RPC prunes state (public RPC ~10 min) unseeded slots fail with
 * "historical state not available"; those suites skip instead of failing.
 */
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const POOL = '0x69bfaf19c9f377bb306a89aed9f6b07e2c1a8d9a';

async function call(url: string, method: string, params: unknown[], ms: number): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(ms),
  });
  const j = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

/** True when the fork answers, has code at known upstream contracts and can read an unseeded upstream slot. */
export async function forkHealthy(
  url = process.env.ANVIL_URL ?? process.env.RPC_URLS?.split(',')[0] ?? 'http://127.0.0.1:7245',
  timeoutMs = 4000,
): Promise<boolean> {
  try {
    for (const addr of [USDG, POOL]) {
      const code = (await call(url, 'eth_getCode', [addr, 'latest'], timeoutMs)) as string;
      if (!code || code === '0x') return false;
    }
    const rnd = `${'0'.repeat(24)}${crypto.randomUUID().replaceAll('-', '').padEnd(40, '0').slice(0, 40)}`;
    await call(url, 'eth_call', [{ to: USDG, data: `0x70a08231${rnd}` }, 'latest'], timeoutMs);
    return true;
  } catch {
    return false;
  }
}

export const FORK_SKIP_MESSAGE =
  'anvil fork unhealthy (stale upstream: "historical state not available"); skipping fork-dependent suite';

/**
 * Align the fork's block time with the wall clock. After evm_revert / evm_increaseTime in other suites the chain can lag
 * (or lead) real time, and API-signed windows (x402 validAfter/deadline) are computed from the wall clock.
 */
export async function syncChainTime(url = process.env.ANVIL_URL ?? 'http://127.0.0.1:7245'): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const latest = (await call(url, 'eth_getBlockByNumber', ['latest', false], 4000)) as { timestamp: string };
  if (Number(latest.timestamp) >= now) return;
  await call(url, 'evm_setNextBlockTimestamp', [now], 4000);
  await call(url, 'evm_mine', [], 4000);
}
