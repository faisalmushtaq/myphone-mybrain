import type { DocumentData } from 'firebase-admin/firestore';
import { daysBetween } from './dailyMessages.js';
import { labCheckInDays, labCheckInNumberOn, labStoryCheckIn } from './forms.js';
import { ukDate } from './ukTime.js';

/**
 * The break group's weekly check-ins (26 October 2026): check-in n opens on
 * day labCheckInDays[n - 1] of the break (8, 15, 22 and 29), each with a few
 * questions and a screenshot; the halfway one (day 15) also has MyStory.
 *
 * On the participant's record:
 *   checkInByNumber   { "1": id, "2": id, ... }   the check-in filed for each week
 *   checkInShots      { [checkInId]: n }           screenshots sent with each one
 * Records from before weekly check-ins (one check-in, on day 15) have only
 * checkInIds; that one is the halfway check-in, number 2.
 */

/** The check-in filed for each week, by number. */
export function checkInsOf(participant: DocumentData | undefined): Record<number, string> {
  const out: Record<number, string> = {};
  const byNumber = participant?.checkInByNumber as Record<string, unknown> | undefined;
  if (byNumber && typeof byNumber === 'object') {
    for (const [k, v] of Object.entries(byNumber)) if (typeof v === 'string' && Number(k) >= 1) out[Number(k)] = v;
    return out;
  }
  const ids = Array.isArray(participant?.checkInIds) ? (participant!.checkInIds as unknown[]).filter((v): v is string => typeof v === 'string') : [];
  if (ids.length) out[labStoryCheckIn] = ids[0];
  return out;
}

/** Screenshots sent with one check-in (for a record from before weekly check-ins, those sent mid-break). */
export function checkInShotsOf(participant: DocumentData | undefined, checkInId: string | null | undefined): number {
  if (!participant || !checkInId) return 0;
  const shots = participant.checkInShots as Record<string, unknown> | undefined;
  if (shots && typeof shots === 'object') return Number(shots[checkInId] ?? 0);
  const phaseCounts = participant.phaseCounts as Record<string, { screenshots?: number }> | undefined;
  return Number(phaseCounts?.mid?.screenshots ?? 0);
}

/** The check-ins complete: answers and a screenshot, and for the halfway one MyStory too. */
export function checkInsDone(participant: DocumentData | undefined): number[] {
  const done: number[] = [];
  for (const [n, id] of Object.entries(checkInsOf(participant))) {
    const number = Number(n);
    if (checkInShotsOf(participant, id) < 1) continue;
    if (number === labStoryCheckIn && Number(participant?.storyCounts?.mid ?? 0) < 1) continue;
    done.push(number);
  }
  return done.sort((a, b) => a - b);
}

/** Which check-in is open now: from the day of the break (day 0 is the first visit's UK date), or the first without a first visit. */
export function checkInNumberNow(visit1Start: Date | null, now: Date): number {
  if (!visit1Start) return 1;
  return labCheckInNumberOn(daysBetween(ukDate(visit1Start), ukDate(now)));
}

/** The day of the break each check-in opens. */
export const checkInDayOf = (n: number): number | null => labCheckInDays[n - 1] ?? null;
