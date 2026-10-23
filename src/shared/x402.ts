import {
  type Address,
  encodeAbiParameters,
  type Hex,
  keccak256,
  type TypedDataDefinition,
  toBytes,
} from 'viem';
import { z } from 'zod';
import { KNOWN } from './chain';
import { MicrosString } from './money';

export const NETWORK = 'eip155:4663' as const;
export const X402_VERSION = 2 as const;
export const MAX_HEADER_BYTES = 32 * 1024;

export const SPINDLE_PAYMENT_TYPE = 'SpindlePayment(bytes32 paymentId,uint256 surcharge,uint256 validAfter)';
export const SPINDLE_PAYMENT_TYPEHASH = keccak256(toBytes(SPINDLE_PAYMENT_TYPE));

/** Permit2 witness type string, exactly as BuyerVault and contracts-spec.md. */
export const WITNESS_TYPE_STRING =
  'SpindlePayment witness)SpindlePayment(bytes32 paymentId,uint256 surcharge,uint256 validAfter)TokenPermissions(address token,uint256 amount)';

export const PERMIT2_WITNESS_TYPES = {
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
/** Alias used by B10. */
export const SPINDLE_PAYMENT_WITNESS = PERMIT2_WITNESS_TYPES.SpindlePayment;

export interface SpindlePaymentInput {
  chainId: number;
  token: Address;
  /** permitted.amount (micros) */
  cap: bigint;
  /** the BuyerVault */
  spender: Address;
  nonce: bigint;
  deadline: bigint;
  paymentId: Hex;
  surcharge: bigint;
  validAfter: bigint;
  /** defaults to KNOWN.PERMIT2 */
  permit2?: Address;
}

export function spindlePaymentTypedData(i: SpindlePaymentInput) {
  return {
    domain: {
      name: 'Permit2',
      chainId: i.chainId,
      verifyingContract: (i.permit2 ?? KNOWN.PERMIT2) as Address,
    },
    types: PERMIT2_WITNESS_TYPES,
    primaryType: 'PermitWitnessTransferFrom' as const,
    message: {
      permitted: { token: i.token, amount: i.cap },
      spender: i.spender,
      nonce: i.nonce,
      deadline: i.deadline,
      witness: { paymentId: i.paymentId, surcharge: i.surcharge, validAfter: i.validAfter },
    },
  } satisfies TypedDataDefinition<typeof PERMIT2_WITNESS_TYPES, 'PermitWitnessTransferFrom'>;
}
export const permit2TypedData = spindlePaymentTypedData;

/** keccak256(abi.encode(SPINDLE_PAYMENT_TYPEHASH, paymentId, surcharge, validAfter)), as BuyerVault computes it. */
export function witnessHash(w: { paymentId: Hex; surcharge: bigint; validAfter: bigint }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }],
      [SPINDLE_PAYMENT_TYPEHASH, w.paymentId, w.surcharge, w.validAfter],
    ),
  );
}

// ---- wire schemas ------------------------------------------------------------------------------

const AddrStr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const Uint = z.string().regex(/^\d{1,78}$/);

export const X402Challenge = z.object({
  x402Version: z.literal(X402_VERSION),
  resource: z.object({ url: z.string(), description: z.string(), mimeType: z.string() }),
  accepts: z
    .array(
      z.object({
        scheme: z.literal('exact'),
        network: z.literal(NETWORK),
        asset: AddrStr,
        amount: MicrosString,
        payTo: AddrStr,
        maxTimeoutSeconds: z.number().int().positive(),
        extra: z.object({
          assetTransferMethod: z.literal('permit2-witness'),
          permit2: AddrStr,
          spender: AddrStr,
          witnessType: z.string(),
          paymentId: Bytes32,
          surcharge: MicrosString,
          validAfter: Uint,
          deadline: Uint,
          nonce: Uint,
          priceBasis: z.object({
            unitKind: z.string(),
            buyerMicrosPerUnit: MicrosString,
            maxTokens: z.number().int().nonnegative(),
          }),
        }),
      }),
    )
    .min(1),
});
export type X402Challenge = z.infer<typeof X402Challenge>;

export const X402PaymentHeader = z.object({
  x402Version: z.literal(X402_VERSION),
  scheme: z.literal('exact'),
  network: z.literal(NETWORK),
  payload: z.object({
    payer: AddrStr,
    paymentId: Bytes32,
    permit: z.object({
      permitted: z.object({ token: AddrStr, amount: MicrosString }),
      nonce: Uint,
      deadline: Uint,
    }),
    witness: z.object({ paymentId: Bytes32, surcharge: MicrosString, validAfter: Uint }),
    signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  }),
});
export type X402PaymentHeader = z.infer<typeof X402PaymentHeader>;

export const X402PaymentResponse = z.object({
  paymentId: Bytes32,
  used: MicrosString,
  surcharge: MicrosString,
  settlement: z.literal('batched'),
});
export type X402PaymentResponse = z.infer<typeof X402PaymentResponse>;

/** base64(JSON) for the PAYMENT-REQUIRED / X-PAYMENT / X-PAYMENT-RESPONSE headers. */
export function encodeHeader(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function decodeHeader(b64: string | null | undefined): unknown {
  if (!b64 || b64.length > MAX_HEADER_BYTES) throw new Error('Missing or unreadable payment header.');
  try {
    const s = atob(b64);
    const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('Missing or unreadable payment header.');
  }
}
