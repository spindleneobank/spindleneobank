import { describe, expect, test } from 'bun:test';
import { DEFAULT_CATALOG } from './catalog';
import { CLASS_EXPECTATIONS, classifyGpu, fitModels, laneForClass } from './gpu';
import type { HardwareReport } from './node-protocol';

const hw = (name: string, vramMb: number, cc = false): HardwareReport => ({
  gpus: name ? [{ name, vramMb, driver: '550', uuid: 'GPU-1', cc }] : [],
  cpu: 'x',
  ramMb: 32768,
});

describe('classifyGpu', () => {
  const cases: [string, HardwareReport, number, boolean][] = [
    ['4090', hw('NVIDIA GeForce RTX 4090', 24564), 2, false],
    ['5090', hw('NVIDIA GeForce RTX 5090', 32607), 2, false],
    ['H100 cc', hw('NVIDIA H100 80GB HBM3', 81559, true), 3, true],
    ['H200 cc', hw('NVIDIA H200', 143771, true), 3, true],
    ['H100 non-cc', hw('NVIDIA H100 80GB HBM3', 81559, false), 1, false],
    ['B200 cc', hw('NVIDIA B200', 183359, true), 4, true],
    ['B200 non-cc', hw('NVIDIA B200', 183359, false), 1, false],
    ['3090', hw('NVIDIA GeForce RTX 3090', 24576), 1, false],
    ['A100', hw('NVIDIA A100-SXM4-40GB', 40960), 1, false],
    ['4080 16GB', hw('NVIDIA GeForce RTX 4080', 16376), 1, false],
    ['CPU', hw('', 0), 0, false],
    ['GTX 8GB', hw('NVIDIA GeForce GTX 1080', 8192), 0, false],
    ['AMD', hw('AMD Radeon RX 7900 XTX', 24576), 0, false],
  ];
  for (const [label, h, cls, cc] of cases) {
    test(label, () => {
      const r = classifyGpu(h);
      expect(r.gpuClass).toBe(cls as 0);
      expect(r.ccCapable).toBe(cc);
      expect(r.lane).toBe(laneForClass(cls));
    });
  }
  test('expectations exist', () => {
    for (const c of [0, 1, 2, 3, 4] as const) expect(CLASS_EXPECTATIONS[c].refModel).toBeTruthy();
  });
});

describe('fitModels', () => {
  test('24 GB', () => {
    const r = fitModels(24564, DEFAULT_CATALOG);
    const by = Object.fromEntries(r.map((x) => [x.model.id, x.fit]));
    expect(by['qwen2.5:7b']).toBe('fits');
    expect(by['qwen2.5:32b']).toBe('tight');
  });
  test('4 GB', () => {
    const ids = fitModels(4096, DEFAULT_CATALOG).map((x) => x.model.id);
    expect(ids).toContain('qwen2.5:0.5b');
    expect(ids).toContain('nomic-embed-text');
    expect(ids).not.toContain('qwen2.5:7b');
    expect(ids).not.toContain('qwen2.5:32b');
  });
  test('zero', () => expect(fitModels(0, DEFAULT_CATALOG)).toEqual([]));
});
