// Generates merkle-vector.json: OZ StandardMerkleTree over ['address','uint256'] for 5 fixed owners.
// Run: bun run contracts/test/fixtures/gen-merkle-vector.ts (from app/)

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

const entries: [string, string][] = [
  ['0x1111111111111111111111111111111111111111', '1000000'],
  ['0x2222222222222222222222222222222222222222', '2500000'],
  ['0x3333333333333333333333333333333333333333', '42'],
  ['0x4444444444444444444444444444444444444444', '123456789'],
  ['0x5555555555555555555555555555555555555555', '5000000000'],
];

const tree = StandardMerkleTree.of(entries, ['address', 'uint256']);
const totalEarned = entries.reduce((s, [, v]) => s + BigInt(v), 0n).toString();

const leaves = entries.map(([owner, cumulative]) => {
  const i = tree.leafLookup([owner, cumulative]);
  return {
    owner,
    cumulative,
    leaf: tree.leafHash([owner, cumulative]),
    proof: tree.getProof(i),
  };
});

const out = {
  types: ['address', 'uint256'],
  root: tree.root,
  totalEarned,
  leaves,
};
writeFileSync(join(import.meta.dir, 'merkle-vector.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log('root', tree.root, 'totalEarned', totalEarned);
