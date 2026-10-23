import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { jobs, nodeAttestations, nodes, users } from '../../db/schema';
import { closeRedis } from '../../lib/redis';
import type { ReceiptPayload } from '../../shared/receipt';
import { dbRef } from '../auth/constants';
import { buyerIdForAddress } from '../buyers/service';
import type { VerifyJob } from '../receipts/verify';
import { nvidiaDeps } from './nvidia';
import { installSyntheticEnv, SYN, type SyntheticEnv } from './testkit';
import { latestAttestation, recordAttestation, verifyAttestation, verifyReceiptAttestation } from './verify';

// All bundles in this file are SYNTHETIC (see testkit.ts); the real-quote DCAP path is covered in tdx.test.ts.
let t: TestDb;
let env: SyntheticEnv;
const acct = privateKeyToAccount(generatePrivateKey());
const nodeKey = acct.address.toLowerCase();
let nodeId: string;

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
});
afterAll(async () => {
  await t.close();
  await closeRedis();
});
beforeEach(async () => {
  await t.reset();
  env = await installSyntheticEnv();
  const [u] = await t.db
    .insert(users)
    .values({ address: `0x${'9'.repeat(40)}` })
    .returning();
  const [n] = await t.db
    .insert(nodes)
    .values({
      owner: `0x${'9'.repeat(40)}`,
      userId: u?.id as string,
      nodeKey,
      nodePubkey: acct.publicKey,
      name: 'cvm',
      engine: 'vllm',
      gpuModel: 'H100',
      gpuClass: 3,
      lane: 'sealed',
      status: 'online',
      registered: true,
      onchainId: 9n,
    })
    .returning();
  nodeId = n?.id as string;
});
afterEach(() => env.restore());

describe('verifyAttestation', () => {
  test('accepts a consistent bundle and returns the receipt hashes', async () => {
    const { bundle } = await env.makeBundle(nodeKey);
    const r = await verifyAttestation(bundle, nodeKey);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.evidence.composeHash).toBe(SYN.composeHash);
      expect(r.evidence.quoteHash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.evidence.tcbStatus).toBe('UpToDate');
    }
  });

  test('MUST: report_data binds the HPKE key; a swapped key fails', async () => {
    const { bundle } = await env.makeBundle(nodeKey);
    const other = await env.makeBundle(nodeKey);
    const r = await verifyAttestation({ ...bundle, hpkePublicKey: other.bundle.hpkePublicKey }, nodeKey);
    expect(r).toMatchObject({ ok: false, reason: 'REPORT_DATA_MISMATCH' });
  });

  test('MUST: report_data binds the node key; another node cannot reuse the bundle', async () => {
    const { bundle } = await env.makeBundle(nodeKey);
    const evil = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
    expect(await verifyAttestation(bundle, evil)).toMatchObject({
      ok: false,
      reason: 'REPORT_DATA_MISMATCH',
    });
    const { bundle: b2 } = await env.makeBundle(nodeKey, { reportDataFor: evil });
    expect(await verifyAttestation(b2, nodeKey)).toMatchObject({ ok: false, reason: 'REPORT_DATA_MISMATCH' });
  });

  test('event log must replay to the quote RTMR3', async () => {
    const { bundle } = await env.makeBundle(nodeKey);
    const log = (bundle.eventLog as unknown[]).slice(0, -1);
    expect(await verifyAttestation({ ...bundle, eventLog: log }, nodeKey)).toMatchObject({
      ok: false,
      reason: 'RTMR3_MISMATCH',
    });
  });

  test('allowlist: unknown compose hash, unknown MRTD and an empty allowlist are all rejected', async () => {
    env.restore();
    env = await installSyntheticEnv({ composeHash: ['00'.repeat(32)] });
    let { bundle } = await env.makeBundle(nodeKey);
    expect(await verifyAttestation(bundle, nodeKey)).toMatchObject({ ok: false, reason: 'NOT_ALLOWLISTED' });
    env.restore();
    env = await installSyntheticEnv({ mrTd: ['00'.repeat(48)] });
    ({ bundle } = await env.makeBundle(nodeKey));
    expect(await verifyAttestation(bundle, nodeKey)).toMatchObject({ ok: false, reason: 'NOT_ALLOWLISTED' });
    env.restore();
    env = await installSyntheticEnv({ mrTd: [] });
    ({ bundle } = await env.makeBundle(nodeKey));
    expect(await verifyAttestation(bundle, nodeKey)).toMatchObject({ ok: false, reason: 'ALLOWLIST_EMPTY' });
  });

  test('NVIDIA: failed overall result, wrong nonce, bad token signature and NRAS outage', async () => {
    let { bundle } = await env.makeBundle(nodeKey, { nrasResult: false });
    expect(await verifyAttestation(bundle, nodeKey)).toMatchObject({
      ok: false,
      reason: 'NVIDIA_ATT_FAILED',
    });

    ({ bundle } = await env.makeBundle(nodeKey));
    const tampered = {
      ...bundle,
      nvidiaEvidence: { ...(bundle.nvidiaEvidence as object), nonce: 'ee'.repeat(32) },
    };
    expect((await verifyAttestation(tampered, nodeKey)).ok).toBe(false); // the nonce is bound in report_data

    nvidiaDeps.jwks = (() => async () =>
      (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign', 'verify']))
        .publicKey) as never;
    expect(await verifyAttestation(bundle, nodeKey)).toMatchObject({
      ok: false,
      reason: 'NVIDIA_JWT_INVALID',
    });

    nvidiaDeps.nras = async () => {
      throw new Error('503');
    };
    expect(await verifyAttestation(bundle, nodeKey)).toMatchObject({
      ok: false,
      reason: 'NVIDIA_NRAS_UNAVAILABLE',
    });
  });

  test('disallowed TCB status', async () => {
    const { tdxDeps } = await import('./tdx');
    const orig = tdxDeps.verify;
    tdxDeps.verify = (...a) => ({ ...orig(...a), status: 'OutOfDate' }) as never;
    const { bundle } = await env.makeBundle(nodeKey);
    expect(await verifyAttestation(bundle, nodeKey)).toMatchObject({ ok: false, reason: 'TDX_TCB_STATUS' });
  });
});

describe('recordAttestation + freshness', () => {
  test('success stores a verified row with a 1 h expiry and marks the node attested', async () => {
    const { bundle } = await env.makeBundle(nodeKey);
    const r = await recordAttestation(nodeId, nodeKey, bundle);
    expect(r.ok).toBe(true);
    const [n] = await t.db.select().from(nodes).where(eq(nodes.id, nodeId));
    expect(n?.lastAttestAt).toBeInstanceOf(Date);
    expect(n?.ccCapable).toBe(true);
    const [row] = await t.db.select().from(nodeAttestations);
    expect(row?.verified).toBe(true);
    expect((row?.expiresAt?.getTime() ?? 0) - Date.now()).toBeGreaterThan(3500_000);
    const att = await latestAttestation(nodeId);
    expect(att?.hpkePublicKey).toBe(bundle.hpkePublicKey);
    // a new session without evidence clears eligibility immediately
    await (await import('./verify')).clearAttestation(nodeId);
    expect(await latestAttestation(nodeId)).toBeNull();
    // dispatch-time freshness: an hour later the attestation no longer counts
    await recordAttestation(nodeId, nodeKey, (await env.makeBundle(nodeKey)).bundle);
    expect(await latestAttestation(nodeId)).not.toBeNull();
    expect(await latestAttestation(nodeId, new Date(Date.now() + 3601_000))).toBeNull();
  });

  test('failure stores the reason and clears last_attest_at', async () => {
    const ok = await env.makeBundle(nodeKey);
    await recordAttestation(nodeId, nodeKey, ok.bundle);
    const bad = await env.makeBundle(nodeKey, { reportDataFor: `0x${'1'.repeat(40)}` });
    const r = await recordAttestation(nodeId, nodeKey, bad.bundle);
    expect(r.ok).toBe(false);
    const [n] = await t.db.select().from(nodes).where(eq(nodes.id, nodeId));
    expect(n?.lastAttestAt).toBeNull();
    const rows = await t.db.select().from(nodeAttestations);
    expect(rows.find((x) => !x.verified)?.reason).toContain('REPORT_DATA_MISMATCH');
  });

  test('replaying an already accepted quote is rejected', async () => {
    const { bundle } = await env.makeBundle(nodeKey);
    expect((await recordAttestation(nodeId, nodeKey, bundle)).ok).toBe(true);
    expect(await recordAttestation(nodeId, nodeKey, bundle)).toMatchObject({ ok: false, reason: 'REPLAY' });
  });
});

describe('transient outages and uniqueness', () => {
  test('a PCS/NRAS outage keeps the node eligible; a real failure evicts it', async () => {
    await recordAttestation(nodeId, nodeKey, (await env.makeBundle(nodeKey)).bundle);
    const { bundle } = await env.makeBundle(nodeKey);
    nvidiaDeps.nras = async () => {
      throw new Error('503');
    };
    expect(await recordAttestation(nodeId, nodeKey, bundle)).toMatchObject({
      ok: false,
      reason: 'NVIDIA_NRAS_UNAVAILABLE',
    });
    const [n] = await t.db.select().from(nodes).where(eq(nodes.id, nodeId));
    expect(n?.lastAttestAt).toBeInstanceOf(Date);
  });

  test('the hook retries a transient failure with backoff and succeeds', async () => {
    const { onNodeAttestation, retryDelaysMs, hookDeps } = await import('./hooks');
    const { bundle } = await env.makeBundle(nodeKey);
    const real = nvidiaDeps.nras;
    let calls = 0;
    nvidiaDeps.nras = async (ev) => {
      if (calls++ === 0) throw new Error('503');
      return real(ev);
    };
    const savedDelays = retryDelaysMs.value;
    retryDelaysMs.value = [20];
    hookDeps.enabled = () => true;
    try {
      await onNodeAttestation(nodeId, nodeKey, bundle);
      for (let i = 0; i < 100 && calls < 2; i++) await Bun.sleep(20);
      await Bun.sleep(100);
      expect(calls).toBe(2);
      expect(await latestAttestation(nodeId)).not.toBeNull();
    } finally {
      retryDelaysMs.value = savedDelays;
      hookDeps.enabled = () => false;
    }
  });

  test('the database refuses two verified rows with the same quote hash', async () => {
    const { bundle } = await env.makeBundle(nodeKey);
    const r = await recordAttestation(nodeId, nodeKey, bundle);
    if (!r.ok) throw new Error('setup');
    await expect(
      (async () => {
        await t.db
          .insert(nodeAttestations)
          .values({ nodeId, quoteHash: r.evidence.quoteHash, verified: true });
      })(),
    ).rejects.toThrow();
  });
});

describe('verifyReceiptAttestation (receipt rule 6)', () => {
  const JOB = '11111111-1111-4111-8111-111111111111';
  const job = (): VerifyJob => ({
    id: JOB,
    model: 'm',
    kind: 'chat',
    lane: 'sealed',
    nodeKey,
    nodePubkey: acct.publicKey,
  });
  const payload = (
    a: Partial<NonNullable<ReceiptPayload['attestation']>> | null,
    over: Partial<ReceiptPayload> = {},
  ): ReceiptPayload => ({
    v: 1,
    jobId: JOB,
    nodeKey,
    model: 'm',
    modelDigest: 'x',
    kind: 'chat',
    lane: 'sealed',
    usage: { p: 0, c: 0 },
    inputDigest: '0'.repeat(64),
    outputDigest: '0'.repeat(64),
    startedAt: Date.now() - 1000,
    finishedAt: Date.now(),
    agentVersion: '0',
    ...(a ? { attestation: { quoteHash: '', rtmr3: '', gpuEvidenceHash: '', hpkeKeyHash: '', ...a } } : {}),
    ...over,
  });

  test('matches a verified, unexpired attestation; rejects missing, unknown, mismatched and stale', async () => {
    const { bundle } = await env.makeBundle(nodeKey);
    const r = await recordAttestation(nodeId, nodeKey, bundle);
    if (!r.ok) throw new Error('setup');
    const e = r.evidence;
    const good = {
      quoteHash: e.quoteHash,
      rtmr3: e.rtmr3,
      gpuEvidenceHash: e.gpuEvidenceHash,
      hpkeKeyHash: e.hpkeKeyHash,
    };
    expect(await verifyReceiptAttestation(job(), payload(good))).toMatchObject({ ok: true });
    expect(await verifyReceiptAttestation(job(), payload(null))).toMatchObject({
      ok: false,
      reason: 'NO_RECEIPT_ATTESTATION',
    });
    expect(
      await verifyReceiptAttestation(job(), payload({ ...good, quoteHash: 'ab'.repeat(32) })),
    ).toMatchObject({ ok: false, reason: 'ATTESTATION_UNKNOWN' });
    expect(
      await verifyReceiptAttestation(job(), payload({ ...good, hpkeKeyHash: 'cd'.repeat(32) })),
    ).toMatchObject({ ok: false, reason: 'ATTESTATION_MISMATCH' });
    expect(await verifyReceiptAttestation(job(), payload({ ...good, rtmr3: 'cd'.repeat(48) }))).toMatchObject(
      { ok: false, reason: 'ATTESTATION_MISMATCH' },
    );
    // node-claimed times are irrelevant: a far-future claim does not matter ...
    expect(
      await verifyReceiptAttestation(job(), payload(good, { finishedAt: Date.now() + 2 * 3600_000 })),
    ).toMatchObject({ ok: true });
    // ... the gateway-observed finish time is what counts
    const buyerId = await buyerIdForAddress(`0x${'7'.repeat(40)}`);
    await t.db.insert(jobs).values({
      id: JOB,
      buyerId,
      lane: 'sealed',
      model: 'm',
      kind: 'chat',
      unitKind: 'gpu_hour',
      payMode: 'balance',
      status: 'completed',
      dispatchedAt: new Date(),
      finishedAt: new Date(Date.now() + 2 * 3600_000),
    });
    expect(await verifyReceiptAttestation(job(), payload(good))).toMatchObject({
      ok: false,
      reason: 'ATTESTATION_STALE',
    });
    // another node cannot present this attestation
    const other = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
    expect(await verifyReceiptAttestation({ ...job(), nodeKey: other }, payload(good))).toMatchObject({
      ok: false,
      reason: 'ATTESTATION_UNKNOWN',
    });
  });
});
