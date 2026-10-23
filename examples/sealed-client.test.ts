import { describe, expect, test } from 'bun:test';
import { generateKeyPair, openRequest, ResponseSealer } from '../src/shared/sealed';
import { sealedChat } from './sealed-client';

type Mode = 'ok' | 'no-final' | 'drop-chunk' | 'no-end' | 'forged';

/** Fake gateway + CVM (SYNTHETIC): real HPKE, scripted misbehaviour. */
async function run(mode: Mode) {
  const node = await generateKeyPair();
  const nodeKey = `0x${'ab'.repeat(20)}`;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { model: string; sealed: { enc: string; ciphertext: string } };
      expect(JSON.stringify(body)).not.toContain('hello there');
      expect(req.headers.get('X-Spindle-Lane')).toBe('sealed');
      const opened = await openRequest(node.privateKey, body.sealed, nodeKey, body.model);
      const s = await ResponseSealer.create(
        mode === 'forged' ? new Uint8Array(28).fill(9) : opened.responseSecret,
        'j1',
      );
      const frames = [
        await s.seal({ delta: { content: 'Hi ' } }),
        await s.seal({ delta: { content: 'you' } }),
        await s.seal({ output: {} }),
      ];
      const end = await s.end();
      const ev = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
      const parts = [ev({ sealed: frames[0] }), ev({ sealed: frames[1] })];
      if (mode === 'drop-chunk') parts.shift();
      if (mode !== 'no-final')
        parts.push(
          ev({
            sealed: frames[2],
            end: mode === 'no-end' ? null : end,
            final: true,
            spindle: { chargeMicros: '42' },
          }),
        );
      return new Response([...parts, 'data: [DONE]\n\n'].join(''), {
        headers: { 'X-Spindle-Job-Id': 'j1', 'content-type': 'text/event-stream' },
      });
    },
  });
  try {
    return await sealedChat({
      node: {
        nodeId: 'n',
        nodeKey,
        hpkePublicKey: node.publicKey,
        attestationRef: 'a',
        attestationSummary: {} as never,
        expiresAt: '',
      },
      prompt: 'hello there',
      model: 'qwen2.5:7b',
      apiKey: 'k',
      api: `http://127.0.0.1:${server.port}`,
    });
  } finally {
    server.stop(true);
  }
}

describe('sealed-client against a fake gateway + fake CVM (synthetic)', () => {
  test('seals, streams, opens and verifies the end frame', async () => {
    expect(await run('ok')).toEqual({ text: 'Hi you', jobId: 'j1', chargeMicros: '42' });
  });
  test('throws on truncation: missing final frame, missing end frame, dropped chunk', async () => {
    await expect(run('no-final')).rejects.toThrow(/truncated/);
    await expect(run('no-end')).rejects.toThrow(/truncated/);
    await expect(run('drop-chunk')).rejects.toThrow();
  });
  test('throws on frames forged by the gateway', async () => {
    await expect(run('forged')).rejects.toThrow();
  });
});
