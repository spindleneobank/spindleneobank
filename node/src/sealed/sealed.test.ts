import { describe, expect, test } from 'bun:test';
import { canonicalJson, sha256Hex } from '@spindle/shared/canonical-json';
import { expectedReportData, replayRtmr3 } from '@spindle/shared/dstack';
import type { JobStartMsg, NodeToServer } from '@spindle/shared/node-protocol';
import { decodeReceipt, receiptFromBase64, verifyReceipt } from '@spindle/shared/receipt';
import { sealRequest } from '@spindle/shared/sealed';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { installSyntheticEnv, REAL_QUOTE, syntheticEventLog } from '../../../src/modules/attest/testkit';
import { verifyAttestation } from '../../../src/modules/attest/verify';
import type { Delta, Engine } from '../engine';
import { JobRunner } from '../jobs';
import { silentLogger } from '../log';
import { collectAttestation } from './attest';
import type { GpuTools } from './nvidia';
import { SealedRuntime } from './runtime';

// SYNTHETIC: fake dstack agent, fake NVIDIA tooling. The real thing needs a TDX CVM + H100 (UNTESTED, see README).
const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);
const key = {
  privateKey: pk,
  address: account.address,
  publicKey: account.publicKey,
  createdAt: '',
  account,
};
const nodeKey = account.address;

function fakeGpu(calls: string[][] = []): GpuTools {
  return {
    async run(cmd) {
      calls.push(cmd);
      if (cmd[0] === 'python3' && cmd[1] === '-m') return { code: 0, stdout: 'GPU 0 verified', stderr: '' };
      const nonce = cmd[cmd.length - 1] as string;
      void nonce;
      return {
        code: 0,
        stdout: JSON.stringify({
          arch: 'HOPPER',
          evidence_list: [{ evidence: 'ZXZpZGVuY2U=', certificate: 'Y2VydA==' }],
        }),
        stderr: '',
      };
    },
  };
}

function fakeDstack() {
  const requested: string[] = [];
  return {
    requested,
    quote: async (reportData: Uint8Array) => {
      requested.push(Buffer.from(reportData).toString('hex'));
      return {
        quote: Buffer.concat([
          REAL_QUOTE,
          Buffer.from(requested.length.toString(16).padStart(8, '0'), 'hex'),
        ]).toString('hex'),
        event_log: JSON.stringify(syntheticEventLog()),
      };
    },
  };
}

describe('collectAttestation (fake dstack + fake NVIDIA tools)', () => {
  test('asks dstack for a quote over sha256(hpkePub||nodeKey||nonce) and runs the local verifier first', async () => {
    const d = fakeDstack();
    const calls: string[][] = [];
    const hpkePub = Buffer.alloc(32, 5).toString('base64');
    const c = await collectAttestation(hpkePub, nodeKey, {
      quote: d.quote,
      gpu: fakeGpu(calls),
      randomNonce: () => '07'.repeat(32),
    });
    expect(d.requested[0]).toBe(expectedReportData(hpkePub, nodeKey, '07'.repeat(32)));
    expect(calls[0]?.slice(0, 3)).toEqual(['python3', '-m', 'verifier.cc_admin']);
    expect(c.bundle.hpkePublicKey).toBe(hpkePub);
    expect((c.bundle.nvidiaEvidence as { nonce: string }).nonce).toBe('07'.repeat(32));
    expect(c.receipt.rtmr3).toBe(replayRtmr3(syntheticEventLog()).rtmr3);
    expect(c.receipt.gpuEvidenceHash).toBe(sha256Hex(canonicalJson(c.bundle.nvidiaEvidence)));
  });

  test('a failing local GPU verifier aborts attestation', async () => {
    const bad: GpuTools = { run: async () => ({ code: 1, stdout: '', stderr: 'CC mode off' }) };
    await expect(
      collectAttestation(Buffer.alloc(32, 5).toString('base64'), nodeKey, {
        quote: fakeDstack().quote,
        gpu: bad,
        randomNonce: () => '07'.repeat(32),
      }),
    ).rejects.toThrow(/local GPU verifier/);
  });

  test('node-built bundle passes the backend verifier (synthetic quote/NRAS stubs)', async () => {
    const env = await installSyntheticEnv();
    try {
      const d = fakeDstack();
      const rt = await SealedRuntime.create({
        nodeKey,
        send: () => true,
        log: silentLogger,
        collectDeps: { quote: d.quote, gpu: fakeGpu(), randomNonce: () => 'a1'.repeat(32) },
      });
      const bundle = await rt.attestForHello();
      env.bind({
        reportData: d.requested[0] as string,
        rtmr3: replayRtmr3(syntheticEventLog()).rtmr3,
        nonce: 'a1'.repeat(32),
      });
      const r = await verifyAttestation(bundle, nodeKey.toLowerCase());
      expect(r).toMatchObject({ ok: true });
      // a different node key does not verify
      expect(await verifyAttestation(bundle, `0x${'12'.repeat(20)}`)).toMatchObject({
        ok: false,
        reason: 'REPORT_DATA_MISMATCH',
      });
    } finally {
      env.restore();
    }
  });
});

const fakeEngine = (): Engine => ({
  kind: 'vllm',
  listModels: async () => [{ id: 'q', digest: 'sha256:dd', sizeMb: 1 }],
  ensureModel: async () => 'sha256:dd',
  async *chatStream() {
    yield { content: 'Hel' } as Delta;
    yield { content: 'lo' } as Delta;
    yield { usage: { promptTokens: 5, completionTokens: 2 } } as Delta;
  },
  chat: async () => ({}),
  embeddings: async () => ({}),
  version: async () => '1',
});

describe('sealed job through the JobRunner', () => {
  async function setup() {
    const sent: NodeToServer[] = [];
    const send = (m: NodeToServer) => (sent.push(m), true);
    const refreshes: NodeToServer[] = [];
    const rt = await SealedRuntime.create({
      nodeKey,
      send: (m) => (m.type === 'attest.refresh' ? (refreshes.push(m), true) : send(m)),
      log: silentLogger,
      collectDeps: { quote: fakeDstack().quote, gpu: fakeGpu(), randomNonce: () => 'b2'.repeat(32) },
    });
    await rt.attestForHello();
    const runner = new JobRunner({
      engine: fakeEngine(),
      key,
      send: (m) => (m.type === 'attest.refresh' ? false : send(m)),
      log: silentLogger,
      agentVersion: '0.1.0',
      batchMs: 0,
      sealed: rt,
    });
    // route the runtime's sealed sends to the same capture
    return { sent, runner, rt, refreshes };
  }
  const startMsg = (model: string, envelope: { enc: string; ciphertext: string }): JobStartMsg => ({
    v: 1,
    type: 'job.start',
    jobId: 'sj1',
    kind: 'chat',
    model,
    engineModel: 'q',
    lane: 'sealed',
    request: {},
    maxTokens: 0,
    deadlineMs: 30_000,
    sealed: envelope,
  });

  test('decrypts inside, seals chunks + output to the buyer, signs a receipt with attestation and the envelope digest', async () => {
    const { sent, runner, rt } = await setup();
    const req = await sealRequest({
      nodePublicKey: rt.publicKey,
      nodeKey,
      model: 'qwen',
      request: { messages: [{ role: 'user', content: 'TOP SECRET' }] },
    });
    const env = { enc: req.envelope.enc, ciphertext: req.envelope.ciphertext };
    await runner.start(startMsg('qwen', env));
    await Bun.sleep(20);
    expect(JSON.stringify(sent)).not.toContain('TOP SECRET');
    expect(JSON.stringify(sent)).not.toContain('Hello');
    const chunks = sent.filter((m) => m.type === 'job.chunk');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((m) => m.type === 'job.chunk' && m.sealed === true)).toBe(true);
    let text = '';
    for (const c of chunks) {
      if (c.type !== 'job.chunk') continue;
      text +=
        (await req.openResponse.open<{ delta: { content?: string } }>(c.delta.content as string, 'sj1')).delta
          .content ?? '';
    }
    expect(text).toBe('Hello');
    const done = sent.find((m) => m.type === 'job.done');
    if (done?.type !== 'job.done') throw new Error('no done');
    expect(done.sealed).toBe(true);
    expect(done.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
    const out = await req.openResponse.open<{ usage: { promptTokens: number } }>(
      (done.output as { sealed: string }).sealed,
      'sj1',
    );
    expect(out.usage.promptTokens).toBe(5);
    const cose = receiptFromBase64(done.receipt);
    expect(verifyReceipt(cose, account.publicKey)).toBe(true);
    const p = decodeReceipt(cose).payload;
    expect(p.lane).toBe('sealed');
    expect(p.attestation?.hpkeKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(p.inputDigest).toBe(sha256Hex(canonicalJson(env)));
    expect(p.usage).toEqual({ p: 0, c: 0 });
    // order: all chunks precede the done message
    expect(sent.findIndex((m) => m.type === 'job.done')).toBe(sent.length - 1);
  });

  test('tampered ciphertext or wrong model -> job.error without leaking details', async () => {
    const { sent, runner, rt } = await setup();
    const req = await sealRequest({
      nodePublicKey: rt.publicKey,
      nodeKey,
      model: 'qwen',
      request: { x: 'TOP SECRET' },
    });
    await runner.start(
      startMsg('other-model', { enc: req.envelope.enc, ciphertext: req.envelope.ciphertext }),
    );
    const err = sent.find((m) => m.type === 'job.error');
    expect(err).toMatchObject({ type: 'job.error', code: 'ENGINE_ERROR' });
    expect(JSON.stringify(err)).not.toContain('SECRET');
  });

  test('without a sealed runtime the job is refused', async () => {
    const sent: NodeToServer[] = [];
    const runner = new JobRunner({
      engine: fakeEngine(),
      key,
      send: (m) => (sent.push(m), true),
      log: silentLogger,
      agentVersion: '0.1.0',
    });
    await runner.start(startMsg('qwen', { enc: 'a', ciphertext: 'b' }));
    expect(sent[0]).toMatchObject({ type: 'job.error', code: 'ENGINE_ERROR' });
  });

  test('refreshNow sends attest.refresh with a fresh bundle', async () => {
    const { rt, refreshes } = await setup();
    expect(await rt.refreshNow()).toBe(true);
    expect(refreshes[0]).toMatchObject({ type: 'attest.refresh' });
  });
});
