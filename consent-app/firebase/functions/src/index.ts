import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type DocumentData, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { createHash, randomInt } from 'node:crypto';
import sharp from 'sharp';
import { study } from './forms.js';
import { assess, flatnessOfPixels, inspectWithVision, visionEnabled, type Quality } from './quality.js';
import { parseDate, validateConsentPayload, validateDonationPayload, type ConsentPayload, type DonationPayload } from './validate.js';

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

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Decodes a PNG data URL and checks it really is a PNG of acceptable size. */
function decodeSignature(dataUrl: string): Buffer {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  const isPng = buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) throw new HttpsError('invalid-argument', 'The signature is not a PNG image.');
  if (buffer.length > study.maxSignatureBytes) throw new HttpsError('invalid-argument', 'The signature image is too large.');
  return buffer;
}

async function storeSignature(participantId: string, name: string, dataUrl: string): Promise<{ path: string; sha256: string }> {
  const buffer = decodeSignature(dataUrl);
  const path = `signatures/${participantId}/${name}.png`;
  await getStorage().bucket().file(path).save(buffer, { contentType: 'image/png', resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
  return { path, sha256: sha256(buffer) };
}

function signatureRecord(sig: NonNullable<ConsentPayload['consent']>['signature'], stored: { path: string; sha256: string } | null) {
  if (!sig) return null;
  return { method: sig.method, typedName: sig.typedName, strokeCount: sig.strokeCount, pointerType: sig.pointerType, capturedAt: sig.capturedAt, image: stored };
}

/**
 * Records the permission and agreement. Called as soon as the young person
 * has signed, declined or deferred, so a family that stops there still
 * counts as having taken part; called again with the reference code when
 * something is changed. Amendments append new permission and agreement
 * records (each pointing at the one it supersedes) and update the
 * identifying details; nothing is overwritten or deleted.
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
  const consentRef = payload.consent ? db.collection('consents').doc() : null;
  const assentRef = db.collection('assents').doc();

  // Signature images go to Storage first; if anything fails, nothing is recorded.
  const consentSignature = consentRef && payload.consent?.signature?.method === 'drawn' && payload.consent.signature.imageDataUrl ? await storeSignature(participantId, consentRef.id, payload.consent.signature.imageDataUrl) : null;
  const assentSignature = payload.assent.signature?.method === 'drawn' && payload.assent.signature.imageDataUrl ? await storeSignature(participantId, assentRef.id, payload.assent.signature.imageDataUrl) : null;

  const batch = db.batch();
  const common = { studyId: payload.studyId, siteId: payload.siteId, schoolId: payload.identity.schoolId, participantId, referenceCode: code, receivedAt, sessionUid: uid, version };
  const email = payload.guardian.email.trim().toLowerCase();

  // 1. Identifying details (restricted collection). A declined record keeps the minimum; an amendment updates in place.
  batch.set(
    participantRef,
    {
      ...common,
      kind: payload.kind,
      firstName: payload.identity.firstName.trim(),
      lastName: payload.identity.lastName.trim(),
      dateOfBirth: payload.kind === 'consent' && dob ? dob.toISOString().slice(0, 10) : null,
      schoolOther: payload.identity.schoolOther.trim() || null,
      yearGroup: payload.identity.yearGroup || null,
      guardian: {
        fullName: payload.guardian.fullName.trim(),
        relationship: payload.guardian.relationship,
        relationshipOther: payload.guardian.relationshipOther.trim() || null,
        hasParentalResponsibility: payload.guardian.hasParentalResponsibility,
        wantsCopy: payload.guardian.wantsCopy,
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

  // 3b. The parent's quick questions: research data, labelled by participant id only (no names, no reference).
  const surveyRef = payload.kind === 'consent' && payload.survey && payload.survey.status !== 'not-started' ? db.collection('surveys').doc() : null;
  if (surveyRef && payload.survey) {
    batch.set(surveyRef, {
      studyId: payload.studyId,
      siteId: payload.siteId,
      participantId,
      formId: payload.survey.formId,
      formVersion: payload.survey.formVersion,
      status: payload.survey.status,
      responses: payload.survey.responses,
      startedAt: payload.survey.startedAt,
      completedAt: payload.survey.completedAt,
      version,
      supersedes: (previous?.surveyId as string | null | undefined) ?? null,
      receivedAt,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  // 4. Submission index: one row per reference, pointing at the current records and listing every version.
  const wantsCopy = payload.kind === 'consent' && payload.guardian.wantsCopy && email !== '';
  const sendCopy = wantsCopy && previous?.copyEmailedTo !== email;
  const submissionRef = db.collection('submissions').doc(code);
  const submission = {
    ...common,
    kind: payload.kind,
    route: payload.route,
    consentId: consentRef?.id ?? null,
    assentId: assentRef.id,
    surveyId: surveyRef?.id ?? (previous?.surveyId as string | null | undefined) ?? null,
    userAgent: payload.client.userAgent.slice(0, 200),
    versions: FieldValue.arrayUnion({ version, kind: payload.kind, consentId: consentRef?.id ?? null, assentId: assentRef.id, surveyId: surveyRef?.id ?? null, receivedAt }),
    ...(sendCopy ? { copyEmailedTo: email } : {}),
    ...(amendment ? { updatedAt: FieldValue.serverTimestamp() } : { donationIds: [], imageCount: 0, createdAt: FieldValue.serverTimestamp() }),
  };
  batch.set(submissionRef, submission, { merge: amendment });

  // 5. A copy by email, only when asked for and not already sent to this address (Trigger Email extension; wording to be agreed with ethics).
  if (sendCopy) {
    batch.set(db.collection('mail').doc(), {
      to: email,
      message: {
        subject: `MyPhone/MyBrain: your permission has been recorded (${code})`,
        text: [
          `Thank you for giving permission for ${payload.identity.firstName.trim()} to take part in MyPhone/MyBrain.`,
          `Your reference is ${code}.`,
          '',
          'A summary of your choices will be attached in the final version of this email.',
          'You can withdraw at any time by emailing brainpop@leeds.ac.uk and quoting your reference.',
          'If you did not complete this form, please tell us straight away by replying to this email.',
        ].join('\n'),
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  logger.info(amendment ? 'Permission record amended' : 'Permission record created', { referenceCode: code, participantId, kind: payload.kind, version });
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

/** An image the checks would not keep. Carries a reason the family can act on. */
class RejectedImage extends Error {
  constructor(
    public reason: string,
    public quality: Quality | null,
  ) {
    super(reason);
  }
}

/** Colour flatness of a small copy: high for flat UI, low for photographs. */
async function flatnessOf(image: Buffer): Promise<number> {
  const { data, info } = await sharp(image).resize(96, 96, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return flatnessOfPixels(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.channels);
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
  if (!exists) throw new RejectedImage('This image was not uploaded correctly. Please add it again.', null);
  const [original] = await source.download();
  let pipeline = sharp(original, { failOn: 'error' }).rotate();
  let meta;
  try {
    meta = await pipeline.metadata();
  } catch {
    await source.delete({ ignoreNotFound: true });
    throw new RejectedImage('This file is not an image we can read. Please add a PNG or JPEG screenshot.', null);
  }
  if (!meta.format || !['png', 'jpeg', 'webp'].includes(meta.format)) {
    await source.delete({ ignoreNotFound: true });
    throw new RejectedImage('This file is not a supported image. Please add a PNG or JPEG screenshot.', null);
  }
  if ((meta.width ?? 0) > 6000 || (meta.height ?? 0) > 12000) pipeline = pipeline.resize({ width: 3000, height: 6000, fit: 'inside', withoutEnlargement: true });
  // Re-encoding without withMetadata() strips EXIF, GPS, ICC and XMP.
  const output = meta.format === 'png' ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true }) : await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });

  // Quality and safety, on the clean copy. A Vision outage flags the image for review rather than losing it.
  const flatness = await flatnessOf(output.data);
  let vision = null;
  if (visionEnabled()) {
    try {
      vision = await inspectWithVision(output.data);
    } catch (error) {
      logger.warn('Vision check failed; image kept for review', { uploadId: upload.uploadId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const quality = assess({ width: output.info.width, height: output.info.height, flatness, vision, acknowledgedWarning: upload.acknowledgedWarning });
  if (!visionEnabled()) quality.reasons.push('Vision checks not enabled.');
  if (quality.verdict === 'rejected') {
    await source.delete({ ignoreNotFound: true });
    throw new RejectedImage(quality.familyReason ?? 'This image could not be accepted.', quality);
  }

  const ext = meta.format === 'png' ? 'png' : 'jpg';
  const contentType = meta.format === 'png' ? 'image/png' : 'image/jpeg';
  const path = `donations/${participantId}/${upload.uploadId}.${ext}`;
  await bucket.file(path).save(output.data, { contentType, resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
  await source.delete({ ignoreNotFound: true });
  return { uploadId: upload.uploadId, path, contentType, width: output.info.width, height: output.info.height, bytes: output.data.length, sha256: sha256(output.data), redacted: upload.redacted, cropped: upload.cropped, quality };
}

/**
 * Records screenshots against a permission record this session created.
 * Both agreements are checked on the server's own copy of the records, each
 * image is checked and cleaned, and the young person's agreement to share
 * (given by sending) is stored with the images and on the agreement record.
 * Images the checks refuse are reported back with a reason and not stored.
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
  if (submission.kind !== 'consent' || !submission.consentId) throw new HttpsError('failed-precondition', 'Screenshots cannot be added to this record.');
  const consent = (await db.collection('consents').doc(submission.consentId as string).get()).data();
  if (consent?.responses?.['phone-use']?.response !== 'agreed') throw new HttpsError('failed-precondition', 'The parent or guardian has not agreed to screen-time screenshots.');
  const assentRef = db.collection('assents').doc(submission.assentId as string);
  const assent = (await assentRef.get()).data();
  // The young person shares after signing; a parent may share on their behalf only while the young person's agreement is being collected separately.
  if (payload.sharedBy === 'young' && assent?.status !== 'completed') throw new HttpsError('failed-precondition', 'The young person has not agreed to take part yet.');
  if (payload.sharedBy === 'parent' && !(assent?.status === 'deferred' && assent?.deferredBy === 'parent')) throw new HttpsError('failed-precondition', 'Screenshots can only be shared for the young person while their agreement is being collected separately.');
  if (Number(submission.imageCount ?? 0) + payload.uploads.length > study.maxImages) throw new HttpsError('invalid-argument', `At most ${study.maxImages} images can be sent in total.`);

  const participantId = submission.participantId as string;
  const images: StoredImage[] = [];
  const rejected: { uploadId: string; reason: string }[] = [];
  for (const upload of payload.uploads) {
    try {
      images.push(await acceptUpload(uid, participantId, upload));
    } catch (error) {
      if (!(error instanceof RejectedImage)) throw error;
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
      images,
      sharedBy: payload.sharedBy,
      agreement: payload.agreement,
      // Shared by the parent: hold until the young person has been asked; delete if they say no.
      pendingAssent: payload.sharedBy === 'parent',
      needsReview: images.some((i) => i.quality.verdict === 'review'),
      receivedAt,
      client: payload.client,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (payload.agreement && assent?.responses?.['phone-use']?.response !== 'agreed') batch.update(assentRef, { 'responses.phone-use': payload.agreement, updatedAt: FieldValue.serverTimestamp() });
    batch.update(submissionRef, { donationIds: FieldValue.arrayUnion(donationId), imageCount: FieldValue.increment(images.length), platform: payload.platform, lastDonationAt: receivedAt, updatedAt: FieldValue.serverTimestamp() });
    await batch.commit();
  }

  logger.info('Screenshots recorded', { referenceCode: payload.referenceCode, donationId, accepted: images.length, rejected: rejected.length, review: images.filter((i) => i.quality.verdict === 'review').length });
  return { donationId, receivedAt: receivedAt.toISOString(), accepted: images.map((i) => i.uploadId), rejected };
});

/** Deletes quarantine objects that were never submitted. A bucket lifecycle rule can do the same. */
export const purgeQuarantine = onSchedule({ region: REGION, schedule: 'every 6 hours' }, async () => {
  const bucket = getStorage().bucket();
  const [files] = await bucket.getFiles({ prefix: `${QUARANTINE}/` });
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const file of files) {
    const created = Date.parse(String(file.metadata.timeCreated ?? ''));
    if (!Number.isNaN(created) && created < cutoff) {
      await file.delete({ ignoreNotFound: true });
      removed += 1;
    }
  }
  logger.info('Quarantine purge', { removed });
});
