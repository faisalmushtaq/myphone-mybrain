import type { Rng } from '../rng';

/**
 * Forward digit span: digits appear one at a time and the person types them
 * back in the same order.
 *
 * Staircase: start at 3 digits, two trials at each length. If at least one of
 * the two is right, move up a length; stop when both are wrong, or after the
 * two trials at 10 digits. Score (the span) = the longest length with a
 * correct trial. A practice trial of 2 digits comes first and does not count.
 *
 * Sequences use the digits 1 to 9 (no 0, so the keypad is a plain 3 × 3
 * grid), never repeat a digit straight after itself, and never run three in a
 * row up or down (like 4 5 6), which would be easier to remember as a chunk.
 */
export const DIGIT_SPAN = {
  startLength: 3,
  maxLength: 10,
  trialsPerLength: 2,
  practiceLength: 2,
  /** Each digit is on screen for 800 ms, then a 200 ms gap: one digit a second. */
  onMs: 800,
  offMs: 200,
  /** A fixation cross before the first digit, so the person is looking at the right place. */
  leadInMs: 1000,
} as const;

export function makeDigitSequence(length: number, rng: Rng): number[] {
  const digits: number[] = [];
  while (digits.length < length) {
    const prev = digits[digits.length - 1];
    const prev2 = digits[digits.length - 2];
    const banned = new Set<number>();
    if (prev !== undefined) banned.add(prev);
    if (prev !== undefined && prev2 !== undefined && Math.abs(prev - prev2) === 1) banned.add(prev + (prev - prev2));
    const allowed = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => !banned.has(d));
    digits.push(allowed[Math.floor(rng() * allowed.length)]);
  }
  return digits;
}

export function isCorrectRecall(sequence: readonly number[], response: readonly number[]): boolean {
  return sequence.length === response.length && sequence.every((d, i) => response[i] === d);
}

export interface SpanTrial {
  length: number;
  sequence: number[];
  response: number[];
  correct: boolean;
  /** From the keypad appearing to the answer being sent, in ms. */
  answerMs: number | null;
}

export interface SpanProgress {
  /** The length of the next trial. */
  length: number;
  /** 0 or 1: which of the two trials at this length is next. */
  trialAtLength: number;
  trials: SpanTrial[];
  finished: boolean;
}

export function startSpan(): SpanProgress {
  return { length: DIGIT_SPAN.startLength, trialAtLength: 0, trials: [], finished: false };
}

/** Adds a finished trial and works out what comes next. */
export function recordSpanTrial(progress: SpanProgress, response: number[], sequence: number[], answerMs: number | null = null): SpanProgress {
  if (progress.finished) return progress;
  const trial: SpanTrial = { length: progress.length, sequence, response, correct: isCorrectRecall(sequence, response), answerMs };
  const trials = [...progress.trials, trial];
  if (progress.trialAtLength + 1 < DIGIT_SPAN.trialsPerLength) return { ...progress, trialAtLength: progress.trialAtLength + 1, trials };
  const atLength = trials.filter((t) => t.length === progress.length);
  const anyRight = atLength.some((t) => t.correct);
  if (!anyRight || progress.length >= DIGIT_SPAN.maxLength) return { ...progress, trials, finished: true };
  return { length: progress.length + 1, trialAtLength: 0, trials, finished: false };
}

export interface SpanScore {
  /** The longest length with a correct trial; 0 if none was right. */
  span: number;
  correctTrials: number;
  totalTrials: number;
}

export function spanScore(trials: readonly SpanTrial[]): SpanScore {
  const correct = trials.filter((t) => t.correct);
  return { span: correct.reduce((best, t) => Math.max(best, t.length), 0), correctTrials: correct.length, totalTrials: trials.length };
}

/** The longest the task can run: two trials at each length from 3 to 10. */
export const MAX_SPAN_TRIALS = (DIGIT_SPAN.maxLength - DIGIT_SPAN.startLength + 1) * DIGIT_SPAN.trialsPerLength;
