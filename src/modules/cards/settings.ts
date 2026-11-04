import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config, secrets } from '../../config';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';

/**
 * Mutable view of the card/Relay configuration. Everything in cards/relay reads through this object
 * (never `config` directly) so tests can flip modes without touching the frozen process config.
 */
export const cardSettings = {
  mode: config.IZIPAY_MODE as 'mock' | 'live',
  liveWrites: config.IZIPAY_LIVE_WRITES,
  baseUrl: config.IZIPAY_BASE_URL,
  apiKey: secrets.IZIPAY_API_KEY,
  apiSecret: secrets.IZIPAY_API_SECRET,
  webhookSecret: secrets.IZIPAY_WEBHOOK_SECRET,
  accountRef: config.IZIPAY_ACCOUNT_REF,
  encKey: secrets.CARD_DATA_ENC_KEY,
  /** Only an explicitly set env var overrides the 80%-of-account-limit default. */
  rateBudgetOverride: process.env.IZIPAY_RATE_BUDGET_PER_MIN ? config.IZIPAY_RATE_BUDGET_PER_MIN : undefined,
  requestTimeoutMs: 12_000,
  nodeEnv: config.NODE_ENV as string,
  relayMode: config.RELAY_MODE as 'live' | 'stub',
  relayApiUrl: config.RELAY_API_URL,
  relayApiKey: secrets.RELAY_API_KEY,
  relayStubAddress: config.RELAY_STUB_ADDRESS as string | undefined,
  usdgAddress: (config.USDG_ADDRESS ?? '0x5fc5360d0400a0fd4f2af552add042d716f1d168') as string,
  /** Real chain id for Relay quotes; independent of CHAIN_ID (31337 on the dev fork). */
  originChainId: config.RELAY_ORIGIN_CHAIN_ID,
  /** The chain the app (and user wallet) is on; stub-mode transactions target it. */
  appChainId: config.CHAIN_ID,
  // Velocity limits (card-flows.md)
  maxOpsPerDay: 3,
  maxCentsPerDay: 200_000n,
  maxUnpaidInvoices: 1,
  minTopupCents: 500n,
  maxCardCents: 1_000_000n,
  /** Processing ops whose invoice expired this long ago without provider confirmation go to review. */
  processingGraceMs: 30 * 60_000,
  /** markSubmitted waits this long for the tx to become visible. */
  txVisibleWaitMs: 60_000,
  /** Submitted relay orders without a receipt after this long become `expired` (re-quotable). */
  submittedTimeoutMs: 10 * 60_000,
};

export const providerScope = () => `izipay:${cardSettings.mode}:${cardSettings.accountRef}`;
export const liveWritesBlocked = () => cardSettings.mode === 'live' && !cardSettings.liveWrites;

export const cardsEnabled = () =>
  Boolean(cardSettings.apiKey && cardSettings.apiSecret && cardSettings.encKey) &&
  // a live key only ever runs in live mode: mock mode must not be able to issue real cards
  (cardSettings.mode === 'mock') !== cardSettings.apiKey.startsWith('izpk_live_');

let modeLogged = false;
/** One startup line per process (api and worker each initialise the card provider once). */
function logProviderMode(): void {
  if (modeLogged) return;
  modeLogged = true;
  logger.info(
    cardSettings.mode === 'mock'
      ? 'izipay mock'
      : cardSettings.liveWrites
        ? 'izipay live, writes enabled'
        : 'izipay live, writes disabled',
  );
}

/** Fail fast: mock izipay and the Relay stub are dev-only. */
export function assertProductionSafe(): void {
  assertRelayModeSafe();
  if (cardSettings.mode === 'mock' && cardSettings.nodeEnv === 'production') {
    throw new Error('IZIPAY_MODE=mock is forbidden when NODE_ENV=production');
  }
  logProviderMode();
}

export const unavailable = () =>
  new AppError('UPSTREAM_UNAVAILABLE', 'Cards are temporarily unavailable.', 503);
export function requireCards(): void {
  if (!cardsEnabled()) throw unavailable();
}

/** Stub mode is a dev-only adapter: it must never run in production. */
export function assertRelayModeSafe(): void {
  if (cardSettings.relayMode === 'stub' && cardSettings.nodeEnv === 'production') {
    throw new Error('RELAY_MODE=stub is forbidden when NODE_ENV=production');
  }
}

function key(): Buffer {
  const hex = cardSettings.encKey.replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw unavailable();
  return Buffer.from(hex, 'hex');
}

/** AES-256-GCM, base64(iv | tag | ciphertext), bound to `context` through the associated data. */
export function encryptCardData(plain: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptCardData(blob: string, context: string): string {
  try {
    const bytes = Buffer.from(blob, 'base64');
    if (bytes.length < 28 || bytes.toString('base64') !== blob) throw new Error('shape');
    const decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    throw unavailable();
  }
}

export const profileContext = (userId: string) => `spindle:card-profile:${userId}`;
export const applePayContext = (cardId: string) => `spindle:apple-pay:${cardId}`;
