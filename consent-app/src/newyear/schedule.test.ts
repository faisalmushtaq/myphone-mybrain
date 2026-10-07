import { describe, expect, it } from 'vitest';
import { latestOpenedStage, nextStage, stagePlan, stageStatus, type StageId } from './schedule';

const datesFor = (lengthDays: number) => Object.fromEntries(stagePlan({ startDate: '2027-01-01', lengthDays, joinedOn: '2026-12-20' }).map((s) => [s.id, { day: s.day, date: s.date, opens: s.opens, closes: s.closes }]));

describe('brain check stages', () => {
  it('7 days: before (day 0), halfway (day 4), end (day 7), follow-up 30 days after the end', () => {
    expect(datesFor(7)).toEqual({
      baseline: { day: 0, date: '2026-12-31', opens: '2026-12-20', closes: '2027-01-04' },
      halfway: { day: 4, date: '2027-01-04', opens: '2027-01-04', closes: '2027-01-07' },
      end: { day: 7, date: '2027-01-07', opens: '2027-01-07', closes: '2027-01-14' },
      followup: { day: 37, date: '2027-02-06', opens: '2027-02-06', closes: '2027-02-20' },
    });
  });

  it('14 days: halfway on day 8, after 7 full days', () => {
    expect(datesFor(14)).toMatchObject({
      baseline: { date: '2026-12-31' },
      halfway: { day: 8, date: '2027-01-08' },
      end: { day: 14, date: '2027-01-14' },
      followup: { day: 44, date: '2027-02-13' },
    });
  });

  it('30 days: halfway on day 16, end on 30 January, follow-up on 1 March', () => {
    expect(datesFor(30)).toMatchObject({
      halfway: { day: 16, date: '2027-01-16' },
      end: { day: 30, date: '2027-01-30' },
      followup: { day: 60, date: '2027-03-01', closes: '2027-03-15' },
    });
  });

  it('opens the first check at once for someone starting today', () => {
    const [baseline] = stagePlan({ startDate: '2026-10-06', lengthDays: 30, joinedOn: '2026-10-06' });
    expect(baseline.date).toBe('2026-10-05');
    expect(baseline.opens).toBe('2026-10-05');
    expect(baseline.dueBy).toBe('2026-10-06');
    expect(stageStatus(baseline, false, '2026-10-06')).toBe('ready');
  });

  it('says what is ready, coming up, done or missed, and which is next', () => {
    const stages = stagePlan({ startDate: '2027-01-01', lengthDays: 14, joinedOn: '2026-12-20' });
    const [baseline, halfway] = stages;
    expect(stageStatus(baseline, false, '2026-12-20')).toBe('ready');
    expect(stageStatus(halfway, false, '2027-01-07')).toBe('upcoming');
    expect(stageStatus(halfway, false, '2027-01-08')).toBe('ready');
    expect(stageStatus(baseline, false, '2027-01-08')).toBe('missed');
    expect(stageStatus(baseline, true, '2027-01-08')).toBe('done');

    const done = new Set<StageId>(['baseline']);
    expect(nextStage(stages, done, '2027-01-02')).toMatchObject({ stage: { id: 'halfway' }, status: 'upcoming' });
    expect(nextStage(stages, new Set<StageId>(), '2027-01-02')).toMatchObject({ stage: { id: 'baseline' }, status: 'ready' });
    expect(nextStage(stages, new Set<StageId>(['baseline', 'halfway', 'end', 'followup']), '2027-03-01')).toBeNull();

    expect(latestOpenedStage(stages, '2026-12-25')?.id).toBe('baseline');
    expect(latestOpenedStage(stages, '2027-01-09')?.id).toBe('halfway');
    expect(latestOpenedStage(stages, '2027-01-14')?.id).toBe('end');
  });
});
