import { ApiError, type ApiMethod } from '../errors';
import { fixtures } from './fixtures';

export type MockMode = 'normal' | 'error' | 'empty';

export interface MockContext {
  mode: MockMode;
  body: unknown;
  params: Record<string, string>;
  query: URLSearchParams;
}
export type MockHandler = (ctx: MockContext) => unknown | Promise<unknown>;
export type MockFixtures = Record<string, MockHandler>;

function currentMode(): MockMode {
  if (typeof window === 'undefined') return 'normal';
  const m = new URLSearchParams(window.location.search).get('mock');
  return m === 'error' || m === 'empty' ? m : 'normal';
}

function match(pattern: string, method: string, path: string): Record<string, string> | null {
  const [pm, pp] = pattern.split(' ') as [string, string];
  if (pm !== method) return null;
  const a = pp.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const seg = a[i] as string;
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(b[i] as string);
    else if (seg !== b[i]) return null;
  }
  return params;
}

const latency = () => (import.meta.env.MODE === 'test' ? 0 : 120 + Math.random() * 240);

/**
 * Resolves `METHOD /path` against fixtures. `?mock=error` on the page URL makes non-auth calls fail with
 * INTERNAL 500; `?mock=empty` passes mode 'empty' to handlers so they return empty lists/states.
 */
export async function mockFetch(method: ApiMethod, rawPath: string, body: unknown): Promise<unknown> {
  const [path = '', qs = ''] = rawPath.split('?');
  const mode = currentMode();
  const delay = latency();
  if (delay) await new Promise((r) => setTimeout(r, delay));
  for (const [pattern, handler] of Object.entries(fixtures)) {
    const params = match(pattern, method, path);
    if (!params) continue;
    if (mode === 'error' && !path.startsWith('/v1/auth/')) {
      throw new ApiError('INTERNAL', 'Mock error (?mock=error)', 500);
    }
    return handler({ mode, body, params, query: new URLSearchParams(qs) });
  }
  throw new ApiError('NOT_FOUND', `No mock fixture for ${method} ${path}`, 404);
}
