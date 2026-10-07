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
}

const withCode = (path: string, code: string, extra: Record<string, string> = {}) => {
  const url = new URL(path, SITE);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  url.searchParams.set('code', code);
  return url.toString();
};

/** MyStory's address for one participant and phase. */
export function storyLink(phase: StoryPhase, code: string): string {
  const mode = storyModes[phase];
  if (mode.mode === 'native') return withCode(labPagePaths.story, code, { phase });
  const url = new URL(mode.url);
  url.searchParams.set(mode.idParam, code);
  if (mode.phaseParam) url.searchParams.set(mode.phaseParam, phase);
  return url.toString();
}

export function participantLinks(code: string): ParticipantLinks {
  return {
    takePart: withCode(labPagePaths.baseline, code),
    book: withCode(labPagePaths.book, code),
    checkIn: withCode(labPagePaths.checkin, code),
    after: withCode(labPagePaths.after, code),
    story: { pre: storyLink('pre', code), mid: storyLink('mid', code), post: storyLink('post', code) },
  };
}

/** The upload page for a school, as given to the school with its password. */
export function schoolUploadLink(slug: string): string {
  const url = new URL('/schools/upload/', SITE);
  url.searchParams.set('school', slug);
  return url.toString();
}
