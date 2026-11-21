import { randomInt, type Rng } from '../rng';
import { mean, median } from './stats';

/**
 * The Sustained Attention to Response Task (SART), as published by Robertson,
 * Manly, Andrade, Baddeley and Yiend (1997), "'Oops!': performance correlates
 * of everyday attentional failures in traumatic brain injured and normal
 * subjects", Neuropsychologia 35(6), 747–758.
 *
 *  - 225 digits, 1 to 9, each 25 times, in a random order.
 *  - Each digit is shown for 250 ms, then a mask (a circle with a diagonal
 *    cross) for 900 ms: one digit every 1150 ms, about 4.3 minutes in all.
 *  - Each digit is shown at one of five sizes (48, 72, 94, 100 or 120 points),
 *    chosen at random, so attention goes to the digit's identity, not its look.
 *  - Respond (tap, or the space bar) to every digit except 3; hold back for 3.
 *    Speed and accuracy matter equally.
 *  - A response counts for the digit on screen or its mask, until the next
 *    digit appears. The first response at 100 ms or later counts; quicker ones
 *    are anticipations, recorded and reported separately.
 *  - Practice: 18 digits (each twice), with no feedback during it.
 *
 * Scores (the standard ones): commission errors (responding to a 3, out of
 * 25), omission errors (no response to another digit, out of 200), the mean,
 * median and standard deviation of correct reaction times and their
 * coefficient of variation, anticipations, and the mean reaction time of the
 * four digits before each commission error and before each correctly withheld
 * 3 (people speed up before an error).
 *
 * During a block the screen shows only the digit or the mask on a black
 * background, nothing else: no counters, no progress bar, no instructions.
 */
export const NO_GO_DIGIT = 3;
export const SART_FONT_SIZES_PT = [48, 72, 94, 100, 120] as const;
export const SART_ANTICIPATION_MS = 100;

export interface SartSettings {
  /** Times each digit 1–9 appears. */
  perDigit: number;
  digitMs: number;
  maskMs: number;
  /** A blank screen before the first digit. */
  leadInMs: number;
}

export const SART_MAIN: SartSettings = { perDigit: 25, digitMs: 250, maskMs: 900, leadInMs: 2000 };
export const SART_PRACTICE: SartSettings = { ...SART_MAIN, perDigit: 2 };

export interface SartTrialPlan {
  digit: number;
  /** Size in points (1 pt = 4/3 CSS px before any scaling for a small screen). */
  sizePt: number;
}

export interface SartTrialRecord extends SartTrialPlan {
  /** When the digit appeared, in ms after the block started (browser timing: about ±1 frame). */
  onsetMs: number | null;
  /** Every response while it was the current digit, in ms after the digit appeared. */
  presses: number[];
}

export const sartDurationMs = (s: SartSettings) => s.leadInMs + s.perDigit * 9 * (s.digitMs + s.maskMs);

/** Each digit `perDigit` times, shuffled (Fisher–Yates), each with a size drawn at random. */
export function makeSartSequence(settings: SartSettings, rng: Rng): SartTrialPlan[] {
  const digits = Array.from({ length: 9 * settings.perDigit }, (_, i) => (i % 9) + 1);
  for (let i = digits.length - 1; i > 0; i -= 1) {
    const j = randomInt(rng, 0, i);
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return digits.map((digit) => ({ digit, sizePt: SART_FONT_SIZES_PT[randomInt(rng, 0, SART_FONT_SIZES_PT.length - 1)] }));
}

/** The reaction time that counts: the first response at 100 ms or later, or null. */
export function countedRt(presses: readonly number[]): number | null {
  for (const rt of presses) if (rt >= SART_ANTICIPATION_MS) return rt;
  return null;
}

export type SartOutcome = 'go-hit' | 'omission' | 'commission' | 'withheld';

export function sartOutcome(t: Pick<SartTrialRecord, 'digit' | 'presses'>): SartOutcome {
  const responded = countedRt(t.presses) !== null;
  if (t.digit === NO_GO_DIGIT) return responded ? 'commission' : 'withheld';
  return responded ? 'go-hit' : 'omission';
}

export interface SartScores {
  trials: number;
  noGo: number;
  go: number;
  commissions: number;
  omissions: number;
  commissionRate: number | null;
  omissionRate: number | null;
  meanRtMs: number | null;
  medianRtMs: number | null;
  sdRtMs: number | null;
  /** Standard deviation divided by the mean: variability that doesn't depend on speed. */
  cvRt: number | null;
  anticipations: number;
  /** Mean RT of the (up to) four go digits before each commission error, and before each correctly withheld 3. */
  rtBeforeCommissionMs: number | null;
  rtBeforeWithheldMs: number | null;
}

function sd(values: readonly number[]): number | null {
  const m = mean(values);
  if (m === null || values.length < 2) return null;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

const round = (v: number | null, places = 0) => (v === null ? null : Math.round(v * 10 ** places) / 10 ** places);

export function scoreSart(records: readonly SartTrialRecord[]): SartScores {
  const outcomes = records.map(sartOutcome);
  const rts = records.map((r) => countedRt(r.presses));
  const goRts = records.flatMap((_, i) => (outcomes[i] === 'go-hit' && rts[i] !== null ? [rts[i] as number] : []));
  const noGo = records.filter((r) => r.digit === NO_GO_DIGIT).length;
  const go = records.length - noGo;
  const commissions = outcomes.filter((o) => o === 'commission').length;
  const omissions = outcomes.filter((o) => o === 'omission').length;
  const before = (kind: SartOutcome) => {
    const values: number[] = [];
    outcomes.forEach((o, i) => {
      if (o !== kind) return;
      for (let j = i - 1, n = 0; j >= 0 && n < 4; j -= 1) {
        if (records[j].digit === NO_GO_DIGIT) continue;
        n += 1;
        if (rts[j] !== null) values.push(rts[j] as number);
      }
    });
    return mean(values);
  };
  const m = mean(goRts);
  const s = sd(goRts);
  return {
    trials: records.length,
    noGo,
    go,
    commissions,
    omissions,
    commissionRate: noGo ? round(commissions / noGo, 4) : null,
    omissionRate: go ? round(omissions / go, 4) : null,
    meanRtMs: round(m, 1),
    medianRtMs: round(median(goRts), 1),
    sdRtMs: round(s, 1),
    cvRt: m && s !== null ? round(s / m, 4) : null,
    anticipations: records.reduce((n, r) => n + r.presses.filter((rt) => rt < SART_ANTICIPATION_MS).length, 0),
    rtBeforeCommissionMs: round(before('commission'), 1),
    rtBeforeWithheldMs: round(before('withheld'), 1),
  };
}

/** Each trial with its counted RT and outcome, for the record. */
export function withSartOutcomes(records: readonly SartTrialRecord[]) {
  return records.map((r) => ({ ...r, rtMs: countedRt(r.presses), outcome: sartOutcome(r) }));
}
export type SartTrialResult = ReturnType<typeof withSartOutcomes>[number];
