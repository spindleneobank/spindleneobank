import { openaiEmbeddings } from './openai';
import { type ChatRequest, type Delta, type Engine, EngineError, type EngineModel } from './types';

export class OllamaEngine implements Engine {
  readonly kind = 'ollama' as const;
  /** model -> context actually served (min of the model's own window and `maxCtx`). */
  private readonly served = new Map<string, number>();

  /**
   * `maxCtx` is the operator's cap (SPINDLE_NUM_CTX, default 8192). Ollama's OpenAI endpoint ignores
   * `num_ctx` and its default is 4096, so a longer prompt would be silently truncated; chat therefore goes
   * through the native /api/chat with `options.num_ctx` set on every request.
   */
  constructor(
    private readonly url: string,
    private readonly maxCtx = 8192,
  ) {}

  /** Context window this node serves for `model`: the model's own (from /api/show), capped by `maxCtx`. */
  async contextLength(model: string): Promise<number> {
    const hit = this.served.get(model);
    if (hit) return hit;
    let own = 0;
    try {
      const show = await this.getJson<{ model_info?: Record<string, unknown> }>('/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      for (const [k, v] of Object.entries(show.model_info ?? {})) {
        if (k.endsWith('.context_length') && typeof v === 'number' && v > 0) own = v;
      }
    } catch {}
    // unknown model window: stay at Ollama's own default rather than promise more than we know
    const n = own > 0 ? Math.min(own, this.maxCtx) : Math.min(4096, this.maxCtx);
    this.served.set(model, n);
    return n;
  }

  private async nativeBody(req: ChatRequest, stream: boolean): Promise<Record<string, unknown>> {
    const model = String(req.model);
    const options: Record<string, unknown> = { num_ctx: await this.contextLength(model) };
    const maxTokens = Number(req.max_tokens ?? req.max_completion_tokens);
    if (Number.isFinite(maxTokens) && maxTokens > 0) options.num_predict = maxTokens;
    for (const k of ['temperature', 'top_p', 'seed', 'frequency_penalty', 'presence_penalty'] as const)
      if (typeof req[k] === 'number') options[k] = req[k];
    if (req.stop !== undefined && req.stop !== null)
      options.stop = Array.isArray(req.stop) ? req.stop : [req.stop];
    const messages = ((req.messages as Record<string, unknown>[] | undefined) ?? []).map(toNativeMessage);
    return { model, messages, stream, options };
  }

  private async getJson<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.url}${path}`, init);
    } catch (e) {
      throw new EngineError(`ollama unreachable at ${this.url}: ${(e as Error).message}`);
    }
    if (!res.ok) throw new EngineError(`ollama ${path} failed (${res.status})`, res.status);
    return (await res.json()) as T;
  }

  async listModels(): Promise<EngineModel[]> {
    const j = await this.getJson<{ models?: { name: string; digest?: string; size?: number }[] }>(
      '/api/tags',
    );
    return (j.models ?? []).map((m) => ({
      id: m.name,
      digest: m.digest ?? '',
      sizeMb: Math.round((m.size ?? 0) / 1048576),
    }));
  }

  /** Digest from /api/tags; /api/show only as a fallback (it carries no digest on most versions). */
  private async digestOf(model: string): Promise<string> {
    const found = (await this.listModels()).find((m) => m.id === model || m.id === `${model}:latest`);
    if (found?.digest) return found.digest;
    const show = await this.getJson<{ digest?: string; details?: { digest?: string } }>('/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    return show.digest ?? show.details?.digest ?? '';
  }

  async ensureModel(model: string, onProgress: (pct: number) => void): Promise<string> {
    const have = (await this.listModels()).some((m) => m.id === model || m.id === `${model}:latest`);
    if (!have) {
      const res = await fetch(`${this.url}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: true }),
      }).catch((e) => {
        throw new EngineError(`ollama unreachable: ${(e as Error).message}`);
      });
      if (!res.ok || !res.body)
        throw new EngineError(`ollama pull ${model} failed (${res.status})`, res.status);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const handle = (line: string) => {
        if (!line.trim()) return;
        const j = JSON.parse(line) as { error?: string; total?: number; completed?: number };
        if (j.error) throw new EngineError(`ollama pull ${model}: ${j.error}`);
        if (j.total && j.completed !== undefined) onProgress(Math.min(100, (j.completed / j.total) * 100));
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const l of lines) handle(l);
      }
      handle(buf);
    }
    onProgress(100);
    return this.digestOf(model);
  }

  async *chatStream(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<Delta> {
    const res = await this.postChat(await this.nativeBody(req, true), signal);
    if (!res.body) throw new EngineError('no response body from ollama');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const l of lines) {
          const d = parseNativeLine(l);
          if (d) yield d;
        }
      }
      const last = parseNativeLine(buf);
      if (last) yield last;
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  async chat(req: ChatRequest, signal?: AbortSignal) {
    const res = await this.postChat(await this.nativeBody(req, false), signal);
    const j = (await res.json()) as NativeChunk;
    const prompt = j.prompt_eval_count ?? 0;
    const completion = j.eval_count ?? 0;
    return {
      object: 'chat.completion',
      model: req.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: j.message?.content ?? '' },
          finish_reason: j.done_reason ?? 'stop',
        },
      ],
      usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
    } as Record<string, unknown>;
  }

  private async postChat(body: unknown, signal?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new EngineError(`ollama unreachable at ${this.url}: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new EngineError(`chat failed (${res.status}): ${txt.slice(0, 500)}`, res.status);
    }
    return res;
  }
  embeddings(req: Record<string, unknown>, signal?: AbortSignal) {
    return openaiEmbeddings(this.url, req, signal);
  }
  async version(): Promise<string> {
    return (await this.getJson<{ version: string }>('/api/version')).version;
  }
}

interface NativeChunk {
  message?: { content?: string; thinking?: string };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/** One NDJSON line of Ollama's native /api/chat stream. */
export function parseNativeLine(line: string): Delta | null {
  const t = line.trim();
  if (!t) return null;
  let j: NativeChunk;
  try {
    j = JSON.parse(t);
  } catch {
    return null;
  }
  if (j.error) throw new EngineError(`engine stream error: ${j.error}`);
  const out: Delta = {};
  if (j.message?.content) out.content = j.message.content;
  if (j.message?.thinking) out.reasoning = j.message.thinking;
  if (j.done) {
    out.finishReason = j.done_reason ?? 'stop';
    out.usage = { promptTokens: j.prompt_eval_count ?? 0, completionTokens: j.eval_count ?? 0 };
  }
  return Object.keys(out).length ? out : null;
}

/** OpenAI chat message -> Ollama native message (text parts joined, data-URL images as base64). */
export function toNativeMessage(m: Record<string, unknown>): Record<string, unknown> {
  const role = String(m.role ?? 'user');
  const c = m.content;
  if (!Array.isArray(c)) return { role, content: typeof c === 'string' ? c : '' };
  const text: string[] = [];
  const images: string[] = [];
  for (const p of c as { type?: string; text?: string; image_url?: { url?: string } }[]) {
    if (p.type === 'text' && typeof p.text === 'string') text.push(p.text);
    else if (p.type === 'image_url' && p.image_url?.url) {
      const u = p.image_url.url;
      images.push(u.startsWith('data:') ? u.slice(u.indexOf(',') + 1) : u);
    }
  }
  return { role, content: text.join('\n'), ...(images.length ? { images } : {}) };
}
