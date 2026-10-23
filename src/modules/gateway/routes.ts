import type { Context, Hono } from 'hono';
import { AppError } from '../../lib/errors';
import { type Env, openaiError } from '../../lib/http';
import { logger } from '../../lib/logger';
import {
  HEADER_CHARGE_MICROS,
  HEADER_JOB_ID,
  HEADER_LANE,
  HEADER_RECEIPT,
  MAX_TOKENS_DEFAULT,
  PostChatCompletionsReq,
  PostEmbeddingsReq,
  PostImagesGenerationsReq,
} from '../../shared/api/openai';
import type { Lane } from '../../shared/enums';
import type { Delta } from '../nodes/jobs';
import { type JobDone, JobFailure } from '../nodes/jobs';
import { getPaymentProvider, isChallenge, selectProvider } from './payment';
import { maxCharge, type Rate } from './pricing';
import {
  cancelRun,
  checkCapacity,
  completeRun,
  failRun,
  finishJob,
  type GatewayRequest,
  insertJob,
  JobRun,
  listModels,
  newJobId,
  resolveModel,
} from './service';
import { chunk, errorFrame, finalChunk, roleChunk, SSE_DONE, SSE_HEADERS, sseData } from './sse';
import { inputsUpperBound, promptUpperBound } from './tokenizer';

const receiptUrl = (jobId: string) => `/v1/receipts/${jobId}`;

async function readBody<T>(
  c: Context<Env>,
  schema: {
    safeParse(
      v: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { flatten(): unknown; issues: { message: string; path: PropertyKey[] }[] } };
  },
): Promise<T> {
  const raw = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? ` (${first.path.map(String).join('.')})` : '';
    throw new AppError('VALIDATION', `Invalid request body: ${first?.message ?? 'malformed'}${where}`, 400);
  }
  return parsed.data;
}

function laneOf(c: Context<Env>): Lane {
  const raw = c.req.header(HEADER_LANE) ?? 'open';
  if (raw !== 'open' && raw !== 'sealed')
    throw new AppError('VALIDATION', `${HEADER_LANE} must be 'open' or 'sealed'.`);
  return raw;
}

type Started = { run: JobRun } | { response: Response };

/** Steps 2-6 of the request order: model, payer identity, capacity, authorize (reserve), job row. */
async function begin(c: Context<Env>, req: GatewayRequest): Promise<Started> {
  const provider = selectProvider(c);
  const identity = await provider.identify?.(c);
  // Capacity BEFORE any reservation or payment challenge.
  const { rates } = await checkCapacity(req);
  let topRate: Rate | undefined;
  for (const r of rates.values())
    if (!topRate || r.buyerMicrosPerUnit > topRate.buyerMicrosPerUnit) topRate = r;
  if (!topRate) throw new AppError('NO_CAPACITY', 'No node is available for this model right now.');
  const maxChargeMicros = maxCharge(req.estimate, topRate);
  const jobId = newJobId();
  const authz = await provider.authorize(c, {
    jobId,
    model: req.model.id,
    kind: req.kind,
    lane: req.lane,
    maxChargeMicros,
    ...(identity ? { identity } : {}),
    priceBasis: {
      unitKind: topRate.unitKind,
      buyerMicrosPerUnit: topRate.buyerMicrosPerUnit,
      ...(req.kind === 'chat' ? { maxTokens: req.maxTokens } : {}),
    },
  });
  if (isChallenge(authz)) {
    const headers = new Headers({ 'content-type': 'application/json', ...(authz.headers ?? {}) });
    return { response: new Response(JSON.stringify(authz.body), { status: authz.status, headers }) };
  }
  const init = { jobId, req, auth: authz, rates };
  try {
    await insertJob(init);
  } catch (err) {
    await failRun(jobId, err); // releases the reservation (job row may not exist)
    throw err;
  }
  return { run: new JobRun(init) };
}

/** Provider-specific response headers (x402 X-PAYMENT-RESPONSE), empty for providers without the hook. */
function payHeaders(run: JobRun, charged: bigint): Record<string, string> {
  try {
    return getPaymentProvider(run.auth.provider)?.responseHeaders?.(run.auth, charged) ?? {};
  } catch (err) {
    logger.warn({ err: String(err) }, 'payment response headers failed');
    return {};
  }
}

function jobHeaders(jobId: string): Record<string, string> {
  return { [HEADER_JOB_ID]: jobId, [HEADER_RECEIPT]: receiptUrl(jobId) };
}

function httpError(err: unknown): unknown {
  if (err instanceof JobFailure) {
    if (err.code === 'TIMEOUT') return new AppError('UPSTREAM_UNAVAILABLE', 'The node timed out.', 504);
    if (err.code === 'BUSY' || err.code === 'MODEL_NOT_READY' || err.code === 'NODE_LOST') {
      return new AppError('NO_CAPACITY', 'No node could serve this request. Please retry.');
    }
    return new AppError('UPSTREAM_UNAVAILABLE', 'The node failed to complete the request.');
  }
  return err;
}

/** Drains a run to its final `JobDone`. */
async function drain(run: JobRun): Promise<JobDone> {
  const gen = run.deltas();
  for (;;) {
    const step = await gen.next();
    if (step.done) return step.value;
  }
}

function outputOf(done: JobDone): { content: string; reasoning: string; finish?: string } {
  const choice = (
    done.output as { choices?: { message?: Record<string, unknown>; finish_reason?: string }[] } | undefined
  )?.choices?.[0];
  const m = choice?.message ?? {};
  return {
    content: typeof m.content === 'string' ? m.content : '',
    reasoning: String(m.reasoning ?? m.reasoning_content ?? ''),
    ...(choice?.finish_reason ? { finish: choice.finish_reason } : {}),
  };
}

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 500);

// ---- request builders ----------------------------------------------------------------------------------

async function buildChat(c: Context<Env>): Promise<GatewayRequest> {
  const body = await readBody(c, PostChatCompletionsReq);
  const lane = laneOf(c);
  const model = await resolveModel(body.model, 'chat', lane);
  const maxTokens = body.max_tokens ?? MAX_TOKENS_DEFAULT;
  const promptBound = promptUpperBound(model.id, body.messages);
  const node: Record<string, unknown> = {
    model: model.id,
    messages: body.messages,
    stream: true,
    max_tokens: maxTokens,
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
    ...(body.stop !== undefined ? { stop: body.stop } : {}),
    ...(body.seed !== undefined ? { seed: body.seed } : {}),
  };
  return {
    kind: 'chat',
    model,
    lane,
    body: node,
    stream: body.stream === true,
    maxTokens,
    estimate: { kind: 'chat', promptTokens: promptBound, maxTokens },
    messages: body.messages,
  };
}

async function buildEmbeddings(c: Context<Env>): Promise<GatewayRequest> {
  const body = await readBody(c, PostEmbeddingsReq);
  const lane = laneOf(c);
  const model = await resolveModel(body.model, 'embeddings', lane);
  const inputs = Array.isArray(body.input) ? body.input : [body.input];
  const tokens = inputsUpperBound(model.id, inputs);
  return {
    kind: 'embeddings',
    model,
    lane,
    body: { model: model.id, input: body.input },
    stream: false,
    maxTokens: 0,
    estimate: { kind: 'embeddings', inputTokens: tokens },
    inputs,
  };
}

async function buildImages(c: Context<Env>): Promise<GatewayRequest> {
  const body = await readBody(c, PostImagesGenerationsReq);
  const lane = laneOf(c);
  const model = await resolveModel(body.model, 'images', lane);
  const n = body.n ?? 1;
  return {
    kind: 'images',
    model,
    lane,
    body: { model: model.id, prompt: body.prompt, n, ...(body.size ? { size: body.size } : {}) },
    stream: false,
    maxTokens: 0,
    estimate: { kind: 'images', n },
  };
}

// ---- responders ---------------------------------------------------------------------------------------

async function respondChatStream(c: Context<Env>, run: JobRun): Promise<Response> {
  const gen = run.deltas();
  let first: IteratorResult<Delta, JobDone>;
  const signal = c.req.raw.signal;
  const onAbort = () => run.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    first = await gen.next(); // before the first byte: errors are plain HTTP errors
  } catch (err) {
    if (run.aborted) {
      await cancelRun(run);
      return new Response(null, { status: 499 });
    }
    await failRun(run.jobId, err);
    throw httpError(err);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  const base = {
    id: `chatcmpl-${run.jobId}`,
    created: Math.floor(Date.now() / 1000),
    model: run.req.model.id,
  };
  const enc = new TextEncoder();
  let open = true;
  const body = new ReadableStream<Uint8Array>({
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
          send(sseData(roleChunk(base)));
          let step = first;
          while (!step.done) {
            send(sseData(chunk(base, step.value.delta)));
            step = await gen.next();
          }
          const done = step.value;
          const out = outputOf(done);
          if (out.content.length > run.text.length && out.content.startsWith(run.text)) {
            const rest = out.content.slice(run.text.length);
            run.text = out.content;
            send(sseData(chunk(base, { content: rest })));
          }
          const completed = await completeRun(run, done);
          const finish = out.finish ?? (completed.completionTokens >= run.req.maxTokens ? 'length' : 'stop');
          send(
            sseData(
              finalChunk(
                base,
                finish,
                {
                  prompt_tokens: completed.promptTokens,
                  completion_tokens: completed.completionTokens,
                  total_tokens: completed.promptTokens + completed.completionTokens,
                },
                {
                  jobId: run.jobId,
                  chargeMicros: completed.chargeMicros.toString(),
                  receiptUrl: receiptUrl(run.jobId),
                  ...(payHeaders(run, completed.chargeMicros)['X-PAYMENT-RESPONSE']
                    ? { paymentResponse: payHeaders(run, completed.chargeMicros)['X-PAYMENT-RESPONSE'] }
                    : {}),
                },
              ),
            ),
          );
          send(SSE_DONE);
          end();
          void finishJob(run, done);
        } catch (err) {
          if (run.aborted) {
            await cancelRun(run);
          } else {
            if (run.text || run.reasoning) await cancelRun(run, 'failed', errorMessage(err));
            else await failRun(run.jobId, err);
            const e = httpError(err);
            const code = e instanceof AppError ? e.code : 'INTERNAL';
            send(errorFrame(e instanceof AppError ? e.message : 'Internal server error', code));
            send(SSE_DONE);
          }
          end();
        }
      })();
    },
    cancel() {
      open = false;
      run.abort(); // pump sees CANCELLED and settles the partial charge
    },
  });
  return new Response(body, { status: 200, headers: { ...SSE_HEADERS, ...jobHeaders(run.jobId) } });
}

async function respondChatJson(c: Context<Env>, run: JobRun): Promise<Response> {
  let done: JobDone;
  const onAbort = () => run.abort();
  c.req.raw.signal.addEventListener('abort', onAbort, { once: true });
  try {
    done = await drain(run);
  } catch (err) {
    if (run.aborted) {
      await cancelRun(run);
      return new Response(null, { status: 499 });
    }
    await failRun(run.jobId, err);
    throw httpError(err);
  } finally {
    c.req.raw.signal.removeEventListener('abort', onAbort);
  }
  const out = outputOf(done);
  if (out.content) run.text = out.content;
  const completed = await completeRun(run, done);
  void finishJob(run, done);
  c.header(HEADER_CHARGE_MICROS, completed.chargeMicros.toString());
  for (const [k, v] of Object.entries(jobHeaders(run.jobId))) c.header(k, v);
  for (const [k, v] of Object.entries(payHeaders(run, completed.chargeMicros))) c.header(k, v);
  return c.json({
    id: `chatcmpl-${run.jobId}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: run.req.model.id,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: run.text,
          ...(out.reasoning || run.reasoning ? { reasoning: out.reasoning || run.reasoning } : {}),
        },
        finish_reason: out.finish ?? (completed.completionTokens >= run.req.maxTokens ? 'length' : 'stop'),
      },
    ],
    usage: {
      prompt_tokens: completed.promptTokens,
      completion_tokens: completed.completionTokens,
      total_tokens: completed.promptTokens + completed.completionTokens,
    },
    spindle: {
      jobId: run.jobId,
      chargeMicros: completed.chargeMicros.toString(),
      receiptUrl: receiptUrl(run.jobId),
    },
  });
}

async function respondUnary(c: Context<Env>, run: JobRun): Promise<Response> {
  let done: JobDone;
  const onAbort = () => run.abort();
  c.req.raw.signal.addEventListener('abort', onAbort, { once: true });
  try {
    done = await drain(run);
  } catch (err) {
    if (run.aborted) {
      await cancelRun(run);
      return new Response(null, { status: 499 });
    }
    await failRun(run.jobId, err);
    throw httpError(err);
  } finally {
    c.req.raw.signal.removeEventListener('abort', onAbort);
  }
  const completed = await completeRun(run, done);
  void finishJob(run, done);
  c.header(HEADER_CHARGE_MICROS, completed.chargeMicros.toString());
  for (const [k, v] of Object.entries(jobHeaders(run.jobId))) c.header(k, v);
  for (const [k, v] of Object.entries(payHeaders(run, completed.chargeMicros))) c.header(k, v);
  const spindle = {
    jobId: run.jobId,
    chargeMicros: completed.chargeMicros.toString(),
    receiptUrl: receiptUrl(run.jobId),
  };
  const out = (done.output ?? {}) as { data?: unknown[]; created?: number };
  if (run.req.kind === 'embeddings') {
    return c.json({
      object: 'list',
      data: out.data ?? [],
      model: run.req.model.id,
      usage: { prompt_tokens: completed.promptTokens, total_tokens: completed.promptTokens },
      spindle,
    });
  }
  return c.json({ created: out.created ?? Math.floor(Date.now() / 1000), data: out.data ?? [], spindle });
}

// ---- routes ---------------------------------------------------------------------------------------------

export default function gatewayRoutes(app: Hono<Env>): void {
  const guarded =
    (
      build: (c: Context<Env>) => Promise<GatewayRequest>,
      respond: (c: Context<Env>, run: JobRun) => Promise<Response>,
    ) =>
    async (c: Context<Env>) => {
      try {
        const req = await build(c);
        const started = await begin(c, req);
        if ('response' in started) return started.response;
        const run = started.run;
        try {
          return await respond(c, run);
        } catch (err) {
          // Anything that escaped the responders: never leave the reservation held.
          await failRun(run.jobId, err);
          throw err;
        }
      } catch (err) {
        if (!(err instanceof AppError) && !(err instanceof JobFailure)) {
          logger.error({ err: String(err) }, 'gateway request failed');
        }
        return openaiError(c, err);
      }
    };

  app.get('/v1/models', async (c) => {
    try {
      const rows = await listModels();
      return c.json({
        object: 'list',
        data: rows.map(({ model, available, buyerMicrosPerUnit }) => ({
          id: model.id,
          object: 'model',
          owned_by: 'spindle',
          lanes: model.lanes,
          kind: model.kind,
          available,
          pricing: { unitKind: model.unitKind, buyerMicrosPerUnit: buyerMicrosPerUnit.toString() },
        })),
      });
    } catch (err) {
      return openaiError(c, err);
    }
  });

  app.post(
    '/v1/chat/completions',
    guarded(buildChat, async (c, run) =>
      run.req.stream ? respondChatStream(c, run) : respondChatJson(c, run),
    ),
  );
  app.post('/v1/embeddings', guarded(buildEmbeddings, respondUnary));
  app.post('/v1/images/generations', guarded(buildImages, respondUnary));
}
