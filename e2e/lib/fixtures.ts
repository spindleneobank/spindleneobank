// Shared, idempotent setup used by several scenarios.
import { buyerVaultAbi, erc20Abi } from '@spindle/shared/abi';
import { login, runJob, type Session } from './api';
import { mine, ok, pub, sleep, USDG, until, wallet } from './chain';
import { state } from './harness';

export const syncIndexer = async (admin: Session, blocks = 14) => {
  if (blocks) await mine(blocks);
  await runJob(admin, 'indexer');
  await sleep(2500);
};

let adminS: Session | undefined;
export const admin = async () => (adminS ??= await login(0));

/** Account `i` deposits `micros` USDG into the vault; waits until the ledger shows it. */
export async function deposit(s: Session, micros: bigint) {
  const c = await s.get(`/v1/app/buyer/deposit-call?amountMicros=${micros}`);
  const w = wallet(s.index);
  const hashes: `0x${string}`[] = [];
  if (c.approve) {
    const h = await w.writeContract({
      address: c.approve.to,
      abi: erc20Abi,
      functionName: 'approve',
      args: [c.approve.args[0], BigInt(c.approve.args[1])],
    });
    await ok(h);
    hashes.push(h);
  }
  const h = await w.writeContract({
    address: c.deposit.to,
    abi: buyerVaultAbi,
    functionName: 'deposit',
    args: [BigInt(c.deposit.args[0])],
  });
  await ok(h);
  hashes.push(h);
  const before = BigInt((await s.get('/v1/app/buyer')).balanceMicros);
  const a = await admin();
  const bal = await until(
    async () => {
      await syncIndexer(a, 14);
      const b = BigInt((await s.get('/v1/app/buyer')).balanceMicros);
      return b >= before + micros ? b : undefined;
    },
    120_000,
    1000,
  );
  return { hashes, balance: bal };
}

/** API key for account `i` (cached in .state.json). */
export async function apiKey(s: Session): Promise<string> {
  const k = state.get<string>(`apikey:${s.index}`);
  if (k) {
    const r = await fetch('http://127.0.0.1:7200/v1/models', { headers: { authorization: `Bearer ${k}` } });
    if (r.ok) {
      // validate against the app list
      const keys = await s.get('/v1/app/api-keys');
      if (keys.some((x: any) => !x.revokedAt && k.startsWith(x.prefix))) return k;
    }
  }
  await s.reauth();
  const out = await s.post('/v1/app/api-keys', { name: `e2e-${Date.now()}` });
  state.set(`apikey:${s.index}`, out.key);
  return out.key;
}
export { pub, USDG };
