import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rng';
import { DIGIT_SPAN, isCorrectRecall, makeDigitSequence, MAX_SPAN_TRIALS, recordSpanTrial, spanScore, startSpan, type SpanProgress } from './digitSpan';

/** Runs the staircase with a scripted list of right (true) and wrong (false) answers. */
function run(answers: boolean[]): SpanProgress {
  const rng = mulberry32(3);
  let progress = startSpan();
  for (const right of answers) {
    if (progress.finished) break;
    const sequence = makeDigitSequence(progress.length, rng);
    const response = right ? sequence : sequence.slice().reverse();
    progress = recordSpanTrial(progress, response, sequence);
  }
  return progress;
}

describe('digit span sequences', () => {
  it('uses digits 1 to 9, never repeats a digit straight away, and never runs three up or down', () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 900; i += 1) {
      const length = 2 + (i % 9);
      const seq = makeDigitSequence(length, rng);
      expect(seq).toHaveLength(length);
      seq.forEach((d, j) => {
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(9);
        if (j > 0) expect(d).not.toBe(seq[j - 1]);
        if (j > 1) {
          const run = seq[j] - seq[j - 1] === seq[j - 1] - seq[j - 2] && Math.abs(seq[j] - seq[j - 1]) === 1;
          expect(run, seq.join('')).toBe(false);
        }
      });
    }
  });

  it('is the same for the same seed', () => {
    expect(makeDigitSequence(8, mulberry32(42))).toEqual(makeDigitSequence(8, mulberry32(42)));
    expect(makeDigitSequence(8, mulberry32(42))).not.toEqual(makeDigitSequence(8, mulberry32(43)));
  });

  it('marks a recall right only when every digit is there in order', () => {
    expect(isCorrectRecall([4, 7, 2], [4, 7, 2])).toBe(true);
    expect(isCorrectRecall([4, 7, 2], [4, 2, 7])).toBe(false);
    expect(isCorrectRecall([4, 7, 2], [4, 7])).toBe(false);
    expect(isCorrectRecall([4, 7, 2], [4, 7, 2, 1])).toBe(false);
  });
});

describe('digit span staircase', () => {
  it('starts at 3 digits with two trials at each length', () => {
    const p = startSpan();
    expect(p.length).toBe(3);
    expect(DIGIT_SPAN.practiceLength).toBe(2);
    const after1 = recordSpanTrial(p, [1, 2, 4], [1, 2, 4]);
    expect(after1.length).toBe(3);
    expect(after1.trialAtLength).toBe(1);
  });

  it('moves up a length when at least one of the two is right', () => {
    expect(run([true, false]).length).toBe(4);
    expect(run([false, true]).length).toBe(4);
    expect(run([true, true]).length).toBe(4);
    expect(run([true, false]).finished).toBe(false);
  });

  it('stops when both trials at a length are wrong; the span is the longest length with a right answer', () => {
    // 3: right, wrong. 4: wrong, right. 5: wrong, wrong.
    const p = run([true, false, false, true, false, false, true, true]);
    expect(p.finished).toBe(true);
    expect(p.trials).toHaveLength(6);
    expect(spanScore(p.trials)).toEqual({ span: 4, correctTrials: 2, totalTrials: 6 });
  });

  it('scores 0 when both trials at 3 digits are wrong', () => {
    const p = run([false, false, true]);
    expect(p.finished).toBe(true);
    expect(p.trials).toHaveLength(2);
    expect(spanScore(p.trials).span).toBe(0);
  });

  it('stops after the two trials at 10 digits', () => {
    const p = run(Array.from({ length: 40 }, () => true));
    expect(p.finished).toBe(true);
    expect(p.trials).toHaveLength(MAX_SPAN_TRIALS);
    expect(MAX_SPAN_TRIALS).toBe(16);
    expect(Math.max(...p.trials.map((t) => t.length))).toBe(10);
    expect(spanScore(p.trials)).toEqual({ span: 10, correctTrials: 16, totalTrials: 16 });
    // Nothing more is recorded once finished.
    expect(recordSpanTrial(p, [1], [1])).toBe(p);
  });

  it('counts a right answer at a length even if the second trial there was wrong', () => {
    const p = run([true, true, true, false, false, false]);
    expect(spanScore(p.trials)).toEqual({ span: 4, correctTrials: 3, totalTrials: 6 });
  });
});
