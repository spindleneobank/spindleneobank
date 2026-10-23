import { config } from '../../config';
import { keeperBalance } from '../../lib/keeper';
import { logger } from '../../lib/logger';
import { type KeeperLevel, type KvStore, keeperLevel, keeperState, pgKv } from '../chain/service';
import { currentSurchargeMicros } from './surcharge';

export const KEEPER_STATUS_KEY = 'keeper:status';
export const STATUS_MAX_AGE_MS = 15 * 60_000;
export const DISABLED_MESSAGE = 'x402 temporarily unavailable — use an API key with prepaid balance';

export type KeeperStatus = {
  level: KeeperLevel;
  balanceWei: string;
  x402Enabled: boolean;
  checkedAt: string;
};

/**
 * One guard run (every 5 min): read the keeper's ETH balance and persist kv('keeper:status').
 * `ok` -> enabled; `low` -> warning only; `critical` -> x402 disabled. There is deliberately no refill logic:
 * the owner tops the keeper up manually.
 */
export async function runKeeperGuard(
  deps: {
    kv?: KvStore;
    balance?: () => Promise<bigint>;
    now?: () => Date;
    log?: Pick<typeof logger, 'warn' | 'error' | 'info'>;
  } = {},
): Promise<KeeperStatus> {
  const kv = deps.kv ?? pgKv;
  const log = deps.log ?? logger;
  const balance = await (deps.balance ?? keeperBalance)();
  const level = keeperLevel(balance);
  const status: KeeperStatus = {
    level,
    balanceWei: balance.toString(),
    x402Enabled: level !== 'critical',
    checkedAt: (deps.now ?? (() => new Date()))().toISOString(),
  };
  if (level === 'critical')
    log.error(
      { balanceWei: status.balanceWei },
      'keeper ETH critical: x402 disabled until the owner refills',
    );
  else if (level === 'low') log.warn({ balanceWei: status.balanceWei }, 'keeper ETH low: please refill');
  await kv.set(KEEPER_STATUS_KEY, status);
  memo = undefined;
  return status;
}

export type X402State = {
  enabled: boolean;
  reason?: 'config' | 'keeper_critical' | 'keeper_unknown' | 'price_unknown';
};

let memo: { at: number; state: X402State } | undefined;
export const resetGuardMemo = () => {
  memo = undefined;
};

export type StateDeps = {
  kv: KvStore;
  now: () => Date;
  enabledInConfig: () => boolean;
  /** Fallback when kv('keeper:status') is missing or stale. */
  liveLevel: () => Promise<KeeperLevel>;
  surcharge: () => Promise<bigint | null>;
};
/** Mutable so tests can swap the pieces. */
export const defaultStateDeps: StateDeps = {
  kv: pgKv,
  now: () => new Date(),
  enabledInConfig: () => config.X402_ENABLED,
  liveLevel: async () => (await keeperState()).level,
  surcharge: () => currentSurchargeMicros(),
};

/** Whether new x402 payments may be offered/accepted right now. Unknown keeper/price state means off. */
export async function x402State(
  deps: StateDeps = defaultStateDeps,
  cache = deps === defaultStateDeps,
): Promise<X402State> {
  if (cache && memo && Date.now() - memo.at < 10_000) return memo.state;
  const state = await compute(deps);
  if (cache) memo = { at: Date.now(), state };
  return state;
}

async function compute(deps: StateDeps): Promise<X402State> {
  if (!deps.enabledInConfig()) return { enabled: false, reason: 'config' };
  let level: KeeperLevel;
  try {
    const stored = (await deps.kv.get(KEEPER_STATUS_KEY).catch(() => undefined)) as KeeperStatus | undefined;
    level =
      stored && deps.now().getTime() - Date.parse(stored.checkedAt) < STATUS_MAX_AGE_MS
        ? stored.level
        : await deps.liveLevel();
  } catch {
    return { enabled: false, reason: 'keeper_unknown' };
  }
  if (level === 'critical') return { enabled: false, reason: 'keeper_critical' };
  const s = await deps.surcharge().catch(() => null);
  if (s === null) return { enabled: false, reason: 'price_unknown' };
  return { enabled: true };
}

/** For `GET /v1/app/buyer` (B5's buyer route): `{ enabled, minSurchargeMicros, currentSurchargeMicros }`. */
export async function x402Status(): Promise<{
  enabled: boolean;
  minSurchargeMicros: string;
  currentSurchargeMicros: string;
}> {
  const min = BigInt(config.X402_MIN_SURCHARGE_MICROS);
  const [state, s] = await Promise.all([x402State(), currentSurchargeMicros().catch(() => null)]);
  return {
    enabled: state.enabled,
    minSurchargeMicros: min.toString(),
    currentSurchargeMicros: (s ?? min).toString(),
  };
}
