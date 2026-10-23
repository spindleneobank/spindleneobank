import { openaiChat, openaiChatStream, openaiEmbeddings } from './openai';
import { type ChatRequest, type Delta, type Engine, EngineError, type EngineModel } from './types';

export class VllmEngine implements Engine {
  readonly kind = 'vllm' as const;
  constructor(
    private readonly url: string,
    private readonly servedModel: string,
  ) {}

  async listModels(): Promise<EngineModel[]> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/v1/models`);
    } catch (e) {
      throw new EngineError(`vllm unreachable at ${this.url}: ${(e as Error).message}`);
    }
    if (!res.ok) throw new EngineError(`vllm /v1/models failed (${res.status})`, res.status);
    const j = (await res.json()) as { data?: { id: string; root?: string }[] };
    return (j.data ?? []).map((m) => ({ id: m.id, digest: m.root ?? m.id, sizeMb: 0 }));
  }

  /** vLLM serves exactly one model per container; only verify it matches. */
  async ensureModel(model: string, onProgress: (pct: number) => void): Promise<string> {
    if (model !== this.servedModel) {
      throw new EngineError(`vllm serves "${this.servedModel}" only; cannot ensure "${model}"`);
    }
    const served = (await this.listModels()).find((m) => m.id === model);
    if (!served) throw new EngineError(`vllm is not serving "${model}" yet`);
    onProgress(100);
    return served.digest;
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
    try {
      const res = await fetch(`${this.url}/version`);
      if (res.ok) return ((await res.json()) as { version?: string }).version ?? 'unknown';
    } catch {}
    return 'unknown';
  }
}
