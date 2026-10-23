import { login, runJob } from '../lib/api';
import { until } from '../lib/chain';
import { admin, syncIndexer } from '../lib/fixtures';
import { assert, type Scenario } from '../lib/harness';
import { enrollAndStart, waitNode } from '../lib/node';
import { registerNode, stakeNode } from '../lib/onchain';

/** Ensures account 3 owns an online, registered, staked node `e2e-a`; returns it. Used by later scenarios. */
export async function ensureNodeA(c?: { step: (m: string) => void; ev: (n: string, d: unknown) => void }) {
  const s = await login(3);
  const a = await admin();
  let n = (await s.get('/v1/app/nodes')).find((x: any) => x.name === 'e2e-a');
  if (n?.status === 'suspended') {
    await a.post(`/v1/admin/nodes/${n.id}/unsuspend`, {});
    c?.step('unsuspended e2e-a');
  }
  if (!n || n.status !== 'online') {
    c?.step('enroll + start node e2e-a');
    if (n) {
      // exists but offline: restart the container (volume kept, no token needed)
      const { startNode } = await import('../lib/node');
      await startNode({ name: 'e2e-a' });
      n = await waitNode(s, 'e2e-a');
    } else n = await enrollAndStart(s, { name: 'e2e-a' });
  }
  if (!n.registered) {
    c?.step('register on-chain');
    const r = await registerNode(s, n.id);
    c?.ev('register-tx', r);
    await syncIndexer(a);
    n = await until(async () => {
      await runJob(a, 'indexer');
      return (await s.get('/v1/app/nodes')).find((x: any) => x.id === n.id && x.registered);
    }, 90_000);
  }
  if (BigInt(n.stake?.active ?? 0) === 0n) {
    c?.step('stake 1000 SPDL');
    const hashes = await stakeNode(s, n.id, (1000n * 10n ** 18n).toString());
    c?.ev('stake-txs', hashes);
    await syncIndexer(a);
    n = await until(async () => {
      await runJob(a, 'indexer');
      const x = (await s.get('/v1/app/nodes')).find((y: any) => y.id === n.id);
      return BigInt(x?.stake?.active ?? 0) > 0n ? x : undefined;
    }, 90_000);
  }
  return { s, node: n };
}

export const s01: Scenario = {
  n: 1,
  name: 'Node onboarding',
  async run(c) {
    const { node } = await ensureNodeA(c);
    c.ev('node', node);
    assert(node.status === 'online', 'node online');
    assert(node.gpuClass === 0, `CPU node is class 0 (got ${node.gpuClass})`);
    assert(node.registered === true, 'indexer registered=true');
    assert(BigInt(node.stake.active) === 1000n * 10n ** 18n, 'stake reflected');
    c.step(`node ${node.id} online class ${node.gpuClass} registered staked ${node.stake.active}`);
  },
};
