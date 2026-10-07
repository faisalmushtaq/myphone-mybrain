import { pick, type Rng } from './rng';

/**
 * Fun names for the leaderboard: an adjective, an animal and two digits, for
 * example "Calm Otter 42". Names only ever come from these lists, never from
 * free text, so nobody can put a real name, or anything unkind, on a public
 * leaderboard.
 *
 * The lists are kept positive and inclusive. Left out on purpose: words about
 * bodies, weight, looks or intelligence, colours (they can read as skin
 * colour), religious and national words, words about mental health, and
 * animals that are used as insults or have a rude second meaning. The unit
 * tests check the lists against a list of such words; add to both together.
 */
export const ADJECTIVES = [
  'Breezy', 'Brave', 'Bold', 'Calm', 'Cheerful', 'Cheery', 'Chirpy', 'Cosmic', 'Cosy', 'Daring',
  'Eager', 'Friendly', 'Gentle', 'Happy', 'Hopeful', 'Jolly', 'Joyful', 'Kind', 'Lively', 'Loyal',
  'Lucky', 'Mellow', 'Merry', 'Misty', 'Patient', 'Peaceful', 'Playful', 'Plucky', 'Quiet', 'Radiant',
  'Serene', 'Snowy', 'Sparkly', 'Spirited', 'Starry', 'Steady', 'Sunny', 'Thoughtful', 'Tranquil', 'Trusty',
  'Upbeat', 'Valiant', 'Warm', 'Zesty', 'Zippy',
] as const;

export const ANIMALS = [
  'Otter', 'Badger', 'Hedgehog', 'Puffin', 'Robin', 'Wren', 'Heron', 'Kingfisher', 'Owl', 'Falcon',
  'Kestrel', 'Swan', 'Penguin', 'Panda', 'Koala', 'Lynx', 'Hare', 'Squirrel', 'Dolphin', 'Seal',
  'Turtle', 'Tortoise', 'Gecko', 'Starling', 'Lark', 'Finch', 'Sparrow', 'Pelican', 'Flamingo', 'Toucan',
  'Parrot', 'Llama', 'Alpaca', 'Reindeer', 'Moose', 'Bison', 'Zebra', 'Lemur', 'Meerkat', 'Wombat',
  'Platypus', 'Bee', 'Butterfly', 'Dragonfly', 'Ladybird', 'Octopus', 'Seahorse', 'Narwhal', 'Tiger', 'Lion',
  'Leopard', 'Eagle', 'Hawk', 'Dove',
] as const;

/** Two-digit numbers with a well-known second meaning (hate-group codes, a sexual reference) are never given out. */
export const SKIPPED_NUMBERS: readonly number[] = [14, 18, 28, 69, 88];

/** 10 to 99, so the number is always two digits, without the skipped ones. */
export const NAME_NUMBERS: readonly number[] = Array.from({ length: 90 }, (_, i) => i + 10).filter((n) => !SKIPPED_NUMBERS.includes(n));

/** How many different names the lists can make. */
export const NAME_COMBINATIONS = ADJECTIVES.length * ANIMALS.length * NAME_NUMBERS.length;

const SHAPE = /^([A-Z][a-z]+) ([A-Z][a-z]+) (\d{2})$/;

export function funName(rng: Rng = Math.random): string {
  return `${pick(rng, ADJECTIVES)} ${pick(rng, ANIMALS)} ${pick(rng, NAME_NUMBERS)}`;
}

/** A new name for the Shuffle button: always different from the current one. */
export function shuffleFunName(current: string, rng: Rng = Math.random): string {
  for (let i = 0; i < 20; i += 1) {
    const next = funName(rng);
    if (next !== current) return next;
  }
  // Practically unreachable (about 200,000 names); step the number on rather than loop for ever.
  const parsed = parseFunName(current);
  if (!parsed) return funName(rng);
  const at = NAME_NUMBERS.indexOf(parsed.number);
  return `${parsed.adjective} ${parsed.animal} ${NAME_NUMBERS[(at + 1) % NAME_NUMBERS.length]}`;
}

export function parseFunName(name: string): { adjective: string; animal: string; number: number } | null {
  const m = SHAPE.exec(name);
  if (!m) return null;
  const [, adjective, animal, digits] = m;
  const number = Number(digits);
  if (!(ADJECTIVES as readonly string[]).includes(adjective) || !(ANIMALS as readonly string[]).includes(animal) || !NAME_NUMBERS.includes(number)) return null;
  return { adjective, animal, number };
}

/** True only for a name these lists could have made; anything typed in by hand fails. */
export function isFunName(name: unknown): name is string {
  return typeof name === 'string' && parseFunName(name) !== null;
}
