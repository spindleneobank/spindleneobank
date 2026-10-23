import { describe, expect, test } from 'bun:test';
import { runGasMonitor } from './jobs';
import { type KeeperState, type KvStore, keeperLevel, keeperState, resolveEthUsd } from './service';

const memKv = (): KvStore & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v) };
};
const stateFor = (
  balanceWei: bigint,
  level: KeeperState['level'],
  checkedAt = new Date(0).toISOString(),
): KeeperState => ({
  address: '0x000000000000000000000000000000000000dEaD',
  balanceWei: balanceWei.toString(),
  ethUsdMicros: '2400000000',
  gasPriceWei: '100000000',
  level,
  checkedAt,
});

describe('gas monitor levels', () => {
  test('level thresholds (defaults 0.003 / 0.0015 ETH)', () => {
    expect(keeperLevel(10n ** 16n)).toBe('ok');
    expect(keeperLevel(3_000_000_000_000_000n)).toBe('ok');
    expect(keeperLevel(2_999_999_999_999_999n)).toBe('low');
    expect(keeperLevel(1_500_000_000_000_000n)).toBe('low');
    expect(keeperLevel(1_499_999_999_999_999n)).toBe('critical');
    expect(keeperLevel(0n)).toBe('critical');
  });

  test('runGasMonitor writes kv and logs by level', async () => {
    for (const [level, expected] of [
      ['ok', 'info'],
      ['low', 'warn'],
      ['critical', 'error'],
    ] as const) {
      const kv = memKv();
      const logged: string[] = [];
      const log = {
        info: () => void logged.push('info'),
        warn: () => void logged.push('warn'),
        error: () => void logged.push('error'),
      };
      await runGasMonitor(log, kv, async () => stateFor(1n, level));
      expect(logged).toEqual([expected]);
      expect((kv.data.get('keeper') as KeeperState).level).toBe(level);
    }
  });

  test('keeperState reads stored kv value', async () => {
    const kv = memKv();
    const s = stateFor(5n, 'critical', new Date().toISOString());
    kv.data.set('keeper', s);
    expect(await keeperState(kv)).toEqual(s);
  });

  test('ethUsd never silently 0: keep recent previous, else null', () => {
    const now = new Date('2026-01-01T01:00:00Z');
    const recent = stateFor(1n, 'ok', new Date(now.getTime() - 60_000).toISOString());
    const old = stateFor(1n, 'ok', new Date(now.getTime() - 16 * 60_000).toISOString());
    expect(resolveEthUsd(5n, undefined, now)).toBe('5');
    expect(resolveEthUsd(null, recent, now)).toBe('2400000000');
    expect(resolveEthUsd(null, old, now)).toBeNull();
    expect(resolveEthUsd(null, undefined, now)).toBeNull();
  });
});
