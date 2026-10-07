import type { StageId } from './schedule';
import type { KeptAnswer } from './streaks';

/**
 * Wording and options for the New Year break. This is a preview: none of it
 * has been through ethics review yet (see docs/new-year-break.md).
 */
export const APPS = [
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'snapchat', label: 'Snapchat' },
  { id: 'x', label: 'X (Twitter)' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'other', label: 'Other' },
] as const;

export type AppId = (typeof APPS)[number]['id'];
export const APP_IDS: readonly AppId[] = APPS.map((a) => a.id);

export const LENGTHS = [7, 14, 30] as const;
export type BreakLength = (typeof LENGTHS)[number];
export const DEFAULT_LENGTH: BreakLength = 30;

/** Limits, enforced on the inputs and when saved progress is read back. */
export const LIMITS = { otherApp: 30, note: 280, slipMinutes: 1440, startDaysAhead: 365 } as const;

export const KEPT_OPTIONS: { value: KeptAnswer; label: string }[] = [
  { value: 'yes', label: 'Yes, completely' },
  { value: 'little', label: 'I slipped a little' },
  { value: 'lot', label: 'I slipped a lot' },
];

export const MOOD_LABELS = ['Very low', 'Low', 'Okay', 'Good', 'Very good'] as const;
export const CRAVING_LABELS = ['Not at all', 'A little', 'Some', 'Quite a lot', 'A lot'] as const;

export const STAGE_TEXT: Record<StageId, { name: string; title: string; when: string }> = {
  baseline: { name: 'Before your break', title: 'Before-break brain check', when: 'before your break' },
  halfway: { name: 'Halfway', title: 'Halfway brain check', when: 'at halfway' },
  end: { name: 'End of your break', title: 'End-of-break brain check', when: 'at the end of your break' },
  followup: { name: 'One month on', title: 'One-month brain check', when: 'a month after your break' },
};

export const STORAGE_KEY = 'mpmb-newyear:v1';
