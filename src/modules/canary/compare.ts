/**
 * Judging a node's output against the house node, the one trusted reference. Used by corpus canaries and by
 * shadow re-execution of paid jobs. LLM output varies between honest runs, so the house answers twice: when
 * those two answers disagree with each other the prompt is too open to judge and the result is inconclusive,
 * which never counts against a node.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import type { CatalogModel } from '../../shared/catalog';
import { type Delta, type JobDone, type JobStartInput, requestFromWorker } from '../nodes/jobs';
import { loadCatalog, nodeSettings } from '../nodes/service';

export interface CandidateLite {
  nodeId: string;
  isHouse: boolean;
  engine: string;
}

export const canaryDeps = {
  candidates: (filter: {
    model: string;
    lane: 'open';
    kind: 'chat' | 'embeddings';
    includeUnregistered?: boolean;
  }): Promise<CandidateLite[]> => requestFromWorker<CandidateLite[]>({ type: 'candidates', filter }),
  dispatch: (nodeId: string, job: JobStartInput, onChunk: (d: Delta) => void): Promise<JobDone> =>
    requestFromWorker<JobDone>(
      { type: 'dispatch', nodeId, job },
      { onChunk, timeoutMs: nodeSettings.jobTimeoutMs + 10_000 },
    ),
  random: (): number => Math.random(),
  now: (): number => Date.now(),
};

export const compareSettings = {
  /** Minimum cosine between a node's chat answer and the house's. */
  chatCosineMin: config.SHADOW_CHAT_COSINE_MIN,
  embedModel: config.SHADOW_EMBED_MODEL,
  /** House replays are capped: it is a small CPU node, and a prefix is enough to compare. */
  houseMaxTokens: 256,
  maxChars: 4000,
};

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  const c = dot / Math.sqrt(na * nb);
  return Number.isFinite(c) ? c : 0;
}

export const embeddingsOf = (output: unknown): number[][] =>
  ((output as { data?: { embedding?: number[] }[] } | null)?.data ?? []).map((d) => d.embedding ?? []);

export async function houseFor(model: CatalogModel): Promise<CandidateLite | null> {
  if (model.kind !== 'chat' && model.kind !== 'embeddings') return null;
  const list = await canaryDeps.candidates({
    model: model.id,
    lane: 'open',
    kind: model.kind,
    includeUnregistered: true,
  });
  const house = list.find((c) => c.isHouse);
  return house && model.engineIds[house.engine as 'ollama' | 'vllm'] ? house : null;
}

/** Embeds on the house node only: vectors from an untrusted node could be forged. Null when it cannot. */
export async function houseEmbed(model: CatalogModel, input: string[]): Promise<number[][] | null> {
  const house = await houseFor(model);
  const engineModel = house && model.engineIds[house.engine as 'ollama' | 'vllm'];
  if (!house || !engineModel) return null;
  const done = await canaryDeps.dispatch(
    house.nodeId,
    {
      jobId: randomUUID(),
      kind: 'embeddings',
      model: model.id,
      engineModel,
      lane: 'open',
      request: { model: model.id, input },
      maxTokens: 0,
      deadlineMs: canaryDeps.now() + nodeSettings.jobTimeoutMs,
    },
    () => {},
  );
  const vectors = embeddingsOf(done.output);
  return vectors.length === input.length && vectors.every((v) => v.length > 0) ? vectors : null;
}

async function houseChat(
  model: CatalogModel,
  house: CandidateLite,
  body: Record<string, unknown>,
): Promise<string> {
  const requested = typeof body.max_tokens === 'number' ? body.max_tokens : compareSettings.houseMaxTokens;
  const maxTokens = Math.min(requested, compareSettings.houseMaxTokens);
  let text = '';
  await canaryDeps.dispatch(
    house.nodeId,
    {
      jobId: randomUUID(),
      kind: 'chat',
      model: model.id,
      engineModel: model.engineIds[house.engine as 'ollama' | 'vllm'] as string,
      lane: 'open',
      request: { ...body, max_tokens: maxTokens },
      maxTokens,
      deadlineMs: canaryDeps.now() + nodeSettings.jobTimeoutMs,
    },
    (d) => {
      if (d.delta.content) text += d.delta.content;
    },
  );
  return text;
}

export type HouseVerdict =
  | { verdict: 'match' | 'mismatch'; cosine: number; houseSelf: number }
  | { verdict: 'inconclusive'; reason: string };

/** Replays `body` on the house node and compares the answer with `nodeText`. Never throws. */
export async function compareChatWithHouse(
  model: CatalogModel,
  body: Record<string, unknown>,
  nodeText: string,
): Promise<HouseVerdict> {
  const inconclusive = (reason: string): HouseVerdict => ({ verdict: 'inconclusive', reason });
  try {
    const house = await houseFor(model);
    if (!house) return inconclusive('house node does not serve this model');
    const embedder = (await loadCatalog()).find((m) => m.id === compareSettings.embedModel);
    if (!embedder) return inconclusive('embedding model not in catalog');
    const first = await houseChat(model, house, body);
    const second = await houseChat(model, house, body);
    if (!first.trim() || !second.trim()) return inconclusive('house node returned nothing');
    // compare like with like: the house answer is capped, so judge the same length of the node's answer
    const limit = Math.min(Math.max(first.length, second.length), compareSettings.maxChars);
    const answer = nodeText.slice(0, limit);
    if (!answer.trim()) return { verdict: 'mismatch', cosine: 0, houseSelf: 1 };
    const v = await houseEmbed(embedder, [first.slice(0, limit), second.slice(0, limit), answer]);
    if (!v) return inconclusive('house node could not embed');
    const [a, b, n] = v as [number[], number[], number[]];
    const houseSelf = cosine(a, b);
    if (houseSelf < compareSettings.chatCosineMin) return inconclusive('prompt too open to judge');
    const c = Math.max(cosine(a, n), cosine(b, n));
    return { verdict: c >= compareSettings.chatCosineMin ? 'match' : 'mismatch', cosine: c, houseSelf };
  } catch (err) {
    logger.info({ err: String(err), model: model.id }, 'house comparison did not complete');
    return inconclusive('house node unavailable');
  }
}
