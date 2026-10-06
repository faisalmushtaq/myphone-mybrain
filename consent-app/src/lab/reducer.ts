import type { LabConsentRecord, LabPhase, LabPhone } from '../api/types';
import { todayIso } from '../lib/dates';
import type { SessionInfo, SignatureRecord } from '../model/types';
import { labConsentForm, labInformationVersion, type CodeParts } from './config';
import { labStepOrder, type LabArchive, type LabScreenshot, type LabState, type LabStepId, type LabSubmission } from './model';

export type LabAction =
  | { type: 'go-to'; stepId: LabStepId }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'code-parts'; parts: Partial<CodeParts> }
  | { type: 'code'; code: string; returning: boolean }
  | { type: 'code-confirmed'; confirmed: boolean }
  | { type: 'consent-response'; statementId: string; version: string; agreed: boolean }
  | { type: 'consent-typed-name'; name: string }
  | { type: 'consent-signature'; signature: SignatureRecord | null }
  | { type: 'consent-date'; date: string }
  | { type: 'consent-complete' }
  | { type: 'consent-on-file'; consentedAt: string | null }
  | { type: 'phone'; phone: LabPhone | null }
  | { type: 'phase'; phase: LabPhase | null }
  | { type: 'submission'; patch: Partial<LabSubmission> }
  | { type: 'add-archive'; archive: LabArchive }
  | { type: 'update-archive'; id: string; patch: Partial<LabArchive> }
  | { type: 'remove-archive'; id: string }
  | { type: 'add-screenshot'; screenshot: LabScreenshot }
  | { type: 'update-screenshot'; id: string; patch: Partial<LabScreenshot> }
  | { type: 'remove-screenshot'; id: string }
  | { type: 'files-sent'; ids: string[]; receivedAt: string; donationId: string | null }
  | { type: 'session'; session: SessionInfo }
  | { type: 'restored'; state: LabState }
  | { type: 'reset' };

export function initialConsent(): LabConsentRecord {
  return { formId: labConsentForm.id, formVersion: labConsentForm.version, informationVersion: labInformationVersion.version, responses: {}, typedName: '', signature: null, confirmedDate: todayIso(), completedAt: null };
}

export function initialLabState(): LabState {
  return {
    stepId: 'welcome',
    codeParts: { mother: '', house: '', month: '', postcode: '' },
    code: '',
    codeConfirmed: false,
    returning: false,
    consent: initialConsent(),
    phone: null,
    phase: null,
    submission: { consentId: null, consentVersion: 0, consentSentAt: null, consentStage: 'idle', consentError: null, consentOnFile: false, donationStage: 'idle', donationError: null, donationIds: [], lastDonationAt: null, archivesSent: 0, screenshotsSent: 0 },
    archives: [],
    screenshots: [],
    session: null,
    restored: false,
  };
}

/** The steps this person still needs, in order: the information and consent are skipped when consent is already on file. */
export function labJourney(state: LabState): LabStepId[] {
  return labStepOrder.filter((id) => !((id === 'information' || id === 'consent') && state.submission.consentOnFile));
}

export function labReducer(state: LabState, action: LabAction): LabState {
  switch (action.type) {
    case 'go-to':
      return { ...state, stepId: action.stepId };
    case 'next': {
      const steps = labJourney(state);
      const i = steps.indexOf(state.stepId);
      return { ...state, stepId: steps[Math.min(steps.length - 1, i + 1)] };
    }
    case 'back': {
      const steps = labJourney(state);
      const i = steps.indexOf(state.stepId);
      return { ...state, stepId: steps[Math.max(0, i - 1)] };
    }
    case 'code-parts':
      return { ...state, codeParts: { ...state.codeParts, ...action.parts }, codeConfirmed: false };
    case 'code':
      return { ...state, code: action.code, returning: action.returning, codeConfirmed: false };
    case 'code-confirmed':
      return { ...state, codeConfirmed: action.confirmed };
    case 'consent-response': {
      const responses = { ...state.consent.responses };
      responses[action.statementId] = { statementId: action.statementId, version: action.version, response: action.agreed ? 'agreed' : 'declined', respondedAt: new Date().toISOString(), via: 'individual' };
      // Changing an answer after signing means signing again.
      const signature = state.consent.completedAt ? null : state.consent.signature;
      return { ...state, consent: { ...state.consent, responses, signature, completedAt: null } };
    }
    case 'consent-typed-name':
      return { ...state, consent: { ...state.consent, typedName: action.name } };
    case 'consent-signature':
      return { ...state, consent: { ...state.consent, signature: action.signature } };
    case 'consent-date':
      return { ...state, consent: { ...state.consent, confirmedDate: action.date } };
    case 'consent-complete':
      return { ...state, consent: { ...state.consent, completedAt: new Date().toISOString() } };
    case 'consent-on-file':
      return { ...state, submission: { ...state.submission, consentOnFile: true, consentStage: 'sent', consentSentAt: action.consentedAt } };
    case 'phone':
      return { ...state, phone: action.phone };
    case 'phase':
      return { ...state, phase: action.phase };
    case 'submission':
      return { ...state, submission: { ...state.submission, ...action.patch } };
    case 'add-archive':
      return { ...state, archives: [...state.archives, action.archive] };
    case 'update-archive':
      return { ...state, archives: state.archives.map((a) => (a.id === action.id ? { ...a, ...action.patch } : a)) };
    case 'remove-archive':
      return { ...state, archives: state.archives.filter((a) => a.id !== action.id) };
    case 'add-screenshot':
      return { ...state, screenshots: [...state.screenshots, action.screenshot] };
    case 'update-screenshot':
      return { ...state, screenshots: state.screenshots.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s)) };
    case 'remove-screenshot':
      return { ...state, screenshots: state.screenshots.filter((s) => s.id !== action.id) };
    case 'files-sent': {
      const sent = new Set(action.ids);
      const archives = state.archives.map((a) => (a.uploadId && sent.has(a.uploadId) ? { ...a, status: 'sent' as const } : a));
      const screenshots = state.screenshots.map((s) => (s.uploadId && sent.has(s.uploadId) ? { ...s, status: 'sent' as const } : s));
      return {
        ...state,
        archives,
        screenshots,
        submission: {
          ...state.submission,
          donationStage: 'sent',
          donationError: null,
          lastDonationAt: action.receivedAt,
          donationIds: action.donationId ? [...state.submission.donationIds, action.donationId] : state.submission.donationIds,
          archivesSent: archives.filter((a) => a.status === 'sent').length,
          screenshotsSent: screenshots.filter((s) => s.status === 'sent').length,
        },
      };
    }
    case 'session':
      return { ...state, session: action.session };
    case 'restored':
      return { ...action.state, restored: true };
    case 'reset':
      return initialLabState();
    default:
      return state;
  }
}
