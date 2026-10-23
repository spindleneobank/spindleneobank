import { defineChain } from 'viem';

export const RHC_CHAIN_ID = 4663;

export const rhc = defineChain({
  id: RHC_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: {
    default: { name: 'Robinhood Chain Explorer', url: 'https://explorer.mainnet.chain.robinhood.com' },
  },
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
});

/** Canonical on-chain addresses on Robinhood Chain (4663). Existence verified via eth_getCode 2026-10-23. */
export const KNOWN = {
  USDG: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  PERMIT2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  ERC8004_IDENTITY: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  ERC8004_REPUTATION: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  UNISWAP_V3_FACTORY: '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA',
  WETH: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
  USDG_WETH_POOL_500: '0x69bfaf19c9f377bb306a89aed9f6b07e2c1a8d9a',
  USDG_WETH_POOL_3000: '0xa9188730fe85be88ad499d7d52b099e800fb0334',
  NVDA: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC',
} as const;
