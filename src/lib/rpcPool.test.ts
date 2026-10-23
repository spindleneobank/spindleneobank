import { describe, expect, test } from 'bun:test';
import { createRpcPool, RpcError } from './rpcPool';

type Call = { url: string; method: string };

function mockFetch(handler: (url: string, method: string, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(url), method: body.method });
    return handler(String(url), body.method, calls.length);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));

describe('rpcPool', () => {
  test('rotates keys and cools down on 429', async () => {
    const { impl, calls } = mockFetch((url) =>
      url.includes('key1') ? new Response('slow down', { status: 429 }) : ok('0x10'),
    );
    const pool = createRpcPool({
      alchemyUrls: ['https://a.test/key1', 'https://a.test/key2'],
      publicUrl: 'https://public.test',
      fetchImpl: impl,
    });
    expect(await pool.rpc('eth_blockNumber', [])).toBe('0x10');
    expect(calls.map((c) => c.url)).toEqual(['https://a.test/key1', 'https://a.test/key2']);
    expect(pool.poolStatus()[0]?.coolingForMs).toBeGreaterThan(0);
    expect(pool.poolStatus()[0]?.failures).toBe(1);
    // key1 is cooling: next requests go to key2 only
    await pool.rpc('eth_blockNumber', []);
    await pool.rpc('eth_blockNumber', []);
    expect(calls.slice(2).map((c) => c.url)).toEqual(['https://a.test/key2', 'https://a.test/key2']);
  });

  test('retries on -32005 rate limit and 5xx, falls back to public', async () => {
    const { impl, calls } = mockFetch((url) => {
      if (url.includes('key1'))
        return new Response(JSON.stringify({ error: { code: -32005, message: 'limit' } }));
      if (url.includes('key2')) return new Response('bad', { status: 502 });
      return ok('0x1');
    });
    const pool = createRpcPool({
      alchemyUrls: ['https://a.test/key1', 'https://a.test/key2'],
      publicUrl: 'https://public.test',
      fetchImpl: impl,
    });
    expect(await pool.rpc('eth_chainId', [])).toBe('0x1');
    expect(calls.at(-1)?.url).toBe('https://public.test');
  });

  test('non-retryable rpc errors surface as RpcError', async () => {
    const { impl } = mockFetch(
      () => new Response(JSON.stringify({ error: { code: 3, message: 'execution reverted' } })),
    );
    const pool = createRpcPool({ alchemyUrls: ['https://a.test/k'], publicUrl: '', fetchImpl: impl });
    await expect(pool.rpc('eth_call', [])).rejects.toBeInstanceOf(RpcError);
  });

  test('free-tier getLogs block range error is retryable on alchemy', async () => {
    const { impl, calls } = mockFetch((url) =>
      url.includes('alchemy')
        ? new Response(
            JSON.stringify({
              error: {
                code: -32600,
                message:
                  'Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range',
              },
            }),
          )
        : ok([]),
    );
    const pool = createRpcPool({
      alchemyUrls: ['https://alchemy.test/k'],
      publicUrl: 'https://public.test',
      fetchImpl: impl,
    });
    // getLogs goes public first, so force the alchemy path via alchemyOnly+public cooling is not needed:
    // call a non-getLogs-routed variant by cooling public first.
    await pool.rpc('eth_getLogs', [{}]);
    expect(calls[0]?.url).toBe('https://public.test');
    const { impl: impl2, calls: calls2 } = mockFetch((url) =>
      url.includes('alchemy')
        ? new Response(
            JSON.stringify({
              error: {
                code: -32600,
                message:
                  'Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range',
              },
            }),
          )
        : new Response('x', { status: 503 }),
    );
    const pool2 = createRpcPool({
      alchemyUrls: ['https://alchemy.test/k'],
      publicUrl: 'https://public.test',
      fetchImpl: impl2,
    });
    await expect(pool2.rpc('eth_getLogs', [{}])).rejects.toThrow();
    expect(calls2.map((c) => c.url)).toEqual(['https://public.test', 'https://alchemy.test/k']);
    expect(pool2.poolStatus().every((s) => s.failures === 1)).toBe(true);
  });

  test('getLogs prefers public endpoint', async () => {
    const { impl, calls } = mockFetch(() => ok([]));
    const pool = createRpcPool({
      alchemyUrls: ['https://a.test/key1'],
      publicUrl: 'https://public.test',
      fetchImpl: impl,
    });
    await pool.rpc('eth_getLogs', [{}]);
    await pool.rpc('eth_blockNumber', []);
    expect(calls.map((c) => c.url)).toEqual(['https://public.test', 'https://a.test/key1']);
  });

  test('RPC_URLS-only mode uses anvil only', async () => {
    const { impl, calls } = mockFetch(() => ok('0x1'));
    const pool = createRpcPool({
      rpcUrls: ['http://anvil:8545'],
      alchemyUrls: ['https://a.test/key1'],
      publicUrl: 'https://public.test',
      fetchImpl: impl,
    });
    await pool.rpc('eth_getLogs', [{}]);
    await pool.rpc('eth_blockNumber', []);
    expect(new Set(calls.map((c) => c.url))).toEqual(new Set(['http://anvil:8545']));
    expect(pool.poolStatus().map((s) => s.id)).toEqual(['rpc#1']);
  });

  test('exhausted pool throws UPSTREAM_UNAVAILABLE', async () => {
    const { impl } = mockFetch(() => new Response('x', { status: 500 }));
    const pool = createRpcPool({ rpcUrls: ['http://a', 'http://b'], fetchImpl: impl });
    await expect(pool.rpc('eth_blockNumber', [])).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });
});
