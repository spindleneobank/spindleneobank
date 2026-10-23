/**
 * Sealed lane relay (S1). Everything here is behind SEALED_LANE_ENABLED (default false).
 *
 * The gateway handles `X-Spindle-Lane: sealed` requests whose body is
 *   { model, stream?, sealed: { nodeKey, enc, ciphertext, ephemeralPub? } }
 * and relays `enc` + `ciphertext` to the attested node the buyer chose. It cannot decrypt anything: the
 * request is HPKE-sealed to the node's attested key, the response frames are HPKE-sealed to the buyer's
 * ephemeral key. The request/response bodies are never parsed, logged or stored here (only their lengths
 * are ever visible to the logger, and not even that is logged).
 * Billing: per GPU-hour from the attested receipt (see `sealedCharge`, used by receipts/service.ts).
 */
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { config } from '../../config';
import { AppError } from '../../lib/errors';
import { type Env, openaiError } from '../../lib/http';
import { logger } from '../../lib/logger';
import { HEADER_CHARGE_MICROS, HEADER_JOB_ID, HEADER_LANE, HEADER_RECEIPT } from '../../shared/api/openai';
import { latestAttestation } from '../attest/verify';
import { type Delta, type JobDone, JobFailure } from '../nodes/jobs';
import { nodeSettings } from '../nodes/service';
import { isChallenge, selectProvider } from './payment';
import { buyerRate, mulDivCeil, type Rate } from './pricing';
import {
  failRun,
  finishJob,
  gatewayDeps,
  insertJob,
  JobRun,
  newJobId,
  resolveModel,
  updateJob,
} from './service';
import { errorFrame, SSE_DONE, SSE_HEADERS, sseData } from './sse';

/** Test seam. */
export const sealedDeps = { enabled: (): boolean => config.SEALED_LANE_ENABLED };

export const MS_PER_HOUR = 3_600_000n;

/** Charge for `elapsedMs` of GPU time at `rate` micros per GPU-hour, rounded up. */
export const gpuHourMicros = (microsPerHour: bigint, elapsedMs: number): bigint =>
  mulDivCeil(microsPerHour, BigInt(Math.max(0, Math.ceil(elapsedMs))), MS_PER_HOUR);

/**
 * Elapsed GPU time to bill, from the attested receipt (`startedAt`/`finishedAt`). A node cannot bill more
 * than the gateway itself observed between dispatch and completion (plus a small slack).
 */
export function billableMs(
  receipt: { startedAt: number; finishedAt: number },
  observed?: { dispatchedAt?: Date | null; finishedAt?: Date | null },
  slackMs = 2000,
): number {
  const claimed = Math.max(0, receipt.finishedAt - receipt.startedAt);
  if (observed?.dispatchedAt && observed.finishedAt) {
    return Math.min(
      claimed,
      Math.max(0, observed.finishedAt.getTime() - observed.dispatchedAt.getTime()) + slackMs,
    );
  }
  return claimed;
}

export const SealedChatBody = z.object({
  model: z.string().min(1),
  stream: z.boolean().optional(),
  sealed: z.object({
    nodeKey: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    enc: z.string().min(1).max(512),
    ciphertext: z.string().min(1).max(4_000_000),
    ephemeralPub: z.string().optional(),
  }),
});
export type SealedChatBody = z.infer<typeof SealedChatBody>;

const receiptUrl = (jobId: string) => `/v1/receipts/${jobId}`;

/** Job run towards one specific attested node (the ciphertext is only openable by that node's key). */
class SealedRun extends JobRun {
  constructor(
    init: ConstructorParameters<typeof JobRun>[0],
    private readonly target: string,
    private readonly envelope: { enc: string; ciphertext: string },
  ) {
    super(init);
  }

  /** Streams sealed frames and returns the final JobDone. No re-routing: the target node is fixed. */
  override async *deltas(): AsyncGenerator<Delta, JobDone, void> {
    if (this.aborted) throw new JobFailure('CANCELLED', 'Job cancelled.', false, 0);
    const ranked = await gatewayDeps.rank({
      model: this.req.model.id,
      lane: 'sealed',
      kind: 'chat',
      minVramMb: this.req.model.minVramMb,
    });
    const node = ranked.find((c) => c.nodeKey.toLowerCase() === this.target && this.rates.has(c.gpuClass));
    if (!node) throw new AppError('NO_CAPACITY', 'The selected sealed node is not available.');
    // Freshness is enforced at dispatch time too, not only when the attestation was verified.
    if (!(await latestAttestation(node.nodeId))) {
      throw new AppError('NO_CAPACITY', 'The selected sealed node has no fresh attestation.');
    }
    const engineModel = this.req.model.engineIds.vllm;
    if (!engineModel) throw new AppError('NO_CAPACITY', 'No sealed node can serve this model.');
    const handle = gatewayDeps.dispatch(node.nodeId, {
      jobId: this.jobId,
      kind: 'chat',
      model: this.req.model.id,
      engineModel,
      lane: 'sealed',
      request: {},
      maxTokens: 0,
      deadlineMs: Date.now() + nodeSettings.jobTimeoutMs,
      sealed: this.envelope,
    });
    this.node = node;
    this.handle = handle;
    if (this.aborted) handle.cancel();
    await updateJob(this.jobId, { nodeId: node.nodeId, status: 'dispatched', dispatchedAt: new Date() }, [
      'queued',
      'dispatched',
    ]).catch(() => {});
    void handle.accepted.then((ok) => {
      if (ok) void updateJob(this.jobId, { status: 'running' }, ['queued', 'dispatched']).catch(() => {});
    });
    try {
      for await (const d of handle.chunks) yield d;
      return await handle.done;
    } finally {
      handle.cancel();
    }
  }
}

function httpError(err: unknown): unknown {
  if (err instanceof JobFailure) {
    if (err.code === 'TIMEOUT') return new AppError('UPSTREAM_UNAVAILABLE', 'The node timed out.', 504);
    if (err.code === 'BUSY' || err.code === 'MODEL_NOT_READY' || err.code === 'NODE_LOST')
      return new AppError('NO_CAPACITY', 'The selected node could not serve this request. Please retry.');
    return new AppError('UPSTREAM_UNAVAILABLE', 'The node failed to complete the request.');
  }
  return err;
}

/** Provisional charge (what the response reports); B7 re-derives and settles from the verified receipt. */
function provisionalCharge(run: SealedRun, done: JobDone, rate: Rate, startedAt: Date): bigint {
  void done;
  let c = gpuHourMicros(rate.buyerMicrosPerUnit, Date.now() - startedAt.getTime());
  if (c > run.auth.reservedMicros) c = run.auth.reservedMicros;
  return c;
}

async function handleSealedChat(c: Context<Env>): Promise<Response> {
  const raw = await c.req.json().catch(() => null);
  const parsed = SealedChatBody.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AppError('VALIDATION', `Invalid sealed request: ${first?.message ?? 'malformed'}`, 400);
  }
  const body = parsed.data;
  const target = body.sealed.nodeKey.toLowerCase();
  const model = await resolveModel(body.model, 'chat', 'sealed');

  const ranked = (
    await gatewayDeps.rank({ model: model.id, lane: 'sealed', kind: 'chat', minVramMb: model.minVramMb })
  ).filter((n) => n.nodeKey.toLowerCase() === target);
  const node = ranked[0];
  if (!node) throw new AppError('NO_CAPACITY', 'The selected sealed node is not available.');
  if (!(await latestAttestation(node.nodeId)))
    throw new AppError('NO_CAPACITY', 'The selected sealed node has no fresh attestation.');
  const rate = await buyerRate(node.gpuClass, 'sealed', 'gpu_hour');
  if (!rate) throw new AppError('NO_CAPACITY', 'No sealed-lane rate is configured for this GPU class.');

  const provider = selectProvider(c);
  const identity = await provider.identify?.(c);
  const jobId = newJobId();
  // reserve for the longest the job may run
  const maxChargeMicros = gpuHourMicros(rate.buyerMicrosPerUnit, nodeSettings.jobTimeoutMs);
  const authz = await provider.authorize(c, {
    jobId,
    model: model.id,
    kind: 'chat',
    lane: 'sealed',
    maxChargeMicros,
    ...(identity ? { identity } : {}),
    priceBasis: { unitKind: 'gpu_hour', buyerMicrosPerUnit: rate.buyerMicrosPerUnit },
  });
  if (isChallenge(authz)) {
    const headers = new Headers({ 'content-type': 'application/json', ...(authz.headers ?? {}) });
    return new Response(JSON.stringify(authz.body), { status: authz.status, headers });
  }
  // The input digest covers exactly what the gateway relays: the sealed envelope.
  const req = {
    kind: 'chat' as const,
    model,
    lane: 'sealed' as const,
    body: { enc: body.sealed.enc, ciphertext: body.sealed.ciphertext } as Record<string, unknown>,
    stream: body.stream === true,
    maxTokens: 0,
    estimate: { kind: 'chat' as const, promptTokens: 0, maxTokens: 0 },
  };
  const init = { jobId, req, auth: authz, rates: new Map([[node.gpuClass, rate]]) };
  try {
    await insertJob(init);
    await updateJob(jobId, { unitKind: 'gpu_hour' });
  } catch (err) {
    await failRun(jobId, err);
    throw err;
  }
  const run = new SealedRun(init, target, { enc: body.sealed.enc, ciphertext: body.sealed.ciphertext });
  try {
    return body.stream === true ? await respondStream(c, run) : await respondJson(c, run);
  } catch (err) {
    await failRun(run.jobId, err);
    throw err;
  }
}

const headersFor = (jobId: string) => ({ [HEADER_JOB_ID]: jobId, [HEADER_RECEIPT]: receiptUrl(jobId) });

async function complete(run: SealedRun, done: JobDone, startedAt: Date): Promise<bigint> {
  const rate = run.rate() as Rate;
  const charge = provisionalCharge(run, done, rate, startedAt);
  await updateJob(run.jobId, { status: 'completed', buyerUsdgMicros: charge, finishedAt: new Date() }, [
    'queued',
    'dispatched',
    'running',
  ]);
  void finishJob(run, done);
  return charge;
}

async function respondJson(c: Context<Env>, run: SealedRun): Promise<Response> {
  const frames: string[] = [];
  const started = new Date();
  const onAbort = () => run.abort();
  c.req.raw.signal.addEventListener('abort', onAbort, { once: true });
  let done: JobDone;
  try {
    const gen = run.deltas();
    for (;;) {
      const step = await gen.next();
      if (step.done) {
        done = step.value;
        break;
      }
      if (step.value.delta.content) frames.push(step.value.delta.content);
    }
  } catch (err) {
    await failRun(run.jobId, err);
    throw httpError(err);
  } finally {
    c.req.raw.signal.removeEventListener('abort', onAbort);
  }
  const charge = await complete(run, done, started);
  for (const [k, v] of Object.entries(headersFor(run.jobId))) c.header(k, v);
  c.header(HEADER_CHARGE_MICROS, charge.toString());
  const out = (done.output ?? {}) as { sealed?: string };
  return c.json({
    id: `sealed-${run.jobId}`,
    sealed: { frames, output: out.sealed ?? null },
    spindle: { jobId: run.jobId, chargeMicros: charge.toString(), receiptUrl: receiptUrl(run.jobId) },
  });
}

async function respondStream(c: Context<Env>, run: SealedRun): Promise<Response> {
  const gen = run.deltas();
  const started = new Date();
  const onAbort = () => run.abort();
  c.req.raw.signal.addEventListener('abort', onAbort, { once: true });
  let first: IteratorResult<Delta, JobDone>;
  try {
    first = await gen.next(); // before the first byte: plain HTTP errors
  } catch (err) {
    await failRun(run.jobId, err);
    throw httpError(err);
  } finally {
    c.req.raw.signal.removeEventListener('abort', onAbort);
  }
  const enc = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const send = (s: string) => {
        if (!open) return;
        try {
          ctrl.enqueue(enc.encode(s));
        } catch {
          open = false;
        }
      };
      const end = () => {
        if (!open) return;
        open = false;
        try {
          ctrl.close();
        } catch {
          // already closed
        }
      };
      void (async () => {
        try {
          let step = first;
          while (!step.done) {
            if (step.value.delta.content) send(sseData({ sealed: step.value.delta.content }));
            step = await gen.next();
          }
          const done = step.value;
          const charge = await complete(run, done, started);
          const out = (done.output ?? {}) as { sealed?: string };
          send(
            sseData({
              sealed: out.sealed ?? null,
              final: true,
              spindle: {
                jobId: run.jobId,
                chargeMicros: charge.toString(),
                receiptUrl: receiptUrl(run.jobId),
              },
            }),
          );
          send(SSE_DONE);
          end();
        } catch (err) {
          await failRun(run.jobId, err).catch(() => {});
          const e = httpError(err);
          send(
            errorFrame(
              e instanceof AppError ? e.message : 'Internal server error',
              e instanceof AppError ? e.code : 'INTERNAL',
            ),
          );
          send(SSE_DONE);
          end();
        }
      })();
    },
    cancel() {
      open = false;
      run.abort();
    },
  });
  return new Response(stream, { status: 200, headers: { ...SSE_HEADERS, ...headersFor(run.jobId) } });
}

/** `GET /v1/sealed/keys?model=`: attested nodes a buyer can seal to. */
export async function listSealedKeys(modelId: string) {
  const model = await resolveModel(modelId, 'chat', 'sealed');
  const ranked = await gatewayDeps.rank({
    model: model.id,
    lane: 'sealed',
    kind: 'chat',
    minVramMb: model.minVramMb,
  });
  const out = [];
  for (const cand of ranked) {
    const att = await latestAttestation(cand.nodeId);
    if (!att) continue;
    out.push({
      nodeId: cand.nodeId,
      nodeKey: att.nodeKey,
      hpkePublicKey: att.hpkePublicKey,
      attestationRef: att.attestationId,
      attestationSummary: att.summary,
      expiresAt: att.expiresAt.toISOString(),
    });
  }
  return out;
}

/**
 * Registers the sealed routes. Must run BEFORE the gateway routes so that the sealed chat requests are
 * intercepted; with the flag off nothing is registered besides a pass-through (and /v1/sealed/keys is 404).
 */
export default function sealedRoutes(app: Hono<Env>): void {
  app.get('/v1/sealed/keys', async (c) => {
    try {
      if (!sealedDeps.enabled()) throw new AppError('NOT_FOUND', 'Not found.');
      const model = c.req.query('model');
      if (!model) throw new AppError('VALIDATION', 'The model query parameter is required.', 400);
      return c.json(await listSealedKeys(model));
    } catch (err) {
      return openaiError(c, err);
    }
  });
  app.post('/v1/chat/completions', async (c, next) => {
    if (!sealedDeps.enabled() || c.req.header(HEADER_LANE) !== 'sealed') return next();
    try {
      return await handleSealedChat(c);
    } catch (err) {
      if (!(err instanceof AppError) && !(err instanceof JobFailure)) {
        logger.error({ err: String(err) }, 'sealed gateway request failed'); // never includes request data
      }
      return openaiError(c, err);
    }
  });
}
