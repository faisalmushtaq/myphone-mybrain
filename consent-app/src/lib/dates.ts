import type { DateParts } from '../model/types';

export function toInt(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

/** Returns a Date (UTC midnight) if the parts form a real calendar date. */
export function partsToDate(parts: DateParts): Date | null {
  const d = toInt(parts.day);
  const m = toInt(parts.month);
  const y = toInt(parts.year);
  if (d === null || m === null || y === null) return null;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

export function partsToIso(parts: DateParts): string | null {
  const date = partsToDate(parts);
  return date ? date.toISOString().slice(0, 10) : null;
}

/** Whole years between a date of birth and today. */
export function ageOn(dob: Date, today = new Date()): number {
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < dob.getUTCMonth() ||
    (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * The school year group in England for a date of birth: the year group is
 * set by a pupil's age on 31 August, just before the school year starts on
 * 1 September (Year 7 are 11 then, Year 13 are 17). Fills in the year group
 * from the date of birth; the person can still change it. Null outside
 * Years 7 to 13.
 */
export function schoolYearFor(parts: DateParts, today = new Date()): string | null {
  const dob = partsToDate(parts);
  if (!dob) return null;
  // Before September, the school year is the one that started last September.
  const startYear = today.getMonth() >= 8 ? today.getFullYear() : today.getFullYear() - 1;
  const year = ageOn(dob, new Date(Date.UTC(startYear, 7, 31))) - 4;
  return year >= 7 && year <= 13 ? `Year ${year}` : null;
}

/** Today's date as YYYY-MM-DD in the device's local time zone. */
export function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const longDateTime = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** "28 September 2026" from YYYY-MM-DD. */
export function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((n) => Number.parseInt(n, 10));
  if (!y || !m || !d) return iso;
  return longDate.format(new Date(y, m - 1, d));
}

export function formatParts(parts: DateParts): string {
  const iso = partsToIso(parts);
  return iso ? formatIsoDate(iso) : '';
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : longDateTime.format(date);
}

/** YYYY-MM-DD for a date a number of whole years before today (local time). */
export function isoYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The dates of birth that fit the study's age range, for a date picker's min and max. */
export function dateOfBirthRange(minAge = 11, maxAge = 18): { min: string; max: string } {
  return { min: isoYearsAgo(maxAge + 1), max: isoYearsAgo(minAge) };
}
