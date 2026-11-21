import { AI_TOOLS, APPS } from './config';
import type { Participant, ScreenshotRecord } from './model';

/**
 * What someone is taking a break from: any mix of social media apps, AI
 * tools, and a daily limit for all phone use (the PI, 21 November 2026).
 */
type Targets = Pick<Participant, 'apps' | 'otherApp' | 'ai' | 'otherAi' | 'goalMinutes'>;

/** Up to this many minutes a day on the chosen apps still counts as off them (an accidental open, a notification). */
export const APPS_OFF_MINUTES = 5;

export function chosenNames(p: Targets): string[] {
  const apps = APPS.filter((a) => p.apps.includes(a.id)).map((a) => (a.id === 'other' && p.otherApp ? p.otherApp : a.label));
  const ai = AI_TOOLS.filter((a) => p.ai.includes(a.id)).map((a) => (a.id === 'other-ai' && p.otherAi ? p.otherAi : a.label));
  return [...apps, ...ai];
}

export const hasChosen = (p: Targets) => p.apps.length + p.ai.length > 0;

/** "A, B and C" */
export function listText(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "off TikTok and ChatGPT, and under 120 minutes a day on your phone" */
export function aimText(p: Targets): string {
  const parts: string[] = [];
  if (hasChosen(p)) parts.push(`off ${listText(chosenNames(p))}`);
  if (p.goalMinutes) parts.push(`under ${p.goalMinutes} minutes a day on your phone`);
  return parts.join(', and ');
}

/** "A break from TikTok and ChatGPT, and your phone under 120 minutes a day" */
export function planText(p: Targets): string {
  const parts: string[] = [];
  if (hasChosen(p)) parts.push(`A break from ${listText(chosenNames(p))}`);
  if (p.goalMinutes) parts.push(`${parts.length ? 'your' : 'Your'} phone under ${p.goalMinutes} minutes a day`);
  return parts.join(', and ');
}

/** What the urge question asks about. */
export const urgeObject = (p: Targets) => (hasChosen(p) ? (p.apps.length && p.ai.length ? 'those apps and AI tools' : p.ai.length ? 'those AI tools' : 'those apps') : 'your phone');

/** Whether a screenshot reading meets every part of the aim: the chosen apps at (almost) nothing, and total time under the limit. */
export function meetsAim(p: Targets, shot: Pick<ScreenshotRecord, 'chosenMinutesPerDay' | 'totalMinutesPerDay'>): boolean {
  if (hasChosen(p) && (shot.chosenMinutesPerDay === null || shot.chosenMinutesPerDay > APPS_OFF_MINUTES)) return false;
  if (p.goalMinutes && (shot.totalMinutesPerDay === null || shot.totalMinutesPerDay > p.goalMinutes)) return false;
  return true;
}
