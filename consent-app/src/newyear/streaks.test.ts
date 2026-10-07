import { describe, expect, it } from 'vitest';
import { bestStreak, breakDays, breakEnd, breakPhase, checkInDays, currentStreak, dayNumber, tally, type DayEntry, type KeptAnswer } from './streaks';

const plan = { startDate: '2027-01-01', lengthDays: 7 };
const answers = (days: Record<string, KeptAnswer>): Record<string, DayEntry> => Object.fromEntries(Object.entries(days).map(([d, kept]) => [d, { kept }]));

describe('days of the break', () => {
  it('numbers the days from the start date and knows the phase', () => {
    expect(breakEnd(plan)).toBe('2027-01-07');
    expect(dayNumber(plan, '2027-01-01')).toBe(1);
    expect(dayNumber(plan, '2026-12-31')).toBe(0);
    expect(breakPhase(plan, '2026-12-31')).toBe('before');
    expect(breakPhase(plan, '2027-01-07')).toBe('during');
    expect(breakPhase(plan, '2027-01-08')).toBe('after');
  });

  it('asks about yesterday, and lets a missed day be filled in up to two days back', () => {
    expect(checkInDays(plan, {}, '2027-01-01')).toEqual([]);
    expect(checkInDays(plan, {}, '2027-01-02')).toEqual(['2027-01-01']);
    expect(checkInDays(plan, {}, '2027-01-05')).toEqual(['2027-01-04', '2027-01-03']);
    expect(checkInDays(plan, answers({ '2027-01-04': 'yes' }), '2027-01-05')).toEqual(['2027-01-03']);
    expect(checkInDays(plan, answers({ '2027-01-04': 'yes', '2027-01-03': 'lot' }), '2027-01-05')).toEqual([]);
    // After the last day: still the last two days, then nothing.
    expect(checkInDays(plan, {}, '2027-01-08')).toEqual(['2027-01-07', '2027-01-06']);
    expect(checkInDays(plan, {}, '2027-01-10')).toEqual([]);
  });
});

describe('streaks', () => {
  it('counts consecutive kept days up to yesterday; only "Yes, completely" counts as kept', () => {
    const e = answers({ '2027-01-01': 'yes', '2027-01-02': 'yes', '2027-01-03': 'little', '2027-01-04': 'yes' });
    expect(currentStreak(plan, e, '2027-01-05')).toBe(1);
    expect(bestStreak(plan, e, '2027-01-05')).toBe(2);
    expect(tally(plan, e)).toEqual({ checkIns: 4, kept: 3, slipped: 1 });
  });

  it('does not break the streak for days that can still be filled in', () => {
    const e = answers({ '2027-01-01': 'yes', '2027-01-02': 'yes', '2027-01-03': 'yes' });
    // Today is the 5th: the 4th (yesterday) has no answer yet.
    expect(currentStreak(plan, e, '2027-01-05')).toBe(3);
    // A gap in the middle that can still be filled in is passed over, not counted.
    const gap = answers({ '2027-01-01': 'yes', '2027-01-02': 'yes', '2027-01-04': 'yes' });
    expect(currentStreak(plan, gap, '2027-01-05')).toBe(3);
    expect(bestStreak(plan, gap, '2027-01-05')).toBe(3);
  });

  it('ends the streak at a slip or at a day that was never checked in, but keeps the best streak', () => {
    const e = answers({ '2027-01-01': 'yes', '2027-01-02': 'yes', '2027-01-03': 'yes', '2027-01-05': 'yes' });
    // The 4th can no longer be filled in on the 7th, so it ends the run.
    expect(currentStreak(plan, e, '2027-01-07')).toBe(1);
    expect(bestStreak(plan, e, '2027-01-07')).toBe(3);
    const slip = answers({ '2027-01-01': 'yes', '2027-01-02': 'yes', '2027-01-03': 'lot' });
    expect(currentStreak(plan, slip, '2027-01-04')).toBe(0);
    expect(bestStreak(plan, slip, '2027-01-04')).toBe(2);
  });

  it('is nothing before the break and stops at the last day after it', () => {
    expect(currentStreak(plan, {}, '2026-12-20')).toBe(0);
    expect(bestStreak(plan, {}, '2026-12-20')).toBe(0);
    const all = answers(Object.fromEntries(['01', '02', '03', '04', '05', '06', '07'].map((d) => [`2027-01-${d}`, 'yes' as const])));
    expect(currentStreak(plan, all, '2027-01-20')).toBe(7);
    expect(bestStreak(plan, all, '2027-01-20')).toBe(7);
    // The last day never answered: once it can't be filled in, the streak is over.
    const noLast = { ...all };
    delete noLast['2027-01-07'];
    expect(currentStreak(plan, noLast, '2027-01-08')).toBe(6);
    expect(currentStreak(plan, noLast, '2027-01-10')).toBe(0);
    expect(bestStreak(plan, noLast, '2027-01-10')).toBe(6);
  });

  it('works across the turn of the year and a clock change, on calendar dates alone', () => {
    const nye = { startDate: '2026-12-30', lengthDays: 14 };
    const e = answers({ '2026-12-30': 'yes', '2026-12-31': 'yes', '2027-01-01': 'yes', '2027-01-02': 'yes' });
    expect(currentStreak(nye, e, '2027-01-03')).toBe(4);
    const spring = { startDate: '2027-03-26', lengthDays: 7 };
    const s = answers({ '2027-03-26': 'yes', '2027-03-27': 'yes', '2027-03-28': 'yes', '2027-03-29': 'yes' });
    expect(currentStreak(spring, s, '2027-03-30')).toBe(4);
  });

  it('ignores answers for days outside the break', () => {
    const e = answers({ '2026-12-31': 'yes', '2027-01-01': 'yes', '2027-01-09': 'yes' });
    expect(tally(plan, e)).toEqual({ checkIns: 1, kept: 1, slipped: 0 });
    expect(currentStreak(plan, e, '2027-01-02')).toBe(1);
  });
});

describe('the calendar', () => {
  it('marks each day kept, slipped, not checked in or still to come, and today', () => {
    const days = breakDays(plan, answers({ '2027-01-01': 'yes', '2027-01-02': 'little', '2027-01-04': 'lot' }), '2027-01-06');
    expect(days.map((d) => d.state)).toEqual(['kept', 'slipped', 'not-checked', 'slipped', 'not-checked', 'future', 'future']);
    expect(days.map((d) => d.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(days[1].slip).toBe('little');
    expect(days[3].slip).toBe('lot');
    expect(days[5].isToday).toBe(true);
    // The 3rd is too long ago; the 5th (yesterday) can still be filled in.
    expect(days[2].canCheckIn).toBe(false);
    expect(days[4].canCheckIn).toBe(true);
  });
});
