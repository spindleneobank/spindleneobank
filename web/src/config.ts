import { defineChain } from 'viem';
import { chainName } from '@spindle/shared/chain';
import { env } from './env';

export { env } from './env';

export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;

/** The app chain: 4663 in prod; in dev the RPC points at the anvil fork, which uses chain id 31337. */
export const chain = defineChain({
  id: env.chainId,
  name: chainName(env.chainId),
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [env.rpcUrl] } },
  blockExplorers: { default: { name: 'Blockscout', url: env.explorerUrl } },
  contracts: { multicall3: { address: MULTICALL3 } },
});

export const explorerTx = (hash: string) => `${env.explorerUrl}/tx/${hash}`;
export const explorerAddress = (address: string) => `${env.explorerUrl}/address/${address}`;
