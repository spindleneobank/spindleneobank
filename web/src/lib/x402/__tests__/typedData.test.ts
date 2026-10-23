import { spindlePaymentTypedData } from '@spindle/shared/x402';
import { describe, expect, it } from 'vitest';
import { TypedDataMismatch, validateSessionTypedData } from '../typedData';

const NOW = 1_800_000_000;
const sessionId = `0x${'ab'.repeat(32)}` as const;
const exp = {
  chainId: 4663,
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  token: '0x0000000000000000000000000000000000000001',
  spender: '0x0000000000000000000000000000000000000005',
  capMicros: 1_000_000n,
  sessionId,
  surchargeMicros: 30_000n,
  nowSec: NOW,
} as const;

function serverData() {
  const td = spindlePaymentTypedData({
    chainId: exp.chainId,
    token: exp.token,
    cap: exp.capMicros,
    spender: exp.spender,
    nonce: 7n,
    deadline: BigInt(NOW + 7200),
    paymentId: sessionId,
    surcharge: exp.surchargeMicros,
    validAfter: BigInt(NOW - 60),
    permit2: exp.permit2,
  });
  return JSON.parse(JSON.stringify(td, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

const mismatch = (mutate: (td: ReturnType<typeof serverData>) => void, field: string) => {
  const td = serverData();
  mutate(td);
  try {
    validateSessionTypedData(td, exp);
    expect.unreachable('should have thrown');
  } catch (e) {
    expect(e).toBeInstanceOf(TypedDataMismatch);
    expect((e as TypedDataMismatch).field).toBe(field);
  }
};

describe('validateSessionTypedData', () => {
  it('accepts the honest payload and returns bigint typed data', () => {
    const out = validateSessionTypedData(serverData(), exp);
    expect(out.message.permitted.amount).toBe(1_000_000n);
    expect(out.message.nonce).toBe(7n);
    expect(out.domain.name).toBe('Permit2');
  });
  it('rejects a different chain', () =>
    mismatch((t) => {
      t.domain.chainId = 1;
    }, 'domain'));
  it('rejects a different verifyingContract', () =>
    mismatch((t) => {
      t.domain.verifyingContract = '0x0000000000000000000000000000000000000009';
    }, 'domain'));
  it('rejects a different spender', () =>
    mismatch((t) => {
      t.message.spender = '0x0000000000000000000000000000000000000009';
    }, 'spender'));
  it('rejects a different token', () =>
    mismatch((t) => {
      t.message.permitted.token = '0x0000000000000000000000000000000000000009';
    }, 'token'));
  it('rejects an inflated amount', () =>
    mismatch((t) => {
      t.message.permitted.amount = '5000000';
    }, 'amount'));
  it('rejects a changed witness type', () =>
    mismatch((t) => {
      t.types.SpindlePayment[1].type = 'uint128';
    }, 'types'));
  it('rejects an extra witness field', () =>
    mismatch((t) => {
      t.types.SpindlePayment.push({ name: 'to', type: 'address' });
    }, 'types'));
  it('rejects a different primaryType', () =>
    mismatch((t) => {
      t.primaryType = 'PermitTransferFrom';
    }, 'primaryType'));
  it('rejects a paymentId that is not the session id', () =>
    mismatch((t) => {
      t.message.witness.paymentId = `0x${'cd'.repeat(32)}`;
    }, 'paymentId'));
  it('rejects a surcharge different from the reported one', () =>
    mismatch((t) => {
      t.message.witness.surcharge = '900000';
    }, 'surcharge'));
  it('rejects an expired deadline', () =>
    mismatch((t) => {
      t.message.deadline = String(NOW - 1);
    }, 'deadline'));
});
