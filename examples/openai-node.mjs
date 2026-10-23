// Official OpenAI Node SDK against Spindle. Needs SPINDLE_API_KEY. Run: node openai-node.mjs
import OpenAI from 'openai';

const baseURL = `${process.env.SPINDLE_API_URL ?? 'http://127.0.0.1:7200'}/v1`;
const apiKey = process.env.SPINDLE_API_KEY;
if (!apiKey) throw new Error('set SPINDLE_API_KEY');
const client = new OpenAI({ baseURL, apiKey });

try {
  const models = (await client.models.list()).data;
  const model = process.env.SPINDLE_MODEL ?? models.find((m) => m.kind === 'chat' && m.available)?.id;
  if (!model) throw new Error('no available chat model (is a node connected?)');

  // Non-stream. withResponse() exposes the Spindle headers.
  const { data, response } = await client.chat.completions
    .create({ model, max_tokens: 64, messages: [{ role: 'user', content: 'Say hello in five words.' }] })
    .withResponse();
  const jobId = response.headers.get('x-spindle-job-id');
  console.log(data.choices[0].message.content);
  console.log('job', jobId, 'receipt', response.headers.get('x-spindle-receipt'));
  console.log('charge (micros USDG)', response.headers.get('x-spindle-charge-micros'), data.spindle);
  if (!jobId) throw new Error('missing X-Spindle-Job-Id');

  // Stream. The final chunk carries usage and spindle:{ jobId, chargeMicros, receiptUrl }.
  const stream = await client.chat.completions.create({
    model,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 64,
    messages: [{ role: 'user', content: 'Count to five.' }],
  });
  let meta;
  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
    if (chunk.spindle) meta = chunk.spindle;
  }
  console.log('\nstream job', meta?.jobId);
  if (!meta?.jobId) throw new Error('no spindle meta in the final chunk');

  console.log(`PASS openai-node.mjs (job ${jobId})`);
} catch (err) {
  console.error('FAIL openai-node.mjs:', err.message ?? err);
  process.exit(1);
}
