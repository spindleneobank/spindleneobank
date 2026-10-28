import { expect, test } from 'bun:test';
import { cgroupCpuQuota, inferenceThreads } from '../src/cpu';

const files =
  (m: Record<string, string>) =>
  (p: string): string => {
    const v = m[p];
    if (v === undefined) throw new Error('ENOENT');
    return v;
  };

test('cgroup quota: v2, v1 and unlimited', () => {
  expect(cgroupCpuQuota(files({ '/sys/fs/cgroup/cpu.max': '200000 100000\n' }))).toBe(2);
  expect(cgroupCpuQuota(files({ '/sys/fs/cgroup/cpu.max': 'max 100000\n' }))).toBeNull();
  expect(
    cgroupCpuQuota(
      files({
        '/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '150000',
        '/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000',
      }),
    ),
  ).toBe(1.5);
  expect(cgroupCpuQuota(files({}))).toBeNull();
});

test('threads follow the quota or core pin when either is below the host cores', () => {
  expect(inferenceThreads(undefined, 2, 6, 6)).toBe(2); // --cpus 2
  expect(inferenceThreads(undefined, 1.5, 6, 6)).toBe(1);
  expect(inferenceThreads(undefined, 0.5, 6, 6)).toBe(1);
  expect(inferenceThreads(undefined, null, 2, 8)).toBe(2); // --cpuset-cpus 0-1
  expect(inferenceThreads(undefined, 4, 2, 8)).toBe(2); // both: the smaller wins
  expect(inferenceThreads(undefined, 8, 6, 6)).toBeUndefined();
  expect(inferenceThreads(undefined, null, 6, 6)).toBeUndefined();
  expect(inferenceThreads(3, null, 6, 6)).toBe(3);
});
