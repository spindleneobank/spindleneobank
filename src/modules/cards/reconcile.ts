import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import {
  cardOperations,
  cardProfiles,
  cards,
  cardTransactions,
  cardWebhookEvents,
  relayOrders,
} from '../../db/schema';
import { logger } from '../../lib/logger';
import { getRedis } from '../../lib/redis';
import type { CardOpStatus, CardStatus } from '../../shared/enums';
import { dbRef } from '../auth/constants';
import {
  advanceStatus,
  centsToDecimal,
  decimalToCents,
  identifier,
  normalizeCard,
  normalizeInvoice,
  normalizeTransaction,
  PAY_CURRENCY,
  record,
} from './domain';
import { ProviderError, provider } from './provider';
import { getPricing, invoiceOf, type OpRow, REJECTED_TEXT, REVIEW_TEXT, type StoredInvoice } from './service';
import { cardSettings, cardsEnabled, decryptCardData, profileContext, providerScope } from './settings';

const FUNDING_REVIEW = 'The provider used an unexpected funding source. Contact support before continuing.';
const later = (ms: number) => new Date(Date.now() + ms);
type Tx = Parameters<Parameters<typeof dbRef.db.transaction>[0]>[0];

function advanceCard(current: CardStatus, incoming: CardStatus): CardStatus {
  if (current === 'issued') return 'issued';
  if (current === 'failed' && incoming !== 'issued') return 'failed';
  if (current === 'paid_pending_issue' && incoming === 'pending_payment') return current;
  return incoming;
}

async function setOperation(
  tx: Tx,
  op: OpRow,
  status: CardOpStatus,
  extra: Partial<typeof cardOperations.$inferInsert> = {},
) {
  const next = op.error === FUNDING_REVIEW ? 'review' : advanceStatus(op.status as CardOpStatus, status);
  await tx
    .update(cardOperations)
    .set({
      ...extra,
      status: next,
      updatedAt: new Date(),
      error:
        next === 'completed'
          ? null
          : next === 'review'
            ? (extra.error ?? op.error ?? REVIEW_TEXT)
            : extra.error === undefined
              ? op.error
              : extra.error,
    })
    .where(eq(cardOperations.id, op.id));
  return next;
}

async function setCardStatus(
  tx: Tx,
  cardId: string,
  incoming: CardStatus,
  extra: Partial<typeof cards.$inferInsert> = {},
) {
  const [card] = await tx.select().from(cards).where(eq(cards.id, cardId)).for('update');
  if (!card) return;
  await tx
    .update(cards)
    .set({ ...extra, status: advanceCard(card.status as CardStatus, incoming) })
    .where(eq(cards.id, cardId));
}

/** Locks and updates an operation by id (used by the Relay poller too). */
export async function updateOperation(
  opId: string,
  status: CardOpStatus,
  extra: Partial<typeof cardOperations.$inferInsert> = {},
) {
  return dbRef.db.transaction(async (tx) => {
    const [op] = await tx.select().from(cardOperations).where(eq(cardOperations.id, opId)).for('update');
    if (!op) return null;
    return setOperation(tx, op, status, extra);
  });
}

const issueToOp = (issue: string): CardOpStatus =>
  issue === 'issued'
    ? 'completed'
    : issue === 'failed'
      ? 'failed'
      : issue === 'paid_pending_issue'
        ? 'processing'
        : issue === 'pending_payment'
          ? 'awaiting_payment'
          : 'review';
const issueToCard = (issue: string): CardStatus =>
  issue === 'issued'
    ? 'issued'
    : issue === 'failed'
      ? 'failed'
      : issue === 'paid_pending_issue'
        ? 'paid_pending_issue'
        : 'pending_payment';

// ------------------------------------------------------------------ submit

async function claimOne(): Promise<OpRow | null> {
  return dbRef.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(cardOperations)
      // attempts = 0 is the DB-level once-only guard: no provider mutation is ever sent twice.
      .where(and(eq(cardOperations.status, 'created'), eq(cardOperations.attempts, 0)))
      .orderBy(asc(cardOperations.createdAt))
      .for('update', { skipLocked: true })
      .limit(1);
    if (!row) return null;
    const [claimed] = await tx
      .update(cardOperations)
      .set({
        status: 'submitting',
        attempts: sql`${cardOperations.attempts} + 1`,
        leaseUntil: later(60_000),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(cardOperations.id, row.id),
          eq(cardOperations.status, 'created'),
          eq(cardOperations.attempts, 0),
        ),
      )
      .returning();
    return claimed ?? null;
  });
}

async function buildRequest(op: OpRow): Promise<{ body: string; providerCardId?: string }> {
  const [card] = await dbRef.db.select().from(cards).where(eq(cards.id, op.cardId));
  if (!card) throw new ProviderError('not_sent', 'invalid_response');
  if (op.kind === 'issue') {
    const profileId = record(op.invoice).profileId;
    // The profile snapshotted at creation; only legacy rows fall back to the latest one.
    const [profile] = await dbRef.db
      .select()
      .from(cardProfiles)
      .where(
        typeof profileId === 'string'
          ? and(eq(cardProfiles.id, profileId), eq(cardProfiles.userId, op.userId))
          : eq(cardProfiles.userId, op.userId),
      )
      .orderBy(desc(cardProfiles.createdAt))
      .limit(1);
    if (!profile?.emailEnc) throw new ProviderError('not_sent', 'invalid_response');
    const ctx = profileContext(op.userId);
    const holderName = profile.cardholderNameEnc ? decryptCardData(profile.cardholderNameEnc, ctx) : null;
    return {
      body: JSON.stringify({
        cardholder_email: decryptCardData(profile.emailEnc, ctx),
        ...(holderName ? { cardholder_alias: holderName } : {}),
        client_card_ref: card.clientCardRef,
        card_type: card.product,
        pay_currency: PAY_CURRENCY.bsc,
      }),
    };
  }
  if (!card.providerCardId || card.status !== 'issued' || op.amountUsdCents === null) {
    throw new ProviderError('not_sent', 'invalid_response');
  }
  // Numeric token built from integer cents; no float arithmetic.
  return {
    body: `{"amount_usd":${centsToDecimal(op.amountUsdCents)},"pay_currency":"${PAY_CURRENCY.tron}"}`,
    providerCardId: card.providerCardId,
  };
}

export async function submitOne(): Promise<boolean> {
  const op = await claimOne();
  if (!op) return false;
  let result: unknown;
  try {
    const req = await buildRequest(op);
    result =
      op.kind === 'issue'
        ? await provider.issue(req.body, op.id)
        : await provider.topup(req.providerCardId as string, req.body, op.id);
  } catch (error) {
    const writesOff =
      error instanceof Error &&
      error.name === 'AppError' &&
      (error as { code?: string }).code === 'LIVE_WRITES_DISABLED';
    const outcome = error instanceof ProviderError ? error.outcome : writesOff ? 'rejected' : 'unknown';
    logger.warn(
      {
        operationId: op.id,
        kind: op.kind,
        outcome,
        reason: error instanceof ProviderError ? error.reason : 'unexpected',
      },
      'card provider request failed',
    );
    await dbRef.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(cardOperations)
        .where(eq(cardOperations.id, op.id))
        .for('update');
      if (!current || current.status !== 'submitting') return;
      const notSent = outcome === 'not_sent';
      const rejected = outcome === 'rejected';
      // `not_sent` (nothing left this process) is the only case that goes back to `created`.
      const status: CardOpStatus = notSent ? 'created' : rejected ? 'failed' : 'review';
      await setOperation(tx, current, status, {
        leaseUntil: null,
        attempts: notSent ? 0 : current.attempts,
        error: writesOff ? 'LIVE_WRITES_DISABLED' : rejected ? REJECTED_TEXT : notSent ? null : REVIEW_TEXT,
      });
      if (op.kind === 'issue' && rejected) await setCardStatus(tx, op.cardId, 'failed');
    });
    return true;
  }
  await applySubmitResult(op, result);
  return true;
}

async function applySubmitResult(op: OpRow, result: unknown) {
  try {
    const data = record(result);
    const info = normalizeCard(data);
    const balanceFunded = data.funded_from === 'balance';
    const network = op.network === 'tron' ? 'tron' : 'bsc';
    const invoice = balanceFunded ? null : normalizeInvoice(data, network);
    await dbRef.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(cardOperations)
        .where(eq(cardOperations.id, op.id))
        .for('update');
      const [card] = await tx.select().from(cards).where(eq(cards.id, op.cardId)).for('update');
      if (!current || !card) return;
      if (!info.providerCardId || (card.providerCardId && card.providerCardId !== info.providerCardId))
        throw new Error('Card correlation mismatch');
      if (info.clientCardRef && info.clientCardRef !== card.clientCardRef)
        throw new Error('Card reference mismatch');
      const stored = invoiceOf(current);
      const hasInvoice = Boolean(invoice?.payAddress && invoice.payAmount);
      let status: CardOpStatus = op.kind === 'issue' ? issueToOp(info.issueStatus) : 'awaiting_payment';
      if (balanceFunded || (!hasInvoice && !stored && status === 'awaiting_payment')) status = 'review';
      const extra: Partial<typeof cardOperations.$inferInsert> = {
        leaseUntil: null,
        error: balanceFunded ? FUNDING_REVIEW : status === 'review' ? REVIEW_TEXT : null,
      };
      // The invoice only appears in the FIRST response: persist it now, never erase it later.
      if (invoice && hasInvoice && !stored) {
        const value: StoredInvoice = {
          payAddress: invoice.payAddress as string,
          payAmount: invoice.payAmount as string,
          payCurrency: invoice.payCurrency,
          network,
          expiresAt: invoice.expiresAt ?? later(60 * 60_000).toISOString(),
          ...(invoice.paymentId ? { paymentId: invoice.paymentId } : {}),
          ...(invoice.topupId ? { topupId: invoice.topupId } : {}),
          ...(invoice.url ? { url: invoice.url } : {}),
          ...(invoice.amountUsd ? { amountUsd: invoice.amountUsd } : {}),
          ...(invoice.amountOnCardUsd ? { amountOnCardUsd: invoice.amountOnCardUsd } : {}),
        };
        extra.invoice = { ...record(current.invoice), ...value };
      }
      const txnId = op.kind === 'topup' ? identifier(data.transaction_id) : null;
      if (txnId) extra.providerTxnId = txnId;
      await setOperation(tx, current, status, extra);
      await setCardStatus(tx, card.id, balanceFunded ? 'pending_payment' : issueToCard(info.issueStatus), {
        providerCardId: info.providerCardId,
      });
      if (op.kind === 'issue' && !balanceFunded)
        await tx.update(cards).set({ syncedAt: null }).where(eq(cards.id, card.id));
    });
  } catch (error) {
    // The mutation may have been accepted. Keep what correlates, mark review, never resend.
    logger.warn(
      { operationId: op.id, reason: error instanceof Error ? error.message.slice(0, 120) : 'unknown' },
      'card provider response could not be applied',
    );
    await dbRef.db
      .update(cardOperations)
      .set({ status: 'review', error: REVIEW_TEXT, leaseUntil: null, updatedAt: new Date() })
      .where(and(eq(cardOperations.id, op.id), sql`${cardOperations.status} not in ('completed')`));
  }
}

/** Operations whose request outcome is unknowable after a crash/lease timeout: review, never resend. */
export async function recoverExpiredLeases() {
  await dbRef.db
    .update(cardOperations)
    .set({ status: 'review', error: REVIEW_TEXT, leaseUntil: null, updatedAt: new Date() })
    .where(and(eq(cardOperations.status, 'submitting'), lt(cardOperations.leaseUntil, new Date())));
}

/** Unpaid invoices past expiry: nothing paid -> expired; bridge in flight/filled -> review. */
export async function expireInvoices() {
  const rows = await dbRef.db
    .select()
    .from(cardOperations)
    .where(eq(cardOperations.status, 'awaiting_payment'));
  for (const op of rows) {
    const inv = invoiceOf(op);
    if (!inv || new Date(inv.expiresAt).getTime() >= Date.now()) continue;
    await dbRef.db.transaction(async (tx) => {
      const [cur] = await tx.select().from(cardOperations).where(eq(cardOperations.id, op.id)).for('update');
      if (!cur || cur.status !== 'awaiting_payment') return;
      const orders = await tx
        .select({ status: relayOrders.status })
        .from(relayOrders)
        .where(eq(relayOrders.cardOperationId, op.id));
      const inFlight = orders.some((o) => ['submitted', 'pending', 'success'].includes(o.status));
      if (inFlight) {
        await setOperation(tx, cur, 'review');
        return;
      }
      await setOperation(tx, cur, 'expired', {
        error: 'The invoice expired. Nothing was paid; create a new one.',
      });
      if (op.kind === 'issue') await setCardStatus(tx, op.cardId, 'failed');
    });
  }
  // Paid (processing) but no provider confirmation long after the invoice expired: a human decides.
  const processing = await dbRef.db
    .select()
    .from(cardOperations)
    .where(eq(cardOperations.status, 'processing'));
  for (const op of processing) {
    const inv = invoiceOf(op);
    if (!inv || new Date(inv.expiresAt).getTime() + cardSettings.processingGraceMs >= Date.now()) continue;
    await updateOperation(op.id, 'review');
  }
}

// -------------------------------------------------------------- card sync

export async function syncOneCard() {
  const now = Date.now();
  const [card] = await dbRef.db
    .select()
    .from(cards)
    .where(
      and(
        sql`${cards.providerCardId} is not null`,
        sql`${cards.status} <> 'failed'`,
        or(
          isNull(cards.syncedAt),
          and(eq(cards.status, 'issued'), lt(cards.syncedAt, new Date(now - 120_000))),
          and(sql`${cards.status} <> 'issued'`, lt(cards.syncedAt, new Date(now - 15_000))),
        ),
      ),
    )
    .orderBy(sql`${cards.syncedAt} asc nulls first`)
    .limit(1);
  if (!card?.providerCardId) return;
  // Back off first so a failing provider call cannot become a retry loop on the same card.
  await dbRef.db
    .update(cards)
    .set({ syncedAt: new Date(now - 100_000) })
    .where(eq(cards.id, card.id));
  const value = await provider.card(card.providerCardId);
  const info = normalizeCard(value);
  if (
    !info.providerCardId ||
    info.providerCardId !== card.providerCardId ||
    (info.clientCardRef && info.clientCardRef !== card.clientCardRef)
  ) {
    throw new Error('Card correlation mismatch');
  }
  await dbRef.db.transaction(async (tx) => {
    const incoming = issueToCard(info.issueStatus);
    const balance = decimalToCents(info.balanceUsd);
    await setCardStatus(tx, card.id, incoming, {
      ...(info.last4 ? { last4: info.last4 } : {}),
      ...(balance !== null ? { balanceUsdCents: balance } : {}),
      ...(info.issuedAt ? { issuedAt: new Date(info.issuedAt) } : {}),
      syncedAt: new Date(),
    });
    const [issue] = await tx
      .select()
      .from(cardOperations)
      .where(and(eq(cardOperations.cardId, card.id), eq(cardOperations.kind, 'issue')))
      .for('update');
    if (issue && info.issueStatus !== 'unknown' && info.issueStatus !== 'pending_payment') {
      await setOperation(tx, issue, issueToOp(info.issueStatus));
    }
  });
}

/** Read-only recovery by the immutable client_card_ref after an unknown issue outcome. */
export async function recoverUnmatchedCards() {
  const unmatched = await dbRef.db
    .select()
    .from(cards)
    .where(and(isNull(cards.providerCardId), eq(cards.status, 'pending_payment')));
  const reviewing: typeof unmatched = [];
  for (const c of unmatched) {
    const [op] = await dbRef.db
      .select()
      .from(cardOperations)
      .where(
        and(
          eq(cardOperations.cardId, c.id),
          eq(cardOperations.kind, 'issue'),
          eq(cardOperations.status, 'review'),
        ),
      )
      .limit(1);
    if (op) reviewing.push(c);
  }
  if (!reviewing.length) return;
  const redis = getRedis();
  const key = `cards:recovery-page:${providerScope()}`;
  const page = Math.max(1, Math.min(10_000, Number(await redis.get(key)) || 1));
  const value = record(await provider.cards(page));
  const list = Array.isArray(value.cards) ? value.cards : [];
  for (const item of list) {
    const info = normalizeCard(item);
    const local = reviewing.find((r) => r.clientCardRef === info.clientCardRef);
    if (!local || !info.providerCardId) continue;
    await dbRef.db
      .update(cards)
      .set({ providerCardId: info.providerCardId, syncedAt: null })
      .where(and(eq(cards.id, local.id), isNull(cards.providerCardId)))
      .catch(() => {});
  }
  const pages = Number(value.total_pages);
  await redis.set(
    key,
    String(Number.isSafeInteger(pages) && page < pages && list.length ? page + 1 : 1),
    'EX',
    86_400,
  );
}

// ------------------------------------------------------------ transactions

export async function syncOneHistory() {
  const redis = getRedis();
  const issued = await dbRef.db
    .select()
    .from(cards)
    .where(and(eq(cards.status, 'issued'), sql`${cards.providerCardId} is not null`));
  for (const card of issued) {
    if (!(await redis.set(`cards:txsync:${card.id}`, '1', 'EX', 300, 'NX'))) continue;
    let offset = 0;
    for (let page = 0; page < 5; page++) {
      const raw = record(await provider.transactions(card.providerCardId as string, offset));
      if (raw.card_id && raw.card_id !== card.providerCardId) throw new Error('History correlation mismatch');
      const list = Array.isArray(raw.transactions) ? raw.transactions : [];
      for (const item of list) {
        const tx = normalizeTransaction(item);
        if (!tx) continue;
        await dbRef.db
          .insert(cardTransactions)
          .values({
            cardId: card.id,
            providerTxnId: tx.providerTxnId,
            amountCents: tx.direction === 'credit' ? tx.amountCents : -tx.amountCents,
            currency: tx.currency,
            merchant: tx.merchant,
            status: tx.status,
            occurredAt: new Date(tx.occurredAt),
            raw: { status: tx.status, direction: tx.direction },
          })
          .onConflictDoUpdate({
            target: cardTransactions.providerTxnId,
            set: { status: tx.status, amountCents: sql`excluded.amount_cents`, merchant: tx.merchant },
            setWhere: sql`${cardTransactions.status} in ('pending', 'unknown') or ${cardTransactions.status} = excluded.status`,
          });
      }
      const total = Number(record(raw.pagination).total);
      offset += list.length;
      if (!list.length || !Number.isSafeInteger(total) || offset >= total) break;
    }
    return;
  }
}

// ------------------------------------------------------------ webhook inbox

type Meta = { _attempts?: number; _nextAt?: string; _firstSeen?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function processOneEvent(): Promise<boolean> {
  const rows = await dbRef.db
    .select()
    .from(cardWebhookEvents)
    .where(isNull(cardWebhookEvents.processedAt))
    .orderBy(asc(cardWebhookEvents.id))
    .limit(50);
  const event = rows.find((r) => {
    const next = (record(r.payload) as Meta)._nextAt;
    return !next || new Date(next).getTime() <= Date.now();
  });
  if (!event) return false;
  const payload = record(event.payload) as Record<string, unknown> & Meta;
  const defer = async (error: string) => {
    const attempts = (payload._attempts ?? 0) + 1;
    const first = payload._firstSeen ? new Date(payload._firstSeen).getTime() : Date.now();
    if (Date.now() - first > 24 * 3600_000) {
      await dbRef.db
        .update(cardWebhookEvents)
        .set({ processedAt: new Date(), error: 'unmatched' })
        .where(eq(cardWebhookEvents.id, event.id));
      return;
    }
    await dbRef.db
      .update(cardWebhookEvents)
      .set({
        error,
        payload: {
          ...payload,
          _attempts: attempts,
          _nextAt: later(Math.min(3_600_000, 15_000 * 2 ** Math.min(attempts, 8))).toISOString(),
        },
      })
      .where(eq(cardWebhookEvents.id, event.id));
  };
  try {
    const handled = await dbRef.db.transaction(async (tx) => {
      const providerCardId = identifier(payload.card_id);
      const ref = identifier(payload.client_card_ref);
      const clientRef = ref && UUID.test(ref) ? ref : null;
      const matchers = [
        providerCardId ? eq(cards.providerCardId, providerCardId) : undefined,
        clientRef ? eq(cards.clientCardRef, clientRef) : undefined,
      ].filter((m) => m !== undefined);
      const found = matchers.length
        ? await tx
            .select()
            .from(cards)
            .where(or(...matchers))
            .for('update')
        : [];
      const card = found.length === 1 ? found[0] : undefined;
      if (!card || (providerCardId && card.providerCardId && providerCardId !== card.providerCardId))
        return false;
      if (!card.providerCardId && providerCardId) {
        await tx.update(cards).set({ providerCardId }).where(eq(cards.id, card.id));
      }
      const type = event.type ?? '';
      if (type === 'card.paid' && identifier(payload.topup_id)) {
        const [op] = await findTopup(tx, card.id, payload, null);
        if (!op) return false;
        await setOperation(tx, op, 'processing');
      } else if (type === 'card.paid' || type === 'card.issued' || type === 'card.failed') {
        const [op] = await tx
          .select()
          .from(cardOperations)
          .where(and(eq(cardOperations.cardId, card.id), eq(cardOperations.kind, 'issue')))
          .for('update');
        if (!op) return false;
        if (type === 'card.paid') {
          await setOperation(tx, op, 'processing');
          await setCardStatus(tx, card.id, 'paid_pending_issue');
        } else if (type === 'card.issued') {
          await setOperation(tx, op, 'completed');
          await setCardStatus(tx, card.id, 'issued', { issuedAt: card.issuedAt ?? new Date() });
        } else {
          await setOperation(tx, op, 'failed', { error: REJECTED_TEXT });
          await setCardStatus(tx, card.id, 'failed');
        }
      } else if (type === 'topup.completed') {
        const txnId = identifier(payload.transaction_id);
        if (txnId) {
          // A transaction id already recorded on any operation is a replay: it may only (re)confirm that
          // very operation while it is still open on this card, never another one.
          const [seen] = await tx
            .select()
            .from(cardOperations)
            .where(eq(cardOperations.providerTxnId, txnId));
          if (seen && (seen.cardId !== card.id || seen.kind !== 'topup' || seen.status === 'completed')) {
            logger.warn({ eventId: event.id }, 'duplicate topup.completed transaction_id dropped');
            await tx
              .update(cardWebhookEvents)
              .set({ processedAt: new Date(), error: 'duplicate transaction_id' })
              .where(eq(cardWebhookEvents.id, event.id));
            return true;
          }
        }
        const [op] = await findTopup(tx, card.id, payload, txnId, payload._firstSeen as string | undefined);
        if (!op) return false;
        await setOperation(tx, op, 'completed', txnId && !op.providerTxnId ? { providerTxnId: txnId } : {});
        await getRedis()
          .del(`cards:txsync:${card.id}`)
          .catch(() => {});
      } else if (type === 'card.transaction') {
        const t = record(payload.transaction);
        if (typeof t.providerTxnId === 'string' && typeof t.occurredAt === 'string') {
          await tx
            .insert(cardTransactions)
            .values({
              cardId: card.id,
              providerTxnId: t.providerTxnId,
              amountCents: (t.direction === 'credit' ? 1n : -1n) * BigInt(String(t.amountCents ?? '0')),
              currency: String(t.currency ?? 'USD'),
              merchant: typeof t.merchant === 'string' ? t.merchant : null,
              status: String(t.status ?? 'unknown'),
              occurredAt: new Date(t.occurredAt),
              raw: { status: t.status, direction: t.direction },
            })
            .onConflictDoNothing();
        }
      }
      // Events only schedule a fresh read; an event never writes an absolute balance.
      await tx.update(cards).set({ syncedAt: null }).where(eq(cards.id, card.id));
      await tx
        .update(cardWebhookEvents)
        .set({ processedAt: new Date(), error: null })
        .where(eq(cardWebhookEvents.id, event.id));
      return true;
    });
    if (!handled) await defer('Awaiting matching provider identifiers.');
  } catch (error) {
    logger.warn(
      { eventId: event.id, reason: error instanceof Error ? error.message.slice(0, 120) : 'unknown' },
      'card event failed',
    );
    await defer('Event reconciliation requires a later retry.');
  }
  return true;
}

/**
 * The topup an event refers to. `topup.completed` from izipay carries only card_id + transaction_id, so when no
 * id matches, the card's single open top-up (at most one per card by construction) is the match.
 */
async function findTopup(
  tx: Tx,
  cardId: string,
  payload: Record<string, unknown>,
  txnId: string | null,
  firstSeen?: string,
): Promise<OpRow[]> {
  const ops = await tx
    .select()
    .from(cardOperations)
    .where(
      and(
        eq(cardOperations.cardId, cardId),
        eq(cardOperations.kind, 'topup'),
        inArray(cardOperations.status, ['awaiting_payment', 'processing', 'review']),
      ),
    )
    .for('update');
  const paymentId = identifier(payload.payment_id);
  const topupId = identifier(payload.topup_id);
  const byId = ops.filter((o) => {
    const inv = invoiceOf(o);
    return (
      (paymentId && inv?.paymentId === paymentId) ||
      (topupId && inv?.topupId === topupId) ||
      (txnId && o.providerTxnId === txnId)
    );
  });
  if (byId.length === 1) return byId;
  // Fallback: the card's single open top-up, only if it was submitted before the event arrived and the
  // event carries a transaction id to record on it.
  const seenAt = firstSeen ? new Date(firstSeen).getTime() : Number.NaN;
  const only = ops[0];
  if (
    byId.length === 0 &&
    ops.length === 1 &&
    only &&
    txnId &&
    !paymentId &&
    !topupId &&
    !only.providerTxnId &&
    invoiceOf(only) &&
    only.createdAt.getTime() < seenAt
  ) {
    return ops;
  }
  return [];
}

// ------------------------------------------------------------------- tick

export async function runCardsMaintenance(extra: Array<() => Promise<unknown>> = []) {
  if (!cardsEnabled()) return;
  const redis = getRedis();
  const token = randomUUID();
  const key = `cards:maintenance:${providerScope()}`;
  if (!(await redis.set(key, token, 'EX', 180, 'NX'))) return;
  try {
    await recoverExpiredLeases();
    for (let i = 0; i < 10; i++) if (!(await processOneEvent())) break;
    for (let i = 0; i < 3; i++) if (!(await submitOne())) break;
    for (const task of [
      ...extra,
      expireInvoices,
      syncOneCard,
      recoverUnmatchedCards,
      syncOneHistory,
      () => getPricing(),
    ]) {
      try {
        await task();
      } catch (error) {
        logger.debug(
          { reason: error instanceof Error ? error.message.slice(0, 80) : 'unknown' },
          'cards task failed; retried next tick',
        );
      }
    }
  } finally {
    await redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
      1,
      key,
      token,
    );
  }
}
