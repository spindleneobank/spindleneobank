import { join } from 'node:path';
import { buyerVaultAbi } from '@spindle/shared/abi';
import { privateKey } from '../../dev/lib/accounts';
import { runJob } from '../lib/api';
import { head, pub, sleep, syncTime, until, usdgOf } from '../lib/chain';
import { addr, REPO } from '../lib/env';
import { admin } from '../lib/fixtures';
import { assert, eq, type Scenario } from '../lib/harness';
import { run } from '../lib/proc';
import { ensureNodeA } from './s01';

export async function settleAndRead(
  c: { step: (m: string) => void; ev: (n: string, d: unknown) => void },
  fromBlock: bigint,
) {
  const a = await admin();
  const vault = addr('VAULT_ADDRESS');
  // wait until the batch has produced Settled events
  const logs = await until(
    async () => {
      await runJob(a, 'x402-settle');
      await sleep(4000);
      const l = await pub.getContractEvents({
        address: vault,
        abi: buyerVaultAbi,
        eventName: 'Settled',
        fromBlock,
        toBlock: 'latest',
      });
      return l.length ? l : undefined;
    },
    120_000,
    1000,
  );
  return logs;
}

export const s04: Scenario = {
  n: 4,
  name: 'x402 exact',
  async run(c) {
    await ensureNodeA(c);
    await syncTime();
    const payer = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc'.toLowerCase(); // account 5
    const from = BigInt(await head());
    const env = {
      ...process.env,
      PRIVATE_KEY: privateKey(5),
      SPINDLE_API_URL: 'http://127.0.0.1:7200',
      RPC_URL: 'http://127.0.0.1:7245',
    };
    const out = await run(['bun', 'x402-client.ts'], { cwd: join(REPO, 'examples'), env });
    c.ev('x402-client', { ...out, stdout: out.stdout.replace(/0x[0-9a-fA-F]{64}(?=\b)/g, (m) => m) });
    eq(out.code, 0, `x402-client.ts exit (${out.stderr.slice(0, 200)})`);
    const used = BigInt(/used (\d+) micros/.exec(out.stdout)?.[1] ?? '0');
    c.step(`paid call done, used ${used}`);
    assert(used > 0n, 'used > 0');

    const claims = addr('CLAIMS_ADDRESS');
    const treasury = addr('TREASURY_ADDRESS');
    const bal = async (blk: bigint) => ({
      claims: (await pub.readContract({
        address: addr('USDG_ADDRESS'),
        abi: (await import('@spindle/shared/abi')).erc20Abi,
        functionName: 'balanceOf',
        args: [claims],
        blockNumber: blk,
      })) as bigint,
      treasury: (await pub.readContract({
        address: addr('USDG_ADDRESS'),
        abi: (await import('@spindle/shared/abi')).erc20Abi,
        functionName: 'balanceOf',
        args: [treasury],
        blockNumber: blk,
      })) as bigint,
    });
    const logs = await settleAndRead(c, from);
    const mine = logs.filter((l) => (l.args.payer as string).toLowerCase() === payer);
    assert(mine.length >= 1, 'Settled event for payer');
    const ev = mine[mine.length - 1] as (typeof logs)[number];
    const blk = ev.blockNumber as bigint;
    const before = await bal(blk - 1n);
    const after = await bal(blk);
    // all Settled events in that same tx
    const sameTx = logs.filter((l) => l.transactionHash === ev.transactionHash);
    const sumUsed = sameTx.reduce((x, l) => x + (l.args.used as bigint), 0n);
    const sumSur = sameTx.reduce((x, l) => x + (l.args.surcharge as bigint), 0n);
    c.ev('settled', {
      tx: ev.transactionHash,
      block: blk.toString(),
      items: sameTx.map((l) => ({
        payer: l.args.payer,
        used: String(l.args.used),
        surcharge: String(l.args.surcharge),
      })),
      before: { claims: String(before.claims), treasury: String(before.treasury) },
      after: { claims: String(after.claims), treasury: String(after.treasury) },
    });
    const expClaims = (sumUsed * 8000n) / 10000n;
    const expTreasury = sumUsed - expClaims + sumSur;
    eq(after.claims - before.claims, expClaims, 'claims +80% of used');
    eq(after.treasury - before.treasury, expTreasury, 'treasury +20% of used + surcharge');
    assert(
      (ev.args.used as bigint) === used,
      `Settled.used equals X-PAYMENT-RESPONSE used (${ev.args.used} vs ${used})`,
    );
    c.step(
      `Settled tx ${ev.transactionHash}: used ${sumUsed}, claims +${expClaims}, treasury +${expTreasury}`,
    );
    void usdgOf;
  },
};
