import { describe, expect, it } from 'vitest';
import { exampleEntries, rankEntries, type LeaderboardEntry } from './leaderboard';
import { isFunName } from './names';

const entry = (name: string, streak: number, checkIns: number): LeaderboardEntry => ({ name, streak, checkIns, brainCheckDone: false });

describe('leaderboard', () => {
  it('ranks by current streak, then by check-ins; full ties share a rank', () => {
    const ranked = rankEntries([entry('Calm Otter 42', 3, 9), entry('Brave Puffin 17', 5, 6), entry('Kind Wren 23', 3, 11), entry('Bold Heron 31', 3, 9), entry('Sunny Lark 50', 0, 2)]);
    expect(ranked.map((e) => [e.rank, e.name])).toEqual([
      [1, 'Brave Puffin 17'],
      [2, 'Kind Wren 23'],
      [3, 'Bold Heron 31'],
      [3, 'Calm Otter 42'],
      [5, 'Sunny Lark 50'],
    ]);
  });

  it('makes the same example entries every time, from the same word lists', () => {
    const a = exampleEntries(12);
    expect(a).toEqual(exampleEntries(12));
    expect(a).toHaveLength(9);
    expect(new Set(a.map((e) => e.name)).size).toBe(9);
    for (const e of a) {
      expect(isFunName(e.name)).toBe(true);
      expect(e.isExample).toBe(true);
      expect(e.streak).toBeLessThanOrEqual(e.checkIns);
      expect(e.checkIns).toBeLessThanOrEqual(12);
    }
    // Never more than the days so far, but never empty either.
    expect(Math.max(...exampleEntries(1).map((e) => e.checkIns))).toBeLessThanOrEqual(10);
  });

  it('never repeats the person’s own name among the examples', () => {
    const first = exampleEntries(12)[0].name;
    expect(exampleEntries(12, 9, [first]).map((e) => e.name)).not.toContain(first);
  });

  it('holds only the name, streak, check-ins and the brain check badge', () => {
    for (const e of exampleEntries(20)) expect(Object.keys(e).sort()).toEqual(['brainCheckDone', 'checkIns', 'isExample', 'name', 'streak']);
  });
});
