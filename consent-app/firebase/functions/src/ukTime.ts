/**
 * UK time for the lab visits: the visits happen in Leeds, so dates and times
 * on the page, in emails and in texts are UK times (GMT or BST), whatever
 * time zone the server or the reader is in.
 */

const ZONE = 'Europe/London';

const partsFormat = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export interface UkParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function ukParts(date: Date): UkParts {
  const get = (type: string) => Number(partsFormat.formatToParts(date).find((p) => p.type === type)?.value ?? Number.NaN);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The UK calendar date of a moment, YYYY-MM-DD. */
export function ukDate(date: Date): string {
  const p = ukParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** A UK date plus some days, YYYY-MM-DD. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole days from one UK date to another. */
export function daysBetween(fromIso: string, toIso: string): number {
  const at = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((at(toIso) - at(fromIso)) / 86_400_000);
}

/** The moment it is a given time of day on a given UK date (GMT or BST, whichever applies then). */
export function atUkTime(isoDate: string, hour: number, minute = 0): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  // The UK is never more than an hour ahead of UTC: try both, keep the one that reads back right.
  for (const offset of [0, 60]) {
    const candidate = new Date(guess - offset * 60_000);
    const p = ukParts(candidate);
    if (p.year === y && p.month === m && p.day === d && p.hour === hour && p.minute === minute) return candidate;
  }
  // A time skipped when the clocks go forward: the moment an hour later.
  return new Date(guess);
}

const longDate = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, weekday: 'short', day: 'numeric', month: 'short' });
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "Tuesday 14 October 2026" */
export const ukLongDate = (d: Date) => longDate.format(d).replace(',', '');
/** "Tue 14 Oct" */
export const ukShortDate = (d: Date) => shortDate.format(d).replace(',', '');
/** "10:00" */
export const ukClock = (d: Date) => clock.format(d);
/** "Tuesday 14 October 2026, 10:00 to 12:00" */
export const ukSpan = (start: Date, end: Date) => `${ukLongDate(start)}, ${ukClock(start)} to ${ukClock(end)}`;
