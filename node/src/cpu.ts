import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';

type Read = (path: string) => string;
const readText: Read = (p) => readFileSync(p, 'utf8');

/** CPUs the container may actually use: the cgroup quota (`docker --cpus`), else null if unlimited. */
export function cgroupCpuQuota(read: Read = readText): number | null {
  try {
    // cgroup v2: "<quota> <period>" or "max <period>"
    const [q, p] = read('/sys/fs/cgroup/cpu.max').trim().split(/\s+/);
    if (q === 'max') return null;
    const n = Number(q) / Number(p);
    if (n > 0) return n;
  } catch {}
  try {
    const q = Number(read('/sys/fs/cgroup/cpu/cpu.cfs_quota_us').trim());
    const p = Number(read('/sys/fs/cgroup/cpu/cpu.cfs_period_us').trim());
    if (q > 0 && p > 0) return q / p;
  } catch {}
  return null;
}

/**
 * Inference threads to ask Ollama for, or undefined to keep its default. Ollama sizes its thread pool
 * from the cores it can see, which ignores a cgroup quota: `--cpus 2` on an 8-core host still runs 8
 * spinning threads in 2 CPUs of time and decode collapses. `override` is SPINDLE_NUM_THREAD.
 */
export function inferenceThreads(
  override: number | undefined,
  quota: number | null = cgroupCpuQuota(),
  visible: number = availableParallelism(),
): number | undefined {
  if (override) return override;
  if (quota === null) return undefined;
  const n = Math.max(1, Math.floor(quota));
  return n < visible ? n : undefined;
}
