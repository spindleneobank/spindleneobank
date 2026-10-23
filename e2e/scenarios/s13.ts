import { join } from 'node:path';
import { privateKey } from '../../dev/lib/accounts';
import { bearer, login } from '../lib/api';
import { addr, REPO } from '../lib/env';
import { apiKey } from '../lib/fixtures';
import { eq, type Scenario } from '../lib/harness';
import { run } from '../lib/proc';
import { ensureNodeA } from './s01';

export const s13: Scenario = {
  n: 13,
  name: 'Examples',
  async run(c) {
    await ensureNodeA(c);
    const key = await apiKey(await login(4));
    const ex = join(REPO, 'examples');
    // wait until a node is free of probes: the example scripts do not retry NO_CAPACITY themselves
    for (let i = 0; i < 3; i++) {
      const w = await bearer(key, '/v1/chat/completions', {
        model: 'qwen2.5:0.5b',
        max_tokens: 4,
        messages: [{ role: 'user', content: 'hi' }],
      });
      await w.text();
      await new Promise((r) => setTimeout(r, 4000));
    }
    const warm = await bearer(key, '/v1/chat/completions', {
      model: 'qwen2.5:0.5b',
      max_tokens: 4,
      messages: [{ role: 'user', content: 'hi' }],
    });
    await warm.text();
    const inst = await run(['bun', 'install'], { cwd: ex });
    c.ev('install', { code: inst.code, tail: inst.stdout.slice(-300) });
    const env = {
      ...process.env,
      SPINDLE_API_URL: 'http://127.0.0.1:7200',
      RPC_URL: 'http://127.0.0.1:7245',
      SPINDLE_API_KEY: key,
      SPINDLE_MODEL: 'qwen2.5:0.5b',
      SPINDLE_EMBED_MODEL: 'nomic-embed-text',
      PRIVATE_KEY: privateKey(5),
      CLAIMS_ADDRESS: addr('CLAIMS_ADDRESS'),
    };
    let out = await run(['bash', 'run-all.sh'], { cwd: ex, env, timeoutMs: 900_000 });
    if (out.code !== 0) {
      // nodes can be momentarily busy with a probe/canary (NO_CAPACITY, which the scripts do not retry): one retry, both recorded
      c.ev('run-all-attempt-1', out);
      c.note('run-all attempt 1 failed; retrying once');
      await new Promise((r) => setTimeout(r, 20_000));
      out = await run(['bash', 'run-all.sh'], { cwd: ex, env, timeoutMs: 900_000 });
    }
    c.ev('run-all', out);
    c.step(`run-all.sh exit ${out.code}; tail: ${out.stdout.trim().split('\n').slice(-3).join(' | ')}`);
    eq(out.code, 0, 'run-all.sh exits 0');
  },
};
