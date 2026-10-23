import { describe, expect, it } from 'vitest';
import { checkPlan, type Plan } from '../SplitWizard';

const plan = (p: Partial<Plan>): Plan => ({
  claim: false,
  total: '100',
  cardId: 'c1',
  cardUsd: '20',
  token: '0xa',
  stockUsdg: '30',
  ...p,
});
const ctx = { claimable: 52_400_000n, min: 1_000_000n, wallet: 80_000_000n as bigint | undefined };

describe('checkPlan', () => {
  it('computes the kept remainder', () => {
    const c = checkPlan(plan({ total: '50', cardUsd: '20', stockUsdg: '10' }), ctx);
    expect(c.ok).toBe(true);
    expect(c.keptMicros).toBe(20_000_000n);
  });
  it('rejects parts above the total', () => {
    expect(checkPlan(plan({ total: '40', cardUsd: '30', stockUsdg: '30' }), ctx).ok).toBe(false);
  });
  it('limits to the wallet when not claiming and to claimable when claiming', () => {
    expect(checkPlan(plan({ total: '100' }), ctx).ok).toBe(false);
    expect(checkPlan(plan({ claim: true, total: '60', cardUsd: '10', stockUsdg: '10' }), ctx).ok).toBe(false);
    expect(checkPlan(plan({ claim: true, total: '50', cardUsd: '10', stockUsdg: '10' }), ctx).ok).toBe(true);
  });
  it('needs at least one part', () => {
    expect(checkPlan(plan({ cardUsd: '', stockUsdg: '', total: '10' }), ctx).ok).toBe(false);
  });
});
