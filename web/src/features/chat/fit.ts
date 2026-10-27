/**
 * Keep a chat prompt inside the model's context window. The node serves a fixed window per model
 * (`context_length` from /v1/models); a longer prompt is refused by the gateway, so the dashboard drops
 * the oldest turns itself. Token counts are estimated conservatively (chars / 3 plus per-message
 * template overhead) and the budget leaves headroom for tokenizer differences.
 */

export interface FitMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Completion budget the chat asks for (also sent as `max_tokens`). */
export const CHAT_MAX_TOKENS = 1024;
const PER_MESSAGE_TOKENS = 8;
const FIXED_TOKENS = 32;
/** Share of the window kept free for estimation error. */
const HEADROOM = 0.1;

export const estimateTokens = (text: string): number => Math.ceil(text.length / 3);
const costOf = (m: FitMessage): number => estimateTokens(m.content) + PER_MESSAGE_TOKENS;

/** `max_tokens` for a window: the usual 1024, but never more than a quarter of a small window. */
export function completionBudget(contextLength: number | undefined): number {
  if (!contextLength) return CHAT_MAX_TOKENS;
  return Math.max(16, Math.min(CHAT_MAX_TOKENS, Math.floor(contextLength / 4)));
}

export interface Fitted {
  messages: FitMessage[];
  /** how many older messages were left out */
  omitted: number;
  maxTokens: number;
}

/**
 * Drops the oldest turns (system messages and the latest message always stay) until the estimated
 * prompt plus `max_tokens` fits. Without a known window nothing is dropped.
 */
export function fitHistory(messages: FitMessage[], contextLength: number | undefined): Fitted {
  const maxTokens = completionBudget(contextLength);
  if (!contextLength || messages.length === 0) return { messages, omitted: 0, maxTokens };
  const budget = Math.floor(contextLength * (1 - HEADROOM)) - maxTokens - FIXED_TOKENS;
  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  const last = rest[rest.length - 1];
  if (!last) return { messages, omitted: 0, maxTokens };
  let used = system.reduce((n, m) => n + costOf(m), 0) + costOf(last);
  const kept: FitMessage[] = [last];
  for (let i = rest.length - 2; i >= 0; i--) {
    const m = rest[i] as FitMessage;
    if (used + costOf(m) > budget) break; // contiguous suffix: never keep a reply without its question
    used += costOf(m);
    kept.unshift(m);
  }
  return { messages: [...system, ...kept], omitted: rest.length - kept.length, maxTokens };
}
