import { type Job, type JobsOptions, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { createRedis } from './redis';

export const QUEUE_NAMES = [
  'receipts',
  'metering',
  'epoch',
  'chain',
  'canary',
  'probes',
  'cards',
  'x402',
  'maintenance',
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export type WorkerCtx = {
  logger: Logger;
  process(queue: QueueName, jobName: string, handler: (job: Job) => Promise<unknown>): void;
  schedule(queue: QueueName, jobName: string, everyMs: number, data?: unknown): Promise<void>;
};

const defaultJobOptions: JobsOptions = {
  removeOnComplete: 1000,
  removeOnFail: 5000,
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
};

const queues = new Map<QueueName, Queue>();
const connections = new Map<QueueName, Redis>();

export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing) return existing;
  const connection = createRedis();
  const queue = new Queue(name, { connection, defaultJobOptions });
  queues.set(name, queue);
  connections.set(name, connection);
  return queue;
}

export function enqueue(name: QueueName, jobName: string, data: unknown, opts?: JobsOptions) {
  return getQueue(name).add(jobName, data, opts);
}

export async function closeQueues(): Promise<void> {
  const closing = [...queues.keys()];
  const qs = [...queues.values()];
  const conns = closing.map((n) => connections.get(n)).filter((c): c is Redis => !!c);
  queues.clear();
  connections.clear();
  const results = await Promise.allSettled([...qs.map((q) => q.close()), ...conns.map((c) => c.quit())]);
  const failure = results.find((r) => r.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}
