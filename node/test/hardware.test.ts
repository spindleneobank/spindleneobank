import { describe, expect, test } from 'bun:test';
import { detectHardware, parseCcStatus, parseNvidiaCsv, parseRocmJson } from '../src/hardware';

const ONE = `NVIDIA GeForce RTX 4090, 24564, 550.54.14, GPU-aaaa-1111, 3, 512, 41, 62.35\n`;
const TWO = `NVIDIA H100 80GB HBM3, 81559, 550.90.07, GPU-1, 0, 4, 30, 70.1\nNVIDIA H100 80GB HBM3, 81559, 550.90.07, GPU-2, 55, 20000, 52, [N/A]\n`;

describe('hardware', () => {
  test('1 GPU csv', () => {
    const r = parseNvidiaCsv(ONE);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: 'NVIDIA GeForce RTX 4090', vramMb: 24564, driver: '550.54.14', uuid: 'GPU-aaaa-1111' });
    expect(r[0]?.stat).toEqual({ util: 3, memUsedMb: 512, tempC: 41, powerW: 62.35 });
  });
  test('2 GPUs csv with N/A power', () => {
    const r = parseNvidiaCsv(TWO);
    expect(r.map((x) => x.uuid)).toEqual(['GPU-1', 'GPU-2']);
    expect(r[1]?.stat.powerW).toBeUndefined();
    expect(r[1]?.stat.util).toBe(55);
  });
  test('no GPU', () => {
    expect(parseNvidiaCsv('')).toEqual([]);
    expect(parseNvidiaCsv('\n\n')).toEqual([]);
  });
  test('cc status', () => {
    expect(parseCcStatus('CC status: ON')).toBe(true);
    expect(parseCcStatus('CC status: OFF')).toBe(false);
    expect(parseCcStatus(null)).toBe(false);
  });
  test('rocm json', () => {
    const r = parseRocmJson(
      JSON.stringify({ card0: { 'VRAM Total Memory (B)': '17163091968', 'VRAM Total Used Memory (B)': '10485760' } }),
    );
    expect(r[0]?.vramMb).toBe(16368);
    expect(parseRocmJson('garbage')).toEqual([]);
  });
  test('fake gpu override and cpu fallback shape', async () => {
    const h = await detectHardware({ name: 'RTX 4090', vramMb: 24576 });
    expect(h.gpus[0]).toMatchObject({ name: 'RTX 4090', vramMb: 24576, cc: false });
    const real = await detectHardware();
    expect(real.ramMb).toBeGreaterThan(0);
    expect(real.cpu.length).toBeGreaterThan(0);
  });
});
