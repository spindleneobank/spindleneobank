/**
 * Canary prompts come from a private JSONL corpus loaded at runtime from `CANARY_CORPUS_PATH`, which lives
 * outside this repository: a node operator who has read this code must not be able to tell a canary from a
 * buyer prompt. There is deliberately no built-in fallback. Without a corpus no canary is sent, and a
 * production worker refuses to start (see `jobs.ts`).
 *
 * One JSON object per line:
 *   {"type":"prompt","messages":[{"role":"user","content":"..."}]}                  judged against the house node
 *   {"type":"prompt","messages":[...],"expect":{"anyOf":["paris"]}}                 known answer, any model
 *   {"type":"system","text":"..."}                                                  system prompt pool
 *   {"type":"embedding","text":"..."}                                               embedding input pool
 */
import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { sha256Hex } from '../../shared/canonical-json';

const ChatExpect = z.union([
  z.object({ regex: z.string().min(1) }).strict(),
  z.object({ anyOf: z.array(z.string().min(1)).min(1) }).strict(),
]);
export type ChatExpect = z.infer<typeof ChatExpect>;

const Message = z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().min(1) });
type Message = z.infer<typeof Message>;

const Line = z.discriminatedUnion('type', [
  z.object({ type: z.literal('prompt'), messages: z.array(Message).min(1), expect: ChatExpect.optional() }),
  z.object({ type: z.literal('system'), text: z.string().min(1) }),
  z.object({ type: z.literal('embedding'), text: z.string().min(1) }),
]);

export interface CorpusPrompt {
  /** Hash of the messages; recorded as evidence instead of the private text. */
  id: string;
  messages: Message[];
  expect?: ChatExpect;
  chars: number;
}

export interface Corpus {
  /** Hash of the file, recorded in canary evidence. */
  id: string;
  prompts: CorpusPrompt[];
  systems: string[];
  embeddings: string[];
}

/** Throws on the first invalid line. The message carries the line number only, never corpus text. */
export function parseCorpus(raw: string): Corpus {
  const corpus: Corpus = { id: sha256Hex(raw).slice(0, 16), prompts: [], systems: [], embeddings: [] };
  for (const [i, line] of raw.split('\n').entries()) {
    if (!line.trim()) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`canary corpus line ${i + 1}: not JSON`);
    }
    const parsed = Line.safeParse(json);
    if (!parsed.success) throw new Error(`canary corpus line ${i + 1}: invalid entry`);
    const e = parsed.data;
    if (e.type === 'system') corpus.systems.push(e.text);
    else if (e.type === 'embedding') corpus.embeddings.push(e.text);
    else {
      if (e.expect && 'regex' in e.expect) new RegExp(e.expect.regex, 'i'); // throws on a bad pattern
      corpus.prompts.push({
        id: sha256Hex(JSON.stringify(e.messages)).slice(0, 16),
        messages: e.messages,
        ...(e.expect ? { expect: e.expect } : {}),
        chars: e.messages.reduce((a, m) => a + m.content.length, 0),
      });
    }
  }
  return corpus;
}

export const corpusSettings = { path: config.CANARY_CORPUS_PATH };

let cached: { path: string; mtimeMs: number; corpus: Corpus } | null = null;

/** The active corpus, or null if none is configured or readable. Re-read when the file changes, so it can be rotated without a restart. */
export function activeCorpus(): Corpus | null {
  const path = corpusSettings.path;
  if (!path) return null;
  try {
    const { mtimeMs } = statSync(path);
    if (cached?.path === path && cached.mtimeMs === mtimeMs) return cached.corpus;
    const corpus = parseCorpus(readFileSync(path, 'utf8'));
    cached = { path, mtimeMs, corpus };
    logger.info(
      { id: corpus.id, prompts: corpus.prompts.length, embeddings: corpus.embeddings.length },
      'canary corpus loaded',
    );
    return corpus;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : 'unreadable' }, 'canary corpus unavailable');
    return null;
  }
}

// ---- buyer traffic shape ---------------------------------------------------------------------------

/** The shape of one buyer chat request. Never contains prompt text. */
export interface BuyerShape {
  maxTokens: number;
  temperature?: number;
  topP?: number;
  seed: boolean;
  system: boolean;
  promptChars: number;
}

type Rand = () => number;
const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;

/** Used until enough real buyer shapes have been observed. Most clients omit max_tokens and temperature. */
export function priorShape(r: Rand): BuyerShape {
  const maxTokens = r() < 0.5 ? 1024 : Math.round(64 * 32 ** r()); // the gateway default, else log-uniform 64-2048
  const t = r();
  return {
    maxTokens,
    ...(t < 0.6 ? {} : { temperature: t < 0.7 ? 0 : Math.round(r() * 100) / 100 }),
    seed: r() < 0.05,
    system: r() < 0.3,
    promptChars: Math.round(40 * 50 ** r()), // log-uniform 40-2000 chars
  };
}

export interface ChatCanary {
  promptId: string;
  messages: Message[];
  expect?: ChatExpect;
  maxTokens: number;
  temperature?: number;
  topP?: number;
  seed?: number;
}

/** A canary with this shape: from a random sample of the corpus, the prompt nearest the buyer's length. */
export function drawChatCanary(
  prompts: readonly CorpusPrompt[],
  systems: readonly string[],
  shape: BuyerShape,
  r: Rand,
): ChatCanary | null {
  if (prompts.length === 0) return null;
  let best = pick(r, prompts);
  for (let i = 0; i < 7; i++) {
    const p = pick(r, prompts);
    if (Math.abs(p.chars - shape.promptChars) < Math.abs(best.chars - shape.promptChars)) best = p;
  }
  const addSystem = shape.system && systems.length > 0 && best.messages[0]?.role !== 'system';
  return {
    promptId: best.id,
    messages: addSystem ? [{ role: 'system', content: pick(r, systems) }, ...best.messages] : best.messages,
    ...(best.expect ? { expect: best.expect } : {}),
    maxTokens: shape.maxTokens,
    ...(shape.temperature !== undefined ? { temperature: shape.temperature } : {}),
    ...(shape.topP !== undefined ? { topP: shape.topP } : {}),
    ...(shape.seed ? { seed: 1 + Math.floor(r() * 2 ** 31) } : {}),
  };
}

/** Random inputs from the private pool. Buyers mostly embed one text or a small batch. */
export function drawEmbeddingInputs(pool: readonly string[], r: Rand): string[] {
  const n = Math.min(pool.length, r() < 0.5 ? 1 : 2 + Math.floor(r() * 31));
  const out = new Set<string>();
  while (out.size < n) out.add(pick(r, pool));
  return [...out];
}
