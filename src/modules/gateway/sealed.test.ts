import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { credit } from '../../db/balances';
import { buyerBalances, buyerLedger, jobs, nodes, rateCard, receipts, users } from '../../db/schema';
import { type Env, jsonError } from '../../lib/http';
import { closeRedis } from '../../lib/redis';
import { canonicalJson, sha256Hex } from '../../shared/canonical-json';
import { receiptToBase64, signReceipt } from '../../shared/receipt';
import { openRequest, ResponseSealer, sealRequest } from '../../shared/sealed';
import { installSyntheticEnv, type SyntheticEnv } from '../attest/testkit';
import { recordAttestation } from '../attest/verify';
import { dbRef } from '../auth/constants';
import authRoutes from '../auth/routes';
import { createApiKey } from '../buyers/apikeys';
import buyerRoutes from '../buyers/routes';
import { buyerIdForAddress } from '../buyers/service';
import { ChunkStream, type JobDone, type JobHandle } from '../nodes/jobs';
import { nodeSettings } from '../nodes/service';
import { onJobFinished } from '../receipts/service';
import { utcDay } from './pricing';
import gatewayRoutes from './routes';
import type { Candidate } from './scheduler';
import sealedRoutes, { billableMs, gpuHourMicros, sealedDeps } from './sealed';
import { gatewayDeps, registerJobFinishedHandler, resetJobFinishedHandler } from './service';

let t: TestDb;
let server: ReturnType<typeof Bun.serve>;
let base: string;
let env: SyntheticEnv;
const nodeAcct = privateKeyToAccount(generatePrivateKey());
const nodeKey = nodeAcct.address.toLowerCase();
const OWNER = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const BUYER = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
let buyerId: string;
let apiKey: string;
let nodeId: string;
let hpke: CryptoKey;
let hpkePub: string;
let attestEvidence: { quoteHash: string; rtmr3: string; gpuEvidenceHash: string; hpkeKeyHash: string };
const origDispatch = gatewayDeps.dispatch;
const origRank = gatewayDeps.rank;
const PER_HOUR = 36_000_000n; // $36 / GPU-hour = 10_000 micros per second
const MODEL = 'qwen2.5:7b';
const dispatched: unknown[] = [];

const candidate = (): Candidate =>
  ({
    nodeId,
    nodeKey,
    owner: OWNER,
    lane: 'sealed',
    gpuClass: 3,
    engine: 'vllm',
    isHouse: false,
    registered: true,
    staked: false,
    stake: 0n,
    reputation: 1000,
    inflight: 0,
    capacity: 1,
    lastSeen: Date.now(),
    tier: 'unstaked',
    score: 1,
    nodeLane: 'sealed',
  }) satisfies Candidate;

/** Plays the CVM: opens the sealed request with the real HPKE key, seals chunks and output, signs a receipt. */
let nodeBehaviour: 'ok' | 'fail' = 'ok';
let plaintextSeenByNode: unknown;
function fakeCvm(nodeId_: string, input: Parameters<typeof origDispatch>[1]): JobHandle {
  dispatched.push(input);
  const chunks = new ChunkStream();
  let resolve!: (d: JobDone) => void;
  let reject!: (e: unknown) => void;
  const done = new Promise<JobDone>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  done.catch(() => {});
  void (async () => {
    if (nodeBehaviour === 'fail') {
      chunks.close();
      return reject(new (await import('../nodes/jobs')).JobFailure('ENGINE_ERROR', 'boom', false, 0));
    }
    const sealed = input.sealed as { enc: string; ciphertext: string };
    const opened = await openRequest(hpke, sealed, nodeKey, input.model);
    plaintextSeenByNode = opened.request;
    const sealer = await ResponseSealer.create(opened.ephemeralPub, input.jobId);
    const startedAt = Date.now();
    chunks.push({
      seq: 0,
      delta: { content: await sealer.seal({ delta: { content: 'Hel' } }) },
      sealed: true,
    });
    chunks.push({
      seq: 1,
      delta: { content: await sealer.seal({ delta: { content: 'lo' } }) },
      sealed: true,
    });
    const output = await sealer.seal({ output: { choices: [{ message: { content: 'Hello' } }] } });
    chunks.close();
    const receipt = receiptToBase64(
      signReceipt(
        {
          v: 1,
          jobId: input.jobId,
          nodeKey: nodeAcct.address,
          model: input.model,
          modelDigest: 'sha256:syn',
          kind: 'chat',
          lane: 'sealed',
          usage: { p: 0, c: 0 },
          inputDigest: sha256Hex(canonicalJson({ enc: sealed.enc, ciphertext: sealed.ciphertext })),
          outputDigest: '0'.repeat(64),
          startedAt,
          finishedAt: startedAt + 2000,
          agentVersion: 'test',
          attestation: attestEvidence,
        },
        generatePrivateKeyFor(),
      ),
    );
    resolve({
      output: { sealed: output },
      usage: { promptTokens: 0, completionTokens: 0 },
      receipt,
      sealed: true,
    });
  })();
  return { jobId: input.jobId, nodeId: nodeId_, chunks, done, accepted: Promise.resolve(true), cancel() {} };
}
const NODE_PK = generatePrivateKey();
const generatePrivateKeyFor = () => NODE_PK;

const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, ...headers },
    body: JSON.stringify(body),
  });

async function sealedBody(extra: Record<string, unknown> = {}) {
  const s = await sealRequest({
    nodePublicKey: hpkePub,
    nodeKey,
    model: MODEL,
    request: { model: MODEL, messages: [{ role: 'user', content: 'TOP SECRET PROMPT' }] },
  });
  return { s, body: { model: MODEL, sealed: s.envelope, ...extra } };
}

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
  const app = new Hono<Env>();
  app.onError(jsonError);
  authRoutes(app);
  buyerRoutes(app);
  sealedRoutes(app);
  gatewayRoutes(app);
  server = Bun.serve({ port: 0, fetch: app.fetch });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  server.stop(true);
  await t.close();
  await closeRedis();
});
beforeEach(async () => {
  await t.reset();
  dispatched.length = 0;
  nodeBehaviour = 'ok';
  env = await installSyntheticEnv();
  sealedDeps.enabled = () => true;
  resetJobFinishedHandler();
  registerJobFinishedHandler(onJobFinished);
  gatewayDeps.dispatch = fakeCvm;
  gatewayDeps.rank = async () => [candidate()];
  const [u] = await t.db.insert(users).values({ address: OWNER }).returning();
  buyerId = await buyerIdForAddress(BUYER);
  await credit(t.db, { buyerId, micros: 1_000_000_000n, txHash: `0x${'1'.repeat(64)}`, logIndex: 0 });
  apiKey = (await createApiKey(buyerId, 'test')).key;
  const [n] = await t.db
    .insert(nodes)
    .values({
      owner: OWNER,
      userId: u?.id as string,
      nodeKey,
      nodePubkey: privateKeyToAccount(NODE_PK).publicKey,
      name: 'cvm',
      engine: 'vllm',
      gpuModel: 'H100',
      gpuClass: 3,
      lane: 'sealed',
      status: 'online',
      registered: true,
      onchainId: 5n,
    })
    .returning();
  nodeId = n?.id as string;
  await t.db
    .update(nodes)
    .set({ nodePubkey: privateKeyToAccount(NODE_PK).publicKey })
    .where(eq(nodes.id, nodeId));
  await t.db.insert(rateCard).values({
    day: utcDay(),
    gpuClass: 3,
    lane: 'sealed',
    unitKind: 'gpu_hour',
    buyerUsdgMicrosPerUnit: PER_HOUR,
    providerUsdgMicrosPerUnit: (PER_HOUR * 8n) / 10n,
  });
  // attest the node (SYNTHETIC evidence)
  const { bundle, hpkePrivateKey } = await env.makeBundle(nodeKey);
  hpke = hpkePrivateKey;
  hpkePub = bundle.hpkePublicKey;
  const r = await recordAttestation(nodeId, nodeKey, bundle);
  if (!r.ok) throw new Error(`setup attestation failed: ${r.reason}`);
  attestEvidence = r.evidence;
});
afterEach(async () => {
  // background settlement (finishJob -> B7) must finish before the next truncate
  for (let i = 0; i < 150; i++) {
    const [b] = await t.db.select().from(buyerBalances);
    if (!b || b.reservedUsdgMicros === 0n) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  env.restore();
  sealedDeps.enabled = () => false;
  gatewayDeps.dispatch = origDispatch;
  gatewayDeps.rank = origRank;
  nodeSettings.jobTimeoutMs = 120_000;
});

describe('flag off (default): nothing sealed is reachable', () => {
  test('keys 404, sealed chat takes the legacy 503 path and nothing is dispatched', async () => {
    sealedDeps.enabled = () => false;
    gatewayDeps.rank = async () => [];
    const k = await fetch(`${base}/v1/sealed/keys?model=${MODEL}`);
    expect(k.status).toBe(404);
    const { body } = await sealedBody();
    const res = await post(body, { 'X-Spindle-Lane': 'sealed' });
    expect(res.status).toBe(400); // legacy OpenAI validation: a sealed body is not an OpenAI body
    expect(dispatched).toHaveLength(0);
    expect(await t.db.select().from(jobs)).toHaveLength(0);
  });
});

describe('GET /v1/sealed/keys', () => {
  test('lists attested nodes with their HPKE key; hides nodes without fresh attestation', async () => {
    const res = await fetch(`${base}/v1/sealed/keys?model=${MODEL}`);
    expect(res.status).toBe(200);
    const list = (await res.json()) as {
      nodeKey: string;
      hpkePublicKey: string;
      attestationSummary: { composeHash: string };
      expiresAt: string;
    }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ nodeKey, hpkePublicKey: hpkePub });
    expect(list[0]?.attestationSummary.composeHash).toBeTruthy();
    await t.db.update(nodes).set({ lastAttestAt: null }).where(eq(nodes.id, nodeId));
    expect(await (await fetch(`${base}/v1/sealed/keys?model=${MODEL}`)).json()).toEqual([]);
    expect((await fetch(`${base}/v1/sealed/keys`)).status).toBe(400);
  });
});

describe('sealed relay', () => {
  test('non-stream: gateway relays ciphertext only; buyer opens the response; billed per GPU-hour from the receipt', async () => {
    const { s, body } = await sealedBody();
    const res = await post(body, { 'X-Spindle-Lane': 'sealed' });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('TOP SECRET');
    expect(text).not.toContain('Hello');
    const j = JSON.parse(text) as {
      sealed: { frames: string[]; output: string };
      spindle: { jobId: string; chargeMicros: string };
    };

    // what the gateway handed to the node is only the envelope
    const sent = dispatched[0] as { request: unknown; sealed: { enc: string; ciphertext: string } };
    expect(sent.request).toEqual({});
    expect(JSON.stringify(sent)).not.toContain('TOP SECRET');
    // the node (real HPKE) saw the plaintext
    expect(JSON.stringify(plaintextSeenByNode)).toContain('TOP SECRET');

    // buyer opens frames in order
    const jobId = j.spindle.jobId;
    const f0 = await s.openResponse.open<{ delta: { content: string } }>(j.sealed.frames[0] as string, jobId);
    const f1 = await s.openResponse.open<{ delta: { content: string } }>(j.sealed.frames[1] as string, jobId);
    expect(f0.delta.content + f1.delta.content).toBe('Hello');
    const out = await s.openResponse.open<{ output: { choices: { message: { content: string } }[] } }>(
      j.sealed.output,
      jobId,
    );
    expect(out.output.choices[0]?.message.content).toBe('Hello');

    // settlement by B7: receipt verified incl. attestation, charged 2 s of GPU time = 20_000 micros
    for (let i = 0; i < 100; i++) {
      if ((await t.db.select().from(receipts)).length) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    const [rec] = await t.db.select().from(receipts);
    expect(rec).toMatchObject({ verified: true, reason: null });
    expect(rec?.attestationRef).toBeTruthy();
    const [job] = await t.db.select().from(jobs);
    expect(job).toMatchObject({ lane: 'sealed', unitKind: 'gpu_hour' });
    const charges = await t.db.select().from(buyerLedger).where(eq(buyerLedger.kind, 'charge'));
    expect(charges).toHaveLength(1);
    // gateway-observed time (a few ms) + 2 s slack caps the claimed 2 s: at most 20_000 micros, more than 0
    expect(-(charges[0]?.usdgMicros ?? 0n)).toBeGreaterThan(0n);
    expect(-(charges[0]?.usdgMicros ?? 0n)).toBeLessThanOrEqual(20_000n);
  });

  test('stream: SSE frames are opaque, then a final frame with spindle meta', async () => {
    const { s, body } = await sealedBody({ stream: true });
    const res = await post(body, { 'X-Spindle-Lane': 'sealed' });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('TOP SECRET');
    const frames = text
      .split('\n\n')
      .filter((l) => l.startsWith('data: {'))
      .map((l) => JSON.parse(l.slice(6)) as { sealed: string; final?: boolean; spindle?: { jobId: string } });
    expect(frames.length).toBe(3);
    expect(frames[2]?.final).toBe(true);
    const jobId = res.headers.get('X-Spindle-Job-Id') as string;
    const a = await s.openResponse.open<{ delta: { content: string } }>(frames[0]?.sealed as string, jobId);
    expect(a.delta.content).toBe('Hel');
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });

  test('wrong or unattested target node, unknown model and malformed body are refused before any reservation', async () => {
    const { body } = await sealedBody();
    const other = { ...body, sealed: { ...body.sealed, nodeKey: `0x${'7'.repeat(40)}` } };
    expect((await post(other, { 'X-Spindle-Lane': 'sealed' })).status).toBe(503);
    await t.db.update(nodes).set({ lastAttestAt: null }).where(eq(nodes.id, nodeId));
    // scheduler seam returns the node anyway; dispatch-time freshness must still refuse it
    await t.db
      .update((await import('../../db/schema')).nodeAttestations)
      .set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await post(body, { 'X-Spindle-Lane': 'sealed' })).status).toBe(503);
    expect((await post({ ...body, model: 'nope' }, { 'X-Spindle-Lane': 'sealed' })).status).toBe(404);
    expect((await post({ model: MODEL }, { 'X-Spindle-Lane': 'sealed' })).status).toBe(400);
    expect(dispatched).toHaveLength(0);
    expect(await t.db.select().from(jobs)).toHaveLength(0);
  });

  test('node failure releases the reservation and returns an error without charging', async () => {
    nodeBehaviour = 'fail';
    const { body } = await sealedBody();
    const res = await post(body, { 'X-Spindle-Lane': 'sealed' });
    expect(res.status).toBe(502);
    expect(await t.db.select().from(buyerLedger).where(eq(buyerLedger.kind, 'charge'))).toHaveLength(0);
  });
});

describe('sealed billing math', () => {
  test('gpuHourMicros rounds up per ms', () => {
    expect(gpuHourMicros(36_000_000n, 1000)).toBe(10_000n);
    expect(gpuHourMicros(36_000_000n, 3_600_000)).toBe(36_000_000n);
    expect(gpuHourMicros(1n, 1)).toBe(1n);
    expect(gpuHourMicros(100n, -5)).toBe(0n);
  });
  test('a node cannot bill more time than the gateway observed', () => {
    const d = new Date(1_000_000);
    expect(
      billableMs(
        { startedAt: 0, finishedAt: 3_600_000 },
        { dispatchedAt: d, finishedAt: new Date(1_005_000) },
      ),
    ).toBe(7000);
    expect(
      billableMs({ startedAt: 0, finishedAt: 1000 }, { dispatchedAt: d, finishedAt: new Date(1_005_000) }),
    ).toBe(1000);
    expect(billableMs({ startedAt: 10, finishedAt: 5 })).toBe(0);
  });
});
