/**
 * Canary jobs: known-answer chat prompts and house-referenced embeddings, sent to registered non-house
 * nodes as ordinary jobs (same message shape, same model ids, no flag). They run in the worker, so the
 * dispatch goes through the Redis bridge; the finished job is handed to B7's `onJobFinished` exactly like
 * a buyer job, which calls `onCanaryFinished` -> `handleCanaryFinished` below. Canaries are free: no
 * buyer charge, no provider earning.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import { config } from '../../config';
import { buyers, canaryResults, earningEvents, jobs, kv, nodes, receipts } from '../../db/schema';
import { logger } from '../../lib/logger';
import { canonicalJson, sha256Hex } from '../../shared/canonical-json';
import type { CatalogModel } from '../../shared/catalog';
import type { JobKind } from '../../shared/enums';
import { decodeReceipt, receiptFromBase64 } from '../../shared/receipt';
import { dbRef } from '../auth/constants';
import { buyerIdForAddress } from '../buyers/service';
import { unitKindFor } from '../gateway/pricing';
import { updateJob } from '../gateway/service';
import { countChatPrompt, countTokens } from '../gateway/tokenizer';
import { type Delta, type JobDone, type JobStartInput, requestFromWorker } from '../nodes/jobs';
import { loadCatalog, nodeSettings } from '../nodes/service';
import { onJobFinished } from '../receipts/service';
import { openCase, sinceUnsuspend, suspendNode } from '../slashing/service';
import {
  CANARY_CHAT_PARAMS,
  CANARY_FIXTURE_VERSION,
  CHAT_FIXTURES,
  type ChatExpect,
  type ChatFixture,
  EMBEDDING_COSINE_MIN,
  EMBEDDING_SENTENCES,
} from './fixtures';
import type { CanaryFinished } from './hooks';

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
  failWindowMs: 24 * 3600_000,
  /** Share of canaries that are embeddings when the node serves an embeddings model with a reference. */
  embeddingShare: 0.25,
  embeddingRefTtlMs: 24 * 3600_000,
};

/** Internal buyer address; canary jobs belong to it. */
export const CANARY_BUYER_ADDRESS = '0x000000000000000000000000000000000000c4a4';

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

// ---- evaluation -------------------------------------------------------------------------------------

export function evaluateChat(expect: ChatExpect, text: string): boolean {
  const t = text.toLowerCase();
  if ('regex' in expect) return new RegExp(expect.regex, 'i').test(text);
  return expect.anyOf.some((w) => t.includes(w.toLowerCase()));
}

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
  | { kind: 'chat'; model: string; fixtureId: string; expect: ChatExpect }
  | { kind: 'embeddings'; model: string };
const specs = new Map<string, Spec>();

// ---- embedding references --------------------------------------------------------------------------------

interface EmbeddingRef {
  model: string;
  digest: string;
  fixtureVersion: number;
  vectors: number[][];
  computedAt: string;
}
const refKey = (model: string, digest?: string) => `canary:embref:${model}${digest ? `:${digest}` : ''}`;

async function saveRef(ref: EmbeddingRef): Promise<void> {
  for (const key of [refKey(ref.model), refKey(ref.model, ref.digest)]) {
    await dbRef.db
      .insert(kv)
      .values({ key, value: ref })
      .onConflictDoUpdate({ target: kv.key, set: { value: ref, updatedAt: new Date() } });
  }
}

export async function loadRef(model: string, digest?: string): Promise<EmbeddingRef | null> {
  for (const key of digest ? [refKey(model, digest), refKey(model)] : [refKey(model)]) {
    const [row] = await dbRef.db.select().from(kv).where(eq(kv.key, key));
    const v = row?.value as EmbeddingRef | undefined;
    if (v?.fixtureVersion === CANARY_FIXTURE_VERSION && v.vectors?.length === EMBEDDING_SENTENCES.length)
      return v;
  }
  return null;
}

export const modelDigestOf = (done: JobDone): string => {
  try {
    return decodeReceipt(receiptFromBase64(done.receipt)).payload.modelDigest;
  } catch {
    return 'unknown';
  }
};

const embeddingsOf = (output: unknown): number[][] =>
  ((output as { data?: { embedding?: number[] }[] } | null)?.data ?? []).map((d) => d.embedding ?? []);

/**
 * Computes reference vectors on the house node for every embeddings model whose reference is missing or
 * older than a day. Runs at worker start and daily; keyed by the house node's model digest.
 */
export async function refreshEmbeddingReferences(force = false): Promise<number> {
  let n = 0;
  for (const model of (await loadCatalog()).filter(
    (m) => m.kind === 'embeddings' && m.lanes.includes('open'),
  )) {
    const existing = await loadRef(model.id);
    if (
      !force &&
      existing &&
      canaryDeps.now() - new Date(existing.computedAt).getTime() < canarySettings.embeddingRefTtlMs
    )
      continue;
    const house = (
      await canaryDeps.candidates({
        model: model.id,
        lane: 'open',
        kind: 'embeddings',
        includeUnregistered: true,
      })
    ).find((c) => c.isHouse);
    const engineModel = house ? model.engineIds[house.engine as 'ollama' | 'vllm'] : undefined;
    if (!house || !engineModel) continue;
    try {
      const job: JobStartInput = {
        jobId: randomUUID(),
        kind: 'embeddings',
        model: model.id,
        engineModel,
        lane: 'open',
        request: { model: model.id, input: [...EMBEDDING_SENTENCES] },
        maxTokens: 0,
        deadlineMs: canaryDeps.now() + nodeSettings.jobTimeoutMs,
      };
      const done = await canaryDeps.dispatch(house.nodeId, job, () => {});
      const vectors = embeddingsOf(done.output);
      if (vectors.length !== EMBEDDING_SENTENCES.length || vectors.some((v) => v.length === 0)) continue;
      await saveRef({
        model: model.id,
        digest: modelDigestOf(done),
        fixtureVersion: CANARY_FIXTURE_VERSION,
        vectors,
        computedAt: new Date(canaryDeps.now()).toISOString(),
      });
      n++;
    } catch (err) {
      logger.warn({ err: String(err), model: model.id }, 'embedding reference refresh failed');
    }
  }
  return n;
}

// ---- dispatch ----------------------------------------------------------------------------------------------

async function canaryBuyerId(): Promise<string> {
  const [row] = await dbRef.db
    .select({ id: buyers.id })
    .from(buyers)
    .where(eq(buyers.address, CANARY_BUYER_ADDRESS));
  return row?.id ?? buyerIdForAddress(CANARY_BUYER_ADDRESS);
}

export function pickFixture(rand: () => number = canaryDeps.random): ChatFixture {
  return CHAT_FIXTURES[Math.floor(rand() * CHAT_FIXTURES.length)] as ChatFixture;
}

export interface CanaryTarget {
  node: CandidateLite;
  model: CatalogModel;
}

/** Sends one canary and feeds the finished job to B7. Returns the job id, or null if it could not run. */
export async function sendCanary(target: CanaryTarget): Promise<string | null> {
  const { node, model } = target;
  const engineModel = model.engineIds[node.engine as 'ollama' | 'vllm'];
  if (!engineModel) return null;
  const jobId = randomUUID();
  let body: Record<string, unknown>;
  let maxTokens = 0;
  let spec: Spec;
  let messages: { role: string; content: unknown }[] | undefined;
  let inputs: string[] | undefined;
  if (model.kind === 'embeddings') {
    if (!(await loadRef(model.id))) return null;
    inputs = [...EMBEDDING_SENTENCES];
    body = { model: model.id, input: inputs };
    spec = { kind: 'embeddings', model: model.id };
  } else {
    const f = pickFixture();
    messages = [{ role: 'user', content: f.prompt }];
    maxTokens = CANARY_CHAT_PARAMS.maxTokens;
    // same field order and names the gateway forwards for a buyer request
    body = {
      model: model.id,
      messages,
      stream: true,
      max_tokens: maxTokens,
      temperature: CANARY_CHAT_PARAMS.temperature,
      seed: CANARY_CHAT_PARAMS.seed,
    };
    spec = { kind: 'chat', model: model.id, fixtureId: f.id, expect: f.expect };
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
  specs.set(jobId, spec);
  const fail = async (err: unknown) => {
    specs.delete(jobId);
    await updateJob(jobId, { status: 'failed', error: String(err).slice(0, 500), finishedAt: new Date() }, [
      'queued',
      'dispatched',
      'running',
    ]).catch(() => {});
  };
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
    await fail(err);
    return null;
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
  const spec = specs.get(e.jobId);
  specs.delete(e.jobId);
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
      fixtureId: spec.fixtureId,
      fixtureVersion: CANARY_FIXTURE_VERSION,
      expect: spec.expect,
    };
    const text = e.outputText ?? '';
    pass = e.verified && evaluateChat(spec.expect, text);
    observed = { text: text.slice(0, 200), receiptVerified: e.verified, receiptReason: e.reason };
  } else {
    kind = 'embeddings';
    const [rc] = await dbRef.db.select().from(receipts).where(eq(receipts.jobId, e.jobId));
    const digest = (rc?.payload as { modelDigest?: string } | undefined)?.modelDigest;
    const ref = await loadRef(spec.model, digest);
    expected = {
      model: spec.model,
      fixtureVersion: CANARY_FIXTURE_VERSION,
      minCosine: EMBEDDING_COSINE_MIN,
      refDigest: ref?.digest ?? null,
    };
    if (!ref) {
      logger.warn({ jobId: e.jobId }, 'embedding canary has no reference; ignoring');
      return;
    }
    const r = evaluateEmbeddings(ref.vectors, e.embeddings ?? []);
    pass = e.verified && r.pass;
    observed = { ...r, digest, receiptVerified: e.verified, receiptReason: e.reason };
  }
  await recordCanaryResult({ nodeId: e.nodeId, jobId: e.jobId, kind, expected, observed, pass });
}

export interface CanaryRecord {
  nodeId: string;
  jobId: string | null;
  kind: string;
  expected: unknown;
  observed: unknown;
  pass: boolean;
}

/** Stores the result, moves reputation, withholds on failure and escalates after repeated failures. */
export async function recordCanaryResult(r: CanaryRecord): Promise<{ withheld: bigint; suspended: boolean }> {
  let withheld = 0n;
  let isHouse = false;
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
      observed: r.observed,
      pass: r.pass,
    });
    const delta = r.pass ? canarySettings.passDelta : canarySettings.failDelta;
    await tx
      .update(nodes)
      .set({
        reputation: sql`greatest(${canarySettings.repMin}, least(${canarySettings.repMax}, ${nodes.reputation} + ${delta}))`,
      })
      .where(eq(nodes.id, r.nodeId));
    if (!r.pass) {
      const [sum] = await tx
        .select({ n: sql<string>`coalesce(sum(${earningEvents.usdgMicros}), 0)::text` })
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
          ts: new Date(),
          nodeId: r.nodeId,
          owner: row.owner,
          jobId: r.jobId,
          kind: 'canary_withhold',
          usdgMicros: withheld,
        });
      }
    }
  });
  if (r.pass || isHouse) return { withheld, suspended: false };

  const since = await sinceUnsuspend(r.nodeId, new Date(canaryDeps.now() - canarySettings.failWindowMs));
  const [c] = await dbRef.db
    .select({ n: sql<number>`count(*)::int` })
    .from(canaryResults)
    .where(
      and(
        eq(canaryResults.nodeId, r.nodeId),
        eq(canaryResults.pass, false),
        gte(canaryResults.createdAt, since),
      ),
    );
  let suspended = false;
  if ((c?.n ?? 0) >= canarySettings.suspendFails) {
    await openCase(r.nodeId, 'canary_fraud');
    suspended = await suspendNode(r.nodeId, `${c?.n} failed canaries in 24h`, { auto: true });
  }
  return { withheld, suspended };
}
