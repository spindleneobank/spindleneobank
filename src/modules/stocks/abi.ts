import { KNOWN } from '@spindle/shared/chain';
import { parseAbi } from 'viem';
import { config } from '../../config';

export { erc20Abi, quoterV2Abi, swapRouter02Abi, uniswapV3PoolAbi } from '@spindle/shared/abi';

export const factoryAbi = parseAbi([
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
  'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)',
]);

/** Router/quoter expose `factory()`; used to verify the pinned periphery addresses on-chain. */
export const peripheryAbi = parseAbi(['function factory() view returns (address)']);

export const FEE_TIERS = [100, 500, 3000, 10000] as const;

/**
 * Official Uniswap v3 periphery on Robinhood Chain (4663), from Uniswap/sdks
 * `sdk-core/src/addresses.ts` ROBINHOOD_ADDRESSES. Both verified on-chain: have code and
 * `factory()` == UNISWAP_V3_FACTORY (see quote.int.test.ts). Env vars override.
 */
export const PINNED = {
  QUOTER: '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7',
  ROUTER: '0xcaf681a66d020601342297493863e78c959e5cb2',
} as const;

const lower = (a: string) => a.toLowerCase() as `0x${string}`;

export function stockAddresses() {
  return {
    usdg: lower(config.USDG_ADDRESS ?? KNOWN.USDG),
    factory: lower(config.UNISWAP_V3_FACTORY ?? KNOWN.UNISWAP_V3_FACTORY),
    quoter: lower(config.UNISWAP_V3_QUOTER ?? PINNED.QUOTER),
    router: lower(config.UNISWAP_V3_ROUTER ?? PINNED.ROUTER),
  };
}
