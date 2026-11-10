import { afterEach, beforeEach, expect, test } from 'bun:test';
import { addressOverrides, stakingEnabled } from '../../lib/contracts';
import { viemIndexerClient } from '../indexer/indexer';
import { billingClass, isStakedAsync, setStakingParamsForTest, stakingParams } from './service';

// A NO_STAKING deployment leaves STAKING_ADDRESS and SPDL_ADDRESS unset.
beforeEach(() => {
  setStakingParamsForTest(null);
  addressOverrides.staking = undefined;
  addressOverrides.spdl = undefined;
});
afterEach(() => {
  delete addressOverrides.staking;
  delete addressOverrides.spdl;
});

test('staking is off when either address is missing', () => {
  expect(stakingEnabled()).toBe(false);
  addressOverrides.staking = '0x00000000000000000000000000000000000000c4';
  expect(stakingEnabled()).toBe(false);
  addressOverrides.spdl = '0x00000000000000000000000000000000000000c3';
  expect(stakingEnabled()).toBe(true);
});

test('params say disabled without touching the chain', async () => {
  expect(await stakingParams(true)).toEqual({
    enabled: false,
    token: null,
    minStakeByClass: {},
    unstakeDelay: 0,
  });
});

test('every node is unstaked and priced at class 0', async () => {
  expect(await isStakedAsync({ stakeSpdl: '1000000000000000000000000', gpuClass: 2 })).toBe(false);
  await stakingParams(true);
  expect(billingClass(3, 10n ** 30n, 'open')).toBe(0);
});

test('the indexer reads a zero stake instead of failing', async () => {
  expect(await viemIndexerClient().readStake(1n, 1n)).toEqual({ active: 0n, pending: 0n });
});
