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
  const runner = new JobRunner({
    engine,
    key,
    send,
    log,
    agentVersion: AGENT_VERSION,
    lazy: config.devLazy,
  });
  const sync = new ModelSync({ engine, send, log });

  const buildHello = async (): Promise<HelloBody> => {
    const hardware = await detectHardware(config.devFakeGpu);
    let models: HelloBody['models'] = [];
    try {
      models = (await engine.listModels()).map((m) => ({ id: m.id, digest: m.digest, sizeMb: m.sizeMb }));
    } catch (e) {
      log.warn(`cannot list engine models: ${(e as Error).message}`);
    }
    if (config.models) models = models.filter((m) => config.models?.includes(m.id));
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
    };
    if (config.token) hello.enrollToken = config.token;
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
        const wanted = config.models
          ? w.catalog.filter((m) => config.models?.includes(m.engineModel))
          : w.catalog;
        if (wanted.length) void sync.ensure(wanted);
      },
      onModelsEnsure: (m) => void sync.ensure(m.models),
      onJobStart: (m) => void runner.start(m),
      onJobCancel: (m) => runner.cancel(m.jobId),
      onProbeStart: () => log.debug('probe.start ignored (not implemented in N1)'),
    },
  });

  process.on('SIGTERM', () => void shutdown(0));
  process.on('SIGINT', () => void shutdown(0));
  conn.start();
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`fatal: ${(e as Error).message}`);
    process.exit(1);
  });
}
