import { beforeEach, describe, expect, test } from 'bun:test';
import { config } from '../../config';
import {
  KEEPER_STATUS_KEY,
  type KeeperStatus,
  resetGuardMemo,
  runKeeperGuard,
  type StateDeps,
  x402State,
} from './guard';
import { memKv } from './testing';

const silent = { warn: () => {}, error: () => {}, info: () => {} };
const MIN = BigInt(config.KEEPER_MIN_ETH_WEI);
const CRIT = BigInt(config.KEEPER_CRITICAL_ETH_WEI);

beforeEach(() => resetGuardMemo());

describe('runKeeperGuard', () => {
  test('ok / low / critical levels are persisted; only critical disables x402', async () => {
    for (const [bal, level, enabled] of [
      [MIN * 2n, 'ok', true],
      [MIN - 1n, 'low', true],
      [CRIT - 1n, 'critical', false],
    ] as const) {
      const kv = memKv();
      const s = await runKeeperGuard({ kv, balance: async () => bal, log: silent });
      expect(s.level).toBe(level);
      expect(s.x402Enabled).toBe(enabled);
      expect((kv.data.get(KEEPER_STATUS_KEY) as KeeperStatus).level).toBe(level);
    }
  });
});

describe('x402State', () => {
  const base = (kv = memKv(), over: Partial<StateDeps> = {}): StateDeps => ({
    kv,
    now: () => new Date(),
    enabledInConfig: () => true,
    liveLevel: async () => 'ok',
    surcharge: async () => 7000n,
    ...over,
  });

  test('enabled when keeper ok and price known', async () => {
    expect(await x402State(base())).toEqual({ enabled: true });
  });
  test('disabled by config', async () => {
    expect(await x402State(base(memKv(), { enabledInConfig: () => false }))).toEqual({
      enabled: false,
      reason: 'config',
    });
  });
  test('disabled when the stored keeper status is critical', async () => {
    const kv = memKv();
    await runKeeperGuard({ kv, balance: async () => CRIT - 1n, log: silent });
    expect(await x402State(base(kv))).toEqual({ enabled: false, reason: 'keeper_critical' });
  });
  test('stale status falls back to the live level; failure of both means off', async () => {
    const kv = memKv();
    await kv.set(KEEPER_STATUS_KEY, {
      level: 'ok',
      balanceWei: '1',
      x402Enabled: true,
      checkedAt: '2020-01-01T00:00:00Z',
    });
    expect(await x402State(base(kv, { liveLevel: async () => 'critical' }))).toEqual({
      enabled: false,
      reason: 'keeper_critical',
    });
    expect(
      await x402State(
        base(kv, {
          liveLevel: async () => {
            throw new Error('rpc');
          },
        }),
      ),
    ).toEqual({ enabled: false, reason: 'keeper_unknown' });
  });
  test('unknown ETH price (null surcharge) disables x402', async () => {
    expect(await x402State(base(memKv(), { surcharge: async () => null }))).toEqual({
      enabled: false,
      reason: 'price_unknown',
    });
  });
});
