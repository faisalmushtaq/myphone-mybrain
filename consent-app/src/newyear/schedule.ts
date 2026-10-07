import { addDays, minDate, type IsoDate } from './dates';
import { breakEnd, type BreakPlan } from './streaks';

/**
 * When the brain checks happen. Day 1 is the first day of the break.
 *
 *   baseline   day 0, before the break: open from joining, ideally done by the first day
 *   halfway    the day half the break has been completed (day 4 of 7, 8 of 14, 16 of 30)
 *   end        the last day of the break, with a week to do it
 *   follow-up  optional, 30 days after the last day, with two weeks to do it
 *
 * Each check stays open until the next one opens (the end and follow-up
 * checks for a fixed time), so a late check is still possible; after that it
 * counts as missed.
 */
export type StageId = 'baseline' | 'halfway' | 'end' | 'followup';

export const STAGE_IDS: readonly StageId[] = ['baseline', 'halfway', 'end', 'followup'];

export const END_WINDOW_DAYS = 7;
export const FOLLOW_UP_AFTER_DAYS = 30;
export const FOLLOW_UP_WINDOW_DAYS = 14;

export interface StagePlan {
  id: StageId;
  /** Break day number: 0 is the day before the break starts. */
  day: number;
  /** The day the check is meant for. */
  date: IsoDate;
  /** First day it can be done. */
  opens: IsoDate;
  /** Best done by this day (shown to the person; nothing is enforced). */
  dueBy: IsoDate;
  /** First day it can no longer be done. */
  closes: IsoDate;
  optional: boolean;
}

export function stagePlan(plan: BreakPlan & { joinedOn: IsoDate }): StagePlan[] {
  const start = plan.startDate;
  const end = breakEnd(plan);
  const half = Math.floor(plan.lengthDays / 2);
  const baselineDate = addDays(start, -1);
  const halfwayDate = addDays(start, half);
  const followUpDate = addDays(end, FOLLOW_UP_AFTER_DAYS);
  return [
    { id: 'baseline', day: 0, date: baselineDate, opens: minDate(plan.joinedOn, baselineDate), dueBy: start, closes: halfwayDate, optional: false },
    { id: 'halfway', day: half + 1, date: halfwayDate, opens: halfwayDate, dueBy: addDays(halfwayDate, 2), closes: end, optional: false },
    { id: 'end', day: plan.lengthDays, date: end, opens: end, dueBy: addDays(end, 2), closes: addDays(end, END_WINDOW_DAYS), optional: false },
    { id: 'followup', day: plan.lengthDays + FOLLOW_UP_AFTER_DAYS, date: followUpDate, opens: followUpDate, dueBy: addDays(followUpDate, 7), closes: addDays(followUpDate, FOLLOW_UP_WINDOW_DAYS), optional: true },
  ];
}

export type StageStatus = 'done' | 'ready' | 'upcoming' | 'missed';

export function stageStatus(stage: StagePlan, done: boolean, today: IsoDate): StageStatus {
  if (done) return 'done';
  if (today < stage.opens) return 'upcoming';
  return today < stage.closes ? 'ready' : 'missed';
}

/** The next check to do: the first that is ready, or else the first still to come. */
export function nextStage(stages: StagePlan[], done: ReadonlySet<StageId>, today: IsoDate): { stage: StagePlan; status: 'ready' | 'upcoming' } | null {
  for (const stage of stages) {
    const status = stageStatus(stage, done.has(stage.id), today);
    if (status === 'ready' || status === 'upcoming') return { stage, status };
  }
  return null;
}

/** The most recent check that has opened (for the leaderboard's badge), or null before any has. */
export function latestOpenedStage(stages: StagePlan[], today: IsoDate): StagePlan | null {
  const opened = stages.filter((s) => s.opens <= today);
  return opened.length ? opened[opened.length - 1] : null;
}
