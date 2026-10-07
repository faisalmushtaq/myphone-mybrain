import { FieldValue, getFirestore, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { childAssentForm, REFERENCE_CODE, study } from './forms.js';
import { rateLimitLookups } from './lab.js';
import { storeSignature, signatureRecord } from './signatures.js';
import { isObj, parseDate, validateClient, validateResponses, validateSignature, validTime, type ClientInfo, type StatementRecord } from './validate.js';

/**
 * Carrying on later with the family form (decided 7 October 2026: families
 * can complete the form after the workshop too, if they did not at the time).
 * A family that sent its record without finishing it (the young person was
 * not there or wanted to decide later, or no screenshots were sent) comes
 * back on any device with the reference from their thank-you page or their
 * copy of the record, and the young person's date of birth. The young person
 * can then add their agreement and screenshots, or the family more
 * screenshots, to the same record. Nothing already sent can be seen or
 * changed, and a decision already made (a no, or the parent's choice) stays
 * as it is: changing those is for the team.
 */

const REGION = 'europe-west2';
const callOptions = { region: REGION, memory: '512MiB' as const, timeoutSeconds: 60, enforceAppCheck: process.env.MPMB_ENFORCE_APP_CHECK === 'true' };
/** Look-ups per device per hour, and wrong dates of birth per reference before it is locked for a day. */
const LOOKUPS_PER_HOUR = 10;
const FAILURES_BEFORE_LOCK = 5;
const LOCK_HOURS = 24;
const NOT_FOUND = 'We could not find a record with that reference and date of birth. Check both: the reference is on your thank-you page and your copy of the record, and looks like MPMB-ABCD-EF2.';

export type PhoneSource = 'parent' | 'child' | 'none';

export interface ResumeSummary {
  referenceCode: string;
  /** The young person's first name, for the wording. */
  firstName: string;
  /** 16 or 17 when the record was made: they decided for themselves. */
  selfConsent: boolean;
  phoneSource: PhoneSource | null;
  assentStatus: 'not-started' | 'completed' | 'deferred' | 'declined';
  imageCount: number;
  maxImages: number;
  /** The young person's agreement can be added: the screenshots were to come from their phone, and they had not answered. */
  canAgree: boolean;
  /** Screenshots can be added: from the parent's phone, or from the young person's once they have agreed. */
  canAddScreenshots: boolean;
  /** Why nothing can be added, when nothing can: 'unfinished' is a record saved before the parent said whether to share the screen time. */
  reason: 'declined' | 'no-screen-time' | 'unfinished' | 'full' | null;
}

/** A reference as typed: upper case, spaces gone, the dashes put back. */
export function normaliseReference(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const code = compact.length === 11 && compact.startsWith('MPMB') ? `MPMB-${compact.slice(4, 8)}-${compact.slice(8)}` : '';
  return REFERENCE_CODE.test(code) ? code : null;
}

/**
 * What a family coming back can add, from the server's own records. Records
 * made before 7 October 2026 have no phoneSource: their screenshots came
 * from the young person's phone, when the parent had said yes. Since then a
 * record is saved from the moment the parent signs, so one with no
 * phoneSource may also be a record left before that question was answered.
 */
export function resumeSummary(code: string, submission: DocumentData, participant: DocumentData | undefined, assent: DocumentData | undefined, parentAnswer: string | undefined): ResumeSummary {
  const recorded = (submission.phoneSource ?? null) as PhoneSource | null;
  const source: PhoneSource | null = recorded ?? (submission.selfConsent || parentAnswer === 'agreed' ? 'child' : parentAnswer === 'declined' ? 'none' : null);
  const status = (['not-started', 'completed', 'deferred', 'declined'].includes(String(assent?.status)) ? assent!.status : 'not-started') as ResumeSummary['assentStatus'];
  const imageCount = Number(submission.imageCount ?? 0);
  const room = imageCount < study.maxImages;
  const canAgree = source === 'child' && (status === 'deferred' || status === 'not-started');
  const canAddScreenshots = room && (source === 'parent' || (source === 'child' && status === 'completed'));
  const reason = canAgree || canAddScreenshots ? null : source === null ? 'unfinished' : source === 'none' ? 'no-screen-time' : status === 'declined' ? 'declined' : 'full';
  return {
    referenceCode: code,
    firstName: typeof participant?.firstName === 'string' ? participant.firstName : '',
    selfConsent: Boolean(submission.selfConsent),
    phoneSource: source,
    assentStatus: status,
    imageCount,
    maxImages: study.maxImages,
    canAgree,
    canAddScreenshots,
    reason,
  };
}

export interface LateAssent {
  formId: string;
  formVersion: string;
  status: 'completed' | 'declined';
  responses: Record<string, StatementRecord>;
  signature: { method: 'drawn' | 'typed'; imageDataUrl: string | null; typedName: string | null; strokeCount: number; pointerType: string | null; capturedAt: string } | null;
  startedAt: string | null;
  completedAt: string | null;
}

/** The young person's answer, given later: a signed yes or a no, on the current agreement form. */
export function validateLateAgreement(input: unknown): string[] {
  const problems: string[] = [];
  if (!isObj(input)) return ['The request is not an object.'];
  if (!normaliseReference(input.referenceCode)) problems.push('The reference is malformed.');
  const a = input.assent;
  if (!isObj(a)) problems.push('The agreement record is missing.');
  else {
    if (a.formId !== childAssentForm.id || a.formVersion !== childAssentForm.version) problems.push(`The agreement form must be ${childAssentForm.id} ${childAssentForm.version}.`);
    if (a.status !== 'completed' && a.status !== 'declined') problems.push('The young person’s answer is missing.');
    validateResponses(a.responses, childAssentForm, problems, 'Agreement');
    const responses = isObj(a.responses) ? (a.responses as Record<string, StatementRecord>) : {};
    if (a.status === 'completed') {
      for (const sid of childAssentForm.signed) {
        if (responses[sid]?.response !== 'agreed' || responses[sid]?.via !== 'signature') problems.push(`Agreement statement "${sid}" was not signed.`);
      }
      validateSignature(a.signature, 'Agreement', problems);
      if (!validTime(a.completedAt)) problems.push('The agreement has no completion time.');
    } else if (a.status === 'declined' && responses['take-part']?.response !== 'declined') problems.push('A declined agreement must record the young person’s no.');
    if (a.startedAt !== null && a.startedAt !== undefined && !validTime(a.startedAt)) problems.push('The agreement has no valid start time.');
  }
  validateClient(input.client, problems);
  return problems;
}

/** Whether this session may add to the record: the one that made it, or one that came back with the reference and date of birth. */
export const mayAddTo = (submission: DocumentData, uid: string) => submission.sessionUid === uid || (Array.isArray(submission.resumeUids) && submission.resumeUids.includes(uid));

/**
 * One callable, two actions:
 *   lookup: the reference and the young person's date of birth find the
 *           record; this session may then add to it, and is told what it can
 *           add. A wrong date of birth counts against the reference, which
 *           locks for a day after five.
 *   agree:  the young person's answer, given now: a new agreement record that
 *           supersedes the one that was put off.
 */
export const resumeRecord = onCall(callOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const db = getFirestore();

  if (data.action === 'lookup') {
    const code = normaliseReference(data.referenceCode);
    const dob = isObj(data.dateOfBirth) ? parseDate(data.dateOfBirth as { day: string; month: string; year: string }) : null;
    if (!code) throw new HttpsError('invalid-argument', 'Enter the reference as it is on your thank-you page: MPMB, then two groups of letters and numbers, such as MPMB-ABCD-EF2.');
    if (!dob) throw new HttpsError('invalid-argument', 'Enter the young person’s date of birth.');
    await rateLimitLookups(db, uid, 'family-resume', LOOKUPS_PER_HOUR);
    const ref = db.collection('submissions').doc(code);
    const submission = (await ref.get()).data();
    if (!submission || submission.kind !== 'consent') throw new HttpsError('not-found', NOT_FOUND);
    const locked = submission.resumeLockedUntil instanceof Timestamp && submission.resumeLockedUntil.toMillis() > Date.now();
    if (locked) throw new HttpsError('failed-precondition', 'Too many tries with this reference. Please try again tomorrow, or contact the team.');
    const participant = (await db.collection('participants').doc(String(submission.participantId)).get()).data();
    if (participant?.dateOfBirth !== dob.toISOString().slice(0, 10)) {
      const failures = Number(submission.resumeFailures ?? 0) + 1;
      await ref.set({ resumeFailures: failures, ...(failures >= FAILURES_BEFORE_LOCK ? { resumeFailures: 0, resumeLockedUntil: Timestamp.fromMillis(Date.now() + LOCK_HOURS * 3600_000) } : {}) }, { merge: true });
      logger.warn('Carry-on look-up with a wrong date of birth', { referenceCode: code, failures });
      throw new HttpsError('not-found', NOT_FOUND);
    }
    const assent = submission.assentId ? (await db.collection('assents').doc(String(submission.assentId)).get()).data() : undefined;
    const consent = !submission.phoneSource && submission.consentId ? (await db.collection('consents').doc(String(submission.consentId)).get()).data() : undefined;
    const summary = resumeSummary(code, submission, participant, assent, consent?.responses?.['phone-use']?.response);
    await ref.set({ resumeUids: FieldValue.arrayUnion(uid), resumeFailures: 0, lastLookupAt: FieldValue.serverTimestamp() }, { merge: true });
    logger.info('Record found to carry on', { referenceCode: code, canAgree: summary.canAgree, canAddScreenshots: summary.canAddScreenshots });
    return summary;
  }

  if (data.action === 'agree') {
    const problems = validateLateAgreement(data);
    if (problems.length) {
      logger.warn('Rejected late agreement', { uid, problems });
      throw new HttpsError('invalid-argument', problems[0], { problems });
    }
    const code = normaliseReference(data.referenceCode)!;
    const assentIn = data.assent as unknown as LateAssent;
    const ref = db.collection('submissions').doc(code);
    const submission = (await ref.get()).data();
    if (!submission || !mayAddTo(submission, uid)) throw new HttpsError('failed-precondition', 'That reference does not belong to this session. Enter it again with the date of birth.');
    const previous = submission.assentId ? (await db.collection('assents').doc(String(submission.assentId)).get()).data() : undefined;
    const participant = (await db.collection('participants').doc(String(submission.participantId)).get()).data();
    const consent = !submission.phoneSource && submission.consentId ? (await db.collection('consents').doc(String(submission.consentId)).get()).data() : undefined;
    const summary = resumeSummary(code, submission, participant, previous, consent?.responses?.['phone-use']?.response);
    if (!summary.canAgree) throw new HttpsError('failed-precondition', summary.assentStatus === 'completed' ? 'The young person has already agreed: you can add screenshots.' : 'The young person’s agreement cannot be added to this record. Please contact the team.');

    const participantId = String(submission.participantId);
    const receivedAt = new Date();
    const version = Number(submission.version ?? 1) + 1;
    const assentRef = db.collection('assents').doc();
    const stored = assentIn.status === 'completed' && assentIn.signature?.method === 'drawn' && assentIn.signature.imageDataUrl ? await storeSignature(participantId, assentRef.id, assentIn.signature.imageDataUrl) : null;
    const batch = db.batch();
    batch.set(assentRef, {
      studyId: submission.studyId,
      siteId: submission.siteId,
      schoolId: submission.schoolId ?? participant?.schoolId ?? null,
      participantId,
      referenceCode: code,
      receivedAt,
      sessionUid: uid,
      version,
      formId: assentIn.formId,
      formVersion: assentIn.formVersion,
      status: assentIn.status,
      deferredBy: null,
      responses: assentIn.responses,
      signature: signatureRecord(assentIn.signature, stored),
      handoverConfirmedAt: null,
      startedAt: assentIn.startedAt ?? null,
      completedAt: assentIn.completedAt,
      supersedes: (submission.assentId as string | null | undefined) ?? null,
      // Given later, on a device that came back with the reference (often after the workshop).
      late: true,
      quickAgreementFlag: false,
      client: data.client as ClientInfo,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(
      ref,
      {
        assentId: assentRef.id,
        version,
        resumedAt: receivedAt,
        versions: FieldValue.arrayUnion({ version, kind: 'late-agreement', consentId: submission.consentId ?? null, assentId: assentRef.id, surveyId: submission.surveyId ?? null, moreSurveyId: submission.moreSurveyId ?? null, receivedAt }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await batch.commit();
    logger.info('Late agreement recorded', { referenceCode: code, status: assentIn.status, version });
    return { referenceCode: code, receivedAt: receivedAt.toISOString(), version, status: assentIn.status };
  }

  throw new HttpsError('invalid-argument', 'Unknown action.');
});
