/**
 * Canary jobs: prompts from a private corpus (`corpus.ts`), judged by a known answer or against the house
 * node, plus house-referenced embeddings. They go to registered non-house nodes as ordinary jobs (same
 * message shape, same model ids, no flag) and take their sampling and length from observed buyer traffic.
 * They run in the worker, so the dispatch goes through the Redis bridge; the finished job is handed to B7's
 * `onJobFinished` exactly like a buyer job, which calls `onCanaryFinished` -> `handleCanaryFinished` below.
 * Canaries are free: no buyer charge, no provider earning.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { config } from '../../config';
import { buyers, canaryResults, earningEvents, jobs, kv, nodes, receipts } from '../../db/schema';
import { logger } from '../../lib/logger';
import { getRedis } from '../../lib/redis';
import { canonicalJson, sha256Hex } from '../../shared/canonical-json';
import type { CatalogModel } from '../../shared/catalog';
import type { JobKind } from '../../shared/enums';
import { decodeReceipt, receiptFromBase64 } from '../../shared/receipt';
import { dbRef } from '../auth/constants';
import { buyerIdForAddress } from '../buyers/service';
import { unitKindFor } from '../gateway/pricing';
import { updateJob } from '../gateway/service';
import { countChatPrompt, countTokens } from '../gateway/tokenizer';
import type { JobDone } from '../nodes/jobs';
import { loadCatalog, nodeSettings } from '../nodes/service';
import { onJobFinished } from '../receipts/service';
import { openCase, sinceUnsuspend, suspendNode } from '../slashing/service';
import {
  type CandidateLite,
  canaryDeps,
  compareChatWithHouse,
  compareSettings,
  cosine,
  embeddingsOf,
  houseFor,
} from './compare';
import {
  activeCorpus,
  type BuyerShape,
  type ChatExpect,
  drawChatCanary,
  drawEmbeddingInputs,
  priorShape,
} from './corpus';
import type { CanaryFinished } from './hooks';
import { SHAPES_KEY } from './shadow';

export { type CandidateLite, canaryDeps, cosine } from './compare';
export const EMBEDDING_COSINE_MIN = 0.98;

export const canarySettings = {
  /** Share of a node's last-hour traffic that is canaries, in basis points. */
  rateBps: config.CANARY_RATE_BPS,
  /** Every online node gets at least one canary per this window. */
  minIntervalMs: 3600_000,
  /** The scheduler runs once a minute. */
  tickMs: 60_000,
  passDelta: 2,
  failDelta: -100,
  repMin: 0,
  repMax: 2000,
  suspendFails: 3,
  /** A node is judged only on a sample: >= minSample canaries in the window and >= failShareBps failed. */
  minSample: 5,
  failShareBps: 5000,
  specTtlMs: 15 * 60_000,
  failWindowMs: 24 * 3600_000,
  /** Share of canaries that are embeddings when the node serves an embeddings model with a reference. */
  embeddingShare: 0.25,
  embeddingRefTtlMs: 24 * 3600_000,
};

/** Internal buyer address; canary jobs belong to it. */
export const CANARY_BUYER_ADDRESS = '0x000000000000000000000000000000000000c4a4';

// ---- evaluation -------------------------------------------------------------------------------------

export function evaluateChat(expect: ChatExpect, text: string): boolean {
  const t = text.toLowerCase();
  if ('regex' in expect) return new RegExp(expect.regex, 'i').test(text);
  return expect.anyOf.some((w) => t.includes(w.toLowerCase()));
}

export function evaluateEmbeddings(
  reference: readonly (readonly number[])[],
  observed: readonly (readonly number[])[],
  min: number = EMBEDDING_COSINE_MIN,
): { pass: boolean; minCosine: number; meanCosine: number; n: number } {
  if (observed.length !== reference.length || reference.length === 0)
    return { pass: false, minCosine: 0, meanCosine: 0, n: observed.length };
  const cs = reference.map((r, i) => cosine(r, observed[i] as number[]));
  const minCosine = Math.min(...cs);
  const meanCosine = cs.reduce((a, b) => a + b, 0) / cs.length;
  return { pass: minCosine >= min, minCosine, meanCosine, n: cs.length };
}

/** Negative withhold row amount: the whole unbuilt-epoch balance, never more than the node earned. */
export function withholdAmount(unbuiltEarnedMicros: bigint): bigint {
  return unbuiltEarnedMicros > 0n ? -unbuiltEarnedMicros : 0n;
}

export function clampReputation(rep: number, delta: number): number {
  return Math.max(canarySettings.repMin, Math.min(canarySettings.repMax, rep + delta));
}

/**
 * Probability that a node gets a canary in one scheduler tick: `rateBps` of its last-hour jobs spread
 * over 60 ticks; at least one per `minIntervalMs` is enforced separately.
 */
export function canaryProbability(jobsLastHour: number, rateBps = canarySettings.rateBps): number {
  const perHour = (jobsLastHour * rateBps) / 10_000;
  return Math.min(1, perHour / (3600_000 / canarySettings.tickMs));
}

// ---- pending specs ---------------------------------------------------------------------------------------

type Spec =
  | { kind: 'chat'; model: string; prompt: string; corpus: string; expect: ChatExpect; attempt: 1 | 2 }
  | {
      kind: 'chat-house';
      model: CatalogModel;
      prompt: string;
      corpus: string;
      body: Record<string, unknown>;
      attempt: 1 | 2;
    }
  | { kind: 'embeddings'; model: string; corpus: string; refs: number[][]; attempt: 1 | 2 };
const specs = new Map<string, { spec: Spec; at: number }>();

/** Drops specs of canaries that never finished (worker restart, lost callback). */
export function sweepSpecs(now = canaryDeps.now()): number {
  let n = 0;
  for (const [id, e] of specs) {
    if (now - e.at > canarySettings.specTtlMs) {
      specs.delete(id);
      n++;
    }
  }
  return n;
}
export const pendingSpecCount = (): number => specs.size;

// ---- embedding references ----------------------------------------------------------------------------------

interface EmbeddingRef {
  digest: string;
  vector: number[];
  computedAt: string;
}
const vecKey = (model: string, input: string) => `canary:embvec:${model}:${sha256Hex(input)}`;

export const modelDigestOf = (done: JobDone): string => {
  try {
    return decodeReceipt(receiptFromBase64(done.receipt)).payload.modelDigest;
  } catch {
    return 'unknown';
  }
};

/**
 * Reference vectors for exactly these inputs, computed per input on the house node and cached in `kv`
 * for a day (keyed by model and input hash). Null when the house node cannot supply them.
 */
export async function referencesFor(model: CatalogModel, inputs: string[]): Promise<number[][] | null> {
  const keys = inputs.map((i) => vecKey(model.id, i));
  const rows = await dbRef.db.select().from(kv).where(inArray(kv.key, keys));
  const cached = new Map(rows.map((r) => [r.key, r.value as EmbeddingRef]));
  const fresh = (v?: EmbeddingRef) =>
    v && canaryDeps.now() - new Date(v.computedAt).getTime() < canarySettings.embeddingRefTtlMs
      ? v
      : undefined;
  const missing = inputs.filter((i) => !fresh(cached.get(vecKey(model.id, i))));
  if (missing.length > 0) {
    const house = (
      await canaryDeps.candidates({
        model: model.id,
        lane: 'open',
        kind: 'embeddings',
        includeUnregistered: true,
      })
    ).find((c) => c.isHouse);
    const engineModel = house ? model.engineIds[house.engine as 'ollama' | 'vllm'] : undefined;
    if (!house || !engineModel) return null;
    try {
      const done = await canaryDeps.dispatch(
        house.nodeId,
        {
          jobId: randomUUID(),
          kind: 'embeddings',
          model: model.id,
          engineModel,
          lane: 'open',
          request: { model: model.id, input: missing },
          maxTokens: 0,
          deadlineMs: canaryDeps.now() + nodeSettings.jobTimeoutMs,
        },
        () => {},
      );
      const vectors = embeddingsOf(done.output);
      if (vectors.length !== missing.length || vectors.some((v) => v.length === 0)) return null;
      const digest = modelDigestOf(done);
      const computedAt = new Date(canaryDeps.now()).toISOString();
      for (const [i, input] of missing.entries()) {
        const value: EmbeddingRef = { digest, vector: vectors[i] as number[], computedAt };
        cached.set(vecKey(model.id, input), value);
        await dbRef.db
          .insert(kv)
          .values({ key: vecKey(model.id, input), value })
          .onConflictDoUpdate({ target: kv.key, set: { value, updatedAt: new Date() } });
      }
    } catch (err) {
      logger.warn({ err: String(err), model: model.id }, 'embedding reference computation failed');
      return null;
    }
  }
  return inputs.map((i) => (cached.get(vecKey(model.id, i)) as EmbeddingRef).vector);
}

// ---- dispatch ----------------------------------------------------------------------------------------------

async function canaryBuyerId(): Promise<string> {
  const [row] = await dbRef.db
    .select({ id: buyers.id })
    .from(buyers)
    .where(eq(buyers.address, CANARY_BUYER_ADDRESS));
  return row?.id ?? buyerIdForAddress(CANARY_BUYER_ADDRESS);
}

export interface CanaryTarget {
  node: CandidateLite;
  model: CatalogModel;
}

let shapesCache: { at: number; shapes: BuyerShape[] } | null = null;
const SHAPES_TTL_MS = 5 * 60_000;
const SHAPES_MIN = 20;

/** The shape of a random recent buyer request, or a prior until enough have been seen. */
async function nextShape(): Promise<BuyerShape> {
  const now = canaryDeps.now();
  if (!shapesCache || now - shapesCache.at > SHAPES_TTL_MS) {
    const raw = await getRedis()
      .lrange(SHAPES_KEY, 0, -1)
      .catch(() => [] as string[]);
    shapesCache = { at: now, shapes: raw.map((r) => JSON.parse(r) as BuyerShape) };
  }
  const { shapes } = shapesCache;
  if (shapes.length < SHAPES_MIN) return priorShape(canaryDeps.random);
  return shapes[Math.floor(canaryDeps.random() * shapes.length)] as BuyerShape;
}

export const resetShapeCacheForTest = (): void => {
  shapesCache = null;
};

/**
 * Sends one canary and feeds the finished job to B7. Returns the job id, or null if it could not run.
 * `attempt` 2 is the immediate retry after a failed first attempt (a different prompt / inputs).
 */
export async function sendCanary(
  target: CanaryTarget,
  opts: { attempt?: 1 | 2; avoidPrompt?: string } = {},
): Promise<string | null> {
  const { node, model } = target;
  const attempt = opts.attempt ?? 1;
  const engineModel = model.engineIds[node.engine as 'ollama' | 'vllm'];
  if (!engineModel) return null;
  const jobId = randomUUID();
  let body: Record<string, unknown>;
  let maxTokens = 0;
  let spec: Spec;
  let messages: { role: string; content: unknown }[] | undefined;
  let inputs: string[] | undefined;
  const corpus = activeCorpus();
  if (!corpus) return null;
  if (model.kind === 'embeddings') {
    if (corpus.embeddings.length === 0) return null;
    inputs = drawEmbeddingInputs(corpus.embeddings, canaryDeps.random);
    const refs = await referencesFor(model, inputs);
    if (!refs) return null;
    const [only] = inputs;
    body = { model: model.id, input: inputs.length === 1 && canaryDeps.random() < 0.5 ? only : inputs };
    spec = { kind: 'embeddings', model: model.id, corpus: corpus.id, refs, attempt };
  } else {
    const shape = await nextShape();
    const known = corpus.prompts.filter((p) => p.expect);
    // Most prompts are judged against the house node; without it only known answers can be judged.
    const usable = (await houseFor(model).catch(() => null)) ? corpus.prompts : known;
    const draw = () => drawChatCanary(usable, corpus.systems, shape, canaryDeps.random);
    let c = draw();
    for (let i = 0; i < 10 && c && opts.avoidPrompt && c.promptId === opts.avoidPrompt; i++) c = draw();
    if (!c) return null;
    messages = c.messages;
    maxTokens = c.maxTokens;
    // the fields and order the gateway forwards for a buyer request
    body = {
      model: model.id,
      messages,
      stream: true,
      max_tokens: maxTokens,
      ...(c.temperature !== undefined ? { temperature: c.temperature } : {}),
      ...(c.topP !== undefined ? { top_p: c.topP } : {}),
      ...(c.seed !== undefined ? { seed: c.seed } : {}),
    };
    spec = c.expect
      ? {
          kind: 'chat',
          model: model.id,
          prompt: c.promptId,
          corpus: corpus.id,
          expect: c.expect,
          attempt,
        }
      : { kind: 'chat-house', model, prompt: c.promptId, corpus: corpus.id, body, attempt };
  }
  const kind = model.kind as JobKind;
  await dbRef.db.insert(jobs).values({
    id: jobId,
    buyerId: await canaryBuyerId(),
    lane: 'open',
    model: model.id,
    kind,
    unitKind: unitKindFor(kind),
    payMode: 'canary',
    isCanary: true,
    status: 'queued',
  });
  specs.set(jobId, { spec, at: canaryDeps.now() });
  let text = '';
  try {
    await updateJob(jobId, { nodeId: node.nodeId, status: 'dispatched', dispatchedAt: new Date() });
    const done = await canaryDeps.dispatch(
      node.nodeId,
      {
        jobId,
        kind,
        model: model.id,
        engineModel,
        lane: 'open',
        request: body,
        maxTokens,
        deadlineMs: canaryDeps.now() + nodeSettings.jobTimeoutMs,
      },
      (d) => {
        if (d.delta.content) text += d.delta.content;
      },
    );
    const u = done.usage;
    await updateJob(
      jobId,
      {
        status: 'completed',
        units: String(u.promptTokens + (kind === 'chat' ? u.completionTokens : 0)),
        promptTokens: u.promptTokens,
        completionTokens: u.completionTokens,
        finishedAt: new Date(),
      },
      ['queued', 'dispatched', 'running'],
    );
    const view: import('../../shared/contracts/jobs').GatewayView = {
      inputDigest: sha256Hex(canonicalJson(body)),
      recountEstimated: false,
    };
    if (kind === 'chat') {
      view.outputText = text;
      const [p, c] = await Promise.all([
        countChatPrompt(model.id, messages as never),
        countTokens(model.id, text),
      ]);
      view.recount = { promptTokens: p.tokens, completionTokens: c.tokens };
      view.recountEstimated = p.estimated || c.estimated;
    } else {
      view.embeddings = embeddingsOf(done.output);
      const counts = await Promise.all((inputs ?? []).map((t) => countTokens(model.id, t)));
      view.recount = { promptTokens: counts.reduce((a, b) => a + b.tokens, 0), completionTokens: 0 };
      view.recountEstimated = counts.some((x) => x.estimated);
    }
    await onJobFinished(jobId, { v: 1, type: 'job.done', jobId, ...done }, view);
    return jobId;
  } catch (err) {
    // node-side errors (busy, model not ready, lost, timeout) are inconclusive and never penalised
    logger.info({ jobId, nodeId: node.nodeId, err: String(err) }, 'canary did not complete');
    await updateJob(jobId, { status: 'failed', error: String(err).slice(0, 500), finishedAt: new Date() }, [
      'queued',
      'dispatched',
      'running',
    ]).catch(() => {});
    return null;
  } finally {
    // every terminal path, including onJobFinished returning early without calling the hook
    specs.delete(jobId);
  }
}

// ---- scheduling ---------------------------------------------------------------------------------------------

/** Online, eligible, non-house nodes with the models they currently serve. */
export async function canaryTargets(): Promise<Map<string, { node: CandidateLite; models: CatalogModel[] }>> {
  const out = new Map<string, { node: CandidateLite; models: CatalogModel[] }>();
  for (const model of (await loadCatalog()).filter(
    (m) => (m.kind === 'chat' || m.kind === 'embeddings') && m.lanes.includes('open'),
  )) {
    const list = await canaryDeps.candidates({
      model: model.id,
      lane: 'open',
      kind: model.kind as 'chat' | 'embeddings',
    });
    for (const c of list) {
      if (c.isHouse) continue; // the house node is the reference and is never audited by canaries
      const e = out.get(c.nodeId) ?? { node: c, models: [] };
      e.models.push(model);
      out.set(c.nodeId, e);
    }
  }
  return out;
}

/** One scheduler tick (every minute). Returns the ids of nodes that got a canary. */
export async function scheduleCanaries(): Promise<string[]> {
  sweepSpecs();
  if (!activeCorpus()) {
    logger.error('no canary corpus (CANARY_CORPUS_PATH): nodes are not being checked');
    return [];
  }
  const targets = await canaryTargets();
  if (targets.size === 0) return [];
  const now = canaryDeps.now();
  const hourAgo = new Date(now - canarySettings.minIntervalMs);
  const traffic = await dbRef.db
    .select({ nodeId: jobs.nodeId, n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.isCanary, false), gte(jobs.createdAt, hourAgo)))
    .groupBy(jobs.nodeId);
  const last = await dbRef.db
    .select({ nodeId: jobs.nodeId, at: sql<Date>`max(${jobs.createdAt})` })
    .from(jobs)
    .where(eq(jobs.isCanary, true))
    .groupBy(jobs.nodeId);
  const jobsBy = new Map(traffic.map((r) => [r.nodeId, r.n]));
  const lastBy = new Map(last.map((r) => [r.nodeId, r.at ? new Date(r.at).getTime() : 0]));
  const sent: string[] = [];
  for (const [nodeId, { node, models }] of targets) {
    const overdue = now - (lastBy.get(nodeId) ?? 0) >= canarySettings.minIntervalMs;
    if (!overdue && canaryDeps.random() >= canaryProbability(jobsBy.get(nodeId) ?? 0)) continue;
    const embeddings = models.filter((m) => m.kind === 'embeddings');
    const chats = models.filter((m) => m.kind === 'chat');
    const wantEmb =
      embeddings.length > 0 && (chats.length === 0 || canaryDeps.random() < canarySettings.embeddingShare);
    const pool = wantEmb ? embeddings : chats;
    const model = pool[Math.floor(canaryDeps.random() * pool.length)];
    if (!model) continue;
    sent.push(nodeId);
    void sendCanary({ node, model }).catch((err) =>
      logger.error({ err: String(err), nodeId }, 'canary failed'),
    );
  }
  return sent;
}

// ---- result handling ----------------------------------------------------------------------------------------

/** Called by B7 (via the hook) once a canary job's receipt was checked. */
export async function handleCanaryFinished(e: CanaryFinished): Promise<void> {
  const entry = specs.get(e.jobId);
  specs.delete(e.jobId);
  const spec = entry?.spec;
  let pass: boolean;
  let kind: string;
  let expected: unknown;
  let observed: unknown;
  if (!spec) {
    if (e.verified) {
      logger.warn({ jobId: e.jobId }, 'canary finished without a pending spec; ignoring');
      return;
    }
    pass = false;
    kind = 'unknown';
    expected = null;
    observed = { receipt: e.reason };
  } else if (spec.kind === 'chat') {
    kind = 'chat';
    expected = {
      model: spec.model,
      prompt: spec.prompt,
      corpus: spec.corpus,
      expect: spec.expect,
    };
    const text = e.outputText ?? '';
    pass = e.verified && evaluateChat(spec.expect, text);
    observed = { text: text.slice(0, 200), receiptVerified: e.verified, receiptReason: e.reason };
  } else if (spec.kind === 'chat-house') {
    kind = 'chat';
    expected = {
      model: spec.model.id,
      prompt: spec.prompt,
      corpus: spec.corpus,
      minCosine: compareSettings.chatCosineMin,
    };
    const text = e.outputText ?? '';
    const r = e.verified ? await compareChatWithHouse(spec.model, spec.body, text) : null;
    if (r?.verdict === 'inconclusive') {
      logger.info({ jobId: e.jobId, reason: r.reason }, 'canary inconclusive; not counted');
      return;
    }
    pass = r?.verdict === 'match';
    observed = {
      text: text.slice(0, 200),
      receiptVerified: e.verified,
      receiptReason: e.reason,
      ...(r ? { cosine: r.cosine, houseSelf: r.houseSelf } : {}),
    };
  } else {
    kind = 'embeddings';
    expected = {
      model: spec.model,
      corpus: spec.corpus,
      minCosine: EMBEDDING_COSINE_MIN,
      n: spec.refs.length,
    };
    const r = evaluateEmbeddings(spec.refs, e.embeddings ?? []);
    pass = e.verified && r.pass;
    observed = { ...r, receiptVerified: e.verified, receiptReason: e.reason };
  }
  // a first failure does not count: it is retried at once with a different prompt / inputs
  const retry = !pass && spec !== undefined && spec.attempt === 1;
  await recordCanaryResult({
    nodeId: e.nodeId,
    jobId: e.jobId,
    kind,
    expected,
    observed,
    pass,
    final: !retry,
  });
  if (retry) await retryCanary(e.nodeId, spec);
}

async function retryCanary(nodeId: string, spec: Spec): Promise<void> {
  try {
    const [node] = await dbRef.db.select().from(nodes).where(eq(nodes.id, nodeId));
    const modelId = spec.kind === 'chat-house' ? spec.model.id : spec.model;
    const model = (await loadCatalog()).find((m) => m.id === modelId);
    if (!node || !model || node.status === 'suspended' || node.isHouse) return;
    await sendCanary(
      { node: { nodeId, isHouse: false, engine: node.engine }, model },
      { attempt: 2, avoidPrompt: spec.kind === 'embeddings' ? undefined : spec.prompt },
    );
  } catch (err) {
    logger.warn({ err: String(err), nodeId }, 'canary retry failed to run');
  }
}

export interface CanaryRecord {
  nodeId: string;
  jobId: string | null;
  kind: string;
  expected: unknown;
  observed: unknown;
  pass: boolean;
  /** false for a failed first attempt that is being retried: stored, but it counts for nothing. */
  final?: boolean;
}

/** Rows that count toward a node's record: everything except failed first attempts awaiting a retry. */
const counted = sql`not (${canaryResults.pass} = false and coalesce(${canaryResults.observed}->>'attempt', '') = '1')`;

/**
 * Shadow results and canaries are judged apart. A node that has learned the corpus passes every canary, so
 * counted together those passes would outweigh its shadow failures and it would never reach the failure share.
 */
const sameCheck = (kind: string) =>
  kind === 'shadow'
    ? sql`${canaryResults.kind} = 'shadow'`
    : sql`coalesce(${canaryResults.kind}, '') <> 'shadow'`;

/**
 * Stores the result and moves reputation. A confirmed failure only becomes a failure *event* (reputation
 * -100, epoch earnings withheld) once the node has >= `minSample` canaries in the window and >= half of
 * them failed; with >= `suspendFails` failures it is also suspended and a slash case is opened.
 */
export async function recordCanaryResult(r: CanaryRecord): Promise<{ withheld: bigint; suspended: boolean }> {
  const final = r.final ?? true;
  let withheld = 0n;
  let isHouse = false;
  let failures = 0;
  let event = false;
  const since = await sinceUnsuspend(r.nodeId, new Date(canaryDeps.now() - canarySettings.failWindowMs));
  await dbRef.db.transaction(async (tx) => {
    const locked = await tx.execute(sql`select owner, is_house from nodes where id = ${r.nodeId} for update`);
    const row = locked[0] as { owner: string; is_house: boolean } | undefined;
    if (!row) return;
    isHouse = row.is_house;
    if (isHouse) return;
    await tx.insert(canaryResults).values({
      nodeId: r.nodeId,
      jobId: r.jobId,
      kind: r.kind,
      expected: r.expected,
      observed: final ? r.observed : { ...(r.observed as object), attempt: 1 },
      pass: r.pass,
    });
    if (!final) return;
    if (r.pass) {
      await tx
        .update(nodes)
        .set({
          reputation: sql`greatest(${canarySettings.repMin}, least(${canarySettings.repMax}, ${nodes.reputation} + ${canarySettings.passDelta}))`,
        })
        .where(eq(nodes.id, r.nodeId));
      return;
    }
    const [stats] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        fails: sql<number>`(count(*) filter (where ${canaryResults.pass} = false))::int`,
      })
      .from(canaryResults)
      .where(
        and(
          eq(canaryResults.nodeId, r.nodeId),
          gte(canaryResults.createdAt, since),
          counted,
          sameCheck(r.kind),
        ),
      );
    const total = stats?.total ?? 0;
    failures = stats?.fails ?? 0;
    event = total >= canarySettings.minSample && failures * 10_000 >= total * canarySettings.failShareBps;
    if (!event) return;
    await tx
      .update(nodes)
      .set({
        reputation: sql`greatest(${canarySettings.repMin}, least(${canarySettings.repMax}, ${nodes.reputation} + ${canarySettings.failDelta}))`,
      })
      .where(eq(nodes.id, r.nodeId));
    const [sum] = await tx
      .select({
        n: sql<string>`coalesce(sum(${earningEvents.usdgMicros}), 0)::text`,
        first: sql<string | null>`min(${earningEvents.ts})`,
      })
      .from(earningEvents)
      .where(
        and(
          eq(earningEvents.nodeId, r.nodeId),
          sql`${earningEvents.epoch} is null`,
          sql`${earningEvents.kind} <> 'slash'`,
        ),
      );
    withheld = withholdAmount(BigInt(sum?.n ?? '0'));
    if (withheld < 0n) {
      await tx.insert(earningEvents).values({
        // the earliest earning's time: a build then takes the withhold with the earnings it cancels
        ts: new Date(sum?.first as string),
        nodeId: r.nodeId,
        owner: row.owner,
        jobId: r.jobId,
        kind: 'canary_withhold',
        usdgMicros: withheld,
      });
    }
  });
  let suspended = false;
  if (event && failures >= canarySettings.suspendFails && !isHouse) {
    await openCase(r.nodeId, 'canary_fraud');
    suspended = await suspendNode(r.nodeId, `${failures} failed canaries in 24h`, { auto: true });
  }
  return { withheld, suspended };
}
