import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { billingClass, setStakingParamsForTest } from './service';

describe('billingClass (M-5)', () => {
  beforeAll(() => {
    setStakingParamsForTest({
      token: '0x00000000000000000000000000000000000000c3',
      minStakeByClass: { '0': '50', '1': '100', '2': '200', '3': '300', '4': '400' },
      unstakeDelay: 604800,
    });
  });
  afterAll(() => setStakingParamsForTest(null));

  test('no stake bills at class 0 whatever is claimed', () => {
    for (const c of [0, 1, 2, 3, 4]) expect(billingClass(c, 0n, 'open')).toBe(0);
  });
  test('the class minimum unlocks that class', () => {
    expect(billingClass(2, 199n, 'open')).toBe(1);
    expect(billingClass(2, 200n, 'open')).toBe(2);
  });
  test('stake covers only as far as the claim', () => {
    expect(billingClass(1, 1000n, 'open')).toBe(1);
    expect(billingClass(0, 1000n, 'open')).toBe(0);
  });
  test('partial stake bills at the highest class it covers', () => {
    expect(billingClass(4, 250n, 'open')).toBe(2);
    expect(billingClass(4, 99n, 'open')).toBe(0);
  });
  test('sealed jobs are priced by attested hardware', () => {
    expect(billingClass(3, 0n, 'sealed')).toBe(3);
  });
  test('an unknown minimum never unlocks a class', () => {
    setStakingParamsForTest(null);
    expect(billingClass(2, 1000n, 'open')).toBe(0);
    setStakingParamsForTest({
      token: '0x00000000000000000000000000000000000000c3',
      minStakeByClass: { '0': '50', '1': '100', '2': '200', '3': '300', '4': '400' },
      unstakeDelay: 604800,
    });
  });
});
