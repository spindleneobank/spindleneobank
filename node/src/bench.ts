import type { Engine } from './engine';

/** Fixed benchmark parameters: identical on every node, so results are comparable. The server's
 *  probe.start params are intentionally ignored except for the model name. */
export const BENCH_PROMPT =
  'Write a detailed explanation of how a hash table works, covering buckets, collisions, ' +
  'load factor and resizing, and give a short example in plain English with several sentences.';
export const BENCH_MAX_TOKENS = 200;
export const BENCH_TEMPERATURE = 0;

export interface BenchResult {
  tokPerSec: number;
  ttftMs: number;
  model: string;
  digest: string;
}

export async function runBenchmark(
  engine: Engine,
  model: string,
  now: () => number = () => performance.now(),
): Promise<BenchResult> {
  const t0 = now();
  let first = 0;
  let deltas = 0;
  let completion = 0;
  for await (const d of engine.chatStream({
    model,
    messages: [{ role: 'user', content: BENCH_PROMPT }],
    max_tokens: BENCH_MAX_TOKENS,
    temperature: BENCH_TEMPERATURE,
  })) {
    if ((d.content || d.reasoning) && !first) first = now();
    if (d.content || d.reasoning) deltas++;
    if (d.usage) completion = d.usage.completionTokens;
  }
  const end = now();
  if (!first) throw new Error(`benchmark produced no output for ${model}`);
  const tokens = completion || deltas;
  // tok/s is measured over the decode phase (after first token); fall back to total time.
  const decodeMs = end - first;
  const secs = (decodeMs > 1 && tokens > 1 ? decodeMs : end - t0) / 1000;
  const digest = (await engine.listModels().catch(() => [])).find(
    (m) => m.id === model || m.id === `${model}:latest`,
  )?.digest;
  return {
    tokPerSec: Math.round(((tokens > 1 && decodeMs > 1 ? tokens - 1 : tokens) / secs) * 100) / 100,
    ttftMs: Math.round(first - t0),
    model,
    digest: digest ?? '',
  };
}
