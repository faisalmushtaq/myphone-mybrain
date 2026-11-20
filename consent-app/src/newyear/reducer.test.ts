import { describe, expect, it } from 'vitest';
import type { CheckIn, Participant, Visit } from './model';
import { readSaved } from './persistence';
import { initialNyState, nyReducer, shownRoute } from './reducer';

const P: Participant = {
  name: 'Calm Otter 42',
  onLeaderboard: true,
  mode: 'apps',
  apps: ['tiktok'],
  otherApp: '',
  goalMinutes: null,
  startDate: '2027-01-01',
  joinedOn: '2026-12-30',
  joinedAt: '2026-12-30T10:00:00Z',
  demographics: { birthMonth: '2000-01', sex: 'female', gender: 'woman', genderText: '', ethnicity: 'prefer-not', ethnicityText: '', countryOfBirth: 'GB', countryOfResidence: 'GB', education: 'isced6', firstLanguage: 'English', otherLanguages: '', work: 'student', job: '' },
  reminders: { email: true, sms: false, phone: '', frequency: 'weekly' },
  consent: { version: '0.1-draft', statements: { 'take-part': true }, at: '' },
  savedAsApp: false,
  endedOn: null,
};
const C: CheckIn = { id: 'c1', date: '2027-01-02', at: '2027-01-02T20:00:00Z', status: 'on-track', slipDate: null, minutes: null, mood: 4, urge: 2, note: '' };
const V: Visit = { id: 'v1', kind: 'end', startedOn: '2027-02-01', startedAt: '', device: { deviceType: 'phone', os: 'iOS 18', browser: 'Safari', screen: '', standalone: true, timeZone: 'Europe/London' }, scales: null, digitSpan: null, oddball: null, skippedBrainCheck: false, screenshot: null, reflection: null, completedOn: null, completedAt: null };

describe('the online study state', () => {
  it('shows only the landing and join pages before joining', () => {
    expect(shownRoute({ ...initialNyState(), route: { view: 'tracker' } })).toEqual({ view: 'about' });
    const joined = nyReducer(initialNyState(), { type: 'join', participant: P });
    expect(joined.route).toEqual({ view: 'tracker' });
    expect(shownRoute({ ...joined, route: { view: 'join' } })).toEqual({ view: 'tracker' });
  });

  it('keeps every check-in, any number a day, and never the same one twice', () => {
    let s = nyReducer(initialNyState(), { type: 'join', participant: P });
    s = nyReducer(s, { type: 'check-in', checkIn: C });
    s = nyReducer(s, { type: 'check-in', checkIn: { ...C, id: 'c2' } });
    s = nyReducer(s, { type: 'check-in', checkIn: C });
    expect(s.checkIns.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('ends the break when the end visit is completed, and opens its results', () => {
    let s = nyReducer(initialNyState(), { type: 'join', participant: P });
    s = nyReducer(s, { type: 'visit-begin', visit: V });
    expect(s.route).toEqual({ view: 'visit', visitId: 'v1' });
    s = nyReducer(s, { type: 'visit-complete', id: 'v1', today: '2027-02-01', at: '2027-02-01T10:00:00Z' });
    expect(s.participant?.endedOn).toBe('2027-02-01');
    expect(s.route).toEqual({ view: 'results', visitId: 'v1' });
    // A finished visit can't be changed afterwards.
    expect(nyReducer(s, { type: 'visit-update', id: 'v1', patch: { skippedBrainCheck: true } }).visits[0].skippedBrainCheck).toBe(false);
  });

  it('sends an unknown visit back to the list of visits', () => {
    const s = nyReducer(initialNyState(), { type: 'join', participant: P });
    expect(shownRoute({ ...s, route: { view: 'results', visitId: 'nope' } })).toEqual({ view: 'visits' });
    expect(shownRoute({ ...s, route: { view: 'visit', kind: 'return' } })).toEqual({ view: 'visit', kind: 'return' });
  });

  it('reads back what it saved, and drops what does not fit', () => {
    const saved = { v: 2, rev: 3, participant: P, checkIns: [C, { ...C, id: 'bad', mood: 9 }], visits: [V, { id: 'x' }], sessions: [], preview: { dayOffset: 5 } };
    const read = readSaved(JSON.parse(JSON.stringify(saved)));
    expect(read?.participant?.name).toBe('Calm Otter 42');
    expect(read?.checkIns.map((c) => c.id)).toEqual(['c1']);
    expect(read?.visits.map((v) => v.id)).toEqual(['v1']);
    expect(read?.preview.dayOffset).toBe(5);
    expect(readSaved({ ...saved, v: 1 })).toBeNull();
    expect(readSaved({ ...saved, participant: { ...P, name: 'Real Name' } })).toBeNull();
  });

  it('takes another tab’s saved data as it is', () => {
    const s = nyReducer(initialNyState(), { type: 'join', participant: P });
    const synced = nyReducer(s, { type: 'synced', saved: { participant: P, checkIns: [C], visits: [], sessions: [], preview: { dayOffset: 0 } } });
    expect(synced.checkIns).toEqual([C]);
    expect(nyReducer(s, { type: 'synced', saved: null }).participant).toBeNull();
  });
});
