import { erc20Abi } from '@spindle/shared/abi';
import { rhc } from '@spindle/shared/chain';
import { createPublicClient, createWalletClient, http } from 'viem';
import { account } from '../../dev/lib/accounts';
import { addr, RPC } from './env';

export const chain = { ...rhc, rpcUrls: { default: { http: [RPC] } } };
export const pub = createPublicClient({ chain, transport: http(RPC) });
export const wallet = (i: number) => createWalletClient({ account: account(i), chain, transport: http(RPC) });
export const USDG = () => addr('USDG_ADDRESS');
export const SPDL = () => addr('SPDL_ADDRESS');

export async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result as T;
}
export const mine = (n: number) => rpc('anvil_mine', [`0x${n.toString(16)}`]);
export const increaseTime = async (s: number) => {
  await rpc('evm_increaseTime', [s]);
  await rpc('evm_mine');
};
export const setBalance = (a: string, wei: bigint) => rpc('anvil_setBalance', [a, `0x${wei.toString(16)}`]);
export const head = async () => Number(await pub.getBlockNumber({ cacheTime: 0 } as never));
export const usdgOf = (a: `0x${string}`) =>
  pub.readContract({
    address: USDG(),
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [a],
  }) as Promise<bigint>;
export const wait = (hash: `0x${string}`) => pub.waitForTransactionReceipt({ hash });
export async function ok(hash: `0x${string}`) {
  const r = await wait(hash);
  if (r.status !== 'success') throw new Error(`tx reverted ${hash}`);
  return r;
}
/** Chain time must not lag the wall clock (API signs validAfter/deadline from wall time). */
export async function syncTime() {
  const now = Math.floor(Date.now() / 1000);
  const b = await pub.getBlock({ blockTag: 'latest' });
  if (Number(b.timestamp) >= now) return;
  await rpc('evm_setNextBlockTimestamp', [now]);
  await rpc('evm_mine');
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function until<T>(
  fn: () => Promise<T | undefined | false | null>,
  ms = 60_000,
  every = 1500,
): Promise<T> {
  const end = Date.now() + ms;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(every);
  }
  throw new Error(`timeout after ${ms}ms${last ? `: ${String(last)}` : ''}`);
}
