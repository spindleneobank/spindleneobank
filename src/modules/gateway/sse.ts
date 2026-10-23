import type { SpindleMeta } from '../../shared/api/openai';

/** One SSE frame. */
export const sseData = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`;
export const SSE_DONE = 'data: [DONE]\n\n';

export const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
} as const;

export interface ChunkBase {
  id: string;
  created: number;
  model: string;
}

type Delta = { role?: string; content?: string; reasoning?: string };

export function chunk(base: ChunkBase, delta: Delta, finishReason: string | null = null) {
  return {
    id: base.id,
    object: 'chat.completion.chunk' as const,
    created: base.created,
    model: base.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

/** First frame: announces the assistant role (what OpenAI sends). */
export const roleChunk = (base: ChunkBase) => chunk(base, { role: 'assistant', content: '' });

/** Last data frame: finish reason, usage and the spindle meta object. */
export function finalChunk(
  base: ChunkBase,
  finishReason: string,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
  spindle: SpindleMeta,
) {
  return { ...chunk(base, {}, finishReason), usage, spindle };
}

/** In-stream error frame (headers were already sent). */
export const errorFrame = (message: string, code: string) =>
  sseData({ error: { message, type: 'server_error', code } });
