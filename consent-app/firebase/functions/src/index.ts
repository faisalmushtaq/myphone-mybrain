import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type DocumentData, type DocumentReference, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { createHash, randomInt } from 'node:crypto';
import { study } from './forms.js';
import { checkImage, cleanImage, RejectedUpload, type CleanImage } from './images.js';
import type { Quality } from './quality.js';
import { signatureRecord, storeSignature } from './signatures.js';
import { LAB_QUARANTINE } from './lab.js';
import { mayAddTo } from './resume.js';
import { parseDate, selfConsentOf, validateConsentPayload, validateDonationPayload, type ConsentPayload, type DonationPayload } from './validate.js';

export { enquiry } from './enquiry.js';
export { resumeRecord } from './resume.js';
export { exportData, exportNow } from './export.js';
export { labFollowUps, lookupLabParticipant, requestLabReminder, submitLabCheckIn, submitLabConsent, submitLabDonation, updateLabPlatforms } from './lab.js';
export { bookLabSlot, cancelLabBooking, labBookingOptions, labMessages, labMessagesNow } from './booking.js';
export { submitLabStory } from './story.js';
export { schoolUpload } from './schoolUpload.js';
export { staffApi } from './staff.js';
export { purgeUsage, usage } from './usage.js';

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

/** The same JSON for the same content, whatever order the keys arrive in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

/**
 * Records the family's form: the parent's permission and answers, and the
 * young person's agreement when they were asked for it (a 16- or 17-year-old
 * deciding alone sends no parent details and no permission record). Called
 * from the moment the parent signs (decided 7 October 2026: whatever a
 * family gives after signing is kept and used, even if they stop part-way),
 * and again with the reference code as answers are added or changed.
 *
 * A change to the details, the permission or the agreement is a new version:
 * the permission or agreement that changed gets a new record pointing at the
 * one it supersedes (an unchanged one is kept, not copied), and the
 * identifying details are updated. Answers are saved as they are given: each
 * question form has one answers record, which the latest answers replace.
 * Nothing else is overwritten or deleted.
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

  // New record, or a later save of one this same session already sent.
  let code: string;
  let participantRef: DocumentReference;
  let previous: DocumentData | null = null;
  if (payload.referenceCode) {
    const snap = await db.collection('submissions').doc(payload.referenceCode).get();
    previous = snap.exists ? (snap.data() as DocumentData) : null;
    if (!previous || previous.sessionUid !== uid) throw new HttpsError('failed-precondition', 'That reference does not belong to this session.');
    code = payload.referenceCode;
    participantRef = db.collection('participants').doc(previous.participantId as string);
  } else {
    code = await unusedReferenceCode(db);
    participantRef = db.collection('participants').doc();
  }
  const participantId = participantRef.id;

  // What changed since the last save. The young person's agreement to share by sending travels with the screenshots (and is added to the agreement record there), so it is not a change here.
  const { 'phone-use': _bySending, ...assentResponses } = payload.assent.responses;
  const hashes = {
    details: digest({ route: payload.route, identity: payload.identity, guardian: payload.guardian, phoneSource: payload.phoneSource }),
    consent: digest(payload.consent),
    assent: digest({ ...payload.assent, responses: assentResponses }),
  };
  const before = (previous?.hashes ?? null) as Record<string, string> | null;
  const same = (part: keyof typeof hashes) => before !== null && before[part] === hashes[part];
  const keepConsent = payload.consent !== null && same('consent') && typeof previous?.consentId === 'string';
  const keepAssent = same('assent') && typeof previous?.assentId === 'string';
  const changed = previous === null || !same('details') || !same('consent') || !same('assent');
  const version = previous === null ? 1 : Number(previous.version ?? 1) + (changed ? 1 : 0);
  const amendment = previous !== null;

  const dob = parseDate(payload.identity.dateOfBirth);
  // Who decided about the screen time, and where it comes from (decided 7 October 2026: 16 or over alone; under 16 the parent first; null until the parent has said).
  const selfConsent = selfConsentOf(payload);
  const alone = selfConsent && payload.route === 'young';
  const phoneSource = payload.phoneSource;
  const consentRef = payload.consent ? (keepConsent ? db.collection('consents').doc(String(previous!.consentId)) : db.collection('consents').doc()) : null;
  const assentRef = keepAssent ? db.collection('assents').doc(String(previous!.assentId)) : db.collection('assents').doc();
  const newConsent = consentRef !== null && !keepConsent;
  const newAssent = !keepAssent;

  // Signature images go to Storage first; if anything fails, nothing is recorded.
  const consentSignature = newConsent && payload.consent?.signature?.method === 'drawn' && payload.consent.signature.imageDataUrl ? await storeSignature(participantId, consentRef!.id, payload.consent.signature.imageDataUrl) : null;
  const assentSignature = newAssent && payload.assent.signature?.method === 'drawn' && payload.assent.signature.imageDataUrl ? await storeSignature(participantId, assentRef.id, payload.assent.signature.imageDataUrl) : null;

  // The answers records to replace, if this record has them already.
  const answersBefore = async (id: unknown) => (typeof id === 'string' ? await db.collection('surveys').doc(id).get() : null);
  const [surveyBefore, moreBefore] = await Promise.all([answersBefore(previous?.surveyId), answersBefore(previous?.moreSurveyId)]);

  const batch = db.batch();
  const common = { studyId: payload.studyId, siteId: payload.siteId, schoolId: payload.identity.schoolId, participantId, referenceCode: code, receivedAt, sessionUid: uid, version };
  const email = payload.guardian.email.trim().toLowerCase();

  // 1. Identifying details (restricted collection). A change updates them in place.
  if (changed) {
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
              email: email || null,
              phone: payload.guardian.phone.trim() || null,
              address: payload.guardian.address.trim(),
              postcode: payload.guardian.postcode.trim().toUpperCase(),
            },
        ...(amendment ? { updatedAt: FieldValue.serverTimestamp() } : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: amendment },
    );
  }

  // 2. Permission record (append-only; a changed one is a new record pointing at the last).
  if (newConsent && consentRef && payload.consent) {
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

  // 3. Agreement record (append-only, same rule). Until the young person answers, it says so ('not-started').
  if (newAssent) {
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
  }

  // 3b. The parent's questions, quick and longer: research data, labelled by participant id only (no names, no reference). One record per form, replaced by the latest answers.
  const saveAnswers = (record: ConsentPayload['survey'], earlier: DocumentSnapshot | null): string | null => {
    if (!record || record.status === 'not-started') return earlier?.exists ? earlier.id : null;
    const ref = earlier?.exists ? earlier.ref : db.collection('surveys').doc();
    batch.set(ref, {
      studyId: payload.studyId,
      siteId: payload.siteId,
      participantId,
      formId: record.formId,
      formVersion: record.formVersion,
      status: record.status,
      responses: record.responses,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      version,
      supersedes: null,
      receivedAt,
      createdAt: earlier?.exists ? (earlier.get('createdAt') ?? receivedAt) : FieldValue.serverTimestamp(),
      ...(earlier?.exists ? { updatedAt: FieldValue.serverTimestamp() } : {}),
    });
    return ref.id;
  };
  const surveyId = saveAnswers(payload.survey, surveyBefore);
  const moreSurveyId = saveAnswers(payload.more, moreBefore);

  // 4. Submission index: one row per reference, pointing at the current records and listing every version.
  const submissionRef = db.collection('submissions').doc(code);
  const submission = {
    ...common,
    kind: payload.kind,
    route: payload.route,
    consentId: consentRef?.id ?? null,
    assentId: assentRef.id,
    surveyId,
    moreSurveyId,
    selfConsent,
    phoneSource,
    hashes,
    userAgent: payload.client.userAgent.slice(0, 200),
    answersSavedAt: receivedAt,
    ...(changed ? { versions: FieldValue.arrayUnion({ version, kind: payload.kind, consentId: consentRef?.id ?? null, assentId: assentRef.id, receivedAt }) } : {}),
    ...(amendment ? { updatedAt: FieldValue.serverTimestamp() } : { donationIds: [], imageCount: 0, createdAt: FieldValue.serverTimestamp() }),
  };
  batch.set(submissionRef, submission, { merge: amendment });

  // Nothing is emailed to families: the thank-you page offers a copy of the record to download.
  await batch.commit();
  logger.info(!amendment ? 'Permission record created' : changed ? 'Permission record amended' : 'Answers saved', { referenceCode: code, participantId, version, selfConsent, phoneSource });
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
  // The session that made the record, or one that came back later with its reference and the young person's date of birth (resume.ts).
  if (!submission || !mayAddTo(submission, uid)) throw new HttpsError('failed-precondition', 'That reference does not belong to this session.');
  const later = submission.sessionUid !== uid;
  if (submission.kind !== 'consent' || (!submission.consentId && !submission.selfConsent)) throw new HttpsError('failed-precondition', 'Screenshots cannot be added to this record.');
  // The parent's yes to sharing an under-16's screen time is their answer to where it comes from (none until they give it: the record is saved from the moment they sign).
  // Records made before 7 October 2026 have no phoneSource: the parent's yes was a statement on the permission, and the young person's agreement could also be given on paper.
  const source = (submission.phoneSource ?? null) as 'parent' | 'child' | 'none' | null;
  if (source === 'none') throw new HttpsError('failed-precondition', 'This record does not include screen time.');
  if (!submission.selfConsent && source === null) {
    const consent = (await db.collection('consents').doc(submission.consentId as string).get()).data();
    if (consent?.responses?.['phone-use']?.response !== 'agreed') throw new HttpsError('failed-precondition', 'The parent or carer has not said yes to sharing the screen time.');
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
      // Sent later, from a device that came back with the reference (often after the workshop).
      late: later,
      receivedAt,
      client: payload.client,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (source !== 'parent' && payload.agreement && assent?.status === 'completed' && assent?.responses?.['phone-use']?.response !== 'agreed') batch.update(assentRef, { 'responses.phone-use': payload.agreement, updatedAt: FieldValue.serverTimestamp() });
    batch.update(submissionRef, { donationIds: FieldValue.arrayUnion(donationId), imageCount: FieldValue.increment(images.length), platform: payload.platform, lastDonationAt: receivedAt, ...(later ? { resumedAt: receivedAt } : {}), updatedAt: FieldValue.serverTimestamp() });
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
