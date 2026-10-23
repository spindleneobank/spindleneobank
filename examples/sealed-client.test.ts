import { describe, expect, test } from 'bun:test';
import { generateKeyPair, openRequest, ResponseSealer } from '../src/shared/sealed';
import { sealedChat } from './sealed-client';

describe('sealed-client against a fake gateway + fake CVM (synthetic)', () => {
  test('seals, streams and opens', async () => {
    const node = await generateKeyPair();
    const nodeKey = `0x${'ab'.repeat(20)}`;
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as { model: string; sealed: { enc: string; ciphertext: string } };
        expect(JSON.stringify(body)).not.toContain('hello there');
        expect(req.headers.get('X-Spindle-Lane')).toBe('sealed');
        const opened = await openRequest(node.privateKey, body.sealed, nodeKey, body.model);
        const s = await ResponseSealer.create(opened.ephemeralPub, 'j1');
        const frames = [
          await s.seal({ delta: { content: 'Hi ' } }),
          await s.seal({ delta: { content: 'you' } }),
          await s.seal({ output: {} }),
        ];
        const sse = [
          ...frames.slice(0, 2).map((f) => `data: ${JSON.stringify({ sealed: f })}\n\n`),
          `data: ${JSON.stringify({ sealed: frames[2], final: true, spindle: { chargeMicros: '42' } })}\n\n`,
          'data: [DONE]\n\n',
        ].join('');
        return new Response(sse, {
          headers: { 'X-Spindle-Job-Id': 'j1', 'content-type': 'text/event-stream' },
        });
      },
    });
    try {
      const r = await sealedChat({
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
      expect(r).toEqual({ text: 'Hi you', jobId: 'j1', chargeMicros: '42' });
    } finally {
      server.stop(true);
    }
  });
});
