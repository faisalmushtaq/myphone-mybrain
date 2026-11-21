import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rng';
import { countedRt, makeSartSequence, sartDurationMs, SART_FONT_SIZES_PT, SART_MAIN, SART_PRACTICE, scoreSart, type SartTrialRecord } from './sart';

const trial = (digit: number, presses: number[] = []): SartTrialRecord => ({ digit, sizePt: 72, onsetMs: 0, presses });

describe('the SART (Robertson et al., 1997)', () => {
  it('has 225 digits, each of 1 to 9 twenty-five times, at the five published sizes, for about 4.3 minutes', () => {
    const seq = makeSartSequence(SART_MAIN, mulberry32(7));
    expect(seq).toHaveLength(225);
    for (let d = 1; d <= 9; d += 1) expect(seq.filter((t) => t.digit === d)).toHaveLength(25);
    for (const t of seq) expect(SART_FONT_SIZES_PT).toContain(t.sizePt);
    expect(SART_MAIN.digitMs + SART_MAIN.maskMs).toBe(1150);
    expect(Math.round((sartDurationMs(SART_MAIN) - SART_MAIN.leadInMs) / 1000)).toBe(259);
    expect(makeSartSequence(SART_PRACTICE, mulberry32(1))).toHaveLength(18);
    expect(makeSartSequence(SART_MAIN, mulberry32(7))).toEqual(seq);
  });

  it('counts the first response at 100 ms or later; quicker ones are anticipations', () => {
    expect(countedRt([60, 340])).toBe(340);
    expect(countedRt([90])).toBeNull();
    const s = scoreSart([trial(1, [80])]);
    expect(s.omissions).toBe(1);
    expect(s.anticipations).toBe(1);
  });

  it('scores commissions, omissions, reaction times and their variability', () => {
    const records = [trial(1, [300]), trial(2, [400]), trial(4, [500]), trial(5, [200]), trial(3, [250]), trial(6, [350]), trial(3), trial(7)];
    const s = scoreSart(records);
    expect(s).toMatchObject({ trials: 8, noGo: 2, go: 6, commissions: 1, omissions: 1, commissionRate: 0.5, omissionRate: 0.1667 });
    expect(s.meanRtMs).toBe(350);
    expect(s.medianRtMs).toBe(350);
    expect(s.sdRtMs).toBe(111.8);
    expect(s.cvRt).toBe(0.3194);
    // Before the commission: digits 1, 2, 4, 5 (300, 400, 500, 200); before the withheld 3: 6, 5, 4, 2 (350, 200, 500, 400).
    expect(s.rtBeforeCommissionMs).toBe(350);
    expect(s.rtBeforeWithheldMs).toBe(362.5);
  });
});
