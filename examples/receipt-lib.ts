// Receipt + Merkle verification helpers (used by verify-receipt.ts and the offline test).
// Reuses the same verifier the Spindle backend and node use.
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes } from '@noble/hashes/utils.js';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { publicKeyToAddress } from 'viem/accounts';
import { decodeReceipt, receiptFromBase64, verifyReceipt } from '../src/shared/receipt.ts';

export interface ReceiptView {
  jobId: string;
  nodeKey: string;
  model: string;
  lane: string;
  usage: { p: number; c: number; n?: number };
  cose: string; // base64 COSE_Sign1
  verified: boolean;
  epoch: number | null;
}
export type TreeDump = Parameters<typeof StandardMerkleTree.load>[0];

const bstr = (b: Uint8Array) => {
  const n = b.length;
  const head =
    n < 24
      ? [0x40 | n]
      : n < 256
        ? [0x58, n]
        : n < 65536
          ? [0x59, n >> 8, n & 255]
          : [0x5a, n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  return concatBytes(Uint8Array.from(head), b);
};

/**
 * The public receipt exposes the node's address (`nodeKey`), not its public key. ES256K signatures
 * are recoverable, so we recover the candidate keys and keep the one whose address is the signed kid.
 * If you hold the node's registered public key, pass it as `publicKey` instead.
 */
export function nodePublicKeyFor(cose: Uint8Array): string {
  const d = decodeReceipt(cose);
  // Sig_structure = ["Signature1", protected, h'', payload]
  const sigStructure = concatBytes(
    Uint8Array.of(0x84, 0x6a),
    new TextEncoder().encode('Signature1'),
    bstr(d.protectedBytes),
    Uint8Array.of(0x40),
    bstr(d.payloadBytes),
  );
  const digest = sha256(sigStructure);
  for (const recovery of [0, 1]) {
    const pub = secp256k1.Signature.fromBytes(d.signature, 'compact')
      .addRecoveryBit(recovery)
      .recoverPublicKey(digest)
      .toBytes(false);
    const hex = `0x${bytesToHex(pub)}` as const;
    if (publicKeyToAddress(hex).toLowerCase() === d.protected.kid) return hex;
  }
  throw new Error('no public key matches the receipt kid');
}

export interface ReceiptCheck {
  signatureValid: boolean;
  payloadMatchesView: boolean;
  payload: ReturnType<typeof decodeReceipt>['payload'];
}

/** COSE signature against the node key, and the signed payload against the API's view of the job. */
export function checkReceipt(view: ReceiptView, publicKey?: string): ReceiptCheck {
  const cose = receiptFromBase64(view.cose);
  const { payload } = decodeReceipt(cose);
  let signatureValid = false;
  try {
    signatureValid = verifyReceipt(cose, publicKey ?? nodePublicKeyFor(cose));
  } catch {
    // no key hashes to the signed kid: the signature is not by the node
  }
  return {
    signatureValid,
    payloadMatchesView:
      payload.jobId === view.jobId &&
      payload.nodeKey.toLowerCase() === view.nodeKey.toLowerCase() &&
      payload.model === view.model &&
      payload.usage.p === view.usage.p &&
      payload.usage.c === view.usage.c,
    payload,
  };
}

export interface MerkleCheck {
  root: `0x${string}`;
  leaves: number;
  ownerProofValid: boolean | null; // null when no owner given
  cumulativeMicros: string | null;
}

/** Loads the epoch tree, checks it is internally consistent, and verifies the owner's leaf proof. */
export function checkEpochTree(dump: TreeDump, owner?: string): MerkleCheck {
  const tree = StandardMerkleTree.load(dump);
  tree.validate();
  let ownerProofValid: boolean | null = null;
  let cumulativeMicros: string | null = null;
  if (owner) {
    ownerProofValid = false;
    for (const [i, v] of tree.entries()) {
      if (String(v[0]).toLowerCase() !== owner.toLowerCase()) continue;
      const proof = tree.getProof(i);
      ownerProofValid = StandardMerkleTree.verify(tree.root, tree.leafEncoding as string[], v, proof);
      cumulativeMicros = String(v[1]);
    }
  }
  return {
    root: tree.root as `0x${string}`,
    leaves: [...tree.entries()].length,
    ownerProofValid,
    cumulativeMicros,
  };
}
