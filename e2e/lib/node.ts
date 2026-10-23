// Extra CPU node containers from the local image on the dev compose network.
import { $ } from 'bun';
import type { Session } from './api';
import { sleep, until } from './chain';

export const IMAGE = process.env.E2E_NODE_IMAGE ?? 'spindle-node:ollama-local';
const NETWORK = process.env.E2E_NETWORK ?? 'spindle-dev_default';
const sh = async (cmd: string) =>
  (await $`sh -c ${`sudo docker ${cmd}`}`.quiet().nothrow()).stdout.toString();

export type StartOpts = {
  name: string;
  token?: string;
  models?: string;
  env?: Record<string, string>;
};
export const containerName = (n: string) => `e2e-node-${n}`;

export async function startNode(o: StartOpts) {
  const c = containerName(o.name);
  await removeNode(o.name, true);
  const env = {
    SPINDLE_API_URL: 'ws://api:8080',
    SPINDLE_ENGINE: 'ollama',
    SPINDLE_MODELS: o.models ?? 'qwen2.5:0.5b,nomic-embed-text',
    SPINDLE_NAME: o.name,
    ...(o.token ? { SPINDLE_TOKEN: o.token } : {}),
    ...o.env,
  };
  const e = Object.entries(env)
    .map(([k, v]) => `-e ${k}='${v}'`)
    .join(' ');
  const out = await sh(`run -d --name ${c} --network ${NETWORK} -v ${c}:/data ${e} ${IMAGE}`);
  if (!/^[0-9a-f]{12,}/.test(out.trim())) throw new Error(`docker run failed: ${out}`);
  return c;
}
export async function removeNode(name: string, keepVolume = false) {
  const c = containerName(name);
  await sh(`rm -f ${c}`);
  if (!keepVolume) await sh(`volume rm -f ${c}`);
}
export const nodeLogs = (name: string) => sh(`logs ${containerName(name)} 2>&1`);
export const nodeHasEnv = async (name: string, flag: string) =>
  (await sh(`exec ${containerName(name)} env`)).includes(flag);

/** Enroll with a token and start the node; resolves when the API lists it online. */
export async function enrollAndStart(s: Session, o: Omit<StartOpts, 'token'>) {
  const e = await s.post('/v1/app/nodes/enroll', { engine: 'ollama', os: 'linux', name: o.name });
  await startNode({ ...o, token: e.token });
  return waitNode(s, o.name);
}
export async function waitNode(s: Session, name: string, status = 'online', ms = 120_000) {
  return until(
    async () => {
      const list = await s.get('/v1/app/nodes');
      return list.find((n: any) => n.name === name && n.status === status);
    },
    ms,
    2000,
  );
}
export async function pairingCode(name: string, ms = 90_000) {
  return until(
    async () => {
      const m = /Code: ([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(await nodeLogs(name));
      return m?.[1];
    },
    ms,
    2000,
  );
}
export { sleep };
