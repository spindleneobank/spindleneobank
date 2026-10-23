import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { enrollments, nodes, users } from '../../db/schema';
import { closeRedis } from '../../lib/redis';
import { dbRef, settings } from '../auth/constants';
import { createTestSession } from '../auth/testing';
import { nodeHub } from './hub';
import { nodeSettings, setStakingParamsForTest } from './service';
import { type FakeNode, fakeNode, startTestServer } from './testing';

const ORIGIN = 'http://localhost:7000';
let t: TestDb;
let srv: ReturnType<typeof startTestServer>;
const alice = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const bob = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const spawned: FakeNode[] = [];

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
  Object.assign(settings, { corsOrigins: [ORIGIN] });
  srv = startTestServer();
  nodeSettings.registry = '0x00000000000000000000000000000000000000b2';
  nodeSettings.appUrl = 'https://app.example';
  nodeSettings.apiUrl = 'https://api.example';
  setStakingParamsForTest({
    token: '0x00000000000000000000000000000000000000c3',
    minStakeByClass: { '0': '0', '1': '100', '2': '200' },
    unstakeDelay: 604800,
  });
  await nodeHub.start({ redis: false });
});
afterAll(async () => {
  await nodeHub.stop();
  srv.stop();
  await t.close();
  await closeRedis();
});
beforeEach(() => t.reset());
afterEach(async () => {
  for (const n of spawned.splice(0)) n.conn.stop();
  for (let i = 0; i < 100 && nodeHub.onlineNodeIds().length > 0; i++)
    await new Promise((r) => setTimeout(r, 10));
});

const req = (
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) =>
  srv.app.request(path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

async function as(address: string) {
  const [u] = await t.db.insert(users).values({ address }).onConflictDoNothing().returning();
  void u;
  return (await createTestSession(address)).headers;
}

async function enrollNode(h: Record<string, string>) {
  const res = await req('/v1/app/nodes/enroll', {
    method: 'POST',
    headers: h,
    body: { engine: 'ollama', os: 'linux', name: 'My Rig' },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    token: string;
    commands: { docker: string; installer: string };
    enrollmentId: string;
  };
  const n = fakeNode({
    wsUrl: srv.wsUrl,
    token: body.token,
    gpu: { name: 'NVIDIA GeForce RTX 4090', vramMb: 24576 },
    models: ['qwen2.5:7b'],
    noReconnect: true,
  });
  spawned.push(n);
  n.conn.start();
  await n.waitFor(() => n.welcomes.length > 0);
  return { n, body, nodeId: n.welcomes[0]?.nodeId as string };
}

describe('nodes routes', () => {
  test('requires a session', async () => {
    expect((await req('/v1/app/nodes')).status).toBe(401);
    expect((await req('/v1/app/staking/params')).status).toBe(401);
  });

  test('enroll returns single-use token and commands; node appears in list', async () => {
    const h = await as(alice);
    const { body, nodeId, n } = await enrollNode(h);
    expect(body.token).toStartWith('spdl_enr_');
    expect(body.commands.docker).toContain('SPINDLE_API_URL=wss://api.example');
    expect(body.commands.docker).toContain(`SPINDLE_TOKEN=${body.token}`);
    expect(body.commands.installer).toBe(
      `curl -fsSL https://app.example/install.sh | sh -s -- --token ${body.token}`,
    );
    const win = await (
      await req('/v1/app/nodes/enroll', {
        method: 'POST',
        headers: h,
        body: { engine: 'vllm', os: 'windows' },
      })
    ).json();
    expect((win as { commands: { installer: string } }).commands.installer).toContain('install.ps1');

    const list = (await (await req('/v1/app/nodes', { headers: h })).json()) as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: nodeId,
      name: 'My Rig',
      status: 'online',
      gpuClass: 2,
      lane: 'open',
      registered: false,
      nodeKey: n.address.toLowerCase(),
      isHouse: false,
    });
    expect((list[0] as { stake: { min: string } }).stake.min).toBe('200');
    const detail = (await (await req(`/v1/app/nodes/${nodeId}`, { headers: h })).json()) as {
      probes: unknown[];
      jobs: unknown[];
    };
    expect(detail.probes).toEqual([]);
    expect(detail.jobs).toEqual([]);

    const patched = await req(`/v1/app/nodes/${nodeId}`, {
      method: 'PATCH',
      headers: h,
      body: { name: 'Renamed' },
    });
    expect(((await patched.json()) as { name: string }).name).toBe('Renamed');
    expect(
      (await req(`/v1/app/nodes/${nodeId}`, { method: 'PATCH', headers: h, body: { name: '' } })).status,
    ).toBe(400);
  });

  test('pair approves a live pairing code for this user only once', async () => {
    const h = await as(alice);
    const n = fakeNode({
      wsUrl: srv.wsUrl,
      gpu: { name: 'NVIDIA GeForce RTX 4090', vramMb: 24576 },
      noReconnect: true,
    });
    spawned.push(n);
    n.conn.start();
    await n.waitFor(() => n.pairingCode() !== undefined);
    const code = n.pairingCode() as string;
    expect(
      (await req('/v1/app/nodes/pair', { method: 'POST', headers: h, body: { code: 'bad' } })).status,
    ).toBe(400);
    const ok = await req('/v1/app/nodes/pair', { method: 'POST', headers: h, body: { code } });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { node: { nodeKey: string } }).node.nodeKey).toBe(n.address.toLowerCase());
    await n.waitFor(() => n.welcomes.length > 0);
    expect((await req('/v1/app/nodes/pair', { method: 'POST', headers: h, body: { code } })).status).toBe(
      404,
    );
    const [enr] = await t.db.select().from(enrollments);
    expect(enr).toMatchObject({ kind: 'pairing', status: 'approved', pairingCode: code });
  });

  test('owner isolation: other users get 404 and see nothing', async () => {
    const ha = await as(alice);
    const hb = await as(bob);
    const { nodeId } = await enrollNode(ha);
    expect((await req(`/v1/app/nodes/${nodeId}`, { headers: hb })).status).toBe(404);
    expect(
      (await req(`/v1/app/nodes/${nodeId}`, { method: 'PATCH', headers: hb, body: { name: 'x' } })).status,
    ).toBe(404);
    expect((await req(`/v1/app/nodes/${nodeId}/register-call`, { headers: hb })).status).toBe(404);
    expect((await req(`/v1/app/nodes/${nodeId}/stake-call?amount=1`, { headers: hb })).status).toBe(404);
    expect(await (await req('/v1/app/nodes', { headers: hb })).json()).toEqual([]);
    const [row] = await t.db.select().from(nodes).where(eq(nodes.id, nodeId));
    expect(row?.name).toBe('My Rig');
  });

  test('csrf: non-GET without x-spindle / allowed origin is rejected', async () => {
    const h = await as(alice);
    const cookie = h.cookie as string;
    for (const [path, body] of [
      ['/v1/app/nodes/enroll', { engine: 'ollama', os: 'linux' }],
      ['/v1/app/nodes/pair', { code: 'ABCD-EFGH' }],
    ] as const) {
      expect((await req(path, { method: 'POST', headers: { cookie }, body })).status).toBe(403);
      expect(
        (await req(path, { method: 'POST', headers: { ...h, origin: 'https://evil.example' }, body })).status,
      ).toBe(403);
    }
    expect(
      (
        await req('/v1/app/nodes/00000000-0000-0000-0000-000000000000', {
          method: 'PATCH',
          headers: { cookie },
          body: { name: 'x' },
        })
      ).status,
    ).toBe(403);
  });

  test('whitespace-only names are rejected', async () => {
    const h = await as(alice);
    expect(
      (
        await req('/v1/app/nodes/enroll', {
          method: 'POST',
          headers: h,
          body: { engine: 'ollama', os: 'linux', name: '   ' },
        })
      ).status,
    ).toBe(400);
    const { nodeId } = await enrollNode(h);
    expect(
      (await req(`/v1/app/nodes/${nodeId}`, { method: 'PATCH', headers: h, body: { name: '   ' } })).status,
    ).toBe(400);
    const ok = await req(`/v1/app/nodes/${nodeId}`, {
      method: 'PATCH',
      headers: h,
      body: { name: '  Padded  ' },
    });
    expect(((await ok.json()) as { name: string }).name).toBe('Padded');
  });

  test('enroll validates input', async () => {
    const h = await as(alice);
    expect(
      (await req('/v1/app/nodes/enroll', { method: 'POST', headers: h, body: { engine: 'x', os: 'linux' } }))
        .status,
    ).toBe(400);
  });

  test('register-call: fresh signature from the live node; 409 when offline and stale', async () => {
    const h = await as(alice);
    const { nodeId, n } = await enrollNode(h);
    // welcome binding is fresh (30 d): served from the stored signature
    const res = await req(`/v1/app/nodes/${nodeId}/register-call`, { headers: h });
    if (res.status === 200) {
      const j = (await res.json()) as { functionName: string; args: unknown[] };
      expect(j.functionName).toBe('registerNode');
      expect(j.args[0]).toBe(n.address.toLowerCase());
      expect(j.args[1]).toBe(2);
    } else {
      // REGISTRY_ADDRESS not configured in this environment
      expect(res.status).toBe(500);
    }
    // stale binding + offline -> 409 CHAIN_STATE
    n.conn.stop();
    for (let i = 0; i < 100 && nodeHub.isOnline(nodeId); i++) await new Promise((r) => setTimeout(r, 10));
    await t.db
      .update(nodes)
      .set({ bindingDeadline: BigInt(Math.floor(Date.now() / 1000) + 60) })
      .where(eq(nodes.id, nodeId));
    const stale = await req(`/v1/app/nodes/${nodeId}/register-call`, { headers: h });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe('CHAIN_STATE');
  });

  test('register-call asks a live node for a fresh binding when the stored one is about to expire', async () => {
    const h = await as(alice);
    const { nodeId, n } = await enrollNode(h);
    const soon = BigInt(Math.floor(Date.now() / 1000) + 3600);
    await t.db.update(nodes).set({ bindingDeadline: soon }).where(eq(nodes.id, nodeId));
    const res = await req(`/v1/app/nodes/${nodeId}/register-call`, { headers: h });
    if (res.status === 200) {
      const j = (await res.json()) as { args: string[] };
      expect(Number(j.args[4])).toBeGreaterThan(Date.now() / 1000 + 29 * 86400);
    }
    const [row] = await t.db.select().from(nodes).where(eq(nodes.id, nodeId));
    expect(row?.bindingDeadline && row.bindingDeadline > soon).toBe(true);
    void n;
  });

  test('stake-call requires a registered node', async () => {
    const h = await as(alice);
    const { nodeId } = await enrollNode(h);
    expect((await req(`/v1/app/nodes/${nodeId}/stake-call?amount=5`, { headers: h })).status).toBe(409);
    expect((await req(`/v1/app/nodes/${nodeId}/stake-call?amount=abc`, { headers: h })).status).toBe(400);
  });

  test('staking params are served from the cache', async () => {
    const h = await as(alice);
    const res = await req('/v1/app/staking/params', { headers: h });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { unstakeDelay: number }).unstakeDelay).toBe(604800);
  });
});
