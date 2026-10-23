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
  const opened = await openRequest(node.privateKey, sealed.envelope, NODE, 'm');
  const sealer = await ResponseSealer.create(opened.responseSecret, 'job-1');
  return { node, req, sealed, opened, sealer };
}

describe('sealed HPKE (real crypto, no hardware needed)', () => {
  test('request round-trip and the envelope hides the plaintext', async () => {
    const { req, sealed, opened } = await setup();
    expect(JSON.stringify(sealed.envelope)).not.toContain('secret prompt');
    expect(Object.keys(sealed.envelope).sort()).toEqual(['ciphertext', 'enc', 'nodeKey']);
    expect(opened.request).toEqual(req);
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

  test('response frames round-trip in order and end with a verified end frame', async () => {
    const { sealed, sealer } = await setup();
    const f = [
      await sealer.seal({ delta: 'he' }),
      await sealer.seal({ delta: 'llo' }),
      await sealer.seal({ output: 1 }),
    ];
    const end = await sealer.end();
    const r = sealed.openResponse;
    expect(await r.open(f[0] as string, 'job-1')).toEqual({ delta: 'he' });
    expect(await r.open(f[1] as string, 'job-1')).toEqual({ delta: 'llo' });
    expect(await r.open(f[2] as string, 'job-1')).toEqual({ output: 1 });
    await r.close(end, 'job-1');
  });

  test('a gateway-forged frame is rejected (it cannot derive the response key)', async () => {
    const { sealed } = await setup();
    // the gateway knows enc + ciphertext only; it seals "its own" frames with a key it can make up
    const forger = await ResponseSealer.create(new Uint8Array(28).fill(7), 'job-1');
    const forged = await forger.seal({ delta: 'attacker text' });
    await expect(sealed.openResponse.open(forged, 'job-1')).rejects.toThrow();
  });

  test('skip, reorder, replay, wrong job id and truncation are detected', async () => {
    for (const run of ['skip', 'replay', 'job', 'truncate', 'padded'] as const) {
      const { sealed, sealer } = await setup();
      const g = [await sealer.seal({ a: 1 }), await sealer.seal({ a: 2 })] as string[];
      const end = await sealer.end();
      const o = sealed.openResponse;
      if (run === 'skip') {
        await expect(o.open(g[1] as string, 'job-1')).rejects.toThrow();
      } else if (run === 'replay') {
        await o.open(g[0] as string, 'job-1');
        await expect(o.open(g[0] as string, 'job-1')).rejects.toThrow();
      } else if (run === 'job') {
        await expect(o.open(g[0] as string, 'job-2')).rejects.toThrow();
      } else if (run === 'truncate') {
        await o.open(g[0] as string, 'job-1');
        await expect(o.close(null, 'job-1')).rejects.toThrow(/truncated/);
        await expect(o.close(end, 'job-1')).rejects.toThrow(/truncated/); // end frame count says 2, only 1 opened
      } else {
        await o.open(g[0] as string, 'job-1');
        await o.open(g[1] as string, 'job-1');
        await o.close(end, 'job-1');
        await expect(o.open(g[0] as string, 'job-1')).rejects.toThrow();
      }
    }
  });
});
