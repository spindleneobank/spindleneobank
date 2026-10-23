import type { Lane } from './enums';
import type { HardwareReport } from './node-protocol';

export type GpuClass = 0 | 1 | 2 | 3 | 4;
export type GpuInfo = HardwareReport['gpus'][number];
export type { HardwareReport };

export const GPU_CLASSES: readonly {
  id: GpuClass;
  label: string;
  lane: Lane;
  unitKinds: readonly ('tokens_1m' | 'image' | 'job' | 'gpu_hour')[];
}[] = [
  { id: 0, label: 'CPU / other', lane: 'open', unitKinds: ['tokens_1m', 'image', 'job'] },
  {
    id: 1,
    label: 'RTX 3090 / A-series / other >=16 GB',
    lane: 'open',
    unitKinds: ['tokens_1m', 'image', 'job'],
  },
  { id: 2, label: 'RTX 4090 / 5090', lane: 'open', unitKinds: ['tokens_1m', 'image', 'job'] },
  { id: 3, label: 'H100 / H200 (CC)', lane: 'sealed', unitKinds: ['tokens_1m', 'image', 'job', 'gpu_hour'] },
  { id: 4, label: 'B200 / B300 (CC)', lane: 'sealed', unitKinds: ['tokens_1m', 'image', 'job', 'gpu_hour'] },
];

export function laneForClass(c: GpuClass | number): Lane {
  return c === 3 || c === 4 ? 'sealed' : 'open';
}

/** Probe thresholds per class. Placeholder values; tune against measured hardware (B11). */
export const CLASS_EXPECTATIONS: Record<
  GpuClass,
  { minVramMb: number; refModel: string; minTokPerSec: number }
> = {
  0: { minVramMb: 0, refModel: 'qwen2.5:0.5b', minTokPerSec: 1 },
  1: { minVramMb: 15_500, refModel: 'qwen2.5:7b', minTokPerSec: 25 },
  2: { minVramMb: 23_000, refModel: 'qwen2.5:7b', minTokPerSec: 60 },
  3: { minVramMb: 75_000, refModel: 'qwen2.5:32b', minTokPerSec: 40 },
  4: { minVramMb: 170_000, refModel: 'qwen2.5:32b', minTokPerSec: 70 },
};

const isNvidia = (n: string) => /nvidia|geforce|\brtx\b|\bgtx\b|quadro|tesla|\b[ahlb]\d{2,3}\b/i.test(n);

function classifyOne(g: GpuInfo): { gpuClass: GpuClass; ccCapable: boolean } {
  const n = g.name;
  if (/\bH(100|200)\b/i.test(n))
    return g.cc ? { gpuClass: 3, ccCapable: true } : { gpuClass: 1, ccCapable: false };
  if (/\bGB?(200|300)\b|\bB(200|300)\b/i.test(n))
    return g.cc ? { gpuClass: 4, ccCapable: true } : { gpuClass: 1, ccCapable: false };
  if (/\bRTX\s*(4090|5090)\b/i.test(n)) return { gpuClass: 2, ccCapable: false };
  if (/\bRTX\s*3090\b/i.test(n) || /\bA\d{2,4}\b/.test(n)) return { gpuClass: 1, ccCapable: false };
  if (isNvidia(n) && g.vramMb >= 16_000) return { gpuClass: 1, ccCapable: false };
  return { gpuClass: 0, ccCapable: false };
}

/** Classifies the node by its best GPU. A CC-capable GPU without `cc: true` runs the open lane at class 1. */
export function classifyGpu(hw: HardwareReport): { gpuClass: GpuClass; lane: Lane; ccCapable: boolean } {
  let best: { gpuClass: GpuClass; ccCapable: boolean } = { gpuClass: 0, ccCapable: false };
  for (const g of hw.gpus) {
    const c = classifyOne(g);
    if (c.gpuClass > best.gpuClass) best = c;
  }
  return { gpuClass: best.gpuClass, lane: laneForClass(best.gpuClass), ccCapable: best.ccCapable };
}

export { fitModels } from './catalog';
