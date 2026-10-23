import { describe, expect, test } from 'bun:test';
import { sha256Hex, canonicalJson } from '@spindle/shared/canonical-json';
import type { JobStartMsg } from '@spindle/shared/node-protocol';
import { decodeReceipt, receiptFromBase64, verifyReceipt } from '@spindle/shared/receipt';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { buildReceipt } from '../src/receipts';

const pk = generatePrivateKey();
const acct = privateKeyToAccount(pk);
const key = { address: acct.address, privateKey: pk };
const ctx = { modelDigest: 'sha256:abc', agentVersion: '0.1.0' };
const t = { startedAt: 1000, finishedAt: 2000 };
const job = (kind: 'chat' | 'embeddings' | 'images'): JobStartMsg['kind'] extends never ? never : Pick<JobStartMsg, 'jobId' | 'model' | 'kind' | 'lane' | 'request'> => ({
  jobId: 'j1',
  model: 'm',
  kind,
  lane: 'open',
  request: { messages: [{ role: 'user', content: 'hi' }], b: 1, a: 2 },
});
const sha = (b: Uint8Array) => new Bun.CryptoHasher('sha256').update(b).digest('hex');

describe('receipts', () => {
  test('chat: utf8 digest, input digest, verifies', () => {
    const b64 = buildReceipt(job('chat'), 'héllo', { promptTokens: 3, completionTokens: 2 }, t, key, ctx);
    const cose = receiptFromBase64(b64);
    expect(verifyReceipt(cose, acct.publicKey)).toBe(true);
    const p = decodeReceipt(cose).payload;
    expect(p.outputDigest).toBe(sha(new TextEncoder().encode('héllo')));
    expect(p.inputDigest).toBe(sha256Hex(canonicalJson(job('chat').request)));
    expect(p.usage).toEqual({ p: 3, c: 2 });
    expect(p.nodeKey).toBe(acct.address);
    expect(p.modelDigest).toBe('sha256:abc');
  });

  test('embeddings: float32 LE bytes in order', () => {
    const vecs = [
      [1, 0.5],
      [-2, 0.25],
    ];
    const b64 = buildReceipt(job('embeddings'), vecs, { promptTokens: 4, completionTokens: 0 }, t, key, ctx);
    const buf = new DataView(new ArrayBuffer(16));
    [1, 0.5, -2, 0.25].forEach((n, i) => buf.setFloat32(i * 4, n, true));
    expect(decodeReceipt(receiptFromBase64(b64)).payload.outputDigest).toBe(sha(new Uint8Array(buf.buffer)));
  });

  test('images: raw bytes concatenated, usage.n', () => {
    const imgs = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    const b64 = buildReceipt(job('images'), imgs, { promptTokens: 0, completionTokens: 0, images: 2 }, t, key, ctx);
    const p = decodeReceipt(receiptFromBase64(b64)).payload;
    expect(p.outputDigest).toBe(sha(new Uint8Array([1, 2, 3, 4, 5])));
    expect(p.usage.n).toBe(2);
  });

  test('tampered payload and wrong key fail verification', () => {
    const cose = receiptFromBase64(
      buildReceipt(job('chat'), 'x', { promptTokens: 1, completionTokens: 1 }, t, key, ctx),
    );
    const bad = new Uint8Array(cose);
    const i = bad.length - 70; // inside payload/signature region
    bad[i] = (bad[i] ?? 0) ^ 0xff;
    expect(verifyReceipt(bad, acct.publicKey)).toBe(false);
    const other = privateKeyToAccount(generatePrivateKey());
    expect(verifyReceipt(cose, other.publicKey)).toBe(false);
  });
});
