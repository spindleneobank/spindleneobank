import { describe, expect, test } from 'bun:test';
import { keccak256, toBytes, verifyTypedData } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { KNOWN } from './chain';
import {
  decodeHeader,
  encodeHeader,
  NETWORK,
  SPINDLE_PAYMENT_TYPEHASH,
  spindlePaymentTypedData,
  WITNESS_TYPE_STRING,
  witnessHash,
  X402Challenge,
  X402PaymentHeader,
} from './x402';

const paymentId = `0x${'ab'.repeat(32)}` as const;
const vault = '0x00000000000000000000000000000000000000aa' as const;

describe('x402', () => {
  test('typed data signs and recovers', async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const td = spindlePaymentTypedData({
      chainId: 4663,
      token: KNOWN.USDG,
      cap: 1_000_000n,
      spender: vault,
      nonce: 12345n,
      deadline: 2_000_000_000n,
      paymentId,
      surcharge: 5000n,
      validAfter: 0n,
    });
    const signature = await acct.signTypedData(td);
    expect(await verifyTypedData({ ...td, address: acct.address, signature })).toBe(true);
    expect(await verifyTypedData({ ...td, address: vault, signature })).toBe(false);
  });
  test('witness type string / typehash', () => {
    expect(WITNESS_TYPE_STRING).toBe(
      'SpindlePayment witness)SpindlePayment(bytes32 paymentId,uint256 surcharge,uint256 validAfter)TokenPermissions(address token,uint256 amount)',
    );
    expect(SPINDLE_PAYMENT_TYPEHASH).toBe(
      keccak256(toBytes('SpindlePayment(bytes32 paymentId,uint256 surcharge,uint256 validAfter)')),
    );
    expect(witnessHash({ paymentId, surcharge: 1n, validAfter: 2n })).toMatch(/^0x[0-9a-f]{64}$/);
  });
  test('header round trip + limits', () => {
    const o = { a: 1, s: 'héllo' };
    expect(decodeHeader(encodeHeader(o))).toEqual(o);
    expect(() => decodeHeader('x'.repeat(32 * 1024 + 1))).toThrow();
    expect(() => decodeHeader(null)).toThrow();
    expect(() => decodeHeader('%%%')).toThrow();
  });
  test('schemas', () => {
    const usdg = KNOWN.USDG;
    const c = {
      x402Version: 2,
      resource: { url: 'https://api/x', description: 'd', mimeType: 'application/json' },
      accepts: [
        {
          scheme: 'exact',
          network: NETWORK,
          asset: usdg,
          amount: '1005000',
          payTo: vault,
          maxTimeoutSeconds: 300,
          extra: {
            assetTransferMethod: 'permit2-witness',
            permit2: KNOWN.PERMIT2,
            spender: vault,
            witnessType: 'SpindlePayment(bytes32 paymentId,uint256 surcharge,uint256 validAfter)',
            paymentId,
            surcharge: '5000',
            validAfter: '0',
            deadline: '2000000000',
            nonce: '1',
            priceBasis: { unitKind: 'tokens_1m', buyerMicrosPerUnit: '100000', maxTokens: 1024 },
          },
        },
      ],
    };
    expect(X402Challenge.safeParse(c).success).toBe(true);
    const h = {
      x402Version: 2,
      scheme: 'exact',
      network: NETWORK,
      payload: {
        payer: vault,
        paymentId,
        permit: { permitted: { token: usdg, amount: '1005000' }, nonce: '1', deadline: '2000000000' },
        witness: { paymentId, surcharge: '5000', validAfter: '0' },
        signature: '0x12',
      },
    };
    expect(X402PaymentHeader.safeParse(h).success).toBe(true);
    expect(X402PaymentHeader.safeParse({ ...h, network: 'eip155:1' }).success).toBe(false);
  });
});
