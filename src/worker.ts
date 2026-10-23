import { type Job, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { sql } from './db/client';
import { logger } from './lib/logger';
import { jobModules } from './lib/modules';
import { closeQueues, getQueue, type QueueName, type WorkerCtx } from './lib/queue';
import { closeRedis, createRedis } from './lib/redis';

type Processor = (job: Job) => Promise<unknown>;
const processors = new Map<QueueName, Map<string, Processor>>();
const workers: Worker[] = [];
const connections: Redis[] = [];

const ctx: WorkerCtx = {
  logger,
  process(queue, jobName, handler) {
    let byName = processors.get(queue);
    if (!byName) {
      byName = new Map();
      processors.set(queue, byName);
    }
    if (byName.has(jobName)) throw new Error(`Duplicate processor registered for ${queue}:${jobName}`);
    byName.set(jobName, handler);
  },
  async schedule(queue, jobName, everyMs, data) {
    await getQueue(queue).upsertJobScheduler(jobName, { every: everyMs }, { name: jobName, data });
  },
};

async function start(): Promise<void> {
  for (const register of jobModules) await register(ctx);
  for (const [queueName, handlers] of processors) {
    const connection = createRedis();
    connections.push(connection);
    const worker = new Worker(
      queueName,
      async (job) => {
        const handler = handlers.get(job.name);
        if (!handler) throw new Error(`No processor registered for ${queueName}:${job.name}`);
        return handler(job);
      },
      { connection, concurrency: 5 },
    );
    worker.on('failed', (job, err) =>
      logger.error({ jobName: job?.name, jobId: job?.id, err: err.message }, 'queue job failed'),
    );
    worker.on('error', (err) => logger.error({ err: err.message }, 'worker connection error'));
    workers.push(worker);
  }
  await Promise.all(workers.map((w) => w.waitUntilReady()));
  logger.info({ queues: [...processors.keys()] }, 'worker started');
}

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const force = setTimeout(() => {
    logger.error('shutdown deadline exceeded');
    process.exit(1);
  }, 15_000);
  const results = [
    ...(await Promise.allSettled(workers.map((w) => w.close()))),
    ...(await Promise.allSettled([closeQueues()])),
    ...(await Promise.allSettled(connections.map((c) => c.quit()))),
    ...(await Promise.allSettled([sql.end(), closeRedis()])),
  ];
  clearTimeout(force);
  process.exit(results.some((r) => r.status === 'rejected') ? 1 : 0);
}

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled rejection');
});

start().catch((err) => {
  logger.error({ err }, 'worker startup failed');
  void shutdown();
});

// Keep the process alive when no queues are registered yet.
setInterval(() => {}, 1 << 30);
