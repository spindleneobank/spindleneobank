import { ChatCompletionChunk, type ChatMessage, type SpindleMeta } from '@spindle/shared/api';
import { parseError } from '../../api/client';
import { ApiError } from '../../api/errors';
import { mockChatCompletion } from '../../api/mock/fixtures/x402';
import { env } from '../../env';

/** Yields each SSE `data:` payload (string) from a byte stream. Handles split chunks and CRLF. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let i = buf.indexOf('\n\n');
      while (i >= 0) {
        const data = buf
          .slice(0, i)
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).replace(/^ /, ''))
          .join('\n');
        buf = buf.slice(i + 2);
        if (data) yield data;
        i = buf.indexOf('\n\n');
      }
    }
    const tail = buf
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
export interface ChatResult {
  content: string;
  reasoning: string;
  usage?: ChatUsage;
  spindle?: SpindleMeta;
  /** from the response headers; `spindle` in the final chunk is authoritative */
  jobId?: string;
  receiptHeader?: string;
  finishReason?: string | null;
}

export type PayMode = 'session' | 'balance';

export interface StreamArgs {
  model: string;
  messages: Pick<ChatMessage, 'role' | 'content'>[];
  lane: 'open' | 'sealed';
  mode: PayMode;
  sessionToken?: string;
  signal: AbortSignal;
  onDelta: (content: string, reasoning: string) => void;
}

/**
 * POST /v1/chat/completions with stream:true. Session mode sends `X-Spindle-Session`; balance mode relies on
 * the cookie plus `x-spindle-pay: balance` and `x-spindle: 1`. Throws ApiError for HTTP/stream errors.
 */
export async function streamChat(a: StreamArgs): Promise<ChatResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream' };
  if (a.lane !== 'open') headers['X-Spindle-Lane'] = a.lane;
  if (a.mode === 'session') {
    if (!a.sessionToken) throw new ApiError('SESSION_EXHAUSTED', 'No open x402 session.', 402);
    headers['X-Spindle-Session'] = a.sessionToken;
  } else {
    headers['x-spindle-pay'] = 'balance';
    headers['x-spindle'] = '1';
  }
  const body = { model: a.model, messages: a.messages, stream: true };
  const res = env.mock
    ? await mockChatCompletion(body, headers, a.signal)
    : await fetch(`${env.apiUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        // balance mode uses the dashboard cookie; session mode authenticates by token only
        credentials: a.mode === 'balance' ? 'include' : 'omit',
        body: JSON.stringify(body),
        signal: a.signal,
      });
  if (!res.ok) throw await parseError(res);
  if (!res.body) throw new ApiError('INTERNAL', 'The response had no body.', 502);
  const out: ChatResult = {
    content: '',
    reasoning: '',
    jobId: res.headers.get('X-Spindle-Job-Id') ?? undefined,
    receiptHeader: res.headers.get('X-Spindle-Receipt') ?? undefined,
  };
  for await (const data of readSse(res.body)) {
    if (data === '[DONE]') break;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    const err = (json as { error?: { code?: string; message?: string } }).error;
    if (err) throw new ApiError(err.code ?? 'INTERNAL', err.message ?? 'Stream error', 502);
    const chunk = ChatCompletionChunk.safeParse(json);
    if (!chunk.success) continue;
    const c = chunk.data;
    const choice = c.choices[0];
    if (choice?.delta.content) out.content += choice.delta.content;
    if (choice?.delta.reasoning) out.reasoning += choice.delta.reasoning;
    if (choice?.finish_reason) out.finishReason = choice.finish_reason;
    if (c.usage) out.usage = c.usage;
    if (c.spindle) out.spindle = c.spindle;
    if (choice?.delta.content || choice?.delta.reasoning) a.onDelta(out.content, out.reasoning);
  }
  return out;
}
