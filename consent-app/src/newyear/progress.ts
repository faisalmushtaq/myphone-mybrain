import { FOLLOW_UPS, isSlip, SCREENSHOT_EVERY_DAYS, type VisitKind } from './config';
import { addDays, daysBetween, type IsoDate } from './dates';
import type { CheckIn, Participant, Visit } from './model';
import { meetsAim } from './targets';

/**
 * The online study's arithmetic: what happened on each day of an open-ended
 * break, the streaks, the days a screenshot proves, and what is due. Pure
 * functions of the answers so far and today's local date, so they are easy
 * to test, the same in every time zone, and can be shared with the server.
 *
 * Check-ins happen any time and each one is about the time since the one
 * before (or since the start):
 *  - "still going strong": those days were kept;
 *  - "slipped": the day of the (latest) slip was a slip, the days after it
 *    kept, and the days before it unknown (there may have been other slips);
 *  - "stopped for now": those days are paused.
 * Days after the latest check-in are not reported yet. Nobody is ever locked
 * out: a check-in after a long gap covers the gap.
 *
 * A screen-time screenshot proves the days it covers: a day is verified when
 * the screenshot shows the chosen apps and AI tools at (almost) nothing and
 * total phone time under any limit set (targets.ts); it is "over" when it shows more. A screenshot outranks
 * the self-report for the days it covers.
 */
export type DayState = 'verified' | 'kept' | 'slip' | 'over' | 'paused' | 'unreported' | 'today' | 'future';

export interface DayInfo {
  date: IsoDate;
  /** 1 for the first day of the break. */
  number: number;
  state: DayState;
  /** A screenshot covers this day. */
  covered: boolean;
}

export type Phase = 'before' | 'during' | 'ended';

const sortedCheckIns = (checkIns: readonly CheckIn[]) => [...checkIns].sort((a, b) => a.at.localeCompare(b.at));
const completedVisits = (visits: readonly Visit[]) => visits.filter((v) => v.completedAt).sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));

export function phaseOf(p: Pick<Participant, 'startDate' | 'endedOn'>, today: IsoDate): Phase {
  if (p.endedOn) return 'ended';
  return today < p.startDate ? 'before' : 'during';
}

/** Day 1 is the start date. */
export const dayNumberOf = (p: Pick<Participant, 'startDate'>, date: IsoDate) => daysBetween(p.startDate, date) + 1;

/** The last day of the break to show: the day it ended, or today. */
export function lastBreakDay(p: Pick<Participant, 'startDate' | 'endedOn'>, today: IsoDate): IsoDate {
  return p.endedOn && p.endedOn < today ? p.endedOn : today;
}

/** Each day from the start to today (or the end), with what is known about it. */
export function breakDays(p: Participant, checkIns: readonly CheckIn[], visits: readonly Visit[], today: IsoDate): DayInfo[] {
  if (today < p.startDate) return [];
  const last = lastBreakDay(p, today);
  const self = new Map<IsoDate, DayState>();
  let from = p.startDate;
  for (const c of sortedCheckIns(checkIns)) {
    if (c.date < p.startDate) continue;
    const to = c.date > last ? last : c.date;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (c.status === 'stopped') self.set(d, 'paused');
      else if (isSlip(c.status) && c.slipDate === d) self.set(d, 'slip');
      // Before the (latest) slip, it isn't known whether there were others: those days stay unreported.
      else if (isSlip(c.status) && c.slipDate && d < c.slipDate) continue;
      else if (self.get(d) !== 'slip') self.set(d, 'kept');
    }
    // A slip on the day of the check-in, reported again later, stays a slip.
    if (isSlip(c.status) && c.slipDate && c.slipDate >= p.startDate && c.slipDate <= last) self.set(c.slipDate, 'slip');
    if (addDays(to, 1) > from) from = addDays(to, 1);
  }
  const shots = completedVisits(visits).flatMap((v) => (v.screenshot ? [v.screenshot] : []));
  const days: DayInfo[] = [];
  for (let d = p.startDate; d <= last; d = addDays(d, 1)) {
    const shot = [...shots].reverse().find((s) => s.from <= d && d <= s.to);
    let state: DayState = self.get(d) ?? (d === today ? 'today' : 'unreported');
    if (shot) state = meetsAim(p, shot) ? 'verified' : 'over';
    days.push({ date: d, number: dayNumberOf(p, d), state, covered: Boolean(shot) });
  }
  return days;
}

const counts = (s: DayState) => s === 'verified' || s === 'kept';

/** The run of kept or verified days up to the latest reported day; days not reported yet (at the end) are passed over. */
export function currentStreak(days: readonly DayInfo[]): { days: number; asOf: IsoDate | null } {
  let i = days.length - 1;
  while (i >= 0 && (days[i].state === 'unreported' || days[i].state === 'today')) i -= 1;
  const asOf = i >= 0 ? days[i].date : null;
  let n = 0;
  while (i >= 0 && counts(days[i].state)) {
    n += 1;
    i -= 1;
  }
  return { days: n, asOf: n ? asOf : null };
}

export function bestStreak(days: readonly DayInfo[]): number {
  let best = 0;
  let run = 0;
  for (const d of days) {
    run = counts(d.state) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

export interface Tally {
  checkIns: number;
  /** Days kept by self-report or proven by a screenshot. */
  daysOff: number;
  verified: number;
  slips: number;
}

export function tallyOf(days: readonly DayInfo[], checkIns: readonly CheckIn[]): Tally {
  return {
    checkIns: checkIns.length,
    daysOff: days.filter((d) => counts(d.state)).length,
    verified: days.filter((d) => d.state === 'verified').length,
    slips: days.filter((d) => d.state === 'slip' || d.state === 'over').length,
  };
}

/** The last day any screenshot covers (before or during the break), or null. */
export function lastCoveredDay(visits: readonly Visit[]): IsoDate | null {
  const ends = completedVisits(visits).flatMap((v) => (v.screenshot ? [v.screenshot.to] : []));
  return ends.length ? ends.sort().pop() ?? null : null;
}

/** Break days so far that no screenshot covers yet (today is never counted: it isn't over). */
export function uncoveredDays(days: readonly DayInfo[], today: IsoDate): IsoDate[] {
  return days.filter((d) => !d.covered && d.date < today).map((d) => d.date);
}

/** A screenshot is due once a week of the break is not covered, so every day is covered while the phone still holds it. */
export function screenshotDue(p: Participant, days: readonly DayInfo[], today: IsoDate): { due: boolean; oldestUncovered: IsoDate | null; uncovered: number } {
  const gaps = uncoveredDays(days, today);
  if (phaseOf(p, today) !== 'during' || !gaps.length) return { due: false, oldestUncovered: gaps[0] ?? null, uncovered: gaps.length };
  return { due: daysBetween(gaps[0], today) >= SCREENSHOT_EVERY_DAYS, oldestUncovered: gaps[0], uncovered: gaps.length };
}

export type FollowUpStatus = 'upcoming' | 'ready' | 'done' | 'missed';

export interface FollowUpPlan {
  kind: VisitKind;
  opens: IsoDate;
  closes: IsoDate;
  status: FollowUpStatus;
}

/** The follow-ups after the end visit: when each opens and closes, and where it stands. */
export function followUps(p: Participant, visits: readonly Visit[], today: IsoDate): FollowUpPlan[] {
  if (!p.endedOn) return [];
  const ended = p.endedOn;
  return FOLLOW_UPS.map(({ kind, afterDays, windowDays }) => {
    const opens = addDays(ended, afterDays);
    const closes = addDays(opens, windowDays);
    const done = visits.some((v) => v.kind === kind && v.completedAt);
    const status: FollowUpStatus = done ? 'done' : today < opens ? 'upcoming' : today < closes ? 'ready' : 'missed';
    return { kind, opens, closes, status };
  });
}

/** A visit begun but not finished, to carry on with. */
export function unfinishedVisit(visits: readonly Visit[]): Visit | null {
  return [...visits].reverse().find((v) => !v.completedAt) ?? null;
}

export const hasDone = (visits: readonly Visit[], kind: VisitKind) => visits.some((v) => v.kind === kind && v.completedAt);
