import type { IsoDate } from './dates';
import type { LeaderboardEntry } from './leaderboard';
import type { NyState, Participant } from './model';
import { latestOpenedStage, nextStage, stagePlan, stageStatus, STAGE_IDS, type StageId, type StagePlan, type StageStatus } from './schedule';
import { bestStreak, breakDays, breakEnd, breakPhase, checkInDays, currentStreak, dayNumber, tally, type BreakDay, type BreakPhase, type BreakPlan, type Tally } from './streaks';

/** Everything the tracker shows, worked out from the saved answers and today's date. */
export interface BreakSummary {
  participant: Participant;
  plan: BreakPlan;
  endDate: IsoDate;
  today: IsoDate;
  dayNumber: number;
  phase: BreakPhase;
  streak: number;
  best: number;
  tally: Tally;
  days: BreakDay[];
  /** Days that can be checked in today, most recent first. */
  openDays: IsoDate[];
  stages: { plan: StagePlan; status: StageStatus }[];
  next: { stage: StagePlan; status: 'ready' | 'upcoming' } | null;
  /** The badge on the leaderboard: the most recent check that has opened is done. */
  latestCheckDone: boolean;
}

export function summarise(state: Pick<NyState, 'participant' | 'checkIns' | 'stages'>, today: IsoDate): BreakSummary | null {
  const participant = state.participant;
  if (!participant) return null;
  const plan: BreakPlan = { startDate: participant.startDate, lengthDays: participant.lengthDays };
  const planned = stagePlan({ ...plan, joinedOn: participant.joinedOn });
  const done = new Set<StageId>(STAGE_IDS.filter((id) => Boolean(state.stages[id]?.completedAt)));
  const latest = latestOpenedStage(planned, today);
  return {
    participant,
    plan,
    endDate: breakEnd(plan),
    today,
    dayNumber: dayNumber(plan, today),
    phase: breakPhase(plan, today),
    streak: currentStreak(plan, state.checkIns, today),
    best: bestStreak(plan, state.checkIns, today),
    tally: tally(plan, state.checkIns),
    days: breakDays(plan, state.checkIns, today),
    openDays: checkInDays(plan, state.checkIns, today),
    stages: planned.map((s) => ({ plan: s, status: stageStatus(s, done.has(s.id), today) })),
    next: nextStage(planned, done, today),
    latestCheckDone: latest ? done.has(latest.id) : false,
  };
}

/** The person's own line on the leaderboard: the fun name and counts only. */
export function ownEntry(summary: BreakSummary): LeaderboardEntry {
  return { name: summary.participant.name, streak: summary.streak, checkIns: summary.tally.checkIns, brainCheckDone: summary.latestCheckDone, isYou: true };
}
