/**
 * Regression test for audit finding H-1. An attacker has this repository, so the classifier below knows
 * everything in it: the grammar of the old generator (the audit's PoC) and the test fixture corpus. Canaries
 * come from a private corpus it has never seen, in the same shape as buyer traffic, so it must flag no more
 * of them than of real buyer prompts. The control proves the classifier really catches the old canaries.
 */
import { expect, test } from 'bun:test';
import { type BuyerShape, drawChatCanary, parseCorpus, priorShape } from './corpus';

type Msg = { role: string; content: string };
type Req = { messages: Msg[]; maxTokens: number };

const ONLY_NUMBER =
  '(?:Reply with only the number\\.|Answer with just the number\\.|Respond with the number only\\.)';
const GRAMMAR = [
  /^Repeat this word and nothing else: \w+$/,
  new RegExp(
    `^(?:What is \\d \\+ \\d\\?|What is \\d plus \\d\\?|Add \\d and \\d\\.|\\d \\+ \\d = \\?) ${ONLY_NUMBER}$`,
  ),
  new RegExp(`^What is \\d times \\d\\? ${ONLY_NUMBER}$`),
  /^What is the capital of (France|Japan|Spain|Germany)\? (?:Answer with one word\.|Reply with a single word\.|Just give the word\.)$/,
];
const OLD_SYSTEMS = new Set([
  'You are a helpful assistant.',
  'Answer briefly.',
  'You are a concise assistant. Keep answers short.',
  'You are a knowledgeable assistant.',
]);
const fixture = parseCorpus(
  await Bun.file(new URL('../../../test/fixtures/canary-corpus.jsonl', import.meta.url).pathname).text(),
);
const IN_REPO = new Set(fixture.prompts.map((p) => p.messages.at(-1)?.content));

function classifiedAsCanary({ messages, maxTokens }: Req): boolean {
  const users = messages.filter((m) => m.role === 'user');
  const text = users[0]?.content ?? '';
  const system = messages.find((m) => m.role === 'system')?.content;
  if (IN_REPO.has(text)) return true;
  if (system && [...fixture.systems].includes(system)) return true;
  // the old generator: one user turn, its grammar, its max_tokens range, at most one of its system prompts
  return (
    users.length === 1 &&
    messages.length <= 2 &&
    maxTokens >= 16 &&
    maxTokens <= 64 &&
    (!system || OLD_SYSTEMS.has(system)) &&
    GRAMMAR.some((g) => g.test(text))
  );
}

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// One pool of ordinary requests, split at random: one half stands in for the private corpus, the other for
// buyers. It includes short factual prompts of the kind the old canaries used, which buyers really send.
const POOL = [
  'What is 2 + 2?',
  'What is the capital of France?',
  'Write a haiku about rain',
  'Summarise the plot of Hamlet in two sentences.',
  'Translate "good morning" into Spanish.',
  'Explain what a hash map is to a new programmer.',
  'Give me three names for a coffee shop by the sea.',
  'What does the HTTP 429 status code mean?',
  'Rewrite this politely: send me the report now.',
  'Why is the sky blue?',
  'List the primary colours.',
  'What year did the Second World War end?',
  'Write a Python function that reverses a string.',
  'How do I undo my last git commit?',
  'Suggest a healthy breakfast that takes five minutes.',
  'What is the difference between TCP and UDP?',
  'Draft a short thank-you note to a colleague.',
  'Convert 72 Fahrenheit to Celsius.',
  'Explain inflation like I am ten.',
  'What is the boiling point of water at sea level?',
  'Give me a regex that matches an email address.',
  'Who wrote Pride and Prejudice?',
  'Name a synonym for happy.',
  'What should I pack for a weekend hike?',
  'Describe the water cycle briefly.',
  'What is a closure in JavaScript?',
  'Make this sentence shorter: I am writing to let you know that the meeting has moved.',
  'How many continents are there?',
  'Recommend a good first programming language.',
  'What is the square root of 144?',
  'Tell me a joke about cats.',
  'Compare renting and buying a home in a short paragraph.',
];
const SYSTEMS = [
  'You are a support agent for an airline.',
  'Respond in plain English.',
  'You are a coding tutor.',
];
const toLine = (content: string) => JSON.stringify({ type: 'prompt', messages: [{ role: 'user', content }] });

const shuffled = (() => {
  const r = rng(99);
  return POOL.map((p) => [r(), p] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, p]) => p);
})();
const half = shuffled.length / 2;
const privateCorpus = parseCorpus(
  [
    ...shuffled.slice(0, half).map(toLine),
    ...SYSTEMS.map((text) => JSON.stringify({ type: 'system', text })),
  ].join('\n'),
);
const buyerPrompts = shuffled.slice(half);

function canaries(n: number): Req[] {
  const r = rng(1);
  return Array.from({ length: n }, () => {
    const c = drawChatCanary(privateCorpus.prompts, privateCorpus.systems, priorShape(r), r);
    return { messages: c?.messages ?? [], maxTokens: c?.maxTokens ?? 0 };
  });
}
function buyers(n: number): Req[] {
  const r = rng(2);
  return Array.from({ length: n }, () => {
    const s: BuyerShape = priorShape(r);
    const content = buyerPrompts[Math.floor(r() * buyerPrompts.length)] as string;
    const system = s.system
      ? [{ role: 'system', content: SYSTEMS[Math.floor(r() * SYSTEMS.length)] as string }]
      : [];
    return { messages: [...system, { role: 'user', content }], maxTokens: s.maxTokens };
  });
}

/** The generator this replaces, as it was at commit 27862a7. */
function oldCanary(r: () => number): Req {
  const n = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const prompts = [
    `Repeat this word and nothing else: river`,
    `What is ${n(1, 9)} + ${n(1, 9)}? Reply with only the number.`,
    `What is ${n(2, 5)} times ${n(2, 5)}? Respond with the number only.`,
    `What is the capital of Spain? Reply with a single word.`,
  ];
  return {
    messages: [{ role: 'user', content: prompts[n(0, 3)] as string }],
    maxTokens: n(16, 64),
  };
}

const rate = (reqs: Req[]) => reqs.filter(classifiedAsCanary).length / reqs.length;

test('control: the classifier flags every canary of the old in-repo generator', () => {
  const r = rng(3);
  expect(rate(Array.from({ length: 2000 }, () => oldCanary(r)))).toBe(1);
});

test('H-1: a classifier built from the repo flags no more canaries than buyer prompts', () => {
  const canaryRate = rate(canaries(5000));
  const buyerRate = rate(buyers(5000));
  expect(canaryRate).toBeLessThanOrEqual(buyerRate);
  expect(canaryRate).toBe(0);
});

test('a canary body has the same maximum-token and length spread as buyers', () => {
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const c = canaries(5000).map((x) => x.maxTokens);
  const b = buyers(5000).map((x) => x.maxTokens);
  expect(Math.abs(mean(c) - mean(b)) / mean(b)).toBeLessThan(0.05);
  expect(Math.min(...c)).toBeGreaterThan(64 - 1);
});
