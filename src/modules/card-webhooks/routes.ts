import type { Hono } from 'hono';
import { cardWebhookEvents } from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { logger } from '../../lib/logger';
import { dbRef } from '../auth/constants';
import { deliverOtp } from '../cards/applePay';
import { otpFromEvent, parseProviderJson, sanitizeEvent, sha256, verifyWebhook } from '../cards/domain';
import { assertProductionSafe, cardSettings } from '../cards/settings';

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
    if (otp) {
      // The code never touches the database: keep only a code-free marker row for dedupe.
      const kept = await deliverOtp({ providerCardId: otp.cardId, code: otp.code });
      logger.info({ kept }, 'card otp delivered');
    }
    await dbRef.db
      .insert(cardWebhookEvents)
      .values({
        providerEventId: event.eventId,
        payloadHash: sha256(raw),
        type: event.type,
        payload: { ...event.payload, _firstSeen: new Date().toISOString() },
        // card.otp has nothing for the reconcile loop to do.
        processedAt: event.type === 'card.otp' ? new Date() : null,
      })
      .onConflictDoNothing();
    return c.json({ received: true as const });
  });
}
