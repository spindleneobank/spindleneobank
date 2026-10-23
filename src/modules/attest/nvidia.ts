import { createRemoteJWKSet, type JWTPayload, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { attestSettings } from './settings';
import { AttestError } from './tdx';

/**
 * What the node's NVIDIA local verifier produces and the backend forwards to NRAS
 * (POST /v3/attest/gpu body). `nonce` is the same 32-byte hex nonce as in the TDX report_data binding.
 */
export const NvidiaEvidence = z.object({
  nonce: z.string().regex(/^[0-9a-fA-F]{64}$/),
  arch: z.enum(['HOPPER', 'BLACKWELL']),
  evidence_list: z.array(z.object({ evidence: z.string(), certificate: z.string() })).min(1),
});
export type NvidiaEvidence = z.infer<typeof NvidiaEvidence>;

export const nvidiaDeps: {
  /** POST the evidence to NRAS; returns the raw JSON body. */
  nras: (evidence: NvidiaEvidence) => Promise<unknown>;
  jwks: () => JWTVerifyGetKey;
  now: () => Date;
} = {
  nras: async (ev) => {
    const res = await fetch(attestSettings.nrasUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ nonce: ev.nonce, arch: ev.arch, claims_version: '2.0', evidence_list: ev.evidence_list }),
      signal: AbortSignal.timeout(attestSettings.fetchTimeoutMs),
    });
    if (!res.ok) throw new Error(`NRAS HTTP ${res.status}`);
    return res.json();
  },
  jwks: (() => {
    let set: JWTVerifyGetKey | null = null;
    return () => {
      set ??= createRemoteJWKSet(new URL(attestSettings.nrasJwksUrl), { cacheMaxAge: 3600_000 });
      return set;
    };
  })(),
  now: () => new Date(),
};

/** NRAS answers `[["JWT","<overall>"],{"GPU-0":"<jwt>",...}]`. */
export function overallToken(body: unknown): string {
  const first = Array.isArray(body) ? body[0] : undefined;
  if (Array.isArray(first) && first[0] === 'JWT' && typeof first[1] === 'string') return first[1];
  throw new AttestError('NVIDIA_RESPONSE', 'unexpected NRAS response shape');
}

export interface NvidiaResult {
  overall: true;
  claims: JWTPayload;
}

/** Remote attestation of the GPU evidence through NRAS; the JWT is verified against the NRAS JWKS. */
export async function verifyNvidia(raw: unknown): Promise<NvidiaResult> {
  const parsed = NvidiaEvidence.safeParse(raw);
  if (!parsed.success) throw new AttestError('NVIDIA_EVIDENCE_MALFORMED', parsed.error.issues[0]?.message);
  const ev = parsed.data;
  let token: string;
  try {
    token = overallToken(await nvidiaDeps.nras(ev));
  } catch (e) {
    if (e instanceof AttestError) throw e;
    throw new AttestError('NVIDIA_NRAS_UNAVAILABLE', String(e));
  }
  let claims: JWTPayload;
  try {
    ({ payload: claims } = await jwtVerify(token, nvidiaDeps.jwks(), {
      issuer: attestSettings.nrasIssuer,
      currentDate: nvidiaDeps.now(),
    }));
  } catch (e) {
    throw new AttestError('NVIDIA_JWT_INVALID', String(e));
  }
  if (claims['x-nvidia-overall-att-result'] !== true)
    throw new AttestError('NVIDIA_ATT_FAILED', 'x-nvidia-overall-att-result is not true');
  const nonce = String(claims.eat_nonce ?? '').toLowerCase();
  if (nonce !== ev.nonce.toLowerCase()) throw new AttestError('NVIDIA_NONCE', 'eat_nonce does not match');
  return { overall: true, claims };
}
