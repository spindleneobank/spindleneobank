import { beforeEach, describe, expect, test } from 'bun:test';
import type { NodeCandidate } from '../nodes/hub';
import type { NodeRow } from '../nodes/service';
import { pick, rank, recordTtft, resetTtft, type SchedulerDeps } from './scheduler';

const NOW = Date.parse('2026-10-23T12:00:00Z');
const MIN = 100n * 10n ** 18n;

interface Spec {
  id: string;
  lane?: 'open' | 'sealed';
  registered?: boolean;
  staked?: boolean;
  stake?: bigint;
  house?: boolean;
  rep?: number;
  attestAgeMs?: number | null;
  status?: string;
  vramGb?: number | null;
  gpuClass?: number;
}

function world(specs: Spec[], extra: Partial<SchedulerDeps> = {}): Partial<SchedulerDeps> {
  const cand = (s: Spec): NodeCandidate => ({
    nodeId: s.id,
    nodeKey: `0x${s.id}`,
    owner: '0xowner',
    lane: s.lane ?? 'open',
    gpuClass: s.gpuClass ?? 1,
    engine: 'ollama',
    isHouse: s.house ?? false,
    registered: s.registered ?? true,
    staked: s.staked ?? false,
    stake: s.stake ?? (s.staked ? MIN : 0n),
    reputation: s.rep ?? 1000,
    inflight: 0,
    capacity: 1,
    lastSeen: NOW,
    contextTokens: 4096,
  });
  const row = (s: Spec) =>
    ({
      id: s.id,
      lane: s.lane ?? 'open',
      registered: s.registered ?? true,
      status: s.status ?? 'online',
      vramGb: s.vramGb === undefined ? 24 : s.vramGb,
      lastAttestAt: s.attestAgeMs == null ? null : new Date(NOW - s.attestAgeMs),
    }) as unknown as NodeRow;
  return {
    candidates: (f) => specs.filter((s) => (s.lane ?? 'open') === f.lane).map(cand),
    loadNodes: async (ids) => specs.filter((s) => ids.includes(s.id)).map(row),
    minStake: () => MIN,
    sealedEnabled: () => true,
    now: () => NOW,
    random: () => 0.5,
    ...extra,
  };
}

const REQ = { model: 'qwen2.5:7b', lane: 'open', kind: 'chat', minVramMb: 8192 } as const;
const ids = async (specs: Spec[], req: Parameters<typeof rank>[0] = REQ, extra = {}) =>
  (await rank(req, world(specs, extra))).map((c) => c.nodeId);

beforeEach(() => resetTtft());

describe('scheduler', () => {
  test('nothing available -> null', async () => {
    expect(await pick(REQ, world([]))).toBeNull();
  });

  test('unregistered nodes are never chosen, even if the hub reports them', async () => {
    expect(await ids([{ id: 'a', registered: false }])).toEqual([]);
    expect(await ids([{ id: 'a', registered: false }, { id: 'b' }])).toEqual(['b']);
  });

  test('suspended nodes and VRAM misfits are excluded', async () => {
    expect(await ids([{ id: 'a', status: 'suspended' }, { id: 'b', vramGb: 4 }, { id: 'c' }])).toEqual(['c']);
  });

  test('house node is last whenever another eligible node exists', async () => {
    const out = await ids([
      { id: 'house', house: true, staked: true, rep: 1000 },
      { id: 'u1', rep: 10 },
      { id: 's1', staked: true },
    ]);
    expect(out).toEqual(['s1', 'u1', 'house']);
    expect(await ids([{ id: 'house', house: true }])).toEqual(['house']);
  });

  test('staked tier beats unstaked even when the unstaked node scores higher', async () => {
    recordTtft('u', 5); // very fast unstaked node
    recordTtft('s', 20_000); // slow staked node
    const out = await ids([
      { id: 'u', rep: 1000, vramGb: 80 },
      { id: 's', staked: true, rep: 100 },
    ]);
    expect(out).toEqual(['s', 'u']);
  });

  test('within a tier: more stake and better reputation score higher', async () => {
    const out = await ids([
      { id: 'low', staked: true, stake: MIN },
      { id: 'high', staked: true, stake: MIN * 4n },
      { id: 'badrep', staked: true, stake: MIN * 4n, rep: 100 },
    ]);
    expect(out).toEqual(['high', 'badrep', 'low']);
  });

  test('latency EWMA breaks ties', async () => {
    recordTtft('slow', 4000);
    recordTtft('fast', 100);
    expect(await ids([{ id: 'slow' }, { id: 'fast' }])).toEqual(['fast', 'slow']);
  });

  test('exclude set removes nodes that already failed', async () => {
    const out = (await rank({ ...REQ, exclude: new Set(['a']) }, world([{ id: 'a' }, { id: 'b' }]))).map(
      (c) => c.nodeId,
    );
    expect(out).toEqual(['b']);
  });

  test('open jobs: open nodes first, sealed nodes only as a fallback, house last', async () => {
    const out = await ids([
      { id: 'sealed', lane: 'sealed', staked: true, attestAgeMs: 1000 },
      { id: 'house', house: true },
      { id: 'open' },
    ]);
    expect(out).toEqual(['open', 'sealed', 'house']);
  });

  test('sealed lane: requires sealed node, fresh attestation and the feature flag', async () => {
    const sealedReq = { ...REQ, lane: 'sealed' } as const;
    const nodes: Spec[] = [
      { id: 'fresh', lane: 'sealed', attestAgeMs: 59 * 60_000 },
      { id: 'stale', lane: 'sealed', attestAgeMs: 61 * 60_000 },
      { id: 'never', lane: 'sealed', attestAgeMs: null },
      { id: 'open', lane: 'open' },
    ];
    expect(await ids(nodes, sealedReq)).toEqual(['fresh']);
    expect(await ids(nodes, sealedReq, { sealedEnabled: () => false })).toEqual([]);
  });
});
