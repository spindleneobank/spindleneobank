import { describe, expect, test } from 'bun:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { canonicalJson, sha256Hex } from '../../shared/canonical-json';
import type { GatewayView } from '../../shared/contracts/jobs';
import { outputDigest, type ReceiptPayload, receiptToBase64, signReceipt } from '../../shared/receipt';
import { tokenTolerance, type VerifyJob, verifyDeps, verifyJobReceipt } from './verify';

const pk = generatePrivateKey();
const acct = privateKeyToAccount(pk);
const JOB = '11111111-1111-4111-8111-111111111111';
const request = { model: 'qwen2.5:7b', messages: [{ role: 'user', content: 'hi' }] };

const job = (over: Partial<VerifyJob> = {}): VerifyJob => ({
  id: JOB,
  model: 'qwen2.5:7b',
  kind: 'chat',
  lane: 'open',
  nodeKey: acct.address.toLowerCase(),
  nodePubkey: acct.publicKey,
  ...over,
});
const view = (over: Partial<GatewayView> = {}): GatewayView => ({
  outputText: 'hello world',
  inputDigest: sha256Hex(canonicalJson(request)),
  recount: { promptTokens: 10, completionTokens: 100 },
  recountEstimated: false,
  ...over,
});
const payload = (over: Partial<ReceiptPayload> = {}): ReceiptPayload => ({
  v: 1,
  jobId: JOB,
  nodeKey: acct.address,
  model: 'qwen2.5:7b',
  modelDigest: 'sha256:x',
  kind: 'chat',
  lane: 'open',
  usage: { p: 10, c: 100 },
  inputDigest: sha256Hex(canonicalJson(request)),
  outputDigest: outputDigest('chat', 'hello world'),
  startedAt: 1,
  finishedAt: 2,
  agentVersion: '0.1.0',
  ...over,
});
const sign = (p: ReceiptPayload, key = pk) => receiptToBase64(signReceipt(p, key));

describe('verifyJobReceipt', () => {
  test('valid receipt verifies', async () => {
    const r = await verifyJobReceipt(job(), sign(payload()), view());
    expect(r).toMatchObject({ verified: true, reason: null, recountTokens: 100 });
  });

  test('BAD_SIGNATURE: another key, garbage, and a tampered payload', async () => {
    const other = generatePrivateKey();
    expect((await verifyJobReceipt(job(), sign(payload(), other), view())).reason).toBe('BAD_SIGNATURE');
    expect((await verifyJobReceipt(job(), 'AA==', view())).reason).toBe('BAD_SIGNATURE');
    const b = Buffer.from(sign(payload()), 'base64');
    b[b.length - 1] = (b[b.length - 1] as number) ^ 1; // flip a signature bit
    expect((await verifyJobReceipt(job(), b.toString('base64'), view())).reason).toBe('BAD_SIGNATURE');
  });

  test.each([
    ['jobId', { jobId: '22222222-2222-4222-8222-222222222222' }],
    ['nodeKey', { nodeKey: privateKeyToAccount(generatePrivateKey()).address }],
    ['model', { model: 'other' }],
    ['kind', { kind: 'embeddings' as const }],
    ['lane', { lane: 'sealed' as const }],
  ])('FIELD_MISMATCH on %s', async (_n, over) => {
    const r = await verifyJobReceipt(job(), sign(payload(over as Partial<ReceiptPayload>)), view());
    expect(r.reason).toBe('FIELD_MISMATCH');
  });

  test('INPUT_DIGEST', async () => {
    const r = await verifyJobReceipt(job(), sign(payload({ inputDigest: 'b'.repeat(64) })), view());
    expect(r).toMatchObject({ verified: false, reason: 'INPUT_DIGEST' });
  });

  test('OUTPUT_DIGEST: node signed different output than the gateway relayed', async () => {
    const r = await verifyJobReceipt(job(), sign(payload()), view({ outputText: 'tampered' }));
    expect(r.reason).toBe('OUTPUT_DIGEST');
    expect((await verifyJobReceipt(job(), sign(payload()), view({ outputText: undefined }))).reason).toBe(
      'OUTPUT_DIGEST',
    );
  });

  test('TOKEN_MISMATCH: completion and prompt outside max(3, 2%)', async () => {
    expect(tokenTolerance(100)).toBe(3);
    expect(tokenTolerance(1000)).toBe(20);
    const ok = await verifyJobReceipt(job(), sign(payload({ usage: { p: 10, c: 103 } })), view());
    expect(ok.verified).toBe(true);
    const bad = await verifyJobReceipt(job(), sign(payload({ usage: { p: 10, c: 104 } })), view());
    expect(bad.reason).toBe('TOKEN_MISMATCH');
    const badPrompt = await verifyJobReceipt(job(), sign(payload({ usage: { p: 14, c: 100 } })), view());
    expect(badPrompt.reason).toBe('TOKEN_MISMATCH');
  });

  test('estimated recount skips the token check but not the digests', async () => {
    const p = payload({ usage: { p: 10, c: 500 } });
    expect((await verifyJobReceipt(job(), sign(p), view({ recountEstimated: true }))).verified).toBe(true);
    const r = await verifyJobReceipt(
      job(),
      sign({ ...p, inputDigest: 'c'.repeat(64) }),
      view({ recountEstimated: true }),
    );
    expect(r.reason).toBe('INPUT_DIGEST');
  });

  test('embeddings and images', async () => {
    const vec = [[0.1, 0.2, 0.3]];
    const e = payload({
      kind: 'embeddings',
      usage: { p: 4, c: 0 },
      outputDigest: outputDigest('embeddings', vec),
    });
    const ev = view({
      outputText: undefined,
      embeddings: vec,
      recount: { promptTokens: 4, completionTokens: 0 },
    });
    expect((await verifyJobReceipt(job({ kind: 'embeddings' }), sign(e), ev)).verified).toBe(true);
    expect(
      (await verifyJobReceipt(job({ kind: 'embeddings' }), sign(e), { ...ev, embeddings: [[0.1, 0.2, 0.4]] }))
        .reason,
    ).toBe('OUTPUT_DIGEST');

    const imgs = [new Uint8Array([1, 2, 3]), new Uint8Array([4])];
    const i = payload({
      kind: 'images',
      usage: { p: 0, c: 0, n: 2 },
      outputDigest: outputDigest('images', imgs),
    });
    const iv = view({ outputText: undefined, recount: undefined, images: imgs });
    expect((await verifyJobReceipt(job({ kind: 'images' }), sign(i), iv)).verified).toBe(true);
    const wrongN = payload({
      kind: 'images',
      usage: { p: 0, c: 0, n: 3 },
      outputDigest: outputDigest('images', imgs),
    });
    expect((await verifyJobReceipt(job({ kind: 'images' }), sign(wrongN), iv)).reason).toBe('TOKEN_MISMATCH');
  });

  test('NO_ATTESTATION in the sealed lane until S1 lands, and a verified one passes', async () => {
    const p = payload({ lane: 'sealed', usage: { p: 10, c: 100 } });
    const v = view({ recount: undefined });
    expect((await verifyJobReceipt(job({ lane: 'sealed' }), sign(p), v)).reason).toBe('NO_ATTESTATION');
    const orig = verifyDeps.attestation;
    verifyDeps.attestation = () => ({ ok: true, ref: 'att-1' });
    try {
      const r = await verifyJobReceipt(job({ lane: 'sealed' }), sign(p), v);
      expect(r).toMatchObject({ verified: true, attestationRef: 'att-1' });
    } finally {
      verifyDeps.attestation = orig;
    }
  });
});
