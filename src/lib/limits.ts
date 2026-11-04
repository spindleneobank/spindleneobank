/** Size limits on everything a client or node can send. A larger body or frame is refused before it is parsed. */
export const MAX_BODY_BYTES = 1024 * 1024;
/**
 * Bun's own limit sits above `MAX_BODY_BYTES`, so a body over the limit gets the app's JSON 413 from the
 * body-limit middleware. Bun's limit only cuts off what that cannot see in time.
 */
export const MAX_REQUEST_BODY_BYTES = 2 * MAX_BODY_BYTES;
/**
 * Largest WebSocket frame. A larger one closes the socket (1009). `MAX_EMBEDDING_INPUTS` in the shared API
 * follows from this: a `nomic-embed-text` vector is at most about 18 KB of JSON, and a response has to fit in
 * one `job.done` frame, or a buyer could disconnect the node.
 */
export const MAX_WS_PAYLOAD_BYTES = 1024 * 1024;
/** Largest frame accepted from a node that has not authenticated yet. */
export const MAX_PREAUTH_FRAME_BYTES = 64 * 1024;
/** Node output allowed for a job, in bytes, measured on what the node streams. No real token is near 8 bytes on average. */
export function maxOutputBytes(maxTokens: number, sealed = false): number {
  const cap = Math.max(4096, maxTokens * 8);
  return sealed ? cap * 3 : cap; // ciphertext: base64 plus HPKE overhead per chunk
}
