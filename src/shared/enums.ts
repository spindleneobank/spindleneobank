/** Status sets defined once. DB check constraints and zod schemas derive from these tuples. */

export const NodeStatus = ['offline', 'online', 'busy', 'suspended', 'deactivated'] as const;
export type NodeStatus = (typeof NodeStatus)[number];

export const Lane = ['sealed', 'open'] as const;
export type Lane = (typeof Lane)[number];

export const Engine = ['ollama', 'vllm'] as const;
export type Engine = (typeof Engine)[number];

export const JobKind = ['chat', 'embeddings', 'images'] as const;
export type JobKind = (typeof JobKind)[number];

export const JobStatus = [
  'queued',
  'dispatched',
  'running',
  'completed',
  'failed',
  'cancelled',
  'timeout',
] as const;
export type JobStatus = (typeof JobStatus)[number];

export const UnitKind = ['tokens_1m', 'image', 'job', 'gpu_hour'] as const;
export type UnitKind = (typeof UnitKind)[number];

export const PayMode = ['balance', 'x402', 'canary', 'probe'] as const;
export type PayMode = (typeof PayMode)[number];

export const EarningKind = ['job', 'floor', 'slash', 'canary_withhold', 'x402_reversal'] as const;
export type EarningKind = (typeof EarningKind)[number];

export const EpochStatus = ['built', 'posting', 'posted', 'vetoed', 'failed'] as const;
export type EpochStatus = (typeof EpochStatus)[number];

export const ClaimStatus = ['submitted', 'confirmed', 'failed'] as const;
export type ClaimStatus = (typeof ClaimStatus)[number];

export const X402Status = ['open', 'closing', 'settling', 'settled', 'failed', 'expired'] as const;
export type X402Status = (typeof X402Status)[number];

export const X402Scheme = ['exact', 'session'] as const;
export type X402Scheme = (typeof X402Scheme)[number];

export const CardStatus = ['pending_payment', 'paid_pending_issue', 'issued', 'failed'] as const;
export type CardStatus = (typeof CardStatus)[number];

export const CardOpKind = ['issue', 'topup'] as const;
export type CardOpKind = (typeof CardOpKind)[number];

export const CardOpStatus = [
  'created',
  'submitting',
  'awaiting_payment',
  'processing',
  'completed',
  'failed',
  'expired',
  'review',
] as const;
export type CardOpStatus = (typeof CardOpStatus)[number];

export const CardNetwork = ['bsc', 'tron'] as const;
export type CardNetwork = (typeof CardNetwork)[number];

export const RelayStatus = [
  'quoted',
  'signing',
  'submitted',
  'pending',
  'success',
  'refund',
  'failed',
  'expired',
] as const;
export type RelayStatus = (typeof RelayStatus)[number];

export const EnrollmentStatus = ['pending', 'claimed', 'approved', 'expired', 'revoked'] as const;
export type EnrollmentStatus = (typeof EnrollmentStatus)[number];

export const EnrollmentKind = ['token', 'pairing'] as const;
export type EnrollmentKind = (typeof EnrollmentKind)[number];

export const BuyerLedgerKind = ['deposit', 'charge', 'refund', 'adjust'] as const;
export type BuyerLedgerKind = (typeof BuyerLedgerKind)[number];

export const SlashStatus = ['open', 'submitted', 'executed', 'dismissed'] as const;
export type SlashStatus = (typeof SlashStatus)[number];

/** api-contract.md error codes. SESSION_EXHAUSTED is the x402 session code from payments-x402.md. */
export const ErrorCode = [
  'VALIDATION',
  'UNAUTHENTICATED',
  'REAUTH_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYMENT_REQUIRED',
  'INSUFFICIENT_BALANCE',
  'NO_CAPACITY',
  'UPSTREAM_UNAVAILABLE',
  'INSUFFICIENT_LIQUIDITY',
  'CHAIN_STATE',
  'INTERNAL',
  'SESSION_EXHAUSTED',
  'LIVE_WRITES_DISABLED',
] as const;
export type ErrorCode = (typeof ErrorCode)[number];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  REAUTH_REQUIRED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYMENT_REQUIRED: 402,
  INSUFFICIENT_BALANCE: 402,
  NO_CAPACITY: 503,
  UPSTREAM_UNAVAILABLE: 502,
  INSUFFICIENT_LIQUIDITY: 409,
  CHAIN_STATE: 409,
  INTERNAL: 500,
  SESSION_EXHAUSTED: 402,
  LIVE_WRITES_DISABLED: 409,
};
