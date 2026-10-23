import { spindleClaimsAbi } from '@spindle/shared/abi';
import { runJob } from '../lib/api';
import { login } from '../lib/api';
import { head, increaseTime, ok, pub, sleep, until, usdgOf, wallet } from '../lib/chain';
import { psql } from '../lib/db';
import { addr } from '../lib/env';
import { admin, syncIndexer } from '../lib/fixtures';
import { assert, eq, type Scenario } from '../lib/harness';
import { bearer } from '../lib/api';
import { ensureNodeA } from './s01';

/** Ensure account 3 has unposted earnings (serve a few jobs) and build + post a root for them. */
export async function buildAndPost(c: { step: (m: string) => void; ev: (n: string, d: unknown) => void }) {
  const a = await admin();
  const s3 = await login(3);
  const from = BigInt(await head());
  // fixture: chat jobs earn only micros, below the 10 USDG minimum claim: add a 15 USDG floor payment for node A
  const nodeA = (await s3.get('/v1/app/nodes')).find((n: any) => n.name === 'e2e-a');
  await psql(`insert into earning_events (ts, node_id, owner, kind, usdg_micros) values (now(), '${nodeA.id}', '${s3.address}', 'floor', 15000000)`);
  // backdate not-yet-assigned earnings so the "closed hour" boundary includes them (fixture shortcut instead of waiting an hour)
  await psql("update earning_events set ts = ts - interval '3 hours' where epoch is null");
  const built = await runJob(a, 'epoch-build');
  c.ev('epoch-build', built);
  await runJob(a, 'post-root');
  const claims = addr('CLAIMS_ADDRESS');
  const logs = await until(async () => {
    await runJob(a, 'post-root').catch(() => {});
    await sleep(3000);
    const l = await pub.getContractEvents({ address: claims, abi: spindleClaimsAbi, eventName: 'RootPosted', fromBlock: from, toBlock: 'latest' });
    return l.length ? l : undefined;
  }, 90_000, 1000);
  const ev = logs[logs.length - 1] as (typeof logs)[number];
  c.ev('root-posted', { tx: ev.transactionHash, args: Object.fromEntries(Object.entries(ev.args).map(([k, v]) => [k, String(v)])) });
  c.step(`RootPosted epoch ${ev.args.epoch} tx ${ev.transactionHash}`);
  return { epoch: ev.args.epoch as bigint, tx: ev.transactionHash, s3 };
}

export const s06: Scenario = {
  n: 6,
  name: 'Root and claim',
  async run(c) {
    await ensureNodeA(c);
    const s3 = await login(3);
    // make sure node A earned something recently
    const key = (await import('../lib/fixtures')).apiKey;
    const s4 = await login(4);
    const k4 = await key(s4);
    for (let i = 0; i < 2; i++) await bearer(k4, '/v1/chat/completions', { model: 'qwen2.5:0.5b', max_tokens: 16, messages: [{ role: 'user', content: `Say ${i}.` }] }).then((r) => r.text());
    await sleep(3000);
    const { epoch } = await buildAndPost(c);
    await increaseTime(3601);
    await increaseTime(1);
    // the API's claim delay runs on the wall clock: shift the posted_at of fresh roots back by the same warp
    await psql("update epochs set posted_at = posted_at - interval '3700 seconds' where status = 'posted'");
    const a = await admin();
    await runJob(a, 'indexer');
    await sleep(3000);
    const proof = await until(async () => s3.get('/v1/app/claim/proof').catch(() => undefined), 60_000, 2000);
    c.ev('claim-proof', proof);
    assert(BigInt(proof.claimableMicros) > 0n, 'claimable > 0');
    const claims = addr('CLAIMS_ADDRESS');
    const w = wallet(3);
    const me = w.account.address;
    const before = await usdgOf(me);
    const hash = await w.writeContract({ address: claims, abi: spindleClaimsAbi, functionName: 'claim', args: [BigInt(proof.epoch), BigInt(proof.cumulativeMicros), proof.proof, BigInt(proof.claimableMicros)] });
    await ok(hash);
    const after = await usdgOf(me);
    eq(after - before, BigInt(proof.claimableMicros), 'USDG balance delta equals claimable');
    c.step(`claimed ${proof.claimableMicros} in ${hash}`);
    // second claim with the same proof amount reverts on-chain
    let reverted = false;
    try {
      await pub.simulateContract({ account: me, address: claims, abi: spindleClaimsAbi, functionName: 'claim', args: [BigInt(proof.epoch), BigInt(proof.cumulativeMicros), proof.proof, BigInt(proof.claimableMicros)] });
    } catch (e) {
      reverted = true;
      c.ev('second-claim-revert', { message: String((e as Error).message).slice(0, 300) });
    }
    assert(reverted, 'second claim reverts on-chain');
    const sum = await until(async () => {
      await syncIndexer(a, 14);
      const x = await s3.get('/v1/app/earnings/summary');
      return BigInt(x.claimableMicros) === 0n ? x : undefined;
    }, 90_000, 1000);
    c.ev('summary-after', sum);
    eq(BigInt(sum.claimableMicros), 0n, 'summary claimable 0 after claim');
    void epoch;
  },
};
