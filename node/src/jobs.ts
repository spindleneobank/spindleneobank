import type { JobErrorMsg, JobStartMsg } from '@spindle/shared/node-protocol';
import { receiptToBase64, signReceipt } from '@spindle/shared/receipt';
import { type Engine, EngineError } from './engine';
import type { NodeKey } from './key';
import type { Logger } from './log';
import { buildReceiptPayload, type JobOutput, type ReceiptUsage } from './receipts';
import type { SendFn } from './send';

export interface JobRunnerOptions {
  engine: Engine;
  key: NodeKey;
  send: SendFn;
  log: Logger;
  agentVersion: string;
  lazy?: boolean;
  batchMs?: number;
  now?: () => number;
}

type ErrCode = JobErrorMsg['code'];

class JobFail extends Error {
  constructor(
    readonly code: ErrCode,
    message: string,
  ) {
    super(message);
  }
}

interface Active {
  jobId: string;
  abort: AbortController;
  reason: 'cancel' | 'timeout' | 'shutdown' | null;
  done: Promise<void>;
}

export function mapEngineError(e: unknown): JobFail {
  if (e instanceof JobFail) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (/out of memory|\boom\b|cuda error: out of memory/i.test(msg)) return new JobFail('OOM', msg);
  if (e instanceof EngineError && e.status === 404) return new JobFail('MODEL_NOT_READY', msg);
  if (/model .*not found/i.test(msg)) return new JobFail('MODEL_NOT_READY', msg);
  return new JobFail('ENGINE_ERROR', msg);
}

export class JobRunner {
  private current: Active | null = null;

  constructor(private readonly o: JobRunnerOptions) {}

  get busy(): boolean {
    return this.current !== null;
  }

  /** Resolves when the in-flight job (if any) has finished. */
  async idle(): Promise<void> {
    await this.current?.done;
  }

  cancel(jobId: string): void {
    if (this.current?.jobId === jobId) this.abort('cancel');
  }

  abortCurrent(): void {
    this.abort('shutdown');
  }

  private abort(reason: Active['reason']): void {
    if (!this.current || this.current.reason) return;
    this.current.reason = reason;
    this.current.abort.abort();
  }

  /** Handles job.start. Returns a promise that settles when the job is finished (tests await it). */
  start(job: JobStartMsg): Promise<void> {
    const { send } = this.o;
    if (this.current) {
      send({
        v: 1,
        type: 'job.error',
        jobId: job.jobId,
        code: 'BUSY',
        message: 'node is at capacity (1 concurrent job)',
      });
      return Promise.resolve();
    }
    const active: Active = {
      jobId: job.jobId,
      abort: new AbortController(),
      reason: null,
      done: Promise.resolve(),
    };
    this.current = active;
    active.done = this.run(job, active).finally(() => {
      if (this.current === active) this.current = null;
    });
    return active.done;
  }

  private async run(job: JobStartMsg, active: Active): Promise<void> {
    const { send, log } = this.o;
    const now = this.o.now ?? Date.now;
    const startedAt = now();
    const timeoutMs = job.deadlineMs > 1e12 ? Math.max(1, job.deadlineMs - startedAt) : job.deadlineMs;
    const timer = setTimeout(() => this.abort('timeout'), timeoutMs);
    try {
      if (job.sealed) throw new JobFail('ENGINE_ERROR', 'sealed lane not supported by this agent build');
      send({ v: 1, type: 'job.accepted', jobId: job.jobId });
      let result: { output: JobOutput; response: unknown; usage: ReceiptUsage; digest: string };
      if (job.kind === 'chat') result = await this.chat(job, active);
      else if (job.kind === 'embeddings') result = await this.embeddings(job, active);
      else result = await this.images(job, active);
      if (active.reason) throw new Error('aborted');
      const finishedAt = now();
      const payload = buildReceiptPayload(
        job,
        result.output,
        result.usage,
        { startedAt, finishedAt },
        this.o.key,
        { modelDigest: result.digest, agentVersion: this.o.agentVersion },
      );
      const receipt = receiptToBase64(signReceipt(payload, this.o.key.privateKey));
      send({
        v: 1,
        type: 'job.done',
        jobId: job.jobId,
        output: result.response,
        usage: result.usage,
        receipt,
      });
    } catch (e) {
      if (active.reason === 'cancel' || active.reason === 'shutdown') {
        log.info(`job ${job.jobId} aborted (${active.reason})`);
        return;
      }
      const f =
        active.reason === 'timeout' ? new JobFail('TIMEOUT', 'job exceeded its deadline') : mapEngineError(e);
      log.warn(`job ${job.jobId} failed: ${f.code} ${f.message}`);
      send({ v: 1, type: 'job.error', jobId: job.jobId, code: f.code, message: f.message });
    } finally {
      clearTimeout(timer);
    }
  }

  private async modelDigest(job: JobStartMsg): Promise<string> {
    let models: Awaited<ReturnType<Engine['listModels']>> = [];
    try {
      models = await this.o.engine.listModels();
    } catch (e) {
      if (!this.o.lazy) throw e;
    }
    const m = models.find((x) => x.id === job.engineModel || x.id === `${job.engineModel}:latest`);
    if (!m) {
      if (this.o.lazy) return 'lazy';
      throw new JobFail('MODEL_NOT_READY', `model ${job.engineModel} is not available on this node`);
    }
    return m.digest;
  }

  private async chat(job: JobStartMsg, active: Active) {
    const { send, engine } = this.o;
    const digest = await this.modelDigest(job);
    let content = '';
    let reasoning = '';
    let usage: { promptTokens: number; completionTokens: number } | undefined;
    let finish = 'stop';
    let chunks = 0;
    let seq = 0;
    let pending: { content?: string; reasoning?: string } = {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastFlush = 0;
    const batchMs = this.o.batchMs ?? 25;

    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (pending.content === undefined && pending.reasoning === undefined) return;
      send({ v: 1, type: 'job.chunk', jobId: job.jobId, seq: seq++, delta: pending });
      lastFlush = performance.now();
      pending = {};
    };
    const push = (d: { content?: string; reasoning?: string }) => {
      if (d.content) pending.content = (pending.content ?? '') + d.content;
      if (d.reasoning) pending.reasoning = (pending.reasoning ?? '') + d.reasoning;
      if (!timer) timer = setTimeout(flush, Math.max(0, batchMs - (performance.now() - lastFlush)));
    };

    try {
      if (this.o.lazy) {
        push({ content: 'ok' });
        content = 'ok';
        usage = { promptTokens: 0, completionTokens: 1 };
      } else {
        const req: Record<string, unknown> = { ...job.request, model: job.engineModel, stream: true };
        if (job.maxTokens > 0) {
          const asked = Number(req.max_tokens ?? req.max_completion_tokens);
          req.max_tokens =
            Number.isFinite(asked) && asked > 0 ? Math.min(asked, job.maxTokens) : job.maxTokens;
          delete req.max_completion_tokens;
        }
        for await (const d of engine.chatStream(req, active.abort.signal)) {
          if (active.abort.signal.aborted) break;
          if (d.content) {
            content += d.content;
            chunks++;
          }
          if (d.reasoning) {
            reasoning += d.reasoning;
            chunks++;
          }
          if (d.usage) usage = d.usage;
          if (d.finishReason) finish = d.finishReason;
          push(d);
        }
      }
    } finally {
      if (active.reason) {
        if (timer) clearTimeout(timer);
        timer = null;
      } else flush();
    }
    if (!usage) {
      this.o.log.warn(`job ${job.jobId}: engine returned no usage; counting stream chunks`);
      usage = { promptTokens: 0, completionTokens: chunks };
    }
    const message: Record<string, unknown> = { role: 'assistant', content };
    if (reasoning) message.reasoning_content = reasoning;
    const response = {
      id: `chatcmpl-${job.jobId}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: job.model,
      choices: [{ index: 0, message, finish_reason: finish }],
      usage: {
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens: usage.promptTokens + usage.completionTokens,
      },
    };
    return { output: content as JobOutput, response, usage, digest };
  }

  private async embeddings(job: JobStartMsg, active: Active) {
    const digest = await this.modelDigest(job);
    let vectors: number[][];
    let response: Record<string, unknown>;
    let promptTokens = 0;
    if (this.o.lazy) {
      const input = job.request.input;
      const n = Array.isArray(input) ? input.length : 1;
      vectors = Array.from({ length: n }, () => new Array<number>(8).fill(0));
      response = {
        object: 'list',
        model: job.model,
        data: vectors.map((embedding, index) => ({ object: 'embedding', index, embedding })),
        usage: { prompt_tokens: 0, total_tokens: 0 },
      };
    } else {
      const req: Record<string, unknown> = { ...job.request, model: job.engineModel };
      delete req.encoding_format;
      response = await this.o.engine.embeddings(req, active.abort.signal);
      const data = (response.data as { index?: number; embedding: number[] }[] | undefined) ?? [];
      if (!data.length) throw new JobFail('ENGINE_ERROR', 'engine returned no embeddings');
      vectors = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
      if (vectors.some((v) => !Array.isArray(v)))
        throw new JobFail('ENGINE_ERROR', 'engine returned non-float embeddings');
      promptTokens = (response.usage as { prompt_tokens?: number } | undefined)?.prompt_tokens ?? 0;
      response = { ...response, model: job.model };
    }
    return { output: vectors as JobOutput, response, usage: { promptTokens, completionTokens: 0 }, digest };
  }

  private async images(job: JobStartMsg, active: Active) {
    const { engine } = this.o;
    if (!engine.images) throw new JobFail('ENGINE_ERROR', `engine ${engine.kind} does not support images`);
    const digest = await this.modelDigest(job);
    const r = await engine.images({ ...job.request, model: job.engineModel }, active.abort.signal);
    const response = {
      created: Math.floor(Date.now() / 1000),
      data: r.data.map((b) => ({ b64_json: Buffer.from(b).toString('base64') })),
    };
    return {
      output: r.data as JobOutput,
      response,
      usage: { promptTokens: 0, completionTokens: 0, images: r.data.length },
      digest,
    };
  }
}
