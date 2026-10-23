export interface EngineModel {
  /** engine-side model name */
  id: string;
  digest: string;
  sizeMb: number;
}

export interface Delta {
  content?: string;
  reasoning?: string;
  usage?: { promptTokens: number; completionTokens: number };
  finishReason?: string;
}

export type ChatRequest = Record<string, unknown>;

export class EngineError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export interface Engine {
  readonly kind: 'ollama' | 'vllm';
  listModels(): Promise<EngineModel[]>;
  /** Pull/verify a model. Resolves with its digest. `onProgress` gets 0..100. */
  ensureModel(model: string, onProgress: (pct: number) => void): Promise<string>;
  chatStream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<Delta>;
  /** Non-streaming chat; returns the OpenAI response object. */
  chat(req: ChatRequest, signal?: AbortSignal): Promise<Record<string, unknown>>;
  embeddings(req: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
  images?(req: Record<string, unknown>, signal?: AbortSignal): Promise<{ data: Uint8Array[] }>;
  version(): Promise<string>;
}
