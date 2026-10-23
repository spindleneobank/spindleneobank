import type { JobsOptions } from 'bullmq';
import { AppError } from '../../lib/errors';
import { enqueue, type QueueName } from '../../lib/queue';
import { adminJobs as epochAdminJobs } from '../epochs/jobs';
import { applyClosedFloor } from '../floor/service';

export type JobEntry =
  /** Enqueued onto a BullMQ queue under the worker's processor name. */
  | { mode: 'queue'; queue: QueueName; processor: string; description: string }
  /** Runs in the API process (needs no worker-only state). */
  | { mode: 'inline'; run: () => Promise<unknown>; description: string };

/**
 * Central registry of admin-runnable jobs (`POST /v1/admin/jobs/:name/run`). Names are the public API; queue
 * entries must match the `ctx.process(queue, processor)` registration of the owning module.
 */
export const JOB_REGISTRY: Record<string, JobEntry> = {
  'epoch-build': {
    mode: 'inline',
    run: epochAdminJobs['epoch-build'],
    description: 'Build the next epoch tree now',
  },
  'post-root': {
    mode: 'inline',
    run: epochAdminJobs['post-root'],
    description: 'Post / re-arm pending roots now',
  },
  'epoch-run': {
    mode: 'queue',
    queue: 'epoch',
    processor: 'epoch:run',
    description: 'Full epoch pass (build + post), time-gated',
  },
  'floor-apply': {
    mode: 'inline',
    run: () => applyClosedFloor(),
    description: 'Apply the availability floor for the closed hour',
  },
  'x402-settle': {
    mode: 'queue',
    queue: 'x402',
    processor: 'x402-settle',
    description: 'Settle x402 payments',
  },
  'x402-guard': {
    mode: 'queue',
    queue: 'x402',
    processor: 'x402-guard',
    description: 'Refresh keeper status guard',
  },
  indexer: { mode: 'queue', queue: 'chain', processor: 'indexer', description: 'Index chain logs' },
  'gas-monitor': {
    mode: 'queue',
    queue: 'chain',
    processor: 'chain:gas-monitor',
    description: 'Refresh keeper gas state',
  },
  'canary-dispatch': {
    mode: 'queue',
    queue: 'canary',
    processor: 'canary-dispatch',
    description: 'Dispatch canaries',
  },
  'probe-dispatch': {
    mode: 'queue',
    queue: 'probes',
    processor: 'probe-dispatch',
    description: 'Dispatch probes',
  },
  'cards-reconcile': {
    mode: 'queue',
    queue: 'cards',
    processor: 'cards:reconcile',
    description: 'Reconcile card operations',
  },
  'rates-rollover': {
    mode: 'queue',
    queue: 'maintenance',
    processor: 'rates:rollover',
    description: 'Roll the rate card to today/tomorrow',
  },
};

export const jsonSafe = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v ?? null, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

export interface RunDeps {
  enqueue(
    queue: QueueName,
    name: string,
    data: unknown,
    opts?: JobsOptions,
  ): Promise<{ id?: string | undefined }>;
}
export const defaultRunDeps: RunDeps = { enqueue };

export async function runAdminJob(name: string, actor: string, deps: RunDeps = defaultRunDeps) {
  const entry = Object.hasOwn(JOB_REGISTRY, name) ? JOB_REGISTRY[name] : undefined;
  if (!entry)
    throw new AppError('NOT_FOUND', `Unknown job ${name}.`, 404, { known: Object.keys(JOB_REGISTRY) });
  if (entry.mode === 'inline') {
    const result = jsonSafe(await entry.run());
    return { queued: true as const, job: name, mode: 'inline' as const, result };
  }
  const job = await deps.enqueue(
    entry.queue,
    entry.processor,
    { adminRun: true, by: actor },
    {
      jobId: `admin:${name}:${Date.now()}`,
      attempts: 1,
      removeOnComplete: 100,
    },
  );
  return {
    queued: true as const,
    job: name,
    mode: 'queue' as const,
    queue: entry.queue,
    jobId: job.id ?? null,
  };
}
