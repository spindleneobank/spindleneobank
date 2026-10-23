import { runJob } from '../lib/api';
import { until } from '../lib/chain';
import { psql, rows } from '../lib/db';
import { admin } from '../lib/fixtures';
import { assert, type Scenario } from '../lib/harness';
import { removeNode } from '../lib/node';
import { ensureDevNode } from './s10';

export const s11: Scenario = {
  n: 11,
  name: 'Probe mismatch',
  async run(c) {
    const a = await admin();
    const { s, n } = await ensureDevNode(
      6,
      `e2e-gpu-${Date.now() % 1000000}`,
      { SPINDLE_DEV_FAKE_GPU: 'RTX 4090:24576' },
      c,
    );
    c.ev('node-claimed', { gpuClass: n.gpuClass, gpuModel: n.gpuModel, vramGb: n.vramGb });
    c.step(`fake-GPU node ${n.id}: class ${n.gpuClass} ${n.gpuModel}`);
    assert(n.gpuClass > 0, 'node claims a GPU class above 0');
    for (let round = 1; round <= 2; round++) {
      // only this node is due: stamp everyone else as just probed
      await psql(`update nodes set last_probe_at = now() where id <> '${n.id}'`);
      await psql(`update nodes set last_probe_at = null where id = '${n.id}'`);
      const out = await runJob(a, 'probe-dispatch');
      c.step(`probe round ${round} queued: ${JSON.stringify(out).slice(0, 80)}`);
      await until(
        async () => {
          const r = await rows(`select count(*) from probe_results where node_id = '${n.id}'`);
          return Number(r[0]?.[0]) >= round ? true : undefined;
        },
        200_000,
        3000,
      );
    }
    const pr = await rows(
      `select class_ok, tok_per_sec, vram_gb, left(details::text, 160) from probe_results where node_id = '${n.id}' order by created_at`,
    );
    c.ev('probe-results', pr);
    assert(pr.length >= 2 && pr.every((r) => r[0] === 'f'), 'two failed probes recorded');
    const st = (await s.get('/v1/app/nodes')).find((x: any) => x.id === n.id);
    c.ev('node-after', { status: st.status });
    assert(st.status === 'suspended', `node suspended (status ${st.status})`);
    await removeNode(n.name, true);
    c.step('node suspended after two failed probes');
  },
};
