import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** TCB statuses a sealed node may have. Configurable: SEALED_ALLOWED_TCB="UpToDate,SWHardeningNeeded". */
const csv = (v: string | undefined, d: string[]): string[] =>
  v === undefined || v.trim() === ''
    ? d
    : v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

export const ATTEST_TTL_MS = 3600_000;

export const attestSettings = {
  allowedTcb: csv(process.env.SEALED_ALLOWED_TCB, ['UpToDate', 'SWHardeningNeeded']),
  /** Intel PCS (v4). Free, public. */
  pcsUrl: process.env.SEALED_PCS_URL ?? 'https://api.trustedservices.intel.com/sgx/certification/v4/',
  collateralTtlMs: 3600_000,
  nrasUrl: process.env.SEALED_NRAS_URL ?? 'https://nras.attestation.nvidia.com/v3/attest/gpu',
  nrasJwksUrl:
    process.env.SEALED_NRAS_JWKS_URL ?? 'https://nras.attestation.nvidia.com/.well-known/jwks.json',
  nrasIssuer: process.env.SEALED_NRAS_ISSUER ?? 'https://nras.attestation.nvidia.com',
  /** Attestation validity (also the dispatch-time freshness limit). */
  ttlMs: ATTEST_TTL_MS,
  fetchTimeoutMs: 15_000,
  allowlistPath: process.env.SEALED_ALLOWLIST_PATH ?? new URL('./allowlist.json', import.meta.url).pathname,
};

export const AllowlistSchema = z.object({
  mrTd: z.array(z.string()).default([]),
  rtmr0: z.array(z.string()).default([]),
  rtmr1: z.array(z.string()).default([]),
  rtmr2: z.array(z.string()).default([]),
  /** One entry per approved build: the dstack app-compose hash (which pins the image digest) and its metadata. */
  composes: z
    .array(
      z.object({
        composeHash: z.string(),
        imageDigest: z.string().optional(),
        modelDigests: z.array(z.string()).default([]),
        note: z.string().optional(),
      }),
    )
    .default([]),
});
export type Allowlist = z.infer<typeof AllowlistSchema>;

let cached: { path: string; list: Allowlist } | null = null;
/** Loaded lazily and re-read when the path changes (tests set `attestSettings.allowlistPath`). */
export function loadAllowlist(): Allowlist {
  if (cached?.path === attestSettings.allowlistPath) return cached.list;
  const list = AllowlistSchema.parse(JSON.parse(readFileSync(attestSettings.allowlistPath, 'utf8')));
  cached = { path: attestSettings.allowlistPath, list };
  return list;
}
export const resetAllowlist = (): void => {
  cached = null;
};
