import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { cardOperations, relayOrders } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { publicClient } from '../../lib/viem';
import type { RelayStatus } from '../../shared/enums';
import { dbRef } from '../auth/constants';
import { decimalToUnits } from '../cards/domain';
import { ProviderError, provider } from '../cards/provider';
import { updateOperation } from '../cards/reconcile';
import { invoiceOf } from '../cards/service';
import { assertRelayModeSafe, cardSettings } from '../cards/settings';
import * as relayClient from './client';
import { receiptHasStubDeposit, rewriteForStub, type ServedStep } from './stub';

export const DEST = {
  bsc: { chainId: 56, currency: '0x55d398326f99059ff775485246999027b3197955', decimals: 18 },
  tron: { chainId: 728126428, currency: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 },
} as const;
const QUOTE_TTL_MS = 5 * 60_000;

export const chainDeps = {
  getTransaction: (hash: `0x${string}`) => publicClient.getTransaction({ hash }),
  getReceipt: (hash: `0x${string}`) => publicClient.getTransactionReceipt({ hash }),
};

type OrderRow = typeof relayOrders.$inferSelect;
type QuoteJson = {
  steps: ServedStep[];
  feesUsd: string;
  timeEstimateSec: number;
  expiresAt: string;
  checkEndpoint?: string;
  endpoint: 'v1' | 'v2';
  stub: boolean;
  user: string;
  approveTx?: string;
  stubConfirmed?: boolean;
};
const quoteOf = (o: OrderRow) => o.quote as QuoteJson;

function sumUsd(fees: Record<string, { amountUsd?: string }>): string {
  let micros = 0n;
  for (const f of Object.values(fees)) {
    if (!f.amountUsd || !/^\d+(\.\d+)?$/.test(f.amountUsd)) continue;
    micros += decimalToUnits(f.amountUsd, 6);
  }
  return `${micros / 1_000_000n}.${(micros % 1_000_000n).toString().padStart(6, '0')}`;
}

type DbTx = Parameters<Parameters<typeof dbRef.db.transaction>[0]>[0];

/** One quote at a time per operation: the operation row stays locked until the order row is written. */
export async function createRelayQuote(userId: string, address: string, operationId: string) {
  assertRelayModeSafe();
  if (!/^[0-9a-f-]{36}$/i.test(operationId)) throw new AppError('NOT_FOUND', 'Not found');
  return dbRef.db.transaction((tx) => quoteLocked(tx, userId, address, operationId));
}

async function quoteLocked(dtx: DbTx, userId: string, address: string, operationId: string) {
  const [op] = await dtx
    .select()
    .from(cardOperations)
    .where(and(eq(cardOperations.id, operationId), eq(cardOperations.userId, userId)))
    .for('update')
    .limit(1);
  if (!op) throw new AppError('NOT_FOUND', 'Not found');
  const invoice = invoiceOf(op);
  if (op.status !== 'awaiting_payment' || !invoice)
    throw new AppError('CONFLICT', 'This operation is not waiting for payment.', 409);
  if (new Date(invoice.expiresAt).getTime() <= Date.now())
    throw new AppError('CONFLICT', 'The invoice has expired.', 409);
  const dest = DEST[invoice.network];
  const existing = await dtx.select().from(relayOrders).where(eq(relayOrders.cardOperationId, op.id));
  if (existing.some((o) => ['submitted', 'pending', 'success'].includes(o.status))) {
    throw new AppError('CONFLICT', 'A payment for this invoice is already in progress.', 409);
  }
  const destAmount = decimalToUnits(invoice.payAmount, dest.decimals).toString();
  const { quote, endpoint } = await relayClient.quote({
    user: address,
    recipient: invoice.payAddress,
    originChainId: cardSettings.originChainId,
    originCurrency: cardSettings.usdgAddress,
    destinationChainId: dest.chainId,
    destinationCurrency: dest.currency,
    amount: destAmount,
  });
  const stub = cardSettings.relayMode === 'stub';
  const steps: ServedStep[] = stub
    ? rewriteForStub(quote)
    : quote.steps.map((s) => ({
        id: s.id,
        kind: 'transaction' as const,
        items: s.items.map((i) => ({
          to: i.data.to.toLowerCase(),
          data: i.data.data,
          value: i.data.value,
          chainId: i.data.chainId,
        })),
      }));
  const deposit = quote.steps.find((s) => s.id === 'deposit')?.items[0];
  const expiresAt = new Date(
    Math.min(Date.now() + QUOTE_TTL_MS, new Date(invoice.expiresAt).getTime()),
  ).toISOString();
  const json: QuoteJson = {
    steps,
    feesUsd: sumUsd(quote.fees),
    timeEstimateSec: Math.max(1, Math.round(quote.details.timeEstimate ?? 60)),
    expiresAt,
    ...(deposit?.check?.endpoint ? { checkEndpoint: deposit.check.endpoint } : {}),
    endpoint,
    stub,
    user: address.toLowerCase(),
  };
  const order = await (async (tx: DbTx) => {
    // Older unsent quotes are superseded.
    await tx
      .update(relayOrders)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(eq(relayOrders.cardOperationId, op.id), inArray(relayOrders.status, ['quoted', 'signing'])));
    const [row] = await tx
      .insert(relayOrders)
      .values({
        cardOperationId: op.id,
        userId,
        requestId: quote.requestId,
        originAmountMicros: BigInt(quote.details.currencyIn.amount),
        destCurrency: dest.currency,
        destChainId: BigInt(dest.chainId),
        destAddress: invoice.payAddress,
        destAmount,
        quote: json,
        status: 'quoted',
      })
      .returning();
    return row!;
  })(dtx);
  return {
    relayOrderId: order.id,
    requestId: order.requestId,
    originAmountMicros: (order.originAmountMicros ?? 0n).toString(),
    feesUsd: json.feesUsd,
    timeEstimateSec: json.timeEstimateSec,
    steps,
    expiresAt,
  };
}

type TxCheck = 'ok' | 'mismatch' | 'reverted' | 'unknown';
async function verifyTx(hash: `0x${string}`, from: string, to: string): Promise<TxCheck> {
  const receipt = await chainDeps.getReceipt(hash).catch(() => null);
  const seen = receipt ?? (await chainDeps.getTransaction(hash).catch(() => null));
  if (!seen) return 'unknown';
  if (seen.from.toLowerCase() !== from.toLowerCase() || (seen.to ?? '').toLowerCase() !== to.toLowerCase())
    return 'mismatch';
  if (receipt && receipt.status === 'reverted') return 'reverted';
  return 'ok';
}

export async function markSubmitted(
  userId: string,
  address: string,
  orderId: string,
  step: 'approve' | 'deposit',
  txHash: string,
) {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new AppError('NOT_FOUND', 'Not found');
  const [order] = await dbRef.db
    .select()
    .from(relayOrders)
    .where(and(eq(relayOrders.id, orderId), eq(relayOrders.userId, userId)))
    .limit(1);
  if (!order) throw new AppError('NOT_FOUND', 'Not found');
  const quote = quoteOf(order);
  const item = quote.steps.find((s) => s.id === step)?.items[0];
  if (!item) throw new AppError('VALIDATION', 'Unknown step.');
  const hash = txHash.toLowerCase();
  if (step === 'deposit' && order.depositTx?.toLowerCase() === hash)
    return { status: order.status as RelayStatus };
  if (!['quoted', 'signing'].includes(order.status))
    throw new AppError('CONFLICT', 'This payment can no longer be changed.', 409);
  // The tx must become visible (pending or mined) within the wait window; otherwise 409 and the order stays put.
  let check = await verifyTx(hash as `0x${string}`, address, item.to);
  const deadline = Date.now() + cardSettings.txVisibleWaitMs;
  while (check === 'unknown' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, Math.min(2000, Math.max(10, deadline - Date.now()))));
    check = await verifyTx(hash as `0x${string}`, address, item.to);
  }
  if (check === 'unknown') {
    if (order.status === 'quoted') await setOrder(order.id, 'signing', ['quoted']);
    throw new AppError(
      'CONFLICT',
      'The transaction is not visible on chain yet. Try again in a moment.',
      409,
    );
  }
  if (check === 'mismatch')
    throw new AppError('VALIDATION', 'That transaction does not match the quoted step.');
  if (check === 'reverted') throw new AppError('VALIDATION', 'That transaction failed on chain.');
  const next: RelayStatus = step === 'approve' ? 'signing' : 'submitted';
  const [updated] = await dbRef.db
    .update(relayOrders)
    .set({
      status: next,
      updatedAt: new Date(),
      ...(step === 'deposit' ? { depositTx: hash } : {}),
      ...(step === 'approve'
        ? { quote: sql`${relayOrders.quote} || ${JSON.stringify({ approveTx: hash })}::jsonb` }
        : {}),
    })
    .where(and(eq(relayOrders.id, order.id), inArray(relayOrders.status, ['quoted', 'signing'])))
    .returning();
  if (!updated) throw new AppError('CONFLICT', 'This payment can no longer be changed.', 409);
  return { status: updated.status as RelayStatus };
}

async function setOrder(id: string, status: RelayStatus, from: RelayStatus[]) {
  const [row] = await dbRef.db
    .update(relayOrders)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(relayOrders.id, id), inArray(relayOrders.status, from)))
    .returning();
  return row ?? null;
}

async function onSuccess(order: OrderRow) {
  if (!(await setOrder(order.id, 'success', ['submitted', 'pending']))) return;
  // Relay filled the bridge: izipay still has to confirm. Never completed here.
  await updateOperation(order.cardOperationId, 'processing');
}

async function stubConfirm(order: OrderRow) {
  const quote = quoteOf(order);
  if (!quote.stub || quote.stubConfirmed) return;
  const [op] = await dbRef.db
    .select()
    .from(cardOperations)
    .where(eq(cardOperations.id, order.cardOperationId));
  const paymentId = op ? invoiceOf(op)?.paymentId : undefined;
  if (!paymentId) return;
  try {
    await provider.sandboxConfirm(paymentId);
  } catch (err) {
    // 409 ALREADY_PAID counts as confirmed; anything else retries next tick.
    if (!(err instanceof ProviderError && err.outcome === 'rejected')) throw err;
  }
  await dbRef.db
    .update(relayOrders)
    .set({ quote: sql`${relayOrders.quote} || '{"stubConfirmed":true}'::jsonb` })
    .where(eq(relayOrders.id, order.id));
}

async function pollOne(order: OrderRow) {
  const quote = quoteOf(order);
  if (!order.depositTx) return;
  const hash = order.depositTx as `0x${string}`;
  if (quote.stub) {
    assertRelayModeSafe();
    const receipt = await chainDeps.getReceipt(hash).catch(() => null);
    if (!receipt) {
      await expireStale(order);
      return;
    }
    if (receipt.status === 'reverted') {
      await setOrder(order.id, 'failed', ['submitted', 'pending']);
      return;
    }
    if (receiptHasStubDeposit(receipt, order.requestId, quote.user, order.originAmountMicros ?? 0n))
      await onSuccess(order);
    return;
  }
  const receipt = await chainDeps.getReceipt(hash).catch(() => null);
  if (receipt?.status === 'reverted') {
    // Nothing moved: the user may quote again.
    await setOrder(order.id, 'failed', ['submitted', 'pending']);
    return;
  }
  const result = await relayClient.status(order.requestId, quote.checkEndpoint);
  if (result === 'success') await onSuccess(order);
  else if (result === 'refund') await setOrder(order.id, 'refund', ['submitted', 'pending']);
  else if (result === 'failure') {
    if (await setOrder(order.id, 'failed', ['submitted', 'pending']))
      await updateOperation(order.cardOperationId, 'review');
  } else {
    if (!receipt) await expireStale(order);
    else if (order.status === 'submitted') await setOrder(order.id, 'pending', ['submitted']);
  }
}

/** A deposit that never produced a receipt is dropped: the order becomes `expired` and can be re-quoted. */
async function expireStale(order: OrderRow) {
  if (Date.now() - order.updatedAt.getTime() > cardSettings.submittedTimeoutMs) {
    await setOrder(order.id, 'expired', ['submitted', 'pending']);
  }
}

/** Polls active orders (called every tick of the cards job, ~10 s). */
export async function pollRelayOrders() {
  const active = await dbRef.db
    .select()
    .from(relayOrders)
    .where(inArray(relayOrders.status, ['submitted', 'pending', 'success']))
    .orderBy(desc(relayOrders.updatedAt))
    .limit(25);
  for (const order of active) {
    try {
      if (order.status === 'success') await stubConfirm(order);
      else {
        await pollOne(order);
        if (quoteOf(order).stub) {
          const [fresh] = await dbRef.db.select().from(relayOrders).where(eq(relayOrders.id, order.id));
          if (fresh?.status === 'success') await stubConfirm(fresh);
        }
      }
    } catch (err) {
      logger.warn(
        { orderId: order.id, reason: err instanceof Error ? err.message.slice(0, 100) : 'unknown' },
        'relay poll failed',
      );
    }
  }
}
