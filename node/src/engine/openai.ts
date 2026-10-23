import { type ChatRequest, type Delta, EngineError } from './types';

async function failure(res: Response, what: string): Promise<EngineError> {
  const txt = await res.text().catch(() => '');
  return new EngineError(`${what} failed (${res.status}): ${txt.slice(0, 500)}`, res.status);
}

async function post(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new EngineError(`engine unreachable: ${(e as Error).message}`);
  }
}

/** OpenAI-compatible SSE chat stream shared by Ollama (/v1) and vLLM. */
export async function* openaiChatStream(
  baseUrl: string,
  req: ChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<Delta> {
  const body = { ...req, stream: true, stream_options: { include_usage: true } };
  const res = await post(`${baseUrl}/v1/chat/completions`, body, signal);
  if (!res.ok) throw await failure(res, 'chat');
  if (!res.body) throw new EngineError('no response body from engine');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const d = parseSseLine(line);
        if (d) yield d;
      }
    }
    const last = parseSseLine(buf);
    if (last) yield last;
  } finally {
    reader.cancel().catch(() => {});
  }
}

export function parseSseLine(line: string): Delta | null {
  const t = line.trim();
  if (!t.startsWith('data:')) return null;
  const payload = t.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  let chunk: {
    choices?: { delta?: Record<string, unknown>; finish_reason?: string | null }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
    error?: { message?: string };
  };
  try {
    chunk = JSON.parse(payload);
  } catch {
    return null;
  }
  if (chunk.error) throw new EngineError(`engine stream error: ${chunk.error.message ?? 'unknown'}`);
  const out: Delta = {};
  const choice = chunk.choices?.[0];
  const delta = choice?.delta;
  if (delta) {
    if (typeof delta.content === 'string' && delta.content) out.content = delta.content;
    const r = delta.reasoning_content ?? delta.reasoning;
    if (typeof r === 'string' && r) out.reasoning = r;
  }
  if (choice?.finish_reason) out.finishReason = choice.finish_reason;
  if (chunk.usage && typeof chunk.usage.completion_tokens === 'number') {
    out.usage = {
      promptTokens: chunk.usage.prompt_tokens ?? 0,
      completionTokens: chunk.usage.completion_tokens,
    };
  }
  return Object.keys(out).length ? out : null;
}

export async function openaiChat(baseUrl: string, req: ChatRequest, signal?: AbortSignal) {
  const res = await post(`${baseUrl}/v1/chat/completions`, { ...req, stream: false }, signal);
  if (!res.ok) throw await failure(res, 'chat');
  return (await res.json()) as Record<string, unknown>;
}

export async function openaiEmbeddings(baseUrl: string, req: Record<string, unknown>, signal?: AbortSignal) {
  const res = await post(`${baseUrl}/v1/embeddings`, req, signal);
  if (!res.ok) throw await failure(res, 'embeddings');
  return (await res.json()) as Record<string, unknown>;
}
