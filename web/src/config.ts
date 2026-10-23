import { defineChain } from 'viem';
import { env } from './env';

export { env } from './env';

export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;

/** Only chain 4663 exists. In dev the RPC points at the anvil fork (same chain id). */
export const chain = defineChain({
  id: env.chainId,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [env.rpcUrl] } },
  blockExplorers: { default: { name: 'Blockscout', url: env.explorerUrl } },
  contracts: { multicall3: { address: MULTICALL3 } },
});

export const explorerTx = (hash: string) => `${env.explorerUrl}/tx/${hash}`;
export const explorerAddress = (address: string) => `${env.explorerUrl}/address/${address}`;
