import { createSiweMessage } from 'viem/siwe';
import { account } from '../../dev/lib/accounts';
import { API, ORIGIN } from './env';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    msg: string,
  ) {
    super(msg);
  }
}

/** Cookie-session client for the dashboard API (SIWE as an anvil account). */
export class Session {
  cookie = '';
  constructor(public index: number) {}
  get acct() {
    return account(this.index);
  }
  get address() {
    return this.acct.address.toLowerCase() as `0x${string}`;
  }
  async req<T = any>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        origin: ORIGIN,
        'x-spindle': '1',
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const kv = c.split(';')[0] as string;
      const name = kv.split('=')[0];
      this.cookie = [...this.cookie.split('; ').filter((x) => x && !x.startsWith(`${name}=`)), kv].join('; ');
    }
    const text = await res.text();
    let json: unknown = text;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok)
      throw new ApiError(res.status, json, `${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    return json as T;
  }
  get = <T = any>(p: string) => this.req<T>('GET', p);
  post = <T = any>(p: string, b: unknown = {}) => this.req<T>('POST', p, b);
  async siwe(statement = 'Sign in to Spindle.') {
    const { nonce } = await this.get<{ nonce: string }>('/v1/auth/nonce');
    const u = new URL(ORIGIN);
    const message = createSiweMessage({
      address: this.acct.address,
      chainId: 4663,
      domain: u.host,
      nonce,
      uri: ORIGIN,
      version: '1',
      statement,
      issuedAt: new Date(),
    });
    const signature = await this.acct.signMessage({ message });
    return { message, signature };
  }
  async login() {
    await this.post('/v1/auth/verify', await this.siwe());
    return this;
  }
  async reauth() {
    return this.post('/v1/auth/reauth', await this.siwe('Confirm a sensitive Spindle action.'));
  }
}
export const login = (i: number) => new Session(i).login();

/** Admin job trigger. */
export const runJob = (s: Session, name: string) => s.post(`/v1/admin/jobs/${name}/run`, {});

/** Bearer-key call (OpenAI-compatible). */
export async function bearer(key: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  // nodes can be briefly busy with a probe/canary: retry NO_CAPACITY for up to 2 minutes
  const end = Date.now() + 120_000;
  for (;;) {
    const r = await raw(key, path, body, extra);
    if (r.status !== 503 || Date.now() > end) return r;
    await new Promise((x) => setTimeout(x, 3000));
  }
}
function raw(key: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  return fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
