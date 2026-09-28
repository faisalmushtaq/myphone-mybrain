import { study } from '../config/study';
import type { Actor, AppState, StepId } from './types';
import { isValidChildDetails, isValidGuardian } from '../lib/validation';

export type Phase = 'about' | 'details' | 'consent' | 'agreement' | 'phone' | 'finish';

export const phases: { id: Phase; label: string }[] = [
  { id: 'about', label: 'About' },
  { id: 'details', label: 'Details' },
  { id: 'consent', label: 'Consent' },
  { id: 'agreement', label: 'Agreement' },
  { id: 'phone', label: 'Phone use' },
  { id: 'finish', label: 'Finish' },
];

export interface StepDef {
  id: StepId;
  phase: Phase;
  /** 'route' means "whoever chose the entry point". */
  actor: Actor | 'route';
  title: string;
}

export const stepDefs: Record<StepId, StepDef> = {
  welcome: { id: 'welcome', phase: 'about', actor: 'anyone', title: 'Welcome' },
  about: { id: 'about', phase: 'about', actor: 'route', title: 'About the study' },
  'child-details': { id: 'child-details', phase: 'details', actor: 'route', title: 'Young person’s details' },
  'parent-details': { id: 'parent-details', phase: 'details', actor: 'parent', title: 'Parent or guardian details' },
  'parent-information': { id: 'parent-information', phase: 'consent', actor: 'parent', title: 'Information for parents' },
  'parent-consent': { id: 'parent-consent', phase: 'consent', actor: 'parent', title: 'Parent or guardian consent' },
  'child-assent': { id: 'child-assent', phase: 'agreement', actor: 'young', title: 'Young person’s agreement' },
  'assent-declined': { id: 'assent-declined', phase: 'agreement', actor: 'young', title: 'Not taking part' },
  'phone-type': { id: 'phone-type', phase: 'phone', actor: 'anyone', title: 'Share phone-use information' },
  'find-screen-time': { id: 'find-screen-time', phase: 'phone', actor: 'anyone', title: 'Find your screen-time summary' },
  upload: { id: 'upload', phase: 'phone', actor: 'anyone', title: 'Add your screenshots' },
  review: { id: 'review', phase: 'finish', actor: 'anyone', title: 'Check and send' },
  done: { id: 'done', phase: 'finish', actor: 'anyone', title: 'Thank you' },
};

/** Resolve the concrete actor for a step given the chosen route. */
export function actorFor(stepId: StepId, state: AppState): Actor {
  const def = stepDefs[stepId];
  if (def.actor === 'route') return state.route === 'young' ? 'young' : 'parent';
  return def.actor;
}

/** Whether the phone-use steps apply, given the choices made so far. */
export function phoneUseApplies(state: AppState): boolean {
  if (state.consent.responses['phone-use']?.response === 'declined') return false;
  if (state.assent.status === 'declined') return false;
  if (study.requireAssentBeforeDonation && state.assent.status === 'deferred') return false;
  if (state.assent.status === 'completed' && state.assent.responses['phone-use']?.response === 'declined') return false;
  return true;
}

/** Whether the young person's agreement step applies. */
export function assentApplies(state: AppState): boolean {
  if (state.assent.status === 'deferred') return false;
  return true;
}

/**
 * The ordered list of steps for the current state. It is recomputed whenever
 * state changes, so declining phone-use consent (for example) removes the
 * phone-use steps and the progress indicator adapts.
 */
export function buildJourney(state: AppState): StepId[] {
  const steps: StepId[] = ['welcome', 'about', 'child-details', 'parent-details', 'parent-information', 'parent-consent'];
  if (assentApplies(state)) {
    steps.push('child-assent');
    if (state.assent.status === 'declined') {
      steps.push('assent-declined', 'done');
      return steps;
    }
  }
  if (phoneUseApplies(state)) steps.push('phone-type', 'find-screen-time', 'upload');
  steps.push('review', 'done');
  return steps;
}

/** Steps that count towards "Step n of m" (the confirmation screen is not a step). */
export function countedSteps(state: AppState): StepId[] {
  return buildJourney(state).filter((s) => s !== 'done' && s !== 'welcome');
}

export function nextStepId(state: AppState): StepId | null {
  const journey = buildJourney(state);
  const i = journey.indexOf(state.stepId);
  return i >= 0 && i < journey.length - 1 ? journey[i + 1] : null;
}

export function previousStepId(state: AppState): StepId | null {
  const journey = buildJourney(state);
  const i = journey.indexOf(state.stepId);
  return i > 0 ? journey[i - 1] : null;
}

/**
 * Whether a step has everything it needs. Used when returning to the review
 * page after a change: we only jump back once every step in between is done.
 */
export function isStepComplete(stepId: StepId, state: AppState): boolean {
  switch (stepId) {
    case 'welcome':
      return state.route !== null;
    case 'about':
      return true;
    case 'child-details':
      return isValidChildDetails(state.identity);
    case 'parent-details':
      return isValidGuardian(state.guardian);
    case 'parent-information':
      return true;
    case 'parent-consent':
      return state.consent.completedAt !== null;
    case 'child-assent':
      return state.assent.status !== 'not-started';
    case 'assent-declined':
      return true;
    case 'phone-type':
      return state.donation.platform !== null;
    case 'find-screen-time':
      return state.donation.platform !== null;
    case 'upload':
      return state.donation.status === 'completed' || state.donation.status === 'skipped';
    case 'review':
      return state.submission.stage === 'done';
    case 'done':
      return true;
  }
}

/**
 * Whether moving from `from` to `to` requires the device to change hands.
 * A handover is shown whenever the destination belongs to a specific person
 * (parent or young person) and the current step does not already belong to
 * them. That covers going forwards, going back, and "Change" links from the
 * review page, so one person can never open the other's section unannounced.
 */
export function needsHandover(from: StepId, to: StepId, state: AppState): boolean {
  if (from === 'welcome') return false;
  const a = actorFor(from, state);
  const b = actorFor(to, state);
  return b !== 'anyone' && a !== b;
}
