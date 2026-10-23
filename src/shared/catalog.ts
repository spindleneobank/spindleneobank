import { z } from 'zod';
import { JobKind, Lane, UnitKind } from './enums';

export const CatalogModel = z.object({
  id: z.string(),
  family: z.string(),
  kind: z.enum(JobKind),
  engineIds: z.object({ ollama: z.string().optional(), vllm: z.string().optional() }),
  hfTokenizer: z.string(),
  minVramMb: z.number().int().nonnegative(),
  sizeMb: z.number().int().nonnegative(),
  lanes: z.array(z.enum(Lane)).min(1),
  unitKind: z.enum(UnitKind),
});
export type CatalogModel = z.infer<typeof CatalogModel>;

export const DEFAULT_CATALOG: CatalogModel[] = [
  {
    id: 'qwen2.5:0.5b',
    family: 'qwen2.5',
    kind: 'chat',
    engineIds: { ollama: 'qwen2.5:0.5b', vllm: 'Qwen/Qwen2.5-0.5B-Instruct' },
    hfTokenizer: 'Qwen/Qwen2.5-0.5B-Instruct',
    minVramMb: 1024,
    sizeMb: 400,
    lanes: ['open'],
    unitKind: 'tokens_1m',
  },
  {
    id: 'qwen2.5:7b',
    family: 'qwen2.5',
    kind: 'chat',
    engineIds: { ollama: 'qwen2.5:7b', vllm: 'Qwen/Qwen2.5-7B-Instruct' },
    hfTokenizer: 'Qwen/Qwen2.5-7B-Instruct',
    minVramMb: 8192,
    sizeMb: 4700,
    lanes: ['open', 'sealed'],
    unitKind: 'tokens_1m',
  },
  {
    id: 'llama3.1:8b',
    family: 'llama3.1',
    kind: 'chat',
    engineIds: { ollama: 'llama3.1:8b', vllm: 'meta-llama/Llama-3.1-8B-Instruct' },
    hfTokenizer: 'meta-llama/Llama-3.1-8B-Instruct',
    minVramMb: 8192,
    sizeMb: 4900,
    lanes: ['open', 'sealed'],
    unitKind: 'tokens_1m',
  },
  {
    id: 'nomic-embed-text',
    family: 'nomic-embed',
    kind: 'embeddings',
    engineIds: { ollama: 'nomic-embed-text', vllm: 'nomic-ai/nomic-embed-text-v1.5' },
    hfTokenizer: 'nomic-ai/nomic-embed-text-v1.5',
    minVramMb: 1024,
    sizeMb: 274,
    lanes: ['open'],
    unitKind: 'tokens_1m',
  },
  {
    id: 'qwen2.5:32b',
    family: 'qwen2.5',
    kind: 'chat',
    engineIds: { ollama: 'qwen2.5:32b', vllm: 'Qwen/Qwen2.5-32B-Instruct' },
    hfTokenizer: 'Qwen/Qwen2.5-32B-Instruct',
    minVramMb: 24576,
    sizeMb: 19900,
    lanes: ['open', 'sealed'],
    unitKind: 'tokens_1m',
  },
];

/** Alias used by N2/B5. */
export const MODEL_CATALOG = DEFAULT_CATALOG;

/** VRAM-fit margins from ghost `catalog.py`. */
export const FIT_MARGIN = 1.05;
export const TIGHT_MARGIN = 0.88;

/** Models usable on a GPU with `vramMb`: 'fits' at >= min*1.05, 'tight' at >= min*0.88, otherwise omitted. */
export function fitModels(
  vramMb: number,
  catalog: CatalogModel[] = DEFAULT_CATALOG,
): { model: CatalogModel; fit: 'fits' | 'tight' }[] {
  if (!(vramMb > 0)) return [];
  const out: { model: CatalogModel; fit: 'fits' | 'tight' }[] = [];
  for (const model of catalog) {
    if (vramMb >= model.minVramMb * FIT_MARGIN) out.push({ model, fit: 'fits' });
    else if (vramMb >= model.minVramMb * TIGHT_MARGIN) out.push({ model, fit: 'tight' });
  }
  return out;
}
