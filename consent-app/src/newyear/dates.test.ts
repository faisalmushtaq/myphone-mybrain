import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, defaultStartDate, formatDay, isIsoDate, localIsoDate, relativeDay } from './dates';

describe('calendar dates', () => {
  it('reads the device’s own calendar date, not UTC', () => {
    // Built from local parts, so this is 1 January wherever the tests run.
    expect(localIsoDate(new Date(2027, 0, 1, 0, 5))).toBe('2027-01-01');
    expect(localIsoDate(new Date(2027, 0, 1, 23, 55))).toBe('2027-01-01');
    expect(localIsoDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  it('adds days across months, years, leap days and clock changes', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    // The UK and EU clocks change on 28 March 2027; the US on 14 March.
    expect(addDays('2027-03-27', 1)).toBe('2027-03-28');
    expect(addDays('2027-03-27', 2)).toBe('2027-03-29');
    expect(addDays('2027-10-30', 2)).toBe('2027-11-01');
    expect(daysBetween('2027-03-27', '2027-03-29')).toBe(2);
    expect(daysBetween('2027-01-01', '2026-12-25')).toBe(-7);
  });

  it('checks dates are real', () => {
    expect(isIsoDate('2027-01-01')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    for (const bad of ['2027-02-29', '2027-13-01', '2027-1-1', '01/01/2027', '', null, 20270101]) expect(isIsoDate(bad), String(bad)).toBe(false);
  });

  it('suggests 1 January when New Year is at most 60 days away, otherwise today', () => {
    expect(defaultStartDate('2026-10-06')).toBe('2026-10-06');
    expect(defaultStartDate('2026-11-01')).toBe('2026-11-01');
    expect(defaultStartDate('2026-11-02')).toBe('2027-01-01');
    expect(defaultStartDate('2026-12-31')).toBe('2027-01-01');
    expect(defaultStartDate('2027-01-01')).toBe('2027-01-01');
    expect(defaultStartDate('2027-01-02')).toBe('2027-01-02');
  });

  it('formats dates in British English, whatever the time zone', () => {
    expect(formatDay('2027-01-01')).toBe('Friday 1 January 2027');
    expect(formatDay('2027-01-01', 'no-year')).toBe('Friday 1 January');
    expect(formatDay('2027-01-01', 'short')).toBe('1 Jan');
    expect(relativeDay('2027-01-01', '2027-01-02')).toBe('yesterday');
    expect(relativeDay('2027-01-02', '2027-01-02')).toBe('today');
    expect(relativeDay('2026-12-31', '2027-01-02')).toBe('Thursday 31 December');
  });
});
