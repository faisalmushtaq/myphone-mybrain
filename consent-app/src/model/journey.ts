import { study } from '../config/study';
import type { Actor, AppState, StepId } from './types';
import { isValidChildDetails, isValidGuardian } from '../lib/validation';

export type Phase = 'details' | 'consent' | 'agreement' | 'phone' | 'send';

export const phases: { id: Phase; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'consent', label: 'Permission' },
  { id: 'agreement', label: 'Agreement' },
  { id: 'phone', label: 'Screen time' },
  { id: 'send', label: 'Send' },
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
  'child-details': { id: 'child-details', phase: 'details', actor: 'route', title: 'Details' },
  'parent-details': { id: 'parent-details', phase: 'details', actor: 'parent', title: 'Parent or guardian details' },
  'parent-consent': { id: 'parent-consent', phase: 'consent', actor: 'parent', title: 'Parent or guardian permission' },
  'child-assent': { id: 'child-assent', phase: 'agreement', actor: 'young', title: 'Young person’s agreement' },
  'assent-declined': { id: 'assent-declined', phase: 'agreement', actor: 'young', title: 'Not taking part' },
  'phone-use': { id: 'phone-use', phase: 'phone', actor: 'anyone', title: 'Share your screen time' },
  send: { id: 'send', phase: 'send', actor: 'anyone', title: 'Send' },
  done: { id: 'done', phase: 'send', actor: 'anyone', title: 'Thank you' },
};

/** Resolve the concrete actor for a step given the chosen route. */
export function actorFor(stepId: StepId, state: AppState): Actor {
  const def = stepDefs[stepId];
  if (def.actor === 'route') return state.route === 'young' ? 'young' : 'parent';
  return def.actor;
}

/** Whether the phone-use step applies, given the choices made so far. */
export function phoneUseApplies(state: AppState): boolean {
  if (state.consent.responses['phone-use']?.response === 'declined') return false;
  if (state.assent.status === 'declined') return false;
  if (study.requireAssentBeforeDonation && state.assent.status === 'deferred') return false;
  return true;
}

/** Whether the young person's agreement step applies. */
export function assentApplies(state: AppState): boolean {
  return state.assent.status !== 'deferred';
}

/**
 * The ordered list of steps for the current state. It is recomputed whenever
 * state changes, so declining phone-use consent (for example) removes the
 * phone-use step and the progress indicator adapts.
 *
 * On the parent route the parent enters the young person's details and their
 * own on one screen, so there is no separate parent-details step.
 */
export function buildJourney(state: AppState): StepId[] {
  const steps: StepId[] = ['welcome', 'child-details'];
  if (state.route !== 'parent') steps.push('parent-details');
  steps.push('parent-consent');
  if (assentApplies(state)) {
    steps.push('child-assent');
    if (state.assent.status === 'declined') {
      steps.push('assent-declined', 'done');
      return steps;
    }
  }
  if (phoneUseApplies(state)) steps.push('phone-use');
  steps.push('send', 'done');
  return steps;
}

/** Steps that count towards "Step n of m" (welcome and the confirmation screen are not steps). */
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
 * Whether a step has everything it needs. Used when returning to the send
 * page after a change: we only jump back once every step in between is done.
 */
export function isStepComplete(stepId: StepId, state: AppState): boolean {
  switch (stepId) {
    case 'welcome':
      return state.route !== null;
    case 'child-details':
      return isValidChildDetails(state.identity) && (state.route !== 'parent' || isValidGuardian(state.guardian));
    case 'parent-details':
      return isValidGuardian(state.guardian);
    case 'parent-consent':
      return state.consent.completedAt !== null;
    case 'child-assent':
      return state.assent.status !== 'not-started';
    case 'assent-declined':
      return true;
    case 'phone-use':
      return state.donation.status === 'completed' || state.donation.status === 'skipped';
    case 'send':
      return state.submission.stage === 'done';
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
  if (from === 'welcome') return false;
  const a = actorFor(from, state);
  const b = actorFor(to, state);
  return b !== 'anyone' && a !== b;
}
