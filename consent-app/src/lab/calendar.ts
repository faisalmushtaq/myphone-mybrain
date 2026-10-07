import type { LabBooking, LabPlace } from '../api/types';
import { labBooking } from './booking';

/**
 * Dates and times for the lab visits, always in UK time (the visits are in
 * Leeds, whatever time zone the phone is set to), and the "add to calendar"
 * links: the calendar file the server made, or Google Calendar's own page.
 */

const ZONE = labBooking.timeZone;
const dayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, weekday: 'long', day: 'numeric', month: 'long' });
const dayYearFormat = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const clockFormat = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const isoDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "Wednesday 14 October" */
export const ukDay = (iso: string) => dayFormat.format(new Date(iso)).replace(',', '');
/** "Wednesday 14 October 2026" */
export const ukDayYear = (iso: string) => dayYearFormat.format(new Date(iso)).replace(',', '');
/** "10:00" */
export const ukClock = (iso: string) => clockFormat.format(new Date(iso));
/** "10:00 to 12:00" */
export const ukHours = (start: string, end: string) => `${ukClock(start)} to ${ukClock(end)}`;
/** The UK calendar date of a moment, YYYY-MM-DD. */
export const ukIsoDay = (iso: string) => isoDayFormat.format(new Date(iso));
/** A UK date (YYYY-MM-DD) in words, "Wednesday 14 October 2026". */
export const ukDateWords = (isoDay: string) => ukDayYear(`${isoDay}T12:00:00Z`);

export const placeLine = (p: LabPlace) => [p.name, p.address].filter(Boolean).join(', ');

export const visitName = (visit: 1 | 2) => (visit === 1 ? 'first lab visit' : 'second lab visit');
export const visitTitle = (visit: 1 | 2) => labBooking.visits.find((v) => v.visit === visit)?.title ?? (visit === 1 ? 'First lab visit' : 'Second lab visit');

/** Times grouped by UK day, in order. */
export function byDay<T extends { start: string }>(slots: T[]): { day: string; slots: T[] }[] {
  const out = new Map<string, T[]>();
  for (const s of [...slots].sort((a, b) => a.start.localeCompare(b.start))) {
    const day = ukIsoDay(s.start);
    out.set(day, [...(out.get(day) ?? []), s]);
  }
  return Array.from(out, ([day, list]) => ({ day, slots: list }));
}

/** Saves the visit's calendar file, which opens in the phone's or computer's own calendar. */
export function downloadIcs(booking: LabBooking): string {
  const name = `myphone-mybrain-visit-${booking.visit}.ics`;
  const url = URL.createObjectURL(new Blob([booking.ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Google Calendar's page for adding the visit, for phones that do not open calendar files. */
export function googleCalendarUrl(booking: LabBooking, code: string): string {
  const info = labBooking.visits.find((v) => v.visit === booking.visit);
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', info?.summary ?? 'MyPhone/MyBrain lab visit');
  url.searchParams.set('dates', `${stamp(booking.start)}/${stamp(booking.end)}`);
  url.searchParams.set('location', placeLine(booking.place));
  url.searchParams.set('details', [info?.what, booking.place.directions, `Participant ID: ${code}`].filter(Boolean).join('\n'));
  return url.toString();
}

/** A calendar file made in the browser: only the in-memory preview needs one (the server makes the real ones). */
export function previewIcs(b: { code: string; visit: 1 | 2; start: string; end: string; place: LabPlace; sequence?: number; cancelled?: boolean }): string {
  const info = labBooking.visits.find((v) => v.visit === b.visit);
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MyPhone MyBrain//Lab visits//EN',
    `METHOD:${b.cancelled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${b.code}-visit-${b.visit}@myphonemybrain.com`,
    `SEQUENCE:${b.sequence ?? 0}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(b.start)}`,
    `DTEND:${stamp(b.end)}`,
    `SUMMARY:${esc(info?.summary ?? 'Lab visit')}`,
    `LOCATION:${esc(placeLine(b.place))}`,
    `STATUS:${b.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

const partsFormat = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** The moment it is a given time on a given UK date (GMT or BST, whichever applies then). */
export function atUkTime(isoDay: string, hour: number, minute = 0): Date {
  const [y, m, d] = isoDay.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  for (const offset of [0, 60]) {
    const candidate = new Date(guess - offset * 60_000);
    const p = Object.fromEntries(partsFormat.formatToParts(candidate).map((x) => [x.type, Number(x.value)]));
    if (p.year === y && p.month === m && p.day === d && p.hour === hour && p.minute === minute) return candidate;
  }
  return new Date(guess);
}

/** A UK date plus some days, YYYY-MM-DD. */
export function addDays(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Days from one UK date to another (YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export type DayRange = { from: string; to: string };

/** The UK dates the second visit can be on: gap.min to gap.max days after the first (inclusive). */
export const secondVisitDays = (firstStart: string, gap: { min: number; max: number }): DayRange => ({ from: addDays(ukIsoDay(firstStart), gap.min), to: addDays(ukIsoDay(firstStart), gap.max) });

/** The UK dates the first visit can be on when the second stays where it is. */
export const firstVisitDays = (secondStart: string, gap: { min: number; max: number }): DayRange => ({ from: addDays(ukIsoDay(secondStart), -gap.max), to: addDays(ukIsoDay(secondStart), -gap.min) });

/** Whether a moment falls on one of the UK dates in a range. */
export const onDays = (iso: string, days: DayRange) => ukIsoDay(iso) >= days.from && ukIsoDay(iso) <= days.to;
