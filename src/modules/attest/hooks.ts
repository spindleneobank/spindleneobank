import { config } from '../../config';
import { logger } from '../../lib/logger';
import type { AttestationBundle } from '../../shared/node-protocol';
import { clearAttestation, recordAttestation } from './verify';

/**
 * Hub hook (hello.attestation and attest.refresh). No-op unless SEALED_LANE_ENABLED. Fire-and-forget:
 * verification does network I/O (Intel PCS, NRAS) and must not block the node connection.
 */
export function onNodeAttestation(
  nodeId: string,
  nodeKey: string,
  bundle: AttestationBundle | undefined,
): Promise<void> {
  if (!config.SEALED_LANE_ENABLED) return Promise.resolve();
  if (!bundle) return clearAttestation(nodeId); // a new session without evidence has no attested key
  return recordAttestation(nodeId, nodeKey, bundle).then(
    () => undefined,
    (err) => logger.error({ err: String(err), nodeId }, 'recording attestation failed'),
  );
}
