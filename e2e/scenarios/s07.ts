import { spindleClaimsAbi } from '@spindle/shared/abi';
import { login, runJob } from '../lib/api';
import { increaseTime, ok, pub, sleep, until, usdgOf, wallet } from '../lib/chain';
import { psql, rows } from '../lib/db';
import { addr } from '../lib/env';
import { admin, syncIndexer } from '../lib/fixtures';
import { assert, eq, type Scenario } from '../lib/harness';
import { ensureNodeA } from './s01';
import { buildAndPost } from './s06';

export const s07: Scenario = {
  n: 7,
  name: 'Guardian veto',
  async run(c) {
    await ensureNodeA(c);
    const s3 = await login(3);
    const a = await admin();
    const nodeA = (await s3.get('/v1/app/nodes')).find((n: any) => n.name === 'e2e-a');
    await psql(`insert into earning_events (ts, node_id, owner, kind, usdg_micros) values (now(), '${nodeA.id}', '${s3.address}', 'floor', 12000000)`);
    const first = await buildAndPost(c);
    // guardian (account 2) vetoes within the delay
    const g = wallet(2);
    const vh = await g.writeContract({ address: addr('CLAIMS_ADDRESS'), abi: spindleClaimsAbi, functionName: 'vetoRoot', args: [first.epoch] });
    await ok(vh);
    c.step(`guardian vetoed epoch ${first.epoch}: ${vh}`);
    c.ev('veto', { epoch: String(first.epoch), tx: vh });
    // indexer marks it vetoed, the builder reposts under a new epoch
    await until(async () => {
      await syncIndexer(a, 14);
      const r = await rows(`select status from epochs where epoch = ${first.epoch}`);
      return r[0]?.[0] === 'vetoed' ? true : undefined;
    }, 90_000, 1000);
    c.step('indexer marked the epoch vetoed');
    const built = await runJob(a, 'epoch-build');
    c.ev('rebuild', built);
    const before = (await rows('select epoch,status from epochs order by epoch desc limit 3'));
    let second: bigint | undefined;
    await until(async () => {
      await runJob(a, 'post-root').catch(() => {});
      await sleep(3000);
      const r = await rows("select epoch from epochs where status = 'posted' order by epoch desc limit 1");
      const e = r[0]?.[0] ? BigInt(r[0][0]) : undefined;
      if (e && e > first.epoch) second = e;
      return second;
    }, 90_000, 1000);
    c.ev('epochs', { before, replacement: String(second) });
    assert(second && second > first.epoch, 'replacement root under a new epoch');
    c.step(`replacement epoch ${second}`);
    await increaseTime(3601);
    await increaseTime(1);
    await psql("update epochs set posted_at = posted_at - interval '3700 seconds' where status = 'posted'");
    const proof = await until(async () => s3.get('/v1/app/claim/proof').catch(() => undefined), 60_000, 2000);
    eq(BigInt(proof.epoch), second as bigint, 'claim proof uses the replacement epoch');
    const w = wallet(3);
    const b0 = await usdgOf(w.account.address);
    const h = await w.writeContract({ address: addr('CLAIMS_ADDRESS'), abi: spindleClaimsAbi, functionName: 'claim', args: [BigInt(proof.epoch), BigInt(proof.cumulativeMicros), proof.proof, BigInt(proof.claimableMicros)] });
    await ok(h);
    eq((await usdgOf(w.account.address)) - b0, BigInt(proof.claimableMicros), 'claim after veto pays claimable');
    c.step(`claim after veto ok ${h}`);
  },
};
