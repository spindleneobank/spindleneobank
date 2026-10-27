import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { enrollments, nodes, users } from '../../db/schema';
import { closeRedis } from '../../lib/redis';
import { nodeBindingTypedData } from '../../shared/binding';
import { CLOSE_CODES, helloSigningMessage } from '../../shared/node-protocol';
import { dbRef } from '../auth/constants';
import {
  approvePairing,
  CROCKFORD,
  consumeToken,
  createEnrollment,
  createPairing,
  takePairing,
} from './enroll';
import { nodeHub } from './hub';
import { JobFailure } from './jobs';
import { nodeSettings, setStakingParamsForTest } from './service';
import { type FakeNode, fakeNode, startTestServer } from './testing';

let t: TestDb;
let srv: ReturnType<typeof startTestServer>;
const OWNER = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
let userId: string;
const nodesToStop: FakeNode[] = [];

const spawn = (o: Parameters<typeof fakeNode>[0]) => {
  const n = fakeNode(o);
  nodesToStop.push(n);
  n.conn.start();
  return n;
};

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
  srv = startTestServer();
  nodeSettings.registry = '0x00000000000000000000000000000000000000b2';
  setStakingParamsForTest({
    token: '0x00000000000000000000000000000000000000c3',
    minStakeByClass: { '0': '50', '1': '100', '2': '200', '3': '300', '4': '400' },
    unstakeDelay: 604800,
  });
  await nodeHub.start({ redis: false });
});
afterAll(async () => {
  setStakingParamsForTest(null);
  await nodeHub.stop();
  srv.stop();
  await t.close();
  await closeRedis();
});
beforeEach(async () => {
  await t.reset();
  const [u] = await t.db.insert(users).values({ address: OWNER }).returning();
  userId = u?.id as string;
});
afterEach(async () => {
  for (const n of nodesToStop.splice(0)) n.conn.stop();
  for (let i = 0; i < 100 && nodeHub.onlineNodeIds().length > 0; i++)
    await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 30));
  nodeSettings.jobTimeoutMs = 120_000;
});

async function enrolled(over: Partial<Parameters<typeof fakeNode>[0]> = {}) {
  const { token } = await createEnrollment(userId, { engine: 'ollama', os: 'linux', name: 'rig-1' });
  const n = spawn({
    wsUrl: srv.wsUrl,
    token,
    gpu: { name: 'NVIDIA GeForce RTX 4090', vramMb: 24576 },
    models: ['qwen2.5:7b'],
    ...over,
  });
  await n.waitFor(() => n.welcomes.length > 0);
  const [row] = await t.db.select().from(nodes).where(eq(nodes.nodeKey, n.address.toLowerCase()));
  return { n, row: row as typeof nodes.$inferSelect };
}

let onchain = 0n;
const register = async (nodeId: string) => {
  await t.db.update(nodes).set({ registered: true, onchainId: ++onchain }).where(eq(nodes.id, nodeId));
  await nodeHub.refreshEligibility(nodeId);
};

describe('enrollment and auth', () => {
  test('token enroll -> welcome -> binding stored; class is server computed', async () => {
    const { n, row } = await enrolled();
    const w = n.welcomes[0];
    expect(w?.gpuClass).toBe(2);
    expect(w?.lane).toBe('open');
    expect(w?.name).toBe('rig-1');
    expect(w?.registered).toBe(false);
    expect(w?.eligible).toBe(false);
    expect(row.owner).toBe(OWNER);
    expect(row.gpuClass).toBe(2);
    expect(row.status).toBe('online');
    await n
      .waitFor(() => nodeHub.getSession(row.id)?.node?.bindingSig != null || false, 3000)
      .catch(() => {});
    const [after] = await t.db.select().from(nodes).where(eq(nodes.id, row.id));
    expect(after?.bindingSig).toMatch(/^0x[0-9a-f]+$/i);
    expect(Number(after?.bindingDeadline)).toBeGreaterThan(Date.now() / 1000 + 29 * 86400);
    expect(n.ensures.at(-1)?.models.map((m) => m.id)).toContain('qwen2.5:7b');
    const [enr] = await t.db.select().from(enrollments);
    expect(enr?.status).toBe('approved');
    expect(enr?.nodeKey).toBe(n.address.toLowerCase());
  });

  test('tokens are single use and expire', async () => {
    const a = await createEnrollment(userId, { engine: 'ollama', os: 'linux' });
    const k1 = privateKeyToAccount(generatePrivateKey()).address;
    expect(await consumeToken(a.token, k1)).not.toBeNull();
    expect(await consumeToken(a.token, k1)).toBeNull();
    const b = await createEnrollment(
      userId,
      { engine: 'ollama', os: 'linux' },
      new Date(Date.now() - 16 * 60_000),
    );
    expect(await consumeToken(b.token, k1)).toBeNull();
    expect(await consumeToken('spdl_enr_nope', k1)).toBeNull();
    const [row] = await t.db.select().from(enrollments).where(eq(enrollments.id, b.enrollmentId));
    expect(row?.status).toBe('expired');
  });

  test('second node with a used token is rejected with 4003', async () => {
    const { token } = await createEnrollment(userId, { engine: 'ollama', os: 'linux' });
    const a = spawn({ wsUrl: srv.wsUrl, token, noReconnect: true });
    await a.waitFor(() => a.welcomes.length > 0);
    const b = spawn({ wsUrl: srv.wsUrl, token, noReconnect: true });
    await b.waitFor(() => b.closes.includes(CLOSE_CODES.AUTH_FAILED));
    expect(b.welcomes).toHaveLength(0);
  });

  test('pairing -> approve -> welcome', async () => {
    const n = spawn({ wsUrl: srv.wsUrl, gpu: { name: 'NVIDIA GeForce RTX 4090', vramMb: 24576 } });
    await n.waitFor(() => n.pairingCode() !== undefined);
    const code = n.pairingCode() as string;
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(n.welcomes).toHaveLength(0);
    await expect(approvePairing(userId, 'ZZZZ-ZZZZ')).rejects.toThrow();
    const node = await approvePairing(userId, code);
    expect(node.userId).toBe(userId);
    await n.waitFor(() => n.welcomes.length > 0);
    expect(n.welcomes[0]?.nodeId).toBe(node.id);
    await expect(approvePairing(userId, code)).rejects.toThrow(); // single use
  });

  test('pairing codes are unique, crockford-only and expire', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const p = await createPairing(`0x${i.toString(16).padStart(40, '0')}`);
      expect(seen.has(p.code)).toBe(false);
      seen.add(p.code);
      expect([...p.code.replace('-', '')].every((c) => CROCKFORD.includes(c))).toBe(true);
    }
    const p = await createPairing(`0x${'ab'.repeat(20)}`);
    expect(takePairing(p.code, new Date(p.expiresAt.getTime() + 1))).toBeNull();
  });

  test('bad signature -> 4003, replayed hello (old nonce) -> 4003', async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const mk = async (nonceFor: string, signer = acct) => {
      const hello = {
        v: 1,
        type: 'hello',
        nodeKey: acct.address,
        publicKey: acct.publicKey,
        agentVersion: '0.1.0',
        engine: 'ollama',
        engineVersion: '1',
        os: 'linux',
        arch: 'x64',
        hardware: { gpus: [], cpu: 'c', ramMb: 1 },
        models: [],
        capabilities: ['chat'],
        capacity: 1,
      };
      return { ...hello, sig: await signer.signMessage({ message: helloSigningMessage(nonceFor, hello) }) };
    };
    const open = () =>
      new Promise<{ ws: WebSocket; nonce: string; closed: Promise<number> }>((resolve) => {
        const ws = new WebSocket(`${srv.wsUrl}/v1/node/ws`);
        const closed = new Promise<number>((r) => ws.addEventListener('close', (e) => r(e.code)));
        ws.addEventListener(
          'message',
          (e) => resolve({ ws, nonce: JSON.parse(String(e.data)).nonce, closed }),
          { once: true },
        );
      });
    // wrong signer
    const c1 = await open();
    c1.ws.send(JSON.stringify(await mk(c1.nonce, privateKeyToAccount(generatePrivateKey()))));
    expect(await c1.closed).toBe(4003);
    // replay: sign for connection 2's nonce, send on connection 3
    const c2 = await open();
    const old = await mk(c2.nonce);
    c2.ws.close();
    const c3 = await open();
    c3.ws.send(JSON.stringify(old));
    expect(await c3.closed).toBe(4003);
  });

  test('replacement -> old connection closed with 4008', async () => {
    const { n, row } = await enrolled({ noReconnect: true });
    const second = spawn({ wsUrl: srv.wsUrl, key: n.privateKey, noReconnect: true });
    await second.waitFor(() => second.welcomes.length > 0);
    await n.waitFor(() => n.closes.includes(CLOSE_CODES.REPLACED));
    expect(nodeHub.isOnline(row.id)).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    const [after] = await t.db.select().from(nodes).where(eq(nodes.id, row.id));
    expect(after?.status).toBe('online');
  });

  test('binding signature recovers to the node key and registry domain', async () => {
    const { n, row } = await enrolled();
    // The binding is persisted asynchronously after welcome: poll until it lands.
    type NodeRow = typeof nodes.$inferSelect;
    let after: NodeRow | undefined;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      [after] = await t.db.select().from(nodes).where(eq(nodes.id, row.id));
      if (after?.bindingSig && after.bindingDeadline != null) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(after?.bindingSig).toBeTruthy();
    const { recoverTypedDataAddress } = await import('viem');
    const td = nodeBindingTypedData({
      registry: nodeSettings.registry,
      chainId: nodeSettings.chainId,
      owner: OWNER as `0x${string}`,
      nodeKey: n.address,
      gpuClass: 2,
      ccCapable: false,
      deadline: after?.bindingDeadline as bigint,
    });
    expect(await recoverTypedDataAddress({ ...td, signature: after?.bindingSig as `0x${string}` })).toBe(
      n.address,
    );
  });

  test('old agent gets upgrade_required and 4001', async () => {
    const { token } = await createEnrollment(userId, { engine: 'ollama', os: 'linux' });
    const n = spawn({ wsUrl: srv.wsUrl, token, agentVersion: '0.0.1', noReconnect: true });
    await n.waitFor(() => n.closes.includes(CLOSE_CODES.UPGRADE_REQUIRED));
  });
});

describe('models and min stakes', () => {
  test('models.ready outside the ensure set is ignored', async () => {
    const { n, row } = await enrolled();
    n.conn.send({
      v: 1,
      type: 'models.ready',
      models: [
        { id: 'qwen2.5:7b', digest: 'd1' },
        { id: 'bogus', digest: 'd3' },
      ],
    });
    await new Promise((r) => setTimeout(r, 150));
    const s = nodeHub.getSession(row.id);
    expect([...(s?.models ?? [])]).toEqual(['qwen2.5:7b']);
    const [after] = await t.db.select().from(nodes).where(eq(nodes.id, row.id));
    expect(((after?.models ?? []) as { id: string }[]).map((m) => m.id)).toEqual(['qwen2.5:7b']);
  });

  test('getMinStakes reads the cache', async () => {
    const { getMinStakes } = await import('./service');
    expect((await getMinStakes())[2]).toBe(200n);
  });
});

describe('eligibility and candidates', () => {
  test('unregistered nodes are not candidates; registration + eligibility message flips it', async () => {
    const { n, row } = await enrolled();
    const filter = { model: 'qwen2.5:7b', lane: 'open', kind: 'chat' } as const;
    expect(nodeHub.candidates(filter)).toHaveLength(0);
    expect(nodeHub.candidates({ ...filter, includeUnregistered: true })).toHaveLength(1);
    expect(() => nodeHub.dispatch(row.id, job('j0'))).toThrow();
    await register(row.id);
    await n.waitFor(() => n.logs.some((l) => l.includes('now registered')));
    const c = nodeHub.candidates(filter);
    expect(c).toHaveLength(1);
    expect(c[0]?.staked).toBe(false);
    await t.db.update(nodes).set({ stakeSpdl: '250' }).where(eq(nodes.id, row.id));
    await nodeHub.refreshEligibility(row.id);
    expect(nodeHub.candidates(filter)[0]?.staked).toBe(true);
    expect(nodeHub.candidates({ ...filter, model: 'nope' })).toHaveLength(0);
    expect(nodeHub.candidates({ ...filter, lane: 'sealed' })).toHaveLength(0);
  });
});

const job = (jobId: string) => ({
  jobId,
  kind: 'chat' as const,
  model: 'qwen2.5:7b',
  engineModel: 'qwen2.5:7b',
  lane: 'open' as const,
  request: { messages: [{ role: 'user', content: 'hi' }], stream: true },
  maxTokens: 16,
  deadlineMs: Date.now() + 60_000,
});

describe('jobs', () => {
  const streamer = (node: FakeNode, j: { jobId: string }) => {
    node.conn.send({ v: 1, type: 'job.accepted', jobId: j.jobId });
    node.conn.send({ v: 1, type: 'job.chunk', jobId: j.jobId, seq: 0, delta: { content: 'he' } });
    node.conn.send({ v: 1, type: 'job.chunk', jobId: j.jobId, seq: 1, delta: { content: 'llo' } });
    node.conn.send({
      v: 1,
      type: 'job.done',
      jobId: j.jobId,
      output: { id: 'x' },
      usage: { promptTokens: 1, completionTokens: 2 },
      receipt: 'AA==',
    });
  };

  test('streamed job: chunks then done; duplicate jobId rejected', async () => {
    const { row } = await enrolled({ onJob: streamer });
    await register(row.id);
    const h = nodeHub.dispatch(row.id, job('j1'));
    expect(() => nodeHub.dispatch(row.id, job('j1'))).toThrow();
    const got: string[] = [];
    for await (const c of h.chunks) got.push(c.delta.content ?? '');
    expect(got).toEqual(['he', 'llo']);
    const done = await h.done;
    expect(done.usage.completionTokens).toBe(2);
    expect(await h.accepted).toBe(true);
    // id is free again afterwards
    expect(nodeHub.getSession(row.id)?.inflight.size).toBe(0);
  });

  test('foreign jobId messages are dropped', async () => {
    const a = await enrolled({ onJob: () => {} });
    const b = await enrolled({ onJob: () => {} });
    await register(a.row.id);
    await register(b.row.id);
    const h = nodeHub.dispatch(a.row.id, job('j2'));
    // node B tries to speak for A's job
    b.n.conn.send({ v: 1, type: 'job.chunk', jobId: 'j2', seq: 0, delta: { content: 'evil' } });
    b.n.conn.send({
      v: 1,
      type: 'job.done',
      jobId: 'j2',
      output: {},
      usage: { promptTokens: 0, completionTokens: 0 },
      receipt: 'AA==',
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(nodeHub.getSession(a.row.id)?.inflight.has('j2')).toBe(true);
    // the real owner still completes it
    streamer(a.n, { jobId: 'j2' });
    const got: string[] = [];
    for await (const c of h.chunks) got.push(c.delta.content ?? '');
    expect(got).toEqual(['he', 'llo']);
    await h.done;
  });

  test('timeout rejects done with TIMEOUT and cancels on the node', async () => {
    nodeSettings.jobTimeoutMs = 150;
    const { row } = await enrolled({ onJob: () => {} });
    await register(row.id);
    const h = nodeHub.dispatch(row.id, job('j3'));
    await expect(h.done).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(nodeHub.getSession(row.id)?.inflight.size).toBe(0);
  });

  test('BUSY without accepted is requeueable', async () => {
    const { row } = await enrolled({
      onJob: (node, j) =>
        node.conn.send({ v: 1, type: 'job.error', jobId: j.jobId, code: 'BUSY', message: 'busy' }),
    });
    await register(row.id);
    const err = await nodeHub.dispatch(row.id, job('j4')).done.catch((e) => e);
    expect(err).toBeInstanceOf(JobFailure);
    expect(err).toMatchObject({ code: 'BUSY', requeueable: true });
  });

  test('node loss before any chunk -> nodeLost requeue callback; after chunks -> no requeue', async () => {
    const lost: import('./hub').NodeLostEvent[] = [];
    const off = nodeHub.on('nodeLost', (e) => lost.push(e));
    const a = await enrolled({ onJob: () => {} });
    await register(a.row.id);
    const h = nodeHub.dispatch(a.row.id, job('j5'));
    a.n.conn.stop();
    const err = await h.done.catch((e) => e);
    expect(err).toMatchObject({ code: 'NODE_LOST', requeueable: true });
    expect(lost).toEqual([{ jobId: 'j5', nodeId: a.row.id, requeue: true }]);
    await new Promise((r) => setTimeout(r, 100));
    const [off1] = await t.db.select().from(nodes).where(eq(nodes.id, a.row.id));
    expect(off1?.status).toBe('offline');

    const b = await enrolled({
      onJob: (node, j) =>
        node.conn.send({ v: 1, type: 'job.chunk', jobId: j.jobId, seq: 0, delta: { content: 'x' } }),
    });
    await register(b.row.id);
    const h2 = nodeHub.dispatch(b.row.id, job('j6'));
    await new Promise((r) => setTimeout(r, 100));
    b.n.conn.stop();
    const err2 = await h2.done.catch((e) => e);
    expect(err2).toMatchObject({ code: 'NODE_LOST', requeueable: false });
    expect(lost.at(-1)).toEqual({ jobId: 'j6', nodeId: b.row.id, requeue: false });
    off();
  });

  test('silent node is swept offline after the liveness timeout', async () => {
    const { n, row } = await enrolled({ noReconnect: true });
    void n;
    await nodeHub.sweep(Date.now() + 46_000);
    expect(nodeHub.isOnline(row.id)).toBe(false);
    await new Promise((r) => setTimeout(r, 100));
    const [after] = await t.db.select().from(nodes).where(eq(nodes.id, row.id));
    expect(after?.status).toBe('offline');
  });
});
