import { describe, expect, it } from 'vitest';
import { compareScores, describeScores, type ComparableScores } from './compare';

const before: ComparableScores = { span: 6, medianRtMs: 455, hits: 18, targets: 20, falseAlarms: 3 };

describe('results in plain words', () => {
  it('describes one brain check on its own', () => {
    expect(describeScores(before)).toEqual(['You remembered up to 6 digits in the right order.', 'You spotted 18 of 20 targets.', 'You tapped by mistake 3 times.', 'Your reaction time was 455 ms.']);
    expect(describeScores({ span: 0, medianRtMs: null, hits: null, targets: null, falseAlarms: 0 })).toEqual(['You remembered fewer than 3 digits in the right order.', 'You never tapped by mistake.']);
  });

  it('compares with an earlier check, saying faster, slower or about the same', () => {
    const now: ComparableScores = { span: 7, medianRtMs: 412, hits: 19, targets: 20, falseAlarms: 1 };
    expect(compareScores(now, before, 'before your break')).toEqual([
      'Your reaction time was 412 ms, 43 ms faster than before your break.',
      'You remembered up to 7 digits, 1 digit more than before your break.',
      'You spotted 19 of 20 targets, 1 more than before your break.',
      'You tapped by mistake once, 2 times fewer than before your break.',
    ]);
    const slower = compareScores({ ...before, medianRtMs: 480.4, span: 4, hits: 15 }, before, 'at halfway');
    expect(slower[0]).toBe('Your reaction time was 480 ms, 25 ms slower than at halfway.');
    expect(slower[1]).toBe('You remembered up to 4 digits, 2 digits fewer than at halfway.');
    expect(slower[2]).toBe('You spotted 15 of 20 targets, 3 fewer than at halfway.');
    expect(slower[3]).toBe('You tapped by mistake 3 times, the same as at halfway.');
    expect(compareScores({ ...before, medianRtMs: 460 }, before, 'before your break')[0]).toBe('Your reaction time was 460 ms, about the same as before your break (455 ms).');
  });

  it('leaves out what either check is missing', () => {
    expect(compareScores({ span: 5, medianRtMs: null, hits: null, targets: null, falseAlarms: null }, before, 'before your break')).toEqual(['You remembered up to 5 digits, 1 digit fewer than before your break.']);
  });
});
