import { parseSiweMessage } from 'viem/siwe';
import { env } from '../../../env';
import { ApiError } from '../../errors';
import type { MockFixtures } from '../mock';

const KEY = 'spindle-mock-session';
const CHAIN_ID = env.chainId;

export interface MockSession {
  address: string;
  freshUntil: number;
}

export function readMockSession(): MockSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as MockSession) : null;
  } catch {
    return null;
  }
}
function writeMockSession(s: MockSession | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage unavailable: session lives only for this page
  }
}

const iso = (ms: number) => new Date(ms).toISOString();

function addressFromMessage(body: unknown): string {
  const message = (body as { message?: string } | undefined)?.message ?? '';
  const parsed = parseSiweMessage(message);
  if (!parsed.address) throw new ApiError('VALIDATION', 'Invalid SIWE message', 400);
  return parsed.address.toLowerCase();
}

export const authFixtures: MockFixtures = {
  'GET /v1/auth/nonce': () => ({ nonce: Math.random().toString(36).slice(2, 12).padEnd(10, 'x') }),
  'POST /v1/auth/verify': ({ body }) => {
    const address = addressFromMessage(body);
    const expires = Date.now() + 7 * 864e5;
    writeMockSession({ address, freshUntil: Date.now() + 10 * 60_000 });
    return { address, expiresAt: iso(expires) };
  },
  'GET /v1/auth/session': () => {
    const s = readMockSession();
    if (!s) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
    return { address: s.address, chainId: CHAIN_ID, fresh: s.freshUntil > Date.now() };
  },
  'POST /v1/auth/reauth': ({ body }) => {
    const s = readMockSession();
    if (!s) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
    addressFromMessage(body);
    const freshUntil = Date.now() + 10 * 60_000;
    writeMockSession({ ...s, freshUntil });
    return { freshUntil: iso(freshUntil) };
  },
  'POST /v1/auth/logout': () => {
    writeMockSession(null);
    return undefined;
  },
};
