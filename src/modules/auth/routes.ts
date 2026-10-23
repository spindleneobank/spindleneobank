import type { Hono } from 'hono';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { clientIp, hashIp, ipKey, rateLimit } from '../../lib/ratelimit';
import { PostAuthReauthReq, PostAuthVerifyReq } from '../../shared/api/auth';
import { COOKIE_AUTH_PATHS, LOGIN_STATEMENT, REAUTH_STATEMENT, settings } from './constants';
import {
  clearSessionCookie,
  csrf,
  readSessionToken,
  requireSession,
  sessionLoader,
  setSessionCookie,
} from './middleware';
import { createNonce, createSession, deleteSession, refreshFreshAuth, verifySiwe } from './service';

const ipLimit = rateLimit({ name: 'auth_ip', key: ipKey, points: 30, windowSec: 60 });

async function parseBody(c: { req: { json: () => Promise<unknown> } }, schema: typeof PostAuthVerifyReq) {
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AppError('VALIDATION', 'Invalid request body.', 400, parsed.error.issues);
  return parsed.data;
}

export default function auth(app: Hono<Env>): void {
  for (const path of COOKIE_AUTH_PATHS) {
    app.use(path, csrf);
    app.use(path, sessionLoader);
  }

  app.get('/v1/auth/nonce', ipLimit, async (c) => {
    c.header('cache-control', 'no-store');
    return c.json({ nonce: await createNonce() });
  });

  app.post('/v1/auth/verify', ipLimit, async (c) => {
    const { message, signature } = await parseBody(c, PostAuthVerifyReq);
    const address = await verifySiwe(message, signature as `0x${string}`, {
      expectedStatement: LOGIN_STATEMENT,
    });
    const { token, expiresAt } = await createSession(address, {
      userAgent: c.req.header('user-agent'),
      ipHash: hashIp(clientIp(c)),
    });
    setSessionCookie(c, token);
    return c.json({ address: address.toLowerCase(), expiresAt: expiresAt.toISOString() });
  });

  app.get('/v1/auth/session', requireSession, (c) => {
    const session = c.get('session');
    if (!session) throw new AppError('UNAUTHENTICATED', 'Please sign in with your wallet.');
    return c.json({
      address: session.address,
      chainId: settings.chainId,
      fresh: session.freshUntil > Date.now(),
    });
  });

  app.post('/v1/auth/reauth', ipLimit, requireSession, async (c) => {
    const { message, signature } = await parseBody(c, PostAuthReauthReq);
    const session = c.get('session');
    if (!session) throw new AppError('UNAUTHENTICATED', 'Please sign in with your wallet.');
    await verifySiwe(message, signature as `0x${string}`, {
      expectedAddress: session.address,
      expectedStatement: REAUTH_STATEMENT,
    });
    const freshUntil = await refreshFreshAuth(readSessionToken(c) ?? '', session.address);
    return c.json({ freshUntil: freshUntil.toISOString() });
  });

  app.post('/v1/auth/logout', async (c) => {
    const token = readSessionToken(c);
    if (token) await deleteSession(token);
    clearSessionCookie(c);
    return c.body(null, 204);
  });
}
