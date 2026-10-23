import { CTA } from '../../components/CTA';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { formatCents } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { StatusPill } from '../../components/StatusPill';
import { fmtTime, RowTable } from '../shell/ui';
import { friendlyError } from './logic';
import { useCardTransactions } from './queries';

export function Transactions({ cardId }: { cardId: string }) {
  const q = useCardTransactions(cardId, true);
  if (q.isPending) return <Skeleton height={120} />;
  if (q.isError) {
    return (
      <ErrorState
        title="Transactions unavailable"
        message={friendlyError(q.error)}
        onRetry={() => void q.refetch()}
      />
    );
  }
  const rows = q.data.pages.flatMap((p) => p.items);
  if (rows.length === 0) {
    return (
      <EmptyState icon="receipt" title="No transactions yet">
        Purchases and top-ups show up here.
      </EmptyState>
    );
  }
  return (
    <>
      <RowTable
        caption="Card transactions"
        template="1.6fr 1fr 1fr 1.2fr"
        rows={rows}
        rowKey={(r) => r.id}
        cols={[
          { key: 'm', header: 'Merchant', render: (r) => <strong>{r.merchant ?? 'Top-up'}</strong> },
          {
            key: 'a',
            header: 'Amount',
            render: (r) =>
              `${r.amountCents.startsWith('-') ? '-' : '+'}$${formatCents(r.amountCents.replace('-', ''))}`,
          },
          {
            key: 's',
            header: 'Status',
            render: (r) => (
              <StatusPill tone={r.status === 'settled' ? 'ok' : r.status === 'declined' ? 'danger' : 'warn'}>
                {r.status}
              </StatusPill>
            ),
          },
          { key: 'd', header: 'Date', render: (r) => fmtTime(r.occurredAt) },
        ]}
      />
      {q.hasNextPage ? (
        <div className="sd-actions-row">
          <CTA
            variant="secondary"
            icon=""
            disabled={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </CTA>
        </div>
      ) : null}
    </>
  );
}
