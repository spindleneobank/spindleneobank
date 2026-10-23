/**
 * Hook between receipts (B7) and canaries (B11). B7 calls `canaryHooks.onCanaryFinished` for every
 * `jobs.is_canary` job after its receipt was checked. The default evaluates the canary; the service is
 * imported lazily because it depends on the receipts module that imports this file.
 */
export interface CanaryFinished {
  jobId: string;
  nodeId: string;
  verified: boolean;
  reason: string | null;
  /** Relayed output (chat text) for known-answer checks. */
  outputText?: string;
  embeddings?: number[][];
}

export const canaryHooks: { onCanaryFinished: (e: CanaryFinished) => Promise<void> } = {
  onCanaryFinished: async (e) => {
    const { handleCanaryFinished } = await import('./service');
    await handleCanaryFinished(e);
  },
};

export const onCanaryFinished = (e: CanaryFinished): Promise<void> => canaryHooks.onCanaryFinished(e);
