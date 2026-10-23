import { PERMIT2_WITNESS_TYPES, spindlePaymentTypedData, WITNESS_TYPE_STRING } from '@spindle/shared/x402';
import type { Address, Hex } from 'viem';
import { z } from 'zod';

export { WITNESS_TYPE_STRING };

/** What the dashboard expects before it lets the wallet sign. Everything comes from env / the user's choice. */
export interface SessionExpectation {
  chainId: number;
  permit2: Address;
  token: Address;
  spender: Address;
  /** requested cap in micros */
  capMicros: bigint;
  /** the session id returned by POST /v1/x402/sessions (= the Permit2 witness paymentId) */
  sessionId: string;
  /** surchargeMicros returned next to the typed data */
  surchargeMicros: bigint;
  nowSec?: number;
}

export class TypedDataMismatch extends Error {
  constructor(readonly field: string) {
    super(`Refusing to sign: the server's payment request does not match (${field}).`);
    this.name = 'TypedDataMismatch';
  }
}

const Uint = z
  .union([z.string().regex(/^\d{1,78}$/), z.number().int().nonnegative(), z.bigint()])
  .transform(BigInt);
const Addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const Message = z.object({
  permitted: z.object({ token: Addr, amount: Uint }),
  spender: Addr,
  nonce: Uint,
  deadline: Uint,
  witness: z.object({ paymentId: Bytes32, surcharge: Uint, validAfter: Uint }),
});
const Domain = z.object({
  name: z.string(),
  chainId: z.union([z.number(), z.string()]),
  verifyingContract: Addr,
});

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const stable = (v: unknown) => JSON.stringify(v);

/**
 * Validates the server-supplied Permit2 typed data against what we expect, then returns typed data REBUILT
 * from our own constants (`spindlePaymentTypedData`) plus the server's nonce/deadline/ids. The wallet only
 * ever signs the rebuilt object. Throws `TypedDataMismatch` on any difference.
 */
export function validateSessionTypedData(
  server: { domain: unknown; types: unknown; primaryType: string; message: unknown },
  exp: SessionExpectation,
) {
  if (server.primaryType !== 'PermitWitnessTransferFrom') throw new TypedDataMismatch('primaryType');
  // Exact witness type: struct layout plus the Permit2 witness type string derived from it.
  if (stable(server.types) !== stable(PERMIT2_WITNESS_TYPES)) throw new TypedDataMismatch('types');
  const w = PERMIT2_WITNESS_TYPES.SpindlePayment.map((f) => `${f.type} ${f.name}`).join(',');
  const tp = PERMIT2_WITNESS_TYPES.TokenPermissions.map((f) => `${f.type} ${f.name}`).join(',');
  if (WITNESS_TYPE_STRING !== `SpindlePayment witness)SpindlePayment(${w})TokenPermissions(${tp})`) {
    throw new TypedDataMismatch('witnessTypeString');
  }
  const d = Domain.safeParse(server.domain);
  if (!d.success) throw new TypedDataMismatch('domain');
  if (
    d.data.name !== 'Permit2' ||
    Number(d.data.chainId) !== exp.chainId ||
    !same(d.data.verifyingContract, exp.permit2)
  ) {
    throw new TypedDataMismatch('domain');
  }
  const m = Message.safeParse(server.message);
  if (!m.success) throw new TypedDataMismatch('message');
  const msg = m.data;
  if (!same(msg.permitted.token, exp.token)) throw new TypedDataMismatch('token');
  if (msg.permitted.amount !== exp.capMicros) throw new TypedDataMismatch('amount');
  if (!same(msg.spender, exp.spender)) throw new TypedDataMismatch('spender');
  if (!same(msg.witness.paymentId, exp.sessionId)) throw new TypedDataMismatch('paymentId');
  if (msg.witness.surcharge !== exp.surchargeMicros) throw new TypedDataMismatch('surcharge');
  const now = BigInt(exp.nowSec ?? Math.floor(Date.now() / 1000));
  if (msg.deadline <= now) throw new TypedDataMismatch('deadline');
  if (msg.witness.validAfter > now + 60n) throw new TypedDataMismatch('validAfter');
  return spindlePaymentTypedData({
    chainId: exp.chainId,
    token: exp.token,
    cap: exp.capMicros,
    spender: exp.spender,
    nonce: msg.nonce,
    deadline: msg.deadline,
    paymentId: msg.witness.paymentId as Hex,
    surcharge: msg.witness.surcharge,
    validAfter: msg.witness.validAfter,
    permit2: exp.permit2,
  });
}
