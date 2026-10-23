import { config } from '../../config';
import { db } from '../../db/client';

export {
  SIWE_STATEMENT_LOGIN as LOGIN_STATEMENT,
  SIWE_STATEMENT_REAUTH as REAUTH_STATEMENT,
} from '../../shared/api/auth';

export const SESSION_COOKIE = 'spindle_session';
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_MS = SESSION_SECONDS * 1000;
export const RENEW_BELOW_MS = 15 * 24 * 60 * 60 * 1000;
export const FRESH_MS = 10 * 60 * 1000;
export const NONCE_TTL_SEC = 300;

/** Runtime settings, read through this object so tests can override them (config is frozen). */
export const settings = {
  corsOrigins: [...config.CORS_ORIGINS] as string[],
  allowedDomains: [...config.SIWE_ALLOWED_DOMAINS] as string[],
  adminAddresses: [...config.ADMIN_ADDRESSES] as string[],
  chainId: config.CHAIN_ID,
  cookieDomain: config.COOKIE_DOMAIN,
  cookieSecure: config.COOKIE_SECURE,
};

/** Paths guarded by the session loader and CSRF. Webhooks and buyer API routes are deliberately absent. */
export const COOKIE_AUTH_PATHS = ['/v1/app/*', '/v1/auth/*', '/v1/admin/*'] as const;

/** Database handle used by the auth module; tests swap it for the throwaway test database. */
export const dbRef: { db: typeof db } = { db };
