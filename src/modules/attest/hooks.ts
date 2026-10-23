import { config } from '../../config';
import { logger } from '../../lib/logger';
import type { AttestationBundle } from '../../shared/node-protocol';
import { clearAttestation, recordAttestation, TRANSIENT_REASONS } from './verify';

/** Test seam. */
export const hookDeps = { enabled: (): boolean => config.SEALED_LANE_ENABLED };

/** Retry delays after a transient PCS/NRAS outage (the node's next refresh is 50 minutes away). */
export const retryDelaysMs = { value: [60_000, 120_000, 300_000] };

/**
 * Hub hook (hello.attestation and attest.refresh). No-op unless SEALED_LANE_ENABLED. Fire-and-forget:
 * verification does network I/O (Intel PCS, NRAS) and must not block the node connection.
 */
export function onNodeAttestation(
  nodeId: string,
  nodeKey: string,
  bundle: AttestationBundle | undefined,
): Promise<void> {
  if (!hookDeps.enabled()) return Promise.resolve();
  if (!bundle) return clearAttestation(nodeId); // a new session without evidence has no attested key
  const attempt = async (n: number): Promise<void> => {
    try {
      const r = await recordAttestation(nodeId, nodeKey, bundle);
      const delay = retryDelaysMs.value[n];
      if (!r.ok && TRANSIENT_REASONS.has(r.reason) && delay !== undefined) {
        const t = setTimeout(() => void attempt(n + 1), delay);
        t.unref?.();
      }
    } catch (err) {
      logger.error({ err: String(err), nodeId }, 'recording attestation failed');
    }
  };
  return attempt(0);
}
