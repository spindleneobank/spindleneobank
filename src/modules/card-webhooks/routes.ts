import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { cardWebhookEvents } from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { logger } from '../../lib/logger';
import { dbRef } from '../auth/constants';
import { deliverOtp } from '../cards/applePay';
import { otpFromEvent, parseProviderJson, sanitizeEvent, sha256, verifyWebhook } from '../cards/domain';
import { assertProductionSafe, cardSettings, providerScope } from '../cards/settings';

const MAX_BODY = 64 * 1024;

/**
 * POST /v1/webhooks/izipay. Raw body is read before any JSON parsing; the HMAC is checked in constant time.
 * Stored events are allowlisted ids only: OTP codes go straight to the encrypted Redis cache, never to the DB.
 */
export default function cardWebhooks(app: Hono<Env>): void {
  assertProductionSafe();
  app.post('/v1/webhooks/izipay', async (c) => {
    c.header('cache-control', 'no-store');
    const raw = Buffer.from(await c.req.arrayBuffer());
    if (raw.length > MAX_BODY) throw new AppError('VALIDATION', 'Payload too large.', 413);
    if (!verifyWebhook(cardSettings.webhookSecret, raw, c.req.header('x-izipay-signature'))) {
      throw new AppError('UNAUTHENTICATED', 'Invalid signature.');
    }
    let event: ReturnType<typeof sanitizeEvent>;
    let otp: ReturnType<typeof otpFromEvent>;
    try {
      const parsed = parseProviderJson(raw.toString('utf8'));
      event = sanitizeEvent(parsed);
      otp = otpFromEvent(parsed);
    } catch {
      throw new AppError('VALIDATION', 'Invalid card event.');
    }
    const payloadHash = sha256(raw);
    const scope = providerScope();
    // Dedupe row first (no OTP code in it), then deliver. An identical redelivery is a no-op for the inbox but
    // still delivers: Redis delivery is newest-wins idempotent and an earlier attempt may have failed after the insert.
    const [inserted] = await dbRef.db
      .insert(cardWebhookEvents)
      .values({
        providerScope: scope,
        providerEventId: event.eventId,
        payloadHash,
        type: event.type,
        eventAt: event.eventAt ? new Date(event.eventAt) : null,
        payload: { ...event.payload, _firstSeen: new Date().toISOString() },
        // card.otp has nothing for the reconcile loop to do.
        processedAt: event.type === 'card.otp' ? new Date() : null,
      })
      .onConflictDoNothing({ target: [cardWebhookEvents.providerScope, cardWebhookEvents.providerEventId] })
      .returning({ id: cardWebhookEvents.id });
    if (!inserted) {
      const [previous] = await dbRef.db
        .select({ hash: cardWebhookEvents.payloadHash })
        .from(cardWebhookEvents)
        .where(
          and(
            eq(cardWebhookEvents.providerScope, scope),
            eq(cardWebhookEvents.providerEventId, event.eventId),
          ),
        );
      if (!previous || previous.hash !== payloadHash)
        throw new AppError('CONFLICT', 'This card event ID already has a different payload.', 409);
    }
    if (otp) {
      // Synchronous so the code is visible at once; a failure (5xx) is retried by izipay.
      const kept = await deliverOtp({ providerCardId: otp.cardId, code: otp.code, eventAt: event.eventAt });
      logger.info({ kind: otp.kind, kept }, 'card otp delivered');
    }
    return c.json({ received: true as const });
  });
}
