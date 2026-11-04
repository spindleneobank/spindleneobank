import { expect, test } from 'bun:test';
import {
  type Artifact,
  type Chain,
  CONTRACTS,
  type Manifest,
  maskImmutables,
  verifyDeployment,
} from '../scripts/verify-deploy';

const addr = (n: number) => `0x${String(n).padStart(40, '0')}`;
const artifact: Artifact = {
  deployedBytecode: { object: '0x6001aaaa6002', immutableReferences: { '7': [{ start: 2, length: 2 }] } },
};
const artifacts = Object.fromEntries(Object.values(CONTRACTS).map((n) => [n, artifact]));
const manifest: Manifest = {
  chainId: 4663,
  addresses: {
    usdg: addr(1),
    permit2: addr(2),
    spdl: addr(3),
    erc8004Identity: addr(4),
    registry: addr(5),
    staking: addr(6),
    claims: addr(7),
    vault: addr(8),
  },
  args: {
    treasury: addr(9),
    keeper: addr(10),
    guardian: addr(11),
    slasher: addr(12),
    slashRecipient: addr(13),
    maxEpochIncrease: '5000000000',
    claimDelay: 3600,
    minStake0: 1,
    minStake1: 2,
    minStake2: 3,
    minStake3: 4,
    minStake4: 5,
  },
};
const honest = (over: Partial<Record<string, unknown>> = {}, code = '0x6001bbbb6002'): Chain => ({
  chainId: async () => 4663,
  code: async () => code,
  read: async (address, signature, args) => {
    const fn = signature.split(' ')[1]?.split('(')[0] as string;
    if (`${address}.${fn}` in over) return over[`${address}.${fn}`];
    if (fn === 'minStake') return BigInt((args?.[0] as number) + 1);
    const a = manifest.args;
    const m = manifest.addresses;
    const table: Record<string, unknown> = {
      usdg: m.usdg,
      poster: a.keeper,
      guardian: a.guardian,
      maxEpochIncrease: 5000000000n,
      claimDelay: 3600n,
      permit2: m.permit2,
      claims: m.claims,
      treasury: a.treasury,
      settler: a.keeper,
      spdl: m.spdl,
      registry: m.registry,
      slasher: a.slasher,
      slashRecipient: a.slashRecipient,
      identityRegistry: m.erc8004Identity,
    };
    return table[fn];
  },
});

test('immutables are masked and nothing else is', () => {
  expect(maskImmutables('0x6001bbbb6002', artifact)).toBe(
    maskImmutables(artifact.deployedBytecode.object, artifact),
  );
  expect(maskImmutables('0x6001bbbb6003', artifact)).not.toBe(
    maskImmutables(artifact.deployedBytecode.object, artifact),
  );
});

test('a matching deployment passes, whatever the immutable values', async () => {
  expect(await verifyDeployment(manifest, artifacts, honest())).toEqual([]);
});

test('other code at an address fails', async () => {
  const p = await verifyDeployment(manifest, artifacts, honest({}, '0x6001bbbb6003'));
  expect(p.filter((x) => x.includes('differs from this build'))).toHaveLength(4);
});

test('no code fails', async () => {
  const p = await verifyDeployment(manifest, artifacts, honest({}, '0x'));
  expect(p.filter((x) => x.includes('no code'))).toHaveLength(4);
});

test('a wrong role fails, naming it', async () => {
  const p = await verifyDeployment(manifest, artifacts, honest({ [`${addr(7)}.guardian`]: addr(99) }));
  expect(p).toHaveLength(1);
  expect(p[0]).toContain('claims.guardian');
});

test('a wrong parameter fails', async () => {
  const p = await verifyDeployment(manifest, artifacts, honest({ [`${addr(7)}.claimDelay`]: 1n }));
  expect(p[0]).toContain('claimDelay');
});

test('the wrong chain fails', async () => {
  const chain = { ...honest(), chainId: async () => 1 };
  expect((await verifyDeployment(manifest, artifacts, chain))[0]).toContain('chain id is 1');
});

test('a getter that cannot be read fails rather than passes', async () => {
  const chain = {
    ...honest(),
    read: async () => {
      throw new Error('reverted');
    },
  };
  expect((await verifyDeployment(manifest, artifacts, chain)).length).toBeGreaterThan(0);
});
