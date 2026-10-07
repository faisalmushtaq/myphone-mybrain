import type { AppId, BreakLength } from './config';
import type { IsoDate } from './dates';
import type { StageId } from './schedule';
import type { KeptAnswer } from './streaks';
import type { SpanScore, SpanTrial } from './tasks/digitSpan';
import type { OddballScores, OddballTrialResult } from './tasks/oddball';

/**
 * Everything the New Year break preview knows. It lives only in this
 * browser's localStorage (see persistence.ts); nothing is ever sent.
 */
export type View = 'about' | 'join' | 'tracker' | 'checkin' | 'checks' | 'brain' | 'results' | 'leaderboard' | 'leave';

export interface Route {
  view: View;
  /** For the brain check and results views. */
  stage?: StageId;
}

export interface Participant {
  /** Generated from the word lists only (names.ts). */
  name: string;
  apps: AppId[];
  /** The "Other" app's name, if given. Only ever shown back to the person. */
  otherApp: string;
  lengthDays: BreakLength;
  startDate: IsoDate;
  joinedOn: IsoDate;
  joinedAt: string;
}

export interface CheckIn {
  /** The day of the break this answer is about (normally yesterday). */
  day: IsoDate;
  kept: KeptAnswer;
  /** Rough minutes on the apps, if the person slipped and said. */
  slipMinutes: number | null;
  /** 1 (very low) to 5 (very good). */
  mood: number;
  /** 1 (not at all) to 5 (a lot). */
  craving: number;
  /** Optional, at most 280 characters. Never shown on the leaderboard. */
  note: string;
  savedOn: IsoDate;
  savedAt: string;
}

export interface DigitSpanResult {
  score: SpanScore;
  trials: SpanTrial[];
  practiceCorrect: boolean;
  seed: number;
  startedAt: string;
  finishedAt: string;
}

export interface OddballTiming {
  /** The longest gap between animation frames during the block, in ms. */
  maxFrameGapMs: number;
  /** Frames that came more than 50 ms after the one before: a busy or throttled device. */
  longFrames: number;
}

export interface OddballResult {
  scores: OddballScores;
  trials: OddballTrialResult[];
  seed: number;
  settings: { trials: number; stimulusMs: number; itiMinMs: number; itiMaxMs: number };
  timing: OddballTiming;
  input: 'touch' | 'keyboard' | 'mixed' | 'none';
  startedAt: string;
  finishedAt: string;
}

export interface StageRecord {
  digitSpan: DigitSpanResult | null;
  oddball: OddballResult | null;
  /** Set once both games are done. */
  completedOn: IsoDate | null;
  completedAt: string | null;
}

/** A message for the next screen, such as "Check-in saved". Never saved. */
export type Flash = { kind: 'joined' } | { kind: 'checked-in'; day: IsoDate } | { kind: 'deleted' };

export interface NyState {
  route: Route;
  participant: Participant | null;
  checkIns: Record<IsoDate, CheckIn>;
  stages: Partial<Record<StageId, StageRecord>>;
  /** Preview tools: pretend today is this many days later, to try the later stages. */
  preview: { dayOffset: number };
  flash: Flash | null;
}
