import { useCallback, useRef } from 'react';
import { getApi } from '../api';
import { ApiError, type ClientInfo, type ConsentPayload, type ConsentResult, type DonationPayload, type DonationResult } from '../api/types';
import { childAssentForm, parentConsentForm } from '../config/statements';
import { study } from '../config/study';
import { announce } from '../lib/announce';
import { validateAssent, validateChildDetails, validateConsent, validateGuardian } from '../lib/validation';
import type { AppState, DonationImage, SessionInfo, StepId } from '../model/types';
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
 * What the last consent send covered. The young person's screenshot
 * agreement travels with the donation, so it is left out here; otherwise
 * every screenshot send would look like a change to the permission record.
 */
export function snapshotOf(state: AppState): string {
  const { 'phone-use': _phone, ...assentResponses } = state.assent.responses;
  return JSON.stringify({
    identity: state.identity,
    guardian: state.guardian,
    consent: state.consent,
    assent: { ...state.assent, responses: assentResponses },
    survey: state.survey,
  });
}

/** The first step that still needs attention before the permission can be sent, or null. */
export function firstIncomplete(state: AppState): StepId | null {
  if (validateChildDetails(state.identity).length) return 'child-details';
  if (validateGuardian(state.guardian).length) return state.route === 'parent' ? 'child-details' : 'parent-details';
  if (state.assent.status === 'declined') return null;
  if (validateConsent(state.consent, parentConsentForm).length || !state.consent.completedAt) return 'parent-consent';
  if (state.assent.status === 'not-started') return 'child-assent';
  if (state.assent.status === 'completed' && validateAssent(state.assent).length) return 'child-assent';
  return null;
}

function buildConsentPayload(state: AppState): ConsentPayload {
  const base = { referenceCode: state.submission.referenceCode, studyId: study.studyId, siteId: study.siteId, route: state.route ?? ('parent' as const), client: clientInfo() };
  if (state.assent.status === 'declined') {
    // Only what the team needs to avoid asking again. No permission record, date of birth, postcode or phone.
    return { ...base, kind: 'declined', identity: { ...state.identity, dateOfBirth: { day: '', month: '', year: '' } }, guardian: { ...state.guardian, phone: '', postcode: '', email: state.guardian.wantsCopy ? state.guardian.email : '' }, consent: null, assent: state.assent, survey: null };
  }
  return { ...base, kind: 'consent', identity: state.identity, guardian: state.guardian, consent: state.consent, assent: state.assent, survey: state.survey };
}

/**
 * Sends the permission and agreement (first time or as an amendment) and the
 * screenshots. Components call these; the SyncManager in App.tsx calls
 * sendConsent automatically when the agreement step is finished.
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

  /** Returns the result when the record is on the server (already or just now), or null on failure. */
  const sendConsent = useCallback(async (): Promise<ConsentResult | null> => {
    const s = stateRef.current;
    if (consentInFlight.current) return null;
    if (firstIncomplete(s)) return null;
    const snapshot = snapshotOf(s);
    if (s.submission.consentStage === 'sent' && s.submission.sentSnapshot === snapshot && s.submission.referenceCode && s.submission.participantId) {
      return { referenceCode: s.submission.referenceCode, participantId: s.submission.participantId, receivedAt: s.submission.consentSentAt ?? '', version: s.submission.consentVersion };
    }
    consentInFlight.current = true;
    const amending = s.submission.referenceCode !== null;
    dispatch({ type: 'submission', patch: { consentStage: 'sending', consentError: null } });
    announce(amending ? 'Saving your changes.' : 'Saving your permission.');
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
          declinedSentAt: payload.kind === 'declined' ? result.receivedAt : s.submission.declinedSentAt,
        },
      });
      announce(amending ? 'Changes saved.' : 'Permission saved.');
      return result;
    } catch (error) {
      const message = friendlyError(error, 'permission');
      dispatch({ type: 'submission', patch: { consentStage: 'failed', consentError: message } });
      announce(message);
      return null;
    } finally {
      consentInFlight.current = false;
    }
  }, [dispatch, withSession]);

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
      const payload: DonationPayload = {
        referenceCode: consent.referenceCode,
        platform: s.donation.platform,
        uploads: uploads.map((i) => ({ uploadId: i.uploadId as string, redacted: i.redacted, cropped: i.cropped, acknowledgedWarning: i.acknowledged })),
        agreement: { statementId: 'phone-use', version: statement?.version ?? childAssentForm.version, response: 'agreed', respondedAt: new Date().toISOString(), via: 'action' },
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
        dispatch({ type: 'assent-response', statementId: 'phone-use', version: payload.agreement.version, response: 'agreed', via: 'action' });
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

  const dirty = state.submission.sentSnapshot !== null && state.submission.sentSnapshot !== snapshotOf(state);

  return { sendConsent, sendDonation, dirty, submission: state.submission };
}
