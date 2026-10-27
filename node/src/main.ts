import type { HelloBody } from '@spindle/shared/node-protocol';
import pkg from '../package.json';
import { type Config, loadConfig } from './config';
import { NodeConnection } from './connection';
import { createEngine, type Engine } from './engine';
import { detectHardware, readGpuStats } from './hardware';
import { JobRunner } from './jobs';
import { loadOrCreateKey } from './key';
import { createLogger, type Logger } from './log';
import { ModelSync } from './models';
import { ProbeRunner } from './probes';
import { SealedRuntime, sealedEnabled } from './sealed/runtime';

export const AGENT_VERSION: string = pkg.version;

async function waitForEngine(engine: Engine, log: Logger, isStopped: () => boolean): Promise<string> {
  let delay = 1000;
  while (!isStopped()) {
    try {
      return await engine.version();
    } catch (e) {
      log.warn(`engine not reachable yet: ${(e as Error).message}; retrying in ${delay} ms`);
      await Bun.sleep(delay);
      delay = Math.min(delay * 2, 15_000);
    }
  }
  return 'unknown';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--version') || args.includes('-v')) {
    console.log(AGENT_VERSION);
    return;
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      `spindle-node ${AGENT_VERSION}\n\nEnvironment: SPINDLE_API_URL (required), SPINDLE_TOKEN, SPINDLE_DATA_DIR (/data),\nSPINDLE_ENGINE (ollama|vllm), SPINDLE_ENGINE_URL, SPINDLE_VLLM_MODEL, SPINDLE_MODELS, SPINDLE_NAME, LOG_LEVEL`,
    );
    return;
  }

  let config: Config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
  const log = createLogger(config.logLevel);
  log.info(`spindle-node ${AGENT_VERSION} starting (engine=${config.engine})`);
  if (config.devLazy) {
    log.warn('################################################################');
    log.warn('# SPINDLE_DEV_LAZY is ON: chat returns "ok" without running the engine. DEV ONLY.');
    log.warn('################################################################');
  }
  if (config.devFakeGpu)
    log.warn(`SPINDLE_DEV_FAKE_GPU is ON: reporting "${config.devFakeGpu.name}". DEV ONLY.`);

  const key = await loadOrCreateKey(config.dataDir);
  log.info(`node key: ${key.address}`);
  const engine = createEngine(config);
  let stopping = false;
  const engineVersion = await waitForEngine(engine, log, () => stopping);

  let conn: NodeConnection;
  const send = (m: Parameters<NodeConnection['send']>[0]) => conn.send(m);
  // Sealed lane (S1): only inside a dstack CVM (SPINDLE_SEALED=1); the HPKE key is generated here.
  const sealed = sealedEnabled()
    ? await SealedRuntime.create({ nodeKey: key.address, send, log })
    : undefined;
  const runner = new JobRunner({
    engine,
    key,
    send,
    log,
    agentVersion: AGENT_VERSION,
    lazy: config.devLazy,
    ...(sealed ? { sealed } : {}),
  });
  const sync = new ModelSync({ engine, send, log });
  const probes = new ProbeRunner({
    engine,
    send,
    log,
    idle: () => runner.idle(),
    busy: () => runner.busy,
    hardware: () => detectHardware(config.devFakeGpu),
  });

  const buildHello = async (): Promise<HelloBody> => {
    const hardware = await detectHardware(config.devFakeGpu);
    let models: HelloBody['models'] = [];
    try {
      models = (await engine.listModels()).map((m) => ({ id: m.id, digest: m.digest, sizeMb: m.sizeMb }));
    } catch (e) {
      log.warn(`cannot list engine models: ${(e as Error).message}`);
    }
    if (config.models) models = models.filter((m) => config.models?.includes(m.id));
    const contexts: Record<string, number> = {};
    for (const m of models) contexts[m.id] = await engine.contextLength(m.id).catch(() => 4096);
    const hello: HelloBody = {
      v: 1,
      type: 'hello',
      nodeKey: key.address,
      publicKey: key.publicKey,
      agentVersion: AGENT_VERSION,
      engine: engine.kind,
      engineVersion,
      os: process.platform,
      arch: process.arch,
      hardware,
      models,
      capabilities: engine.images ? ['chat', 'embeddings', 'images'] : ['chat', 'embeddings'],
      capacity: 1,
      ...(Object.keys(contexts).length ? { contexts } : {}),
    };
    if (config.token) hello.enrollToken = config.token;
    if (sealed) hello.attestation = await sealed.attestForHello();
    return hello;
  };

  const shutdown = async (code: number) => {
    if (stopping) return;
    stopping = true;
    log.info('shutting down');
    const t = setTimeout(() => runner.abortCurrent(), 10_000);
    await Promise.race([runner.idle(), Bun.sleep(10_500)]);
    clearTimeout(t);
    runner.abortCurrent();
    conn.stop(1000, 'shutdown');
    process.exit(code);
  };

  conn = new NodeConnection({
    url: `${config.apiUrl.replace(/\/$/, '')}/v1/node/ws`,
    key,
    log,
    buildHello,
    getStatus: async () => ({
      state: runner.busy ? 'busy' : sync.loading ? 'loading' : 'idle',
      gpus: await readGpuStats(),
      loadedModels: [...sync.ready.keys()],
      queue: 0,
    }),
    onFatal: (code) => void shutdown(code),
    handlers: {
      onWelcome: (w) => {
        void Bun.write('/tmp/spindle-ready', new Date().toISOString()); // docker HEALTHCHECK
        const wanted = config.models
          ? w.catalog.filter((m) => config.models?.includes(m.engineModel))
          : w.catalog;
        if (wanted.length) void sync.ensure(wanted);
      },
      // SPINDLE_MODELS restricts what this node pulls, for models.ensure pushes as well as the welcome catalog
      onModelsEnsure: (m) =>
        void sync.ensure(
          config.models ? m.models.filter((x) => config.models?.includes(x.engineModel)) : m.models,
        ),
      onJobStart: (m) =>
        void probes.gate(5000).then((ok) => {
          // a job never overlaps a probe: defer up to 5 s, else BUSY
          if (ok) return runner.start(m);
          send({ v: 1, type: 'job.error', jobId: m.jobId, code: 'BUSY', message: 'node is running a probe' });
        }),
      onJobCancel: (m) => runner.cancel(m.jobId),
      onProbeStart: (m) => void probes.handle(m),
    },
  });

  process.on('SIGTERM', () => void shutdown(0));
  process.on('SIGINT', () => void shutdown(0));
  conn.start();
  sealed?.startRefresh();
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`fatal: ${(e as Error).message}`);
    process.exit(1);
  });
}
