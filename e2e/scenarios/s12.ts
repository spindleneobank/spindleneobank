import { login, runJob } from '../lib/api';
import { pub, setBalance, sleep, until } from '../lib/chain';
import { psql, rows } from '../lib/db';
import { API } from '../lib/env';
import { admin } from '../lib/fixtures';
import { assert, eq, type Scenario } from '../lib/harness';
import { ensureNodeA } from './s01';

export const s12: Scenario = {
  n: 12,
  name: 'Keeper low balance',
  async run(c) {
    await ensureNodeA(c);
    const { account } = await import('../../dev/lib/accounts');
    const k = account(1).address;
    const a = await admin();
    const s4 = await login(4);
    const orig = await pub.getBalance({ address: k });
    let pendingEpoch = '';
    try {
      await setBalance(k, 10n ** 15n); // 0.001 ETH
      await runJob(a, 'x402-guard');
      const buyer = await until(
        async () => {
          const b = await s4.get('/v1/app/buyer');
          return b.x402.enabled === false ? b : undefined;
        },
        60_000,
        1500,
      );
      c.ev('buyer-x402', buyer.x402);
      eq(buyer.x402.enabled, false, 'x402.enabled=false at 0.001 ETH');
      // the 402 path answers with the "use an API key" message
      const res = await fetch(`${API}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'qwen2.5:0.5b', messages: [{ role: 'user', content: 'hi' }] }),
      });
      const body = await res.text();
      c.ev('unauth-request', {
        status: res.status,
        body: body.slice(0, 500),
        headers: { 'payment-required': res.headers.get('payment-required') ? 'present' : null },
      });
      assert(/api key/i.test(body), `message mentions API key (status ${res.status}: ${body.slice(0, 160)})`);
      c.step(`402 path: HTTP ${res.status} "${body.slice(0, 120)}"`);
      // postRoot: below KEEPER_CRITICAL_ETH_WEI (0.0015) the poster refuses to send (by design) and records a failure
      const s3 = await login(3);
      const nodeA = (await s3.get('/v1/app/nodes')).find((n: any) => n.name === 'e2e-a');
      await psql(
        `insert into earning_events (ts, node_id, owner, kind, usdg_micros) values (now(), '${nodeA.id}', '${s3.address}', 'floor', 11000000)`,
      );
      await psql("update earning_events set ts = ts - interval '3 hours' where epoch is null");
      c.ev('build', await runJob(a, 'epoch-build'));
      c.ev('post-low', await runJob(a, 'post-root'));
      const low = (await rows('select epoch,status from epochs order by epoch desc limit 1'))[0] as string[];
      c.step(`at 0.001 ETH the new epoch ${low[0]} is ${low[1]}`);
      c.ev('epoch-at-low-balance', low);
      assert(low[1] !== 'posted', 'poster refuses below the critical threshold');
      pendingEpoch = low[0] as string;
    } finally {
      await setBalance(k, orig);
      await runJob(a, 'x402-guard');
    }
    const back = await until(
      async () => {
        const b = await s4.get('/v1/app/buyer');
        return b.x402.enabled === true ? b : undefined;
      },
      60_000,
      1500,
    );
    c.ev('buyer-x402-restored', back.x402);
    c.step('keeper balance restored, x402 enabled again');
    // the failed epoch is retried and posts once the keeper is refilled
    await until(
      async () => {
        await runJob(a, 'post-root').catch(() => {});
        await sleep(3000);
        const r = (await rows(`select status from epochs where epoch = ${pendingEpoch}`))[0];
        return r?.[0] === 'posted' ? true : undefined;
      },
      90_000,
      1000,
    );
    c.step(`epoch ${pendingEpoch} posted after refill`);
    await sleep(0);
  },
};
