/**
 * Calendar dates for the break, always as YYYY-MM-DD strings in the person's
 * own local time zone: "the 3rd day of my break" means the 3rd calendar day
 * where they are, wherever in the world that is. Arithmetic is done on the
 * date alone (through UTC, which has no daylight-saving jumps), so adding a
 * day can never land on the same day twice or skip one.
 */
export type IsoDate = string;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function parts(iso: IsoDate): [number, number, number] | null {
  const m = ISO.exec(iso);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false;
  const p = parts(value);
  if (!p) return false;
  const [y, m, d] = p;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function toUtcMs(iso: IsoDate): number {
  const p = parts(iso);
  if (!p) throw new Error(`Not a date: ${iso}`);
  return Date.UTC(p[0], p[1] - 1, p[2]);
}

function fromUtcMs(ms: number): IsoDate {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** The device's local calendar date for a moment (now by default). */
export function localIsoDate(moment: Date = new Date()): IsoDate {
  return `${moment.getFullYear()}-${String(moment.getMonth() + 1).padStart(2, '0')}-${String(moment.getDate()).padStart(2, '0')}`;
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return fromUtcMs(toUtcMs(iso) + days * DAY_MS);
}

/** Whole days from one date to another: positive when `to` is later. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

export const minDate = (a: IsoDate, b: IsoDate): IsoDate => (a <= b ? a : b);
export const maxDate = (a: IsoDate, b: IsoDate): IsoDate => (a >= b ? a : b);

/** How close New Year has to be for the join page to suggest starting on 1 January. */
export const NEW_YEAR_WINDOW_DAYS = 60;

/** The start date offered by default: the next 1 January when it is at most 60 days away (today, if it is 1 January), otherwise today. */
export function defaultStartDate(today: IsoDate): IsoDate {
  const year = Number(today.slice(0, 4));
  const newYear = today.slice(5) === '01-01' ? today : `${year + 1}-01-01`;
  return daysBetween(today, newYear) <= NEW_YEAR_WINDOW_DAYS ? newYear : today;
}

/* Formatting: the date is formatted as a UTC date so the local time zone can never shift it by a day. */
const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' });
const weekdayLong = fmt({ weekday: 'long' });
const dayMonthLong = fmt({ day: 'numeric', month: 'long' });
const dayMonthShort = fmt({ day: 'numeric', month: 'short' });
const weekdayShort = fmt({ weekday: 'short' });

/** "Friday 1 January 2027", "Friday 1 January" without the year, or "1 Jan" when short. */
export function formatDay(iso: IsoDate, style: 'long' | 'no-year' | 'short' | 'weekday-short' = 'long'): string {
  if (!isIsoDate(iso)) return iso;
  const date = new Date(toUtcMs(iso));
  if (style === 'short') return dayMonthShort.format(date);
  if (style === 'weekday-short') return weekdayShort.format(date);
  const base = `${weekdayLong.format(date)} ${dayMonthLong.format(date)}`;
  return style === 'no-year' ? base : `${base} ${date.getUTCFullYear()}`;
}

/** "today", "yesterday", "tomorrow", or the date without its year. */
export function relativeDay(iso: IsoDate, today: IsoDate): string {
  const diff = daysBetween(today, iso);
  if (diff === 0) return 'today';
  if (diff === -1) return 'yesterday';
  if (diff === 1) return 'tomorrow';
  return formatDay(iso, 'no-year');
}
