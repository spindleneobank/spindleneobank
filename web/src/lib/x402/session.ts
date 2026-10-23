import * as api from '@spindle/shared/api';
import type { Address } from 'viem';
import { x402Fetch } from './http';

export const CAP_OPTIONS_MICROS = [500_000n, 1_000_000n, 2_000_000n, 5_000_000n] as const;
export const DEFAULT_CAP_MICROS = 1_000_000n;
export const SESSION_TTL_SEC = 3600;

export const x402Sessions = {
  create: (payer: Address, capMicros: bigint, ttlSec = SESSION_TTL_SEC, signal?: AbortSignal) =>
    x402Fetch('/v1/x402/sessions', {
      schema: api.PostX402SessionsRes,
      method: 'POST',
      body: { payer: payer.toLowerCase(), capMicros: capMicros.toString(), ttlSec },
      signal,
    }),
  open: (sessionId: string, signature: string, signal?: AbortSignal) =>
    x402Fetch(`/v1/x402/sessions/${sessionId}/open`, {
      schema: api.PostX402SessionOpenRes,
      method: 'POST',
      body: { signature },
      signal,
    }),
  get: (sessionId: string, token: string, signal?: AbortSignal) =>
    x402Fetch(`/v1/x402/sessions/${sessionId}`, { schema: api.GetX402SessionRes, token, signal }),
  close: (sessionId: string, token: string) =>
    x402Fetch(`/v1/x402/sessions/${sessionId}/close`, {
      schema: api.PostX402SessionCloseRes,
      method: 'POST',
      token,
    }),
};

/** Stored in sessionStorage only (UI convenience; the token never touches localStorage). */
export interface StoredSession {
  sessionId: string;
  token: string;
  address: string;
  capMicros: string;
  surchargeMicros: string;
  expiresAt: string;
}
const skey = (address: string) => `spindle.chat.session:${address.toLowerCase()}`;

export function loadStoredSession(address: string, now = Date.now()): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(skey(address));
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    if (!s.token || Date.parse(s.expiresAt) <= now) {
      sessionStorage.removeItem(skey(address));
      return null;
    }
    return s;
  } catch {
    return null;
  }
}
export function saveStoredSession(s: StoredSession): void {
  try {
    sessionStorage.setItem(skey(s.address), JSON.stringify(s));
  } catch {
    // session lives in memory only
  }
}
export function clearStoredSession(address: string): void {
  try {
    sessionStorage.removeItem(skey(address));
  } catch {
    // ignore
  }
}
