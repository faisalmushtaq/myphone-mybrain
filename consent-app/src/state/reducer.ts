import { childAssentForm, parentConsentForm } from '../config/statements';
import type { PlatformId } from '../config/walkthroughs';
import { todayIso } from '../lib/dates';
import { imageStore } from '../lib/imageStore';
import { actorFor, buildJourney, isStepComplete, needsHandover, nextStepId, previousStepId, stepDefs } from '../model/journey';
import type {
  AppState,
  AssentStatus,
  DonationImage,
  DonationStatus,
  GuardianIdentity,
  ParticipantIdentity,
  PrototypeFlags,
  Route,
  SessionInfo,
  SignatureRecord,
  StatementResponse,
  StepId,
  SubmissionState,
} from '../model/types';

export function initialState(): AppState {
  return {
    route: null,
    stepId: 'welcome',
    handover: null,
    clearedReason: null,
    childPresent: null,
    returnTo: null,
    identity: { firstName: '', lastName: '', dateOfBirth: { day: '', month: '', year: '' }, schoolId: '', schoolOther: '', yearGroup: '' },
    guardian: { fullName: '', relationship: '', relationshipOther: '', hasParentalResponsibility: false, email: '', phone: '', postcode: '' },
    consent: {
      formId: parentConsentForm.id,
      formVersion: parentConsentForm.version,
      informationVersion: null,
      responses: {},
      typedName: '',
      signature: null,
      confirmedDate: todayIso(),
      completedAt: null,
      revisedAt: null,
    },
    assent: {
      formId: childAssentForm.id,
      formVersion: childAssentForm.version,
      status: 'not-started',
      deferredBy: null,
      responses: {},
      typedName: '',
      handoverConfirmedAt: null,
      startedAt: null,
      completedAt: null,
    },
    donation: { platform: null, images: [], status: 'not-started' },
    submission: { stage: 'idle', stageLabel: '', error: null, referenceCode: null, receivedAt: null },
    session: null,
    prototype: { failUploads: false, failSubmit: false, showDraftMarkers: true },
    restored: false,
  };
}

export type Action =
  | { type: 'hydrate'; state: AppState }
  | { type: 'reset'; reason?: AppState['clearedReason'] }
  | { type: 'set-route'; route: Route }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'go-to'; stepId: StepId; returnTo?: StepId | null }
  | { type: 'confirm-handover' }
  | { type: 'cancel-handover' }
  | { type: 'set-child-present'; present: boolean }
  | { type: 'update-identity'; patch: Partial<ParticipantIdentity> }
  | { type: 'update-guardian'; patch: Partial<GuardianIdentity> }
  | { type: 'consent-response'; statementId: string; version: string; response: StatementResponse }
  | { type: 'consent-typed-name'; name: string }
  | { type: 'consent-signature'; signature: SignatureRecord | null }
  | { type: 'consent-date'; date: string }
  | { type: 'consent-complete'; informationVersion: string }
  | { type: 'assent-started' }
  | { type: 'assent-response'; statementId: string; version: string; response: StatementResponse }
  | { type: 'assent-typed-name'; name: string }
  | { type: 'assent-status'; status: AssentStatus; deferredBy?: 'parent' | 'young' }
  | { type: 'set-platform'; platform: PlatformId }
  | { type: 'add-image'; image: DonationImage }
  | { type: 'update-image'; id: string; patch: Partial<DonationImage> }
  | { type: 'remove-image'; id: string }
  | { type: 'donation-status'; status: DonationStatus }
  | { type: 'submission'; patch: Partial<SubmissionState> }
  | { type: 'session'; session: SessionInfo | null }
  | { type: 'prototype'; patch: Partial<PrototypeFlags> };

/** Move to `target`, showing a handover screen first if the device must change hands. */
function moveTo(state: AppState, target: StepId): AppState {
  if (needsHandover(state.stepId, target, state)) {
    return { ...state, handover: { from: actorFor(state.stepId, state), to: actorFor(target, state), nextStep: target } };
  }
  return { ...state, stepId: target, handover: null };
}

/** After a change made from the review page, return there once everything in between is complete. */
function nextAfterChange(state: AppState): StepId | null {
  const journey = buildJourney(state);
  const from = journey.indexOf(state.stepId);
  const to = journey.indexOf(state.returnTo ?? 'review');
  if (from < 0 || to < 0) return null;
  for (let i = from + 1; i < to; i += 1) {
    if (!isStepComplete(journey[i], state)) return journey[i];
  }
  return journey[to];
}

function deferDonation(state: AppState): AppState['donation'] {
  // A parent's "no" to phone-use takes precedence over "waiting for the young person".
  return state.donation.status === 'not-consented' ? state.donation : { ...state.donation, status: 'deferred' };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'hydrate':
      return { ...action.state, restored: true, handover: null };
    case 'reset':
      imageStore.clear();
      return { ...initialState(), session: state.session, prototype: state.prototype, clearedReason: action.reason ?? null };
    case 'set-route':
      return { ...state, route: action.route, clearedReason: null };
    case 'next': {
      const target = (state.returnTo ? nextAfterChange(state) : null) ?? nextStepId(state);
      if (!target) return state;
      const clearedReturn = target === state.returnTo ? { ...state, returnTo: null } : state;
      return moveTo(clearedReturn, target);
    }
    case 'back': {
      if (state.handover) return { ...state, handover: null };
      const target = previousStepId(state);
      return target ? moveTo(state, target) : state;
    }
    case 'go-to': {
      const next = { ...state, returnTo: action.returnTo === undefined ? state.returnTo : action.returnTo };
      // Changing identifying details is open to either person; consent and agreement sections are not.
      const guarded = stepDefs[action.stepId].phase === 'consent' || stepDefs[action.stepId].phase === 'agreement';
      return guarded ? moveTo(next, action.stepId) : { ...next, stepId: action.stepId, handover: null };
    }
    case 'confirm-handover': {
      if (!state.handover) return state;
      const assent = state.handover.to === 'young' && state.handover.nextStep === 'child-assent' ? { ...state.assent, handoverConfirmedAt: new Date().toISOString() } : state.assent;
      return { ...state, stepId: state.handover.nextStep, handover: null, assent };
    }
    case 'cancel-handover':
      return { ...state, handover: null };
    case 'set-child-present': {
      const next = { ...state, childPresent: action.present };
      if (!action.present) {
        // The young person's part is collected separately, so their agreement and the phone-use steps are skipped.
        next.assent = { ...state.assent, status: 'deferred', deferredBy: 'parent', responses: {}, typedName: '', completedAt: null };
        next.donation = deferDonation(state);
      } else if (state.assent.status === 'deferred') {
        next.assent = { ...state.assent, status: 'not-started', deferredBy: null };
        next.donation = state.donation.status === 'deferred' ? { ...state.donation, status: state.donation.images.length ? 'in-progress' : 'not-started' } : state.donation;
      }
      return next;
    }
    case 'update-identity':
      return { ...state, identity: { ...state.identity, ...action.patch } };
    case 'update-guardian':
      return { ...state, guardian: { ...state.guardian, ...action.patch } };
    case 'consent-response': {
      const responses = {
        ...state.consent.responses,
        [action.statementId]: { statementId: action.statementId, version: action.version, response: action.response, respondedAt: new Date().toISOString() },
      };
      // A signature attests to the statements as they stood; changing one after signing means signing again.
      const signedBefore = state.consent.completedAt !== null;
      const consent = {
        ...state.consent,
        responses,
        completedAt: null,
        signature: signedBefore ? null : state.consent.signature,
        revisedAt: signedBefore ? new Date().toISOString() : state.consent.revisedAt,
      };
      const donation =
        action.statementId === 'phone-use' && action.response === 'declined'
          ? { ...state.donation, status: 'not-consented' as DonationStatus }
          : action.statementId === 'phone-use' && state.donation.status === 'not-consented'
            ? { ...state.donation, status: 'not-started' as DonationStatus }
            : state.donation;
      return { ...state, consent, donation };
    }
    case 'consent-typed-name':
      return { ...state, consent: { ...state.consent, typedName: action.name, completedAt: null } };
    case 'consent-signature':
      return { ...state, consent: { ...state.consent, signature: action.signature, completedAt: null } };
    case 'consent-date':
      return { ...state, consent: { ...state.consent, confirmedDate: action.date, completedAt: null } };
    case 'consent-complete':
      return { ...state, consent: { ...state.consent, completedAt: new Date().toISOString(), informationVersion: action.informationVersion } };
    case 'assent-started':
      return state.assent.startedAt ? state : { ...state, assent: { ...state.assent, startedAt: new Date().toISOString() } };
    case 'assent-response': {
      const responses = {
        ...state.assent.responses,
        [action.statementId]: { statementId: action.statementId, version: action.version, response: action.response, respondedAt: new Date().toISOString() },
      };
      return { ...state, assent: { ...state.assent, responses, status: 'not-started', deferredBy: null, completedAt: null } };
    }
    case 'assent-typed-name':
      return { ...state, assent: { ...state.assent, typedName: action.name } };
    case 'assent-status': {
      const completedAt = action.status === 'completed' || action.status === 'declined' ? new Date().toISOString() : null;
      const assent = { ...state.assent, status: action.status, deferredBy: action.status === 'deferred' ? (action.deferredBy ?? 'young') : null, completedAt };
      let donation = state.donation;
      if (action.status === 'deferred') {
        donation = deferDonation(state);
      } else if (action.status === 'completed' && state.assent.responses['phone-use']?.response === 'declined') {
        donation = { ...state.donation, status: 'not-consented' };
      } else if (action.status === 'completed' && (state.donation.status === 'not-consented' || state.donation.status === 'deferred') && state.consent.responses['phone-use']?.response !== 'declined') {
        donation = { ...state.donation, status: 'not-started' };
      }
      return { ...state, assent, donation };
    }
    case 'set-platform':
      return { ...state, donation: { ...state.donation, platform: action.platform, status: state.donation.status === 'not-started' ? 'in-progress' : state.donation.status } };
    case 'add-image':
      return { ...state, donation: { ...state.donation, images: [...state.donation.images, action.image], status: 'in-progress' } };
    case 'update-image':
      return { ...state, donation: { ...state.donation, images: state.donation.images.map((img) => (img.id === action.id ? { ...img, ...action.patch } : img)) } };
    case 'remove-image': {
      imageStore.remove(action.id);
      const images = state.donation.images.filter((img) => img.id !== action.id);
      const status: DonationStatus = images.length === 0 && state.donation.status === 'completed' ? 'in-progress' : state.donation.status;
      return { ...state, donation: { ...state.donation, images, status } };
    }
    case 'donation-status':
      return { ...state, donation: { ...state.donation, status: action.status } };
    case 'submission':
      return { ...state, submission: { ...state.submission, ...action.patch } };
    case 'session':
      return { ...state, session: action.session };
    case 'prototype':
      return { ...state, prototype: { ...state.prototype, ...action.patch } };
  }
}
