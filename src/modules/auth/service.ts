import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { type Address, type Hex, isAddress } from 'viem';
import { parseSiweMessage } from 'viem/siwe';
import { sessions, users } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { getRedis } from '../../lib/redis';
import { RpcError } from '../../lib/rpcPool';
import { publicClient } from '../../lib/viem';
import { dbRef, FRESH_MS, LOGIN_STATEMENT, NONCE_TTL_SEC, SESSION_MS, settings } from './constants';

export { LOGIN_STATEMENT, REAUTH_STATEMENT } from './constants';

const INVALID_MESSAGE = 'We could not verify your wallet signature. Please try again.';
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

export type SiweDependencies = {
  consumeNonce: (nonce: string) => Promise<number>;
  verifySignature: (message: string, signature: Hex) => Promise<boolean>;
  now: () => Date;
};

/** Verifier client (B3's pooled viem client, supports ERC-1271/6492 via eth_call). */
export function getVerifierClient() {
  return publicClient;
}

/** Mutable so tests can override pieces. */
export const siweDeps: SiweDependencies = {
  consumeNonce: (nonce) => getRedis().del(`siwe:nonce:${nonce}`),
  verifySignature: (message, signature) => getVerifierClient().verifySiweMessage({ message, signature }),
  now: () => new Date(),
};

function invalid(check: string): never {
  logger.warn({ check }, 'SIWE verification rejected');
  throw new AppError('UNAUTHENTICATED', INVALID_MESSAGE);
}

function isRpcFailure(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (
      current instanceof RpcError ||
      (current instanceof AppError && current.code === 'UPSTREAM_UNAVAILABLE')
    ) {
      return true;
    }
    if (!current || typeof current !== 'object' || !('cause' in current)) return false;
    current = current.cause;
  }
  return false;
}

export function randomAlnum(length: number): string {
  // 256 % 62 != 0; reject the biased tail.
  let out = '';
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < 248 && out.length < length) out += ALNUM[b % 62];
    }
  }
  return out;
}

export async function createNonce(): Promise<string> {
  const nonce = randomAlnum(24);
  await getRedis().set(`siwe:nonce:${nonce}`, '1', 'EX', NONCE_TTL_SEC);
  return nonce;
}

export async function verifySiwe(
  message: string,
  signature: Hex,
  options: { expectedAddress?: string; expectedStatement?: string } = {},
): Promise<Address> {
  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(message);
  } catch {
    return invalid('parse');
  }
  if (
    !parsed.domain ||
    !parsed.address ||
    !parsed.uri ||
    !parsed.nonce ||
    !parsed.issuedAt ||
    !parsed.version ||
    !parsed.chainId ||
    !isAddress(parsed.address) ||
    !/^[A-Za-z0-9]{16,}$/.test(parsed.nonce)
  ) {
    invalid('required_fields');
  }
  if (!settings.allowedDomains.includes(parsed.domain)) invalid('domain');

  let origin: string;
  try {
    const uri = new URL(parsed.uri);
    if (!['http:', 'https:'].includes(uri.protocol)) invalid('uri_scheme');
    origin = uri.origin;
  } catch {
    return invalid('uri');
  }
  if (!settings.corsOrigins.includes(origin)) invalid('uri_origin');
  if (parsed.chainId !== settings.chainId) invalid('chain');
  if (parsed.version !== '1') invalid('version');
  if (parsed.statement !== (options.expectedStatement ?? LOGIN_STATEMENT)) invalid('statement');

  const nowMs = siweDeps.now().getTime();
  const issuedMs = parsed.issuedAt.getTime();
  if (!Number.isFinite(issuedMs) || issuedMs > nowMs + 60_000 || issuedMs < nowMs - 600_000)
    invalid('issued_at');
  if (parsed.expirationTime && !(parsed.expirationTime.getTime() > nowMs)) invalid('expiration');
  if (parsed.notBefore && !(parsed.notBefore.getTime() <= nowMs)) invalid('not_before');

  // Single-use claim before signature verification so concurrent replays cannot both reach the verifier.
  if ((await siweDeps.consumeNonce(parsed.nonce)) !== 1) invalid('nonce');

  let verified: boolean;
  try {
    verified = await siweDeps.verifySignature(message, signature);
  } catch (error) {
    if (isRpcFailure(error)) {
      logger.warn({ check: 'signature_rpc' }, 'SIWE verification unavailable');
      throw new AppError('UPSTREAM_UNAVAILABLE', 'The network is not responding. Please try again shortly.');
    }
    return invalid('signature_error');
  }
  if (!verified) invalid('signature');
  if (options.expectedAddress && parsed.address.toLowerCase() !== options.expectedAddress.toLowerCase()) {
    invalid('expected_address');
  }
  return parsed.address;
}

export async function createSession(
  address: string,
  meta: { userAgent?: string | undefined; ipHash?: string | undefined } = {},
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_MS);
  await dbRef.db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ address: address.toLowerCase(), lastSeenAt: now })
      .onConflictDoUpdate({ target: users.address, set: { lastSeenAt: now } })
      .returning({ id: users.id });
    if (!user) throw new Error('user upsert failed');
    await tx.insert(sessions).values({
      userId: user.id,
      tokenHash: sha256Hex(token),
      createdAt: now,
      expiresAt,
      freshUntil: new Date(now.getTime() + FRESH_MS),
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
      ipHash: meta.ipHash ?? null,
    });
  });
  return { token, expiresAt };
}

export async function refreshFreshAuth(token: string, address: string): Promise<Date> {
  const freshUntil = new Date(Date.now() + FRESH_MS);
  const updated = await dbRef.db
    .update(sessions)
    .set({ freshUntil })
    .from(users)
    .where(
      and(
        eq(sessions.userId, users.id),
        eq(users.address, address.toLowerCase()),
        eq(sessions.tokenHash, sha256Hex(token)),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .returning({ id: sessions.id });
  if (updated.length === 0) throw new AppError('UNAUTHENTICATED', 'Please sign in with your wallet.');
  return freshUntil;
}

export async function deleteSession(token: string): Promise<void> {
  await dbRef.db.delete(sessions).where(eq(sessions.tokenHash, sha256Hex(token)));
}
