import { useCallback } from 'react';
import { getApi } from '../api';
import { ApiError, type SubmissionPayload } from '../api/types';
import { parentConsentForm } from '../config/statements';
import { study } from '../config/study';
import { announce } from '../lib/announce';
import { validateAssent, validateChildDetails, validateConsent, validateGuardian } from '../lib/validation';
import type { SessionInfo, StepId } from '../model/types';
import { useStore } from './context';
import { clearState } from './persistence';

function friendlySubmitError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'network':
        return 'We couldn’t reach the server. Check your connection and try again — nothing you entered has been lost.';
      case 'validation':
        return `The server found a problem with the information${error.message ? `: ${error.message}` : ''}. Please check the details and try again.`;
      case 'expired':
        return 'Your session timed out. Please try again.';
      default:
        return 'Something went wrong on our side and your information was not sent. Please try again in a moment — nothing you entered has been lost.';
    }
  }
  return 'Something went wrong and your information was not sent. Please try again.';
}

/**
 * Checks everything one last time, sends the submission and moves to the
 * confirmation screen. Failures keep the person on the same screen with a
 * retry, and nothing is lost.
 */
export function useSubmission() {
  const { state, dispatch } = useStore();

  /** Returns the first step that still needs attention, or null. */
  const firstIncomplete = useCallback((): StepId | null => {
    if (validateChildDetails(state.identity).length) return 'child-details';
    if (validateGuardian(state.guardian).length) return state.route === 'parent' ? 'child-details' : 'parent-details';
    if (validateConsent(state.consent, parentConsentForm).length || !state.consent.completedAt) return 'parent-consent';
    if (state.assent.status === 'not-started') return 'child-assent';
    if (state.assent.status === 'completed' && validateAssent(state.assent).length) return 'child-assent';
    const phoneApplies = state.consent.responses['phone-use']?.response !== 'declined' && state.assent.status === 'completed';
    if (phoneApplies && (state.donation.status === 'in-progress' || state.donation.status === 'not-started')) return 'phone-use';
    if (state.donation.status === 'completed' && state.donation.images.some((i) => i.status !== 'uploaded')) return 'phone-use';
    return null;
  }, [state]);

  const buildPayload = useCallback((): SubmissionPayload => {
    const client = { userAgent: navigator.userAgent.slice(0, 200), submittedAt: new Date().toISOString(), timezoneOffset: new Date().getTimezoneOffset() };
    if (state.assent.status === 'declined') {
      // Only what the team needs to avoid asking again. No permission record, date of birth, postcode or phone details.
      return {
        kind: 'declined',
        studyId: study.studyId,
        siteId: study.siteId,
        route: state.route ?? 'parent',
        identity: { ...state.identity, dateOfBirth: { day: '', month: '', year: '' } },
        guardian: { ...state.guardian, phone: '', postcode: '' },
        consent: null,
        assent: state.assent,
        donation: { status: 'not-consented', platform: null, uploads: [] },
        client,
      };
    }
    return {
      kind: 'consent',
      studyId: study.studyId,
      siteId: study.siteId,
      route: state.route ?? 'parent',
      identity: state.identity,
      guardian: state.guardian,
      consent: state.consent,
      assent: state.assent,
      donation: {
        status: state.donation.status,
        platform: state.donation.platform,
        uploads: state.donation.images.filter((i) => i.status === 'uploaded' && i.uploadId).map((i) => ({ uploadId: i.uploadId as string, redacted: i.redacted, cropped: i.cropped })),
      },
      client,
    };
  }, [state]);

  const submit = useCallback(async () => {
    const problem = state.assent.status === 'declined' ? null : firstIncomplete();
    if (problem) {
      dispatch({ type: 'go-to', stepId: problem, returnTo: 'send' });
      return;
    }
    dispatch({ type: 'submission', patch: { stage: 'submitting', stageLabel: 'Checking everything…', error: null } });
    announce('Sending. Please wait.');
    try {
      const api = getApi();
      const send = async (session: SessionInfo) => api.submit(session, buildPayload());
      let session = state.session ?? (await api.startSession());
      if (!state.session) dispatch({ type: 'session', session });
      dispatch({ type: 'submission', patch: { stageLabel: 'Sending…' } });
      let result;
      try {
        result = await send(session);
      } catch (error) {
        if (!(error instanceof ApiError && error.code === 'expired')) throw error;
        session = await api.startSession();
        dispatch({ type: 'session', session });
        result = await send(session);
      }
      dispatch({ type: 'submission', patch: { stage: 'done', stageLabel: 'Sent', referenceCode: result.referenceCode, receivedAt: result.receivedAt } });
      clearState();
      dispatch({ type: 'go-to', stepId: 'done', returnTo: null });
    } catch (error) {
      const message = friendlySubmitError(error);
      dispatch({ type: 'submission', patch: { stage: 'failed', stageLabel: '', error: message } });
      announce(`Not sent. ${message}`);
    }
  }, [buildPayload, dispatch, firstIncomplete, state.assent.status, state.session]);

  return { submit, submitting: state.submission.stage === 'submitting', firstIncomplete };
}
