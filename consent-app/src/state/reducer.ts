import { parentQuestionsForm } from '../config/questions';
import { childAssentForm, parentConsentForm } from '../config/statements';
import { study } from '../config/study';
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
  StatementRecord,
  StatementResponse,
  StepId,
  SubmissionState,
  SurveyStatus,
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
    guardian: { fullName: '', relationship: '', relationshipOther: '', hasParentalResponsibility: false, wantsCopy: false, email: '', phone: '', postcode: '' },
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
      signature: null,
      handoverConfirmedAt: null,
      startedAt: null,
      completedAt: null,
    },
    donation: { platform: null, images: [], status: 'not-started' },
    survey: { formId: parentQuestionsForm.id, formVersion: parentQuestionsForm.version, status: 'not-started', responses: {}, startedAt: null, completedAt: null },
    submission: { referenceCode: null, participantId: null, consentStage: 'idle', consentError: null, consentSentAt: null, consentVersion: 0, sentSnapshot: null, donationStage: 'idle', donationError: null, donationsSent: 0, declinedSentAt: null },
    session: null,
    prototype: { failUploads: false, failSubmit: false, showDraftMarkers: true },
    restored: false,
  };
}

function record(statementId: string, version: string, response: StatementResponse, via: StatementRecord['via']): StatementRecord {
  return { statementId, version, response, respondedAt: new Date().toISOString(), via };
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
  /** One tick that agrees to every required statement at once (each is still recorded individually). */
  | { type: 'consent-required-group'; agreed: boolean }
  | { type: 'consent-typed-name'; name: string }
  | { type: 'consent-signature'; signature: SignatureRecord | null }
  | { type: 'consent-date'; date: string }
  | { type: 'consent-complete'; informationVersion: string }
  | { type: 'assent-started' }
  | { type: 'assent-signature'; signature: SignatureRecord | null }
  /** The young person signs: every statement covered by the signature is recorded as agreed. */
  | { type: 'assent-sign' }
  | { type: 'assent-decline' }
  | { type: 'assent-response'; statementId: string; version: string; response: StatementResponse; via?: StatementRecord['via'] }
  | { type: 'assent-status'; status: AssentStatus; deferredBy?: 'parent' | 'young' }
  | { type: 'set-platform'; platform: PlatformId }
  | { type: 'add-image'; image: DonationImage }
  | { type: 'update-image'; id: string; patch: Partial<DonationImage> }
  | { type: 'remove-image'; id: string }
  /** Uploads the server has accepted and linked to the record. */
  | { type: 'answer-question'; questionId: string; version: string; value: string }
  | { type: 'skip-question'; questionId: string }
  | { type: 'survey-status'; status: SurveyStatus }
  | { type: 'images-sent'; ids: string[] }
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

/** After a change made from the check page, return there once everything in between is complete. */
function nextAfterChange(state: AppState): StepId | null {
  const journey = buildJourney(state);
  const from = journey.indexOf(state.stepId);
  const to = journey.indexOf(state.returnTo ?? 'check');
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

/** Changing a consent statement after signing invalidates the signature. */
function withConsentResponses(state: AppState, responses: Record<string, StatementRecord>): AppState['consent'] {
  const signedBefore = state.consent.completedAt !== null;
  return {
    ...state.consent,
    responses,
    completedAt: null,
    signature: signedBefore ? null : state.consent.signature,
    revisedAt: signedBefore ? new Date().toISOString() : state.consent.revisedAt,
  };
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
      // Changing identifying details is open to either person; permission and agreement sections are not.
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
        // The young person's agreement is collected separately. The parent may carry on with the screen-time part (config).
        next.assent = { ...state.assent, status: 'deferred', deferredBy: 'parent', responses: {}, signature: null, completedAt: null };
        next.donation = study.parentMayShareWithoutAssent ? (state.donation.status === 'deferred' ? { ...state.donation, status: 'not-started' } : state.donation) : deferDonation(state);
      } else if (state.assent.status === 'deferred') {
        next.assent = { ...state.assent, status: 'not-started', deferredBy: null };
        next.donation = state.donation.status === 'deferred' ? { ...state.donation, status: state.donation.images.length ? 'in-progress' : 'not-started' } : state.donation;
      }
      return next;
    }
    case 'update-identity':
      return { ...state, identity: { ...state.identity, ...action.patch } };
    case 'update-guardian': {
      const guardian = { ...state.guardian, ...action.patch };
      // The name on the permission screen starts as the name given here, unless the parent has already changed it.
      const typedName = state.consent.typedName === state.guardian.fullName || !state.consent.typedName ? guardian.fullName : state.consent.typedName;
      return { ...state, guardian, consent: { ...state.consent, typedName } };
    }
    case 'consent-response': {
      const responses = { ...state.consent.responses, [action.statementId]: record(action.statementId, action.version, action.response, 'individual') };
      const donation =
        action.statementId === 'phone-use' && action.response === 'declined'
          ? { ...state.donation, status: 'not-consented' as DonationStatus }
          : action.statementId === 'phone-use' && state.donation.status === 'not-consented'
            ? { ...state.donation, status: 'not-started' as DonationStatus }
            : state.donation;
      return { ...state, consent: withConsentResponses(state, responses), donation };
    }
    case 'consent-required-group': {
      const responses = { ...state.consent.responses };
      for (const s of parentConsentForm.statements) {
        if (s.kind !== 'required') continue;
        if (action.agreed) responses[s.id] = record(s.id, s.version, 'agreed', 'group');
        else delete responses[s.id];
      }
      return { ...state, consent: withConsentResponses(state, responses) };
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
    case 'assent-signature':
      return { ...state, assent: { ...state.assent, signature: action.signature, status: 'not-started', completedAt: null } };
    case 'assent-sign': {
      const responses = { ...state.assent.responses };
      for (const s of childAssentForm.statements) {
        if (s.coveredBySignature) responses[s.id] = record(s.id, s.version, 'agreed', 'signature');
      }
      const assent = { ...state.assent, responses, status: 'completed' as AssentStatus, deferredBy: null, completedAt: new Date().toISOString() };
      const donation = (state.donation.status === 'deferred' || state.donation.status === 'not-consented') && state.consent.responses['phone-use']?.response !== 'declined' ? { ...state.donation, status: 'not-started' as DonationStatus } : state.donation;
      return { ...state, assent, donation };
    }
    case 'assent-decline': {
      const takePart = childAssentForm.statements.find((s) => s.id === 'take-part');
      const responses = { ...state.assent.responses, 'take-part': record('take-part', takePart?.version ?? childAssentForm.version, 'declined', 'individual') };
      return { ...state, assent: { ...state.assent, responses, signature: null, status: 'declined', deferredBy: null, completedAt: new Date().toISOString() } };
    }
    case 'assent-response': {
      const responses = { ...state.assent.responses, [action.statementId]: record(action.statementId, action.version, action.response, action.via ?? 'individual') };
      return { ...state, assent: { ...state.assent, responses } };
    }
    case 'assent-status': {
      const completedAt = action.status === 'completed' || action.status === 'declined' ? new Date().toISOString() : null;
      const assent = { ...state.assent, status: action.status, deferredBy: action.status === 'deferred' ? (action.deferredBy ?? 'young') : null, completedAt };
      const donation = action.status === 'deferred' ? deferDonation(state) : state.donation;
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
    case 'answer-question': {
      const now = new Date().toISOString();
      const responses = { ...state.survey.responses, [action.questionId]: { questionId: action.questionId, version: action.version, value: action.value, answeredAt: now } };
      return { ...state, survey: { ...state.survey, responses, status: state.survey.status === 'completed' ? 'completed' : 'in-progress', startedAt: state.survey.startedAt ?? now } };
    }
    case 'skip-question': {
      const { [action.questionId]: _skipped, ...responses } = state.survey.responses;
      return { ...state, survey: { ...state.survey, responses, startedAt: state.survey.startedAt ?? new Date().toISOString() } };
    }
    case 'survey-status': {
      const done = action.status === 'completed' || action.status === 'skipped';
      return { ...state, survey: { ...state.survey, status: action.status, completedAt: done ? new Date().toISOString() : state.survey.completedAt } };
    }
    case 'images-sent':
      return { ...state, donation: { ...state.donation, images: state.donation.images.map((img) => (action.ids.includes(img.id) ? { ...img, status: 'sent', progress: 1, error: null } : img)) } };
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
