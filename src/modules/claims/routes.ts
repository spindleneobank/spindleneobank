import type { Hono } from 'hono';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { GetClaimsReq } from '../../shared/api/earnings';
import { requireSession } from '../auth/middleware';
import { getProof, listClaims } from './service';

export default function claimsRoutes(app: Hono<Env>): void {
  const me = (c: { get: (k: 'user') => { address: string } | undefined }) => {
    const a = c.get('user')?.address;
    if (!a) throw new AppError('UNAUTHENTICATED', 'Please sign in with your wallet.');
    return a;
  };

  app.get('/v1/app/claim/proof', requireSession, async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await getProof(me(c)));
  });

  app.get('/v1/app/claims', requireSession, async (c) => {
    const parsed = GetClaimsReq.safeParse(c.req.query());
    if (!parsed.success) throw new AppError('VALIDATION', 'Invalid query.', 400, parsed.error.issues);
    return c.json(await listClaims(me(c), parsed.data));
  });
}
