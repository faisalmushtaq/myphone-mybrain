import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type DocumentData, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { randomInt } from 'node:crypto';
import { study } from './forms.js';
import { checkImage, cleanImage, RejectedUpload, type CleanImage } from './images.js';
import type { Quality } from './quality.js';
import { signatureRecord, storeSignature } from './signatures.js';
import { LAB_QUARANTINE } from './lab.js';
import { parseDate, selfConsentOf, validateConsentPayload, validateDonationPayload, type ConsentPayload, type DonationPayload } from './validate.js';

export { enquiry } from './enquiry.js';
export { exportData, exportNow } from './export.js';
export { labFollowUps, lookupLabParticipant, requestLabReminder, submitLabCheckIn, submitLabConsent, submitLabDonation, updateLabPlatforms } from './lab.js';
export { bookLabSlot, cancelLabBooking, labBookingOptions, labMessages, labMessagesNow } from './booking.js';
export { submitLabStory } from './story.js';
export { schoolUpload } from './schoolUpload.js';
export { staffApi } from './staff.js';

initializeApp();

const REGION = 'europe-west2';
const QUARANTINE = 'quarantine';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const callOptions = { region: REGION, memory: '1GiB' as const, timeoutSeconds: 120, enforceAppCheck: process.env.MPMB_ENFORCE_APP_CHECK === 'true' };

function referenceCode(): string {
  const pick = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `MPMB-${pick(4)}-${pick(3)}`;
}

/** A fresh reference code that no submission uses yet (collisions are ~1 in 27 billion, but cheap to rule out). */
async function unusedReferenceCode(db: Firestore): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = referenceCode();
    const existing = await db.collection('submissions').doc(code).get();
    if (!existing.exists) return code;
  }
  throw new HttpsError('internal', 'Could not allocate a reference. Please try again.');
}

/**
 * Records the family's form: the parent's permission and answers, and the
 * young person's agreement when they were asked for it (a 16- or 17-year-old
 * deciding alone sends no parent details and no permission record). Called
 * as soon as the record is complete, so a family that stops part-way still
 * counts; called again with the reference code when something is changed.
 * Amendments append new permission, agreement and answer records (each
 * pointing at the one it supersedes) and update the identifying details;
 * nothing is overwritten or deleted.
 */
export const submitConsent = onCall(callOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');

  const problems = validateConsentPayload(request.data);
  if (problems.length) {
    logger.warn('Rejected permission record', { uid, problems });
    throw new HttpsError('invalid-argument', problems[0], { problems });
  }
  const payload = request.data as ConsentPayload;
  const db = getFirestore();
  const receivedAt = new Date();

  // New record, or an amendment to one this same session already sent.
  let code: string;
  let participantRef: DocumentReference;
  let version: number;
  let previous: DocumentData | null = null;
  if (payload.referenceCode) {
    const snap = await db.collection('submissions').doc(payload.referenceCode).get();
    previous = snap.exists ? (snap.data() as DocumentData) : null;
    if (!previous || previous.sessionUid !== uid) throw new HttpsError('failed-precondition', 'That reference does not belong to this session.');
    code = payload.referenceCode;
    participantRef = db.collection('participants').doc(previous.participantId as string);
    version = Number(previous.version ?? 1) + 1;
  } else {
    code = await unusedReferenceCode(db);
    participantRef = db.collection('participants').doc();
    version = 1;
  }
  const participantId = participantRef.id;
  const amendment = version > 1;
  const dob = parseDate(payload.identity.dateOfBirth);
  // Who decided about the screen time, and where it comes from (decided 7 October 2026: 16 or over alone; under 16 the parent first).
  const selfConsent = selfConsentOf(payload);
  const alone = selfConsent && payload.route === 'young';
  const phoneSource = payload.phoneSource;
  const consentRef = payload.consent ? db.collection('consents').doc() : null;
  const assentRef = db.collection('assents').doc();

  // Signature images go to Storage first; if anything fails, nothing is recorded.
  const consentSignature = consentRef && payload.consent?.signature?.method === 'drawn' && payload.consent.signature.imageDataUrl ? await storeSignature(participantId, consentRef.id, payload.consent.signature.imageDataUrl) : null;
  const assentSignature = payload.assent.signature?.method === 'drawn' && payload.assent.signature.imageDataUrl ? await storeSignature(participantId, assentRef.id, payload.assent.signature.imageDataUrl) : null;

  const batch = db.batch();
  const common = { studyId: payload.studyId, siteId: payload.siteId, schoolId: payload.identity.schoolId, participantId, referenceCode: code, receivedAt, sessionUid: uid, version };
  const email = payload.guardian.email.trim().toLowerCase();

  // 1. Identifying details (restricted collection). An amendment updates in place.
  batch.set(
    participantRef,
    {
      ...common,
      kind: payload.kind,
      firstName: payload.identity.firstName.trim(),
      lastName: payload.identity.lastName.trim(),
      dateOfBirth: dob ? dob.toISOString().slice(0, 10) : null,
      schoolOther: payload.identity.schoolOther.trim() || null,
      yearGroup: payload.identity.yearGroup || null,
      selfConsent,
      phoneSource,
      guardian: alone
        ? null
        : {
            fullName: payload.guardian.fullName.trim(),
            relationship: payload.guardian.relationship,
            relationshipOther: payload.guardian.relationshipOther.trim() || null,
            hasParentalResponsibility: payload.guardian.hasParentalResponsibility,
            email: email || null,
            phone: payload.guardian.phone.trim() || null,
            postcode: payload.guardian.postcode.trim().toUpperCase() || null,
          },
      ...(amendment ? { updatedAt: FieldValue.serverTimestamp() } : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: amendment },
  );

  // 2. Permission record (append-only; an amendment is a new record pointing at the last).
  if (consentRef && payload.consent) {
    batch.set(consentRef, {
      ...common,
      formId: payload.consent.formId,
      formVersion: payload.consent.formVersion,
      informationVersion: payload.consent.informationVersion,
      responses: payload.consent.responses,
      typedName: payload.consent.typedName.trim(),
      signature: signatureRecord(payload.consent.signature, consentSignature),
      confirmedDate: payload.consent.confirmedDate,
      completedAt: payload.consent.completedAt,
      revisedAt: payload.consent.revisedAt,
      route: payload.route,
      supersedes: (previous?.consentId as string | null | undefined) ?? null,
      client: payload.client,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  // 3. Agreement record (append-only, same rule).
  batch.set(assentRef, {
    ...common,
    formId: payload.assent.formId,
    formVersion: payload.assent.formVersion,
    status: payload.assent.status,
    deferredBy: payload.assent.deferredBy,
    responses: payload.assent.responses,
    signature: signatureRecord(payload.assent.signature, assentSignature),
    handoverConfirmedAt: payload.assent.handoverConfirmedAt,
    startedAt: payload.assent.startedAt,
    completedAt: payload.assent.completedAt,
    supersedes: (previous?.assentId as string | null | undefined) ?? null,
    // Flag for follow-up if the young person "agreed" within seconds of the parent signing.
    quickAgreementFlag:
      payload.assent.status === 'completed' && payload.assent.handoverConfirmedAt && payload.assent.completedAt
        ? Date.parse(payload.assent.completedAt) - Date.parse(payload.assent.handoverConfirmedAt) < 15_000
        : false,
    createdAt: FieldValue.serverTimestamp(),
  });

  // 3b. The parent's questions, quick and longer: research data, labelled by participant id only (no names, no reference).
  const surveyDoc = (record: ConsentPayload['survey'], supersedes: unknown) => ({
    studyId: payload.studyId,
    siteId: payload.siteId,
    participantId,
    formId: record!.formId,
    formVersion: record!.formVersion,
    status: record!.status,
    responses: record!.responses,
    startedAt: record!.startedAt,
    completedAt: record!.completedAt,
    version,
    supersedes: (supersedes as string | null | undefined) ?? null,
    receivedAt,
    createdAt: FieldValue.serverTimestamp(),
  });
  const surveyRef = payload.survey && payload.survey.status !== 'not-started' ? db.collection('surveys').doc() : null;
  if (surveyRef) batch.set(surveyRef, surveyDoc(payload.survey, previous?.surveyId));
  const moreRef = payload.more && payload.more.status !== 'not-started' ? db.collection('surveys').doc() : null;
  if (moreRef) batch.set(moreRef, surveyDoc(payload.more, previous?.moreSurveyId));

  // 4. Submission index: one row per reference, pointing at the current records and listing every version.
  const submissionRef = db.collection('submissions').doc(code);
  const submission = {
    ...common,
    kind: payload.kind,
    route: payload.route,
    consentId: consentRef?.id ?? null,
    assentId: assentRef.id,
    surveyId: surveyRef?.id ?? (previous?.surveyId as string | null | undefined) ?? null,
    moreSurveyId: moreRef?.id ?? (previous?.moreSurveyId as string | null | undefined) ?? null,
    selfConsent,
    phoneSource,
    userAgent: payload.client.userAgent.slice(0, 200),
    versions: FieldValue.arrayUnion({ version, kind: payload.kind, consentId: consentRef?.id ?? null, assentId: assentRef.id, surveyId: surveyRef?.id ?? null, moreSurveyId: moreRef?.id ?? null, receivedAt }),
    ...(amendment ? { updatedAt: FieldValue.serverTimestamp() } : { donationIds: [], imageCount: 0, createdAt: FieldValue.serverTimestamp() }),
  };
  batch.set(submissionRef, submission, { merge: amendment });

  // Nothing is emailed to families: the thank-you page offers a copy of the record to download.
  await batch.commit();
  logger.info(amendment ? 'Permission record amended' : 'Permission record created', { referenceCode: code, participantId, version, selfConsent, phoneSource });
  return { referenceCode: code, participantId, receivedAt: receivedAt.toISOString(), version };
});

interface StoredImage {
  uploadId: string;
  path: string;
  contentType: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  redacted: boolean;
  cropped: boolean;
  quality: Quality;
}

/**
 * Moves one upload out of quarantine: checks it belongs to this session, is
 * a real image, re-encodes it (which drops all metadata), runs the quality
 * and safety checks on the clean copy, and stores it under the participant's
 * study id. Anything rejected is deleted from quarantine, never stored.
 */
async function acceptUpload(uid: string, participantId: string, upload: DonationPayload['uploads'][number]): Promise<StoredImage> {
  const bucket = getStorage().bucket();
  const source = bucket.file(`${QUARANTINE}/${uid}/${upload.uploadId}`);
  const [exists] = await source.exists();
  if (!exists) throw new RejectedUpload('This image was not uploaded correctly. Please add it again.');
  const [original] = await source.download();
  let image: CleanImage;
  let quality: Quality;
  try {
    image = await cleanImage(original);
    quality = await checkImage(image, upload.acknowledgedWarning, { uploadId: upload.uploadId });
    if (quality.verdict === 'rejected') throw new RejectedUpload(quality.familyReason ?? 'This image could not be accepted.', quality);
  } catch (error) {
    await source.delete({ ignoreNotFound: true });
    throw error;
  }
  const path = `donations/${participantId}/${upload.uploadId}.${image.ext}`;
  await bucket.file(path).save(image.data, { contentType: image.contentType, resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
  await source.delete({ ignoreNotFound: true });
  return { uploadId: upload.uploadId, path, contentType: image.contentType, width: image.width, height: image.height, bytes: image.data.length, sha256: image.sha256, redacted: upload.redacted, cropped: upload.cropped, quality };
}

/**
 * Records screenshots against a record this session created. Who may share
 * is checked on the server's own copy of the records: a 16- or 17-year-old's
 * own agreement; for an under-16, the parent's yes, and, when the
 * screenshots come from the young person's phone, the young person's
 * agreement too (from the parent's own phone, the parent's yes is enough).
 * Each image is checked and cleaned, and the young person's agreement to
 * share (given by sending) is stored with the images and on the agreement
 * record. Images the checks refuse are reported back with a reason and not
 * stored.
 */
export const submitDonation = onCall(callOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');

  const problems = validateDonationPayload(request.data);
  if (problems.length) {
    logger.warn('Rejected screenshot record', { uid, problems });
    throw new HttpsError('invalid-argument', problems[0], { problems });
  }
  const payload = request.data as DonationPayload;
  const db = getFirestore();
  const receivedAt = new Date();

  const submissionRef = db.collection('submissions').doc(payload.referenceCode);
  const submission = (await submissionRef.get()).data();
  if (!submission || submission.sessionUid !== uid) throw new HttpsError('failed-precondition', 'That reference does not belong to this session.');
  if (submission.kind !== 'consent' || (!submission.consentId && !submission.selfConsent)) throw new HttpsError('failed-precondition', 'Screenshots cannot be added to this record.');
  // null for records made before 7 October 2026, when the young person's agreement could also be given on paper.
  const source = (submission.phoneSource ?? null) as 'parent' | 'child' | 'none' | null;
  if (source === 'none') throw new HttpsError('failed-precondition', 'This record does not include screen time.');
  if (!submission.selfConsent) {
    const consent = (await db.collection('consents').doc(submission.consentId as string).get()).data();
    if (consent?.responses?.['phone-use']?.response !== 'agreed') throw new HttpsError('failed-precondition', 'The parent or carer has not agreed to screen-time screenshots.');
  }
  const assentRef = db.collection('assents').doc(submission.assentId as string);
  const assent = (await assentRef.get()).data();
  if (assent?.status === 'declined') throw new HttpsError('failed-precondition', 'The young person said no to sharing their screen time.');
  if ((source === 'child' || submission.selfConsent) && assent?.status !== 'completed') throw new HttpsError('failed-precondition', 'The young person has not agreed to share their screen time.');
  if (Number(submission.imageCount ?? 0) + payload.uploads.length > study.maxImages) throw new HttpsError('invalid-argument', `At most ${study.maxImages} images can be sent in total.`);

  const participantId = submission.participantId as string;
  const images: StoredImage[] = [];
  const rejected: { uploadId: string; reason: string }[] = [];
  for (const upload of payload.uploads) {
    try {
      images.push(await acceptUpload(uid, participantId, upload));
    } catch (error) {
      if (!(error instanceof RejectedUpload)) throw error;
      rejected.push({ uploadId: upload.uploadId, reason: error.reason });
      logger.warn('Image rejected', { referenceCode: payload.referenceCode, uploadId: upload.uploadId, reasons: error.quality?.reasons ?? [error.reason] });
    }
  }

  let donationId: string | null = null;
  if (images.length) {
    const batch = db.batch();
    const ref = db.collection('donations').doc();
    donationId = ref.id;
    // Research data: image references labelled by participant id (no names here).
    batch.set(ref, {
      studyId: submission.studyId,
      siteId: submission.siteId,
      participantId,
      platform: payload.platform,
      // Whose phone the screenshots come from: the parent's family view, or the young person's own.
      from: source === 'parent' ? 'parent-phone' : 'young-person-phone',
      images,
      agreement: source === 'parent' ? null : payload.agreement,
      // For the team: whether the young person had agreed in the app when this was sent (their agreement may instead be on paper).
      assentStatusAtSend: assent?.status ?? null,
      youngPersonAgreedInApp: payload.agreement !== null,
      needsReview: images.some((i) => i.quality.verdict === 'review'),
      receivedAt,
      client: payload.client,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (source !== 'parent' && payload.agreement && assent?.status === 'completed' && assent?.responses?.['phone-use']?.response !== 'agreed') batch.update(assentRef, { 'responses.phone-use': payload.agreement, updatedAt: FieldValue.serverTimestamp() });
    batch.update(submissionRef, { donationIds: FieldValue.arrayUnion(donationId), imageCount: FieldValue.increment(images.length), platform: payload.platform, lastDonationAt: receivedAt, updatedAt: FieldValue.serverTimestamp() });
    await batch.commit();
  }

  logger.info('Screenshots recorded', { referenceCode: payload.referenceCode, donationId, accepted: images.length, rejected: rejected.length, review: images.filter((i) => i.quality.verdict === 'review').length });
  return { donationId, receivedAt: receivedAt.toISOString(), accepted: images.map((i) => i.uploadId), rejected };
});

/** Deletes quarantine objects that were never submitted, from both the family app's and the lab study's folders. A bucket lifecycle rule can do the same. */
export const purgeQuarantine = onSchedule({ region: REGION, schedule: 'every 6 hours' }, async () => {
  const bucket = getStorage().bucket();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const prefix of [QUARANTINE, LAB_QUARANTINE]) {
    const [files] = await bucket.getFiles({ prefix: `${prefix}/` });
    for (const file of files) {
      const created = Date.parse(String(file.metadata.timeCreated ?? ''));
      if (!Number.isNaN(created) && created < cutoff) {
        await file.delete({ ignoreNotFound: true });
        removed += 1;
      }
    }
  }
  logger.info('Quarantine purge', { removed });
});
