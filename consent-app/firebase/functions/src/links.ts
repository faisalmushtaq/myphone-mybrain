import { labPagePaths, storyModes, type StoryPhase } from './forms.js';

/**
 * Each participant's own links: every page of the study opens ready for
 * them, with their participant ID filled in, on any device, so nobody has to
 * enter their details again. The same links go in the confirmation and
 * reminder emails and texts, and the staff page lists them for anyone who
 * needs one sent by hand. A MyStory phase run by another survey (MySelf, for
 * example) gets that survey's address with the ID and the phase added.
 *
 * The participant ID is not a secret password: the pages only ever show
 * what a person has sent and let them add to it or book; every booking
 * change is emailed to the participant and the team.
 */

export const SITE = 'https://myphonemybrain.com';

export interface ParticipantLinks {
  /** Before the break: consent, screenshots, app data. */
  takePart: string;
  /** Booking, changing or cancelling the lab visits. */
  book: string;
  /** The weekly check-ins during the break. */
  checkIn: string;
  /** After the break: screenshots and app data again. */
  after: string;
  /** MyStory for each phase: this site's page, or another survey's address with the ID and the phase. */
  story: Record<StoryPhase, string>;
  /** MyStory before and after the break, told at the lab visits on a lab computer: the page forgets the participant once the story is sent. */
  atLab: Record<'pre' | 'post', string>;
}

const withCode = (path: string, code: string, extra: Record<string, string> = {}) => {
  const url = new URL(path, SITE);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  url.searchParams.set('code', code);
  return url.toString();
};

/** MyStory's address for one participant and phase; at the lab, on a shared computer. */
export function storyLink(phase: StoryPhase, code: string, atLab = false, group: 'break' | 'control' = 'break'): string {
  const mode = storyModes[phase];
  const g: Record<string, string> = group === 'control' ? { group: 'control' } : {};
  if (mode.mode === 'native' || mode.mode === 'chat') return withCode(labPagePaths.story, code, atLab ? { phase, at: 'lab', ...g } : { phase, ...g });
  const url = new URL(mode.url);
  url.searchParams.set(mode.idParam, code);
  if (mode.phaseParam) url.searchParams.set(mode.phaseParam, phase);
  return url.toString();
}

/** The control group's first page (21 October 2026); every later page is shared and finds the group from the record. */
export const CONTROL_PATH = '/break/control/';

export function participantLinks(code: string, group: 'break' | 'control' = 'break'): ParticipantLinks {
  // The shared pages say the control group's words from the start when the link says so (they also learn it from the record).
  const g: Record<string, string> = group === 'control' ? { group: 'control' } : {};
  return {
    takePart: withCode(group === 'control' ? CONTROL_PATH : labPagePaths.baseline, code),
    book: withCode(labPagePaths.book, code, g),
    checkIn: withCode(labPagePaths.checkin, code, g),
    after: withCode(labPagePaths.after, code, g),
    story: { pre: storyLink('pre', code, false, group), mid: storyLink('mid', code, false, group), post: storyLink('post', code, false, group) },
    atLab: { pre: storyLink('pre', code, true, group), post: storyLink('post', code, true, group) },
  };
}

/** The upload page for a school, as given to the school with its password. */
export function schoolUploadLink(slug: string): string {
  const url = new URL('/schools/upload/', SITE);
  url.searchParams.set('school', slug);
  return url.toString();
}
