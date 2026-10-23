import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { Decoder, Tag } from 'cbor-x';
import { privateKeyToAddress, publicKeyToAddress } from 'viem/accounts';
import { z } from 'zod';
import { sha256Bytes } from './canonical';
import { JobKind, Lane } from './enums';

/**
 * Node-signed job receipt: COSE_Sign1 (RFC 9052), tag 18, ES256K (alg -47).
 * protected = { 1: -47, 4: kid (20-byte nodeKey) }; signature = compact r||s over sha256(Sig_structure).
 */

const HEX32 = /^[0-9a-f]{64}$/;

export const ReceiptAttestation = z.object({
  quoteHash: z.string(),
  rtmr3: z.string(),
  gpuEvidenceHash: z.string(),
  hpkeKeyHash: z.string(),
});

export const ReceiptPayload = z.object({
  v: z.literal(1),
  jobId: z.string(),
  nodeKey: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  model: z.string(),
  modelDigest: z.string(),
  kind: z.enum(JobKind),
  lane: z.enum(Lane),
  usage: z.object({
    p: z.number().int().nonnegative(),
    c: z.number().int().nonnegative(),
    n: z.number().int().nonnegative().optional(),
  }),
  /** hex sha256(canonicalJson(request)) */
  inputDigest: z.string().regex(HEX32),
  /** hex sha256 of the output bytes, see outputDigest() */
  outputDigest: z.string().regex(HEX32),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative(),
  agentVersion: z.string(),
  attestation: ReceiptAttestation.optional(),
});
export type ReceiptPayload = z.infer<typeof ReceiptPayload>;

export const COSE_ALG_ES256K = -47;
const COSE_SIGN1_TAG = 18;

const cborDecoder = new Decoder({ useRecords: false, mapsAsObjects: true });
const toU8 = (b: Uint8Array) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

/**
 * Minimal deterministic CBOR encoder (RFC 8949): definite lengths, shortest integers, no tags except
 * the explicit {@link CborTag}. cbor-x is NOT used for encoding because it adds tags 64/259.
 */
class CborTag {
  constructor(
    readonly tag: number,
    readonly value: unknown,
  ) {}
}
class CborMap {
  constructor(readonly entries: [unknown, unknown][]) {}
}

function head(major: number, n: number): Uint8Array {
  const m = major << 5;
  if (n < 24) return Uint8Array.of(m | n);
  if (n < 0x100) return Uint8Array.of(m | 24, n);
  if (n < 0x10000) return Uint8Array.of(m | 25, n >> 8, n & 0xff);
  if (n < 0x100000000)
    return Uint8Array.of(m | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  const out = new Uint8Array(9);
  out[0] = m | 27;
  new DataView(out.buffer).setBigUint64(1, BigInt(n));
  return out;
}

function cborEncode(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return concatBytes(head(2, v.length), v);
  if (typeof v === 'string') {
    const b = utf8ToBytes(v);
    return concatBytes(head(3, b.length), b);
  }
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new TypeError('cbor: only safe integers are supported');
    return v >= 0 ? head(0, v) : head(1, -1 - v);
  }
  if (typeof v === 'boolean') return Uint8Array.of(v ? 0xf5 : 0xf4);
  if (v === null) return Uint8Array.of(0xf6);
  if (Array.isArray(v)) return concatBytes(head(4, v.length), ...v.map(cborEncode));
  if (v instanceof CborTag) return concatBytes(head(6, v.tag), cborEncode(v.value));
  if (v instanceof CborMap)
    return concatBytes(
      head(5, v.entries.length),
      ...v.entries.flatMap(([k, x]) => [cborEncode(k), cborEncode(x)]),
    );
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return cborEncode(new CborMap(keys.map((k) => [k, o[k]])));
  }
  throw new TypeError('cbor: unsupported value');
}

/** Protected header `{1: -47, 4: kid}` as an untagged definite-length map. */
function encodeProtected(kid: Uint8Array): Uint8Array {
  return cborEncode(
    new CborMap([
      [1, COSE_ALG_ES256K],
      [4, kid],
    ]),
  );
}

export function encodeReceiptPayload(p: ReceiptPayload): Uint8Array {
  return cborEncode(ReceiptPayload.parse(p));
}
/** Name used by node-protocol.md / N1. */
export const encodeReceipt = encodeReceiptPayload;

function sigStructure(protectedBytes: Uint8Array, payloadBytes: Uint8Array): Uint8Array {
  return cborEncode(['Signature1', protectedBytes, new Uint8Array(0), payloadBytes]);
}

const stripHex = (h: string) => (h.startsWith('0x') ? h.slice(2) : h);

/** Returns the tagged COSE_Sign1 bytes. */
export function signReceipt(p: ReceiptPayload, privateKeyHex: string): Uint8Array {
  const sk = hexToBytes(stripHex(privateKeyHex));
  const kid = hexToBytes(stripHex(privateKeyToAddress(`0x${stripHex(privateKeyHex)}`)));
  const protectedBytes = encodeProtected(kid);
  const payloadBytes = encodeReceiptPayload(p);
  const digest = sha256Bytes(sigStructure(protectedBytes, payloadBytes));
  const signature = secp256k1.sign(digest, sk, { prehash: false, format: 'compact' });
  return cborEncode(new CborTag(COSE_SIGN1_TAG, [protectedBytes, new CborMap([]), payloadBytes, signature]));
}

function bigintsToNumbers(v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map(bigintsToNumbers);
  if (v && typeof v === 'object' && !(v instanceof Uint8Array))
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, bigintsToNumbers(x)]));
  return v;
}

export interface DecodedReceipt {
  protected: { alg: number; kid: string };
  payload: ReceiptPayload;
  signature: Uint8Array;
  protectedBytes: Uint8Array;
  payloadBytes: Uint8Array;
}

/** Parses structure and payload; does NOT check the signature. Throws on malformed input. */
export function decodeReceipt(cose: Uint8Array): DecodedReceipt {
  const t = cborDecoder.decode(cose) as unknown;
  if (!(t instanceof Tag) || t.tag !== COSE_SIGN1_TAG) throw new Error('not a COSE_Sign1 (tag 18)');
  const arr = t.value as unknown;
  if (!Array.isArray(arr) || arr.length !== 4) throw new Error('malformed COSE_Sign1');
  const [prot, , payload, sig] = arr as unknown[];
  if (!(prot instanceof Uint8Array) || !(payload instanceof Uint8Array) || !(sig instanceof Uint8Array))
    throw new Error('malformed COSE_Sign1');
  const header = cborDecoder.decode(prot) as Map<number, unknown> | Record<string, unknown>;
  const get = (k: number) =>
    header instanceof Map ? header.get(k) : (header as Record<string, unknown>)[String(k)];
  const alg = get(1);
  const kid = get(4);
  if (typeof alg !== 'number' || !(kid instanceof Uint8Array)) throw new Error('malformed protected header');
  return {
    protected: { alg, kid: `0x${bytesToHex(kid)}` },
    payload: ReceiptPayload.parse(bigintsToNumbers(cborDecoder.decode(payload))),
    signature: toU8(sig),
    protectedBytes: toU8(prot),
    payloadBytes: toU8(payload),
  };
}

/** True only if alg is ES256K and the signature verifies against `publicKeyHex` (compressed or uncompressed). */
export function verifyReceipt(cose: Uint8Array, publicKeyHex: string): boolean {
  try {
    const d = decodeReceipt(cose);
    if (d.protected.alg !== COSE_ALG_ES256K) return false;
    const pub = hexToBytes(stripHex(publicKeyHex));
    const addr = publicKeyToAddress(
      pub.length === 33
        ? (bytesToHex(secp256k1.Point.fromBytes(pub).toBytes(false)) as `0x${string}`)
        : (`0x${bytesToHex(pub)}` as `0x${string}`),
    );
    if (d.protected.kid !== addr.toLowerCase()) return false;
    const digest = sha256Bytes(sigStructure(d.protectedBytes, d.payloadBytes));
    return secp256k1.verify(d.signature, digest, pub, { prehash: false });
  } catch {
    return false;
  }
}

export function receiptToBase64(cose: Uint8Array): string {
  let s = '';
  for (const b of cose) s += String.fromCharCode(b);
  return btoa(s);
}

export function receiptFromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * Digest of the relayed output, hex sha256:
 * chat -> utf8(text); embeddings -> float32 little-endian bytes of all vectors concatenated;
 * images -> raw image bytes concatenated.
 */
export function outputDigest(
  kind: 'chat' | 'embeddings' | 'images',
  output: string | number[] | number[][] | Uint8Array | Uint8Array[],
): string {
  let bytes: Uint8Array;
  if (kind === 'chat') {
    if (typeof output !== 'string') throw new TypeError('chat output must be a string');
    bytes = utf8ToBytes(output);
  } else if (kind === 'embeddings') {
    if (!Array.isArray(output)) throw new TypeError('embeddings output must be number[] or number[][]');
    const flat = (output as (number | number[])[]).flat();
    const buf = new DataView(new ArrayBuffer(flat.length * 4));
    for (let i = 0; i < flat.length; i++) buf.setFloat32(i * 4, flat[i] as number, true);
    bytes = new Uint8Array(buf.buffer);
  } else {
    if (output instanceof Uint8Array) bytes = output;
    else if (Array.isArray(output) && output.every((x) => x instanceof Uint8Array))
      bytes = concatBytes(...(output as Uint8Array[]));
    else throw new TypeError('images output must be Uint8Array or Uint8Array[]');
  }
  return bytesToHex(sha256Bytes(bytes));
}
