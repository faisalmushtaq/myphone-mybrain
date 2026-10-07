import { addDays, daysBetween, minDate, type IsoDate } from './dates';

/**
 * The tracker's arithmetic: which day of the break it is, which days can be
 * checked in, and the streaks. Pure functions of the plan, the answers so far
 * and today's local date, so they are easy to test and the same in every
 * time zone.
 *
 * Each check-in is about one day of the break (normally yesterday). A day
 * counts as kept only when the answer is "Yes, completely". A slip ends the
 * current streak but nothing else: the best streak, the days kept and the
 * check-ins all stay. A day that can still be filled in (yesterday and the
 * day before) neither counts nor breaks the streak until it is.
 */
export type KeptAnswer = 'yes' | 'little' | 'lot';

export interface DayEntry {
  kept: KeptAnswer;
}

export interface BreakPlan {
  startDate: IsoDate;
  lengthDays: number;
}

/** A missed day can be filled in up to this many days later (yesterday is 1). */
export const CHECK_IN_DAYS_BACK = 2;

export function breakEnd(plan: BreakPlan): IsoDate {
  return addDays(plan.startDate, plan.lengthDays - 1);
}

/** Day 1 is the start date; 0 or less is before the break, more than its length after it. */
export function dayNumber(plan: BreakPlan, today: IsoDate): number {
  return daysBetween(plan.startDate, today) + 1;
}

export type BreakPhase = 'before' | 'during' | 'after';

export function breakPhase(plan: BreakPlan, today: IsoDate): BreakPhase {
  const n = dayNumber(plan, today);
  return n < 1 ? 'before' : n > plan.lengthDays ? 'after' : 'during';
}

export function isBreakDay(plan: BreakPlan, date: IsoDate): boolean {
  return date >= plan.startDate && date <= breakEnd(plan);
}

/** Today, or a past day that can still be filled in. */
function pending(date: IsoDate, today: IsoDate): boolean {
  return daysBetween(date, today) <= CHECK_IN_DAYS_BACK;
}

/** The days that can be checked in today, most recent first: yesterday and the day before, if they are break days without an answer. */
export function checkInDays(plan: BreakPlan, entries: Record<IsoDate, DayEntry>, today: IsoDate): IsoDate[] {
  const days: IsoDate[] = [];
  for (let back = 1; back <= CHECK_IN_DAYS_BACK; back += 1) {
    const date = addDays(today, -back);
    if (isBreakDay(plan, date) && !entries[date]) days.push(date);
  }
  return days;
}

/** Consecutive kept days, counting back from today (or the last day of the break). Days that can still be filled in are passed over. */
export function currentStreak(plan: BreakPlan, entries: Record<IsoDate, DayEntry>, today: IsoDate): number {
  let streak = 0;
  for (let date = minDate(today, breakEnd(plan)); date >= plan.startDate; date = addDays(date, -1)) {
    const entry = entries[date];
    if (entry) {
      if (entry.kept !== 'yes') break;
      streak += 1;
    } else if (!pending(date, today)) {
      break;
    }
  }
  return streak;
}

/** The longest run of kept days so far, by the same rules as the current streak. */
export function bestStreak(plan: BreakPlan, entries: Record<IsoDate, DayEntry>, today: IsoDate): number {
  let best = 0;
  let run = 0;
  for (let date = plan.startDate; date <= minDate(today, breakEnd(plan)); date = addDays(date, 1)) {
    const entry = entries[date];
    if (entry?.kept === 'yes') {
      run += 1;
      best = Math.max(best, run);
    } else if (entry || !pending(date, today)) {
      run = 0;
    }
  }
  return best;
}

export interface Tally {
  checkIns: number;
  kept: number;
  slipped: number;
}

/** Answers for days of this break only. */
export function tally(plan: BreakPlan, entries: Record<IsoDate, DayEntry>): Tally {
  const within = Object.entries(entries).filter(([date]) => isBreakDay(plan, date));
  const kept = within.filter(([, e]) => e.kept === 'yes').length;
  return { checkIns: within.length, kept, slipped: within.length - kept };
}

export type DayState = 'kept' | 'slipped' | 'not-checked' | 'future';

export interface BreakDay {
  date: IsoDate;
  /** 1 for the first day of the break. */
  number: number;
  state: DayState;
  slip: 'little' | 'lot' | null;
  isToday: boolean;
  /** No answer yet, but it can still be filled in. */
  canCheckIn: boolean;
}

/** Every day of the break, for the calendar. Today and later are "future": a day is only asked about once it is over. */
export function breakDays(plan: BreakPlan, entries: Record<IsoDate, DayEntry>, today: IsoDate): BreakDay[] {
  return Array.from({ length: plan.lengthDays }, (_, i) => {
    const date = addDays(plan.startDate, i);
    const entry = entries[date];
    const state: DayState = entry ? (entry.kept === 'yes' ? 'kept' : 'slipped') : date >= today ? 'future' : 'not-checked';
    return {
      date,
      number: i + 1,
      state,
      slip: entry && entry.kept !== 'yes' ? entry.kept : null,
      isToday: date === today,
      canCheckIn: state === 'not-checked' && pending(date, today),
    };
  });
}
