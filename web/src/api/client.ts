import type { z } from 'zod';
import { env } from '../env';
import { ApiError, type ApiMethod } from './errors';
import { mockFetch } from './mock/mock';

export interface ApiOptions<S extends z.ZodType> {
  schema: S;
  method?: ApiMethod;
  body?: unknown;
  signal?: AbortSignal;
}

export async function parseError(res: Response): Promise<ApiError> {
  let code = 'INTERNAL';
  let message = res.statusText || 'Request failed';
  let details: unknown;
  try {
    const json = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } };
    if (json.error) {
      code = json.error.code ?? code;
      message = json.error.message ?? message;
      details = json.error.details;
    }
  } catch {
    // non-JSON error body: keep defaults
  }
  return new ApiError(code, message, res.status, details);
}

/**
 * Typed fetch over the shared zod schemas. Always `credentials: 'include'`; non-GET adds `x-spindle: 1`.
 * With VITE_API_MOCK=1 resolves from src/api/mock fixtures instead of the network.
 */
export async function apiFetch<S extends z.ZodType>(path: string, opts: ApiOptions<S>): Promise<z.infer<S>> {
  const method = opts.method ?? 'GET';
  let data: unknown;
  if (env.mock) {
    data = await mockFetch(method, path, opts.body);
  } else {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (method !== 'GET') headers['x-spindle'] = '1';
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${env.apiUrl}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
    if (!res.ok) throw await parseError(res);
    data = res.status === 204 ? undefined : await res.json();
  }
  const parsed = opts.schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(
      'INTERNAL',
      `Unexpected response shape for ${method} ${path}`,
      500,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

/** Re-sign (via `reauth`) once and retry when the API answers REAUTH_REQUIRED. */
export async function withReauth<T>(fn: () => Promise<T>, reauth: () => Promise<void>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'REAUTH_REQUIRED') throw error;
    await reauth();
    return fn();
  }
}

export { ApiError, type ApiMethod };
