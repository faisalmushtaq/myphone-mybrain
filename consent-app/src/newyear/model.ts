import type { AppId, BreakMode, CheckStatus, ReminderFrequency, VisitKind } from './config';
import type { IsoDate } from './dates';
import type { SpanScore, SpanTrial } from './tasks/digitSpan';
import type { OddballScores, OddballTrialResult } from './tasks/oddball';

/**
 * Everything the online study preview knows. It lives only in this browser's
 * localStorage (see persistence.ts); nothing is ever sent. The design is in
 * docs/online-study.md: an open-ended break, check-ins any time, return
 * visits validated by screen-time screenshots.
 */
export type View = 'about' | 'join' | 'tracker' | 'checkin' | 'visits' | 'visit' | 'results' | 'leaderboard' | 'settings' | 'leave';

export interface Route {
  view: View;
  /** For the visit and results views: which visit. */
  visitId?: string;
  /** For starting a new visit: which kind. */
  kind?: VisitKind;
}

export interface Demographics {
  /** Year and month of birth, 'YYYY-MM'. */
  birthMonth: string;
  sex: string;
  gender: string;
  genderText: string;
  ethnicity: string;
  ethnicityText: string;
  countryOfBirth: string;
  countryOfResidence: string;
  education: string;
  firstLanguage: string;
  otherLanguages: string;
  work: string;
  job: string;
}

export interface Reminders {
  /** Consent to reminder emails (the address is the account's). */
  email: boolean;
  /** Consent to reminder texts. */
  sms: boolean;
  phone: string;
  frequency: ReminderFrequency;
}

export interface Participant {
  /** Generated from the word lists only (names.ts). */
  name: string;
  /** Shown on the leaderboard, or kept off it. */
  onLeaderboard: boolean;
  mode: BreakMode;
  /** Pause these apps (mode 'apps'). */
  apps: AppId[];
  otherApp: string;
  /** Cut total phone time to under this many minutes a day (mode 'total'). */
  goalMinutes: number | null;
  startDate: IsoDate;
  joinedOn: IsoDate;
  joinedAt: string;
  demographics: Demographics;
  reminders: Reminders;
  /** Draft consent: each statement's id and answer, with the time. */
  consent: { version: string; statements: Record<string, boolean>; at: string };
  /** They said they saved the study to their Home Screen (or are using it as an app). */
  savedAsApp: boolean;
  /** Set by the end visit. */
  endedOn: IsoDate | null;
}

export interface CheckIn {
  id: string;
  /** The local date it was given. */
  date: IsoDate;
  at: string;
  /** Since their last check-in (or the start). */
  status: CheckStatus;
  /** If they slipped: the day it (last) happened, from the last check-in to today. */
  slipDate: IsoDate | null;
  /** Rough minutes, if they slipped and said. */
  minutes: number | null;
  /** 1 (very low) to 5 (very good). */
  mood: number;
  /** 1 (not at all) to 5 (a lot). */
  urge: number;
  /** Optional, at most 280 characters. Never shown to anyone else. */
  note: string;
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

/** What a screen-time screenshot showed. In the real study the server reads it; in the preview the person says. */
export interface ScreenshotRecord {
  fileName: string;
  fileType: string;
  fileBytes: number;
  /** The days it covers. */
  from: IsoDate;
  to: IsoDate;
  /** Mode 'apps': minutes a day on the chosen apps, on average. Mode 'total': total phone minutes a day, on average. */
  minutesPerDay: number;
  /** Who read it: 'self' in the preview; 'ocr' or 'team' in the real study. */
  readBy: 'self' | 'ocr' | 'team';
  at: string;
}

export interface DeviceInfo {
  deviceType: 'phone' | 'tablet' | 'computer';
  os: string;
  browser: string;
  screen: string;
  /** Opened from the Home Screen (saved as an app). */
  standalone: boolean;
  timeZone: string;
}

export interface ScalesRecord {
  swemwbs: number[];
}

export interface Visit {
  id: string;
  kind: VisitKind;
  startedOn: IsoDate;
  startedAt: string;
  device: DeviceInfo;
  scales: ScalesRecord | null;
  digitSpan: DigitSpanResult | null;
  oddball: OddballResult | null;
  /** They chose not to do the brain check this time (return visits only). */
  skippedBrainCheck: boolean;
  screenshot: ScreenshotRecord | null;
  /** End visit: why they are ending, and would they do it again. */
  reflection: { why: string; again: string } | null;
  completedOn: IsoDate | null;
  completedAt: string | null;
}

/** A sign-in or opening of the study: device and (in the real study) the country it came from. */
export interface SessionRecord {
  at: string;
  device: DeviceInfo;
}

/** A message for the next screen, such as "Check-in saved". Never saved. */
export type Flash = { kind: 'joined' } | { kind: 'checked-in'; status: CheckStatus } | { kind: 'visit-done'; visitId: string } | { kind: 'deleted' } | { kind: 'settings-saved' };

export interface NyState {
  route: Route;
  participant: Participant | null;
  checkIns: CheckIn[];
  visits: Visit[];
  sessions: SessionRecord[];
  /** Preview tools: pretend today is this many days later, to try later visits. */
  preview: { dayOffset: number };
  flash: Flash | null;
}
