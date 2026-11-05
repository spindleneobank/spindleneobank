/**
 * Hardware and benchmark probes, every 6 hours per node (staggered). Hardware and the benchmark are
 * self-reported by the agent. Speed is also measured here: the probe sends the node an ordinary chat job with a
 * server-generated prompt on the class's reference model, and times the stream it gets back. That measurement
 * decides the speed check whenever it completes. Two consecutive misses suspend the node (never the house node)
 * and open a slash case if it is staked. Answering probes with `aborted` to stay inconclusive stops working after
 * three in a row, which count as a miss.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { nodes, probeResults } from '../../db/schema';
import { logger } from '../../lib/logger';
import { getRedis } from '../../lib/redis';
import { CLASS_EXPECTATIONS, classifyGpu, type GpuClass } from '../../shared/gpu';
import type { ProbeResultMsg } from '../../shared/node-protocol';
import { dbRef } from '../auth/constants';
import { countTokens } from '../gateway/tokenizer';
import { type Delta, type JobDone, type JobStartInput, requestFromWorker } from '../nodes/jobs';
import { loadCatalog, nodeSettings } from '../nodes/service';
import { openCase, sinceUnsuspend, suspendNode } from '../slashing/service';

export const probeSettings = {
  intervalMs: 6 * 3600_000,
  /** Per-node jitter so probes spread over this window instead of firing together. */
  jitterMs: 30 * 60_000,
  /** Probes started per scheduler tick. */
  perTick: 12,
  /** Probes run this many at a time. */
  concurrency: 3,
  /** No new probe starts after this long into a tick; must stay below the schedule interval (5 min). */
  tickBudgetMs: 4 * 60_000,
  maxTokens: 128,
  prompt: 'Write one short paragraph about graphics cards.',
  missesToSuspend: 2,
  /** After an inconclusive probe (timeout, offline, stopped for a job) the node is retried this much later. */
  retryMs: 30 * 60_000,
  /** This many `aborted` probes in a row count as a miss. */
  abortsToMiss: 3,
  /** Measured speed has some network and batching in it, so it may fall this far short of the class minimum. */
  measuredTolerance: 0.8,
  /** Fewer tokens than this is too little to time. */
  minMeasuredTokens: 16,
  /** A stream shorter than this is one burst: its rate is then taken from the start of the job. */
  minStreamMs: 500,
};

/** nodeId -> earliest next attempt after an inconclusive probe. Worker-local: a restart probes again. */
export const probeRetryAt = new Map<string, number>();

export const probeDeps = {
  probe: (nodeId: string, kind: 'hardware' | 'bench', model: string): Promise<ProbeResultMsg> =>
    requestFromWorker<ProbeResultMsg>(
      {
        type: 'probe',
        nodeId,
        probe: {
          probeId: randomUUID(),
          kind,
          params: { model, prompt: probeSettings.prompt, maxTokens: probeSettings.maxTokens },
        },
      },
      { timeoutMs: 130_000 },
    ),
  /** Sends one chat job and resolves when it ends. Rejects when the job fails. */
  dispatch: (nodeId: string, job: JobStartInput, onChunk: (d: Delta) => void): Promise<JobDone> =>
    requestFromWorker<JobDone>(
      { type: 'dispatch', nodeId, job },
      { onChunk, timeoutMs: nodeSettings.jobTimeoutMs + 10_000 },
    ),
  now: (): number => Date.now(),
  measure: (nodeId: string, model: string, engine: string): Promise<MeasuredSpeed | null> =>
    measureOnEngine(nodeId, model, engine),
};

type NodeRow = typeof nodes.$inferSelect;

export interface MeasuredSpeed {
  ttftMs: number;
  tokPerSec: number;
  tokens: number;
}

/**
 * A prompt the node cannot have prepared for. Never from the canary corpus: this job follows a `bench` probe, so a
 * node can tell what it is, and would learn one canary prompt per probe.
 */
export function probePrompt(): string {
  return `Write one short paragraph about the code name ${randomBytes(6).toString('hex')}.`;
}

/** Times a real job on the node from this side of the connection. Null when it cannot give a verdict. */
export async function measureSpeed(
  nodeId: string,
  model: string,
  engineModel: string,
): Promise<MeasuredSpeed | null> {
  const maxTokens = probeSettings.maxTokens;
  const started = probeDeps.now();
  let first = 0;
  let last = 0;
  let text = '';
  try {
    await probeDeps.dispatch(
      nodeId,
      {
        jobId: randomUUID(),
        kind: 'chat',
        model,
        engineModel,
        lane: 'open',
        request: {
          model,
          messages: [{ role: 'user', content: probePrompt() }],
          stream: true,
          max_tokens: maxTokens,
        },
        maxTokens,
        deadlineMs: started + nodeSettings.jobTimeoutMs,
      },
      (d) => {
        if (!d.delta.content) return;
        last = probeDeps.now();
        if (!first) first = last;
        text += d.delta.content;
      },
    );
  } catch (err) {
    logger.info({ nodeId, err: String(err) }, 'speed measurement did not complete');
    return null;
  }
  const { tokens } = await countTokens(model, text);
  if (tokens < probeSettings.minMeasuredTokens) return null;
  const span = last - first >= probeSettings.minStreamMs ? last - first : last - started;
  return { ttftMs: first - started, tokPerSec: (tokens / Math.max(span, 1)) * 1000, tokens };
}

export interface ProbeEval {
  classOk: boolean;
  reasons: string[];
  vramMb: number | null;
  tokPerSec: number | null;
  /** The bench was skipped (CPU class without the reference model): no verdict on speed. */
  benchSkipped: boolean;
}

async function measureOnEngine(nodeId: string, model: string, engine: string) {
  const entry = (await loadCatalog()).find((m) => m.id === model);
  const engineModel = entry?.engineIds[engine as 'ollama' | 'vllm'];
  return engineModel ? measureSpeed(nodeId, model, engineModel) : null;
}

/** Compares probe output with `CLASS_EXPECTATIONS` for the node's claimed class. Pure. */
export function evaluateProbe(
  claimedClass: number,
  hardware: ProbeResultMsg['hardware'] | undefined,
  bench: ProbeResultMsg['bench'] | undefined,
  opts: { hasRefModel: boolean; measured?: MeasuredSpeed | null },
): ProbeEval {
  const exp = CLASS_EXPECTATIONS[claimedClass as GpuClass];
  const reasons: string[] = [];
  const vramMb = hardware?.gpus.length
    ? Math.max(...hardware.gpus.map((g) => g.vramMb))
    : hardware
      ? 0
      : null;
  if (!hardware) reasons.push('no hardware report');
  else {
    const reported = classifyGpu(hardware).gpuClass;
    if (reported < claimedClass) reasons.push(`gpu class ${reported} reported, ${claimedClass} claimed`);
    if ((vramMb ?? 0) < exp.minVramMb) reasons.push(`vram ${vramMb} MB < ${exp.minVramMb} MB`);
  }
  let benchSkipped = false;
  const measured = opts.measured ?? null;
  const tokPerSec = measured?.tokPerSec ?? bench?.tokPerSec ?? null;
  if (claimedClass > 0 && !opts.hasRefModel) {
    // the reference model is in every GPU class's models.ensure set, so an honest node always has it
    reasons.push(`reference model ${exp.refModel} is not installed`);
  } else if (measured) {
    // what we timed ourselves outranks what the node says about itself
    if (measured.tokPerSec < exp.minTokPerSec * probeSettings.measuredTolerance) {
      reasons.push(
        `${measured.tokPerSec.toFixed(1)} tok/s measured < ${exp.minTokPerSec} tok/s on ${exp.refModel}`,
      );
    }
  } else if (!bench) {
    if (claimedClass === 0 && !opts.hasRefModel) benchSkipped = true;
    else reasons.push('no benchmark result');
  } else if (bench.tokPerSec < exp.minTokPerSec) {
    reasons.push(`${bench.tokPerSec} tok/s < ${exp.minTokPerSec} tok/s on ${exp.refModel}`);
  }
  return { classOk: reasons.length === 0, reasons, vramMb, tokPerSec, benchSkipped };
}

/** Probes one node, stores the result and applies the consequences. Returns null if it was inconclusive. */
export async function probeNode(nodeId: string): Promise<{ classOk: boolean; suspended: boolean } | null> {
  const [node] = await dbRef.db.select().from(nodes).where(eq(nodes.id, nodeId));
  if (!node || node.status === 'suspended' || node.status === 'deactivated') return null;
  const exp = CLASS_EXPECTATIONS[node.gpuClass as GpuClass];
  let hw: ProbeResultMsg;
  let bench: ProbeResultMsg;
  const inconclusive = (why: string) => {
    // retrying every tick would keep a slow node permanently probing (a node still running the timed-out
    // benchmark refuses jobs), so wait `retryMs`
    probeRetryAt.set(nodeId, probeDeps.now() + probeSettings.retryMs);
    logger.info({ nodeId, why }, 'probe inconclusive');
    return null;
  };
  const models = (Array.isArray(node.models) ? node.models : []) as { id: string; engineId?: string }[];
  const hasRefModel = models.some((m) => m.id === exp.refModel);
  let measured: MeasuredSpeed | null = null;
  let aborted = false;
  try {
    hw = await probeDeps.probe(nodeId, 'hardware', exp.refModel);
    aborted = hw.aborted === true;
    bench = aborted ? hw : await probeDeps.probe(nodeId, 'bench', exp.refModel);
    if (!aborted && hasRefModel) measured = await probeDeps.measure(nodeId, exp.refModel, node.engine);
    // a benchmark stopped for a real job is fine as long as we could time the node ourselves
    aborted = aborted || (bench.aborted === true && !measured);
  } catch (err) {
    // offline, busy or slow
    return inconclusive(String(err));
  }
  const abortKey = `probe:aborts:${nodeId}`;
  const abortMiss = aborted && (await getRedis().incr(abortKey)) >= probeSettings.abortsToMiss;
  if (aborted) await getRedis().expire(abortKey, 7 * 24 * 3600);
  if (aborted && !abortMiss) return inconclusive('stopped for a job');
  await getRedis().del(abortKey);
  probeRetryAt.delete(nodeId);
  const ev: ProbeEval = abortMiss
    ? {
        classOk: false,
        reasons: [`${probeSettings.abortsToMiss} aborted probes in a row`],
        vramMb: null,
        tokPerSec: null,
        benchSkipped: false,
      }
    : evaluateProbe(node.gpuClass, hw.hardware, bench.bench, { hasRefModel, measured });
  await dbRef.db.insert(probeResults).values({
    nodeId,
    vramGb: ev.vramMb === null ? null : Math.round(ev.vramMb / 1024),
    tokPerSec: ev.tokPerSec === null ? null : String(ev.tokPerSec),
    classOk: ev.classOk,
    details: {
      claimedClass: node.gpuClass,
      expectations: exp,
      reasons: ev.reasons,
      benchSkipped: ev.benchSkipped,
      hardware: hw.hardware ?? null,
      bench: bench.bench ?? null,
      measured,
    },
  });
  await dbRef.db
    .update(nodes)
    .set({
      lastProbeAt: new Date(probeDeps.now()),
      ...(bench.bench ? { benchmark: { ...bench.bench, at: new Date(probeDeps.now()).toISOString() } } : {}),
    })
    .where(eq(nodes.id, nodeId));
  if (ev.classOk) return { classOk: true, suspended: false };

  const since = await sinceUnsuspend(nodeId, new Date(0));
  const recent = await dbRef.db
    .select({ ok: probeResults.classOk })
    .from(probeResults)
    .where(and(eq(probeResults.nodeId, nodeId), gte(probeResults.createdAt, since)))
    .orderBy(desc(probeResults.createdAt))
    .limit(probeSettings.missesToSuspend);
  let suspended = false;
  if (recent.length >= probeSettings.missesToSuspend && recent.every((r) => !r.ok) && !node.isHouse) {
    if (isStakedRow(node)) await openCase(nodeId, 'probe_misrepresentation');
    suspended = await suspendNode(nodeId, `failed ${probeSettings.missesToSuspend} probes in a row`, {
      auto: true,
    });
  }
  return { classOk: false, suspended };
}

const isStakedRow = (n: NodeRow): boolean => BigInt(n.stakeSpdl) > 0n && n.onchainId !== null;

/** Stable 0..1 fraction from the node id, so jitter does not change between ticks. */
function jitterOf(id: string): number {
  return Number.parseInt(id.replace(/-/g, '').slice(0, 8), 16) / 0xffffffff;
}

/** Registered, online nodes whose last probe is older than 6 h minus their jitter. */
export async function dueNodes(now = probeDeps.now()): Promise<string[]> {
  const rows = await dbRef.db
    .select({ id: nodes.id, last: nodes.lastProbeAt })
    .from(nodes)
    .where(and(eq(nodes.registered, true), inArray(nodes.status, ['online'])));
  return rows
    .filter((r) => (probeRetryAt.get(r.id) ?? 0) <= now)
    .filter(
      (r) =>
        !r.last ||
        now - r.last.getTime() >= probeSettings.intervalMs - jitterOf(r.id) * probeSettings.jitterMs,
    )
    .sort((a, b) => (a.last?.getTime() ?? 0) - (b.last?.getTime() ?? 0))
    .map((r) => r.id);
}

/** One scheduler tick: probes up to `perTick` due nodes, `concurrency` at a time, within the time budget. */
export async function scheduleProbes(): Promise<string[]> {
  const queue = (await dueNodes()).slice(0, probeSettings.perTick);
  const started: string[] = [];
  const deadline = Date.now() + probeSettings.tickBudgetMs;
  const worker = async () => {
    for (;;) {
      if (Date.now() >= deadline) return;
      const id = queue.shift();
      if (!id) return;
      started.push(id);
      await probeNode(id).catch((err) => logger.error({ err: String(err), nodeId: id }, 'probe failed'));
    }
  };
  await Promise.all(Array.from({ length: probeSettings.concurrency }, worker));
  return started;
}
