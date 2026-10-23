import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { jobs, nodes, users } from '../../db/schema';
import { dbRef } from '../auth/constants';
import { buyerIdForAddress } from '../buyers/service';

/** Test helpers shared by the canary, probe and slashing suites. */
export const addr = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();

let onchain = 100n;

export async function makeNode(over: Partial<typeof nodes.$inferInsert> = {}) {
  const owner = addr();
  const [u] = await dbRef.db.insert(users).values({ address: owner }).returning();
  const acct = privateKeyToAccount(generatePrivateKey());
  const [n] = await dbRef.db
    .insert(nodes)
    .values({
      owner,
      userId: u?.id as string,
      nodeKey: acct.address.toLowerCase(),
      nodePubkey: acct.publicKey,
      name: 'rig',
      engine: 'ollama',
      gpuModel: 'NVIDIA GeForce RTX 4090',
      gpuClass: 2,
      lane: 'open',
      status: 'online',
      registered: true,
      onchainId: ++onchain,
      reputation: 1000,
      models: [{ id: 'qwen2.5:7b', digest: 'sha256:a' }],
      ...over,
    })
    .returning();
  return n as typeof nodes.$inferSelect;
}

export async function makeCanaryJob(nodeId: string) {
  const buyerId = await buyerIdForAddress(addr());
  const [j] = await dbRef.db
    .insert(jobs)
    .values({
      buyerId,
      nodeId,
      lane: 'open',
      model: 'qwen2.5:7b',
      kind: 'chat',
      unitKind: 'tokens_1m',
      payMode: 'canary',
      isCanary: true,
      status: 'completed',
    })
    .returning();
  return j?.id as string;
}

/** Inserts finished canary rows directly (history for the sample-size rule). */
export async function seedCanaries(nodeId: string, fails: number, passes: number) {
  const { canaryResults } = await import('../../db/schema');
  const rows = [
    ...Array.from({ length: fails }, () => ({
      nodeId,
      kind: 'chat',
      pass: false,
      expected: {},
      observed: {},
    })),
    ...Array.from({ length: passes }, () => ({
      nodeId,
      kind: 'chat',
      pass: true,
      expected: {},
      observed: {},
    })),
  ];
  if (rows.length) await dbRef.db.insert(canaryResults).values(rows);
}
