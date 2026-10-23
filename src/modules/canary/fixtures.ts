/**
 * Versioned known-answer canary prompts. Every prompt is answerable by a 0.5B model at temperature 0;
 * the check is deliberately lenient about wording and strict about the answer. Bump
 * `CANARY_FIXTURE_VERSION` when the set changes (evidence rows record it).
 */
export const CANARY_FIXTURE_VERSION = 1;

export type ChatExpect = { regex: string } | { anyOf: string[] };

export interface ChatFixture {
  id: string;
  prompt: string;
  expect: ChatExpect;
}

/** Sampling for every chat canary: identical to what a buyer could send. */
export const CANARY_CHAT_PARAMS = { temperature: 0, seed: 7, maxTokens: 24 } as const;

const num = (id: string, prompt: string, answer: string): ChatFixture => ({
  id,
  prompt: `${prompt} Reply with only the number.`,
  expect: { regex: `(^|[^0-9.,])${answer}([^0-9]|$)` },
});
const word = (id: string, prompt: string, ...anyOf: string[]): ChatFixture => ({
  id,
  prompt,
  expect: { anyOf },
});

export const CHAT_FIXTURES: readonly ChatFixture[] = [
  num('add-1', 'What is 17 + 25?', '42'),
  num('add-2', 'What is 120 + 305?', '425'),
  num('sub-1', 'What is 90 - 47?', '43'),
  num('sub-2', 'What is 1000 - 1?', '999'),
  num('mul-1', 'What is 6 times 7?', '42'),
  num('mul-2', 'What is 12 * 12?', '144'),
  num('mul-3', 'What is 9 times 8?', '72'),
  num('div-1', 'What is 144 divided by 12?', '12'),
  num('div-2', 'What is 100 divided by 4?', '25'),
  num('sq-1', 'What is 15 squared?', '225'),
  num('cnt-1', 'How many days are in a week?', '7'),
  num('cnt-2', 'How many minutes are in one hour?', '60'),
  num('cnt-3', 'How many sides does a hexagon have?', '6'),
  num('cnt-4', 'How many legs does a spider have?', '8'),
  num('cnt-5', 'How many months are in a year?', '12'),
  word('cap-fr', 'What is the capital of France? Answer with one word.', 'paris'),
  word('cap-jp', 'What is the capital of Japan? Answer with one word.', 'tokyo'),
  word('cap-de', 'What is the capital of Germany? Answer with one word.', 'berlin'),
  word('cap-it', 'What is the capital of Italy? Answer with one word.', 'rome'),
  word('cap-es', 'What is the capital of Spain? Answer with one word.', 'madrid'),
  word('col-sky', 'What color is the sky on a clear day? Answer with one word.', 'blue'),
  word('col-grass', 'What color is fresh grass? Answer with one word.', 'green'),
  word('col-blood', 'What color is a ripe tomato? Answer with one word.', 'red'),
  word('chem-water', 'What is the chemical symbol for water?', 'h2o', 'h₂o'),
  word('chem-gold', 'What is the chemical symbol for gold? Answer with the symbol only.', 'au'),
  word('planet-1', 'Which planet is closest to the sun? Answer with one word.', 'mercury'),
  word('planet-red', 'Which planet is known as the Red Planet? Answer with one word.', 'mars'),
  word('opp-hot', 'What is the opposite of hot? Answer with one word.', 'cold'),
  word('opp-up', 'What is the opposite of up? Answer with one word.', 'down'),
  word('animal-bark', 'Which animal says woof: a dog or a cat? Answer with one word.', 'dog'),
  word('fmt-upper', 'Repeat the word banana in capital letters and nothing else.', 'banana'),
  word('fmt-echo', 'Reply with exactly this word and nothing else: pineapple', 'pineapple'),
  word('fmt-yes', 'Is the Earth round? Answer yes or no.', 'yes'),
  word('fmt-no', 'Is ice hotter than boiling water? Answer yes or no.', 'no'),
  word('fmt-first', 'What is the first letter of the English alphabet? Answer with one letter.', 'a'),
  word('fmt-last', 'Spell the word "cat" backwards. Answer with the letters only.', 'tac'),
  word('seq-1', 'Continue the sequence: Monday, Tuesday, Wednesday, ... Answer with one word.', 'thursday'),
  word('seq-2', 'Continue the sequence: January, February, March, ... Answer with one word.', 'april'),
  word('lang-1', 'How do you say "hello" in Spanish? Answer with one word.', 'hola'),
  word('lang-2', 'How do you say "thank you" in French? Answer with one or two words.', 'merci'),
];

/** Fixed sentences for embedding canaries; reference vectors come from the house node. */
export const EMBEDDING_SENTENCES: readonly string[] = [
  'The quick brown fox jumps over the lazy dog.',
  'Spindle routes inference jobs to independent GPU nodes.',
  'A receipt proves which node produced which output.',
  'The capital of France is Paris.',
  'Water boils at one hundred degrees Celsius at sea level.',
  'She sells seashells by the seashore.',
  'The meeting has been moved to Thursday afternoon.',
  'Photosynthesis converts sunlight into chemical energy.',
  'He parked the car next to the old stone bridge.',
  'Please remember to back up your files regularly.',
  'The train to the airport leaves every twenty minutes.',
  'A binary search tree keeps its keys in sorted order.',
  'The recipe calls for two cups of flour and one egg.',
  'Mount Everest is the highest mountain above sea level.',
  'Rain is expected across the northern coast tomorrow.',
  'The library closes at nine o clock on weekdays.',
  'Electric cars store energy in large lithium ion batteries.',
  'The committee approved the budget after a long debate.',
  'Honey never spoils when it is stored in a sealed jar.',
  'The children built a sandcastle near the waves.',
];

export const EMBEDDING_COSINE_MIN = 0.98;
