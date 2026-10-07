import { study } from '../config/study';
import { ageOn, partsToDate } from '../lib/dates';
import type { Actor, AppState, PhoneSource, StepId } from './types';
import { isValidChildDetails, isValidGuardian } from '../lib/validation';

export type Phase = 'details' | 'consent' | 'agreement' | 'phone' | 'check';

export const phases: { id: Phase; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'consent', label: 'Parent or carer' },
  { id: 'agreement', label: 'Agreement' },
  { id: 'phone', label: 'Screen time' },
  { id: 'check', label: 'Check' },
];

export interface StepDef {
  id: StepId;
  phase: Phase;
  /** 'route' means "whoever chose the entry point". */
  actor: Actor | 'route';
  title: string;
}

export const stepDefs: Record<StepId, StepDef> = {
  welcome: { id: 'welcome', phase: 'details', actor: 'anyone', title: 'Welcome' },
  'opt-out': { id: 'opt-out', phase: 'details', actor: 'anyone', title: 'Opting out of the workshop' },
  'child-details': { id: 'child-details', phase: 'details', actor: 'route', title: 'Details' },
  'parent-details': { id: 'parent-details', phase: 'details', actor: 'parent', title: 'Parent or carer details' },
  'parent-consent': { id: 'parent-consent', phase: 'consent', actor: 'parent', title: 'Parent or carer permission' },
  'parent-questions': { id: 'parent-questions', phase: 'consent', actor: 'parent', title: 'Quick questions' },
  'phone-source': { id: 'phone-source', phase: 'consent', actor: 'parent', title: 'Where the screen time comes from' },
  'child-assent': { id: 'child-assent', phase: 'agreement', actor: 'young', title: 'Young person’s agreement' },
  'assent-declined': { id: 'assent-declined', phase: 'agreement', actor: 'young', title: 'Not sharing' },
  'phone-use': { id: 'phone-use', phase: 'phone', actor: 'anyone', title: 'Share the screen time' },
  'parent-more': { id: 'parent-more', phase: 'consent', actor: 'parent', title: 'More questions' },
  check: { id: 'check', phase: 'check', actor: 'anyone', title: 'Check what you’ve sent' },
  done: { id: 'done', phase: 'check', actor: 'anyone', title: 'Thank you' },
};

/** Resolve the concrete actor for a step given the chosen route. */
export function actorFor(stepId: StepId, state: AppState): Actor {
  const def = stepDefs[stepId];
  if (def.actor === 'route') return state.route === 'young' ? 'young' : 'parent';
  return def.actor;
}

/* ── Who decides about the screen time, and where it comes from ─────────── */

/** The young person's age today, from the date of birth given; null until it is a real date. */
export function childAge(state: Pick<AppState, 'identity'>): number | null {
  const dob = partsToDate(state.identity.dateOfBirth);
  return dob ? ageOn(dob) : null;
}

/** 16 or 17 (study.selfConsentAge): the young person decides about sharing their own screen time. */
export function decidesAlone(state: Pick<AppState, 'identity'>): boolean {
  const age = childAge(state);
  return study.selfConsentAge !== null && age !== null && age >= study.selfConsentAge;
}

/** A 16- or 17-year-old doing this on their own: no parent or carer steps at all. */
export function youngAlone(state: AppState): boolean {
  return state.route === 'young' && decidesAlone(state);
}

/** Whether a parent or carer takes part on this device: permission (for their own answers, and for an under-16's screen time) and the questions. */
export function parentInvolved(state: AppState): boolean {
  return !youngAlone(state);
}

/**
 * Where the young person's screen time comes from, once that is known:
 *   16 or over: their own phone, by their own choice;
 *   under 16, after the parent's yes: the young person's phone on their own
 *   route (they are holding it), otherwise what the parent chose (null until
 *   then); after the parent's no: nowhere.
 */
export function phoneSourceOf(state: AppState): PhoneSource | null {
  if (decidesAlone(state)) return 'child';
  const answer = state.consent.responses['phone-use']?.response;
  if (answer === 'declined') return 'none';
  if (answer !== 'agreed') return null;
  if (state.route === 'young') return 'child';
  return state.phoneSource;
}

/** Whether the parent chooses where an under-16's screen time comes from (parent route, after a yes). */
export function phoneSourceApplies(state: AppState): boolean {
  return state.route === 'parent' && !decidesAlone(state) && state.consent.responses['phone-use']?.response === 'agreed';
}

/** Whether the young person's own agreement is asked: whenever the screenshots are to come from their phone, unless it was put off (not there, or deciding later). */
export function assentApplies(state: AppState): boolean {
  return phoneSourceOf(state) === 'child' && state.assent.status !== 'deferred';
}

/** Whether the screenshots step applies: from the parent's own phone, or from the young person's with their agreement. */
export function phoneUseApplies(state: AppState): boolean {
  const source = phoneSourceOf(state);
  if (source === 'parent') return true;
  return source === 'child' && state.assent.status === 'completed';
}

/**
 * The longer questions for the parent, whenever the young person's screen
 * time is not coming through this form: the parent said no or chose
 * "neither"; or could not send it from their own phone; or the young person
 * said no, was not there, put it off, or skipped the screenshots.
 */
export function parentMoreApplies(state: AppState): boolean {
  if (!parentInvolved(state)) return false;
  const source = phoneSourceOf(state);
  if (source === 'none') return true;
  if (source === 'parent') return state.donation.status === 'skipped';
  if (source === 'child') return state.assent.status === 'declined' || state.assent.status === 'deferred' || state.donation.status === 'skipped';
  return false;
}

/**
 * The ordered list of steps for the current state. It is recomputed whenever
 * state changes, so the answers given (the young person's age, the parent's
 * yes or no to sharing, where the screen time comes from, the young person's
 * own answer) add and remove steps, and the progress indicator adapts.
 *
 * On the parent route the parent enters the young person's details and their
 * own on one screen, so there is no separate parent-details step. The opt-out
 * pages stand apart: they record nothing.
 */
export function buildJourney(state: AppState): StepId[] {
  if (state.stepId === 'opt-out') return ['welcome', 'opt-out'];
  const steps: StepId[] = ['welcome', 'child-details'];
  if (youngAlone(state)) {
    steps.push('child-assent');
    if (state.assent.status === 'declined') return [...steps, 'assent-declined'];
    if (phoneUseApplies(state)) steps.push('phone-use');
    steps.push('check', 'done');
    return steps;
  }
  if (state.route !== 'parent') steps.push('parent-details');
  steps.push('parent-consent');
  if (study.parentQuestions) steps.push('parent-questions');
  if (phoneSourceApplies(state)) steps.push('phone-source');
  if (assentApplies(state)) {
    steps.push('child-assent');
    if (state.assent.status === 'declined') steps.push('assent-declined');
  }
  if (phoneUseApplies(state)) steps.push('phone-use');
  if (parentMoreApplies(state)) steps.push('parent-more');
  steps.push('check', 'done');
  return steps;
}

/** Steps that count towards "Step n of m" (welcome and the confirmation screen are not steps). */
export function countedSteps(state: AppState): StepId[] {
  return buildJourney(state).filter((s) => s !== 'done' && s !== 'welcome' && s !== 'opt-out');
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
 * Whether a step has everything it needs. Used when returning to the check
 * page after a change: we only jump back once every step in between is done.
 */
export function isStepComplete(stepId: StepId, state: AppState): boolean {
  switch (stepId) {
    case 'welcome':
      return state.route !== null;
    case 'opt-out':
      return true;
    case 'child-details':
      return isValidChildDetails(state.identity) && (state.route !== 'parent' || isValidGuardian(state.guardian));
    case 'parent-details':
      return isValidGuardian(state.guardian);
    case 'parent-consent':
      return state.consent.completedAt !== null;
    case 'parent-questions':
      return state.survey.status === 'completed' || state.survey.status === 'skipped';
    case 'phone-source':
      return state.phoneSource !== null;
    case 'child-assent':
      return state.assent.status !== 'not-started';
    case 'assent-declined':
      return true;
    case 'phone-use':
      return state.donation.status === 'completed' || state.donation.status === 'skipped';
    case 'parent-more':
      return state.more.status === 'completed' || state.more.status === 'skipped';
    case 'check':
      return state.submission.consentStage === 'sent';
    case 'done':
      return true;
  }
}

/**
 * Whether moving from `from` to `to` requires the device to change hands.
 * A handover is shown whenever the destination belongs to a specific person
 * (parent or young person) and the current step does not already belong to
 * them. That covers going forwards, going back, and "Change" links, so one
 * person can never open the other's section unannounced.
 */
export function needsHandover(from: StepId, to: StepId, state: AppState): boolean {
  if (from === 'welcome' || from === 'opt-out') return false;
  const a = actorFor(from, state);
  const b = actorFor(to, state);
  return b !== 'anyone' && a !== b;
}
