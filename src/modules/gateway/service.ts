import { randomUUID } from 'node:crypto';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { config } from '../../config';
import { buyerBalances, jobs, rateCard } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { getRedis } from '../../lib/redis';
import { canonicalJson, sha256Hex } from '../../shared/canonical-json';
import type { CatalogModel } from '../../shared/catalog';
import type { GatewayView, OnJobFinished } from '../../shared/contracts/jobs';
import type { JobKind, Lane } from '../../shared/enums';
import { dbRef } from '../auth/constants';
import { maybeEnqueueShadow } from '../canary/shadow';
import { nodeHub } from '../nodes/hub';
import { type Delta, type JobDone, JobFailure, type JobHandle, type JobStartInput } from '../nodes/jobs';
import { billingClass, loadCatalog, nodeSettings } from '../nodes/service';
import { type Authorization, getPaymentProvider, parseAuth, serializeAuth } from './payment';
import { actualCharge, buyerRate, type MaxChargeEstimate, type Rate, unitKindFor, utcDay } from './pricing';
import { type Candidate, rank, recordTtft, type ScheduleRequest } from './scheduler';
import { countChatPrompt, countEmbeddingInput, countTokens } from './tokenizer';

/** Test seams. */
export const gatewayDeps = {
  dispatch: (nodeId: string, input: JobStartInput): JobHandle => nodeHub.dispatch(nodeId, input),
  rank: (req: ScheduleRequest): Promise<Candidate[]> => rank(req),
  /** Jobs are re-routed at most this many extra times before the first byte. */
  maxRetries: 1,
};

// ---- request model ---------------------------------------------------------------------------------

export interface GatewayRequest {
  kind: JobKind;
  model: CatalogModel;
  lane: Lane;
  /** Sanitized OpenAI body sent to the node (`job.start.request`); the input digest covers exactly this. */
  body: Record<string, unknown>;
  stream: boolean;
  /** job.start.maxTokens (chat max_tokens, else 0) */
  maxTokens: number;
  estimate: MaxChargeEstimate;
  /**
   * Chat: gateway-recounted prompt tokens + max_tokens. Only nodes serving at least this context are
   * routed to, so an engine never silently truncates the prompt (FX3).
   */
  contextNeeded?: number;
  /** chat messages / embeddings input kept for recounts */
  messages?: { role: string; content: unknown }[];
  inputs?: string[];
}

/** OpenAI-compatible 400 `context_length_exceeded` (no reservation or payment challenge precedes it). */
export function contextLengthError(
  model: string,
  maxContext: number,
  promptTokens: number,
  maxTokens: number,
): AppError {
  return new AppError(
    'VALIDATION',
    `This model's maximum context length is ${maxContext} tokens. However, you requested about ${
      promptTokens + maxTokens
    } tokens (${promptTokens} in the messages, ${maxTokens} in the completion). Please reduce the length of the messages or max_tokens.`,
    400,
    { openaiCode: 'context_length_exceeded', model, maxContext, promptTokens, maxTokens },
  );
}

export async function resolveModel(id: string, kind: JobKind, lane: Lane): Promise<CatalogModel> {
  const model = (await loadCatalog()).find((m) => m.id === id);
  if (!model) throw new AppError('NOT_FOUND', `The model '${id}' does not exist or is not enabled.`);
  if (model.kind !== kind) {
    throw new AppError('VALIDATION', `The model '${id}' does not support ${kind}.`);
  }
  if (!model.lanes.includes(lane)) {
    throw new AppError('VALIDATION', `The model '${id}' is not available in the ${lane} lane.`);
  }
  return model;
}

// ---- job rows & authorization registry -----------------------------------------------------------

type JobPatch = Partial<typeof jobs.$inferInsert>;

export async function updateJob(jobId: string, patch: JobPatch, onlyFrom?: string[]): Promise<void> {
  const where = onlyFrom ? and(eq(jobs.id, jobId), inArray(jobs.status, onlyFrom)) : eq(jobs.id, jobId);
  await dbRef.db.update(jobs).set(patch).where(where);
}

const AUTH_TTL_SEC = 24 * 3600;
export const authKey = (jobId: string) => `gw:auth:${jobId}`;
/** Authorizations that could not be persisted to Redis (only these may be claimed locally). */
const localOnly = new Map<string, Authorization>();

async function rememberAuth(auth: Authorization): Promise<void> {
  try {
    await getRedis().set(authKey(auth.jobId), serializeAuth(auth), 'EX', AUTH_TTL_SEC);
    localOnly.delete(auth.jobId);
  } catch (err) {
    logger.warn({ err: String(err) }, 'could not persist job authorization; keeping it in memory');
    localOnly.set(auth.jobId, auth);
  }
}

/**
 * Atomically take the authorization for a job; the first caller (any process) wins, later callers get
 * null. Redis is the single authority, so the reaper and a late settle cannot both act.
 */
async function claimAuth(jobId: string): Promise<Authorization | null> {
  try {
    const raw = await getRedis().getdel(authKey(jobId));
    if (raw) return parseAuth(raw);
  } catch {
    // Redis down: fall back to the in-memory copy
  }
  const local = localOnly.get(jobId);
  localOnly.delete(jobId);
  return local ?? null;
}

/**
 * Charge `chargeMicros` for a job through its payment provider and drop the reservation. Idempotent:
 * a second call (or a call after `releaseJob`) returns null. This is what B7 calls once a receipt
 * verifies.
 */
export async function settleJob(jobId: string, chargeMicros: bigint): Promise<bigint | null> {
  const auth = await claimAuth(jobId);
  if (!auth) return null;
  const provider = getPaymentProvider(auth.provider);
  if (!provider) {
    await rememberAuth(auth);
    throw new Error(`payment provider '${auth.provider}' is not registered`);
  }
  try {
    const charged = await provider.finalize(auth, chargeMicros);
    if (charged > 0n) await rememberCharge(auth, charged);
    return charged;
  } catch (err) {
    await rememberAuth(auth); // keep the reservation recoverable
    throw err;
  }
}

// ---- charge records (so a failed receipt can reverse an already-applied charge) ------------------------

const CHARGE_TTL_SEC = 7 * 24 * 3600;
export const chargeKey = (jobId: string) => `gw:charged:${jobId}`;
const chargedLocal = new Map<string, string>();

async function rememberCharge(auth: Authorization, charged: bigint): Promise<void> {
  const v = JSON.stringify({ auth: serializeAuth(auth), charged: charged.toString() });
  chargedLocal.set(auth.jobId, v);
  try {
    await getRedis().set(chargeKey(auth.jobId), v, 'EX', CHARGE_TTL_SEC);
    chargedLocal.delete(auth.jobId);
  } catch (err) {
    logger.warn({ err: String(err) }, 'could not persist charge record; keeping it in memory');
  }
}

/**
 * Undo the charge `settleJob` applied for this job (its receipt failed verification), through the payment
 * provider: prepaid gets a credit + `refund` ledger row, an x402 session gets its `used` reduced, an
 * unsettled exact payment is voided, and an x402 payment already settled on-chain stays settled and the
 * payer is credited on their prepaid balance. Idempotent: the record is taken atomically, so only one
 * caller reverses. Returns the amount reversed (0n when nothing was charged).
 */
export async function reverseCharge(jobId: string): Promise<bigint> {
  let raw: string | null = null;
  try {
    raw = await getRedis().getdel(chargeKey(jobId));
  } catch {
    // Redis down: fall back to the in-memory copy
  }
  if (!raw) {
    raw = chargedLocal.get(jobId) ?? null;
  }
  chargedLocal.delete(jobId);
  if (!raw) return 0n;
  const rec = JSON.parse(raw) as { auth: string; charged: string };
  const auth = parseAuth(rec.auth);
  const charged = BigInt(rec.charged);
  const provider = getPaymentProvider(auth.provider);
  if (!provider?.reverse) {
    logger.error({ jobId, provider: auth.provider }, 'payment provider cannot reverse a charge');
    return 0n;
  }
  try {
    await provider.reverse(auth, charged);
  } catch (err) {
    await rememberCharge(auth, charged); // keep it recoverable
    throw err;
  }
  return charged;
}

/** Drop a job's reservation without charging (failure, timeout, rejected receipt). Idempotent. */
export async function releaseJob(jobId: string): Promise<boolean> {
  const auth = await claimAuth(jobId);
  if (!auth) return false;
  const provider = getPaymentProvider(auth.provider);
  if (!provider) {
    await rememberAuth(auth);
    throw new Error(`payment provider '${auth.provider}' is not registered`);
  }
  try {
    await provider.release(auth);
    return true;
  } catch (err) {
    await rememberAuth(auth);
    throw err;
  }
}

// ---- onJobFinished hook (B7) ----------------------------------------------------------------------

/**
 * Fallback used until B7 registers its verifier: bills the node-reported usage unverified. B7 replaces
 * it with `registerJobFinishedHandler(onJobFinished)`.
 */
const defaultOnJobFinished: OnJobFinished = async (jobId) => {
  const [job] = await dbRef.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  await settleJob(jobId, job?.buyerUsdgMicros ?? 0n);
};

let finishedHandler: OnJobFinished = defaultOnJobFinished;
export function registerJobFinishedHandler(handler: OnJobFinished): void {
  finishedHandler = handler;
}
export function resetJobFinishedHandler(): void {
  finishedHandler = defaultOnJobFinished;
}

// ---- one job's lifecycle ---------------------------------------------------------------------------

export interface RunInit {
  jobId: string;
  req: GatewayRequest;
  auth: Authorization;
  rates: Map<number, Rate>;
}

const candidateClass = (c: Candidate, lane: Lane): number => billingClass(c.gpuClass, c.stake, lane);

export class JobRun {
  readonly jobId: string;
  readonly req: GatewayRequest;
  readonly auth: Authorization;
  readonly rates: Map<number, Rate>;
  node?: Candidate;
  handle?: JobHandle;
  text = '';
  reasoning = '';
  aborted = false;
  /** gateway recount of the embeddings input, computed once in completeRun and reused by finishJob */
  embeddingsRecount?: { tokens: number; estimated: boolean };
  private retries = 0;
  private startedAt = 0;

  constructor(init: RunInit) {
    this.jobId = init.jobId;
    this.req = init.req;
    this.auth = init.auth;
    this.rates = init.rates;
  }

  /** Stops the node job (client went away). Pending `deltas()` iteration then ends. */
  abort(): void {
    this.aborted = true;
    this.handle?.cancel();
  }

  rate(): Rate | undefined {
    return this.node ? this.rates.get(candidateClass(this.node, this.req.lane)) : undefined;
  }

  private startInput(node: Candidate): JobStartInput {
    const engineModel = this.req.model.engineIds[node.engine as 'ollama' | 'vllm'];
    if (!engineModel) throw new AppError('NO_CAPACITY', 'No node can serve this model right now.');
    return {
      jobId: this.jobId,
      kind: this.req.kind,
      model: this.req.model.id,
      engineModel,
      lane: this.req.lane,
      request: this.req.body,
      maxTokens: this.req.maxTokens,
      deadlineMs: Date.now() + nodeSettings.jobTimeoutMs,
    };
  }

  /**
   * Streams node deltas and returns the final `JobDone`. Before the first byte, a requeueable failure
   * (BUSY / MODEL_NOT_READY / NODE_LOST) or a dispatch refusal re-routes the job once to another node.
   * Throws `JobFailure` / `AppError` otherwise.
   */
  async *deltas(): AsyncGenerator<Delta, JobDone, void> {
    const tried = new Set<string>();
    for (;;) {
      if (this.aborted) throw new JobFailure('CANCELLED', 'Job cancelled.', false, 0);
      const ranked = (
        await gatewayDeps.rank({
          model: this.req.model.id,
          lane: this.req.lane,
          kind: this.req.kind,
          minVramMb: this.req.model.minVramMb,
          ...(this.req.contextNeeded ? { minContext: this.req.contextNeeded } : {}),
          exclude: tried,
        })
      ).filter((c) => this.rates.has(candidateClass(c, this.req.lane)));
      const node = ranked[0];
      if (!node) throw new AppError('NO_CAPACITY', 'No node is available for this model right now.');
      let handle: JobHandle;
      try {
        handle = gatewayDeps.dispatch(node.nodeId, this.startInput(node));
      } catch (err) {
        tried.add(node.nodeId);
        if (err instanceof AppError && err.code !== 'CONFLICT' && this.retries < gatewayDeps.maxRetries) {
          this.retries++;
          continue;
        }
        throw err;
      }
      this.node = node;
      this.handle = handle;
      if (this.aborted) handle.cancel();
      this.startedAt = Date.now();
      await updateJob(this.jobId, { nodeId: node.nodeId, status: 'dispatched', dispatchedAt: new Date() }, [
        'queued',
        'dispatched',
      ]).catch((err) => logger.warn({ err: String(err) }, 'job dispatch update failed'));
      void handle.accepted.then((ok) => {
        if (ok) void updateJob(this.jobId, { status: 'running' }, ['queued', 'dispatched']).catch(() => {});
      });
      let emitted = 0;
      try {
        for await (const d of handle.chunks) {
          if (emitted === 0) recordTtft(node.nodeId, Date.now() - this.startedAt);
          emitted++;
          if (d.delta.content) this.text += d.delta.content;
          if (d.delta.reasoning) this.reasoning += d.delta.reasoning;
          yield d;
        }
        return await handle.done;
      } catch (err) {
        if (
          err instanceof JobFailure &&
          err.requeueable &&
          emitted === 0 &&
          !this.aborted &&
          this.retries < gatewayDeps.maxRetries
        ) {
          this.retries++;
          tried.add(node.nodeId);
          continue;
        }
        throw err;
      } finally {
        handle.cancel(); // no-op once settled; stops the node job if the consumer bailed out early
      }
    }
  }
}

// ---- request entry -----------------------------------------------------------------------------

/** Capacity: ranked nodes that also have a rate card row. Empty means 503 NO_CAPACITY. */
export async function checkCapacity(
  req: GatewayRequest,
): Promise<{ ranked: Candidate[]; rates: Map<number, Rate> }> {
  if (req.lane === 'sealed') {
    // Scheduling honours SEALED_LANE_ENABLED and attestation; relaying sealed payloads is S1.
    const sealed = await gatewayDeps.rank({
      model: req.model.id,
      lane: 'sealed',
      kind: req.kind,
      minVramMb: req.model.minVramMb,
    });
    if (sealed.length === 0) throw new AppError('NO_CAPACITY', 'No attested sealed-lane node is available.');
    throw new AppError('NO_CAPACITY', 'The sealed lane is not accepting requests yet.');
  }
  const ranked = await gatewayDeps.rank({
    model: req.model.id,
    lane: req.lane,
    kind: req.kind,
    minVramMb: req.model.minVramMb,
  });
  const unit = unitKindFor(req.kind);
  const day = utcDay();
  const rates = new Map<number, Rate>();
  for (const cls of new Set(ranked.map((c) => candidateClass(c, req.lane)))) {
    const r = await buyerRate(cls, req.lane, unit, day);
    if (r) rates.set(cls, r);
  }
  let usable = ranked.filter((c) => rates.has(candidateClass(c, req.lane)));
  if (usable.length === 0)
    throw new AppError('NO_CAPACITY', 'No node is available for this model right now.');
  if (req.contextNeeded) {
    const needed = req.contextNeeded;
    const fitting = usable.filter((c) => c.contextTokens >= needed);
    if (fitting.length === 0) {
      const max = Math.max(...usable.map((c) => c.contextTokens));
      const maxTokens = req.maxTokens;
      throw contextLengthError(req.model.id, max, Math.max(0, needed - maxTokens), maxTokens);
    }
    usable = fitting;
  }
  return { ranked: usable, rates };
}

export const newJobId = (): string => randomUUID();

export async function insertJob(run: RunInit): Promise<void> {
  const { auth, req } = run;
  await dbRef.db.insert(jobs).values({
    id: run.jobId,
    buyerId: auth.buyerId,
    lane: req.lane,
    model: req.model.id,
    kind: req.kind,
    unitKind: unitKindFor(req.kind),
    payMode: auth.payMode,
    x402PaymentId: auth.x402PaymentId ?? null,
    status: 'queued',
  });
  await rememberAuth(auth);
}

// ---- settlement paths ------------------------------------------------------------------------------

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 500);

/** Any failure before or during a run: record it and release the reservation. Never throws. */
export async function failRun(jobId: string, err: unknown): Promise<void> {
  const status =
    err instanceof JobFailure && err.code === 'TIMEOUT'
      ? 'timeout'
      : err instanceof JobFailure && err.code === 'CANCELLED'
        ? 'cancelled'
        : 'failed';
  try {
    await updateJob(jobId, { status, error: errorText(err), finishedAt: new Date() }, [
      'queued',
      'dispatched',
      'running',
    ]);
  } catch (e) {
    logger.error({ err: String(e), jobId }, 'could not mark job failed');
  }
  try {
    await releaseJob(jobId);
  } catch (e) {
    logger.error({ err: String(e), jobId }, 'could not release reservation');
  }
}

/**
 * Embeddings receipts verify within a wide token band (EMBEDDINGS_TOLERANCE_SHARE), so the node's count
 * must never be billed above the gateway's exact recount: bill min(node, recount). An estimated recount
 * (no tokenizer) is not trustworthy enough to cap on, so the node count stands.
 */
export function embeddingsBilledTokens(
  nodeTokens: number,
  recount: { tokens: number; estimated: boolean } | undefined,
): number {
  if (!recount || recount.estimated) return nodeTokens;
  return Math.min(nodeTokens, recount.tokens);
}

export async function recountEmbeddings(
  run: JobRun,
): Promise<{ tokens: number; estimated: boolean } | undefined> {
  if (run.req.kind !== 'embeddings' || run.req.lane === 'sealed') return undefined;
  if (run.embeddingsRecount) return run.embeddingsRecount;
  try {
    const counts = await Promise.all(
      (run.req.inputs ?? []).map((t) => countEmbeddingInput(run.req.model.id, t)),
    );
    run.embeddingsRecount = {
      tokens: counts.reduce((a, b) => a + b.tokens, 0),
      estimated: counts.some((x) => x.estimated),
    };
  } catch (err) {
    logger.warn({ err: String(err), jobId: run.jobId }, 'embeddings recount failed; billing node count');
  }
  return run.embeddingsRecount;
}

export interface Completed {
  chargeMicros: bigint;
  promptTokens: number;
  completionTokens: number;
  images: number;
}

/** Node reported done: persist usage and the provisional charge (what the buyer sees). */
export async function completeRun(run: JobRun, done: JobDone): Promise<Completed> {
  const rate = run.rate();
  if (!rate) throw new Error('no rate for the serving node');
  // embeddings: cap the node-reported count at the gateway recount, so the provisional charge, the
  // x402 settle amount, the reservation settle and the provider earning (80% of the final charge) agree
  const u = { ...done.usage };
  if (run.req.kind === 'embeddings') {
    u.promptTokens = embeddingsBilledTokens(u.promptTokens, await recountEmbeddings(run));
  }
  const usage =
    run.req.kind === 'chat'
      ? ({ kind: 'chat', promptTokens: u.promptTokens, completionTokens: u.completionTokens } as const)
      : run.req.kind === 'embeddings'
        ? ({ kind: 'embeddings', promptTokens: u.promptTokens } as const)
        : ({ kind: 'images', images: u.images ?? 0 } as const);
  let chargeMicros = actualCharge(usage, rate);
  if (chargeMicros > run.auth.reservedMicros) {
    logger.warn(
      { jobId: run.jobId, charge: chargeMicros.toString(), reserved: run.auth.reservedMicros.toString() },
      'node-reported usage exceeds the reservation; charging the reservation',
    );
    chargeMicros = run.auth.reservedMicros;
  }
  const units =
    run.req.kind === 'images'
      ? (u.images ?? 0)
      : u.promptTokens + (run.req.kind === 'chat' ? u.completionTokens : 0);
  await updateJob(
    run.jobId,
    {
      status: 'completed',
      units: String(units),
      promptTokens: u.promptTokens,
      completionTokens: u.completionTokens,
      buyerUsdgMicros: chargeMicros,
      finishedAt: new Date(),
    },
    ['queued', 'dispatched', 'running'],
  );
  return {
    chargeMicros,
    promptTokens: u.promptTokens,
    completionTokens: u.completionTokens,
    images: u.images ?? 0,
  };
}

/**
 * The client disconnected mid-stream: bill for the tokens already produced (gateway recount, never
 * more than the reservation) and release the rest.
 */
export async function cancelRun(
  run: JobRun,
  status: 'cancelled' | 'failed' | 'timeout' = 'cancelled',
  reason = 'client disconnected',
): Promise<void> {
  try {
    const rate = run.rate();
    let charge = 0n;
    let completion = 0;
    let prompt = 0;
    if (rate && run.req.kind === 'chat' && (run.text || run.reasoning)) {
      completion = (await countTokens(run.req.model.id, run.text + run.reasoning)).tokens;
      prompt = (await countChatPrompt(run.req.model.id, run.req.messages as never)).tokens;
      charge = actualCharge({ kind: 'chat', promptTokens: prompt, completionTokens: completion }, rate);
      if (charge > run.auth.reservedMicros) charge = run.auth.reservedMicros;
    }
    await updateJob(
      run.jobId,
      {
        status,
        promptTokens: prompt,
        completionTokens: completion,
        units: String(prompt + completion),
        buyerUsdgMicros: charge,
        finishedAt: new Date(),
        error: reason,
      },
      ['queued', 'dispatched', 'running'],
    );
    if (charge > 0n) await settleJob(run.jobId, charge);
    else await releaseJob(run.jobId);
  } catch (err) {
    logger.error({ err: String(err), jobId: run.jobId }, 'cancel settlement failed; releasing');
    await releaseJob(run.jobId).catch(() => {});
  }
}

// ---- hand-off to B7 ----------------------------------------------------------------------------------

export function gatewayView(run: JobRun, done: JobDone): GatewayView {
  const view: GatewayView = { inputDigest: sha256Hex(canonicalJson(run.req.body)), recountEstimated: false };
  if (run.req.lane === 'sealed') return view; // S1: ciphertext only; no output is visible to the gateway
  const out = (done.output ?? {}) as { data?: { embedding?: number[]; b64_json?: string }[] };
  if (run.req.kind === 'chat') view.outputText = run.text;
  else if (run.req.kind === 'embeddings') view.embeddings = (out.data ?? []).map((d) => d.embedding ?? []);
  else view.images = (out.data ?? []).map((d) => new Uint8Array(Buffer.from(d.b64_json ?? '', 'base64')));
  return view;
}

/**
 * Called after the response is on the wire: recounts tokens with the model's tokenizer and hands the
 * job to B7 (`OnJobFinished`). Any failure here releases the reservation rather than leaving it held.
 */
export async function finishJob(run: JobRun, done: JobDone): Promise<void> {
  try {
    const view = gatewayView(run, done);
    if (run.req.lane !== 'sealed') {
      if (run.req.kind === 'chat') {
        const [p, c] = await Promise.all([
          countChatPrompt(run.req.model.id, run.req.messages as never),
          countTokens(run.req.model.id, run.text),
        ]);
        view.recount = { promptTokens: p.tokens, completionTokens: c.tokens };
        view.recountEstimated = p.estimated || c.estimated;
      } else if (run.req.kind === 'embeddings') {
        const rc = await recountEmbeddings(run);
        if (rc) {
          view.recount = { promptTokens: rc.tokens, completionTokens: 0 };
          view.recountEstimated = rc.estimated;
        }
      }
    }
    await finishedHandler(run.jobId, { v: 1, type: 'job.done', jobId: run.jobId, ...done }, view);
    if (run.req.kind === 'chat' || run.req.kind === 'embeddings') {
      await maybeEnqueueShadow(
        {
          jobId: run.jobId,
          nodeId: run.node?.nodeId ?? '',
          model: run.req.model.id,
          kind: run.req.kind,
          body: run.req.body,
          ...(view.outputText !== undefined ? { outputText: view.outputText } : {}),
          ...(view.embeddings ? { embeddings: view.embeddings } : {}),
        },
        run.req.lane,
        run.node?.isHouse ?? false,
      );
    }
  } catch (err) {
    logger.error({ err: String(err), jobId: run.jobId }, 'onJobFinished failed; releasing reservation');
    await releaseJob(run.jobId).catch(() => {});
  }
}

// ---- models listing ---------------------------------------------------------------------------------

export interface ModelListing {
  model: CatalogModel;
  available: boolean;
  buyerMicrosPerUnit: bigint;
  /** Largest context (tokens) served by an online node for this model. */
  contextLength: number;
  /** A sealed job for this model would find a node right now. */
  sealedAvailable: boolean;
}

/**
 * Sealed is usable only when the lane is switched on, the model supports it and a registered sealed node
 * serving the model is online. Unregistered nodes never receive jobs, so they do not count.
 */
export function sealedAvailableFor(
  model: Pick<CatalogModel, 'lanes'>,
  sealedCandidates: { registered: boolean }[],
  laneEnabled: boolean,
): boolean {
  return laneEnabled && model.lanes.includes('sealed') && sealedCandidates.some((c) => c.registered);
}

export async function listModels(): Promise<ModelListing[]> {
  const catalog = await loadCatalog();
  const day = utcDay();
  const mins = await dbRef.db
    .select({
      lane: rateCard.lane,
      unitKind: rateCard.unitKind,
      min: sql<string>`min(${rateCard.buyerUsdgMicrosPerUnit})`,
    })
    .from(rateCard)
    .where(eq(rateCard.day, day))
    .groupBy(rateCard.lane, rateCard.unitKind);
  const out: ModelListing[] = [];
  for (const model of catalog) {
    let serving = false;
    let available = false;
    let ctxAll = 0;
    let ctxRegistered = 0;
    let sealedCandidates: { registered: boolean }[] = [];
    for (const lane of model.lanes) {
      const candidates = nodeHub.candidates({
        model: model.id,
        lane,
        kind: model.kind,
        includeUnregistered: true,
      });
      if (lane === 'sealed') sealedCandidates = candidates;
      for (const c of candidates) {
        serving = true;
        ctxAll = Math.max(ctxAll, c.contextTokens);
        if (c.registered) {
          available = true;
          ctxRegistered = Math.max(ctxRegistered, c.contextTokens);
        }
      }
    }
    if (!serving) continue;
    const prices = mins
      .filter((m) => model.lanes.includes(m.lane as Lane) && m.unitKind === unitKindFor(model.kind))
      .map((m) => BigInt(m.min));
    const min = prices.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0] ?? 0n;
    out.push({
      model,
      available,
      buyerMicrosPerUnit: min,
      contextLength: ctxRegistered || ctxAll,
      sealedAvailable: sealedAvailableFor(model, sealedCandidates, config.SEALED_LANE_ENABLED),
    });
  }
  return out;
}

// ---- reaper ---------------------------------------------------------------------------------------------

export const REAPER_GRACE_MS = 60_000;

/**
 * Jobs still queued/dispatched/running well past the job timeout (process crash, lost callbacks) are
 * marked `timeout` and their reservation released. The authorization is claimed atomically, so a late
 * settle and the reaper can never both act.
 */
export async function reapStuckJobs(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - nodeSettings.jobTimeoutMs - REAPER_GRACE_MS);
  const stuck = await dbRef.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(inArray(jobs.status, ['queued', 'dispatched', 'running']), lt(jobs.createdAt, cutoff)));
  let n = 0;
  for (const { id } of stuck) {
    const rows = await dbRef.db
      .update(jobs)
      .set({ status: 'timeout', error: 'reaped: no result', finishedAt: new Date(now) })
      .where(and(eq(jobs.id, id), inArray(jobs.status, ['queued', 'dispatched', 'running'])))
      .returning({ id: jobs.id });
    if (rows.length === 0) continue;
    n++;
    await releaseJob(id).catch((err) =>
      logger.error({ err: String(err), jobId: id }, 'reaper release failed'),
    );
  }
  return n;
}

export const TERMINAL_AUTH_GRACE_MS = 5 * 60_000;

/** Every live `gw:auth:*` authorization in Redis (SCAN; the set is small). */
async function liveAuths(): Promise<Authorization[]> {
  const redis = getRedis();
  const out: Authorization[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'gw:auth:*', 'COUNT', 200);
    cursor = next;
    if (keys.length === 0) continue;
    for (const raw of await redis.mget(keys)) {
      if (!raw) continue;
      try {
        out.push(parseAuth(raw));
      } catch (err) {
        logger.warn({ err: String(err) }, 'skipping unparseable gw:auth value');
      }
    }
  } while (cursor !== '0');
  return out;
}

/**
 * Reservations that outlived their job: a job in a terminal state for more than 5 minutes whose
 * authorization is still held is settled (completed with a recorded charge: B7 never did) or released.
 */
export async function reconcileTerminalAuths(now = Date.now()): Promise<number> {
  let n = 0;
  for (const auth of await liveAuths()) {
    const [job] = await dbRef.db.select().from(jobs).where(eq(jobs.id, auth.jobId)).limit(1);
    if (!job || ['queued', 'dispatched', 'running'].includes(job.status)) continue;
    if (now - (job.finishedAt?.getTime() ?? 0) < TERMINAL_AUTH_GRACE_MS) continue;
    try {
      if (job.status === 'completed' && job.buyerUsdgMicros > 0n) {
        logger.warn({ jobId: job.id }, 'reaper settling a completed job whose charge was never settled');
        await settleJob(job.id, job.buyerUsdgMicros);
      } else {
        await releaseJob(job.id);
      }
      n++;
    } catch (err) {
      logger.error({ err: String(err), jobId: job.id }, 'terminal auth reconcile failed');
    }
  }
  return n;
}

/** Logs an error for any buyer whose `reserved` differs from the sum of their live authorizations. */
export async function checkReservationConsistency(): Promise<
  { buyerId: string; reserved: bigint; live: bigint }[]
> {
  const live = new Map<string, bigint>();
  for (const a of await liveAuths()) {
    if (a.payMode === 'balance') live.set(a.buyerId, (live.get(a.buyerId) ?? 0n) + a.reservedMicros);
  }
  const rows = await dbRef.db.select().from(buyerBalances);
  const bad: { buyerId: string; reserved: bigint; live: bigint }[] = [];
  for (const r of rows) {
    const l = live.get(r.buyerId) ?? 0n;
    if (r.reservedUsdgMicros !== l) bad.push({ buyerId: r.buyerId, reserved: r.reservedUsdgMicros, live: l });
  }
  for (const b of bad) {
    logger.error(
      { buyerId: b.buyerId, reserved: b.reserved.toString(), live: b.live.toString() },
      'reservation mismatch: buyer_balances.reserved differs from live authorizations',
    );
  }
  return bad;
}
