// Direct SQL against the dev Postgres via docker exec (E2E fixtures only: backdating, fault setup, assertions).
import { $ } from 'bun';
import { vars } from './env';

export async function psql(query: string): Promise<string> {
  const u = vars.POSTGRES_USER;
  const d = vars.POSTGRES_DB;
  if (!u || !d) throw new Error('POSTGRES_USER/POSTGRES_DB missing');
  const r = await $`sudo docker exec -i spindle-dev-postgres-1 psql -U ${u} -d ${d} -tA -F ${'|'} -c ${query}`.quiet().nothrow();
  if (r.exitCode !== 0) throw new Error(`psql: ${r.stderr.toString().slice(0, 300)}`);
  return r.stdout.toString().trim();
}
export const rows = async (q: string) => (await psql(q)).split('\n').filter(Boolean).map((l) => l.split('|'));
