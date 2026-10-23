// Offline checks: request shaping, 402 parsing, signing and receipt/Merkle verification against fixtures.
import { expect, test } from 'bun:test';
import { recoverTypedDataAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { buildTree } from '../src/shared/merkle.ts';
import { receiptToBase64, signReceipt } from '../src/shared/receipt.ts';
import { spindlePaymentTypedData } from '../src/shared/x402.ts';
import { checkEpochTree, checkReceipt, nodePublicKeyFor, type ReceiptView } from './receipt-lib.ts';
import {
  type Accept,
  b64json,
  buildPaymentHeader,
  paymentTypedData,
  readChallenge,
  reviveTypedData,
} from './x402-lib.ts';

const USDG = '0x1111111111111111111111111111111111111111';
const VAULT = '0x2222222222222222222222222222222222222222';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const accept: Accept = {
  scheme: 'exact',
  network: 'eip155:4663',
  asset: USDG,
  amount: '25000',
  payTo: VAULT,
  extra: {
    permit2: PERMIT2,
    spender: VAULT,
    paymentId: `0x${'ab'.repeat(32)}`,
    surcharge: '5000',
    validAfter: '1700000000',
    deadline: '1900000000',
    nonce: '123456789',
  },
};
const challenge = {
  x402Version: 2,
  resource: { url: 'x', description: 'x', mimeType: 'application/json' },
  accepts: [accept],
};

test('parses a 402 challenge from the PAYMENT-REQUIRED header and from the body', async () => {
  const viaHeader = new Response('{}', { status: 402, headers: { 'payment-required': b64json(challenge) } });
  expect((await readChallenge(viaHeader)).amount).toBe('25000');
  const viaBody = new Response(JSON.stringify(challenge), { status: 402 });
  expect((await readChallenge(viaBody)).extra.paymentId).toBe(accept.extra.paymentId);
  expect(readChallenge(new Response('no', { status: 500 }))).rejects.toThrow('expected 402');
});

test('typed data matches the shared Spindle helper and the signature recovers the payer', async () => {
  const shared = spindlePaymentTypedData({
    chainId: 4663,
    token: USDG,
    cap: 25000n,
    spender: VAULT,
    nonce: 123456789n,
    deadline: 1900000000n,
    paymentId: accept.extra.paymentId,
    surcharge: 5000n,
    validAfter: 1700000000n,
  });
  const td = paymentTypedData(accept);
  expect(td.domain.chainId).toBe(shared.domain.chainId);
  expect(td.domain.verifyingContract.toLowerCase()).toBe(shared.domain.verifyingContract.toLowerCase());
  expect(td.types).toEqual(shared.types);
  expect(td.message).toEqual(shared.message);

  const account = privateKeyToAccount(generatePrivateKey());
  const header = JSON.parse(Buffer.from(await buildPaymentHeader(account, accept), 'base64').toString());
  expect(header.x402Version).toBe(2);
  expect(header.payload.payer).toBe(account.address);
  expect(header.payload.witness.surcharge).toBe('5000');
  const recovered = await recoverTypedDataAddress({ ...td, signature: header.payload.signature });
  expect(recovered).toBe(account.address);
});

test('session typed data with decimal strings is revived into bigint fields', () => {
  const td = spindlePaymentTypedData({
    chainId: 4663,
    token: USDG,
    cap: 1000000n,
    spender: VAULT,
    nonce: 7n,
    deadline: 99n,
    paymentId: accept.extra.paymentId,
    surcharge: 5000n,
    validAfter: 1n,
  });
  const wire = JSON.parse(JSON.stringify(td, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
  const revived = reviveTypedData(wire) as unknown as typeof td;
  expect(revived.message.permitted.amount).toBe(1000000n);
  expect(revived.message.witness.validAfter).toBe(1n);
  expect(revived.message.nonce).toBe(7n);
});

function fixture() {
  const nodePk = generatePrivateKey();
  const owner = privateKeyToAccount(generatePrivateKey()).address;
  const other = privateKeyToAccount(generatePrivateKey()).address;
  const nodeKey = privateKeyToAccount(nodePk).address.toLowerCase();
  const jobId = '0b7e0f3e-8c8a-4a55-9d0c-0d5d2c9c1111';
  const cose = signReceipt(
    {
      v: 1,
      jobId,
      nodeKey,
      model: 'test-model',
      modelDigest: 'sha256:abc',
      kind: 'chat',
      lane: 'open',
      usage: { p: 10, c: 20 },
      inputDigest: 'aa'.repeat(32),
      outputDigest: 'bb'.repeat(32),
      startedAt: 1,
      finishedAt: 2,
      agentVersion: '0.0.0',
    },
    nodePk,
  );
  const view: ReceiptView = {
    jobId,
    nodeKey,
    model: 'test-model',
    lane: 'open',
    usage: { p: 10, c: 20 },
    cose: receiptToBase64(cose),
    verified: true,
    epoch: 1,
  };
  const tree = buildTree([
    { owner, cumulative: 4_000_000n },
    { owner: other, cumulative: 9n },
  ]);
  return { view, cose, tree, owner, other };
}

test('verifies a COSE receipt with a recovered node key and with the explicit key', () => {
  const { view, cose } = fixture();
  const pub = nodePublicKeyFor(cose);
  expect(checkReceipt(view).signatureValid).toBe(true);
  expect(checkReceipt(view, pub).payloadMatchesView).toBe(true);
});

test('rejects a tampered receipt and a view that disagrees with the signed payload', () => {
  const { view } = fixture();
  expect(checkReceipt({ ...view, usage: { p: 10, c: 21 } }).payloadMatchesView).toBe(false);
  const bytes = Buffer.from(view.cose, 'base64');
  bytes[bytes.length - 3] = (bytes[bytes.length - 3] ?? 0) ^ 1;
  expect(checkReceipt({ ...view, cose: bytes.toString('base64') }).signatureValid).toBe(false);
});

test('verifies the owner leaf against the epoch tree root', () => {
  const { tree, owner, other } = fixture();
  const dump = tree.dump();
  const r = checkEpochTree(dump, owner);
  expect(r.ownerProofValid).toBe(true);
  expect(r.cumulativeMicros).toBe('4000000');
  expect(r.root).toBe(tree.root);
  expect(checkEpochTree(dump, other).cumulativeMicros).toBe('9');
  expect(checkEpochTree(dump, '0x0000000000000000000000000000000000000001').ownerProofValid).toBe(false);
});
