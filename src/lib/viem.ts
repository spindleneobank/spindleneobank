import { chainFor } from '@spindle/shared/chain';
import { createPublicClient, custom } from 'viem';
import { config } from '../config';
import { rpc } from './rpcPool';

/** The chain the app talks to: 4663 in prod, 31337 on the dev fork. */
export const appChain = chainFor(config.CHAIN_ID);

function poolTransport(options?: Parameters<typeof rpc>[2]) {
  return custom({
    request: ({ method, params }) => rpc(method, (params as unknown[] | undefined) ?? [], options),
  });
}

/** General-purpose reads over the RPC pool (multicall batching on). */
export const publicClient = createPublicClient({
  chain: appChain,
  transport: poolTransport(),
  batch: { multicall: true },
});

/** Indexer client: same pool; `eth_getLogs` is routed to the public endpoint first by the pool. */
export const logsClient = createPublicClient({
  chain: appChain,
  transport: poolTransport(),
});

/** Latest block number, or null when the pool cannot serve it (never throws). */
export async function getBlockNumberSafe(): Promise<bigint | null> {
  try {
    return await publicClient.getBlockNumber();
  } catch {
    return null;
  }
}
