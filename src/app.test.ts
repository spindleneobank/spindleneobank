import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { setupTestDb, type TestDb } from '../test/db-setup';
import { buildApp, serveOptions } from './app';
import { MAX_PREAUTH_FRAME_BYTES, MAX_WS_PAYLOAD_BYTES } from './lib/limits';
import { closeRedis } from './lib/redis';
import { dbRef } from './modules/auth/constants';
import authRoutes from './modules/auth/routes';
import nodesRoutes from './modules/nodes/routes';

const mounts = [authRoutes, nodesRoutes];
let t: TestDb;
let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
  server = Bun.serve(serveOptions(buildApp(mounts), 0) as never);
  base = `127.0.0.1:${server.port}`;
});
afterAll(async () => {
  server.stop(true);
  await t.close();
  await closeRedis();
});

const post = (size: number, headers: Record<string, string> = {}) =>
  fetch(`http://${base}/v1/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: 'a'.repeat(size),
  });

describe('request bodies (L-1)', () => {
  test('a 2 MB POST gets 413 as JSON', async () => {
    const r = await post(2 * 1000 * 1000);
    expect(r.status).toBe(413);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('PAYLOAD_TOO_LARGE');
  });
  test('a body over the limit is refused without a content-length as well', async () => {
    const chunk = new Uint8Array(256 * 1024);
    let n = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (n++ < 8) c.enqueue(chunk);
        else c.close();
      },
    });
    const r = await fetch(`http://${base}/v1/auth/verify`, { method: 'POST', body, duplex: 'half' } as never);
    expect(r.status).toBe(413);
  });
  test('a body under the limit reaches the route', async () => {
    const r = await post(1000);
    expect(r.status).not.toBe(413);
  });
  test('Bun itself is configured to stop oversized requests', () => {
    expect(serveOptions(buildApp(mounts), 0).maxRequestBodySize).toBeGreaterThan(0);
    expect(serveOptions(buildApp(mounts), 0).websocket.maxPayloadLength).toBe(MAX_WS_PAYLOAD_BYTES);
  });
});

describe('node websocket frames (M-4, L-1)', () => {
  /** Opens a socket, reads the challenge, sends one frame and resolves with the close code (0 = still open). */
  function send(frame: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${base}/v1/node/ws`);
      const timer = setTimeout(() => {
        ws.close();
        resolve(0);
      }, 500);
      ws.onmessage = () => ws.send(frame);
      ws.onclose = (e) => {
        clearTimeout(timer);
        resolve(e.code);
      };
      ws.onerror = () => reject(new Error('ws error'));
    });
  }
  test('a frame over 1 MiB closes the socket', async () => {
    expect(await send('x'.repeat(MAX_WS_PAYLOAD_BYTES + 1))).toBe(1009);
  });
  test('a pre-auth frame over 64 KB is dropped before it is parsed', async () => {
    const code = await send(`{"v":1,"type":"pong","pad":"${'x'.repeat(MAX_PREAUTH_FRAME_BYTES)}"}`);
    expect(code).toBeGreaterThanOrEqual(4000);
  });
});
