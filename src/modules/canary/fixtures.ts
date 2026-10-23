/**
 * Parametric known-answer canaries. Prompts are generated from templates with random operands so there
 * is no fixed public list to memorise, and every request varies in the knobs a buyer could vary
 * (system prompt, sampling, max_tokens) so canaries cannot be fingerprinted by shape. All templates
 * are answerable by a 0.5B model; the check is lenient about wording and strict about the answer.
 * Bump `CANARY_FIXTURE_VERSION` when the templates change.
 */
export const CANARY_FIXTURE_VERSION = 2;

export type ChatExpect = { regex: string } | { anyOf: string[] };

export interface ChatCanary {
  /** template name, recorded in evidence */
  id: string;
  messages: { role: 'system' | 'user'; content: string }[];
  expect: ChatExpect;
  /** Sampling knobs; `undefined` means the field is omitted from the request. */
  temperature?: number;
  seed?: number;
  maxTokens: number;
}

type Rand = () => number;
const int = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty-five',
];
const numExpect = (n: number): ChatExpect => {
  const word = NUMBER_WORDS[n];
  return { regex: `(^|[^0-9.,])${n}([^0-9]|$)${word ? `|\\b${word}\\b` : ''}` };
};
const ONLY_NUMBER = [
  'Reply with only the number.',
  'Answer with just the number.',
  'Respond with the number only.',
];
const ONE_WORD = ['Answer with one word.', 'Reply with a single word.', 'Just give the word.'];

const CAPITALS: readonly [string, string][] = [
  ['France', 'paris'],
  ['Japan', 'tokyo'],
  ['Spain', 'madrid'],
  ['Germany', 'berlin'],
];
const WORDS = [
  'river',
  'candle',
  'window',
  'garden',
  'planet',
  'butter',
  'ladder',
  'marble',
  'basket',
  'rocket',
  'silver',
  'blanket',
];
const ANIMALS = ['dog', 'cat', 'horse', 'rabbit', 'sheep', 'tiger'];
const THINGS = ['chair', 'table', 'spoon', 'window', 'pencil', 'bottle'];

type Template = { id: string; make: (r: Rand) => { prompt: string; expect: ChatExpect } };

export const TEMPLATES: readonly Template[] = [
  {
    id: 'echo',
    make: (r) => {
      const w = pick(r, WORDS);
      return { prompt: `Repeat this word and nothing else: ${w}`, expect: { anyOf: [w] } };
    },
  },
  {
    id: 'add',
    make: (r) => {
      const a = int(r, 1, 9);
      const b = int(r, 1, 9);
      const q = pick(r, [
        `What is ${a} + ${b}?`,
        `What is ${a} plus ${b}?`,
        `Add ${a} and ${b}.`,
        `${a} + ${b} = ?`,
      ]);
      return { prompt: `${q} ${pick(r, ONLY_NUMBER)}`, expect: numExpect(a + b) };
    },
  },
  {
    id: 'mul',
    make: (r) => {
      const a = int(r, 2, 5);
      const b = int(r, 2, 5);
      return { prompt: `What is ${a} times ${b}? ${pick(r, ONLY_NUMBER)}`, expect: numExpect(a * b) };
    },
  },
  {
    id: 'capital',
    make: (r) => {
      const [country, city] = pick(r, CAPITALS);
      return {
        prompt: `What is the capital of ${country}? ${pick(r, ONE_WORD)}`,
        expect: { anyOf: [city] },
      };
    },
  },
];

const SYSTEMS = [
  'You are a helpful assistant.',
  'Answer briefly.',
  'You are a concise assistant. Keep answers short.',
  'You are a knowledgeable assistant.',
];

/** One random chat canary. Deterministic for a given `rand`. */
export function generateChatCanary(rand: Rand = Math.random): ChatCanary {
  const t = pick(rand, TEMPLATES);
  const { prompt, expect } = t.make(rand);
  const messages: ChatCanary['messages'] = [];
  if (rand() < 0.3) messages.push({ role: 'system', content: pick(rand, SYSTEMS) });
  messages.push({ role: 'user', content: prompt });
  return {
    id: t.id,
    messages,
    expect,
    temperature: rand() < 0.8 ? 0 : undefined,
    seed: rand() < 0.5 ? int(rand, 1, 100_000) : undefined,
    maxTokens: int(rand, 16, 64),
  };
}

// ---- embeddings -----------------------------------------------------------------------------------

const SUBJECTS = [
  'The engineer',
  'A young farmer',
  'The committee',
  'My neighbour',
  'The pilot',
  'A curious child',
  'The librarian',
  'Our team',
  'The chef',
  'An old sailor',
];
const VERBS = [
  'repaired',
  'described',
  'forgot',
  'carried',
  'approved',
  'painted',
  'measured',
  'photographed',
  'sold',
  'borrowed',
];
const OBJECTS = [
  'the broken radio',
  'a heavy wooden chest',
  'the quarterly report',
  'an old map',
  'three red bicycles',
  'the garden gate',
  'a pot of soup',
  'the new schedule',
  'a bag of apples',
  'the front window',
];
const TAILS = [
  'before the storm arrived.',
  'on a quiet Tuesday morning.',
  'near the harbour.',
  'after a long discussion.',
  'without telling anyone.',
  'during the winter holidays.',
  'at the end of the lane.',
  'while the radio played.',
];

/** 8-16 random sentences (10*10*10*8 = 8000 possible each), so inputs are never a fixed list. */
export function generateEmbeddingInputs(rand: Rand = Math.random): string[] {
  const n = int(rand, 8, 16);
  const out = new Set<string>();
  while (out.size < n)
    out.add(`${pick(rand, SUBJECTS)} ${pick(rand, VERBS)} ${pick(rand, OBJECTS)} ${pick(rand, TAILS)}`);
  return [...out];
}

export const EMBEDDING_COSINE_MIN = 0.98;
