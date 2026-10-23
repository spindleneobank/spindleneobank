import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeriesChart } from '../index';

afterEach(() => vi.restoreAllMocks());

const bucket = (ts: string, job = '2000000') => ({ ts, jobMicros: job, floorMicros: '0', slashMicros: '0' });

describe('SeriesChart keys', () => {
  it.each([
    ['one bucket', [bucket('2026-10-23T00:00:00.000Z')]],
    ['two buckets', [bucket('2026-10-22T00:00:00.000Z'), bucket('2026-10-23T00:00:00.000Z')]],
    ['tiny max', [bucket('2026-10-23T00:00:00.000Z', '1')]],
  ])('renders %s without duplicate React keys', (_n, buckets) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<SeriesChart buckets={buckets} />);
    const dup = err.mock.calls.filter((c) => String(c[0]).includes('same key'));
    expect(dup).toHaveLength(0);
  });
});
