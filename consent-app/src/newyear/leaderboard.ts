import { funName } from './names';
import { mulberry32, randomInt } from './rng';

/**
 * The leaderboard holds only a fun name, the current streak, the number of
 * check-ins and whether the latest brain check is done. Never the apps
 * chosen, notes, moods or test scores: the entry type has no room for them.
 */
export interface LeaderboardEntry {
  name: string;
  streak: number;
  checkIns: number;
  brainCheckDone: boolean;
  /** The person using this device. */
  isYou?: boolean;
  /** An invented example for the preview. */
  isExample?: boolean;
}

export interface RankedEntry extends LeaderboardEntry {
  /** Equal streaks and check-ins share a rank (1, 2, 2, 4). */
  rank: number;
}

/** Longest current streak first, then most check-ins; names alphabetically within a tie so the order is stable. */
export function rankEntries(entries: readonly LeaderboardEntry[]): RankedEntry[] {
  const sorted = [...entries].sort((a, b) => b.streak - a.streak || b.checkIns - a.checkIns || a.name.localeCompare(b.name, 'en-GB'));
  return sorted.map((entry, i) => {
    let rank = i + 1;
    for (let j = i - 1; j >= 0 && sorted[j].streak === entry.streak && sorted[j].checkIns === entry.checkIns; j -= 1) rank = j + 1;
    return { ...entry, rank };
  });
}

export const EXAMPLE_SEED = 20270101;

/**
 * Invented entries for the preview, made from the same word lists. The same
 * seed and day always give the same entries; streaks and check-ins fit a break
 * that is `day` days in (at least 10, so the example is never empty).
 */
export function exampleEntries(day: number, count = 9, exclude: readonly string[] = [], seed = EXAMPLE_SEED): LeaderboardEntry[] {
  const rng = mulberry32(seed);
  const days = Math.max(10, Math.floor(day));
  const names = new Set<string>();
  const entries: LeaderboardEntry[] = [];
  while (entries.length < count) {
    const name = funName(rng);
    const checkIns = randomInt(rng, Math.floor(days / 3), days);
    const streak = randomInt(rng, 0, checkIns);
    const brainCheckDone = rng() < 0.7;
    if (names.has(name) || exclude.includes(name)) continue;
    names.add(name);
    entries.push({ name, streak, checkIns, brainCheckDone, isExample: true });
  }
  return entries;
}
