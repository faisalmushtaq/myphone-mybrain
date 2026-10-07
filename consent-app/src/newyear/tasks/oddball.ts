import { randomInt, type Rng } from '../rng';
import { dPrime, mean, median } from './stats';

/**
 * Visual oddball: a stream of shapes in the middle of the screen. Most are
 * the standard (a blue circle); a few are the target (an orange-yellow
 * square), and the person taps only for the target. Shape and colour both
 * differ, so it works for people who see colour differently.
 *
 * Each trial: the shape for 500 ms, then a fixation cross for a jittered
 * 1000–1400 ms (so the next shape can't be timed), and a response counts for
 * the trial it follows until the next shape appears. With 100 trials that is
 * about 2 minutes 50 seconds; 20% are targets, never two in a row, and at
 * least 3 standards come before the first.
 */
export type OddballStimulus = 'standard' | 'target';

export interface OddballSettings {
  trials: number;
  targetShare: number;
  /** Standards before the first target. */
  leadStandards: number;
  stimulusMs: number;
  itiMinMs: number;
  itiMaxMs: number;
  /** Fixation cross before the first shape. */
  leadInMs: number;
  /** Practice only: how long the "That was a target" feedback stays up after each trial. */
  feedbackMs: number;
}

export const ODDBALL_MAIN: OddballSettings = { trials: 100, targetShare: 0.2, leadStandards: 3, stimulusMs: 500, itiMinMs: 1000, itiMaxMs: 1400, leadInMs: 1500, feedbackMs: 0 };
export const ODDBALL_PRACTICE: OddballSettings = { ...ODDBALL_MAIN, trials: 10, feedbackMs: 1400 };

/** Responses faster than this after the shape appears are too quick to be a reaction to it. */
export const ANTICIPATION_MS = 150;

export interface OddballTrialPlan {
  type: OddballStimulus;
  /** Fixation after this trial's shape, before the next one. */
  itiMs: number;
}

/**
 * The order of shapes. Target positions are drawn evenly from every
 * arrangement that keeps the rules: choose k gaps from the n − lead − (k − 1)
 * free places, then spread them out by one place each, so no two targets are
 * adjacent.
 */
export function makeOddballSequence(settings: OddballSettings, rng: Rng): OddballTrialPlan[] {
  const n = settings.trials;
  const k = Math.round(n * settings.targetShare);
  const slots = n - settings.leadStandards - (k - 1);
  if (k > 0 && slots < k) throw new Error('Too many targets for the rules on order');
  const pool = Array.from({ length: Math.max(slots, 0) }, (_, i) => i);
  // Partial Fisher–Yates: the first k items are an even random choice from the pool.
  for (let i = 0; i < k; i += 1) {
    const j = randomInt(rng, i, pool.length - 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const targets = new Set(
    pool
      .slice(0, k)
      .sort((a, b) => a - b)
      .map((value, i) => settings.leadStandards + value + i),
  );
  return Array.from({ length: n }, (_, i) => ({
    type: targets.has(i) ? 'target' : 'standard',
    itiMs: randomInt(rng, settings.itiMinMs, settings.itiMaxMs),
  }));
}

/** What happened on one trial: every press while it was the current trial, in ms after the shape appeared. */
export interface OddballTrialRecord {
  type: OddballStimulus;
  itiMs: number;
  /** When the shape appeared, in ms after the block started (browser timing: about ±1 frame). */
  onsetMs: number | null;
  presses: number[];
}

export type TrialOutcome = 'hit' | 'miss' | 'false-alarm' | 'correct-rejection';

/** The first press at 150 ms or later counts; quicker ones are anticipations and are counted on their own. */
export function firstValidPress(presses: readonly number[]): number | null {
  for (const rt of presses) if (rt >= ANTICIPATION_MS) return rt;
  return null;
}

export function trialOutcome(trial: Pick<OddballTrialRecord, 'type' | 'presses'>): TrialOutcome {
  const responded = firstValidPress(trial.presses) !== null;
  if (trial.type === 'target') return responded ? 'hit' : 'miss';
  return responded ? 'false-alarm' : 'correct-rejection';
}

/** A trial as kept with the results: what happened, plus whether it counted as a response and its reaction time. */
export interface OddballTrialResult extends OddballTrialRecord {
  /** A press at 150 ms or later. */
  responded: boolean;
  /** Time of that press after the shape appeared, in ms; null when there was none. */
  rtMs: number | null;
  outcome: TrialOutcome;
}

export function withOutcomes(trials: readonly OddballTrialRecord[]): OddballTrialResult[] {
  return trials.map((t) => {
    const rtMs = firstValidPress(t.presses);
    return { ...t, responded: rtMs !== null, rtMs, outcome: trialOutcome(t) };
  });
}

export interface OddballScores {
  targets: number;
  standards: number;
  hits: number;
  misses: number;
  falseAlarms: number;
  correctRejections: number;
  hitRate: number | null;
  falseAlarmRate: number | null;
  /** Presses under 150 ms, on any trial. Not counted as hits or false alarms. */
  anticipations: number;
  /** Reaction times of hits only, in ms. */
  meanRtMs: number | null;
  medianRtMs: number | null;
  dPrime: number | null;
}

export function scoreOddball(trials: readonly Pick<OddballTrialRecord, 'type' | 'presses'>[]): OddballScores {
  let hits = 0;
  let misses = 0;
  let falseAlarms = 0;
  let correctRejections = 0;
  let anticipations = 0;
  const hitRts: number[] = [];
  for (const trial of trials) {
    anticipations += trial.presses.filter((rt) => rt < ANTICIPATION_MS).length;
    const outcome = trialOutcome(trial);
    if (outcome === 'hit') {
      hits += 1;
      hitRts.push(firstValidPress(trial.presses) as number);
    } else if (outcome === 'miss') misses += 1;
    else if (outcome === 'false-alarm') falseAlarms += 1;
    else correctRejections += 1;
  }
  const targets = hits + misses;
  const standards = falseAlarms + correctRejections;
  return {
    targets,
    standards,
    hits,
    misses,
    falseAlarms,
    correctRejections,
    hitRate: targets ? hits / targets : null,
    falseAlarmRate: standards ? falseAlarms / standards : null,
    anticipations,
    meanRtMs: mean(hitRts),
    medianRtMs: median(hitRts),
    dPrime: dPrime(hits, targets, falseAlarms, standards),
  };
}

/** Roughly how long a block takes, for telling people before they start. */
export function expectedDurationMs(settings: OddballSettings): number {
  const perTrial = settings.stimulusMs + (settings.itiMinMs + settings.itiMaxMs) / 2 + settings.feedbackMs;
  return settings.leadInMs + settings.trials * perTrial;
}

/** Practice feedback, in plain words. */
export function practiceFeedback(outcome: TrialOutcome): { ok: boolean; text: string } {
  switch (outcome) {
    case 'hit':
      return { ok: true, text: 'That was a target, and you tapped. Well done.' };
    case 'miss':
      return { ok: false, text: 'That was a target. Tap when you see the orange square.' };
    case 'false-alarm':
      return { ok: false, text: 'That was a blue circle. No need to tap for those.' };
    default:
      return { ok: true, text: 'Right: no tap for a blue circle.' };
  }
}
