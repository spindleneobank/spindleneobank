import { buyerVaultAbi } from '@spindle/shared/abi';
import { account } from '../../dev/lib/accounts';
import { ensurePermit2Allowance, reviveTypedData } from '../../examples/x402-lib.ts';
import { runJob } from '../lib/api';
import { head, pub, sleep, syncTime, until } from '../lib/chain';
import { API, addr } from '../lib/env';
import { admin } from '../lib/fixtures';
import { assert, eq, type Scenario } from '../lib/harness';
import { ensureNodeA } from './s01';

const json = { 'content-type': 'application/json' };
async function call<T = any>(
  path: string,
  init: RequestInit & { retry?: boolean } = {},
): Promise<{ body: T; res: Response }> {
  const end = Date.now() + 120_000;
  for (;;) {
    const res = await fetch(`${API}${path}`, init);
    if (res.status === 503 && Date.now() < end) {
      await sleep(3000);
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    return { body: JSON.parse(text) as T, res };
  }
}

/** One signature -> `msgs` chat messages -> close. Returns session id and the per-call charges. Shared with the browser flow check. */
export async function sessionChat(accIndex: number, msgs: string[], c: { step: (m: string) => void }) {
  const acct = account(accIndex);
  const created = (
    await call('/v1/x402/sessions', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ payer: acct.address.toLowerCase(), capMicros: '1000000', ttlSec: 600 }),
    })
  ).body;
  const msg = created.typedData.message as { permitted: { token: `0x${string}`; amount: string } };
  await ensurePermit2Allowance(
    acct,
    msg.permitted.token,
    created.typedData.domain.verifyingContract,
    BigInt(msg.permitted.amount),
    Number(created.typedData.domain.chainId),
  );
  const signature = await acct.signTypedData(reviveTypedData(created.typedData));
  const opened = (
    await call(`/v1/x402/sessions/${created.sessionId}/open`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ signature }),
    })
  ).body;
  c.step(`session ${created.sessionId} opened (one signature)`);
  const auth = { ...json, 'x-spindle-session': opened.sessionToken };
  const charges: bigint[] = [];
  for (const m of msgs) {
    const r = (
      await call('/v1/chat/completions', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          model: 'qwen2.5:0.5b',
          max_tokens: 24,
          messages: [{ role: 'user', content: m }],
        }),
      })
    ).body;
    charges.push(BigInt(r.spindle.chargeMicros));
  }
  const closed = (
    await call(`/v1/x402/sessions/${created.sessionId}/close`, { method: 'POST', headers: auth })
  ).body;
  const st = (await call(`/v1/x402/sessions/${created.sessionId}`, { headers: auth })).body;
  return { sessionId: created.sessionId as string, auth, charges, closed, used: BigInt(st.usedMicros) };
}

export const s05: Scenario = {
  n: 5,
  name: 'x402 session chat',
  async run(c) {
    await ensureNodeA(c);
    await syncTime();
    const from = BigInt(await head());
    const s = await sessionChat(6, ['Say one in words.', 'Say two in words.', 'Say three in words.'], c);
    c.ev('session', { ...s, charges: s.charges.map(String), used: String(s.used), auth: undefined });
    const sum = s.charges.reduce((a, b) => a + b, 0n);
    // the last job's accounting runs after its response is on the wire: allow it to land before comparing
    let used = s.used;
    for (let i = 0; i < 10 && used !== sum; i++) {
      await sleep(1000);
      used = BigInt((await call(`/v1/x402/sessions/${s.sessionId}`, { headers: s.auth })).body.usedMicros);
    }
    if (used !== s.used)
      c.note(`usedMicros was ${s.used} right after close, ${used} after settling time (accounting lag)`);
    eq(used, sum, 'session usedMicros equals sum of per-call charges');
    const a = await admin();
    const payer = account(6).address.toLowerCase();
    const logs = await until(
      async () => {
        await runJob(a, 'x402-settle');
        await sleep(4000);
        const l = await pub.getContractEvents({
          address: addr('VAULT_ADDRESS'),
          abi: buyerVaultAbi,
          eventName: 'Settled',
          fromBlock: from,
          toBlock: 'latest',
        });
        const mine = l.filter((x) => (x.args.payer as string).toLowerCase() === payer);
        return mine.length ? mine : undefined;
      },
      120_000,
      1000,
    );
    eq(logs.length, 1, 'exactly one Settled for the session');
    const ev = logs[0] as (typeof logs)[number];
    eq(ev.args.used as bigint, sum, 'Settled.used equals the sum of charges');
    c.ev('settled', {
      tx: ev.transactionHash,
      used: String(ev.args.used),
      surcharge: String(ev.args.surcharge),
    });
    c.step(`one Settled ${ev.transactionHash} used ${ev.args.used} = sum ${sum}`);
    assert(true, '');
  },
};
