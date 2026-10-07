import { describe, expect, it } from 'vitest';
import type { CheckIn, DigitSpanResult, OddballResult, Participant } from './model';
import { readSaved } from './persistence';
import { initialNyState, nyReducer, shownRoute } from './reducer';
import { hashToRoute, routeToHash } from './routes';
import { scoreOddball } from './tasks/oddball';

const participant: Participant = { name: 'Calm Otter 42', apps: ['tiktok', 'other'], otherApp: 'Strava', lengthDays: 14, startDate: '2027-01-01', joinedOn: '2026-12-20', joinedAt: '2026-12-20T10:00:00.000Z' };
const checkIn = (day: string, kept: CheckIn['kept'] = 'yes'): CheckIn => ({ day, kept, slipMinutes: null, mood: 4, craving: 2, note: '', savedOn: day, savedAt: `${day}T09:00:00.000Z` });
const memory: DigitSpanResult = { score: { span: 6, correctTrials: 7, totalTrials: 10 }, trials: [], practiceCorrect: true, seed: 1, startedAt: 'a', finishedAt: 'b' };
const attention: OddballResult = { scores: scoreOddball([]), trials: [], seed: 2, settings: { trials: 100, stimulusMs: 500, itiMinMs: 1000, itiMaxMs: 1400 }, timing: { maxFrameGapMs: 17, longFrames: 0 }, input: 'touch', startedAt: 'c', finishedAt: '2027-01-01T08:00:00.000Z' };

describe('the New Year break state', () => {
  it('shows only the landing and join pages before joining, and the tracker after', () => {
    const fresh = initialNyState();
    expect(shownRoute({ ...fresh, route: { view: 'leaderboard' } })).toEqual({ view: 'about' });
    expect(shownRoute({ ...fresh, route: { view: 'join' } })).toEqual({ view: 'join' });
    const joined = nyReducer({ ...fresh, route: { view: 'join' } }, { type: 'join', participant });
    expect(joined.route).toEqual({ view: 'tracker' });
    expect(shownRoute({ ...joined, route: { view: 'join' } })).toEqual({ view: 'tracker' });
    expect(shownRoute({ ...joined, route: { view: 'brain' } })).toEqual({ view: 'checks' });
  });

  it('keeps the first answer for a day: a check-in cannot be overwritten', () => {
    let s = nyReducer(initialNyState(), { type: 'join', participant });
    s = nyReducer(s, { type: 'check-in', checkIn: checkIn('2027-01-01') });
    s = nyReducer(s, { type: 'check-in', checkIn: checkIn('2027-01-01', 'lot') });
    expect(s.checkIns['2027-01-01'].kept).toBe('yes');
    expect(Object.keys(s.checkIns)).toHaveLength(1);
  });

  it('completes a stage only when the memory game is followed by the attention game, once', () => {
    let s = nyReducer(initialNyState(), { type: 'join', participant });
    s = nyReducer(s, { type: 'attention-done', stage: 'baseline', result: attention, today: '2026-12-31' });
    expect(s.stages.baseline).toBeUndefined();
    s = nyReducer(s, { type: 'memory-done', stage: 'baseline', result: memory });
    s = nyReducer(s, { type: 'attention-done', stage: 'baseline', result: attention, today: '2026-12-31' });
    expect(s.stages.baseline?.completedOn).toBe('2026-12-31');
    expect(s.route).toEqual({ view: 'results', stage: 'baseline' });
    const again = nyReducer(s, { type: 'memory-done', stage: 'baseline', result: { ...memory, seed: 99 } });
    expect(again.stages.baseline?.digitSpan?.seed).toBe(1);
  });

  it('forgets everything on delete', () => {
    let s = nyReducer(initialNyState(), { type: 'join', participant });
    s = nyReducer(s, { type: 'check-in', checkIn: checkIn('2027-01-01') });
    s = nyReducer(s, { type: 'delete-all' });
    expect(s.participant).toBeNull();
    expect(s.checkIns).toEqual({});
    expect(s.flash).toEqual({ kind: 'deleted' });
  });
});

describe('saved progress', () => {
  const saved = { v: 1, participant, checkIns: { '2027-01-01': checkIn('2027-01-01') }, stages: { baseline: { digitSpan: memory, oddball: attention, completedOn: '2026-12-31', completedAt: 'x' } }, preview: { dayOffset: 3 } };

  it('reads back what was saved', () => {
    const back = readSaved(JSON.parse(JSON.stringify(saved)));
    expect(back?.participant).toEqual(participant);
    expect(Object.keys(back?.checkIns ?? {})).toEqual(['2027-01-01']);
    expect(back?.stages.baseline?.completedOn).toBe('2026-12-31');
    expect(back?.preview.dayOffset).toBe(3);
  });

  it('refuses a name that is not from the lists, and anything malformed', () => {
    expect(readSaved({ ...saved, participant: { ...participant, name: 'Jane Smith' } })).toBeNull();
    expect(readSaved({ ...saved, participant: { ...participant, apps: ['myspace'] } })).toBeNull();
    expect(readSaved({ ...saved, participant: { ...participant, lengthDays: 21 } })).toBeNull();
    expect(readSaved({ ...saved, v: 2 })).toBeNull();
    expect(readSaved('nonsense')).toBeNull();
    const messy = readSaved({
      ...saved,
      checkIns: { '2027-01-02': { ...checkIn('2027-01-02'), mood: 9 }, 'not-a-date': checkIn('2027-01-03'), '2027-01-04': { ...checkIn('2027-01-04', 'little'), slipMinutes: 30, note: 'x'.repeat(400) } },
      stages: { baseline: { digitSpan: null, oddball: attention }, halfway: { digitSpan: memory, oddball: null } },
      preview: { dayOffset: -5 },
    });
    expect(Object.keys(messy?.checkIns ?? {})).toEqual(['2027-01-04']);
    expect(messy?.checkIns['2027-01-04'].note).toHaveLength(280);
    expect(messy?.checkIns['2027-01-04'].slipMinutes).toBe(30);
    expect(messy?.stages.baseline).toBeUndefined();
    expect(messy?.stages.halfway?.completedOn).toBeNull();
    expect(messy?.preview.dayOffset).toBe(0);
  });
});

describe('screen addresses', () => {
  it('round-trips every screen through the address', () => {
    for (const route of [{ view: 'tracker' }, { view: 'checkin' }, { view: 'checks' }, { view: 'leaderboard' }, { view: 'leave' }, { view: 'brain', stage: 'halfway' }, { view: 'results', stage: 'followup' }] as const) {
      expect(hashToRoute(routeToHash(route))).toEqual(route);
    }
    expect(routeToHash({ view: 'brain', stage: 'end' })).toBe('#/brain-check/end');
  });

  it('ignores addresses that are not screens, such as the site’s skip link', () => {
    expect(hashToRoute('#main-content')).toBeNull();
    expect(hashToRoute('#/nowhere')).toBeNull();
    expect(hashToRoute('#/brain-check/someday')).toEqual({ view: 'checks' });
    expect(hashToRoute('')).toBeNull();
  });
});
