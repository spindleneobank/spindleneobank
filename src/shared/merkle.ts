import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { type Address, encodeAbiParameters, type Hex, keccak256 } from 'viem';

/** Cumulative claims tree. Leaf = keccak256(bytes.concat(keccak256(abi.encode(owner, cumulative)))). */
export const TREE_TYPES = ['address', 'uint256'] as const;

export interface MerkleEntry {
  owner: Address;
  cumulative: bigint;
}

type Tree = StandardMerkleTree<[string, string]>;
export type ClaimsTree = Tree;

/** Owners are lowercased, entries sorted by owner (ascending), duplicates rejected. */
export function buildTree(entries: MerkleEntry[]): Tree {
  const rows = entries
    .map((e) => [e.owner.toLowerCase(), e.cumulative.toString()] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (let i = 1; i < rows.length; i++)
    if (rows[i]?.[0] === rows[i - 1]?.[0]) throw new Error(`duplicate owner ${rows[i]?.[0]}`);
  return StandardMerkleTree.of(rows, [...TREE_TYPES]);
}

/** The Solidity double hash. */
export function leafHash(owner: Address, cumulative: bigint): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }],
      [owner.toLowerCase() as Address, cumulative],
    ),
  );
  return keccak256(inner);
}
/** Name used by B8. */
export const leafFor = leafHash;

export function proofFor(tree: Tree, owner: Address): Hex[] {
  const o = owner.toLowerCase();
  for (const [i, v] of tree.entries()) if (v[0] === o) return tree.getProof(i) as Hex[];
  throw new Error(`owner ${o} not in tree`);
}

export function treeToJson(tree: Tree): ReturnType<Tree['dump']> {
  return tree.dump();
}

export function treeFromJson(json: ReturnType<Tree['dump']>): Tree {
  return StandardMerkleTree.load(json) as Tree;
}
