import type { z } from 'zod';
import { parseError } from '../../api/client';
import { ApiError } from '../../api/errors';
import { mockFetch } from '../../api/mock/mock';
import { env } from '../../env';

/**
 * Fetch for `/v1/x402/*`. These routes authenticate by signature or `X-Spindle-Session`, never the dashboard
 * cookie, so credentials are omitted. Mock mode resolves from fixtures like `apiFetch`.
 */
export async function x402Fetch<S extends z.ZodType>(
  path: string,
  opts: { schema: S; method?: 'GET' | 'POST'; body?: unknown; token?: string; signal?: AbortSignal },
): Promise<z.infer<S>> {
  const method = opts.method ?? 'GET';
  let data: unknown;
  if (env.mock) {
    data = await mockFetch(method, path, { ...((opts.body as object) ?? {}), __token: opts.token });
  } else {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (method !== 'GET') headers['x-spindle'] = '1';
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.token) headers['X-Spindle-Session'] = opts.token;
    const res = await fetch(`${env.apiUrl}${path}`, {
      method,
      headers,
      credentials: 'omit',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
    if (!res.ok) throw await parseError(res);
    data = await res.json();
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
