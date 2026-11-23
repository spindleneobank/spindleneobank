/**
 * Post-build: writes dist/client/build.json with a short id of the git commit this build came from, so a deploy can be
 * confirmed from outside. The id is the first 16 hex chars of sha256(commit); the commit itself is not published.
 * The commit comes from VERCEL_GIT_COMMIT_SHA on Vercel, otherwise from `git rev-parse HEAD`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

function commit(): string | null {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const sha = commit();
const build = sha ? createHash('sha256').update(sha).digest('hex').slice(0, 16) : 'unknown';
writeFileSync(
  join(import.meta.dirname, '..', 'dist', 'client', 'build.json'),
  `${JSON.stringify({ build })}\n`,
);
console.log(`build.json: ${build}`);
