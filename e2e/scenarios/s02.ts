import { login } from '../lib/api';
import { until } from '../lib/chain';
import { assert, type Scenario } from '../lib/harness';
import { pairingCode, removeNode, startNode } from '../lib/node';

export const s02: Scenario = {
  n: 2,
  name: 'Pairing fallback',
  async run(c) {
    const s = await login(7);
    await removeNode('e2e-pair');
    await startNode({ name: 'e2e-pair' }); // no token
    const code = await pairingCode('e2e-pair');
    c.step(`pairing code from container log: ${code}`);
    const out = await s.post('/v1/app/nodes/pair', { code });
    c.ev('pair', out);
    const id = out.node?.id;
    assert(id, 'pair returns the node');
    const n = await until(
      async () => (await s.get('/v1/app/nodes')).find((x: any) => x.id === id && x.status === 'online'),
      90_000,
      2000,
    );
    c.ev('node', n);
    assert(n.status === 'online', 'paired node online');
    c.step(`node ${n.id} online after pairing`);
    await removeNode('e2e-pair');
  },
};
