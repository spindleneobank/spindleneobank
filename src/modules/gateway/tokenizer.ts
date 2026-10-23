import { eq } from 'drizzle-orm';
import { config } from '../../config';
import { models } from '../../db/schema';
import { logger } from '../../lib/logger';
import { DEFAULT_CATALOG } from '../../shared/catalog';
import { dbRef } from '../auth/constants';

/** The slice of a HF tokenizer we use. */
export interface Tok {
  encode(text: string, opts?: { add_special_tokens?: boolean }): number[];
  apply_chat_template?(messages: unknown[], opts: Record<string, unknown>): unknown;
}

export interface TokenCount {
  tokens: number;
  /** true when the offline `ceil(chars/3)` fallback was used */
  estimated: boolean;
}

export interface ChatMessageLike {
  role: string;
  content: string | { type: string; text?: string }[] | null;
  name?: string;
}

const LRU_SIZE = 8;
const FAILURE_BACKOFF_MS = 5 * 60_000;
const cache = new Map<string, Tok>(); // insertion order = recency
const loading = new Map<string, Promise<Tok | null>>();
const failedAt = new Map<string, number>();

export const tokenizerSettings = {
  cacheDir: config.TOKENIZER_CACHE_DIR,
  /** Loader override for tests. */
  load: async (hfName: string): Promise<Tok> => {
    const { AutoTokenizer } = await import('@huggingface/transformers');
    return (await AutoTokenizer.from_pretrained(hfName, {
      cache_dir: tokenizerSettings.cacheDir,
    })) as unknown as Tok;
  },
};

export function resetTokenizerCache(): void {
  cache.clear();
  loading.clear();
  failedAt.clear();
}

async function hfNameFor(modelId: string): Promise<string | null> {
  try {
    const [row] = await dbRef.db
      .select({ hf: models.hfTokenizer })
      .from(models)
      .where(eq(models.id, modelId))
      .limit(1);
    if (row?.hf) return row.hf;
  } catch {
    // fall through to the shipped catalog
  }
  return DEFAULT_CATALOG.find((m) => m.id === modelId)?.hfTokenizer ?? null;
}

function touch(modelId: string, tok: Tok): void {
  cache.delete(modelId);
  cache.set(modelId, tok);
  while (cache.size > LRU_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Loaded tokenizer for the model, or null while unavailable (offline, gated, unknown model). */
export async function getTokenizer(modelId: string, timeoutMs = 15_000): Promise<Tok | null> {
  const hit = cache.get(modelId);
  if (hit) {
    touch(modelId, hit);
    return hit;
  }
  const failed = failedAt.get(modelId);
  if (failed && Date.now() - failed < FAILURE_BACKOFF_MS) return null;
  let p = loading.get(modelId);
  if (!p) {
    p = (async () => {
      try {
        const hf = await hfNameFor(modelId);
        if (!hf) throw new Error('no hf_tokenizer for model');
        const tok = await tokenizerSettings.load(hf);
        touch(modelId, tok);
        return tok;
      } catch (err) {
        failedAt.set(modelId, Date.now());
        logger.warn({ model: modelId, err: String(err) }, 'tokenizer unavailable, using chars/3 estimate');
        return null;
      } finally {
        loading.delete(modelId);
      }
    })();
    loading.set(modelId, p);
  }
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
}

/** Synchronous cache read; starts a background load when absent. Never blocks a request. */
export function getTokenizerIfCached(modelId: string): Tok | null {
  const hit = cache.get(modelId);
  if (hit) return hit;
  void getTokenizer(modelId, 0);
  return null;
}

export const estimateTokens = (text: string): number => Math.ceil(text.length / 3);

function countWith(tok: Tok | null, text: string): TokenCount {
  if (!tok) return { tokens: estimateTokens(text), estimated: true };
  try {
    return { tokens: tok.encode(text, { add_special_tokens: false }).length, estimated: false };
  } catch {
    return { tokens: estimateTokens(text), estimated: true };
  }
}

export async function countTokens(modelId: string, text: string): Promise<TokenCount> {
  return countWith(await getTokenizer(modelId), text);
}

export function messageText(m: ChatMessageLike): string {
  if (m.content == null) return '';
  if (typeof m.content === 'string') return m.content;
  return m.content.map((p) => (p.type === 'text' ? (p.text ?? '') : '')).join('');
}

function joinMessages(messages: ChatMessageLike[]): string {
  return messages.map((m) => `${m.role}\n${messageText(m)}`).join('\n');
}

function promptCount(tok: Tok | null, messages: ChatMessageLike[]): TokenCount {
  if (tok?.apply_chat_template) {
    try {
      const flat = messages.map((m) => ({ role: m.role, content: messageText(m) }));
      const text = tok.apply_chat_template(flat, { tokenize: false, add_generation_prompt: true });
      if (typeof text === 'string') return countWith(tok, text);
    } catch {
      // template missing: join role + content
    }
  }
  return countWith(tok, joinMessages(messages));
}

/** Prompt tokens with the model's chat template when available, else role + content joined. */
export async function countChatPrompt(modelId: string, messages: ChatMessageLike[]): Promise<TokenCount> {
  return promptCount(await getTokenizer(modelId), messages);
}

/** Request-path estimate: never waits for a download (uses chars/3 until the tokenizer is cached). */
export function estimateChatPrompt(modelId: string, messages: ChatMessageLike[]): TokenCount {
  return promptCount(getTokenizerIfCached(modelId), messages);
}

export function estimateText(modelId: string, text: string): TokenCount {
  return countWith(getTokenizerIfCached(modelId), text);
}

// ---- reservation upper bounds -------------------------------------------------------------------------

const utf8Bytes = (s: string): number => Buffer.byteLength(s, 'utf8');
const PER_MESSAGE_OVERHEAD = 8;
const CHAT_OVERHEAD = 32;
const PER_INPUT_OVERHEAD = 16;

/**
 * Hard UPPER bound on prompt tokens, used for reservations (never chars/3). With the tokenizer
 * cached: exact count x 1.1 + template overhead. Otherwise 2x the UTF-8 byte length (NFC normalization can
 * exceed 1 token/byte) plus per-message and fixed template overhead.
 */
export function promptUpperBound(modelId: string, messages: ChatMessageLike[]): number {
  const texts = messages.map(messageText);
  const overhead = PER_MESSAGE_OVERHEAD * messages.length + CHAT_OVERHEAD;
  const tok = getTokenizerIfCached(modelId);
  if (tok) {
    try {
      const exact = texts.reduce((n, t) => n + tok.encode(t, { add_special_tokens: false }).length, 0);
      return Math.ceil(exact * 1.1) + overhead;
    } catch {
      // fall through to the byte bound
    }
  }
  return texts.reduce((n, t) => n + 2 * utf8Bytes(t), 0) + overhead;
}

/** Hard upper bound on embeddings input tokens (bytes + 16 per input without a tokenizer). */
export function inputsUpperBound(modelId: string, inputs: string[]): number {
  const tok = getTokenizerIfCached(modelId);
  if (tok) {
    try {
      return inputs.reduce(
        (n, t) =>
          n + Math.ceil(tok.encode(t, { add_special_tokens: false }).length * 1.1) + PER_INPUT_OVERHEAD,
        0,
      );
    } catch {
      // fall through
    }
  }
  return inputs.reduce((n, t) => n + 2 * utf8Bytes(t) + PER_INPUT_OVERHEAD, 0);
}

/** Background-load every enabled catalog tokenizer so the byte bound is the exception. */
export async function warmTokenizers(): Promise<void> {
  try {
    const { loadCatalog } = await import('../nodes/service');
    for (const m of await loadCatalog()) await getTokenizer(m.id, 120_000);
  } catch (err) {
    logger.warn({ err: String(err) }, 'tokenizer warmup failed');
  }
}
