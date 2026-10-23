import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, type TransactionReceipt } from 'viem';
import { cardOperations, relayOrders } from '../../db/schema';
import { closeQueues } from '../../lib/queue';
import { closeRedis } from '../../lib/redis';
import { dbRef } from '../auth/constants';
import { provider } from '../cards/provider';
import { processOneEvent, submitOne } from '../cards/reconcile';
import { invoiceOf } from '../cards/service';
import { cardSettings } from '../cards/settings';
import { bootCards, type Kit } from '../cards/testkit';
import { quote, relayDeps } from './client';
import { chainDeps, createRelayQuote, markSubmitted, pollRelayOrders } from './orders';
import { stubAbi } from './stub';

const STUB = '0x11dc91d71c05d82f0232493d814a6af41a229b4c';
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
let seq = 0;
let REQ = `0x${'ab'.repeat(32)}`;
let kit: Kit;
const realFetch = relayDeps.fetch;
const realChain = { ...chainDeps };
let relayCalls: { path: string; body: any }[] = [];
let relayReply: (path: string) => { status: number; body: unknown } = () => ({
  status: 200,
  body: relayQuoteBody(),
});
let statusReply = 'success';

function relayQuoteBody(amountIn = '10715531') {
  seq += 1;
  REQ = `0x${seq.toString(16).padStart(64, '0')}`;
  return {
    requestId: REQ,
    steps: [
      {
        id: 'approve',
        kind: 'transaction',
        items: [{ data: { to: USDG, data: '0xaaaa', value: '0', chainId: 4663 } }],
      },
      {
        id: 'deposit',
        kind: 'transaction',
        items: [
          {
            data: {
              to: '0x4cD00E387622C35bDDB9b4C962C136462338BC31',
              data: '0xbbbb',
              value: '0',
              chainId: 4663,
            },
            check: { endpoint: `/intents/status/v3?requestId=${REQ}` },
          },
        ],
      },
    ],
    fees: { gas: { amountUsd: '0.005466' }, relayer: { amountUsd: '0.725147' } },
    details: {
      currencyIn: { amount: amountIn, currency: { address: USDG } },
      currencyOut: { amount: '10000000' },
      timeEstimate: 4,
    },
  };
}

beforeAll(async () => {
  kit = await bootCards();
  relayDeps.fetch = (async (url: string, init?: RequestInit) => {
    const path = url.replace(cardSettings.relayApiUrl, '');
    relayCalls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (path.startsWith('/intents/status')) return Response.json({ status: statusReply });
    const r = relayReply(path);
    return Response.json(r.body, { status: r.status });
  }) as typeof relayDeps.fetch;
  Object.assign(cardSettings, { relayStubAddress: STUB, usdgAddress: USDG, originChainId: 4663 });
});
afterAll(async () => {
  relayDeps.fetch = realFetch;
  Object.assign(chainDeps, realChain);
  await kit.stop();
  await closeQueues().catch(() => {});
  await closeRedis();
});
afterEach(async () => {
  relayCalls = [];
  relayReply = () => ({ status: 200, body: relayQuoteBody() });
  statusReply = 'success';
  Object.assign(chainDeps, realChain);
  Object.assign(cardSettings, { relayMode: 'live' });
  await dbRef.db.update(cardOperations).set({ status: 'failed' }).where(eq(cardOperations.status, 'created'));
});

async function waitingIssue() {
  const addr = kit.newUser();
  const u = await kit.as(addr);
  const { operation } = (await (
    await u.call('POST', '/v1/app/cards', { product: 'mastercard', email: 'r@example.com' })
  ).json()) as any;
  await submitOne();
  const [op] = await dbRef.db.select().from(cardOperations).where(eq(cardOperations.id, operation.id));
  return { u, addr, opId: operation.id as string, inv: invoiceOf(op as never) };
}

describe('relay client', () => {
  test('uses /quote/v2 first and falls back to /quote on 404', async () => {
    relayReply = (path) =>
      path === '/quote/v2'
        ? { status: 404, body: { message: 'nope' } }
        : { status: 200, body: relayQuoteBody() };
    const out = await quote({
      user: '0x1',
      recipient: 'x',
      originChainId: 4663,
      originCurrency: USDG,
      destinationChainId: 56,
      destinationCurrency: '0x55',
      amount: '1',
    });
    expect(out.endpoint).toBe('v1');
    expect(relayCalls.map((c) => c.path)).toEqual(['/quote/v2', '/quote']);
  });

  test('maps liquidity and recipient errors, and does not retry them on /quote', async () => {
    relayReply = () => ({ status: 400, body: { errorCode: 'INSUFFICIENT_LIQUIDITY', message: 'x' } });
    await expect(
      quote({
        user: '0x1',
        recipient: 'x',
        originChainId: 4663,
        originCurrency: USDG,
        destinationChainId: 56,
        destinationCurrency: '0x55',
        amount: '1',
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_LIQUIDITY' });
    expect(relayCalls).toHaveLength(1);
    relayReply = () => ({ status: 400, body: { errorCode: 'INVALID_RECIPIENT', message: 'x' } });
    await expect(
      quote({
        user: '0x1',
        recipient: 'x',
        originChainId: 4663,
        originCurrency: USDG,
        destinationChainId: 56,
        destinationCurrency: '0x55',
        amount: '1',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  test('5xx and bad shapes -> UPSTREAM_UNAVAILABLE', async () => {
    relayReply = () => ({ status: 500, body: {} });
    await expect(
      quote({
        user: '0x1',
        recipient: 'x',
        originChainId: 4663,
        originCurrency: USDG,
        destinationChainId: 56,
        destinationCurrency: '0x55',
        amount: '1',
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    relayReply = () => ({ status: 200, body: { nope: true } });
    await expect(
      quote({
        user: '0x1',
        recipient: 'x',
        originChainId: 4663,
        originCurrency: USDG,
        destinationChainId: 56,
        destinationCurrency: '0x55',
        amount: '1',
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });
});

describe('relay orders', () => {
  test('quote is EXACT_OUTPUT to the invoice address, refundTo = user, destination decimals per chain (BSC 18)', async () => {
    const { u, addr, opId, inv } = await waitingIssue();
    const res = await u.call('POST', `/v1/app/card-operations/${opId}/relay-quote`);
    expect(res.status).toBe(200);
    const q = (await res.json()) as any;
    const sent = relayCalls[0]?.body;
    expect(sent.tradeType).toBe('EXACT_OUTPUT');
    expect(sent.recipient).toBe(inv?.payAddress);
    expect(sent.user).toBe(addr);
    expect(sent.refundTo).toBe(addr);
    expect(sent.destinationChainId).toBe(56);
    expect(sent.destinationCurrency).toBe('0x55d398326f99059ff775485246999027b3197955');
    expect(sent.originCurrency).toBe(USDG);
    expect(sent.amount).toBe((BigInt(Math.round(Number(inv?.payAmount) * 1e6)) * 10n ** 12n).toString());
    expect(q.originAmountMicros).toBe('10715531');
    expect(q.feesUsd).toBe('0.730613');
    expect(q.steps.map((s: any) => s.id)).toEqual(['approve', 'deposit']);
    expect(q.steps[1].items[0].to).toBe('0x4cd00e387622c35bddb9b4c962c136462338bc31');
    const view = (await (await u.call('GET', `/v1/app/card-operations/${opId}`)).json()) as any;
    expect(view.relay.status).toBe('quoted');
    // a second quote supersedes the unsent one
    expect((await u.call('POST', `/v1/app/card-operations/${opId}/relay-quote`)).status).toBe(200);
    const states = (await dbRef.db.select().from(relayOrders).where(eq(relayOrders.cardOperationId, opId)))
      .map((o) => o.status)
      .sort();
    expect(states).toEqual(['expired', 'quoted']);
  });

  test('TRON top-up quote uses 6 decimals and the TRON USDT contract', async () => {
    const addr = kit.newUser();
    const u = await kit.as(addr);
    const { card, operation } = (await (
      await u.call('POST', '/v1/app/cards', { product: 'mastercard', email: 't@example.com' })
    ).json()) as any;
    await submitOne();
    const [first] = await dbRef.db.select().from(cardOperations).where(eq(cardOperations.id, operation.id));
    await provider.sandboxConfirm(invoiceOf(first as never)?.paymentId as string);
    await kit.mock.hooks.idle();
    for (let i = 0; i < 10; i++) if (!(await processOneEvent())) break;
    const top = (await (
      await u.call('POST', `/v1/app/cards/${card.id}/topups`, { amountUsdCents: '5000' })
    ).json()) as any;
    expect(top.operation.kind).toBe('topup');
    await submitOne();
    const [topRow] = await dbRef.db
      .select()
      .from(cardOperations)
      .where(eq(cardOperations.id, top.operation.id));
    const inv = invoiceOf(topRow as never);
    const res = await u.call('POST', `/v1/app/card-operations/${top.operation.id}/relay-quote`);
    expect(res.status).toBe(200);
    const sent = relayCalls[0]?.body;
    expect(sent.destinationChainId).toBe(728126428);
    expect(sent.destinationCurrency).toBe('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
    expect(sent.recipient).toBe(inv?.payAddress);
    expect(sent.amount).toBe(String(Math.round(Number(inv?.payAmount) * 1e6)));
  });

  test('unpaid, expired or foreign operations are refused', async () => {
    const { u, opId } = await waitingIssue();
    const other = await kit.as(kit.newUser());
    expect((await other.call('POST', `/v1/app/card-operations/${opId}/relay-quote`)).status).toBe(404);
    await dbRef.db.update(cardOperations).set({ status: 'processing' }).where(eq(cardOperations.id, opId));
    expect((await u.call('POST', `/v1/app/card-operations/${opId}/relay-quote`)).status).toBe(409);
  });

  test('stub mode rewrites targets to the depository: approve(stub) + deposit(requestId, token, amount)', async () => {
    Object.assign(cardSettings, { relayMode: 'stub' });
    const { u, opId } = await waitingIssue();
    const q = (await (await u.call('POST', `/v1/app/card-operations/${opId}/relay-quote`)).json()) as any;
    expect(q.steps[0].items[0].to).toBe(USDG);
    expect(q.steps[1].items[0].to).toBe(STUB);
    const dec = decodeFunctionData({ abi: stubAbi, data: q.steps[1].items[0].data });
    expect(dec.functionName).toBe('deposit');
    expect([dec.args[0], String(dec.args[1]).toLowerCase(), dec.args[2]]).toEqual([
      q.requestId,
      USDG,
      10715531n,
    ]);
  });

  test('stub mode is refused in production', async () => {
    Object.assign(cardSettings, { relayMode: 'stub', nodeEnv: 'production' });
    try {
      const { u, opId } = await waitingIssue();
      expect((await u.call('POST', `/v1/app/card-operations/${opId}/relay-quote`)).status).toBe(500);
    } finally {
      Object.assign(cardSettings, { nodeEnv: 'test' });
    }
  });

  test('markSubmitted verifies sender and target, and is idempotent for the same deposit', async () => {
    const { u, addr, opId } = await waitingIssue();
    const q = (await (await u.call('POST', `/v1/app/card-operations/${opId}/relay-quote`)).json()) as any;
    const hash = `0x${'11'.repeat(32)}`;
    chainDeps.getReceipt = (async () => ({
      status: 'success',
      from: '0x000000000000000000000000000000000000dead',
      to: q.steps[0].items[0].to,
    })) as never;
    chainDeps.getTransaction = (async () => null) as never;
    expect(
      (
        await u.call('POST', `/v1/app/relay-orders/${q.relayOrderId}/submitted`, {
          step: 'approve',
          txHash: hash,
        })
      ).status,
    ).toBe(400);
    chainDeps.getReceipt = (async () => ({
      status: 'success',
      from: addr,
      to: q.steps[0].items[0].to,
    })) as never;
    expect(
      (
        (await (
          await u.call('POST', `/v1/app/relay-orders/${q.relayOrderId}/submitted`, {
            step: 'approve',
            txHash: hash,
          })
        ).json()) as any
      ).status,
    ).toBe('signing');
    const dep = `0x${'22'.repeat(32)}`;
    chainDeps.getReceipt = (async () => ({
      status: 'success',
      from: addr,
      to: q.steps[1].items[0].to,
    })) as never;
    expect(
      (
        (await (
          await u.call('POST', `/v1/app/relay-orders/${q.relayOrderId}/submitted`, {
            step: 'deposit',
            txHash: dep,
          })
        ).json()) as any
      ).status,
    ).toBe('submitted');
    expect(
      (
        await u.call('POST', `/v1/app/relay-orders/${q.relayOrderId}/submitted`, {
          step: 'deposit',
          txHash: dep,
        })
      ).status,
    ).toBe(200);
    // another user cannot touch it
    const other = await kit.as(kit.newUser());
    expect(
      (
        await other.call('POST', `/v1/app/relay-orders/${q.relayOrderId}/submitted`, {
          step: 'deposit',
          txHash: dep,
        })
      ).status,
    ).toBe(404);
    // no new quote while the deposit is in flight
    expect((await u.call('POST', `/v1/app/card-operations/${opId}/relay-quote`)).status).toBe(409);
  });

  async function submittedOrder() {
    const w = await waitingIssue();
    const q = (await (await w.u.call('POST', `/v1/app/card-operations/${w.opId}/relay-quote`)).json()) as any;
    chainDeps.getReceipt = (async () => ({
      status: 'success',
      from: w.addr,
      to: q.steps[1].items[0].to,
    })) as never;
    await w.u.call('POST', `/v1/app/relay-orders/${q.relayOrderId}/submitted`, {
      step: 'deposit',
      txHash: `0x${'33'.repeat(32)}`,
    });
    return { ...w, orderId: q.relayOrderId as string };
  }
  const orderStatus = async (id: string) =>
    (await dbRef.db.select().from(relayOrders).where(eq(relayOrders.id, id)))[0]?.status;
  const opStatus = async (id: string) =>
    (await dbRef.db.select().from(cardOperations).where(eq(cardOperations.id, id)))[0]?.status;

  test('polling: success -> op processing (never completed); refund keeps op; failure -> review', async () => {
    const a = await submittedOrder();
    statusReply = 'success';
    await pollRelayOrders();
    expect(await orderStatus(a.orderId)).toBe('success');
    expect(await opStatus(a.opId)).toBe('processing');

    await dbRef.db.update(cardOperations).set({ status: 'failed' }).where(eq(cardOperations.id, a.opId));
    const b = await submittedOrder();
    statusReply = 'refund';
    await pollRelayOrders();
    expect(await orderStatus(b.orderId)).toBe('refund');
    expect(await opStatus(b.opId)).toBe('awaiting_payment');

    await dbRef.db.update(cardOperations).set({ status: 'failed' }).where(eq(cardOperations.id, b.opId));
    const c = await submittedOrder();
    statusReply = 'failure';
    await pollRelayOrders();
    expect(await opStatus(c.opId)).toBe('review');
  });

  test('stub polling: StubDeposit receipt -> success, izipay mock confirmed, card issued by webhook', async () => {
    Object.assign(cardSettings, { relayMode: 'stub' });
    const w = await waitingIssue();
    const q = (await (await w.u.call('POST', `/v1/app/card-operations/${w.opId}/relay-quote`)).json()) as any;
    const dep = `0x${'44'.repeat(32)}`;
    const topics = encodeEventTopics({
      abi: stubAbi,
      eventName: 'StubDeposit',
      args: { requestId: q.requestId as `0x${string}`, sender: w.addr as `0x${string}` },
    });
    const receipt = {
      status: 'success',
      from: w.addr,
      to: STUB,
      logs: [
        {
          address: STUB,
          topics,
          data: encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [USDG, 10715531n]),
          blockNumber: 1n,
          transactionHash: dep,
          logIndex: 0,
          blockHash: dep,
          transactionIndex: 0,
          removed: false,
        },
      ],
    } as unknown as TransactionReceipt;
    chainDeps.getReceipt = (async () => receipt) as never;
    expect(
      (
        await w.u.call('POST', `/v1/app/relay-orders/${q.relayOrderId}/submitted`, {
          step: 'deposit',
          txHash: dep,
        })
      ).status,
    ).toBe(200);
    await pollRelayOrders();
    expect(await orderStatus(q.relayOrderId)).toBe('success');
    await kit.mock.hooks.idle();
    for (let i = 0; i < 10; i++) if (!(await processOneEvent())) break;
    expect(await opStatus(w.opId)).toBe('completed');
    // confirm is not repeated
    await pollRelayOrders();
  });

  test('markSubmitted: invisible tx -> 409 and the order is not advanced; stale submitted orders expire', async () => {
    const { u, opId } = await waitingIssue();
    const q = (await (await u.call('POST', `/v1/app/card-operations/${opId}/relay-quote`)).json()) as any;
    chainDeps.getReceipt = (async () => null) as never;
    chainDeps.getTransaction = (async () => null) as never;
    const res = await u.call('POST', `/v1/app/relay-orders/${q.relayOrderId}/submitted`, {
      step: 'deposit',
      txHash: `0x${'55'.repeat(32)}`,
    });
    expect(res.status).toBe(409);
    expect(['quoted', 'signing']).toContain((await orderStatus(q.relayOrderId)) as string);
    // a submitted order with no receipt after the timeout becomes expired (re-quotable)
    const w = await submittedOrder();
    chainDeps.getReceipt = (async () => null) as never;
    statusReply = 'waiting';
    Object.assign(cardSettings, { submittedTimeoutMs: -1 });
    try {
      await pollRelayOrders();
    } finally {
      Object.assign(cardSettings, { submittedTimeoutMs: 10 * 60_000 });
    }
    expect(await orderStatus(w.orderId)).toBe('expired');
    expect((await w.u.call('POST', `/v1/app/card-operations/${w.opId}/relay-quote`)).status).toBe(200);
  });

  test('concurrent relay-quote requests leave exactly one live quote', async () => {
    const { u, opId } = await waitingIssue();
    const results = await Promise.all(
      [1, 2, 3].map(() => u.call('POST', `/v1/app/card-operations/${opId}/relay-quote`)),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const states = (
      await dbRef.db.select().from(relayOrders).where(eq(relayOrders.cardOperationId, opId))
    ).map((o) => o.status);
    expect(states.filter((s) => s === 'quoted')).toHaveLength(1);
  });
});
