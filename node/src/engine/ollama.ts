import { openaiChat, openaiChatStream, openaiEmbeddings } from './openai';
import { type ChatRequest, type Delta, type Engine, EngineError, type EngineModel } from './types';

export class OllamaEngine implements Engine {
  readonly kind = 'ollama' as const;
  constructor(private readonly url: string) {}

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

  chatStream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<Delta> {
    return openaiChatStream(this.url, req, signal);
  }
  chat(req: ChatRequest, signal?: AbortSignal) {
    return openaiChat(this.url, req, signal);
  }
  embeddings(req: Record<string, unknown>, signal?: AbortSignal) {
    return openaiEmbeddings(this.url, req, signal);
  }
  async version(): Promise<string> {
    return (await this.getJson<{ version: string }>('/api/version')).version;
  }
}
