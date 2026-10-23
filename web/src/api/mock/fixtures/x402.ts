import { SESSION_MAX_CAP_MICROS_DEFAULT } from '@spindle/shared/api';
import { spindlePaymentTypedData } from '@spindle/shared/x402';
import { env } from '../../../env';
import { ApiError } from '../../errors';
import type { MockFixtures } from '../mock';
import { readMockSession } from './auth';

const flag = (name: string) =>
  typeof window === 'undefined' ? null : new URLSearchParams(location.search).get(name);
const x402Enabled = () => flag('x402') !== 'off';
const SURCHARGE = 30_000n;
const bytes32 = () =>
  `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
const jsonSafe = <T>(v: T): T =>
  JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

interface MockSession {
  payer: string;
  cap: bigint;
  used: bigint;
  token: string;
  status: 'pending' | 'open' | 'closing';
  expiresAt: number;
  ttlSec: number;
}
const sessions = new Map<string, MockSession>();
const byToken = (t: unknown) => [...sessions.values()].find((s) => s.token === t && s.token !== '');

function authed(id: string, body: unknown): MockSession {
  const s = sessions.get(id);
  if (!s || s.token !== (body as { __token?: string }).__token) {
    throw new ApiError('NOT_FOUND', 'Unknown x402 session.', 404);
  }
  return s;
}
const spendable = (s: MockSession) => (s.status === 'open' ? max0(s.cap - SURCHARGE - s.used) : 0n);
const max0 = (v: bigint) => (v > 0n ? v : 0n);

export const x402Fixtures: MockFixtures = {
  'GET /v1/app/buyer': ({ mode }) => {
    const s = readMockSession();
    if (!s) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
    return {
      address: s.address,
      balanceMicros: flag('balance') === '0' || mode === 'empty' ? '0' : '12500000',
      reservedMicros: '0',
      x402: {
        enabled: x402Enabled(),
        minSurchargeMicros: '20000',
        currentSurchargeMicros: SURCHARGE.toString(),
      },
    };
  },
  'POST /v1/x402/sessions': ({ body }) => {
    if (!x402Enabled()) {
      throw new ApiError('PAYMENT_REQUIRED', 'x402 temporarily unavailable. Use prepaid balance.', 402);
    }
    const req = body as { payer: string; capMicros: string; ttlSec: number };
    const cap = BigInt(req.capMicros);
    if (cap > SESSION_MAX_CAP_MICROS_DEFAULT) throw new ApiError('VALIDATION', 'capMicros too high', 400);
    const sessionId = bytes32();
    const nowSec = Math.floor(Date.now() / 1000);
    sessions.set(sessionId, {
      payer: req.payer,
      cap,
      used: 0n,
      token: '',
      status: 'pending',
      expiresAt: (nowSec + req.ttlSec) * 1000,
      ttlSec: req.ttlSec,
    });
    const td = spindlePaymentTypedData({
      chainId: env.chainId,
      token: env.addresses.usdg,
      cap,
      // ?td=bad makes the "server" ask for a different spender so the client refusal can be shown
      spender: flag('td') === 'bad' ? '0x000000000000000000000000000000000000dead' : env.addresses.vault,
      nonce: BigInt(Math.floor(Math.random() * 1e9)),
      deadline: BigInt(nowSec + 600 + req.ttlSec + 3600),
      paymentId: sessionId as `0x${string}`,
      surcharge: SURCHARGE,
      validAfter: BigInt(nowSec - 60),
      permit2: env.addresses.permit2,
    });
    return {
      sessionId,
      typedData: jsonSafe(td),
      surchargeMicros: SURCHARGE.toString(),
      expiresAt: new Date((nowSec + req.ttlSec) * 1000).toISOString(),
    };
  },
  'POST /v1/x402/sessions/:id/open': ({ params, body }) => {
    const s = sessions.get(params.id as string);
    if (s?.status !== 'pending') throw new ApiError('NOT_FOUND', 'Unknown or expired session request.', 404);
    if (!/^0x[0-9a-fA-F]+$/.test((body as { signature?: string }).signature ?? '')) {
      throw new ApiError('VALIDATION', 'Bad signature', 400);
    }
    s.status = 'open';
    s.token = btoa(bytes32()).slice(0, 43);
    s.expiresAt = Date.now() + s.ttlSec * 1000;
    return {
      sessionToken: s.token,
      capMicros: s.cap.toString(),
      surchargeMicros: SURCHARGE.toString(),
      spendableMicros: (s.cap - SURCHARGE).toString(),
      expiresAt: new Date(s.expiresAt).toISOString(),
    };
  },
  'GET /v1/x402/sessions/:id': ({ params, body }) => {
    const s = authed(params.id as string, body);
    return {
      status: s.status === 'pending' ? 'open' : s.status,
      usedMicros: s.used.toString(),
      spendableMicros: spendable(s).toString(),
      settleTx: null,
    };
  },
  'POST /v1/x402/sessions/:id/close': ({ params, body }) => {
    const s = authed(params.id as string, body);
    s.status = 'closing';
    return { status: 'closing' };
  },
};

// ---- mock chat completions (SSE) -----------------------------------------------------------------

const REPLY = [
  'Sure. Here is a short answer.\n\n',
  '**Spindle** routes your request to a GPU node and bills the *actual* usage.\n\n',
  '- one signature opens the session\n',
  '- every message draws from the cap\n',
  '- unused budget is never charged\n\n',
  '```ts\n',
  'const res = await fetch("/v1/chat/completions", { method: "POST" });\n',
  '```\n\n',
  'Ask a follow-up and I will keep going.',
];

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

const errorResponse = (code: string, status: number, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * Stand-in for `fetch('/v1/chat/completions')` in mock mode: same headers, status codes and SSE framing as
 * the gateway (final chunk carries `usage` and `spindle`). Not routed through mockFetch, which is JSON-only.
 */
export async function mockChatCompletion(
  body: { model: string; stream?: boolean },
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Response> {
  await sleep(350, signal);
  const token = headers['X-Spindle-Session'];
  let session: MockSession | undefined;
  if (token) {
    session = byToken(token);
    if (session?.status !== 'open' || session.expiresAt < Date.now()) {
      return errorResponse('SESSION_EXHAUSTED', 402, 'The x402 session is closed or expired.');
    }
  } else if (flag('balance') === '0') {
    return errorResponse('INSUFFICIENT_BALANCE', 402, 'Insufficient balance for this request.');
  }
  if (flag('nocap') === '1')
    return errorResponse('NO_CAPACITY', 503, 'No node is available for this model right now.');
  if (flag('chat') === 'fail') return errorResponse('INTERNAL', 500, 'The node dropped the connection.');

  const completionTokens = 96;
  const price = body.model.startsWith('qwen') ? 1_800_000n : 400_000n;
  const forced = flag('charge');
  const charge = forced ? BigInt(forced) : (BigInt(completionTokens + 24) * price) / 1_000_000n + 1n;
  if (session) {
    if (charge > spendable(session)) {
      return errorResponse(
        'SESSION_EXHAUSTED',
        402,
        'The x402 session has no spendable balance left for this request.',
      );
    }
    session.used += charge;
  }
  const jobId = `job_${bytes32().slice(2, 14)}`;
  const id = `chatcmpl-${jobId}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: object, extra: object = {}, finish: string | null = null) =>
    `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(enc.encode(chunk({ role: 'assistant' })));
        for (const part of REPLY) {
          for (const word of part.match(/\S+\s*|\s+/g) ?? []) {
            await sleep(28, signal);
            controller.enqueue(enc.encode(chunk({ content: word })));
          }
        }
        controller.enqueue(
          enc.encode(
            chunk(
              {},
              {
                usage: {
                  prompt_tokens: 24,
                  completion_tokens: completionTokens,
                  total_tokens: 24 + completionTokens,
                },
                spindle: { jobId, chargeMicros: charge.toString(), receiptUrl: `/v1/receipts/${jobId}` },
              },
              'stop',
            ),
          ),
        );
        controller.enqueue(enc.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'X-Spindle-Job-Id': jobId,
      'X-Spindle-Receipt': `/v1/receipts/${jobId}`,
    },
  });
}
