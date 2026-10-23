// x402 "exact": pay per call with a signed Permit2 cap, no account or API key.
//   PRIVATE_KEY=0x... bun x402-client.ts      (dev: an anvil test key; SPINDLE_API_URL, RPC_URL optional)
import { privateKeyToAccount } from 'viem/accounts';
import {
  API,
  buildPaymentHeader,
  chatBody,
  ensurePermit2Allowance,
  firstChatModel,
  fromB64json,
  readChallenge,
} from './x402-lib.ts';

const pk = process.env.PRIVATE_KEY as `0x${string}` | undefined;
if (!pk)
  throw new Error('set PRIVATE_KEY (a wallet holding USDG and a little ETH for the one-time approval)');
const account = privateKeyToAccount(pk);

try {
  const url = `${API}/v1/chat/completions`;
  const body = JSON.stringify(chatBody(await firstChatModel(), 'Say hello in five words.'));
  const headers = { 'content-type': 'application/json' };

  // 1. No auth: the gateway answers 402 with the price (cap = max charge + surcharge).
  const challengeRes = await fetch(url, { method: 'POST', headers, body });
  const accept = await readChallenge(challengeRes);
  console.log(
    `402 challenge: cap ${accept.amount} micros (surcharge ${accept.extra.surcharge}), pay to ${accept.payTo}`,
  );

  // 2. One-time Permit2 approval of USDG (a normal transaction, you pay gas).
  const chainId = Number(accept.network.split(':')[1]);
  const approval = await ensurePermit2Allowance(
    account,
    accept.asset,
    accept.extra.permit2,
    BigInt(accept.amount),
    chainId,
  );
  console.log('permit2 allowance:', approval);

  // 3. Sign the SpindlePayment witness and retry the same request. You pay actual usage, up to the cap.
  const xPayment = await buildPaymentHeader(account, accept);
  const res = await fetch(url, { method: 'POST', headers: { ...headers, 'x-payment': xPayment }, body });
  if (!res.ok) throw new Error(`paid retry failed: ${res.status} ${await res.text()}`);
  const out = (await res.json()) as {
    choices: { message: { content: string } }[];
    spindle: { jobId: string };
  };
  console.log(out.choices[0]?.message.content);

  const paid = res.headers.get('x-payment-response');
  if (!paid) throw new Error('missing X-PAYMENT-RESPONSE');
  const settlement = fromB64json<{ used: string; surcharge: string; settlement: string }>(paid);
  console.log('X-PAYMENT-RESPONSE', settlement, 'receipt', res.headers.get('x-spindle-receipt'));
  console.log(
    `PASS x402-client.ts (job ${out.spindle.jobId}, used ${settlement.used} micros, settled in batch later)`,
  );
} catch (err) {
  console.error('FAIL x402-client.ts:', err instanceof Error ? err.message : err);
  process.exit(1);
}
