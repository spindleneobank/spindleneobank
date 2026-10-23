import type { HelloBody } from '@spindle/shared/node-protocol';
import { Hono } from 'hono';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { NodeConnection } from '../../../node/src/connection';
import { createLogger, type Logger } from '../../../node/src/log';
import { type Env, jsonError } from '../../lib/http';
import { websocket } from '../../lib/ws';
import authRoutes from '../auth/routes';
import nodesRoutes from './routes';

/** In-process api (auth + nodes routes) on an ephemeral port, for hub / route tests. */
export function startTestServer() {
  const app = new Hono<Env>();
  app.onError(jsonError);
  authRoutes(app);
  nodesRoutes(app);
  const server = Bun.serve({ port: 0, fetch: app.fetch, websocket });
  return { app, server, wsUrl: `ws://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

export interface FakeNode {
  conn: NodeConnection;
  address: `0x${string}`;
  privateKey: `0x${string}`;
  account: ReturnType<typeof privateKeyToAccount>;
  logs: string[];
  welcomes: import('@spindle/shared/node-protocol').WelcomeMsg[];
  closes: number[];
  hello: HelloBody;
  /** job.start messages received */
  jobs: import('@spindle/shared/node-protocol').JobStartMsg[];
  ensures: import('@spindle/shared/node-protocol').ModelsEnsureMsg[];
  waitFor(pred: () => boolean, ms?: number): Promise<void>;
  pairingCode(): string | undefined;
}

export interface FakeNodeOpts {
  wsUrl: string;
  token?: string;
  gpu?: { name: string; vramMb: number; cc?: boolean };
  models?: string[];
  agentVersion?: string;
  capacity?: number;
  key?: `0x${string}`;
  /** how the node reacts to job.start */
  onJob?: (node: FakeNode, job: import('@spindle/shared/node-protocol').JobStartMsg) => void;
  noReconnect?: boolean;
}

export function fakeNode(o: FakeNodeOpts): FakeNode {
  const pk = o.key ?? generatePrivateKey();
  const account = privateKeyToAccount(pk);
  const logs: string[] = [];
  const log: Logger = createLogger('debug', (l) => logs.push(l));
  const hello: HelloBody = {
    v: 1,
    type: 'hello',
    nodeKey: account.address,
    publicKey: account.publicKey,
    agentVersion: o.agentVersion ?? '0.1.0',
    engine: 'ollama',
    engineVersion: '0.5',
    os: 'linux',
    arch: 'x64',
    hardware: {
      gpus: o.gpu
        ? [{ name: o.gpu.name, vramMb: o.gpu.vramMb, driver: '550', uuid: 'GPU-1', cc: o.gpu.cc ?? false }]
        : [],
      cpu: 'cpu',
      ramMb: 8000,
    },
    models: (o.models ?? []).map((id) => ({ id, digest: `sha256:${id}`, sizeMb: 100 })),
    capabilities: ['chat', 'embeddings'],
    capacity: o.capacity ?? 1,
    ...(o.token ? { enrollToken: o.token } : {}),
  };
  const node: FakeNode = {
    address: account.address,
    privateKey: pk,
    account,
    logs,
    welcomes: [],
    closes: [],
    jobs: [],
    ensures: [],
    hello,
    conn: undefined as unknown as NodeConnection,
    async waitFor(pred, ms = 5000) {
      const end = Date.now() + ms;
      while (!pred()) {
        if (Date.now() > end) throw new Error(`timeout waiting; logs:\n${logs.slice(-15).join('\n')}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    pairingCode: () => logs.join('\n').match(/Code: ([A-Z0-9]{4}-[A-Z0-9]{4})/)?.[1],
  };
  node.conn = new NodeConnection({
    url: `${o.wsUrl}/v1/node/ws`,
    key: { privateKey: pk, address: account.address, publicKey: account.publicKey, createdAt: '', account },
    log,
    buildHello: async () => hello,
    getStatus: async () => ({ state: 'idle', gpus: [], loadedModels: [], queue: 0 }),
    onFatal: () => {},
    minBackoffMs: o.noReconnect ? 3_600_000 : 50,
    maxBackoffMs: o.noReconnect ? 3_600_000 : 200,
    replacedDelayMs: 3_600_000,
    handlers: {
      onWelcome: (w) => node.welcomes.push(w),
      onJobStart: (j) => {
        node.jobs.push(j);
        o.onJob?.(node, j);
      },
      onModelsEnsure: (m) => node.ensures.push(m),
    },
    createSocket: (url) => {
      const ws = new WebSocket(url);
      ws.addEventListener('close', (ev) => node.closes.push(ev.code));
      return ws;
    },
  });
  return node;
}
