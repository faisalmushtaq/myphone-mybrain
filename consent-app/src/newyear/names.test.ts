import { describe, expect, it } from 'vitest';
import { ADJECTIVES, ANIMALS, funName, isFunName, NAME_COMBINATIONS, NAME_NUMBERS, parseFunName, shuffleFunName, SKIPPED_NUMBERS } from './names';
import { mulberry32 } from './rng';

/**
 * Words that must never be part of a name on a public leaderboard. Not a
 * complete list of everything unkind, but a check that the curated lists stay
 * clear of the kinds of words that were left out on purpose.
 */
const NEVER = [
  // bodies, weight, looks
  'fat', 'thin', 'slim', 'skinny', 'chubby', 'plump', 'big', 'small', 'tiny', 'tall', 'short', 'strong', 'weak', 'heavy', 'round', 'lanky', 'mighty', 'muscly',
  'pale', 'fair', 'bald', 'hairy', 'fluffy', 'fuzzy', 'ugly', 'pretty', 'cute', 'handsome', 'beautiful', 'gorgeous', 'hot', 'sexy', 'foxy',
  // intelligence
  'smart', 'clever', 'wise', 'bright', 'brainy', 'genius', 'witty', 'sharp', 'quick', 'slow', 'dim', 'dumb', 'stupid', 'silly',
  // mental health
  'crazy', 'mad', 'insane', 'psycho', 'nuts', 'manic', 'mental', 'loopy', 'bonkers',
  // religion
  'holy', 'blessed', 'divine', 'angelic', 'sacred', 'saintly', 'pious', 'zen', 'heavenly', 'christian', 'muslim', 'jewish', 'hindu', 'buddhist', 'sikh',
  // nationality and place
  'english', 'british', 'scottish', 'welsh', 'irish', 'french', 'german', 'african', 'asian', 'american', 'indian', 'chinese', 'arctic',
  // colours
  'black', 'white', 'brown', 'yellow', 'red', 'golden', 'dark', 'amber', 'ginger',
  // other unkind words
  'lazy', 'sleepy', 'grumpy', 'angry', 'naughty', 'wild', 'drunk', 'tipsy',
  // animals used as insults or with a rude second meaning
  'pig', 'cow', 'rat', 'snake', 'donkey', 'monkey', 'ape', 'gorilla', 'baboon', 'chicken', 'sheep', 'worm', 'slug', 'sloth', 'weasel', 'vulture', 'hyena', 'skunk', 'cockroach',
  'leech', 'whale', 'elephant', 'hippo', 'walrus', 'cougar', 'fox', 'beaver', 'cock', 'tit', 'booby', 'shag', 'bat', 'crow', 'magpie', 'wolf', 'kitten', 'bunny', 'dog', 'bitch',
  'ass', 'mole', 'jellyfish', 'crab', 'cheetah', 'panther', 'giraffe', 'goat', 'goose', 'manatee', 'woodcock',
];

describe('fun names', () => {
  it('are an adjective, an animal and two digits, like "Calm Otter 42"', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 500; i += 1) {
      const name = funName(rng);
      expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d{2}$/);
      expect(isFunName(name), name).toBe(true);
    }
  });

  it('come only from the lists: typed-in names and anything else are refused', () => {
    expect(isFunName('Calm Otter 42')).toBe(true);
    for (const bad of ['', 'Jane Smith 42', 'Calm Otter', 'Calm Otter 4', 'Calm Otter 042', 'calm otter 42', 'Calm  Otter 42', 'Calm Pig 42', 'Clever Otter 42', 'Calm Otter 88', 'Calm Otter 05', 'Calm Otter 42 ', '<b>Calm</b> Otter 42', 42, null]) {
      expect(isFunName(bad), String(bad)).toBe(false);
    }
    expect(parseFunName('Brave Puffin 17')).toEqual({ adjective: 'Brave', animal: 'Puffin', number: 17 });
  });

  it('keeps the word lists tidy, kind and safe', () => {
    for (const word of [...ADJECTIVES, ...ANIMALS]) {
      expect(word, word).toMatch(/^[A-Z][a-z]+$/);
      expect(NEVER, word).not.toContain(word.toLowerCase());
    }
    expect(new Set(ADJECTIVES).size).toBe(ADJECTIVES.length);
    expect(new Set(ANIMALS).size).toBe(ANIMALS.length);
    expect(ADJECTIVES.filter((a) => (ANIMALS as readonly string[]).includes(a))).toEqual([]);
    expect(ADJECTIVES.length).toBeGreaterThanOrEqual(40);
    expect(ANIMALS.length).toBeGreaterThanOrEqual(40);
  });

  it('never gives out numbers with an unfortunate second meaning, and always two digits', () => {
    for (const n of SKIPPED_NUMBERS) expect(NAME_NUMBERS).not.toContain(n);
    expect(Math.min(...NAME_NUMBERS)).toBe(10);
    expect(Math.max(...NAME_NUMBERS)).toBe(99);
    const rng = mulberry32(7);
    for (let i = 0; i < 2000; i += 1) {
      const number = Number(funName(rng).slice(-2));
      expect(SKIPPED_NUMBERS).not.toContain(number);
    }
    expect(NAME_COMBINATIONS).toBeGreaterThan(150_000);
  });

  it('shuffles to a different name every time, and the same seed gives the same names', () => {
    const rng = mulberry32(99);
    let name = funName(rng);
    const seen = new Set([name]);
    for (let i = 0; i < 50; i += 1) {
      const next = shuffleFunName(name, rng);
      expect(next).not.toBe(name);
      expect(isFunName(next)).toBe(true);
      seen.add(next);
      name = next;
    }
    expect(seen.size).toBeGreaterThan(40);
    expect(funName(mulberry32(5))).toBe(funName(mulberry32(5)));
    // Even a generator stuck on one value moves on.
    const stuck = () => 0;
    expect(shuffleFunName(funName(stuck), stuck)).not.toBe(funName(stuck));
  });
});
