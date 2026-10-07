import { useCallback, useRef } from 'react';
import { getApi } from '../api';
import { ApiError, type ClientInfo, type ConsentPayload, type ConsentResult, type DonationPayload, type DonationResult } from '../api/types';
import { childAssentForm, parentConsentForm } from '../config/statements';
import { childAge, parentMoreApplies, phoneSourceOf, youngAlone } from '../model/journey';
import { study } from '../config/study';
import { announce } from '../lib/announce';
import { validateAssent, validateChildDetails, validateConsent, validateGuardian } from '../lib/validation';
import type { AppState, DonationImage, GuardianIdentity, SessionInfo, StepId } from '../model/types';
import { useStore } from './context';

export function friendlyError(error: unknown, what: 'permission' | 'screenshots'): string {
  const thing = what === 'permission' ? 'your permission' : 'the screenshots';
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'network':
        return `We couldn’t reach the server to save ${thing}. Check your connection and try again — nothing you entered has been lost.`;
      case 'validation':
        return `The server found a problem with ${thing}${error.message ? `: ${error.message}` : ''}. Please check and try again.`;
      case 'expired':
        return 'Your session timed out. Please try again.';
      default:
        return `Something went wrong on our side and ${thing} could not be saved. Please try again in a moment — nothing you entered has been lost.`;
    }
  }
  return `Something went wrong and ${thing} could not be saved. Please try again.`;
}

function clientInfo(): ClientInfo {
  return { userAgent: navigator.userAgent.slice(0, 200), submittedAt: new Date().toISOString(), timezoneOffset: new Date().getTimezoneOffset() };
}

/**
 * The first step that must be done before the record can be saved, or null
 * once it can. Decided 7 October 2026: everything a family gives after the
 * parent signs is kept and used, even if they stop part-way, so the record
 * is saved from the moment the parent signs (with the young person's and
 * the parent's details), then again as answers come in. A 16- or
 * 17-year-old on their own sends nothing until they have agreed to share.
 */
export function firstIncomplete(state: AppState): StepId | null {
  // Carrying on later: the record is on the server; only the young person's answer may still be needed.
  if (state.resume) return state.resume.canAgree && (state.assent.status === 'not-started' || (state.assent.status === 'completed' && validateAssent(state.assent).length)) ? 'child-assent' : null;
  if (validateChildDetails(state.identity).length) return 'child-details';
  if (youngAlone(state)) return state.assent.status === 'completed' && !validateAssent(state.assent).length ? null : 'child-assent';
  if (validateGuardian(state.guardian).length) return state.route === 'parent' ? 'child-details' : 'parent-details';
  if (validateConsent(state.consent, parentConsentForm, undefined, childAge(state)).length || !state.consent.completedAt) return 'parent-consent';
  if (state.assent.status === 'completed' && validateAssent(state.assent).length) return 'child-assent';
  return null;
}

const blankGuardian: GuardianIdentity = { fullName: '', relationship: '', relationshipOther: '', address: '', postcode: '', email: '', phone: '' };

/**
 * The record as sent. A young person deciding alone sends no parent details
 * and no permission record. Until the young person answers, nothing of
 * theirs is sent (a signature drawn but not confirmed stays on the device).
 * The longer questions go only when they are asked.
 */
export function buildConsentPayload(state: AppState): ConsentPayload {
  const base = { referenceCode: state.submission.referenceCode, studyId: study.studyId, siteId: study.siteId, route: state.route ?? ('parent' as const), client: clientInfo() };
  const alone = youngAlone(state);
  // Not answered yet: the bare record (no ticks, no unconfirmed signature, no times), the same at every save until the young person answers.
  const assent = state.assent.status === 'not-started' ? { ...state.assent, responses: {}, signature: null, handoverConfirmedAt: null, startedAt: null } : state.assent;
  return {
    ...base,
    kind: 'consent',
    identity: state.identity,
    guardian: alone ? blankGuardian : state.guardian,
    consent: alone ? null : state.consent,
    assent,
    survey: alone ? null : state.survey,
    phoneSource: phoneSourceOf(state),
    more: parentMoreApplies(state) ? state.more : null,
  };
}

/**
 * What a save covers: the record as it would be sent, without the moment of
 * sending. The young person's agreement to share by sending travels with the
 * screenshots, so it is left out; otherwise every screenshot send would look
 * like a change to the record.
 */
export function snapshotOf(state: AppState): string {
  const { referenceCode: _reference, client: _client, ...record } = buildConsentPayload(state);
  const { 'phone-use': _bySending, ...assentResponses } = record.assent.responses;
  return JSON.stringify({ ...record, assent: { ...record.assent, responses: assentResponses } });
}

/**
 * Sends the record (from the moment the parent signs, then again as answers
 * come in) and the screenshots. Components call these; the SyncManager in
 * App.tsx calls sendConsent automatically.
 */
export function useSync() {
  const { state, dispatch } = useStore();
  const stateRef = useRef(state);
  stateRef.current = state;
  const consentInFlight = useRef(false);

  const withSession = useCallback(
    async <T>(fn: (session: SessionInfo) => Promise<T>): Promise<T> => {
      const api = getApi();
      let session = stateRef.current.session ?? (await api.startSession());
      if (!stateRef.current.session) dispatch({ type: 'session', session });
      try {
        return await fn(session);
      } catch (error) {
        if (!(error instanceof ApiError && error.code === 'expired')) throw error;
        session = await api.startSession();
        dispatch({ type: 'session', session });
        return fn(session);
      }
    },
    [dispatch],
  );

  /**
   * Carrying on later: the young person's answer, given now, goes to the
   * record found by its reference (the rest of the record is already there).
   */
  const sendLateAnswer = useCallback(async (s: AppState): Promise<ConsentResult | null> => {
    const resume = s.resume!;
    const done = (version: number, at: string | null): ConsentResult => ({ referenceCode: resume.referenceCode, participantId: s.submission.participantId ?? '', receivedAt: at ?? '', version });
    if (!resume.canAgree || s.submission.consentStage === 'sent') return done(s.submission.consentVersion, s.submission.consentSentAt);
    if (s.assent.status !== 'completed' && s.assent.status !== 'declined') return null;
    consentInFlight.current = true;
    dispatch({ type: 'submission', patch: { consentStage: 'sending', consentError: null } });
    announce('Saving your answer.');
    try {
      const { formId, formVersion, responses, signature, startedAt, completedAt } = s.assent;
      const result = await withSession((session) => getApi().resumeAgree(session, { referenceCode: resume.referenceCode, assent: { formId, formVersion, status: s.assent.status as 'completed' | 'declined', responses, signature, startedAt, completedAt }, client: clientInfo() }));
      dispatch({ type: 'submission', patch: { consentStage: 'sent', consentError: null, consentSentAt: result.receivedAt, consentVersion: result.version } });
      announce('Your answer is saved.');
      return done(result.version, result.receivedAt);
    } catch (error) {
      const message = friendlyError(error, 'permission');
      dispatch({ type: 'submission', patch: { consentStage: 'failed', consentError: message } });
      announce(message);
      return null;
    } finally {
      consentInFlight.current = false;
    }
  }, [dispatch, withSession]);

  /** Returns the result when the record is on the server (already or just now), or null on failure. */
  const sendConsent = useCallback(async (): Promise<ConsentResult | null> => {
    const s = stateRef.current;
    if (consentInFlight.current) return null;
    if (s.resume) return sendLateAnswer(s);
    if (firstIncomplete(s)) return null;
    const snapshot = snapshotOf(s);
    if (s.submission.consentStage === 'sent' && s.submission.sentSnapshot === snapshot && s.submission.referenceCode && s.submission.participantId) {
      return { referenceCode: s.submission.referenceCode, participantId: s.submission.participantId, receivedAt: s.submission.consentSentAt ?? '', version: s.submission.consentVersion };
    }
    consentInFlight.current = true;
    const amending = s.submission.referenceCode !== null;
    dispatch({ type: 'submission', patch: { consentStage: 'sending', consentError: null } });
    // Later saves happen quietly as answers come in; only the first is announced.
    if (!amending) announce(youngAlone(s) ? 'Saving.' : 'Saving your permission.');
    try {
      const payload = buildConsentPayload(s);
      const result = await withSession((session) => getApi().submitConsent(session, payload));
      dispatch({
        type: 'submission',
        patch: {
          consentStage: 'sent',
          consentError: null,
          referenceCode: result.referenceCode,
          participantId: result.participantId,
          consentSentAt: result.receivedAt,
          consentVersion: result.version,
          sentSnapshot: snapshot,
          declinedSentAt: s.submission.declinedSentAt,
        },
      });
      if (!amending) announce(youngAlone(s) ? 'Saved.' : 'Permission saved.');
      return result;
    } catch (error) {
      const message = friendlyError(error, 'permission');
      dispatch({ type: 'submission', patch: { consentStage: 'failed', consentError: message } });
      announce(message);
      return null;
    } finally {
      consentInFlight.current = false;
    }
  }, [dispatch, sendLateAnswer, withSession]);

  /**
   * Sends every uploaded-but-unsent image. The permission is sent first if it
   * has not been. Callers that have just uploaded pass the images explicitly,
   * because the store may not have re-rendered yet.
   */
  const sendDonation = useCallback(async (images?: DonationImage[]): Promise<DonationResult | null> => {
    const consent = await sendConsent();
    if (!consent) return null;
    const s = stateRef.current;
    const uploads = (images ?? s.donation.images).filter((i) => i.status === 'uploaded' && i.uploadId);
    if (!uploads.length) return null;
    const statement = childAssentForm.statements.find((st) => st.id === 'phone-use');
    dispatch({ type: 'submission', patch: { donationStage: 'sending', donationError: null } });
    announce('Sending your screenshots.');
    try {
      // A young person sending from their own phone agrees to share by sending; a parent sending from their family view needs no agreement from them.
      const payload: DonationPayload = {
        referenceCode: consent.referenceCode,
        platform: s.donation.platform,
        uploads: uploads.map((i) => ({ uploadId: i.uploadId as string, redacted: i.redacted, cropped: i.cropped, acknowledgedWarning: i.acknowledged })),
        agreement: phoneSourceOf(s) === 'child' && s.assent.status === 'completed' ? { statementId: 'phone-use', version: statement?.version ?? childAssentForm.version, response: 'agreed', respondedAt: new Date().toISOString(), via: 'action' } : null,
        client: clientInfo(),
      };
      const result = await withSession((session) => getApi().submitDonation(session, payload));
      const acceptedIds = uploads.filter((i) => result.accepted.includes(i.uploadId as string)).map((i) => i.id);
      dispatch({ type: 'images-sent', ids: acceptedIds });
      for (const rejected of result.rejected) {
        const image = uploads.find((i) => i.uploadId === rejected.uploadId);
        if (image) dispatch({ type: 'update-image', id: image.id, patch: { status: 'failed', uploadId: null, progress: 0, error: rejected.reason } });
      }
      if (acceptedIds.length) {
        if (payload.agreement) dispatch({ type: 'assent-response', statementId: 'phone-use', version: payload.agreement.version, response: 'agreed', via: 'action' });
        dispatch({ type: 'donation-status', status: 'completed' });
      }
      dispatch({ type: 'submission', patch: { donationStage: 'sent', donationError: null, donationsSent: s.submission.donationsSent + (acceptedIds.length ? 1 : 0) } });
      announce(result.rejected.length ? `${acceptedIds.length} sent, ${result.rejected.length} not accepted.` : 'Screenshots sent.');
      return result;
    } catch (error) {
      const message = friendlyError(error, 'screenshots');
      dispatch({ type: 'submission', patch: { donationStage: 'failed', donationError: message } });
      announce(message);
      return null;
    }
  }, [dispatch, sendConsent, withSession]);

  // Carrying on later sends answers, never amendments, so nothing is ever waiting to be re-sent.
  const snapshot = state.resume ? null : snapshotOf(state);
  const dirty = snapshot !== null && state.submission.sentSnapshot !== null && state.submission.sentSnapshot !== snapshot;

  return { sendConsent, sendDonation, dirty, snapshot, submission: state.submission };
}
