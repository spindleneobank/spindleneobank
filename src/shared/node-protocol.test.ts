import { describe, expect, test } from 'bun:test';
import {
  CLOSE_CODES,
  helloSigningMessage,
  NodeToServer,
  PROTOCOL_VERSION,
  ServerToNode,
} from './node-protocol';

const addr = '0x00000000000000000000000000000000000000aa';
const v = PROTOCOL_VERSION;
const binding = {
  domain: { name: 'SpindleRegistry', version: '1', chainId: 4663, verifyingContract: addr },
  types: { NodeBinding: [{ name: 'owner', type: 'address' }] },
  message: { owner: addr, nodeKey: addr, gpuClass: 2, ccCapable: false, deadline: 1_900_000_000 },
};
const hardware = {
  gpus: [{ name: 'RTX 4090', vramMb: 24564, driver: '550', uuid: 'GPU-1', cc: false }],
  cpu: 'x',
  ramMb: 1,
};
const helloBody = {
  v,
  type: 'hello',
  nodeKey: addr,
  publicKey: '0x04ab',
  agentVersion: '0.1.0',
  engine: 'ollama',
  engineVersion: '0.5',
  os: 'linux',
  arch: 'x64',
  hardware,
  models: [{ id: 'qwen2.5:0.5b', digest: 'sha256:1', sizeMb: 400 }],
  capabilities: ['chat'],
  capacity: 1,
};

const server: Record<string, unknown>[] = [
  { v, type: 'challenge', nonce: 'n', serverTime: 1 },
  { v, type: 'pairing', code: 'ABCD-EFGH', url: 'http://x', expiresAt: '2026-01-01T00:00:00Z' },
  {
    v,
    type: 'welcome',
    nodeId: 'id',
    owner: addr,
    name: 'n',
    gpuClass: 2,
    lane: 'open',
    ccCapable: false,
    registered: false,
    eligible: false,
    staked: false,
    binding,
    catalog: [{ id: 'm', engineModel: 'm', sizeMb: 1 }],
    minAgentVersion: '0.1.0',
  },
  { v, type: 'eligibility', registered: true, eligible: true, onchainId: '1' },
  { v, type: 'binding.request', binding },
  { v, type: 'upgrade_required', minAgentVersion: '1.0.0' },
  { v, type: 'ping' },
  { v, type: 'models.ensure', models: [{ id: 'm', engineModel: 'm', sizeMb: 1 }] },
  {
    v,
    type: 'job.start',
    jobId: 'j',
    kind: 'chat',
    model: 'm',
    engineModel: 'm',
    lane: 'open',
    request: { messages: [] },
    maxTokens: 10,
    deadlineMs: 1000,
  },
  { v, type: 'job.cancel', jobId: 'j' },
  { v, type: 'probe.start', probeId: 'p', kind: 'bench', params: { model: 'm', prompt: 'hi', maxTokens: 8 } },
];
const node: Record<string, unknown>[] = [
  { ...helloBody, sig: '0x1234' },
  { v, type: 'binding', sig: '0x12', deadline: 1_900_000_000 },
  {
    v,
    type: 'status',
    state: 'idle',
    gpus: [{ util: 1, memUsedMb: 2, tempC: 3, powerW: 4 }],
    loadedModels: [],
    queue: 0,
  },
  { v, type: 'pong' },
  { v, type: 'models.progress', id: 'm', pct: 50 },
  { v, type: 'models.ready', models: [{ id: 'm', digest: 'd' }] },
  { v, type: 'job.accepted', jobId: 'j' },
  { v, type: 'job.chunk', jobId: 'j', seq: 0, delta: { content: 'x' } },
  {
    v,
    type: 'job.done',
    jobId: 'j',
    output: { a: 1 },
    usage: { promptTokens: 1, completionTokens: 2 },
    receipt: 'AA==',
  },
  { v, type: 'job.error', jobId: 'j', code: 'BUSY', message: 'm' },
  { v, type: 'probe.result', probeId: 'p', bench: { tokPerSec: 1, ttftMs: 2, model: 'm', digest: 'd' } },
  {
    v,
    type: 'attest.refresh',
    attestation: { tdxQuote: 'q', eventLog: [], nvidiaEvidence: {}, hpkePublicKey: 'k', measurements: {} },
  },
];

describe('node protocol', () => {
  for (const m of server)
    test(`server ${m.type}`, () => expect(ServerToNode.safeParse(m).success).toBe(true));
  for (const m of node) test(`node ${m.type}`, () => expect(NodeToServer.safeParse(m).success).toBe(true));
  test('unknown type rejected', () => {
    expect(ServerToNode.safeParse({ v, type: 'nope' }).success).toBe(false);
    expect(NodeToServer.safeParse({ v, type: 'nope' }).success).toBe(false);
  });
  test('wrong version rejected', () =>
    expect(NodeToServer.safeParse({ v: 2, type: 'pong' }).success).toBe(false));
  test('helloSigningMessage independent of key order', () => {
    const a = helloSigningMessage('nonce', helloBody);
    const reordered = Object.fromEntries(Object.entries(helloBody).reverse());
    expect(helloSigningMessage('nonce', reordered)).toBe(a);
    expect(a).toMatch(/^spindle-node-auth:nonce:[0-9a-f]{64}$/);
    expect(helloSigningMessage('other', helloBody)).not.toBe(a);
  });
  test('close codes', () => expect(CLOSE_CODES.REPLACED).toBe(4008));
});
