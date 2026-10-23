import { and, eq, gt } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sessions, users } from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { dbRef, RENEW_BELOW_MS, SESSION_COOKIE, SESSION_MS, SESSION_SECONDS, settings } from './constants';
import { sha256Hex } from './service';

export { rateLimit } from '../../lib/ratelimit';

export function readSessionToken(c: Context): string | undefined {
  const token = getCookie(c, SESSION_COOKIE);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: settings.cookieSecure,
    sameSite: 'Lax' as const,
    path: '/',
    ...(settings.cookieDomain ? { domain: settings.cookieDomain } : {}),
  };
}

export function setSessionCookie(c: Context, token: string): void {
  c.header('cache-control', 'private, no-store');
  setCookie(c, SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_SECONDS });
}

export function clearSessionCookie(c: Context): void {
  c.header('cache-control', 'private, no-store');
  deleteCookie(c, SESSION_COOKIE, cookieOptions());
}

/** Loads the cookie session + user, renews the sliding window. Never rejects; use requireSession. */
export const sessionLoader: MiddlewareHandler<Env> = async (c, next) => {
  const token = readSessionToken(c);
  if (token) {
    const now = new Date();
    const [row] = await dbRef.db
      .select({
        id: sessions.id,
        expiresAt: sessions.expiresAt,
        freshUntil: sessions.freshUntil,
        address: users.address,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256Hex(token)), gt(sessions.expiresAt, now)))
      .limit(1);
    if (row) {
      c.set('user', { address: row.address });
      c.set('session', { address: row.address, freshUntil: row.freshUntil?.getTime() ?? 0 });
      // Renewing pushes expires_at to +30d, so this fires at most once per 15 days (well under 1/hour).
      if (row.expiresAt.getTime() - now.getTime() < RENEW_BELOW_MS && c.req.path !== '/v1/auth/logout') {
        const [renewed] = await dbRef.db
          .update(sessions)
          .set({ expiresAt: new Date(now.getTime() + SESSION_MS) })
          .where(and(eq(sessions.id, row.id), gt(sessions.expiresAt, now)))
          .returning({ id: sessions.id });
        if (renewed) setSessionCookie(c, token);
      }
      c.header('cache-control', 'private, no-store');
    }
  }
  await next();
};

export const requireSession: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.get('user') || !c.get('session')) {
    throw new AppError('UNAUTHENTICATED', 'Please sign in with your wallet.');
  }
  await next();
};

export const requireFreshAuth: MiddlewareHandler<Env> = async (c, next) => {
  const session = c.get('session');
  if (!c.get('user') || !session) throw new AppError('UNAUTHENTICATED', 'Please sign in with your wallet.');
  if (session.freshUntil <= Date.now()) {
    throw new AppError('REAUTH_REQUIRED', 'Please confirm this action in your wallet.');
  }
  await next();
};

export const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
  const user = c.get('user');
  if (!user || !c.get('session')) throw new AppError('UNAUTHENTICATED', 'Please sign in with your wallet.');
  if (!settings.adminAddresses.includes(user.address.toLowerCase())) {
    throw new AppError('FORBIDDEN', 'Admin access required.');
  }
  await next();
};

/**
 * Mutating requests need `x-spindle: 1` and an allowlisted Origin. Mounted only on cookie-authenticated
 * prefixes, so webhooks and buyer API routes (API key / x402) are never subject to it.
 */
export const csrf: MiddlewareHandler<Env> = async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (c.req.header('x-spindle') !== '1' || !origin || !settings.corsOrigins.includes(origin)) {
      throw new AppError('FORBIDDEN', 'Cross-site request blocked.');
    }
  }
  await next();
};
