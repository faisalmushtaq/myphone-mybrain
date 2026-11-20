import { describe, expect, it } from 'vitest';
import { exampleEntries, rankEntries, type LeaderboardEntry } from './leaderboard';
import { isFunName } from './names';

const entry = (name: string, verified: number, streak: number): LeaderboardEntry => ({ name, verified, streak, checkIns: 5, validated: false });

describe('leaderboard', () => {
  it('ranks by days proven by screenshots, then by current streak; full ties share a rank', () => {
    const ranked = rankEntries([entry('Calm Otter 42', 7, 3), entry('Brave Puffin 17', 14, 2), entry('Kind Wren 23', 7, 9), entry('Bold Heron 31', 7, 3), entry('Sunny Lark 50', 0, 20)]);
    expect(ranked.map((e) => [e.rank, e.name])).toEqual([
      [1, 'Brave Puffin 17'],
      [2, 'Kind Wren 23'],
      [3, 'Bold Heron 31'],
      [3, 'Calm Otter 42'],
      [5, 'Sunny Lark 50'],
    ]);
  });

  it('makes the same example entries every time, each possible for a break of its length', () => {
    const a = exampleEntries(20);
    expect(a).toEqual(exampleEntries(20));
    expect(a).toHaveLength(9);
    expect(new Set(a.map((e) => e.name)).size).toBe(9);
    for (const e of a) {
      expect(isFunName(e.name)).toBe(true);
      expect(e.isExample).toBe(true);
      expect(e.streak).toBeLessThanOrEqual(20);
      expect(e.verified).toBeLessThan(20);
      if (e.validated) expect(e.verified).toBeGreaterThan(0);
    }
    // Early on, still possible: nothing longer than two weeks.
    for (const e of exampleEntries(1)) expect(Math.max(e.streak, e.verified)).toBeLessThanOrEqual(14);
  });

  it('never repeats the person’s own name among the examples', () => {
    const first = exampleEntries(12)[0].name;
    expect(exampleEntries(12, 9, [first]).map((e) => e.name)).not.toContain(first);
  });

  it('holds only the name, the counts and the validated badge', () => {
    for (const e of exampleEntries(20)) expect(Object.keys(e).sort()).toEqual(['checkIns', 'isExample', 'name', 'streak', 'validated', 'verified']);
  });
});
