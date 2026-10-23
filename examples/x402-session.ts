// x402 session: sign ONE cap ($1), make many calls with X-Spindle-Session, close, wait for settlement.
// Spindle settles actual usage up to your signed cap. Needs PRIVATE_KEY (USDG holder).
//   PRIVATE_KEY=0x... bun x402-session.ts      WAIT_SETTLED=1 polls until the keeper settles (default: 0)
import { privateKeyToAccount } from 'viem/accounts';
import { API, chatBody, ensurePermit2Allowance, firstChatModel, reviveTypedData } from './x402-lib.ts';

const pk = process.env.PRIVATE_KEY as `0x${string}` | undefined;
if (!pk) throw new Error('set PRIVATE_KEY');
const account = privateKeyToAccount(pk);
const json = { 'content-type': 'application/json' };

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

try {
  // 1. Create the session; the response carries the Permit2 typed data to sign.
  const created = await call<{
    sessionId: string;
    typedData: Parameters<typeof reviveTypedData>[0];
    surchargeMicros: string;
  }>('/v1/x402/sessions', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ payer: account.address.toLowerCase(), capMicros: '1000000', ttlSec: 600 }),
  });
  const msg = created.typedData.message as { permitted: { token: `0x${string}`; amount: string } };
  const permit2 = created.typedData.domain.verifyingContract as `0x${string}`;
  const chainId = Number(created.typedData.domain.chainId);
  console.log('session', created.sessionId, 'surcharge', created.surchargeMicros);

  // 2. One-time Permit2 approval, then sign and open.
  console.log(
    'permit2 allowance:',
    await ensurePermit2Allowance(
      account,
      msg.permitted.token,
      permit2,
      BigInt(msg.permitted.amount),
      chainId,
    ),
  );
  const signature = await account.signTypedData(reviveTypedData(created.typedData));
  const opened = await call<{ sessionToken: string; spendableMicros: string }>(
    `/v1/x402/sessions/${created.sessionId}/open`,
    {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ signature }),
    },
  );
  console.log('open, spendable', opened.spendableMicros, 'micros');
  const auth = { ...json, 'x-spindle-session': opened.sessionToken };

  // 3. Three calls on the same session.
  const model = await firstChatModel();
  for (const n of [1, 2, 3]) {
    const res = await call<{
      choices: { message: { content: string } }[];
      spindle: { jobId: string; chargeMicros: string };
    }>('/v1/chat/completions', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(chatBody(model, `Say the number ${n} in words.`)),
    });
    console.log(`call ${n}:`, res.choices[0]?.message.content?.trim(), '| charge', res.spindle.chargeMicros);
  }

  // 4. Close; settlement happens in the next batch (every 10 min or 20 closing payments).
  const closed = await call<{ status: string }>(`/v1/x402/sessions/${created.sessionId}/close`, {
    method: 'POST',
    headers: auth,
  });
  let status = await call<{ status: string; usedMicros: string }>(`/v1/x402/sessions/${created.sessionId}`, {
    headers: auth,
  });
  console.log('closed ->', closed.status, '| used', status.usedMicros);
  if (process.env.WAIT_SETTLED === '1') {
    const deadline = Date.now() + 15 * 60_000;
    while (status.status !== 'settled' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10_000));
      status = await call(`/v1/x402/sessions/${created.sessionId}`, { headers: auth });
      console.log('status', status.status);
    }
    if (status.status !== 'settled') throw new Error(`not settled, status ${status.status}`);
  }
  console.log(`PASS x402-session.ts (session ${created.sessionId}, status ${status.status})`);
} catch (err) {
  console.error('FAIL x402-session.ts:', err instanceof Error ? err.message : err);
  process.exit(1);
}
