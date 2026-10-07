import { describe, expect, it } from 'vitest';
import { pointOf, sharesAt, sharesInWords } from './Signifiers';
import { storyStructures, storySurveyUrl } from '../mystory';
import { byDay, daysBetween, firstVisitDays, googleCalendarUrl, onDays, secondVisitDays, ukClock, ukDateWords, ukHours, ukIsoDay } from '../calendar';
import { labBooking } from '../booking';
import { ukMobile } from '../validation';

describe('MyStory signifiers', () => {
  it('the triangle: corners give all of one thing, the middle a third each, points outside are pulled in', () => {
    expect(sharesAt(150, 16)).toEqual({ a: 1, b: 0, c: 0 });
    expect(sharesAt(16, 246)).toEqual({ a: 0, b: 1, c: 0 });
    const middle = sharesAt(150, (16 + 246 + 246) / 3);
    expect(middle.a).toBeCloseTo(1 / 3, 2);
    expect(middle.a + middle.b + middle.c).toBeCloseTo(1, 5);
    const outside = sharesAt(-100, 400);
    expect(outside.a + outside.b + outside.c).toBeCloseTo(1, 5);
    expect(Math.min(outside.a, outside.b, outside.c)).toBeGreaterThanOrEqual(0);
    const p = pointOf({ a: 0.2, b: 0.5, c: 0.3 });
    expect(sharesAt(p.x, p.y)).toEqual({ a: 0.2, b: 0.5, c: 0.3 });
  });

  it('says the triangle answer in words', () => {
    expect(sharesInWords({ a: 0.6, b: 0.3, c: 0.1 }, ['Habit', 'People', 'Boredom'])).toBe('Mostly Habit (60%), then People (30%) and Boredom (10%).');
    expect(sharesInWords({ a: 0.34, b: 0.33, c: 0.33 }, ['Habit', 'People', 'Boredom'])).toBe('About equally Habit, People, Boredom.');
  });

  it('each phase’s structure, and another survey given the participant ID and the phase', () => {
    expect(storyStructures.pre.phase).toBe('pre');
    expect(storySurveyUrl('mid', 'MP2670FF90A5F2')).toBeNull();
    expect(storySurveyUrl('mid', 'MP2670FF90A5F2', { mode: 'link', name: 'MySelf', url: 'https://leeds.eu.qualtrics.com/jfe/form/SV_abc?src=site', idParam: 'pid', phaseParam: 'phase' })).toBe('https://leeds.eu.qualtrics.com/jfe/form/SV_abc?src=site&pid=MP2670FF90A5F2&phase=mid');
  });
});

describe('lab visit times', () => {
  it('are shown in UK time whatever the device’s zone, grouped by UK day', () => {
    expect(ukClock('2026-10-14T09:00:00.000Z')).toBe('10:00');
    expect(ukHours('2026-12-14T10:00:00.000Z', '2026-12-14T12:00:00.000Z')).toBe('10:00 to 12:00');
    expect(ukIsoDay('2026-06-30T23:30:00.000Z')).toBe('2026-07-01');
    expect(ukDateWords('2026-10-14')).toBe('Wednesday 14 October 2026');
    const days = byDay([{ start: '2026-10-15T09:00:00.000Z' }, { start: '2026-10-14T13:00:00.000Z' }, { start: '2026-10-14T09:00:00.000Z' }]);
    expect(days.map((d) => [d.day, d.slots.length])).toEqual([['2026-10-14', 2], ['2026-10-15', 1]]);
  });

  it('add to Google Calendar carries the time in UTC and the place', () => {
    const url = new URL(googleCalendarUrl({ bookingId: 'b', visit: 1, start: '2026-10-14T09:00:00.000Z', end: '2026-10-14T11:00:00.000Z', place: { name: 'School of Psychology, University of Leeds', address: 'Leeds LS2 9JT', directions: '' }, status: 'booked', canChange: true, ics: '' }, 'MP2670FF90A5F2'));
    expect(url.searchParams.get('dates')).toBe('20261014T090000Z/20261014T110000Z');
    expect(url.searchParams.get('location')).toBe('School of Psychology, University of Leeds, Leeds LS2 9JT');
    expect(url.searchParams.get('details')).toContain('MP2670FF90A5F2');
  });

  it('the second visit: 28 to 35 days after the first, by UK date', () => {
    const gap = labBooking.visit2AfterDays;
    expect(gap).toEqual({ min: 28, max: 35 });
    expect(secondVisitDays('2026-10-14T09:00:00.000Z', gap)).toEqual({ from: '2026-11-11', to: '2026-11-18' });
    // 23:30 UTC on 30 June is already 1 July in Leeds.
    expect(secondVisitDays('2026-06-30T23:30:00.000Z', gap).from).toBe('2026-07-29');
    expect(firstVisitDays('2026-11-13T10:00:00.000Z', gap)).toEqual({ from: '2026-10-09', to: '2026-10-16' });
    expect(onDays('2026-11-18T22:30:00.000Z', { from: '2026-11-11', to: '2026-11-18' })).toBe(true);
    expect(onDays('2026-11-19T00:30:00.000Z', { from: '2026-11-11', to: '2026-11-18' })).toBe(false);
    // Across the clocks going back: still whole days.
    expect(daysBetween('2026-10-14', '2026-11-11')).toBe(28);
    expect(daysBetween('2026-03-20', '2026-04-24')).toBe(35);
  });

  it('UK mobile numbers, as the server reads them', () => {
    expect(ukMobile('07700 900123')).toBe('+447700900123');
    expect(ukMobile('+44 (0)7700 900123')).toBeNull();
    expect(ukMobile('0113 343 5000')).toBeNull();
  });
});
