import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { cardSettings } from '../cards/settings';

const Currency = z
  .object({ amount: z.string().regex(/^\d+$/), amountUsd: z.string().optional() })
  .passthrough();
const Item = z.object({
  data: z
    .object({ to: z.string(), data: z.string(), value: z.string().default('0'), chainId: z.number().int() })
    .passthrough(),
  check: z.object({ endpoint: z.string(), method: z.string().optional() }).optional(),
});
const Step = z.object({ id: z.string(), kind: z.string(), items: z.array(Item).min(1) }).passthrough();
export const RelayQuoteResponse = z
  .object({
    requestId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    steps: z.array(Step).min(1),
    fees: z.record(z.string(), z.object({ amountUsd: z.string().optional() }).passthrough()).default({}),
    details: z
      .object({
        currencyIn: Currency,
        currencyOut: Currency,
        timeEstimate: z.number().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type RelayQuote = z.infer<typeof RelayQuoteResponse>;

export type QuoteParams = {
  user: string;
  recipient: string;
  originChainId: number;
  originCurrency: string;
  destinationChainId: number;
  destinationCurrency: string;
  amount: string;
};

export const relayDeps = { fetch: (input: string, init?: RequestInit) => fetch(input, init) };

function headers(): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(cardSettings.relayApiKey ? { 'x-api-key': cardSettings.relayApiKey } : {}),
  };
}

/** Maps a Relay error body to our error codes. */
function mapError(_status: number, body: unknown): AppError {
  const b = (body && typeof body === 'object' ? body : {}) as { errorCode?: string; message?: string };
  const code = String(b.errorCode ?? '');
  const message = String(b.message ?? '');
  if (code === 'INSUFFICIENT_LIQUIDITY' || /insufficient liquidity/i.test(message)) {
    return new AppError(
      'INSUFFICIENT_LIQUIDITY',
      'Temporarily unavailable: try a smaller amount or try again later.',
    );
  }
  if (code === 'INVALID_RECIPIENT' || code === 'INVALID_ADDRESS' || /invalid recipient/i.test(message)) {
    return new AppError('VALIDATION', 'The payment address was rejected by the bridge.', 400, {
      code: 'INVALID_RECIPIENT',
    });
  }
  return new AppError(
    'UPSTREAM_UNAVAILABLE',
    'The bridge is temporarily unavailable. Try again shortly.',
    502,
  );
}

async function post(path: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await relayDeps.fetch(`${cardSettings.relayApiUrl}${path}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw mapError(0, null);
  }
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/** EXACT_OUTPUT quote. Tries `/quote/v2`, falls back to `/quote` on 404 or a shape mismatch. */
export async function quote(params: QuoteParams): Promise<{ quote: RelayQuote; endpoint: 'v2' | 'v1' }> {
  const payload = { ...params, tradeType: 'EXACT_OUTPUT', refundTo: params.user };
  let lastError: AppError | null = null;
  for (const [path, endpoint] of [
    ['/quote/v2', 'v2'],
    ['/quote', 'v1'],
  ] as const) {
    const { status, body } = await post(path, payload);
    if (status >= 200 && status < 300) {
      const parsed = RelayQuoteResponse.safeParse(body);
      if (parsed.success) return { quote: parsed.data, endpoint };
      lastError = mapError(0, null);
      continue;
    }
    // A definite business error (liquidity, recipient) is final; only 404 / shape problems fall back.
    const mapped = mapError(status, body);
    if (status !== 404 && mapped.code !== 'UPSTREAM_UNAVAILABLE') throw mapped;
    lastError = mapped;
    if (status !== 404 && status < 500) break;
  }
  throw lastError ?? mapError(0, null);
}

export type RelayStatusResult = 'pending' | 'success' | 'refund' | 'failure';

/** A path on the Relay API. Joined onto its URL with our API key attached, so it must not be able to leave that host. */
export const isRelayPath = (p: string): boolean => /^\/(?![/\\])[^@\s]*$/.test(p);

/** `GET /intents/status/v3?requestId=`, falling back to the quote's `check.endpoint`. */
export async function status(requestId: string, checkEndpoint?: string): Promise<RelayStatusResult> {
  const paths = [
    `/intents/status/v3?requestId=${requestId}`,
    ...(checkEndpoint && isRelayPath(checkEndpoint) ? [checkEndpoint] : []),
  ];
  for (const path of paths) {
    try {
      const res = await relayDeps.fetch(`${cardSettings.relayApiUrl}${path}`, {
        headers: headers(),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { status?: string };
      const s = String(body.status ?? '').toLowerCase();
      if (s === 'success') return 'success';
      if (s === 'refund' || s === 'refunded') return 'refund';
      if (s === 'failure' || s === 'failed') return 'failure';
      return 'pending';
    } catch {
      throw new AppError('UPSTREAM_UNAVAILABLE', 'Bridge status is temporarily unavailable.');
    }
  }
  return 'pending';
}
