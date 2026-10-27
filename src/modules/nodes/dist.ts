import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { Hono } from 'hono';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { clientIp, rateLimit } from '../../lib/ratelimit';
import { isValidDownloadToken } from './enroll';
import { nodeSettings } from './service';

/**
 * Node distribution (built by `bun run node:dist`): installers, manifest and per-(engine, arch) docker build
 * contexts holding our compiled agent. We never publish an image; testers build it locally on the pinned
 * official base images.
 */

const ENGINES = ['ollama', 'vllm'] as const;
const ARCHES = ['amd64', 'arm64'] as const;
const PLACEHOLDER = '__SPINDLE_API_URL__';

const distRoot = () =>
  isAbsolute(nodeSettings.distDir) ? nodeSettings.distDir : resolve(nodeSettings.distDir);

function distFile(rel: string): string {
  const p = join(distRoot(), rel);
  if (!existsSync(p)) {
    throw new AppError(
      'NOT_FOUND',
      'The node distribution is not built on this server yet (run `bun run node:dist`).',
    );
  }
  return p;
}

/** The scripts learn their API origin from the URL they were fetched from: we template ours in. */
export function templateScript(src: string, apiUrl: string): string {
  return src.replaceAll(PLACEHOLDER, apiUrl);
}

const downloadLimit = rateLimit({ name: 'node_dist', key: (c) => clientIp(c), points: 30, windowSec: 600 });
const scriptLimit = rateLimit({ name: 'node_script', key: (c) => clientIp(c), points: 120, windowSec: 600 });

function bearer(authorization: string | undefined): string {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  return m?.[1] ?? '';
}

export default function nodeDistRoutes(app: Hono<Env>): void {
  const script =
    (name: 'install.sh' | 'install.ps1', type: string) => async (c: import('hono').Context<Env>) => {
      const src = readFileSync(distFile(name), 'utf8');
      c.header('cache-control', 'no-store');
      return c.body(templateScript(src, nodeSettings.apiUrl), 200, { 'content-type': type });
    };
  app.get('/v1/node/install.sh', scriptLimit, script('install.sh', 'text/x-shellscript; charset=utf-8'));
  app.get('/v1/node/install.ps1', scriptLimit, script('install.ps1', 'text/plain; charset=utf-8'));

  app.get('/v1/node/dist/manifest.json', scriptLimit, async (c) => {
    c.header('cache-control', 'no-store');
    return c.body(readFileSync(distFile('manifest.json'), 'utf8'), 200, {
      'content-type': 'application/json; charset=utf-8',
    });
  });

  app.get('/v1/node/dist/:engine/:arch/context.tar.gz', downloadLimit, async (c) => {
    const engine = c.req.param('engine') as (typeof ENGINES)[number];
    const arch = c.req.param('arch') as (typeof ARCHES)[number];
    if (!ENGINES.includes(engine) || !ARCHES.includes(arch)) {
      throw new AppError('NOT_FOUND', 'Unknown engine or architecture.');
    }
    const token = bearer(c.req.header('authorization'));
    if (!token || !(await isValidDownloadToken(token))) {
      throw new AppError(
        'UNAUTHENTICATED',
        'A valid enrollment or update token is required. Generate a fresh command in the dashboard (Compute tab).',
      );
    }
    const path = distFile(`${engine}/${arch}/context.tar.gz`);
    const file = Bun.file(path);
    return new Response(file, {
      headers: {
        'content-type': 'application/gzip',
        'content-length': String(file.size),
        'content-disposition': `attachment; filename="spindle-node-${engine}-${arch}.tar.gz"`,
        'cache-control': 'private, no-store',
      },
    });
  });
}
