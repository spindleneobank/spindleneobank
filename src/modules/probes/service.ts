/**
 * Hardware and benchmark probes, every 6 hours per node (staggered). All data is self-reported by the
 * agent, so a probe is a consistency check on the node's claimed GPU class; canaries are the stronger
 * test. Two consecutive misses suspend the node (never the house node) and open a slash case if it is
 * staked.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { nodes, probeResults } from '../../db/schema';
import { logger } from '../../lib/logger';
import { CLASS_EXPECTATIONS, classifyGpu, type GpuClass } from '../../shared/gpu';
import type { ProbeResultMsg } from '../../shared/node-protocol';
import { dbRef } from '../auth/constants';
import { requestFromWorker } from '../nodes/jobs';
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
  now: (): number => Date.now(),
};

type NodeRow = typeof nodes.$inferSelect;

export interface ProbeEval {
  classOk: boolean;
  reasons: string[];
  vramMb: number | null;
  tokPerSec: number | null;
  /** The bench was skipped (CPU class without the reference model): no verdict on speed. */
  benchSkipped: boolean;
}

/** Compares probe output with `CLASS_EXPECTATIONS` for the node's claimed class. Pure. */
export function evaluateProbe(
  claimedClass: number,
  hardware: ProbeResultMsg['hardware'] | undefined,
  bench: ProbeResultMsg['bench'] | undefined,
  opts: { hasRefModel: boolean },
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
  const tokPerSec = bench?.tokPerSec ?? null;
  if (claimedClass > 0 && !opts.hasRefModel) {
    // the reference model is in every GPU class's models.ensure set, so an honest node always has it
    reasons.push(`reference model ${exp.refModel} is not installed`);
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
  try {
    hw = await probeDeps.probe(nodeId, 'hardware', exp.refModel);
    if (hw.aborted) return inconclusive('hardware probe stopped for a job');
    bench = await probeDeps.probe(nodeId, 'bench', exp.refModel);
    if (bench.aborted) return inconclusive('benchmark stopped for a job');
  } catch (err) {
    // offline, busy or slow
    return inconclusive(String(err));
  }
  probeRetryAt.delete(nodeId);
  const models = (Array.isArray(node.models) ? node.models : []) as { id: string }[];
  const ev = evaluateProbe(node.gpuClass, hw.hardware, bench.bench, {
    hasRefModel: models.some((m) => m.id === exp.refModel),
  });
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
