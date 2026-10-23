import { afterEach, describe, expect, test } from 'bun:test';
import { nodeBindingTypedData } from '@spindle/shared/binding';
import { canonicalJson, sha256Hex } from '@spindle/shared/canonical-json';
import { CLOSE_CODES, type HelloBody, HelloMsg, helloSigningMessage } from '@spindle/shared/node-protocol';
import { recoverTypedDataAddress, verifyMessage } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { NodeConnection } from '../src/connection';
import { createLogger } from '../src/log';

const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);
const key = {
  privateKey: pk,
  address: account.address,
  publicKey: account.publicKey,
  createdAt: '',
  account,
};
const OWNER = '0x00000000000000000000000000000000000000a1' as const;
const REG = '0x00000000000000000000000000000000000000b2' as const;

const hello: HelloBody = {
  v: 1,
  type: 'hello',
  nodeKey: account.address,
  publicKey: account.publicKey,
  agentVersion: '0.1.0',
  engine: 'ollama',
  engineVersion: '0.5',
  os: 'linux',
  arch: 'x64',
  hardware: { gpus: [], cpu: 'cpu', ramMb: 1000 },
  models: [],
  capabilities: ['chat', 'embeddings'],
  capacity: 1,
};

const binding = (nodeKey = account.address) => ({
  domain: { name: 'SpindleRegistry', version: '1', chainId: 31337, verifyingContract: REG },
  types: {},
  message: { owner: OWNER, nodeKey, gpuClass: 2, ccCapable: false, deadline: 1_900_000_000 },
});
const welcome = (over: Record<string, unknown> = {}) => ({
  v: 1,
  type: 'welcome',
  nodeId: 'n1',
  owner: OWNER,
  name: 'test',
  gpuClass: 2,
  lane: 'open',
  ccCapable: false,
  registered: true,
  eligible: true,
  staked: false,
  binding: binding(),
  catalog: [],
  minAgentVersion: '0.1.0',
  ...over,
});

type SrvWs = import('bun').ServerWebSocket<unknown>;
let server: ReturnType<typeof Bun.serve<unknown>> | undefined;
let conn: NodeConnection | undefined;
afterEach(() => {
  conn?.stop();
  server?.stop(true);
});

function harness(onOpen: (ws: SrvWs) => void, onMsg: (ws: SrvWs, m: Record<string, unknown>) => void) {
  const received: Record<string, unknown>[] = [];
  let connections = 0;
  server = Bun.serve({
    port: 0,
    fetch(req, s) {
      return s.upgrade(req, { data: {} }) ? undefined : new Response('no', { status: 400 });
    },
    websocket: {
      open(ws) {
        connections++;
        onOpen(ws);
      },
      message(ws, raw) {
        const m = JSON.parse(String(raw));
        received.push(m);
        onMsg(ws, m);
      },
    },
  });
  return { received, url: `ws://127.0.0.1:${server.port}`, connections: () => connections };
}

const waitFor = async (f: () => boolean, ms = 3000) => {
  const t = Date.now();
  while (!f()) {
    if (Date.now() - t > ms) throw new Error('timeout waiting');
    await Bun.sleep(10);
  }
};

const mk = (
  url: string,
  extra: Partial<ConstructorParameters<typeof NodeConnection>[0]> = {},
  lines: string[] = [],
) =>
  new NodeConnection({
    url,
    key,
    log: createLogger('debug', (l) => lines.push(l)),
    buildHello: async () => hello,
    getStatus: async () => ({ state: 'idle', gpus: [], loadedModels: [], queue: 0 }),
    onFatal: () => {},
    minBackoffMs: 20,
    maxBackoffMs: 50,
    ...extra,
  });

describe('connection', () => {
  test('challenge -> hello sig verifies -> welcome -> binding recovers to nodeKey -> status, ping', async () => {
    const h = harness(
      (ws) => ws.send(JSON.stringify({ v: 1, type: 'challenge', nonce: 'n0nce', serverTime: Date.now() })),
      (ws, m) => {
        if (m.type === 'hello') ws.send(JSON.stringify(welcome()));
        if (m.type === 'binding') ws.send(JSON.stringify({ v: 1, type: 'ping' }));
      },
    );
    conn = mk(h.url);
    conn.start();
    await waitFor(
      () => h.received.some((m) => m.type === 'pong') && h.received.some((m) => m.type === 'status'),
    );

    const helloMsg = h.received.find((m) => m.type === 'hello') as Record<string, unknown>;
    expect(HelloMsg.safeParse(helloMsg).success).toBe(true);
    const { sig, ...without } = helloMsg;
    const message = `spindle-node-auth:n0nce:${sha256Hex(canonicalJson(without))}`;
    expect(message).toBe(helloSigningMessage('n0nce', without));
    expect(await verifyMessage({ address: account.address, message, signature: sig as `0x${string}` })).toBe(
      true,
    );

    const b = h.received.find((m) => m.type === 'binding') as { sig: `0x${string}`; deadline: number };
    expect(b.deadline).toBe(1_900_000_000);
    const td = nodeBindingTypedData(
      { chainId: 31337, verifyingContract: REG },
      { owner: OWNER, nodeKey: account.address, gpuClass: 2, ccCapable: false, deadline: 1_900_000_000 },
    );
    expect(await recoverTypedDataAddress({ ...td, signature: b.sig })).toBe(account.address);
    expect(conn.state).toBe('ready');
    expect(JSON.stringify(h.received)).not.toContain(pk);
  });

  test('binding.request yields a fresh binding; not-eligible is logged and tolerated', async () => {
    const lines: string[] = [];
    const h = harness(
      (ws) => ws.send(JSON.stringify({ v: 1, type: 'challenge', nonce: 'x', serverTime: 1 })),
      (ws, m) => {
        if (m.type === 'hello') ws.send(JSON.stringify(welcome({ eligible: false, registered: false })));
        if (m.type === 'status')
          ws.send(
            JSON.stringify({
              v: 1,
              type: 'binding.request',
              binding: { ...binding(), message: { ...binding().message, deadline: 1_950_000_000 } },
            }),
          );
      },
    );
    conn = mk(h.url, {}, lines);
    conn.start();
    await waitFor(() => h.received.filter((m) => m.type === 'binding').length >= 2);
    expect((h.received.filter((m) => m.type === 'binding')[1] as { deadline: number }).deadline).toBe(
      1_950_000_000,
    );
    expect(lines.some((l) => l.includes('Registered: no'))).toBe(true);
    expect(conn.isEligible).toBe(false);
    h.received.length = 0;
    conn.stop();
  });

  test('pairing banner is printed and repeated', async () => {
    const lines: string[] = [];
    const h = harness(
      (ws) => ws.send(JSON.stringify({ v: 1, type: 'challenge', nonce: 'x', serverTime: 1 })),
      (ws, m) => {
        if (m.type === 'hello')
          ws.send(
            JSON.stringify({
              v: 1,
              type: 'pairing',
              code: 'ABCD-EFGH',
              url: 'http://app/dashboard/compute?pair=ABCD-EFGH',
              expiresAt: '2030-01-01T00:00:00Z',
            }),
          );
      },
    );
    conn = mk(h.url, { pairingBannerMs: 30 }, lines);
    conn.start();
    await waitFor(() => lines.filter((l) => l.includes('ABCD-EFGH')).length >= 3);
    expect(lines.find((l) => l.includes('ABCD-EFGH'))).toContain('pair=ABCD-EFGH');
    expect(conn.state).toBe('pairing');
  });

  test('invalid inbound messages are ignored', async () => {
    const h = harness(
      (ws) => {
        ws.send('not json');
        ws.send(JSON.stringify({ v: 1, type: 'job.start', jobId: 1 }));
        ws.send(JSON.stringify({ v: 1, type: 'challenge', nonce: 'x', serverTime: 1 }));
      },
      () => {},
    );
    conn = mk(h.url);
    conn.start();
    await waitFor(() => h.received.some((m) => m.type === 'hello'));
  });

  test('4008 reconnects after a delay with a single socket; 4001/4004 are fatal', async () => {
    let first = true;
    const h = harness(
      (ws) => {
        if (first) {
          first = false;
          ws.close(CLOSE_CODES.REPLACED, 'replaced');
        } else ws.send(JSON.stringify({ v: 1, type: 'challenge', nonce: 'x', serverTime: 1 }));
      },
      () => {},
    );
    conn = mk(h.url, { replacedDelayMs: 60 });
    conn.start();
    await waitFor(() => h.received.some((m) => m.type === 'hello'));
    expect(h.connections()).toBe(2);
    conn.stop();
    server?.stop(true);

    for (const [code, exit] of [
      [CLOSE_CODES.UPGRADE_REQUIRED, 3],
      [CLOSE_CODES.SUSPENDED, 4],
    ] as const) {
      const codes: number[] = [];
      const h2 = harness(
        (ws) => ws.close(code, 'x'),
        () => {},
      );
      conn = mk(h2.url, { onFatal: (c) => codes.push(c) });
      conn.start();
      await waitFor(() => codes.length > 0);
      await Bun.sleep(120);
      expect(codes).toEqual([exit]);
      expect(h2.connections()).toBe(1);
      conn.stop();
      server?.stop(true);
    }
  });

  test('auth failure (4003) retries with backoff', async () => {
    const h = harness(
      (ws) => ws.close(CLOSE_CODES.AUTH_FAILED, 'bad'),
      () => {},
    );
    conn = mk(h.url);
    conn.start();
    await waitFor(() => h.connections() >= 3);
  });
});
