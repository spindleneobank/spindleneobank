import { buyerVaultAbi } from '@spindle/shared/abi';
import { type Address, encodeFunctionData, type Hex, toHex } from 'viem';
import gas from '../../../contracts/gas/settle-gas.json';
import { config } from '../../config';
import { requireAddress } from '../../lib/contracts';
import { getEthUsdMicros } from '../../lib/ethPrice';
import { keeperAccount } from '../../lib/keeper';
import { logger } from '../../lib/logger';
import { publicClient } from '../../lib/viem';
import { type KvStore, pgKv } from '../chain/service';

/**
 * Execution gas per settled item, measured on the fork (C3, contracts/gas/settle-gas.json). On an Orbit chain
 * this EXCLUDES the L1 data component, so the live value is `max(measured, eth_estimateGas delta per item)`.
 */
export const X402_GAS_PER_ITEM = BigInt(gas.perItem);
/** Per-batch fixed gas (C3), amortised over the expected batch size so small batches are not underpriced. */
export const X402_GAS_BASE = BigInt(gas.base);
export const X402_EXPECTED_BATCH_SIZE = 5n;
/** perItem + base / expectedBatchSize (measured execution gas, before the L1 estimate). */
export const X402_GAS_PER_ITEM_EFFECTIVE =
  X402_GAS_PER_ITEM + X402_GAS_BASE / (X402_EXPECTED_BATCH_SIZE > 1n ? X402_EXPECTED_BATCH_SIZE : 1n);
export const SURCHARGE_KV_KEY = 'x402:surcharge';
export const SURCHARGE_MAX_AGE_MS = 15 * 60_000;
const SAMPLE_BATCH = 5;
const WEI = 10n ** 18n;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** `max(min, 2 x gasPerItem x gasPrice x ethUsd)` in USDG micros (rounded up). Pure. */
export function surchargeFormula(i: {
  gasPerItem: bigint;
  gasPriceWei: bigint;
  ethUsdMicros: bigint;
  minMicros: bigint;
}): bigint {
  const raw = ceilDiv(2n * i.gasPerItem * i.gasPriceWei * i.ethUsdMicros, WEI);
  // biome-ignore lint/complexity/useMathMinMax: Math.max does not accept bigint
  return raw > i.minMicros ? raw : i.minMicros;
}

export type SurchargeRecord = {
  /** null = ETH price unknown and no recent value: x402 must stay off. */
  surchargeMicros: string | null;
  gasPerItem: string;
  gasPriceWei: string;
  ethUsdMicros: string | null;
  gasSource: 'estimate' | 'measured';
  checkedAt: string;
};

/** A representative settle batch: `n` items with realistic calldata sizes (signature 65 bytes). */
export function sampleSettleCalldata(n: number, vaultToken: Address, payer: Address): Hex {
  const items = Array.from({ length: n }, (_, i) => ({
    permit: {
      permitted: { token: vaultToken, amount: 1_000_000n },
      nonce: (1n << 200n) + BigInt(i),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    },
    payer,
    paymentId: toHex(BigInt(i + 1) << 128n, { size: 32 }),
    surcharge: 5000n,
    validAfter: 0n,
    used: 1000n,
    signature: `0x${'11'.repeat(65)}` as Hex,
  }));
  return encodeFunctionData({ abi: buyerVaultAbi, functionName: 'settle', args: [items] });
}

export type SurchargeDeps = {
  kv: KvStore;
  now: () => Date;
  ethUsdMicros: () => Promise<bigint>;
  gasPriceWei: () => Promise<bigint>;
  /** eth_estimateGas (total gas, includes the L1 component on Arbitrum chains) for a batch of n sample items. */
  estimateBatchGas: (n: number) => Promise<bigint>;
  minMicros: bigint;
};

export const defaultSurchargeDeps: SurchargeDeps = {
  kv: pgKv,
  now: () => new Date(),
  ethUsdMicros: getEthUsdMicros,
  gasPriceWei: () => publicClient.getGasPrice(),
  estimateBatchGas: (n) =>
    publicClient.estimateGas({
      account: keeperAccount().address,
      to: requireAddress('vault'),
      data: sampleSettleCalldata(
        n,
        (config.USDG_ADDRESS ?? '0x5fc5360d0400a0fd4f2af552add042d716f1d168') as Address,
        '0x00000000000000000000000000000000000000a1',
      ),
    }),
  minMicros: BigInt(config.X402_MIN_SURCHARGE_MICROS),
};

/** Total-gas-per-item: the larger of the measured execution gas and the estimateGas slope (n=5 vs n=1). */
export async function gasPerItem(deps: Pick<SurchargeDeps, 'estimateBatchGas'>): Promise<{
  value: bigint;
  source: 'estimate' | 'measured';
}> {
  try {
    const [one, many] = await Promise.all([deps.estimateBatchGas(1), deps.estimateBatchGas(SAMPLE_BATCH)]);
    const slope = (many - one) / BigInt(SAMPLE_BATCH - 1);
    // the estimate slope has no fixed batch cost, so amortise the measured base on top of it as well
    const est = slope + X402_GAS_BASE / X402_EXPECTED_BATCH_SIZE;
    if (est > X402_GAS_PER_ITEM_EFFECTIVE) return { value: est, source: 'estimate' };
  } catch (err) {
    logger.warn({ err: String(err) }, 'x402: settle gas estimate unavailable; using measured gas per item');
  }
  return { value: X402_GAS_PER_ITEM_EFFECTIVE, source: 'measured' };
}

/** Recompute and persist kv('x402:surcharge'). A failed price read keeps the previous value for 15 min. */
export async function refreshSurcharge(deps: SurchargeDeps = defaultSurchargeDeps): Promise<SurchargeRecord> {
  const now = deps.now();
  const prev = (await deps.kv.get(SURCHARGE_KV_KEY).catch(() => undefined)) as SurchargeRecord | undefined;
  const [gasPrice, ethUsd, g] = await Promise.all([
    deps.gasPriceWei().catch(() => null),
    deps.ethUsdMicros().catch(() => null),
    gasPerItem(deps),
  ]);
  const prevFresh = prev?.ethUsdMicros && now.getTime() - Date.parse(prev.checkedAt) < SURCHARGE_MAX_AGE_MS;
  const eth = ethUsd ?? (prevFresh ? BigInt(prev.ethUsdMicros as string) : null);
  const price = gasPrice ?? (prevFresh ? BigInt(prev.gasPriceWei) : null);
  const rec: SurchargeRecord = {
    surchargeMicros:
      eth !== null && price !== null
        ? surchargeFormula({
            gasPerItem: g.value,
            gasPriceWei: price,
            ethUsdMicros: eth,
            minMicros: deps.minMicros,
          }).toString()
        : null,
    gasPerItem: g.value.toString(),
    gasPriceWei: (price ?? 0n).toString(),
    ethUsdMicros: eth === null ? null : eth.toString(),
    gasSource: g.source,
    checkedAt: now.toISOString(),
  };
  await deps.kv.set(SURCHARGE_KV_KEY, rec);
  memo = undefined;
  return rec;
}

let memo: { at: number; value: bigint | null } | undefined;
export const resetSurchargeMemo = () => {
  memo = undefined;
};

/**
 * Current surcharge in USDG micros, or null when it cannot be determined safely (x402 then stays off).
 * Served from kv('x402:surcharge'); recomputed inline when missing or older than 15 minutes.
 */
export async function currentSurchargeMicros(
  deps: SurchargeDeps = defaultSurchargeDeps,
): Promise<bigint | null> {
  if (memo && Date.now() - memo.at < 5000) return memo.value;
  let rec = (await deps.kv.get(SURCHARGE_KV_KEY).catch(() => undefined)) as SurchargeRecord | undefined;
  if (!rec || deps.now().getTime() - Date.parse(rec.checkedAt) >= SURCHARGE_MAX_AGE_MS) {
    rec = await refreshSurcharge(deps).catch(() => undefined);
  }
  const value = rec?.surchargeMicros ? BigInt(rec.surchargeMicros) : null;
  memo = { at: Date.now(), value };
  return value;
}
