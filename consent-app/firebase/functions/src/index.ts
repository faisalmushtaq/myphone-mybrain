import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type WriteBatch } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { createHash, randomInt } from 'node:crypto';
import sharp from 'sharp';
import { study } from './forms.js';
import { parseDate, validatePayload, type Payload } from './validate.js';

initializeApp();

const REGION = 'europe-west2';
const QUARANTINE = 'quarantine';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function referenceCode(): string {
  const pick = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `MPMB-${pick(4)}-${pick(3)}`;
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

interface StoredImage {
  path: string;
  contentType: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  redacted: boolean;
  cropped: boolean;
}

/**
 * Moves one upload out of quarantine: checks it belongs to this session, is a
 * real image, re-encodes it (which drops all metadata), and stores it under
 * the participant's study id.
 */
async function acceptUpload(uid: string, participantId: string, upload: Payload['donation']['uploads'][number]): Promise<StoredImage> {
  const bucket = getStorage().bucket();
  const source = bucket.file(`${QUARANTINE}/${uid}/${upload.uploadId}`);
  const [exists] = await source.exists();
  if (!exists) throw new HttpsError('invalid-argument', 'One of the images was not uploaded correctly.');
  const [original] = await source.download();
  let pipeline = sharp(original, { failOn: 'error' }).rotate();
  const meta = await pipeline.metadata();
  if (!meta.format || !['png', 'jpeg', 'webp'].includes(meta.format)) throw new HttpsError('invalid-argument', 'One of the files is not a supported image.');
  if ((meta.width ?? 0) > 6000 || (meta.height ?? 0) > 12000) pipeline = pipeline.resize({ width: 3000, height: 6000, fit: 'inside', withoutEnlargement: true });
  // Re-encoding without withMetadata() strips EXIF, GPS, ICC and XMP.
  const output = meta.format === 'png' ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true }) : await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  const ext = meta.format === 'png' ? 'png' : 'jpg';
  const contentType = meta.format === 'png' ? 'image/png' : 'image/jpeg';
  const path = `donations/${participantId}/${upload.uploadId}.${ext}`;
  await bucket.file(path).save(output.data, { contentType, resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
  await source.delete({ ignoreNotFound: true });
  return { path, contentType, width: output.info.width, height: output.info.height, bytes: output.data.length, sha256: sha256(output.data), redacted: upload.redacted, cropped: upload.cropped };
}

async function storeSignature(participantId: string, name: string, dataUrl: string): Promise<{ path: string; sha256: string }> {
  const buffer = decodeSignature(dataUrl);
  const path = `signatures/${participantId}/${name}.png`;
  await getStorage().bucket().file(path).save(buffer, { contentType: 'image/png', resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
  return { path, sha256: sha256(buffer) };
}

function signatureRecord(sig: NonNullable<Payload['consent']>['signature'], stored: { path: string; sha256: string } | null) {
  if (!sig) return null;
  return { method: sig.method, typedName: sig.typedName, strokeCount: sig.strokeCount, pointerType: sig.pointerType, capturedAt: sig.capturedAt, image: stored };
}

/**
 * Accepts a completed form. Everything is validated again here; the client
 * is not trusted. Writes go to separate collections so identifying details
 * can be locked down independently of research data.
 */
export const submitConsent = onCall({ region: REGION, memory: '1GiB', timeoutSeconds: 120, enforceAppCheck: process.env.MPMB_ENFORCE_APP_CHECK === 'true' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');

  const problems = validatePayload(request.data);
  if (problems.length) {
    logger.warn('Rejected submission', { uid, problems });
    throw new HttpsError('invalid-argument', problems[0], { problems });
  }
  const payload = request.data as Payload;

  const db = getFirestore();
  const receivedAt = new Date();
  const participantRef = db.collection('participants').doc();
  const participantId = participantRef.id;
  const code = referenceCode();
  const dob = parseDate(payload.identity.dateOfBirth);

  // Research images and signatures go to Storage first; if anything fails, nothing is recorded.
  const images: StoredImage[] = [];
  for (const upload of payload.donation.uploads) images.push(await acceptUpload(uid, participantId, upload));
  const consentSignature = payload.consent?.signature?.method === 'drawn' && payload.consent.signature.imageDataUrl ? await storeSignature(participantId, 'consent', payload.consent.signature.imageDataUrl) : null;
  const assentSignature = payload.assent.signature?.method === 'drawn' && payload.assent.signature.imageDataUrl ? await storeSignature(participantId, 'assent', payload.assent.signature.imageDataUrl) : null;

  const batch: WriteBatch = db.batch();
  const common = { studyId: payload.studyId, siteId: payload.siteId, schoolId: payload.identity.schoolId, participantId, referenceCode: code, receivedAt, sessionUid: uid };

  // 1. Identifying details (restricted collection). A declined submission keeps the minimum.
  batch.set(participantRef, {
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
      email: payload.guardian.email.trim().toLowerCase(),
      phone: payload.guardian.phone.trim() || null,
      postcode: payload.guardian.postcode.trim().toUpperCase() || null,
    },
    createdAt: FieldValue.serverTimestamp(),
  });

  // 2. Permission record (append-only).
  let consentId: string | null = null;
  if (payload.consent) {
    const ref = db.collection('consents').doc();
    consentId = ref.id;
    batch.set(ref, {
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
      client: payload.client,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  // 3. Agreement record (append-only).
  const assentRef = db.collection('assents').doc();
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
    // Flag for follow-up if the young person "agreed" within seconds of the parent signing.
    quickAgreementFlag:
      payload.assent.status === 'completed' && payload.assent.handoverConfirmedAt && payload.assent.completedAt
        ? Date.parse(payload.assent.completedAt) - Date.parse(payload.assent.handoverConfirmedAt) < 15_000
        : false,
    createdAt: FieldValue.serverTimestamp(),
  });

  // 4. Research data: image references only, labelled by participant id (no names here).
  let donationId: string | null = null;
  if (payload.kind === 'consent') {
    const ref = db.collection('donations').doc();
    donationId = ref.id;
    batch.set(ref, {
      studyId: payload.studyId,
      siteId: payload.siteId,
      participantId,
      status: payload.donation.status,
      platform: payload.donation.platform,
      images,
      receivedAt,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  // 5. Submission index (one row per send).
  batch.set(db.collection('submissions').doc(code), {
    ...common,
    kind: payload.kind,
    route: payload.route,
    consentId,
    assentId: assentRef.id,
    donationId,
    imageCount: images.length,
    userAgent: payload.client.userAgent.slice(0, 200),
    createdAt: FieldValue.serverTimestamp(),
  });

  // 6. Confirmation email for the Trigger Email extension (content to be agreed with ethics).
  if (payload.kind === 'consent') {
    batch.set(db.collection('mail').doc(), {
      to: payload.guardian.email.trim(),
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
  logger.info('Submission recorded', { referenceCode: code, participantId, kind: payload.kind, images: images.length });
  return { referenceCode: code, receivedAt: receivedAt.toISOString() };
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
