/**
 * LOCAL STUB of `@spindle/shared` (app/src/shared, owned by T01). Remove once T01 merges: the alias in
 * vite.config.ts and tsconfig.json then points at ../src/shared. Names here are F0's assumptions; shapes follow
 * docs/plan/api-contract.md.
 */
import { z } from 'zod';

export const addressSchema = z.string().regex(/^0x[0-9a-f]{40}$/);
export const microsSchema = z.string().regex(/^\d+$/);

export const errorCodeSchema = z.enum([
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
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

export const nonceResponseSchema = z.object({ nonce: z.string() });
export const verifyBodySchema = z.object({ message: z.string(), signature: z.string() });
export const verifyResponseSchema = z.object({ address: addressSchema, expiresAt: z.string() });
export const sessionResponseSchema = z.object({
  address: addressSchema,
  chainId: z.number().int(),
  fresh: z.boolean(),
});
export const reauthResponseSchema = z.object({ freshUntil: z.string() });

export const meResponseSchema = z.object({
  address: addressSchema,
  prefs: z.record(z.string(), z.unknown()),
  isAdmin: z.boolean(),
  buyer: z.object({ id: z.string(), balanceMicros: microsSchema }).nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const networkStatsSchema = z.object({
  nodesOnline: z.number().int(),
  nodesByLane: z.record(z.string(), z.number().int()),
  jobs24h: z.number().int(),
  tokens24h: z.number().int(),
  latestEpoch: z.number().int().nullable(),
});
export type NetworkStats = z.infer<typeof networkStatsSchema>;
