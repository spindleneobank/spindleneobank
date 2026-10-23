import type { Hono } from 'hono';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import {
  GetEarningsLedgerReq,
  GetEarningsSeriesReq,
  GetEarningsStatementReq,
} from '../../shared/api/earnings';
import { requireSession } from '../auth/middleware';
import { earningsLedger, earningsSeries, earningsSummary, statementCsv } from './service';

function parse<T>(r: { success: true; data: T } | { success: false; error: { issues: unknown[] } }): T {
  if (!r.success) throw new AppError('VALIDATION', 'Invalid query.', 400, r.error.issues);
  return r.data;
}

export default function earningsRoutes(app: Hono<Env>): void {
  const me = (c: { get: (k: 'user') => { address: string } | undefined }) => {
    const a = c.get('user')?.address;
    if (!a) throw new AppError('UNAUTHENTICATED', 'Please sign in with your wallet.');
    return a;
  };

  app.get('/v1/app/earnings/summary', requireSession, async (c) => c.json(await earningsSummary(me(c))));

  app.get('/v1/app/earnings/series', requireSession, async (c) => {
    const q = parse(GetEarningsSeriesReq.safeParse(c.req.query()));
    return c.json(await earningsSeries(me(c), q.range));
  });

  app.get('/v1/app/earnings/ledger', requireSession, async (c) => {
    const q = parse(GetEarningsLedgerReq.safeParse(c.req.query()));
    return c.json(await earningsLedger(me(c), q));
  });

  app.get('/v1/app/earnings/statement.csv', requireSession, async (c) => {
    const q = parse(GetEarningsStatementReq.safeParse(c.req.query()));
    const from = q.from ? new Date(q.from) : undefined;
    const to = q.to ? new Date(q.to) : undefined;
    const csv = await statementCsv(me(c), from, to);
    return c.body(csv, 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="spindle-statement.csv"',
    });
  });
}
