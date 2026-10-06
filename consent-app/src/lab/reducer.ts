import type { LabConsentRecord, LabLookupResult, LabPhone, LabPlatform } from '../api/types';
import { todayIso } from '../lib/dates';
import type { SessionInfo, SignatureRecord } from '../model/types';
import { labConsentForm, labInformationVersion, labStudy, type CodeParts } from './config';

/** The apps whose data the study takes, in the order they are listed. */
export const labPlatforms: LabPlatform[] = [...labStudy.platforms];
import { labFlowPhase, labFlowSteps, type LabArchive, type LabFlow, type LabScreenshot, type LabState, type LabStepId, type LabSubmission } from './model';

export type LabAction =
  | { type: 'go-to'; stepId: LabStepId }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'code-parts'; parts: Partial<CodeParts> }
  | { type: 'code'; code: string; returning: boolean }
  | { type: 'confirm-code'; code: string; returning: boolean; lookup: LabLookupResult }
  | { type: 'consent-response'; statementId: string; version: string; agreed: boolean }
  | { type: 'consent-typed-name'; name: string }
  | { type: 'consent-signature'; signature: SignatureRecord | null }
  | { type: 'consent-date'; date: string }
  | { type: 'consent-complete' }
  | { type: 'phone'; phone: LabPhone | null }
  | { type: 'app'; app: LabPlatform | null }
  | { type: 'not-used'; notUsed: LabPlatform[] }
  | { type: 'progress'; progress: LabLookupResult }
  | { type: 'use-code'; code: string }
  | { type: 'checkin-answer'; questionId: string; value: string }
  | { type: 'checkin-sent'; checkInId: string; receivedAt: string; count: number }
  | { type: 'checkin-new' }
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

export function initialLabState(flow: LabFlow = 'baseline'): LabState {
  return {
    flow,
    stepId: labFlowSteps[flow][0],
    codeParts: { firstName: '', house: '', month: '', postcode: '' },
    code: '',
    codeConfirmed: false,
    confirmedCode: null,
    // On the check-in and after-break pages people already have a code, so they type it (or rebuild it if they must).
    returning: flow !== 'baseline',
    consent: initialConsent(),
    phone: null,
    phase: labFlowPhase[flow],
    progress: null,
    checkIn: { answers: {}, checkInId: null, sentAt: null, count: 0 },
    app: null,
    notUsed: [],
    submission: { consentId: null, consentVersion: 0, consentSentAt: null, consentStage: 'idle', consentError: null, consentOnFile: false, donationStage: 'idle', donationError: null, donationIds: [], lastDonationAt: null, archivesSent: 0, screenshotsSent: 0 },
    archives: [],
    screenshots: [],
    session: null,
    restored: false,
  };
}

/** The steps this person still needs on this page, in order: the information and consent are skipped when consent is already on file. */
export function labJourney(state: LabState): LabStepId[] {
  return labFlowSteps[state.flow].filter((id) => !((id === 'information' || id === 'consent') && state.submission.consentOnFile));
}

/** Files the study holds for this page's phase: the server's count when there is one (kept up to date after each send), else what this device sent. */
export function phaseHave(state: LabState): { screenshots: number; archives: number } {
  const server = state.progress?.phases?.[state.phase];
  if (server) return server;
  return { screenshots: state.screenshots.filter((s) => s.status === 'sent').length, archives: state.archives.filter((a) => a.status === 'sent').length };
}

export type PlatformStatus = 'sent' | 'ready' | 'todo' | 'not-used';

/**
 * Where each app stands for this page's phase: its cleaned data has been
 * sent (ticked off), is prepared on this device, is still to do, or the
 * person has said they do not use it (greyed out). Every app is either sent
 * or set aside before the page counts as finished.
 */
export function platformStatuses(state: LabState): Record<LabPlatform, PlatformStatus> {
  const sent = new Set<LabPlatform>([...(state.progress?.phases?.[state.phase]?.platforms ?? []), ...state.archives.filter((a) => a.status === 'sent').flatMap((a) => a.platforms)]);
  const ready = new Set<LabPlatform>(state.archives.filter((a) => a.status !== 'sent').flatMap((a) => a.platforms));
  const out = {} as Record<LabPlatform, PlatformStatus>;
  for (const p of labPlatforms) out[p] = sent.has(p) ? 'sent' : ready.has(p) ? 'ready' : state.notUsed.includes(p) ? 'not-used' : 'todo';
  return out;
}

/** The apps still to do: neither sent nor set aside. */
export function platformsToDo(state: LabState): LabPlatform[] {
  const s = platformStatuses(state);
  return labPlatforms.filter((p) => s[p] === 'todo');
}

/** Where someone carries on in this page's files: screenshots first, then each app's data, then the summary. */
export function nextFilesStep(state: LabState): LabStepId {
  const have = phaseHave(state);
  if (!have.screenshots) return 'screenshots';
  const s = Object.values(platformStatuses(state));
  return s.includes('todo') ? 'guide' : s.includes('ready') ? 'send' : 'done';
}

/** Where someone goes once their code is confirmed and consent is on file. */
export function resumeStep(state: LabState): LabStepId {
  if (state.flow === 'checkin') return 'checkin';
  if (state.flow === 'after') return 'reminder';
  return nextFilesStep(state);
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
    case 'confirm-code': {
      // A different person on this device: their consent, files and progress are not this one's.
      const base = state.confirmedCode && state.confirmedCode !== action.code ? { ...initialLabState(state.flow), session: state.session, codeParts: state.codeParts, stepId: state.stepId } : state;
      const onFile = action.lookup.exists;
      return {
        ...base,
        code: action.code,
        returning: action.returning,
        codeConfirmed: true,
        confirmedCode: action.code,
        progress: onFile ? action.lookup : null,
        notUsed: onFile ? (action.lookup.platformsNotUsed ?? []) : base.notUsed,
        submission: onFile ? { ...base.submission, consentOnFile: true, consentStage: 'sent', consentSentAt: base.submission.consentSentAt ?? action.lookup.consentedAt } : base.submission,
      };
    }
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
    case 'phone':
      return { ...state, phone: action.phone };
    case 'progress':
      return { ...state, progress: action.progress };
    case 'use-code':
      // A link that names a code (from a progress email): the same person carries on; anyone else confirms the code first.
      if (state.confirmedCode === action.code && state.codeConfirmed) return state;
      return { ...state, code: action.code, returning: true, codeConfirmed: false, stepId: 'participant-id' };
    case 'checkin-answer':
      return { ...state, checkIn: { ...state.checkIn, answers: { ...state.checkIn.answers, [action.questionId]: action.value } } };
    case 'checkin-sent':
      return { ...state, checkIn: { ...state.checkIn, checkInId: action.checkInId, sentAt: action.receivedAt, count: action.count } };
    case 'checkin-new':
      return { ...state, checkIn: { answers: {}, checkInId: null, sentAt: null, count: state.checkIn.count }, screenshots: [], stepId: 'checkin' };
    case 'app':
      return { ...state, app: action.app };
    case 'not-used':
      return { ...state, notUsed: action.notUsed };
    case 'submission':
      return { ...state, submission: { ...state.submission, ...action.patch } };
    case 'add-archive':
      // Preparing an app's file means the person does use it after all.
      return { ...state, archives: [...state.archives, action.archive], notUsed: state.notUsed.filter((p) => !action.archive.platforms.includes(p)) };
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
      const newly = (f: { uploadId: string | null; status: string }) => Boolean(f.uploadId && sent.has(f.uploadId) && f.status !== 'sent');
      const added = { archives: state.archives.filter(newly).length, screenshots: state.screenshots.filter(newly).length };
      const addedPlatforms = state.archives.filter(newly).flatMap((a) => a.platforms);
      const archives = state.archives.map((a) => (a.uploadId && sent.has(a.uploadId) ? { ...a, status: 'sent' as const } : a));
      const screenshots = state.screenshots.map((s) => (s.uploadId && sent.has(s.uploadId) ? { ...s, status: 'sent' as const } : s));
      // Keep the server's counts current, so the next step knows what is in without asking again.
      const p = state.progress;
      const progress = p
        ? {
            ...p,
            archives: p.archives + added.archives,
            screenshots: p.screenshots + added.screenshots,
            phases: {
              ...p.phases,
              [state.phase]: {
                archives: (p.phases?.[state.phase]?.archives ?? 0) + added.archives,
                screenshots: (p.phases?.[state.phase]?.screenshots ?? 0) + added.screenshots,
                platforms: Array.from(new Set([...(p.phases?.[state.phase]?.platforms ?? []), ...addedPlatforms])).sort(),
              },
            },
          }
        : null;
      return {
        ...state,
        archives,
        screenshots,
        progress,
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
      return initialLabState(state.flow);
    default:
      return state;
  }
}
