import { and, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { cardOperations, cardProfiles, cards, cardTransactions, relayOrders, users } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { enqueue } from '../../lib/queue';
import { getRedis } from '../../lib/redis';
import type { CardOperation, CardView } from '../../shared/api/cards';
import type { CardNetwork } from '../../shared/enums';
import { dbRef } from '../auth/constants';
import { centsToDecimal, decimal, decimalToCents, record, str } from './domain';
import { liveWritesDisabledError, provider } from './provider';
import {
  cardSettings,
  decryptCardData,
  encryptCardData,
  liveWritesBlocked,
  profileContext,
  providerScope,
  requireCards,
  unavailable,
} from './settings';

export type CardRow = typeof cards.$inferSelect;
export type OpRow = typeof cardOperations.$inferSelect;

export const ISSUABLE_PRODUCTS = ['mastercard'] as const;
export const PRODUCT_LABELS: Record<string, string> = { mastercard: 'Mastercard (Apple Pay)' };

/** Invoice as stored in `card_operations.invoice` (first provider response; never regenerated). */
export type StoredInvoice = {
  payAddress: string;
  payAmount: string;
  payCurrency: string;
  network: CardNetwork;
  expiresAt: string;
  paymentId?: string;
  topupId?: string;
  url?: string;
  amountUsd?: string;
  amountOnCardUsd?: string;
};

export const hooks = {
  /** Wakes the reconcile worker; best effort (the 10 s schedule is the safety net). */
  kick: async () => {
    await enqueue('cards', 'cards:reconcile', {}, { removeOnComplete: true, attempts: 1 });
  },
};
async function kick() {
  try {
    await hooks.kick();
  } catch (err) {
    logger.debug({ err: (err as Error).message }, 'cards reconcile kick failed');
  }
}

export const REVIEW_TEXT =
  'We are checking the outcome of this request. Do not make another payment. Contact support if it does not update.';
export const REJECTED_TEXT =
  'The card provider could not accept this request. Please check the details or contact support.';

export function invoiceOf(op: Pick<OpRow, 'invoice'>): StoredInvoice | null {
  const inv = record(op.invoice);
  return typeof inv.payAddress === 'string' && typeof inv.payAmount === 'string'
    ? (op.invoice as StoredInvoice)
    : null;
}

export function serializeOperation(op: OpRow): CardOperation {
  const inv = invoiceOf(op);
  return {
    id: op.id,
    kind: op.kind as CardOperation['kind'],
    status: op.status as CardOperation['status'],
    amountUsdCents: (op.amountUsdCents ?? 0n).toString(),
    invoice: inv
      ? {
          payAddress: inv.payAddress,
          payAmount: inv.payAmount,
          payCurrency: inv.payCurrency,
          network: inv.network,
          expiresAt: inv.expiresAt,
        }
      : null,
    error: op.error,
  };
}

const OPEN_STATUSES = ['created', 'submitting', 'awaiting_payment', 'processing', 'review'] as const;

export function serializeCard(card: CardRow, pending?: OpRow): CardView {
  return {
    id: card.id,
    product: card.product,
    last4: card.last4,
    status: card.status as CardView['status'],
    balanceUsdCents: (card.balanceUsdCents ?? 0n).toString(),
    finish: card.finish,
    createdAt: card.createdAt.toISOString(),
    ...(pending ? { pendingOperation: serializeOperation(pending) } : {}),
  };
}

export async function userIdFor(address: string): Promise<string> {
  const [row] = await dbRef.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.address, address.toLowerCase()))
    .limit(1);
  if (!row) throw new AppError('UNAUTHENTICATED', 'Please sign in with your wallet.');
  return row.id;
}

// ------------------------------------------------------------------ pricing

const pricingKey = () => `cards:pricing:${providerScope()}`;
export type Pricing = { issueFeeUsdCents: string; fetchedAt: number };

/** Reads `/balance` pricing (account-derived) and caches it for 15 minutes. Never computes fees itself. */
export async function getPricing(force = false): Promise<Pricing | null> {
  const redis = getRedis();
  if (!force) {
    const cached = await redis.get(pricingKey()).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as Pricing;
      } catch {
        /* refetch */
      }
    }
  }
  if (!cardSettingsReady()) return null;
  try {
    const data = record(await provider.pricing());
    const fee = decimalToCents(decimal(record(data.pricing).mastercard_issue_usd));
    if (fee === null) return null;
    const pricing: Pricing = { issueFeeUsdCents: fee.toString(), fetchedAt: Date.now() };
    await redis.set(pricingKey(), JSON.stringify(pricing), 'EX', 900);
    const limit = Number(record(data.limits).rate_limit_per_min);
    if (Number.isSafeInteger(limit) && limit > 0 && cardSettings.rateBudgetOverride === undefined) {
      // 80% of the account limit; the key is Spindle-only.
      await redis.set(
        `cards:provider:${providerScope()}:limit`,
        String(Math.max(1, Math.floor(limit * 0.8))),
        'EX',
        3600,
      );
    }
    return pricing;
  } catch {
    return null;
  }
}
const cardSettingsReady = () => {
  try {
    requireCards();
    return true;
  } catch {
    return false;
  }
};

export async function getPricingView() {
  const pricing = await getPricing();
  return {
    products: ISSUABLE_PRODUCTS.map((id) => ({
      id: id as string,
      label: PRODUCT_LABELS[id] ?? id,
      issueFeeUsdCents: pricing?.issueFeeUsdCents ?? '0',
      available: Boolean(pricing) && !liveWritesBlocked(),
    })),
    topupFeeNote:
      'The top-up fee is set by the card provider and is shown on the invoice before you pay. The exact amount is never estimated here.',
    minTopupCents: cardSettings.minTopupCents.toString(),
    maxTopupCents: cardSettings.maxCardCents.toString(),
  };
}

// ----------------------------------------------------------------- creation

type Tx = Parameters<Parameters<typeof dbRef.db.transaction>[0]>[0];

/** Velocity limits per user (card-flows.md). Runs under the user row lock. */
async function enforceVelocity(tx: Tx, userId: string, newCents: bigint): Promise<void> {
  const since = new Date(Date.now() - 24 * 3600_000);
  const recent = await tx
    .select({ amount: cardOperations.amountUsdCents })
    .from(cardOperations)
    .where(
      and(
        eq(cardOperations.userId, userId),
        ne(cardOperations.status, 'failed'),
        gt(cardOperations.createdAt, since),
      ),
    );
  if (recent.length >= cardSettings.maxOpsPerDay) {
    throw new AppError(
      'RATE_LIMITED',
      `Daily limit reached: at most ${cardSettings.maxOpsPerDay} card operations per day.`,
      429,
    );
  }
  const total = recent.reduce((sum, r) => sum + (r.amount ?? 0n), 0n) + newCents;
  if (total > cardSettings.maxCentsPerDay) {
    throw new AppError(
      'RATE_LIMITED',
      'Daily card funding limit reached. Try a smaller amount or wait.',
      429,
    );
  }
  const unpaid = await tx
    .select({ id: cardOperations.id })
    .from(cardOperations)
    .where(
      and(
        eq(cardOperations.userId, userId),
        inArray(cardOperations.status, ['created', 'submitting', 'awaiting_payment']),
      ),
    );
  if (unpaid.length >= cardSettings.maxUnpaidInvoices) {
    throw new AppError(
      'CONFLICT',
      'You already have an unpaid card invoice. Pay or let it expire first.',
      409,
    );
  }
}

async function lockUser(tx: Tx, userId: string) {
  const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
  if (!u) throw new AppError('UNAUTHENTICATED', 'Please sign in with your wallet.');
}

export type CreateCtx = { userId: string; address: string; ipHash: string | null };

export async function createCard(
  ctx: CreateCtx,
  input: { product: string; email: string; alias?: string | undefined; finish?: string | undefined },
): Promise<{ card: CardView; operation: CardOperation }> {
  requireCards();
  if (!(ISSUABLE_PRODUCTS as readonly string[]).includes(input.product)) {
    throw new AppError('VALIDATION', 'This card type cannot be requested.');
  }
  const email = input.email.trim();
  const pricing = await getPricing();
  const feeCents = BigInt(pricing?.issueFeeUsdCents ?? '0');
  const blocked = liveWritesBlocked();
  let result: { card: CardRow; op: OpRow };
  try {
    result = await dbRef.db.transaction(async (tx) => {
      await lockUser(tx, ctx.userId);
      const [open] = await tx
        .select({ id: cards.id })
        .from(cards)
        .where(
          and(
            eq(cards.userId, ctx.userId),
            eq(cards.product, input.product),
            eq(cards.status, 'pending_payment'),
          ),
        )
        .limit(1);
      if (open)
        throw new AppError('CONFLICT', 'You already have a card request in progress for this product.', 409);
      await enforceVelocity(tx, ctx.userId, feeCents);
      const [profile] = await tx
        .insert(cardProfiles)
        .values({
          userId: ctx.userId,
          emailEnc: encryptCardData(email, profileContext(ctx.userId)),
          aliasEnc: input.alias ? encryptCardData(input.alias, profileContext(ctx.userId)) : null,
        })
        .returning({ id: cardProfiles.id });
      const [card] = await tx
        .insert(cards)
        .values({
          userId: ctx.userId,
          product: input.product,
          finish: input.finish ?? null,
          status: blocked ? 'failed' : 'pending_payment',
        })
        .returning();
      const [op] = await tx
        .insert(cardOperations)
        .values({
          cardId: card!.id,
          userId: ctx.userId,
          kind: 'issue',
          network: 'bsc',
          amountUsdCents: feeCents,
          fundingWallet: ctx.address.toLowerCase(),
          ipHash: ctx.ipHash,
          // Snapshot of the profile used for this card: two cards can never cross emails.
          invoice: { profileId: profile?.id },
          status: blocked ? 'failed' : 'created',
          error: blocked ? 'LIVE_WRITES_DISABLED' : null,
        })
        .returning();
      return { card: card!, op: op! };
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new AppError('CONFLICT', 'You already have a card request in progress for this product.', 409);
    }
    throw err;
  }
  // The refusal is recorded (operation `failed`) before the 409 so nothing is ever sent to the provider.
  if (blocked) throw liveWritesDisabledError();
  await kick();
  return { card: serializeCard(result.card, result.op), operation: serializeOperation(result.op) };
}

export async function ownCard(userId: string, id: string): Promise<CardRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('NOT_FOUND', 'Not found');
  const [card] = await dbRef.db
    .select()
    .from(cards)
    .where(and(eq(cards.id, id), eq(cards.userId, userId)))
    .limit(1);
  if (!card) throw new AppError('NOT_FOUND', 'Not found');
  return card;
}

export async function createTopup(
  ctx: CreateCtx,
  cardId: string,
  amountUsdCents: bigint,
): Promise<{ operation: CardOperation }> {
  requireCards();
  if (amountUsdCents < cardSettings.minTopupCents || amountUsdCents > cardSettings.maxCardCents) {
    throw new AppError(
      'VALIDATION',
      `Top-up must be between $${centsToDecimal(cardSettings.minTopupCents)} and $${centsToDecimal(cardSettings.maxCardCents)}.`,
    );
  }
  await ownCard(ctx.userId, cardId);
  const blocked = liveWritesBlocked();
  const op = await dbRef.db.transaction(async (tx) => {
    await lockUser(tx, ctx.userId);
    const [card] = await tx
      .select()
      .from(cards)
      .where(and(eq(cards.id, cardId), eq(cards.userId, ctx.userId)))
      .for('update');
    if (!card) throw new AppError('NOT_FOUND', 'Not found');
    if (card.status !== 'issued' || !card.providerCardId) {
      throw new AppError('CONFLICT', 'Your card is not ready for a top-up yet.', 409);
    }
    const [pending] = await tx
      .select({ id: cardOperations.id })
      .from(cardOperations)
      .where(and(eq(cardOperations.cardId, cardId), inArray(cardOperations.status, [...OPEN_STATUSES])))
      .limit(1);
    if (pending)
      throw new AppError('CONFLICT', 'Your previous card payment is still pending or under review.', 409);
    await enforceVelocity(tx, ctx.userId, amountUsdCents);
    const [row] = await tx
      .insert(cardOperations)
      .values({
        cardId,
        userId: ctx.userId,
        kind: 'topup',
        network: 'tron',
        amountUsdCents,
        fundingWallet: ctx.address.toLowerCase(),
        ipHash: ctx.ipHash,
        status: blocked ? 'failed' : 'created',
        error: blocked ? 'LIVE_WRITES_DISABLED' : null,
      })
      .returning();
    return row!;
  });
  if (blocked) throw liveWritesDisabledError();
  await kick();
  return { operation: serializeOperation(op) };
}

// -------------------------------------------------------------------- reads

export async function listCards(userId: string): Promise<CardView[]> {
  const rows = await dbRef.db
    .select()
    .from(cards)
    .where(eq(cards.userId, userId))
    .orderBy(desc(cards.createdAt));
  if (!rows.length) return [];
  const ops = await dbRef.db
    .select()
    .from(cardOperations)
    .where(
      and(
        inArray(
          cardOperations.cardId,
          rows.map((r) => r.id),
        ),
        inArray(cardOperations.status, [...OPEN_STATUSES]),
      ),
    )
    .orderBy(desc(cardOperations.createdAt));
  return rows.map((r) =>
    serializeCard(
      r,
      ops.find((o) => o.cardId === r.id),
    ),
  );
}

export async function getOperation(userId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('NOT_FOUND', 'Not found');
  const [op] = await dbRef.db
    .select()
    .from(cardOperations)
    .where(and(eq(cardOperations.id, id), eq(cardOperations.userId, userId)))
    .limit(1);
  if (!op) throw new AppError('NOT_FOUND', 'Not found');
  const [order] = await dbRef.db
    .select()
    .from(relayOrders)
    .where(eq(relayOrders.cardOperationId, id))
    .orderBy(desc(relayOrders.createdAt))
    .limit(1);
  return {
    operation: serializeOperation(op),
    relay: order
      ? {
          id: order.id,
          requestId: order.requestId,
          status: order.status as 'quoted',
          originAmountMicros: (order.originAmountMicros ?? 0n).toString(),
          depositTx: order.depositTx,
          expiresAt: str(record(order.quote).expiresAt),
        }
      : null,
  };
}

export async function getTransactions(userId: string, id: string, limit: number, cursor?: string) {
  await ownCard(userId, id);
  let after = sql`true`;
  if (cursor) {
    try {
      const t = record(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
      if (
        typeof t.id !== 'string' ||
        !/^[0-9a-f-]{36}$/.test(t.id) ||
        typeof t.at !== 'string' ||
        !Number.isFinite(new Date(t.at).getTime())
      ) {
        throw new Error('bad');
      }
      after = sql`(${cardTransactions.occurredAt}, ${cardTransactions.id}) < (${new Date(t.at)}, ${t.id})`;
    } catch {
      throw new AppError('VALIDATION', 'Invalid cursor.');
    }
  }
  const rows = await dbRef.db
    .select()
    .from(cardTransactions)
    .where(and(eq(cardTransactions.cardId, id), after))
    .orderBy(desc(cardTransactions.occurredAt), desc(cardTransactions.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      id: r.id,
      amountCents: r.amountCents.toString(),
      currency: r.currency ?? 'USD',
      merchant: r.merchant,
      status: r.status ?? 'unknown',
      occurredAt: (r.occurredAt ?? new Date(0)).toISOString(),
    })),
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({ id: last.id, at: (last.occurredAt ?? new Date(0)).toISOString() }),
          ).toString('base64url')
        : null,
  };
}

/** Full card details: fresh-auth only, fetched on demand, never stored or logged. */
export async function revealCard(userId: string, id: string) {
  const card = await ownCard(userId, id);
  requireCards();
  if (card.status !== 'issued' || !card.providerCardId)
    throw new AppError('CONFLICT', 'Your card details are not ready yet.', 409);
  try {
    let data = record(await provider.card(card.providerCardId));
    if (!record(data.card).number) data = record(await provider.card(card.providerCardId, true));
    if (data.card_id !== card.providerCardId || data.issue_status !== 'issued') throw unavailable();
    const details = record(data.card);
    const number = str(details.number, 32)?.replace(/\s/g, '');
    const exp = str(details.exp, 7);
    const cvv = str(details.cvv, 4);
    if (
      !number ||
      !/^\d{13,19}$/.test(number) ||
      !exp ||
      !/^(0[1-9]|1[0-2])\/(\d{2}|\d{4})$/.test(exp) ||
      !cvv ||
      !/^\d{3,4}$/.test(cvv)
    ) {
      throw unavailable();
    }
    let holder = str(data.cardholder_alias, 100) ?? '';
    if (!holder) {
      const [profile] = await dbRef.db
        .select({ aliasEnc: cardProfiles.aliasEnc })
        .from(cardProfiles)
        .where(eq(cardProfiles.userId, userId))
        .orderBy(desc(cardProfiles.createdAt))
        .limit(1);
      if (profile?.aliasEnc) holder = decryptCardData(profile.aliasEnc, profileContext(userId));
    }
    return { number, exp, cvv, holder };
  } catch {
    throw unavailable();
  }
}
