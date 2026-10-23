import { useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { Money } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { StatusPill } from '../../components/StatusPill';
import { Boundary, RowTable } from '../shell/ui';
import { type Range, useBuyerUsage } from './queries';

const RANGES: Range[] = ['7d', '30d', '90d'];

function SpendChart({ series }: { series: { ts: string; spentMicros: string }[] }) {
  const max = series.reduce((m, p) => (BigInt(p.spentMicros) > m ? BigInt(p.spentMicros) : m), 1n);
  const w = 100 / series.length;
  return (
    <svg
      className="dv-chart"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Daily spend, ${series.length} data points`}
    >
      {series.map((p, i) => {
        const h = Math.max(0.5, Number((BigInt(p.spentMicros) * 3600n) / max) / 100);
        return <rect key={p.ts} x={i * w + w * 0.15} y={40 - h} width={w * 0.7} height={h} />;
      })}
    </svg>
  );
}

export function Usage() {
  const [range, setRange] = useState<Range>('30d');
  const usage = useBuyerUsage(range);
  return (
    <section className="sd-box dv-usage">
      <div className="sd-box-top">
        <div>
          <span className="sd-eyebrow">WHAT YOU SPENT</span>
          <h2>Usage</h2>
        </div>
        <div className="sd-seg" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>
      <Boundary query={usage} title="Usage" skeleton={<Skeleton height={200} />}>
        {(u) =>
          u.byModel.length === 0 ? (
            <EmptyState icon="stack" title="No usage in this range">
              Calls made with your API keys or x402 will show up here.
            </EmptyState>
          ) : (
            <>
              {u.series.length > 0 ? <SpendChart series={u.series} /> : null}
              <RowTable
                caption="Usage by model and lane"
                rows={u.byModel}
                rowKey={(r) => `${r.model}:${r.lane}`}
                template="1.6fr 0.8fr 0.7fr 0.8fr 1fr"
                cols={[
                  { key: 'model', header: 'Model', render: (r) => <strong>{r.model}</strong> },
                  {
                    key: 'lane',
                    header: 'Lane',
                    render: (r) => (
                      <StatusPill tone={r.lane === 'sealed' ? 'ok' : 'neutral'}>{r.lane}</StatusPill>
                    ),
                  },
                  {
                    key: 'jobs',
                    header: 'Jobs',
                    align: 'right',
                    render: (r) => r.jobs.toLocaleString('en-US'),
                  },
                  { key: 'units', header: 'Units', align: 'right', render: (r) => r.units },
                  {
                    key: 'spent',
                    header: 'Spent',
                    align: 'right',
                    render: (r) => <Money micros={r.spentMicros} />,
                  },
                ]}
              />
            </>
          )
        }
      </Boundary>
    </section>
  );
}
