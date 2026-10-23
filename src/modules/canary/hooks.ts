/**
 * Hook between receipts (B7) and canaries (B11). B7 calls `canaryHooks.onCanaryFinished` for every
 * `jobs.is_canary` job after its receipt was checked; the default is a no-op until B11 replaces it.
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
  onCanaryFinished: async () => {},
};

export const onCanaryFinished = (e: CanaryFinished): Promise<void> => canaryHooks.onCanaryFinished(e);
