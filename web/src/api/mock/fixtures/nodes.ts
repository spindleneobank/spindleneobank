import { env } from '../../../config';
import { ApiError } from '../../errors';
import type { MockFixtures } from '../mock';
import { readMockSession } from './auth';

const need = () => {
  if (!readMockSession()) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
};
const M = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const E18 = 10n ** 18n;
const spdl = (n: number) => (BigInt(n) * E18).toString();
const key = (n: number) => `0x${n.toString(16).padStart(40, 'a')}`;

type MockNode = {
  id: string;
  name: string;
  onchainId: string | null;
  nodeKey: string;
  status: 'offline' | 'online' | 'busy' | 'suspended' | 'deactivated';
  engine: 'ollama' | 'vllm';
  gpuModel: string | null;
  gpuCount: number | null;
  vramGb: number | null;
  gpuClass: 0 | 1 | 2 | 3 | 4;
  lane: 'sealed' | 'open';
  ccCapable: boolean;
  registered: boolean;
  stake: { active: string; pending: string; unlockAt: string | null; min: string };
  reputation: number;
  lastSeenAt: string | null;
  lastProbe: unknown;
  lastCanary: unknown;
  earnings24hMicros: string;
  models: unknown[];
  isHouse: boolean;
};

const MIN: Record<number, string> = {
  0: spdl(100),
  1: spdl(500),
  2: spdl(2000),
  3: spdl(10000),
  4: spdl(25000),
};
const probe = (ok: boolean, tps: number) => ({
  classOk: ok,
  tokPerSec: String(tps),
  createdAt: iso(Date.now() - 42 * M),
});
const canary = (pass: boolean) => ({ pass, kind: 'exact-match', createdAt: iso(Date.now() - 18 * M) });

const seed = (): MockNode[] => [
  {
    id: 'node_mock_a',
    name: 'garage-rig',
    onchainId: null,
    nodeKey: key(0xa1),
    status: 'online',
    engine: 'ollama',
    gpuModel: 'NVIDIA GeForce RTX 4090',
    gpuCount: 1,
    vramGb: 24,
    gpuClass: 2,
    lane: 'open',
    ccCapable: false,
    registered: false,
    stake: { active: '0', pending: '0', unlockAt: null, min: MIN[2] as string },
    reputation: 0,
    lastSeenAt: iso(Date.now() - 20_000),
    lastProbe: probe(true, 88.4),
    lastCanary: null,
    earnings24hMicros: '0',
    models: [],
    isHouse: false,
  },
  {
    id: 'node_mock_b',
    name: 'studio-4090',
    onchainId: '7',
    nodeKey: key(0xb2),
    status: 'busy',
    engine: 'vllm',
    gpuModel: 'NVIDIA GeForce RTX 4090',
    gpuCount: 2,
    vramGb: 48,
    gpuClass: 2,
    lane: 'open',
    ccCapable: false,
    registered: true,
    stake: { active: spdl(2500), pending: '0', unlockAt: null, min: MIN[2] as string },
    reputation: 912,
    lastSeenAt: iso(Date.now() - 5_000),
    lastProbe: probe(true, 121.7),
    lastCanary: canary(true),
    earnings24hMicros: '4280000',
    models: [],
    isHouse: false,
  },
  {
    id: 'node_mock_c',
    name: 'old-3090',
    onchainId: '9',
    nodeKey: key(0xc3),
    status: 'suspended',
    engine: 'ollama',
    gpuModel: 'NVIDIA GeForce RTX 3090',
    gpuCount: 1,
    vramGb: 24,
    gpuClass: 1,
    lane: 'open',
    ccCapable: false,
    registered: true,
    stake: {
      active: spdl(300),
      pending: spdl(100),
      unlockAt: iso(Date.now() + 5 * 24 * 60 * M),
      min: MIN[1] as string,
    },
    reputation: 310,
    lastSeenAt: iso(Date.now() - 3 * 24 * 60 * M),
    lastProbe: probe(false, 9.1),
    lastCanary: canary(false),
    earnings24hMicros: '0',
    models: [],
    isHouse: false,
  },
  {
    id: 'node_mock_h',
    name: 'house-cpu',
    onchainId: '1',
    nodeKey: key(0xd4),
    status: 'online',
    engine: 'ollama',
    gpuModel: null,
    gpuCount: null,
    vramGb: null,
    gpuClass: 0,
    lane: 'open',
    ccCapable: false,
    registered: true,
    stake: { active: '0', pending: '0', unlockAt: null, min: MIN[0] as string },
    reputation: 500,
    lastSeenAt: iso(Date.now() - 8_000),
    lastProbe: probe(true, 14.2),
    lastCanary: canary(true),
    earnings24hMicros: '350000',
    models: [],
    isHouse: true,
  },
];

let store = seed();
let paired = false;
const find = (id: string) => {
  const n = store.find((x) => x.id === id);
  if (!n) throw new ApiError('NOT_FOUND', 'Node not found.', 404);
  return n;
};

export const nodeFixtures: MockFixtures = {
  'GET /v1/app/nodes': ({ mode }) => {
    need();
    return mode === 'empty' ? [] : store;
  },
  'GET /v1/app/nodes/:id': ({ params }) => {
    need();
    const n = find(params.id as string);
    return {
      ...n,
      probes: [
        probe(n.status !== 'suspended', 88.4),
        { ...probe(true, 85.1), createdAt: iso(Date.now() - 160 * M) },
      ],
      canaries: n.lastCanary ? [n.lastCanary, { ...canary(true), createdAt: iso(Date.now() - 90 * M) }] : [],
      jobs: n.registered
        ? [
            {
              id: 'a1b2c3d4-0000-4000-8000-000000000001',
              model: 'qwen2.5:7b',
              kind: 'chat',
              lane: 'open',
              status: 'succeeded',
              units: '1840',
              isCanary: false,
              createdAt: iso(Date.now() - 6 * M),
            },
            {
              id: 'a1b2c3d4-0000-4000-8000-000000000002',
              model: 'qwen2.5:7b',
              kind: 'chat',
              lane: 'open',
              status: 'succeeded',
              units: '920',
              isCanary: false,
              createdAt: iso(Date.now() - 31 * M),
            },
          ]
        : [],
    };
  },
  'PATCH /v1/app/nodes/:id': ({ params, body }) => {
    need();
    const n = find(params.id as string);
    n.name = String((body as { name: string }).name).trim();
    return n;
  },
  'POST /v1/app/nodes/enroll': ({ body }) => {
    need();
    const b = body as { engine: string; os: string };
    const token = `spdl_enr_${Math.random().toString(36).slice(2, 12)}`;
    const flags = `--engine ${b.engine} --models qwen2.5:0.5b`;
    return {
      enrollmentId: `enr_${Date.now()}`,
      token,
      expiresAt: iso(Date.now() + 15 * M),
      commands: {
        installer: `curl -fsSL https://api.spindle.example/v1/node/install.sh | sh -s -- --token ${token} ${flags}`,
        powershell: `& ([scriptblock]::Create((irm https://api.spindle.example/v1/node/install.ps1))) -Token ${token} -Engine ${b.engine} -Models qwen2.5:0.5b`,
      },
    };
  },
  'POST /v1/app/nodes/:id/update-command': ({ params }) => {
    need();
    const n = find(params.id as string);
    const token = `spdl_upd_${Math.random().toString(36).slice(2, 12)}`;
    return {
      expiresAt: iso(Date.now() + 15 * M),
      commands: {
        installer: `curl -fsSL https://api.spindle.example/v1/node/install.sh | sh -s -- --update --update-token ${token} --engine ${n.engine}`,
        powershell: `& ([scriptblock]::Create((irm https://api.spindle.example/v1/node/install.ps1))) -Update -UpdateToken ${token} -Engine ${n.engine}`,
      },
    };
  },
  'POST /v1/app/nodes/pair': ({ body }) => {
    need();
    const code = (body as { code: string }).code;
    if (code !== 'ABCD-EFGH' || paired) {
      throw new ApiError('NOT_FOUND', 'Pairing code not found or expired. Codes last 10 minutes.', 404);
    }
    paired = true;
    const node: MockNode = {
      ...seed()[0],
      id: 'node_mock_p',
      name: 'paired-box',
      nodeKey: key(0xe5),
      gpuModel: 'NVIDIA RTX A4000',
      vramGb: 16,
      gpuClass: 1,
      stake: { active: '0', pending: '0', unlockAt: null, min: MIN[1] as string },
    } as MockNode;
    store = [node, ...store];
    return { node };
  },
  'GET /v1/app/nodes/:id/register-call': ({ params }) => {
    need();
    const n = find(params.id as string);
    if (n.status === 'offline') {
      throw new ApiError(
        'CHAIN_STATE',
        'The node must be online to sign a fresh registration. Start it and retry.',
        409,
      );
    }
    return {
      to: env.addresses.registry,
      functionName: 'registerNode',
      args: [
        n.nodeKey,
        n.gpuClass,
        n.ccCapable,
        `0x${'0'.repeat(64)}`,
        String(Math.floor(Date.now() / 1000) + 3600),
        `0x${'ab'.repeat(65)}`,
      ],
    };
  },
  'GET /v1/app/nodes/:id/stake-call': ({ params, query }) => {
    need();
    const n = find(params.id as string);
    if (!n.registered) throw new ApiError('CHAIN_STATE', 'Register this node on-chain before staking.', 409);
    if (!env.stakingEnabled) throw new ApiError('CHAIN_STATE', 'Staking is not available yet.', 409);
    const amount = query.get('amount') ?? '0';
    return {
      approve: { to: env.addresses.spdl, functionName: 'approve', args: [env.addresses.staking, amount] },
      stake: { to: env.addresses.staking, functionName: 'stake', args: [n.onchainId, amount] },
    };
  },
  'GET /v1/app/staking/params': () => {
    need();
    if (!env.stakingEnabled) return { enabled: false, token: null, minStakeByClass: {}, unstakeDelay: 0 };
    return {
      enabled: true,
      token: env.addresses.spdl,
      minStakeByClass: MIN,
      unstakeDelay: 7 * 24 * 3600,
    };
  },
};
