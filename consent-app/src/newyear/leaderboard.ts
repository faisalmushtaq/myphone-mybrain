import { funName } from './names';
import { mulberry32, randomInt } from './rng';

/**
 * The leaderboard holds only a fun name, the days a screenshot proves, the
 * current streak, the number of check-ins and whether the latest visit's
 * scores are validated. Never the apps chosen, notes, moods, scores or
 * screenshots: the entry type has no room for them.
 */
export interface LeaderboardEntry {
  name: string;
  /** Days off proven by a screen-time screenshot. */
  verified: number;
  /** Current streak (self-report and screenshots). */
  streak: number;
  checkIns: number;
  /** The latest visit came with a screenshot. */
  validated: boolean;
  /** The person using this device. */
  isYou?: boolean;
  /** An invented example for the preview. */
  isExample?: boolean;
}

export interface RankedEntry extends LeaderboardEntry {
  /** Equal verified days and streaks share a rank (1, 2, 2, 4). */
  rank: number;
}

/** Most proven days first, then the longest current streak; names alphabetically within a tie so the order is stable. */
export function rankEntries(entries: readonly LeaderboardEntry[]): RankedEntry[] {
  const sorted = [...entries].sort((a, b) => b.verified - a.verified || b.streak - a.streak || a.name.localeCompare(b.name, 'en-GB'));
  return sorted.map((entry, i) => {
    let rank = i + 1;
    for (let j = i - 1; j >= 0 && sorted[j].verified === entry.verified && sorted[j].streak === entry.streak; j -= 1) rank = j + 1;
    return { ...entry, rank };
  });
}

export const EXAMPLE_SEED = 20270101;

/**
 * Invented entries for the preview, made from the same word lists. Each is a
 * break that started on a different day, up to `maxDays` days ago (at least
 * 14, so the example is never empty), with counts that fit it: verified days
 * and the streak never exceed the days so far. The same seed always gives the
 * same entries.
 */
export function exampleEntries(maxDays: number, count = 9, exclude: readonly string[] = [], seed = EXAMPLE_SEED): LeaderboardEntry[] {
  const rng = mulberry32(seed);
  const span = Math.max(14, Math.floor(maxDays));
  const names = new Set<string>();
  const entries: LeaderboardEntry[] = [];
  while (entries.length < count) {
    const name = funName(rng);
    const daysSoFar = randomInt(rng, 1, span);
    const streak = randomInt(rng, 0, daysSoFar);
    const verified = randomInt(rng, 0, Math.max(0, daysSoFar - 1));
    const checkIns = randomInt(rng, Math.ceil(daysSoFar / 4), daysSoFar + 3);
    if (names.has(name) || exclude.includes(name)) continue;
    names.add(name);
    entries.push({ name, verified, streak, checkIns, validated: verified > 0 && rng() < 0.8, isExample: true });
  }
  return entries;
}
