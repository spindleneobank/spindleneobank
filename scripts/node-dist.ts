#!/usr/bin/env bun
/**
 * Builds the node distribution served by the API (`GET /v1/node/dist/...`).
 *
 *   bun run node:dist [--out <dir>] [--engine ollama,vllm] [--arch amd64,arm64]
 *
 * Output (default NODE_DIST_DIR or data/node-dist):
 *   manifest.json                         agent version + sha256/size of every context tarball
 *   install.sh, install.ps1               the installers (the API templates its own URL into them)
 *   <engine>/<arch>/context.tar.gz        docker build context: spindle-node, entrypoint.sh, Dockerfile
 *
 * The Dockerfile in each context IS node/docker/Dockerfile.<engine> (the single source of the pinned base
 * images). Testers `docker build` it locally; we never publish an image.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const APP = resolve(dirname(import.meta.path), '..');
const NODE_DIR = join(APP, 'node');

type Engine = 'ollama' | 'vllm';
type Arch = 'amd64' | 'arm64';
const BUN_TARGET: Record<Arch, string> = { amd64: 'bun-linux-x64', arm64: 'bun-linux-arm64' };
/** vllm images are amd64 only. */
const SUPPORTED: Record<Engine, Arch[]> = { ollama: ['amd64', 'arm64'], vllm: ['amd64'] };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function sh(cmd: string[], cwd?: string): void {
  const r = Bun.spawnSync(cmd, { cwd, stdout: 'inherit', stderr: 'inherit' });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(' ')} failed (${r.exitCode})`);
}

const sha256File = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

const out = resolve(arg('out') ?? process.env.NODE_DIST_DIR ?? join(APP, 'data/node-dist'));
const engines = (arg('engine')?.split(',') ?? ['ollama', 'vllm']) as Engine[];
const archFilter = arg('arch')?.split(',') as Arch[] | undefined;
for (const e of engines) if (!SUPPORTED[e]) throw new Error(`unknown engine ${e}`);

const version = JSON.parse(readFileSync(join(NODE_DIR, 'package.json'), 'utf8')).version as string;
mkdirSync(out, { recursive: true });
const work = join(out, '.work');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const binaries = new Map<Arch, string>();
function binary(arch: Arch): string {
  let p = binaries.get(arch);
  if (!p) {
    p = join(work, `spindle-node-${arch}`);
    console.log(`compiling agent ${version} for ${arch} (${BUN_TARGET[arch]})`);
    sh(
      [
        'bun',
        'build',
        'src/main.ts',
        '--compile',
        '--minify',
        `--target=${BUN_TARGET[arch]}`,
        '--outfile',
        p,
      ],
      NODE_DIR,
    );
    binaries.set(arch, p);
  }
  return p;
}

const contexts: Record<string, { engine: Engine; arch: Arch; path: string; sha256: string; size: number }> =
  {};
for (const engine of engines) {
  for (const arch of SUPPORTED[engine]) {
    if (archFilter && !archFilter.includes(arch)) continue;
    const dir = join(work, `ctx-${engine}-${arch}`);
    mkdirSync(dir, { recursive: true });
    copyFileSync(binary(arch), join(dir, 'spindle-node'));
    copyFileSync(join(NODE_DIR, 'docker/entrypoint.sh'), join(dir, 'entrypoint.sh'));
    copyFileSync(join(NODE_DIR, `docker/Dockerfile.${engine}`), join(dir, 'Dockerfile'));
    const rel = `${engine}/${arch}/context.tar.gz`;
    const dest = join(out, rel);
    mkdirSync(dirname(dest), { recursive: true });
    // Deterministic tar (sorted, no owner/mtime) piped through gzip -n.
    sh([
      'sh',
      '-c',
      `tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -C '${dir}' -cf - Dockerfile entrypoint.sh spindle-node | gzip -n -6 > '${dest}'`,
    ]);
    contexts[`${engine}/${arch}`] = {
      engine,
      arch,
      path: rel,
      sha256: sha256File(dest),
      size: statSync(dest).size,
    };
    console.log(
      `  ${rel}  ${(statSync(dest).size / 1e6).toFixed(1)} MB  sha256 ${contexts[`${engine}/${arch}`]?.sha256}`,
    );
  }
}

for (const f of ['install.sh', 'install.ps1']) {
  if (existsSync(join(NODE_DIR, f))) copyFileSync(join(NODE_DIR, f), join(out, f));
}
writeFileSync(
  join(out, 'manifest.json'),
  `${JSON.stringify({ agentVersion: version, builtAt: new Date().toISOString(), contexts }, null, 2)}\n`,
);
rmSync(work, { recursive: true, force: true });
console.log(`node dist ${version} written to ${out}`);
