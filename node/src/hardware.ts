import { cpus, totalmem } from 'node:os';
import type { GpuInfo, HardwareReport } from '@spindle/shared/gpu';
import type { Config } from './config';

export type Hardware = HardwareReport;

export interface GpuStat {
  util: number;
  memUsedMb: number;
  tempC?: number;
  powerW?: number;
}

export const NVIDIA_QUERY = [
  '--query-gpu=name,memory.total,driver_version,uuid,utilization.gpu,memory.used,temperature.gpu,power.draw',
  '--format=csv,noheader,nounits',
];

/** Runs a command and returns stdout, or null if missing/failed. */
export async function run(cmd: string[], timeoutMs = 8000): Promise<string | null> {
  try {
    const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' });
    const timer = setTimeout(() => p.kill(), timeoutMs);
    const out = await new Response(p.stdout).text();
    const code = await p.exited;
    clearTimeout(timer);
    return code === 0 ? out : null;
  } catch {
    return null;
  }
}

const num = (s: string | undefined): number | undefined => {
  if (s === undefined) return undefined;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
};

interface NvidiaRow {
  name: string;
  vramMb: number;
  driver: string;
  uuid: string;
  stat: GpuStat;
}

export function parseNvidiaCsv(csv: string): NvidiaRow[] {
  const rows: NvidiaRow[] = [];
  for (const line of csv.split('\n')) {
    if (!line.trim()) continue;
    const f = line.split(',').map((s) => s.trim());
    if (f.length < 4 || !f[0]) continue;
    const stat: GpuStat = { util: num(f[4]) ?? 0, memUsedMb: num(f[5]) ?? 0 };
    const t = num(f[6]);
    const p = num(f[7]);
    if (t !== undefined) stat.tempC = t;
    if (p !== undefined) stat.powerW = p;
    rows.push({
      name: f[0],
      vramMb: Math.round(num(f[1]) ?? 0),
      driver: f[2] ?? '',
      uuid: f[3] ?? '',
      stat,
    });
  }
  return rows;
}

/** `rocm-smi --showmeminfo vram --json` -> best-effort GPU list. */
export function parseRocmJson(text: string): { name: string; vramMb: number; usedMb: number }[] {
  try {
    const j = JSON.parse(text) as Record<string, Record<string, string>>;
    const out: { name: string; vramMb: number; usedMb: number }[] = [];
    for (const [card, v] of Object.entries(j)) {
      if (!/^card\d+/.test(card) || !v) continue;
      const total = Number(v['VRAM Total Memory (B)']);
      const used = Number(v['VRAM Total Used Memory (B)'] ?? 0);
      if (!Number.isFinite(total) || total <= 0) continue;
      out.push({
        name: `AMD GPU (${card})`,
        vramMb: Math.round(total / 1048576),
        usedMb: Math.round(used / 1048576),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function parseCcStatus(out: string | null): boolean {
  return out !== null && /CC status:\s*ON/i.test(out);
}

export async function detectHardware(fake?: Config['devFakeGpu']): Promise<Hardware> {
  const cpu = cpus()[0]?.model?.trim() || 'unknown cpu';
  const ramMb = Math.round(totalmem() / 1048576);
  if (fake) {
    return {
      gpus: [{ name: fake.name, vramMb: fake.vramMb, driver: 'fake', uuid: 'GPU-fake-0', cc: false }],
      cpu,
      ramMb,
    };
  }
  const gpus: GpuInfo[] = [];
  const nv = await run(['nvidia-smi', ...NVIDIA_QUERY]);
  if (nv) {
    const cc = parseCcStatus(await run(['nvidia-smi', 'conf-compute', '-f']));
    for (const r of parseNvidiaCsv(nv))
      gpus.push({ name: r.name, vramMb: r.vramMb, driver: r.driver, uuid: r.uuid, cc });
  } else {
    const amd = await run(['rocm-smi', '--showmeminfo', 'vram', '--json']);
    if (amd) {
      for (const [i, g] of parseRocmJson(amd).entries())
        gpus.push({ name: g.name, vramMb: g.vramMb, driver: 'rocm', uuid: `rocm-${i}`, cc: false });
    }
  }
  return { gpus, cpu, ramMb };
}

export async function readGpuStats(): Promise<GpuStat[]> {
  const nv = await run(['nvidia-smi', ...NVIDIA_QUERY]);
  if (nv) return parseNvidiaCsv(nv).map((r) => r.stat);
  const amd = await run(['rocm-smi', '--showmeminfo', 'vram', '--json']);
  if (amd) return parseRocmJson(amd).map((g) => ({ util: 0, memUsedMb: g.usedMb }));
  return [];
}
