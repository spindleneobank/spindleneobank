import { describe, expect, test } from 'bun:test';
import { generateKeyPair, openRequest, ResponseSealer, sealRequest } from './sealed';

const NODE = '0x1111111111111111111111111111111111111111';

async function setup() {
  const node = await generateKeyPair();
  const req = { model: 'm', messages: [{ role: 'user', content: 'secret prompt' }] };
  const sealed = await sealRequest({
    nodePublicKey: node.publicKey,
    nodeKey: NODE,
    model: 'm',
    request: req,
  });
  return { node, req, sealed };
}

describe('sealed HPKE (real crypto, no hardware needed)', () => {
  test('request round-trip and the envelope hides the plaintext', async () => {
    const { node, req, sealed } = await setup();
    expect(JSON.stringify(sealed.envelope)).not.toContain('secret prompt');
    const opened = await openRequest(node.privateKey, sealed.envelope, NODE, 'm');
    expect(opened.request).toEqual(req);
    expect(opened.ephemeralPub).toBe(sealed.envelope.ephemeralPub);
  });

  test('wrong node key, wrong model or wrong recipient fail', async () => {
    const { node, sealed } = await setup();
    await expect(
      openRequest(node.privateKey, sealed.envelope, '0x2222222222222222222222222222222222222222', 'm'),
    ).rejects.toThrow();
    await expect(openRequest(node.privateKey, sealed.envelope, NODE, 'other-model')).rejects.toThrow();
    const other = await generateKeyPair();
    await expect(openRequest(other.privateKey, sealed.envelope, NODE, 'm')).rejects.toThrow();
  });

  test('tampered ciphertext fails', async () => {
    const { node, sealed } = await setup();
    const b = Buffer.from(sealed.envelope.ciphertext, 'base64');
    b[0] = (b[0] as number) ^ 1;
    await expect(
      openRequest(node.privateKey, { ...sealed.envelope, ciphertext: b.toString('base64') }, NODE, 'm'),
    ).rejects.toThrow();
  });

  test('response frames round-trip in order; drop/reorder/replay and a wrong job id are detected', async () => {
    const { node, sealed } = await setup();
    const { ephemeralPub } = await openRequest(node.privateKey, sealed.envelope, NODE, 'm');
    const mk = async () => ResponseSealer.create(ephemeralPub, 'job-1');
    const s = await mk();
    const f = [
      await s.seal({ delta: { content: 'he' } }),
      await s.seal({ delta: { content: 'llo' } }),
      await s.seal({ output: { done: true } }),
    ];
    expect(f[0]).toContain(':');
    expect(f[1]).not.toContain(':');
    const r = sealed.openResponse;
    expect(await r.open(f[0] as string, 'job-1')).toEqual({ delta: { content: 'he' } });
    expect(await r.open(f[1] as string, 'job-1')).toEqual({ delta: { content: 'llo' } });
    expect(await r.open(f[2] as string, 'job-1')).toEqual({ output: { done: true } });
    // skipping a frame, reordering or the wrong job id breaks the AEAD chain
    for (const run of ['skip', 'reorder', 'job'] as const) {
      const fresh = await setup();
      const e = (await openRequest(fresh.node.privateKey, fresh.sealed.envelope, NODE, 'm')).ephemeralPub;
      const ss = await ResponseSealer.create(e, 'job-1');
      const g = [await ss.seal({ a: 1 }), await ss.seal({ a: 2 }), await ss.seal({ a: 3 })] as string[];
      const o = fresh.sealed.openResponse;
      if (run === 'skip') {
        await o.open(g[0] as string, 'job-1');
        await expect(o.open(g[2] as string, 'job-1')).rejects.toThrow();
      } else if (run === 'reorder') {
        await o.open(g[0] as string, 'job-1');
        await expect(o.open(g[2] as string, 'job-1')).rejects.toThrow();
      } else {
        await expect(o.open(g[0] as string, 'job-2')).rejects.toThrow();
      }
    }
  });
});
