import { config, secrets } from '../config';
import { AppError } from './errors';
import { logger } from './logger';

type EndpointKind = 'alchemy' | 'public' | 'rpc';
type Endpoint = {
  id: string;
  url: string;
  kind: EndpointKind;
  coolUntil: number;
  failures: number;
};

export type RpcOptions = {
  alchemyOnly?: boolean;
  publicOnly?: boolean;
  timeoutMs?: number;
  beforeAttempt?: () => Promise<void>;
};
export type RpcPoolConfig = {
  /** Explicit ordered endpoints (RPC_URLS). When non-empty (dev), only these are used: no Alchemy, no public RPC. */
  rpcUrls?: string[];
  alchemyUrls?: string[];
  publicUrl?: string;
  /** Test seam. */
  fetchImpl?: typeof fetch;
};
export type EndpointStatus = { id: string; kind: EndpointKind; coolingForMs: number; failures: number };
export type RpcEndpointDiagnostic = { id: string; ok: boolean; latencyMs: number | null };
export type EndpointCheck = {
  id: string;
  chainId: string | null;
  latestBlock?: string | null;
  multicall3Code?: boolean | null;
};

const MAX_ATTEMPTS = 4;
const DEFAULT_TIMEOUT_MS = 10_000;
const UPSTREAM_MESSAGE = 'The network is not responding. Please try again shortly.';
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

export class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

class RetryableFailure extends Error {
  constructor(public category: string) {
    super(category);
    this.name = 'RetryableFailure';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLogRangeLimit(endpoint: Endpoint, method: string, error: unknown): boolean {
  if (endpoint.kind !== 'alchemy' || method !== 'eth_getLogs' || !isRecord(error)) return false;
  if (error.code !== -32600 && error.code !== -32602) return false;
  return (
    typeof error.message === 'string' &&
    /block range/i.test(error.message) &&
    /free tier|tier plan|up to a?\s*\d+|range limit/i.test(error.message)
  );
}

function retryAfterMs(failures: number): number {
  return Math.min(60_000, 2 ** failures * 2_000);
}

function timeoutFrom(options: RpcOptions | undefined): number {
  const requested = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return Number.isFinite(requested) ? Math.max(1, requested) : DEFAULT_TIMEOUT_MS;
}

export function createRpcPool({ rpcUrls = [], alchemyUrls = [], publicUrl = '', fetchImpl }: RpcPoolConfig) {
  const doFetch = fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const explicit = rpcUrls.filter((url) => url.trim().length > 0);
  const endpoints: Endpoint[] = [];
  if (explicit.length > 0) {
    endpoints.push(
      ...explicit.map((url, index) => ({
        id: `rpc#${index + 1}`,
        url,
        kind: 'rpc' as const,
        coolUntil: 0,
        failures: 0,
      })),
    );
  } else {
    endpoints.push(
      ...alchemyUrls
        .filter((url) => url.trim().length > 0)
        .map((url, index) => ({
          id: `alchemy#${index + 1}`,
          url,
          kind: 'alchemy' as const,
          coolUntil: 0,
          failures: 0,
        })),
    );
    if (publicUrl.trim())
      endpoints.push({ id: 'public', url: publicUrl, kind: 'public', coolUntil: 0, failures: 0 });
  }

  const primaryEndpoints = endpoints.filter((endpoint) => endpoint.kind !== 'public');
  const publicEndpoint = endpoints.find((endpoint) => endpoint.kind === 'public');
  let primaryCursor = 0;
  let requestId = 0;

  function pickPrimary(attempted: Set<Endpoint>): Endpoint | undefined {
    const now = Date.now();
    for (let offset = 0; offset < primaryEndpoints.length; offset += 1) {
      const index = (primaryCursor + offset) % primaryEndpoints.length;
      const endpoint = primaryEndpoints[index];
      if (!endpoint) continue;
      if (!attempted.has(endpoint) && endpoint.coolUntil <= now) {
        primaryCursor = (index + 1) % primaryEndpoints.length;
        return endpoint;
      }
    }
    return undefined;
  }

  async function requestEndpoint<T>(
    endpoint: Endpoint,
    method: string,
    params: unknown[],
    timeoutMs: number,
  ): Promise<T> {
    const id = ++requestId;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    logger.debug({ endpointId: endpoint.id, method }, 'RPC request using endpoint');
    try {
      let response: Response;
      try {
        response = await doFetch(endpoint.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'user-agent': 'Spindle/1.0' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
          signal: controller.signal,
        });
      } catch {
        throw new RetryableFailure(timedOut ? 'timeout' : 'network');
      }

      if (!response.ok) {
        if (response.status === 429) throw new RetryableFailure('http_429');
        if (response.status >= 500) throw new RetryableFailure('http_5xx');
        if (response.status === 400 && endpoint.kind === 'public' && method === 'eth_getLogs') {
          const body: unknown = await response.json().catch(() => null);
          if (
            isRecord(body) &&
            isRecord(body.error) &&
            typeof body.error.code === 'number' &&
            typeof body.error.message === 'string'
          ) {
            throw new RpcError(body.error.code, body.error.message, body.error.data);
          }
        }
        // Alchemy's free-tier log range cap is an endpoint limitation, not an
        // invalid filter. Let another provider serve the unchanged read request.
        if (response.status === 400 && endpoint.kind === 'alchemy' && method === 'eth_getLogs') {
          const body: unknown = await response.json().catch(() => null);
          if (isRecord(body) && isLogRangeLimit(endpoint, method, body.error)) {
            throw new RetryableFailure('rpc_log_range_limit');
          }
        }
        throw new RpcError(response.status, `RPC endpoint returned HTTP ${response.status}.`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new RetryableFailure('invalid_response');
      }
      if (!isRecord(payload)) throw new RetryableFailure('invalid_response');

      if ('error' in payload) {
        const rpcError = payload.error;
        if (
          !isRecord(rpcError) ||
          typeof rpcError.code !== 'number' ||
          typeof rpcError.message !== 'string'
        ) {
          throw new RetryableFailure('invalid_response');
        }
        const lowerMessage = rpcError.message.toLowerCase();
        if (isLogRangeLimit(endpoint, method, rpcError)) throw new RetryableFailure('rpc_log_range_limit');
        if (
          rpcError.code === -32005 ||
          (rpcError.code === -32603 && lowerMessage.includes('rate')) ||
          lowerMessage.includes('429')
        ) {
          throw new RetryableFailure('rpc_rate_limit');
        }
        throw new RpcError(rpcError.code, rpcError.message, rpcError.data);
      }

      if (!('result' in payload)) throw new RetryableFailure('invalid_response');
      return payload.result as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async function rpc<T>(method: string, params: unknown[], options?: RpcOptions): Promise<T> {
    const timeoutMs = timeoutFrom(options);
    const attempted = new Set<Endpoint>();

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      if (options?.publicOnly) {
        if (!publicEndpoint || attempted.has(publicEndpoint) || publicEndpoint.coolUntil > Date.now()) break;
        attempted.add(publicEndpoint);
        try {
          await options.beforeAttempt?.();
          const result = await requestEndpoint<T>(publicEndpoint, method, params, timeoutMs);
          publicEndpoint.failures = 0;
          publicEndpoint.coolUntil = 0;
          return result;
        } catch (error) {
          if (!(error instanceof RetryableFailure)) throw error;
          publicEndpoint.failures += 1;
          const coolingForMs = retryAfterMs(publicEndpoint.failures);
          publicEndpoint.coolUntil = Date.now() + coolingForMs;
          logger.warn(
            { endpointId: publicEndpoint.id, method, reason: error.category, coolingForMs },
            'RPC endpoint cooling down',
          );
          break;
        }
      }
      const publicAvailable =
        !options?.alchemyOnly &&
        publicEndpoint &&
        !attempted.has(publicEndpoint) &&
        publicEndpoint.coolUntil <= Date.now();
      // Robinhood's public RPC supports the indexer's log ranges. Free Alchemy
      // keys are limited to ten blocks, even when multiple keys are rotated.
      let endpoint = method === 'eth_getLogs' && publicAvailable ? publicEndpoint : pickPrimary(attempted);
      if (!endpoint && publicAvailable) {
        endpoint = publicEndpoint;
      }
      if (!endpoint) break;
      attempted.add(endpoint);

      try {
        await options?.beforeAttempt?.();
        const result = await requestEndpoint<T>(endpoint, method, params, timeoutMs);
        endpoint.failures = 0;
        endpoint.coolUntil = 0;
        return result;
      } catch (error) {
        if (!(error instanceof RetryableFailure)) throw error;
        endpoint.failures += 1;
        const coolingForMs = retryAfterMs(endpoint.failures);
        endpoint.coolUntil = Date.now() + coolingForMs;
        logger.warn(
          { endpointId: endpoint.id, method, reason: error.category, coolingForMs },
          'RPC endpoint cooling down',
        );
      }
    }

    throw new AppError('UPSTREAM_UNAVAILABLE', UPSTREAM_MESSAGE, 503);
  }

  function poolStatus(): EndpointStatus[] {
    const now = Date.now();
    return endpoints.map(({ id, kind, coolUntil, failures }) => ({
      id,
      kind,
      coolingForMs: Math.max(0, coolUntil - now),
      failures,
    }));
  }

  async function checkEndpoints(): Promise<EndpointCheck[]> {
    const checkOne = async (endpoint: Endpoint): Promise<EndpointCheck> => {
      const report: EndpointCheck = { id: endpoint.id, chainId: null };
      try {
        report.chainId = await requestEndpoint<string>(endpoint, 'eth_chainId', [], DEFAULT_TIMEOUT_MS);
      } catch {
        return report;
      }
      if (endpoint.kind === 'public') {
        try {
          report.latestBlock = await requestEndpoint<string>(
            endpoint,
            'eth_blockNumber',
            [],
            DEFAULT_TIMEOUT_MS,
          );
        } catch {
          report.latestBlock = null;
        }
        try {
          const bytecode = await requestEndpoint<string>(
            endpoint,
            'eth_getCode',
            [MULTICALL3, 'latest'],
            DEFAULT_TIMEOUT_MS,
          );
          report.multicall3Code = bytecode !== '0x' && bytecode !== '0x0';
        } catch {
          report.multicall3Code = null;
        }
      }
      return report;
    };

    return Promise.all(endpoints.map(checkOne));
  }

  async function diagnoseEndpoints(): Promise<RpcEndpointDiagnostic[]> {
    const timeoutMs = 5_000;
    const checkOne = async (endpoint: Endpoint): Promise<RpcEndpointDiagnostic> => {
      const started = performance.now();
      try {
        const block = await requestEndpoint<unknown>(endpoint, 'eth_blockNumber', [], timeoutMs);
        const latencyMs = Math.round(performance.now() - started);
        return {
          id: endpoint.id,
          ok: typeof block === 'string' && /^0x[\da-f]+$/i.test(block),
          latencyMs,
        };
      } catch {
        return { id: endpoint.id, ok: false, latencyMs: null };
      }
    };

    // Diagnose every configured endpoint directly without changing pool health or routing state.
    return Promise.all(endpoints.map(checkOne));
  }

  return { rpc, poolStatus, checkEndpoints, diagnoseEndpoints };
}

function defaultPoolConfig(): RpcPoolConfig {
  return {
    rpcUrls: config.RPC_URLS,
    alchemyUrls: secrets.ALCHEMY_API_KEYS.map((key) => `https://robinhood-mainnet.g.alchemy.com/v2/${key}`),
    publicUrl: config.PUBLIC_RPC_URL,
  };
}

let defaultPool: ReturnType<typeof createRpcPool> | undefined;
function pool() {
  defaultPool ??= createRpcPool(defaultPoolConfig());
  return defaultPool;
}

export const rpc = <T>(method: string, params: unknown[], options?: RpcOptions): Promise<T> =>
  pool().rpc<T>(method, params, options);
export const poolStatus = (): EndpointStatus[] => pool().poolStatus();
export const checkRpcEndpoints = (): Promise<EndpointCheck[]> => pool().checkEndpoints();
export const diagnoseRpcEndpoints = (): Promise<RpcEndpointDiagnostic[]> => pool().diagnoseEndpoints();
