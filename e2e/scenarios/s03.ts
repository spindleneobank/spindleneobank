import { join } from 'node:path';
import { bearer, login } from '../lib/api';
import { sleep, until } from '../lib/chain';
import { REPO } from '../lib/env';
import { apiKey, deposit } from '../lib/fixtures';
import { assert, eq, type Scenario, state } from '../lib/harness';
import { run } from '../lib/proc';
import { ensureNodeA } from './s01';

const API = 'http://127.0.0.1:7200';
const chat = (k: string, body: object) =>
  bearer(k, '/v1/chat/completions', { model: 'qwen2.5:0.5b', max_tokens: 40, ...body });

export const s03: Scenario = {
  n: 3,
  name: 'Buyer prepaid',
  async run(c) {
    await ensureNodeA(c);
    const s = await login(4);
    const before0 = BigInt((await s.get('/v1/app/buyer')).balanceMicros);
    const seen = new Set<string>(
      ((await s.get('/v1/app/buyer/ledger?limit=100')).items as any[]).map((i) => i.id),
    );
    const d = await deposit(s, 50_000_000n);
    c.ev('deposit', d);
    const afterDeposit = BigInt((await s.get('/v1/app/buyer')).balanceMicros);
    eq(afterDeposit, before0 + 50_000_000n, 'ledger credited by exactly the deposit');
    const key = await apiKey(s);
    c.step('api key ready');

    // direct calls: non-stream, stream, embeddings, with job ids and charges collected from headers
    const jobs: { id: string; charge: bigint }[] = [];
    const r1 = await chat(key, { messages: [{ role: 'user', content: 'Say hello in five words.' }] });
    assert(r1.ok, `chat ${r1.status}`);
    jobs.push({
      id: r1.headers.get('x-spindle-job-id') as string,
      charge: BigInt(r1.headers.get('x-spindle-charge-micros') as string),
    });
    await r1.text();
    const r2 = await chat(key, { stream: true, messages: [{ role: 'user', content: 'Count to five.' }] });
    assert(r2.ok, `stream ${r2.status}`);
    const txt = await r2.text();
    assert(txt.includes('[DONE]'), 'stream ends with [DONE]');
    const meta = txt
      .split('\n')
      .filter((l) => l.startsWith('data: {'))
      .map((l) => JSON.parse(l.slice(6)))
      .find((x) => x.spindle);
    assert(meta?.spindle?.jobId, 'stream carries spindle meta');
    jobs.push({ id: meta.spindle.jobId, charge: BigInt(meta.spindle.chargeMicros) });
    const r3 = await bearer(key, '/v1/embeddings', { model: 'nomic-embed-text', input: ['hello', 'world'] });
    assert(r3.ok, `embeddings ${r3.status}`);
    const emb: any = await r3.json();
    eq(emb.data.length, 2, 'two embeddings');
    jobs.push({
      id: r3.headers.get('x-spindle-job-id') as string,
      charge: BigInt(r3.headers.get('x-spindle-charge-micros') as string),
    });
    c.ev(
      'direct-jobs',
      jobs.map((j) => ({ ...j, charge: j.charge.toString() })),
    );

    // the shipped examples against the same key
    const env = {
      ...process.env,
      SPINDLE_API_URL: API,
      SPINDLE_API_KEY: key,
      SPINDLE_MODEL: 'qwen2.5:0.5b',
      SPINDLE_EMBED_MODEL: 'nomic-embed-text',
    };
    const ex = join(REPO, 'examples');
    const o1 = await run(['bash', 'curl.sh'], { cwd: ex, env });
    const o2 = await run(['node', 'openai-node.mjs'], { cwd: ex, env });
    c.ev('examples-curl', o1);
    c.ev('examples-openai-node', o2);
    eq(o1.code, 0, 'curl.sh exit 0');
    eq(o2.code, 0, 'openai-node.mjs exit 0');

    // ledger: every charge settles; balance = deposit - sum(charges) exactly
    const final = await until(
      async () => {
        const b = await s.get('/v1/app/buyer');
        const led = await s.get('/v1/app/buyer/ledger?limit=100');
        if (BigInt(b.reservedMicros) !== 0n) return undefined;
        return { b, led };
      },
      60_000,
      1500,
    );
    const items = final.led.items as any[];
    const charges = items.filter((i) => i.kind !== 'deposit' && i.jobId && !seen.has(i.id));
    const sumCharges = charges.reduce((a, i) => a + BigInt(i.micros), 0n);
    c.ev('ledger', final.led);
    c.step(`charges ${charges.length}, sum ${sumCharges}, balance ${final.b.balanceMicros}`);
    for (const j of jobs) {
      const e = charges.find((i) => i.jobId === j.id);
      assert(e, `ledger entry for job ${j.id}`);
      eq(
        BigInt(e.micros) < 0n ? -BigInt(e.micros) : BigInt(e.micros),
        j.charge,
        `ledger amount equals X-Spindle-Charge-Micros for ${j.id}`,
      );
    }
    const debited = afterDeposit - BigInt(final.b.balanceMicros);
    const absSum = charges.reduce(
      (a, i) => a + (BigInt(i.micros) < 0n ? -BigInt(i.micros) : BigInt(i.micros)),
      0n,
    );
    eq(debited, absSum, 'balance debited by exactly the sum of charges (all buyer jobs)');
    state.set(
      's03:jobs',
      jobs.map((j) => j.id),
    );

    // receipts: verified, recount within tolerance
    const receipts: any[] = [];
    for (const j of jobs) {
      const r = await until(
        async () => {
          const res = await fetch(`${API}/v1/receipts/${j.id}`);
          return res.ok ? ((await res.json()) as any) : undefined;
        },
        60_000,
        1500,
      );
      receipts.push({ jobId: j.id, verified: r.verified, reason: r.reason, usage: r.usage, lane: r.lane });
      assert(r.verified === true, `receipt ${j.id} verified (reason: ${r.reason})`);
    }
    c.ev('receipts', receipts);
    await sleep(0);
  },
};
