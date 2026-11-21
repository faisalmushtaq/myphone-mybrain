import { describe, expect, it } from 'vitest';
import { compareScores, describeScores, type ComparableScores } from './compare';

const base: ComparableScores = { span: 6, commissions: 12, noGo: 25, omissions: 4, go: 200, medianRtMs: 352, cvRt: 0.3 };

describe('results in plain words', () => {
  it('describes one brain check on its own', () => {
    expect(describeScores(base)).toEqual([
      'You remembered up to 6 digits in the right order.',
      'You tapped for 12 of the 25 threes (most people tap for quite a few).',
      'You missed 4 of the 200 other digits.',
      'Your typical reaction time was 352 ms.',
    ]);
  });

  it('compares with an earlier check: more, fewer, faster, slower, steadier, or about the same', () => {
    const now: ComparableScores = { span: 5, commissions: 9, noGo: 25, omissions: 4, go: 200, medianRtMs: 340, cvRt: 0.25 };
    expect(compareScores(now, base, 'at the start')).toEqual([
      'You remembered up to 5 digits, 1 digit fewer than at the start.',
      'You tapped for 9 of the 25 threes, 3 fewer than at the start.',
      'You missed 4 of the other digits, the same as at the start.',
      'Your typical reaction time was 340 ms, 12 ms faster than at the start.',
      'Your reaction times were steadier than at the start.',
    ]);
    expect(compareScores({ ...now, medianRtMs: 355, cvRt: 0.31 }, base, 'then').slice(3)).toEqual(['Your typical reaction time was 355 ms, about the same as then.', 'Your reaction times were about as steady as then.']);
  });

  it('leaves out what either check is missing', () => {
    expect(compareScores({ ...base, span: null, cvRt: null }, base, 'then')).toHaveLength(3);
  });
});
