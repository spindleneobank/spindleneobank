import { expect, test } from 'bun:test';
import { deployBlockFromReceipts } from '../scripts/deploy-block';

const zero = '0x0000000000000000000000000000000000000000';
const manifest = (staking: string) => ({
  deployBlock: 26383277, // what block.number gives inside the script on an Arbitrum chain
  addresses: { registry: '0xAA', staking, claims: '0xCC', vault: '0xDD', usdg: '0xEE' },
});
const receipts = [
  { contractAddress: '0xaa', blockNumber: '0x699c241' },
  { contractAddress: '0xbb', blockNumber: '0x699c242' },
  { contractAddress: '0xcc', blockNumber: '0x699c243' },
  { contractAddress: '0xdd', blockNumber: '0x699c244' },
  { contractAddress: null, blockNumber: '0x1' },
];

test('takes the earliest receipt block of the deployed contracts', () => {
  expect(deployBlockFromReceipts(manifest('0xBB'), receipts)).toBe(0x699c241);
});

test('a NO_STAKING manifest skips the zero staking address', () => {
  const noStaking = receipts.filter((r) => r.contractAddress !== '0xbb');
  expect(deployBlockFromReceipts(manifest(zero), noStaking)).toBe(0x699c241);
});

test('refuses a manifest whose contract has no receipt', () => {
  expect(() => deployBlockFromReceipts(manifest('0xBB'), receipts.slice(1))).toThrow(/registry/);
});
