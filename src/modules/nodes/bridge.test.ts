import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { nodes, users } from '../../db/schema';
import { closeRedis, getRedis } from '../../lib/redis';
import { dbRef } from '../auth/constants';
import { createEnrollment } from './enroll';
import { nodeHub } from './hub';
import { requestFromWorker } from './jobs';
import { setStakingParamsForTest } from './service';
import { type FakeNode, fakeNode, startTestServer } from './testing';

let t: TestDb;
let srv: ReturnType<typeof startTestServer>;
let n: FakeNode;

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
  srv = startTestServer();
  setStakingParamsForTest({
    enabled: true,
    token: '0x00000000000000000000000000000000000000c3',
    minStakeByClass: { '0': '50', '1': '100', '2': '200', '3': '300', '4': '400' },
    unstakeDelay: 604800,
  });
  await nodeHub.start({ redis: true });
});
afterAll(async () => {
  n?.conn.stop();
  setStakingParamsForTest(null);
  await nodeHub.stop();
  srv.stop();
  await t.close();
  await closeRedis();
});
beforeEach(() => t.reset());

describe('redis bridge', () => {
  test('worker dispatch round trip with chunks, candidates and eligibility events', async () => {
    const [u] = await t.db
      .insert(users)
      .values({ address: privateKeyToAccount(generatePrivateKey()).address.toLowerCase() })
      .returning();
    const { token } = await createEnrollment(u?.id as string, { engine: 'ollama', os: 'linux' });
    n = fakeNode({
      wsUrl: srv.wsUrl,
      token,
      models: ['qwen2.5:7b'],
      gpu: { name: 'NVIDIA GeForce RTX 4090', vramMb: 24576 },
      noReconnect: true,
      onJob: (node, j) => {
        node.conn.send({ v: 1, type: 'job.chunk', jobId: j.jobId, seq: 0, delta: { content: 'a' } });
        node.conn.send({ v: 1, type: 'job.chunk', jobId: j.jobId, seq: 1, delta: { content: 'b' } });
        node.conn.send({
          v: 1,
          type: 'job.done',
          jobId: j.jobId,
          output: {},
          usage: { promptTokens: 1, completionTokens: 2 },
          receipt: 'AA==',
        });
      },
    });
    n.conn.start();
    await n.waitFor(() => n.welcomes.length > 0);
    const nodeId = n.welcomes[0]?.nodeId as string;
    const [row] = await t.db
      .update(nodes)
      .set({ registered: true, onchainId: 7n })
      .where(eq(nodes.id, nodeId))
      .returning();
    expect(row?.registered).toBe(true);

    // B6 publishes eligibility on node:evt; the hub forwards it to the node
    await getRedis().publish('node:evt', JSON.stringify({ type: 'eligibility', onchainId: '7' }));
    await n.waitFor(() => n.logs.some((l) => l.includes('now registered')));

    const cands = await requestFromWorker<{ nodeId: string }[]>({
      type: 'candidates',
      filter: { model: 'qwen2.5:7b', lane: 'open', kind: 'chat' },
    });
    expect(cands.map((c) => c.nodeId)).toEqual([nodeId]);

    const seen: string[] = [];
    const done = await requestFromWorker<{ usage: { completionTokens: number } }>(
      {
        type: 'dispatch',
        nodeId,
        job: {
          jobId: 'bridge-1',
          kind: 'chat',
          model: 'qwen2.5:7b',
          engineModel: 'qwen2.5:7b',
          lane: 'open',
          request: {},
          maxTokens: 4,
          deadlineMs: Date.now() + 30_000,
        },
      },
      { onChunk: (c) => seen.push(c.delta.content ?? '') },
    );
    expect(seen).toEqual(['a', 'b']);
    expect(done.usage.completionTokens).toBe(2);

    await expect(
      requestFromWorker({
        type: 'dispatch',
        nodeId: 'missing',
        job: {
          jobId: 'x',
          kind: 'chat',
          model: 'm',
          engineModel: 'm',
          lane: 'open',
          request: {},
          maxTokens: 1,
          deadlineMs: Date.now() + 1000,
        },
      }),
    ).rejects.toMatchObject({ code: 'NO_CAPACITY' });

    expect(await requestFromWorker({ type: 'close', nodeId })).toEqual({ ok: true });
    await n.waitFor(() => n.closes.length > 0);
  });
});
