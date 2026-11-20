import { describe, expect, it } from 'vitest';
import type { CheckIn, Participant, Visit } from './model';
import { bestStreak, breakDays, currentStreak, followUps, phaseOf, screenshotDue, tallyOf } from './progress';

const P: Participant = {
  name: 'Calm Otter 42',
  onLeaderboard: true,
  mode: 'apps',
  apps: ['tiktok'],
  otherApp: '',
  goalMinutes: null,
  startDate: '2027-01-01',
  joinedOn: '2026-12-30',
  joinedAt: '',
  demographics: { birthMonth: '2000-01', sex: '', gender: '', genderText: '', ethnicity: '', ethnicityText: '', countryOfBirth: '', countryOfResidence: '', education: '', firstLanguage: '', otherLanguages: '', work: '', job: '' },
  reminders: { email: false, sms: false, phone: '', frequency: 'weekly' },
  consent: { version: 'x', statements: {}, at: '' },
  savedAsApp: true,
  endedOn: null,
};
const ci = (date: string, status: CheckIn['status'], slipDate: string | null = null): CheckIn => ({ id: date + status, date, at: `${date}T20:00:00Z`, status, slipDate, minutes: null, mood: 3, urge: 3, note: '' });
const shot = (from: string, to: string, minutesPerDay: number, kind: Visit['kind'] = 'return'): Visit => ({
  id: from + to,
  kind,
  startedOn: to,
  startedAt: '',
  device: { deviceType: 'phone', os: '', browser: '', screen: '', standalone: true, timeZone: '' },
  scales: null,
  digitSpan: null,
  oddball: null,
  skippedBrainCheck: true,
  screenshot: { fileName: 'a.png', fileType: 'image/png', fileBytes: 1, from, to, minutesPerDay, readBy: 'self', at: '' },
  reflection: null,
  completedOn: to,
  completedAt: `${to}T21:00:00Z`,
});
const states = (days: { state: string }[]) => days.map((d) => d.state).join(' ');

describe('an open-ended break', () => {
  it('has no days before it starts, and no end until the end visit', () => {
    expect(breakDays(P, [], [], '2026-12-31')).toEqual([]);
    expect(phaseOf(P, '2026-12-31')).toBe('before');
    expect(phaseOf(P, '2027-03-01')).toBe('during');
    expect(phaseOf({ ...P, endedOn: '2027-02-01' }, '2027-03-01')).toBe('ended');
  });

  it('marks the days each check-in covers, and leaves later days unreported', () => {
    const days = breakDays(P, [ci('2027-01-03', 'on-track')], [], '2027-01-06');
    expect(states(days)).toBe('kept kept kept unreported unreported today');
    expect(currentStreak(days)).toEqual({ days: 3, asOf: '2027-01-03' });
  });

  it('lets someone check in after a long gap: the check-in covers it (nobody is locked out)', () => {
    const days = breakDays(P, [ci('2027-01-02', 'on-track'), ci('2027-01-20', 'on-track')], [], '2027-01-20');
    expect(days.filter((d) => d.state === 'kept')).toHaveLength(20);
    expect(currentStreak(days).days).toBe(20);
  });

  it('puts a slip on the day it happened, leaves the days before it unknown, and restarts the streak after it', () => {
    const days = breakDays(P, [ci('2027-01-05', 'on-track'), ci('2027-01-08', 'little', '2027-01-07'), ci('2027-01-10', 'on-track')], [], '2027-01-10');
    expect(states(days)).toBe('kept kept kept kept kept unreported slip kept kept kept');
    expect(currentStreak(days).days).toBe(3);
    expect(bestStreak(days)).toBe(5);
    expect(tallyOf(days, []).slips).toBe(1);
  });

  it('pauses the days of "stopped for now"', () => {
    const days = breakDays(P, [ci('2027-01-02', 'on-track'), ci('2027-01-04', 'stopped'), ci('2027-01-06', 'on-track')], [], '2027-01-06');
    expect(states(days)).toBe('kept kept paused paused kept kept');
    expect(currentStreak(days).days).toBe(2);
  });

  it('lets a screenshot prove days (or show they were over), outranking what was said', () => {
    const days = breakDays(P, [ci('2027-01-07', 'on-track')], [shot('2027-01-01', '2027-01-04', 2), shot('2027-01-05', '2027-01-06', 40)], '2027-01-08');
    expect(states(days)).toBe('verified verified verified verified over over kept today');
    expect(tallyOf(days, []).verified).toBe(4);
    expect(currentStreak(days).days).toBe(1);
  });

  it('judges a screenshot against the daily limit when cutting total phone time', () => {
    const total = { ...P, mode: 'total' as const, apps: [], goalMinutes: 120 };
    expect(states(breakDays(total, [], [shot('2027-01-01', '2027-01-02', 110)], '2027-01-03'))).toBe('verified verified today');
    expect(states(breakDays(total, [], [shot('2027-01-01', '2027-01-02', 130)], '2027-01-03'))).toBe('over over today');
  });

  it('asks for a screenshot once a week of the break is not covered', () => {
    const at = (today: string, visits: Visit[]) => screenshotDue(P, breakDays(P, [], visits, today), today);
    expect(at('2027-01-07', []).due).toBe(false);
    expect(at('2027-01-08', [])).toEqual({ due: true, oldestUncovered: '2027-01-01', uncovered: 7 });
    expect(at('2027-01-10', [shot('2027-01-01', '2027-01-07', 0)])).toEqual({ due: false, oldestUncovered: '2027-01-08', uncovered: 2 });
  });

  it('opens the follow-ups one and three months after the end', () => {
    const ended = { ...P, endedOn: '2027-02-01' };
    expect(followUps(ended, [], '2027-03-03').map((f) => f.status)).toEqual(['ready', 'upcoming']);
    expect(followUps(ended, [], '2027-03-20').map((f) => f.status)).toEqual(['missed', 'upcoming']);
    expect(followUps(P, [], '2027-03-03')).toEqual([]);
  });
});
