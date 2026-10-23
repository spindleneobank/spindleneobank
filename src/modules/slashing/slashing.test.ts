import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { decodeFunctionData, keccak256, stringToBytes } from 'viem';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { auditLog, nodes } from '../../db/schema';
import { type Env, jsonError } from '../../lib/http';
import { closeRedis } from '../../lib/redis';
import { spindleStakingAbi } from '../../shared/abi';
import { canonicalJson } from '../../shared/canonical-json';
import { dbRef, settings } from '../auth/constants';
import authRoutes from '../auth/routes';
import { createTestSession } from '../auth/testing';
import { recordCanaryResult } from '../canary/service';
import slashingRoutes from './routes';
import { evidenceHash, openCase, safeTxFor, slashingDeps } from './service';
import { addr, makeCanaryJob, makeNode } from './testkit';

const STAKING = '0x00000000000000000000000000000000000057a4';
const ADMIN = addr();
const ORIGIN = 'http://localhost:7300';

const reverseKeys = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(reverseKeys)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .reverse()
            .map(([k, x]) => [k, reverseKeys(x)]),
        )
      : v;

describe('slashing', () => {
  let t: TestDb;
  let app: Hono<Env>;
  let admin: Record<string, string>;
  let closed: string[];
  const realClose = slashingDeps.closeNode;
  const realAddr = slashingDeps.stakingAddress;
  beforeAll(async () => {
    t = await setupTestDb();
    dbRef.db = t.db;
    settings.adminAddresses = [ADMIN];
    settings.corsOrigins = [ORIGIN];
    slashingDeps.stakingAddress = () => STAKING;
    app = new Hono<Env>();
    app.onError(jsonError);
    authRoutes(app);
    slashingRoutes(app);
  });
  afterAll(async () => {
    slashingDeps.closeNode = realClose;
    slashingDeps.stakingAddress = realAddr;
    await t.close();
    await closeRedis();
  });
  beforeEach(async () => {
    await t.reset();
    closed = [];
    slashingDeps.closeNode = async (id) => void closed.push(id);
    admin = { ...(await createTestSession(ADMIN)).headers, origin: ORIGIN };
  });

  const req = (method: string, path: string, body?: unknown, headers = admin) =>
    app.request(path, {
      method,
      headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });

  async function caseWithEvidence() {
    const n = await makeNode({ stakeSpdl: '10' });
    for (let i = 0; i < 3; i++)
      await recordCanaryResult({
        nodeId: n.id,
        jobId: await makeCanaryJob(n.id),
        kind: 'chat',
        expected: { fixtureId: 'add-1' },
        observed: { text: 'ok' },
        pass: false,
      });
    return n;
  }

  test('safeTx calldata decodes back to (onchainNodeId, bps, evidenceHash)', async () => {
    const n = await caseWithEvidence();
    const res = await req('GET', '/v1/admin/slash-cases');
    expect(res.status).toBe(200);
    const [c] = (await res.json()) as {
      id: string;
      onchainNodeId: string;
      evidenceHash: `0x${string}`;
      proposedBps: number;
      safeTx: { to: string; data: `0x${string}`; value: string };
    }[];
    expect(c?.safeTx.to).toBe(STAKING);
    expect(c?.safeTx.value).toBe('0');
    const d = decodeFunctionData({ abi: spindleStakingAbi, data: c?.safeTx.data as `0x${string}` });
    expect(d.functionName).toBe('slash');
    expect(d.args).toEqual([n.onchainId as bigint, 2000, c?.evidenceHash as `0x${string}`]);
    expect(c?.onchainNodeId).toBe(String(n.onchainId));
  });

  test('evidence hash is recomputable from the downloaded evidence.json', async () => {
    await caseWithEvidence();
    const [c] = (await (await req('GET', '/v1/admin/slash-cases')).json()) as {
      id: string;
      evidenceHash: string;
    }[];
    const dl = await req('GET', `/v1/admin/slash-cases/${c?.id}/evidence.json`);
    expect(dl.status).toBe(200);
    const text = await dl.text();
    const json = JSON.parse(text);
    expect(keccak256(stringToBytes(canonicalJson(json)))).toBe(c?.evidenceHash as `0x${string}`);
    expect(evidenceHash(json)).toBe(c?.evidenceHash as `0x${string}`);
    // key order is irrelevant
    expect(evidenceHash(reverseKeys(json))).toBe(c?.evidenceHash as `0x${string}`);
    expect(json.canaries).toHaveLength(3);
    expect(json.receipts).toBeArray();
    expect(json.reason).toBe('canary_fraud');
  });

  test('openCase is idempotent per node and reason while open', async () => {
    const n = await makeNode();
    const a = await openCase(n.id, 'probe_misrepresentation');
    const b = await openCase(n.id, 'probe_misrepresentation');
    expect(b.id).toBe(a.id);
    expect((await openCase(n.id, 'receipt_fraud')).proposedBps).toBe(5000);
  });

  test('submitted and dismiss are recorded in the audit log and are one-shot', async () => {
    const n = await makeNode();
    const a = await openCase(n.id, 'canary_fraud');
    const txHash = `0x${'ab'.repeat(32)}`;
    const ok = await req('POST', `/v1/admin/slash-cases/${a.id}/submitted`, { txHash });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { status: string }).status).toBe('submitted');
    expect((await req('POST', `/v1/admin/slash-cases/${a.id}/dismiss`, { reason: 'x' })).status).toBe(409);
    const b = await openCase(n.id, 'canary_fraud');
    expect(b.id).not.toBe(a.id);
    const d = await req('POST', `/v1/admin/slash-cases/${b.id}/dismiss`, { reason: 'false positive' });
    expect(d.status).toBe(200);
    const log = await t.db.select().from(auditLog);
    const actions = log.map((l) => l.action);
    expect(actions).toContain('slash_case.submitted');
    expect(actions).toContain('slash_case.dismiss');
    expect(log.find((l) => l.action === 'slash_case.submitted')?.actor).toBe(ADMIN);
    expect(log.find((l) => l.action === 'slash_case.dismiss')?.details).toMatchObject({
      reason: 'false positive',
    });
    expect((await req('POST', `/v1/admin/slash-cases/${a.id}/submitted`, { txHash: 'nope' })).status).toBe(
      400,
    );
  });

  test('suspend / unsuspend routes: status, close, audit', async () => {
    const n = await makeNode();
    const r = await req('POST', `/v1/admin/nodes/${n.id}/suspend`, { reason: 'manual' });
    expect(r.status).toBe(200);
    const [row] = await t.db.select().from(nodes).where(eq(nodes.id, n.id));
    expect(row?.status).toBe('suspended');
    expect(row?.suspendedReason).toBe('manual');
    expect(closed).toEqual([n.id]);
    expect((await req('POST', `/v1/admin/nodes/${n.id}/unsuspend`)).status).toBe(200);
    const [after] = await t.db.select().from(nodes).where(eq(nodes.id, n.id));
    expect(after?.status).toBe('offline');
    expect(after?.suspendedReason).toBeNull();
    expect((await t.db.select().from(auditLog)).map((l) => l.action)).toEqual([
      'node.suspend',
      'node.unsuspend',
    ]);
    expect((await req('POST', `/v1/admin/nodes/not-a-uuid/suspend`)).status).toBe(404);
  });

  test('non-admins are refused; no admin means no data', async () => {
    const other = { ...(await createTestSession(addr())).headers, origin: ORIGIN };
    expect((await req('GET', '/v1/admin/slash-cases', undefined, other)).status).toBe(403);
    expect((await req('POST', `/v1/admin/nodes/${crypto.randomUUID()}/suspend`, {}, other)).status).toBe(403);
    expect((await app.request('/v1/admin/slash-cases')).status).toBe(401);
  });

  test('safeTx is null without an on-chain id or staking address', () => {
    expect(safeTxFor({ evidenceHash: `0x${'11'.repeat(32)}`, proposedBps: 10 }, null)).toBeNull();
    slashingDeps.stakingAddress = () => undefined;
    expect(safeTxFor({ evidenceHash: `0x${'11'.repeat(32)}`, proposedBps: 10 }, 1n)).toBeNull();
    slashingDeps.stakingAddress = () => STAKING;
  });

  test('no code path in the backend sends a slash transaction', async () => {
    const files = new Bun.Glob('src/**/*.ts').scan({ cwd: `${import.meta.dir}/../../..` });
    const offenders: string[] = [];
    for await (const f of files) {
      if (f.endsWith('.test.ts') || f.startsWith('src/shared/abi')) continue;
      const src = await Bun.file(`${import.meta.dir}/../../../${f}`).text();
      if (
        /functionName:\s*'slash'/.test(src) &&
        /(writeContract|sendTransaction|sendRawTransaction)/.test(src)
      )
        offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
