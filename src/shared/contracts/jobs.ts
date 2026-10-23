import type { JobDoneMsg } from '../node-protocol';

/**
 * Interface between the gateway (B5) and receipts/metering (B7).
 * B7 exports `onJobFinished`; B5 calls it when a node reports job.done.
 */
export interface GatewayView {
  /** Final text the gateway relayed to the buyer (chat). */
  outputText?: string;
  /** Embedding vectors the gateway relayed (embeddings). */
  embeddings?: number[][];
  /** Image bytes the gateway relayed (images). */
  images?: Uint8Array[];
  /** sha256 hex of canonicalJson(request) as the gateway sent it to the node. */
  inputDigest: string;
  /** Gateway token recount (HF tokenizer); undefined in the sealed lane. */
  recount?: { promptTokens: number; completionTokens: number };
}

export type OnJobFinished = (jobId: string, done: JobDoneMsg, gatewayView: GatewayView) => Promise<void>;
