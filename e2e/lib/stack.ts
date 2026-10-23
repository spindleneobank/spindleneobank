// Stack preparation: health, optional dev:reset + bootstrap, house node (enroll, start, register, mark house).
import { $ } from 'bun';
import { login, runJob } from './api';
import { mine, rpc, sleep, syncTime, until } from './chain';
import { API, REPO } from './env';
import { nodeHasEnv, removeNode, startNode } from './node';
import { registerNode } from './onchain';

const sh = async (cmd: string) => (await $`sh -c ${cmd}`.quiet().nothrow()).stdout.toString();

export async function waitHealthy(ms = 180_000) {
  await until(
    async () => {
      const r = await fetch(`${API}/v1/health`).catch(() => null);
      return r?.ok ? true : undefined;
    },
    ms,
    2000,
  );
}

/** `bun run dev:reset && bun run dev:bootstrap` equivalent (wipes volumes). */
export async function resetStack() {
  const run = async (c: string) => {
    const p = Bun.spawn(['sh', '-c', c], {
      cwd: REPO,
      stdout: 'inherit',
      stderr: 'inherit',
      env: process.env,
    });
    if ((await p.exited) !== 0) throw new Error(`failed: ${c}`);
  };
  await run('bun run dev:reset');
  await waitHealthy();
  for (const n of ['house-node', 'e2e-a', 'e2e-lazy', 'e2e-gpu', 'e2e-pair'])
    await sh(`sudo docker rm -f ${n.startsWith('e2e') ? `e2e-node-${n}` : `spindle-dev-${n}`} 2>&1`);
}

const HOUSE = 'spindle-dev-house-node';
/** Idempotent house node: container up, enrolled to account 0, registered on-chain, marked house. */
export async function ensureHouse(log: (m: string) => void = () => {}) {
  await waitHealthy();
  await syncTime();
  const s = await login(0);
  let n = (await s.get('/v1/app/nodes')).find((x: any) => x.name === 'house');
  const running = (await sh(`sudo docker ps -q -f name=^${HOUSE}$`)).trim();
  if (!n || !running) {
    await sh(`sudo docker rm -f ${HOUSE}`);
    let token = '';
    if (!n) {
      const e = await s.post('/v1/app/nodes/enroll', { engine: 'ollama', os: 'linux', name: 'house' });
      token = e.token;
    }
    const tok = token ? `-e SPINDLE_TOKEN='${token}'` : '';
    await sh(
      `sudo docker run -d --name ${HOUSE} --network spindle-dev_default -v spindle-dev_house-node:/data -e SPINDLE_API_URL=ws://api:8080 -e SPINDLE_ENGINE=ollama -e SPINDLE_MODELS=qwen2.5:0.5b,nomic-embed-text ${tok} spindle-node:ollama-local`,
    );
    log('house node container started');
  }
  n = await until(
    async () => (await s.get('/v1/app/nodes')).find((x: any) => x.name === 'house' && x.status === 'online'),
    180_000,
    2000,
  );
  if (!n.registered) {
    try {
      await registerNode(s, n.id);
    } catch (e) {
      log(`register: ${String((e as Error).message).slice(0, 80)}`);
    }
    n = await until(
      async () => {
        await mine(14);
        await runJob(s, 'indexer').catch(() => {});
        await sleep(2500);
        return (await s.get('/v1/app/nodes')).find((x: any) => x.id === n.id && x.registered);
      },
      120_000,
      1000,
    );
  }
  await s.post(`/v1/admin/nodes/${n.id}/house`, { isHouse: true });
  await until(
    async () =>
      ((await (await fetch(`${API}/v1/models`)).json()) as any).data.some(
        (m: any) => m.id === 'qwen2.5:0.5b' && m.available,
      ),
    180_000,
    3000,
  );
  log(`house node ${n.id} registered, is_house, qwen2.5:0.5b listed`);
  return n;
}

/** The runner needs the dev flags in the node image; otherwise scenarios 10/11 are "harness flag missing". */
export async function checkDevFlags(): Promise<boolean> {
  const f = await Bun.file(`${REPO}/node/src/config.ts`).text();
  return f.includes('SPINDLE_DEV_LAZY') && f.includes('SPINDLE_DEV_FAKE_GPU');
}
export { nodeHasEnv, removeNode, rpc, startNode };
