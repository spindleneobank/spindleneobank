// Shared x402 helpers for x402-client.ts and x402-session.ts (viem only, no Spindle packages).
import {
  type Account,
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  type Hex,
  http,
  maxUint256,
  parseAbi,
} from 'viem';

export const API = process.env.SPINDLE_API_URL ?? 'http://127.0.0.1:7200';
export const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:7245';

export interface Accept {
  scheme: 'exact';
  network: string;
  asset: Address;
  amount: string; // cap = max charge + surcharge, USDG micros
  payTo: Address;
  extra: {
    permit2: Address;
    spender: Address;
    paymentId: Hex;
    surcharge: string;
    validAfter: string;
    deadline: string;
    nonce: string;
  };
}
export interface Challenge {
  x402Version: number;
  accepts: Accept[];
}

export const b64json = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');
export const fromB64json = <T>(s: string): T => JSON.parse(Buffer.from(s, 'base64').toString('utf8')) as T;

/** Reads the 402 challenge from the PAYMENT-REQUIRED header (the body carries the same JSON). */
export async function readChallenge(res: Response): Promise<Accept> {
  if (res.status !== 402) throw new Error(`expected 402, got ${res.status}: ${await res.text()}`);
  const header = res.headers.get('payment-required');
  const challenge = header ? fromB64json<Challenge>(header) : ((await res.json()) as Challenge);
  const accept = challenge.accepts?.[0];
  if (!accept || accept.scheme !== 'exact') throw new Error('no exact scheme in the challenge');
  return accept;
}

const PERMIT2_TYPES = {
  PermitWitnessTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'witness', type: 'SpindlePayment' },
  ],
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  SpindlePayment: [
    { name: 'paymentId', type: 'bytes32' },
    { name: 'surcharge', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
  ],
} as const;

/** The Permit2 typed data for a challenge: you sign a cap, Spindle settles actual usage up to it. */
export function paymentTypedData(a: Accept) {
  const chainId = Number(a.network.split(':')[1]);
  return {
    domain: { name: 'Permit2', chainId, verifyingContract: a.extra.permit2 },
    types: PERMIT2_TYPES,
    primaryType: 'PermitWitnessTransferFrom' as const,
    message: {
      permitted: { token: a.asset, amount: BigInt(a.amount) },
      spender: a.extra.spender,
      nonce: BigInt(a.extra.nonce),
      deadline: BigInt(a.extra.deadline),
      witness: {
        paymentId: a.extra.paymentId,
        surcharge: BigInt(a.extra.surcharge),
        validAfter: BigInt(a.extra.validAfter),
      },
    },
  };
}

/** Signs the witness and returns the X-PAYMENT header value. */
export async function buildPaymentHeader(account: Account, a: Accept): Promise<string> {
  if (!account.signTypedData) throw new Error('account cannot sign typed data');
  const td = paymentTypedData(a);
  const signature = await account.signTypedData(td);
  return b64json({
    x402Version: 2,
    scheme: 'exact',
    network: a.network,
    payload: {
      payer: account.address,
      paymentId: a.extra.paymentId,
      permit: {
        permitted: { token: a.asset, amount: a.amount },
        nonce: a.extra.nonce,
        deadline: a.extra.deadline,
      },
      witness: {
        paymentId: a.extra.paymentId,
        surcharge: a.extra.surcharge,
        validAfter: a.extra.validAfter,
      },
      signature,
    },
  });
}

/** Turns the JSON typed data from POST /v1/x402/sessions (uint256 as strings) into viem input. */
export function reviveTypedData(td: {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}) {
  const revive = (type: string, v: unknown): unknown => {
    const fields = td.types[type];
    if (fields && v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, x]) => {
          const f = fields.find((f) => f.name === k);
          return [k, f ? revive(f.type, x) : x];
        }),
      );
    }
    return /^uint\d*$/.test(type) && typeof v === 'string' ? BigInt(v) : v;
  };
  const domain = { ...td.domain } as Record<string, unknown>;
  if (typeof domain.chainId === 'string') domain.chainId = Number(domain.chainId);
  return { ...td, domain, message: revive(td.primaryType, td.message) } as never;
}

const erc20 = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

/** One-time (per wallet) Permit2 approval of USDG. This is a normal transaction: the buyer pays gas. */
export async function ensurePermit2Allowance(
  account: Account,
  token: Address,
  permit2: Address,
  needed: bigint,
  chainId: number,
): Promise<'approved' | 'already-approved'> {
  const chain = defineChain({
    id: chainId,
    name: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20,
    functionName: 'allowance',
    args: [account.address, permit2],
  });
  if (allowance >= needed) return 'already-approved';
  const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });
  const hash = await wallet.writeContract({
    address: token,
    abi: erc20,
    functionName: 'approve',
    args: [permit2, maxUint256],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return 'approved';
}

export function chatBody(model: string, content: string) {
  return { model, max_tokens: 64, messages: [{ role: 'user', content }] };
}

export async function firstChatModel(): Promise<string> {
  if (process.env.SPINDLE_MODEL) return process.env.SPINDLE_MODEL;
  const { data } = (await (await fetch(`${API}/v1/models`)).json()) as {
    data: { id: string; kind: string; available: boolean }[];
  };
  const m = data.find((x) => x.kind === 'chat' && x.available);
  if (!m) throw new Error('no available chat model (is a node connected?)');
  return m.id;
}
