// Registers the house node (enrolled with account 0) on-chain and marks it as house. Idempotent.
import { login, runJob } from './lib/api';
import { mine, until } from './lib/chain';
import { registerNode } from './lib/onchain';

const s = await login(0);
const list = await s.get('/v1/app/nodes');
const n = list.find((x: any) => x.name === 'house') ?? list[0];
if (!n) throw new Error('no node enrolled for account 0');
console.log('node', n.id, n.status, 'registered', n.registered);
if (!n.registered) {
  try {
    const r = await registerNode(s, n.id);
    console.log('register tx', r.hash);
  } catch (e) {
    console.log('register skipped (already registered on-chain?)', String((e as Error).message).slice(0, 80));
  }
  await mine(14);
}
const cur = await until(async () => {
  await runJob(s, 'indexer').catch(() => {});
  const x = (await s.get('/v1/app/nodes')).find((y: any) => y.id === n.id);
  return x?.registered ? x : undefined;
}, 90_000);
console.log('registered', cur.registered, 'onchainId', cur.onchainId);
console.log(await s.post(`/v1/admin/nodes/${n.id}/house`, { isHouse: true }).catch((e) => e.body));
const models = await fetch('http://127.0.0.1:7200/v1/models').then((r) => r.json());
console.log(JSON.stringify(models, null, 1).slice(0, 1200));
