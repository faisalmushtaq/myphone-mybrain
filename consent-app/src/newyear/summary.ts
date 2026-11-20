import type { IsoDate } from './dates';
import type { LeaderboardEntry } from './leaderboard';
import type { NyState, Participant, Visit } from './model';
import { bestStreak, breakDays, currentStreak, dayNumberOf, followUps, hasDone, phaseOf, screenshotDue, tallyOf, unfinishedVisit, type DayInfo, type FollowUpPlan, type Phase, type Tally } from './progress';

/** Everything the tracker shows, worked out from the saved answers and today's date. */
export interface BreakSummary {
  participant: Participant;
  today: IsoDate;
  phase: Phase;
  /** Day N of the break (0 or less before it starts). */
  dayNumber: number;
  days: DayInfo[];
  streak: number;
  streakAsOf: IsoDate | null;
  best: number;
  tally: Tally;
  startDone: boolean;
  endDone: boolean;
  shot: { due: boolean; oldestUncovered: IsoDate | null; uncovered: number };
  followUps: FollowUpPlan[];
  unfinished: Visit | null;
  /** The latest check-in, if any. */
  lastCheckIn: { date: IsoDate; status: string } | null;
  /** The latest completed visit with a screenshot (its scores count as validated). */
  latestValidated: Visit | null;
}

export function summarise(state: Pick<NyState, 'participant' | 'checkIns' | 'visits'>, today: IsoDate): BreakSummary | null {
  const p = state.participant;
  if (!p) return null;
  const days = breakDays(p, state.checkIns, state.visits, today);
  const streak = currentStreak(days);
  const last = [...state.checkIns].sort((a, b) => a.at.localeCompare(b.at)).pop();
  const validated = state.visits.filter((v) => v.completedAt && v.screenshot && (v.digitSpan || v.oddball)).sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));
  return {
    participant: p,
    today,
    phase: phaseOf(p, today),
    dayNumber: dayNumberOf(p, today),
    days,
    streak: streak.days,
    streakAsOf: streak.asOf,
    best: bestStreak(days),
    tally: tallyOf(days, state.checkIns),
    startDone: hasDone(state.visits, 'start'),
    endDone: hasDone(state.visits, 'end'),
    shot: screenshotDue(p, days, today),
    followUps: followUps(p, state.visits, today),
    unfinished: unfinishedVisit(state.visits),
    lastCheckIn: last ? { date: last.date, status: last.status } : null,
    latestValidated: validated.pop() ?? null,
  };
}

/** The person's own line on the leaderboard: the fun name and counts only. */
export function ownEntry(s: BreakSummary): LeaderboardEntry {
  return { name: s.participant.name, verified: s.tally.verified, streak: s.streak, checkIns: s.tally.checkIns, validated: Boolean(s.latestValidated), isYou: true };
}
