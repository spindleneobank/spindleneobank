import { CTA } from '../../components/CTA';
import { EmptyState } from '../../components/EmptyState';
import { Money } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { StatusPill } from '../../components/StatusPill';
import { explorerTx } from '../../config';
import { Boundary, fmtTime, RowTable, shortHash } from '../shell/ui';
import { useBuyerLedger } from './queries';

const TONE = { deposit: 'ok', charge: 'neutral', refund: 'warn', adjust: 'neutral' } as const;

export function Ledger() {
  const q = useBuyerLedger();
  return (
    <section className="sd-box dv-ledger">
      <div className="sd-box-top">
        <div>
          <span className="sd-eyebrow">EVERY MOVEMENT</span>
          <h2>Ledger</h2>
        </div>
      </div>
      <Boundary query={q} title="Ledger" skeleton={<Skeleton height={200} />}>
        {(data) => {
          const items = data.pages.flatMap((p) => p.items);
          if (items.length === 0)
            return (
              <EmptyState icon="ledger" title="No balance activity yet">
                Deposits, charges and refunds will be listed here.
              </EmptyState>
            );
          return (
            <>
              <RowTable
                caption="Buyer ledger"
                rows={items}
                rowKey={(r) => r.id}
                template="0.8fr 1fr 1.4fr 1fr"
                cols={[
                  {
                    key: 'kind',
                    header: 'Type',
                    render: (r) => <StatusPill tone={TONE[r.kind]}>{r.kind}</StatusPill>,
                  },
                  { key: 'when', header: 'Date', render: (r) => fmtTime(r.createdAt) },
                  {
                    key: 'ref',
                    header: 'Reference',
                    render: (r) =>
                      r.txHash ? (
                        <a href={explorerTx(r.txHash)} target="_blank" rel="noreferrer noopener">
                          <code>{shortHash(r.txHash)}</code>
                        </a>
                      ) : r.jobId ? (
                        <code>job {r.jobId.slice(0, 8)}</code>
                      ) : (
                        '—'
                      ),
                  },
                  {
                    key: 'amt',
                    header: 'Amount',
                    align: 'right',
                    render: (r) => <Money micros={r.micros} />,
                  },
                ]}
              />
              {q.hasNextPage ? (
                <CTA
                  variant="secondary"
                  icon=""
                  disabled={q.isFetchingNextPage}
                  onClick={() => void q.fetchNextPage()}
                >
                  {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </CTA>
              ) : null}
            </>
          );
        }}
      </Boundary>
    </section>
  );
}
