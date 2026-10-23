import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { createRedis, getRedis } from '../../lib/redis';
import type { JobStartMsg, JobUsage } from '../../shared/node-protocol';

export type JobStartInput = Omit<JobStartMsg, 'v' | 'type'>;

export interface Delta {
  seq: number;
  delta: { content?: string; reasoning?: string };
  sealed?: boolean;
}

export interface JobDone {
  output: unknown;
  usage: JobUsage;
  /** base64 COSE_Sign1 */
  receipt: string;
  sealed?: boolean;
}

export type JobFailCode =
  | 'MODEL_NOT_READY'
  | 'ENGINE_ERROR'
  | 'TIMEOUT'
  | 'OOM'
  | 'BUSY'
  | 'NODE_LOST'
  | 'CANCELLED';

/**
 * Rejection of `JobHandle.done`. `requeueable` is true when no chunk had been streamed and the failure
 * is not the job's own fault (BUSY / MODEL_NOT_READY / NODE_LOST), so B5 may re-route it once.
 */
export class JobFailure extends Error {
  constructor(
    public readonly code: JobFailCode,
    message: string,
    public readonly requeueable: boolean,
    public readonly chunksSent: number,
  ) {
    super(message);
    this.name = 'JobFailure';
  }
}

export interface JobHandle {
  jobId: string;
  nodeId: string;
  chunks: AsyncIterable<Delta>;
  /** Resolves on job.done; rejects with JobFailure. Safe to ignore (never an unhandled rejection). */
  done: Promise<JobDone>;
  /** Resolves true once the node sent job.accepted. */
  accepted: Promise<boolean>;
  cancel(): void;
}

/** Unbounded async queue backing `chunks`. Ends (never throws) when closed. */
export class ChunkStream implements AsyncIterable<Delta> {
  private buf: Delta[] = [];
  private waiters: ((r: IteratorResult<Delta>) => void)[] = [];
  private closed = false;

  push(d: Delta): void {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: d, done: false });
    else this.buf.push(d);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<Delta> {
    return {
      next: () => {
        const v = this.buf.shift();
        if (v) return Promise.resolve({ value: v, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
      return: () => {
        this.close();
        this.buf = [];
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

// ---- Redis bridge (worker -> api) ------------------------------------------------------------------

export const CMD_CHANNEL = 'node:cmd';
export const evtChannel = (requestId: string) => `node:evt:${requestId}`;
export const WORKER_TIMEOUT_MS = 120_000;

export type WorkerCmd =
  | { type: 'dispatch'; nodeId: string; job: JobStartInput }
  | {
      type: 'probe';
      nodeId: string;
      probe: {
        probeId: string;
        kind: 'hardware' | 'bench';
        params: { model: string; prompt: string; maxTokens: number };
      };
    }
  | { type: 'close'; nodeId: string; code?: number }
  | {
      type: 'candidates';
      filter: { model: string; lane: 'sealed' | 'open'; kind: 'chat' | 'embeddings' | 'images' };
    };

export type WorkerEvt =
  | { type: 'chunk'; chunk: Delta }
  | { type: 'done'; done: JobDone }
  | { type: 'result'; result: unknown }
  | { type: 'error'; code: string; message: string; requeueable?: boolean; chunksSent?: number };

/** Worker side: publish a command and await the final reply (120 s timeout). */
export async function requestFromWorker<T = unknown>(
  cmd: WorkerCmd,
  opts: { onChunk?: (d: Delta) => void; timeoutMs?: number } = {},
): Promise<T> {
  const requestId = randomUUID();
  const channel = evtChannel(requestId);
  const sub: Redis = createRedis();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = new Promise<T>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new AppError('UPSTREAM_UNAVAILABLE', 'The node hub did not answer in time.')),
        opts.timeoutMs ?? WORKER_TIMEOUT_MS,
      );
      sub.on('message', (ch, raw) => {
        if (ch !== channel) return;
        let evt: WorkerEvt;
        try {
          evt = JSON.parse(raw) as WorkerEvt;
        } catch {
          return;
        }
        if (evt.type === 'chunk') opts.onChunk?.(evt.chunk);
        else if (evt.type === 'done') resolve(evt.done as T);
        else if (evt.type === 'result') resolve(evt.result as T);
        else if (evt.type === 'error') {
          reject(
            new JobFailure(
              evt.code as JobFailCode,
              evt.message,
              evt.requeueable ?? false,
              evt.chunksSent ?? 0,
            ),
          );
        }
      });
    });
    result.catch(() => {});
    await sub.subscribe(channel);
    await getRedis().publish(CMD_CHANNEL, JSON.stringify({ requestId, ...cmd }));
    return await result;
  } finally {
    clearTimeout(timer);
    sub.disconnect();
  }
}

export function logBridgeError(err: unknown, what: string): void {
  logger.warn({ err: String(err) }, what);
}
