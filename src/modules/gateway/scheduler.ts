import { config } from '../../config';
import { FIT_MARGIN, TIGHT_MARGIN } from '../../shared/catalog';
import type { JobKind, Lane } from '../../shared/enums';
import { type CandidateFilter, type NodeCandidate, nodeHub } from '../nodes/hub';
import { cachedMinStake, loadNodesByIds, type NodeRow } from '../nodes/service';

export interface ScheduleRequest {
  model: string;
  lane: Lane;
  kind: JobKind;
  /** Catalog minimum VRAM for the model; nodes with a known, smaller VRAM are excluded. */
  minVramMb?: number;
  /** Prompt + completion tokens the request needs; nodes serving a smaller context are excluded (FX3). */
  minContext?: number;
  /** Node ids that already failed this request. */
  exclude?: ReadonlySet<string>;
}

export type Tier = 'staked' | 'unstaked' | 'house';

export interface Candidate extends NodeCandidate {
  tier: Tier;
  score: number;
  /** Lane of the node (a sealed node may serve an open job). */
  nodeLane: Lane;
}

export interface SchedulerDeps {
  candidates(filter: CandidateFilter): NodeCandidate[];
  loadNodes(ids: string[]): Promise<NodeRow[]>;
  /** Per-class minimum stake (SPDL wei) or null if unknown. */
  minStake(gpuClass: number): bigint | null;
  sealedEnabled(): boolean;
  now(): number;
  random(): number;
}

export const SEALED_ATTEST_MAX_AGE_MS = 3600_000;
export const WEIGHTS = { stake: 0.35, reputation: 0.25, latency: 0.2, headroom: 0.1, jitter: 0.1 } as const;

const defaultDeps: SchedulerDeps = {
  candidates: (f) => nodeHub.candidates(f),
  loadNodes: (ids) => loadNodesByIds(ids),
  minStake: (c) => cachedMinStake(c),
  sealedEnabled: () => config.SEALED_LANE_ENABLED,
  now: () => Date.now(),
  random: Math.random,
};

/** Exponentially weighted TTFT per node (ms), fed by the gateway. */
const ttftEwma = new Map<string, number>();
const EWMA_ALPHA = 0.3;

export function recordTtft(nodeId: string, ms: number): void {
  const prev = ttftEwma.get(nodeId);
  ttftEwma.set(nodeId, prev === undefined ? ms : prev + EWMA_ALPHA * (ms - prev));
}
export const getTtft = (nodeId: string): number | undefined => ttftEwma.get(nodeId);
export const resetTtft = (): void => ttftEwma.clear();

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

function vramFits(node: NodeRow, minVramMb: number | undefined): boolean {
  if (!minVramMb || !node.vramGb) return true; // CPU / unknown: the hub already applied its own fit check
  return node.vramGb * 1024 >= minVramMb * TIGHT_MARGIN;
}

export function scoreNode(
  c: NodeCandidate,
  node: NodeRow,
  deps: Pick<SchedulerDeps, 'minStake' | 'random'>,
  minVramMb?: number,
): number {
  const min = deps.minStake(c.gpuClass);
  const stakeW = c.staked && min && min > 0n ? Math.min(1, Number((c.stake * 1000n) / (4n * min)) / 1000) : 0;
  const rep = clamp01(c.reputation / 1000);
  const ttft = ttftEwma.get(c.nodeId);
  const latency = ttft === undefined ? 0.5 : 1 / (1 + ttft / 1000);
  const headroom =
    minVramMb && node.vramGb ? clamp01((node.vramGb * 1024) / (minVramMb * FIT_MARGIN * 2)) : 0.5;
  return (
    WEIGHTS.stake * stakeW +
    WEIGHTS.reputation * rep +
    WEIGHTS.latency * latency +
    WEIGHTS.headroom * headroom +
    WEIGHTS.jitter * deps.random()
  );
}

/**
 * Ordered list of nodes that may serve the request, best first. Hard filters: registered only
 * (the hub already guarantees it, re-checked here), not suspended, VRAM fit, sealed-lane attestation.
 * Order: open-lane staked, open-lane unstaked, sealed-lane nodes (open jobs only, after every open
 * node), and the house node last of all.
 */
export async function rank(
  req: ScheduleRequest,
  overrides: Partial<SchedulerDeps> = {},
): Promise<Candidate[]> {
  const deps = { ...defaultDeps, ...overrides };
  const lanes: Lane[] = req.lane === 'sealed' ? (deps.sealedEnabled() ? ['sealed'] : []) : ['open', 'sealed'];
  const raw: NodeCandidate[] = [];
  for (const lane of lanes) {
    for (const c of deps.candidates({ model: req.model, lane, kind: req.kind })) {
      if (!req.exclude?.has(c.nodeId) && c.registered && c.contextTokens >= (req.minContext ?? 0))
        raw.push(c);
    }
  }
  if (raw.length === 0) return [];
  const rows = new Map((await deps.loadNodes(raw.map((c) => c.nodeId))).map((n) => [n.id, n]));
  const now = deps.now();

  const eligible: { c: NodeCandidate; node: NodeRow }[] = [];
  for (const c of raw) {
    const node = rows.get(c.nodeId);
    if (!node?.registered) continue;
    if (node.status === 'suspended' || node.status === 'deactivated') continue;
    if (!vramFits(node, req.minVramMb)) continue;
    if (req.lane === 'sealed') {
      const at = node.lastAttestAt?.getTime();
      if (node.lane !== 'sealed' || at === undefined || now - at > SEALED_ATTEST_MAX_AGE_MS) continue;
    }
    eligible.push({ c, node });
  }

  const build = (e: { c: NodeCandidate; node: NodeRow }, tier: Tier): Candidate => ({
    ...e.c,
    tier,
    nodeLane: e.node.lane as Lane,
    score: scoreNode(e.c, e.node, deps, req.minVramMb),
  });
  const sortDesc = (a: Candidate, b: Candidate) => b.score - a.score;
  const group = (pred: (e: { c: NodeCandidate; node: NodeRow }) => boolean, tier: Tier) =>
    eligible
      .filter(pred)
      .map((e) => build(e, tier))
      .sort(sortDesc);

  const nonHouse = (e: { c: NodeCandidate }) => !e.c.isHouse;
  const openLane = (e: { node: NodeRow }) => e.node.lane === 'open';
  const out: Candidate[] = [];
  // Open-lane nodes first, sealed nodes only as a fallback for open jobs.
  for (const laneOk of [openLane, (e: { node: NodeRow }) => !openLane(e)]) {
    out.push(...group((e) => nonHouse(e) && laneOk(e) && e.c.staked, 'staked'));
    out.push(...group((e) => nonHouse(e) && laneOk(e) && !e.c.staked, 'unstaked'));
  }
  out.push(...group((e) => e.c.isHouse, 'house').map((c) => ({ ...c, score: -1 })));
  return out;
}

/** Best node for the request, or null when none can serve it. */
export async function pick(
  req: ScheduleRequest,
  overrides?: Partial<SchedulerDeps>,
): Promise<Candidate | null> {
  return (await rank(req, overrides))[0] ?? null;
}
