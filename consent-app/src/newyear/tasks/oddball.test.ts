import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rng';
import { ANTICIPATION_MS, expectedDurationMs, makeOddballSequence, ODDBALL_MAIN, ODDBALL_PRACTICE, practiceFeedback, scoreOddball, trialOutcome, withOutcomes, type OddballStimulus } from './oddball';
import { inverseNormalCdf } from './stats';

const trial = (type: OddballStimulus, ...presses: number[]) => ({ type, presses });

describe('oddball sequences', () => {
  it('has 20% targets, never two in a row, and at least 3 standards first, for any seed', () => {
    for (let seed = 1; seed <= 150; seed += 1) {
      const seq = makeOddballSequence(ODDBALL_MAIN, mulberry32(seed));
      expect(seq).toHaveLength(100);
      expect(seq.filter((t) => t.type === 'target')).toHaveLength(20);
      expect(seq.slice(0, 3).every((t) => t.type === 'standard')).toBe(true);
      seq.forEach((t, i) => {
        if (i > 0 && t.type === 'target') expect(seq[i - 1].type).toBe('standard');
        expect(t.itiMs).toBeGreaterThanOrEqual(1000);
        expect(t.itiMs).toBeLessThanOrEqual(1400);
        expect(Number.isInteger(t.itiMs)).toBe(true);
      });
    }
  });

  it('spreads targets across the whole block, not always in the same places', () => {
    const counts = new Array(100).fill(0);
    for (let seed = 1; seed <= 400; seed += 1) {
      makeOddballSequence(ODDBALL_MAIN, mulberry32(seed)).forEach((t, i) => {
        if (t.type === 'target') counts[i] += 1;
      });
    }
    expect(counts.slice(0, 3)).toEqual([0, 0, 0]);
    // Every other position is a target sometimes, and the last one too.
    expect(counts.slice(3).every((c) => c > 0)).toBe(true);
    const itis = makeOddballSequence(ODDBALL_MAIN, mulberry32(9)).map((t) => t.itiMs);
    expect(new Set(itis).size).toBeGreaterThan(50);
  });

  it('is the same for the same seed', () => {
    expect(makeOddballSequence(ODDBALL_MAIN, mulberry32(77))).toEqual(makeOddballSequence(ODDBALL_MAIN, mulberry32(77)));
  });

  it('has a short practice of 10 with 2 targets, under the same rules', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const seq = makeOddballSequence(ODDBALL_PRACTICE, mulberry32(seed));
      expect(seq).toHaveLength(10);
      const targets = seq.flatMap((t, i) => (t.type === 'target' ? [i] : []));
      expect(targets).toHaveLength(2);
      expect(targets[0]).toBeGreaterThanOrEqual(3);
      expect(targets[1] - targets[0]).toBeGreaterThanOrEqual(2);
    }
  });

  it('takes about two and three-quarter minutes, and the practice about half a minute', () => {
    expect(expectedDurationMs(ODDBALL_MAIN) / 1000).toBeCloseTo(171.5, 1);
    expect(expectedDurationMs(ODDBALL_PRACTICE) / 1000).toBeCloseTo(32.5, 1);
  });
});

describe('oddball scoring', () => {
  it('sorts each trial into hit, miss, false alarm or correct rejection', () => {
    expect(trialOutcome(trial('target', 420))).toBe('hit');
    expect(trialOutcome(trial('target'))).toBe('miss');
    expect(trialOutcome(trial('standard', 380))).toBe('false-alarm');
    expect(trialOutcome(trial('standard'))).toBe('correct-rejection');
  });

  it('treats presses under 150 ms as anticipations: flagged, never a hit or a false alarm', () => {
    expect(ANTICIPATION_MS).toBe(150);
    expect(trialOutcome(trial('target', 90))).toBe('miss');
    expect(trialOutcome(trial('standard', 149))).toBe('correct-rejection');
    // A real response after an early press still counts, with its own time.
    expect(trialOutcome(trial('target', 100, 360))).toBe('hit');
    const s = scoreOddball([trial('target', 100, 360), trial('standard', 120), trial('target', 150)]);
    expect(s.anticipations).toBe(2);
    expect(s.hits).toBe(2);
    expect(s.meanRtMs).toBe(255);
  });

  it('works out the rates, reaction times and d′ with the log-linear correction', () => {
    const trials = [
      ...Array.from({ length: 18 }, (_, i) => trial('target', 400 + i * 10)),
      trial('target'),
      trial('target'),
      ...Array.from({ length: 76 }, () => trial('standard')),
      ...Array.from({ length: 4 }, () => trial('standard', 500)),
    ];
    const s = scoreOddball(trials);
    expect(s).toMatchObject({ targets: 20, standards: 80, hits: 18, misses: 2, falseAlarms: 4, correctRejections: 76, anticipations: 0 });
    expect(s.hitRate).toBeCloseTo(0.9);
    expect(s.falseAlarmRate).toBeCloseTo(0.05);
    expect(s.meanRtMs).toBeCloseTo(485);
    expect(s.medianRtMs).toBe(485);
    const expected = inverseNormalCdf(18.5 / 21) - inverseNormalCdf(4.5 / 81);
    expect(s.dPrime).toBeCloseTo(expected, 10);
    expect(s.dPrime).toBeCloseTo(2.773, 2);
  });

  it('keeps d′ finite for a perfect score and for no response at all', () => {
    const perfect = scoreOddball([...Array.from({ length: 20 }, () => trial('target', 350)), ...Array.from({ length: 80 }, () => trial('standard'))]);
    expect(perfect.hitRate).toBe(1);
    expect(perfect.falseAlarmRate).toBe(0);
    expect(Number.isFinite(perfect.dPrime)).toBe(true);
    expect(perfect.dPrime).toBeCloseTo(inverseNormalCdf(20.5 / 21) - inverseNormalCdf(0.5 / 81), 10);
    expect(perfect.dPrime).toBeCloseTo(4.483, 2);

    const nothing = scoreOddball([...Array.from({ length: 20 }, () => trial('target')), ...Array.from({ length: 80 }, () => trial('standard'))]);
    expect(nothing.hitRate).toBe(0);
    expect(nothing.meanRtMs).toBeNull();
    expect(nothing.medianRtMs).toBeNull();
    expect(Number.isFinite(nothing.dPrime)).toBe(true);
    expect(nothing.dPrime).toBeGreaterThan(0);

    // Tapping for everything: no ability to tell them apart.
    const everything = scoreOddball([...Array.from({ length: 20 }, () => trial('target', 300)), ...Array.from({ length: 80 }, () => trial('standard', 300))]);
    expect(everything.falseAlarmRate).toBe(1);
    expect(Math.abs(everything.dPrime as number)).toBeLessThan(0.6);
  });

  it('has no rates or d′ to report without trials', () => {
    const empty = scoreOddball([]);
    expect(empty.hitRate).toBeNull();
    expect(empty.falseAlarmRate).toBeNull();
    expect(empty.dPrime).toBeNull();
    expect(scoreOddball([trial('standard')]).dPrime).toBeNull();
  });

  it('keeps each trial’s type, whether it counted as a response, and the reaction time', () => {
    const kept = withOutcomes([
      { type: 'target', itiMs: 1200, onsetMs: 1500, presses: [90, 410] },
      { type: 'standard', itiMs: 1100, onsetMs: 3200, presses: [] },
      { type: 'standard', itiMs: 1300, onsetMs: 4800, presses: [120] },
    ]);
    expect(kept.map(({ type, responded, rtMs, outcome }) => ({ type, responded, rtMs, outcome }))).toEqual([
      { type: 'target', responded: true, rtMs: 410, outcome: 'hit' },
      { type: 'standard', responded: false, rtMs: null, outcome: 'correct-rejection' },
      { type: 'standard', responded: false, rtMs: null, outcome: 'correct-rejection' },
    ]);
    expect(kept[0].presses).toEqual([90, 410]);
  });

  it('gives practice feedback in plain words', () => {
    expect(practiceFeedback('hit')).toEqual({ ok: true, text: expect.stringContaining('That was a target') });
    expect(practiceFeedback('miss').ok).toBe(false);
    expect(practiceFeedback('false-alarm').text).toContain('blue circle');
    expect(practiceFeedback('correct-rejection').ok).toBe(true);
  });
});
