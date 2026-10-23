import { spindleRegistryAbi, spindleStakingAbi, erc20Abi } from '@spindle/shared/abi';
import { addr } from './env';
import type { Session } from './api';
import { ok, wallet, until } from './chain';

/** Registers a node on-chain from its owner account using the API's register-call data; waits for the indexer. */
export async function registerNode(s: Session, nodeId: string) {
  const call = await s.get(`/v1/app/nodes/${nodeId}/register-call`);
  const w = wallet(s.index);
  const hash = await w.writeContract({
    address: call.to,
    abi: spindleRegistryAbi,
    functionName: 'registerNode',
    args: call.args.map((a: unknown, i: number) => (i === 1 ? Number(a) : i === 4 ? BigInt(a as string) : a)) as never,
  });
  const r = await ok(hash);
  return { hash, block: Number(r.blockNumber) };
}

export async function stakeNode(s: Session, nodeId: string, amountMicros: string) {
  const c = await s.get(`/v1/app/nodes/${nodeId}/stake-call?amount=${amountMicros}`);
  const w = wallet(s.index);
  const hashes: `0x${string}`[] = [];
  const conv = (args: unknown[]) => args.map((a) => (typeof a === 'string' && /^\d+$/.test(a) ? BigInt(a) : a));
  if (c.approve) {
    hashes.push(await w.writeContract({ address: c.approve.to, abi: erc20Abi, functionName: 'approve', args: conv(c.approve.args) as never }));
    await ok(hashes[0] as `0x${string}`);
  }
  const h = await w.writeContract({ address: c.stake.to, abi: spindleStakingAbi, functionName: c.stake.functionName ?? 'stake', args: conv(c.stake.args) as never });
  await ok(h);
  hashes.push(h);
  return hashes;
}
export { addr, until };
