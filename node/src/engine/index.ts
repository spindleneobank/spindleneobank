import type { Config } from '../config';
import { OllamaEngine } from './ollama';
import type { Engine } from './types';
import { VllmEngine } from './vllm';

export function createEngine(
  c: Pick<Config, 'engine' | 'engineUrl' | 'vllmModel'> & { numCtx?: number; numThread?: number },
): Engine {
  return c.engine === 'ollama'
    ? new OllamaEngine(c.engineUrl, c.numCtx, c.numThread)
    : new VllmEngine(c.engineUrl, c.vllmModel ?? '');
}
export * from './types';
