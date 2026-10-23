import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Deterministic JSON: object keys sorted by UTF-16 code unit, no whitespace, `undefined` object
 * members dropped. Same shape as ghost_front `canonical` except sorting is locale independent.
 */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  if (typeof v === 'bigint') throw new TypeError('canonicalJson: bigint is not JSON');
  const s = JSON.stringify(v);
  if (s === undefined) throw new TypeError('canonicalJson: unsupported value');
  return s;
}

export function sha256Bytes(input: Uint8Array | string): Uint8Array {
  return sha256(typeof input === 'string' ? utf8ToBytes(input) : input);
}

/** Lowercase hex without 0x prefix. */
export function sha256Hex(input: Uint8Array | string): string {
  return bytesToHex(sha256Bytes(input));
}
