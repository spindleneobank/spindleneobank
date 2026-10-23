import { describe, expect, test } from 'bun:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  decodeReceipt,
  outputDigest,
  type ReceiptPayload,
  receiptFromBase64,
  receiptToBase64,
  signReceipt,
  verifyReceipt,
} from './receipt';

const pk = generatePrivateKey();
const acct = privateKeyToAccount(pk);
const payload = (): ReceiptPayload => ({
  v: 1,
  jobId: 'a0b1c2d3-0000-4000-8000-000000000001',
  nodeKey: acct.address,
  model: 'qwen2.5:0.5b',
  modelDigest: 'sha256:abc',
  kind: 'chat',
  lane: 'open',
  usage: { p: 10, c: 20 },
  inputDigest: 'a'.repeat(64),
  outputDigest: outputDigest('chat', 'hello'),
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_001_000,
  agentVersion: '0.1.0',
});

describe('receipt', () => {
  test('sign / verify round trip', () => {
    const cose = signReceipt(payload(), pk);
    expect(cose[0]).toBe(0xd2); // tag 18
    expect(verifyReceipt(cose, acct.publicKey)).toBe(true);
    const d = decodeReceipt(cose);
    expect(d.payload).toEqual(payload());
    expect(d.protected.alg).toBe(-47);
    expect(d.signature.length).toBe(64);
  });
  test('kid equals the key address', () => {
    expect(decodeReceipt(signReceipt(payload(), pk)).protected.kid).toBe(acct.address.toLowerCase());
  });
  test('optional attestation survives', () => {
    const p = {
      ...payload(),
      attestation: { quoteHash: 'q', rtmr3: 'r', gpuEvidenceHash: 'g', hpkeKeyHash: 'h' },
    };
    expect(decodeReceipt(signReceipt(p, pk)).payload.attestation?.hpkeKeyHash).toBe('h');
  });
  test('tampered payload fails', () => {
    const a = signReceipt(payload(), pk);
    const b = signReceipt({ ...payload(), usage: { p: 10, c: 21 } }, pk);
    // splice b's payload bytes onto a's signature: swap by flipping a byte inside a
    expect(verifyReceipt(b, acct.publicKey)).toBe(true);
    const t = Uint8Array.from(a);
    const idx = Array.from(t).findIndex((_, i) => i > 60 && t[i] === 0x14); // somewhere in payload (c:20 -> 0x14)
    expect(idx).toBeGreaterThan(0);
    t[idx] = 0x15;
    expect(verifyReceipt(t, acct.publicKey)).toBe(false);
  });
  test('wrong key fails', () => {
    const other = privateKeyToAccount(generatePrivateKey());
    expect(verifyReceipt(signReceipt(payload(), pk), other.publicKey)).toBe(false);
  });
  test('garbage fails without throwing', () => {
    expect(verifyReceipt(new Uint8Array([1, 2, 3]), acct.publicKey)).toBe(false);
  });
  test('base64 round trip', () => {
    const c = signReceipt(payload(), pk);
    expect(receiptFromBase64(receiptToBase64(c))).toEqual(c);
  });
  test('outputDigest', () => {
    expect(outputDigest('chat', 'abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(outputDigest('embeddings', [[1, 2]])).toBe(outputDigest('embeddings', [1, 2]));
    expect(outputDigest('images', [new Uint8Array([1]), new Uint8Array([2])])).toBe(
      outputDigest('images', new Uint8Array([1, 2])),
    );
  });
});
