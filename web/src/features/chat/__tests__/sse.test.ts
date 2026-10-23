import { describe, expect, it } from 'vitest';
import { readSse } from '../sse';

const stream = (parts: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const p of parts) c.enqueue(enc.encode(p));
      c.close();
    },
  });

async function collect(parts: string[]) {
  const out: string[] = [];
  for await (const d of readSse(stream(parts))) out.push(d);
  return out;
}

describe('readSse', () => {
  it('parses events split across chunks and CRLF', async () => {
    expect(await collect(['data: {"a":1}\n', '\ndata: {"a"', ':2}\r\n\r\ndata: [DONE]\n\n'])).toEqual([
      '{"a":1}',
      '{"a":2}',
      '[DONE]',
    ]);
  });
  it('ignores comments and non-data fields, flushes an unterminated tail', async () => {
    expect(await collect([': keepalive\n\nevent: x\ndata: one\n\ndata: tail'])).toEqual(['one', 'tail']);
  });
});
