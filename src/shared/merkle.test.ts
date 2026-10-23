import { expect, test } from 'bun:test';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import type { Address } from 'viem';
import { buildTree, leafHash, proofFor, treeFromJson, treeToJson } from './merkle';

const entries = [
  { owner: '0xCCccCCccCCccCCccCCccCCccCCccCCccCCccCCcc' as Address, cumulative: 300n },
  { owner: '0xaaAAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as Address, cumulative: 100n },
  { owner: '0xBbbbBBbbbbBbbbbbBBbBbbBBbBbbBbBbbBbBbBbB' as Address, cumulative: 200n },
];

test('tree, leaf hash, proofs', () => {
  const tree = buildTree(entries);
  expect(tree.length).toBe(3);
  expect([...tree.entries()].map(([, v]) => v[0])).toEqual([...tree.entries()].map(([, v]) => v[0]).sort());
  for (const e of entries) {
    const o = e.owner.toLowerCase();
    const idx = [...tree.entries()].find(([, v]) => v[0] === o)?.[0] as number;
    expect(tree.leafHash([o, e.cumulative.toString()])).toBe(leafHash(e.owner, e.cumulative));
    const proof = proofFor(tree, e.owner);
    expect(
      StandardMerkleTree.verify(tree.root, ['address', 'uint256'], [o, e.cumulative.toString()], proof),
    ).toBe(true);
    expect(tree.getProof(idx)).toEqual(proof);
  }
  expect(() => proofFor(tree, '0x0000000000000000000000000000000000000001')).toThrow();
});

test('json round trip', () => {
  const tree = buildTree(entries);
  const back = treeFromJson(JSON.parse(JSON.stringify(treeToJson(tree))));
  expect(back.root).toBe(tree.root);
});

test('order independent, rejects duplicates', () => {
  expect(buildTree([...entries].reverse()).root).toBe(buildTree(entries).root);
  expect(() => buildTree([...entries, entries[0] as (typeof entries)[0]])).toThrow();
});
