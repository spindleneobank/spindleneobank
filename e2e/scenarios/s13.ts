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
    const warm = await bearer(key, '/v1/chat/completions', { model: 'qwen2.5:0.5b', max_tokens: 4, messages: [{ role: 'user', content: 'hi' }] });
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
    const out = await run(['bash', 'run-all.sh'], { cwd: ex, env, timeoutMs: 900_000 });
    c.ev('run-all', out);
    c.step(`run-all.sh exit ${out.code}; tail: ${out.stdout.trim().split('\n').slice(-3).join(' | ')}`);
    eq(out.code, 0, 'run-all.sh exits 0');
  },
};
