import { login, runJob } from '../lib/api';
import { sleep, until } from '../lib/chain';
import { psql, rows } from '../lib/db';
import { admin, syncIndexer } from '../lib/fixtures';
import { assert, type Scenario } from '../lib/harness';
import { enrollAndStart } from '../lib/node';
import { registerNode } from '../lib/onchain';

/** Starts a registered dev node for `acct` with extra env (lazy / fake gpu); returns its API row. */
export async function ensureDevNode(acct: number, name: string, env: Record<string, string>, c: { step: (m: string) => void }) {
  const s = await login(acct);
  const a = await admin();
  let n = (await s.get('/v1/app/nodes')).find((x: any) => x.name === name);
  if (!n) {
    c.step(`enroll + start ${name}`);
    n = await enrollAndStart(s, { name, env });
  }
  if (!n.registered) {
    await registerNode(s, n.id);
    n = await until(async () => {
      await syncIndexer(a, 14);
      return (await s.get('/v1/app/nodes')).find((x: any) => x.id === n.id && x.registered);
    }, 90_000, 1000);
  }
  return { s, n };
}

export const s10: Scenario = {
  n: 10,
  name: 'Canary failure',
  async run(c) {
    const a = await admin();
    const s7 = await login(7);
    const { n } = await ensureDevNode(7, 'e2e-lazy', { SPINDLE_DEV_LAZY: '1' }, c);
    c.step(`lazy node ${n.id} registered`);
    // fixture: pending earnings so a withhold has something to take
    await psql(`insert into earning_events (ts, node_id, owner, kind, usdg_micros) values (now(), '${n.id}', '${s7.address}', 'job', 2000000)`);
    let fails = 0;
    for (let i = 0; i < 16 && fails < 5; i++) {
      await psql(`update jobs set created_at = created_at - interval '2 hours' where is_canary = true and node_id = '${n.id}' and created_at > now() - interval '1 hour'`);
      await runJob(a, 'canary-dispatch');
      await until(async () => {
        const r = await rows(`select count(*) from canary_results where node_id = '${n.id}' and coalesce(observed->>'attempt','') <> '1'`);
        return Number(r[0]?.[0]) > fails ? Number(r[0]?.[0]) : undefined;
      }, 60_000, 1500).then((v) => (fails = v));
      c.step(`canary results so far: ${fails}`);
      await sleep(1000);
    }
    const res = await rows(`select pass, kind, observed->>'attempt' from canary_results where node_id = '${n.id}'`);
    c.ev('canary-results', res);
    assert(res.length >= 5 && fails >= 5 && res.every((r) => r[0] === 'f'), `all canaries fail (${JSON.stringify(res)})`);
    const withheld = await until(async () => {
      const r = await rows(`select usdg_micros from earning_events where node_id = '${n.id}' and kind = 'canary_withhold'`);
      return r.length ? r : undefined;
    }, 30_000, 1500).catch(() => [] as string[][]);
    c.ev('canary-withhold', withheld);
    assert(withheld.length >= 1, 'canary_withhold earning events exist');
    const adm = await admin();
    const cases = await adm.get('/v1/admin/slash-cases');
    const mine = (cases.items ?? cases).filter((x: any) => x.nodeId === n.id || x.node?.id === n.id);
    c.ev('slash-cases', mine);
    assert(mine.length >= 1, 'slash case opened for the node');
    const safe = JSON.stringify(mine[0]);
    assert(/"data":"0x[0-9a-f]+"/i.test(safe) && /"to":"0x/i.test(safe), 'case carries Safe tx data (to + data)');
    const st = (await (await login(7)).get('/v1/app/nodes')).find((x: any) => x.id === n.id);
    c.step(`node status ${st.status}; withheld ${withheld.map((w) => w[0]).join(',')}; case status ${mine[0].status}`);
  },
};
