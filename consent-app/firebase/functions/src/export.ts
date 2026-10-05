import { getFirestore, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions/v2';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { parentQuestionsForm } from './forms.js';

/**
 * The nightly export: everything the study has recorded, written as
 * analysis-ready CSV files (plus raw JSON Lines dumps and the image files)
 * into a private bucket of its own. A read-only key for that bucket, and
 * nothing else, lets one computer mirror it into the team's OneDrive folder
 * (scripts/setup-exports.sh and scripts/mac-sync-install.sh).
 *
 * The bucket is a mirror of the current records: every run rewrites the
 * tables, copies any image or signature that is missing, and deletes
 * anything that no longer belongs (for example after a withdrawal).
 * Identifying details and research data sit in separate folders so access
 * can differ; `participantId` is the only join between them.
 */

const REGION = 'europe-west2';
const COPY_BATCH = 8;

export interface Doc {
  id: string;
  data: DocumentData;
}
export type Row = Record<string, unknown>;

export interface Manifest {
  exportedAt: string;
  bucket: string;
  counts: Record<string, number>;
  files: string[];
}

/** The export bucket: its own bucket, so a read-only key for it reaches nothing else. */
export function exportBucketName(env: NodeJS.ProcessEnv = process.env): string {
  const project = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || 'local';
  return env.MPMB_EXPORT_BUCKET?.trim() || `${project}-exports`;
}

/** Firestore timestamps become ISO strings, recursively, so every file reads the same. */
export function plain(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = plain(v);
    return out;
  }
  return value;
}

/** CSV that Excel opens correctly: UTF-8 with a byte-order mark, CRLF, quoted where needed. Arrays join with "; ", objects become JSON. */
export function toCsv(rows: Row[], columns?: string[]): string {
  const cols = columns ?? Array.from(rows.reduce((set, row) => (Object.keys(row).forEach((k) => set.add(k)), set), new Set<string>()));
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = Array.isArray(v) ? v.map((x) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x))).join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[cols.join(','), ...rows.map((row) => cols.map((c) => cell(row[c])).join(','))].join('\r\n')}\r\n`;
}

export function toJsonl(docs: Doc[]): string {
  return docs.map((d) => JSON.stringify({ id: d.id, ...d.data })).join('\n') + (docs.length ? '\n' : '');
}

export const exportImagePath = (path: string) => `research/images/${path.replace(/^donations\//, '')}`;
export const exportSignaturePath = (path: string) => `identifying/signatures/${path.replace(/^signatures\//, '')}`;

export function participantRows(docs: Doc[]): Row[] {
  return docs.map(({ id, data: d }) => ({
    participantId: id,
    referenceCode: d.referenceCode,
    kind: d.kind,
    firstName: d.firstName,
    lastName: d.lastName,
    dateOfBirth: d.dateOfBirth,
    schoolId: d.schoolId,
    schoolOther: d.schoolOther,
    yearGroup: d.yearGroup,
    guardianName: d.guardian?.fullName,
    relationship: d.guardian?.relationship,
    relationshipOther: d.guardian?.relationshipOther,
    hasParentalResponsibility: d.guardian?.hasParentalResponsibility,
    email: d.guardian?.email,
    phone: d.guardian?.phone,
    postcode: d.guardian?.postcode,
    version: d.version,
    receivedAt: d.receivedAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));
}

function statementRows(idName: string, docs: Doc[]): Row[] {
  return docs.flatMap(({ id, data: d }) =>
    Object.entries((d.responses ?? {}) as Record<string, DocumentData>).map(([statementId, r]) => ({
      [idName]: id,
      participantId: d.participantId,
      version: d.version,
      statementId,
      statementVersion: r.version,
      response: r.response,
      respondedAt: r.respondedAt,
      via: r.via,
    })),
  );
}

export function consentRows(docs: Doc[]): { records: Row[]; statements: Row[] } {
  const records = docs.map(({ id, data: d }) => ({
    consentId: id,
    participantId: d.participantId,
    referenceCode: d.referenceCode,
    version: d.version,
    supersedes: d.supersedes,
    formId: d.formId,
    formVersion: d.formVersion,
    informationVersion: d.informationVersion,
    route: d.route,
    typedName: d.typedName,
    signatureMethod: d.signature?.method,
    signatureTypedName: d.signature?.typedName,
    signatureFile: d.signature?.image?.path ? exportSignaturePath(d.signature.image.path) : '',
    confirmedDate: d.confirmedDate,
    completedAt: d.completedAt,
    revisedAt: d.revisedAt,
    receivedAt: d.receivedAt,
    createdAt: d.createdAt,
  }));
  return { records, statements: statementRows('consentId', docs) };
}

export function assentRows(docs: Doc[]): { records: Row[]; statements: Row[] } {
  const records = docs.map(({ id, data: d }) => ({
    assentId: id,
    participantId: d.participantId,
    referenceCode: d.referenceCode,
    version: d.version,
    supersedes: d.supersedes,
    formId: d.formId,
    formVersion: d.formVersion,
    status: d.status,
    deferredBy: d.deferredBy,
    signatureMethod: d.signature?.method,
    signatureTypedName: d.signature?.typedName,
    signatureFile: d.signature?.image?.path ? exportSignaturePath(d.signature.image.path) : '',
    handoverConfirmedAt: d.handoverConfirmedAt,
    startedAt: d.startedAt,
    completedAt: d.completedAt,
    quickAgreementFlag: d.quickAgreementFlag,
    receivedAt: d.receivedAt,
    createdAt: d.createdAt,
  }));
  return { records, statements: statementRows('assentId', docs) };
}

export function submissionRows(docs: Doc[]): Row[] {
  return docs.map(({ id, data: d }) => ({
    referenceCode: id,
    participantId: d.participantId,
    kind: d.kind,
    route: d.route,
    version: d.version,
    consentId: d.consentId,
    assentId: d.assentId,
    surveyId: d.surveyId,
    imageCount: d.imageCount ?? 0,
    donationCount: Array.isArray(d.donationIds) ? d.donationIds.length : 0,
    platform: d.platform,
    lastDonationAt: d.lastDonationAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));
}

export function enquiryRows(docs: Doc[]): Row[] {
  return docs.map(({ id, data: d }) => ({
    id,
    kind: d.kind,
    name: d.name,
    email: d.email,
    topic: d.topic,
    school: d.school,
    role: d.role,
    phone: d.phone,
    area: d.area,
    pupils: d.pupils,
    yearGroups: d.yearGroups,
    canOfferSlots: d.canOfferSlots,
    message: d.message,
    status: d.status,
    notified: d.notified,
    receivedAt: d.receivedAt,
    createdAt: d.createdAt,
  }));
}

export function surveyRows(docs: Doc[], questionIds: string[]): { wide: Row[]; long: Row[] } {
  const ids = Array.from(new Set([...questionIds, ...docs.flatMap((d) => Object.keys((d.data.responses ?? {}) as object))]));
  const wide = docs.map(({ id, data: d }) => ({
    surveyId: id,
    participantId: d.participantId,
    version: d.version,
    supersedes: d.supersedes,
    formId: d.formId,
    formVersion: d.formVersion,
    status: d.status,
    startedAt: d.startedAt,
    completedAt: d.completedAt,
    ...Object.fromEntries(ids.map((q) => [q, (d.responses as Record<string, DocumentData> | undefined)?.[q]?.value ?? ''])),
    receivedAt: d.receivedAt,
  }));
  const long = docs.flatMap(({ id, data: d }) =>
    Object.entries((d.responses ?? {}) as Record<string, DocumentData>).map(([questionId, r]) => ({
      surveyId: id,
      participantId: d.participantId,
      version: d.version,
      questionId,
      questionVersion: r.version,
      value: r.value,
      answeredAt: r.answeredAt,
    })),
  );
  return { wide, long };
}

export function donationRows(docs: Doc[]): { records: Row[]; images: Row[] } {
  const records = docs.map(({ id, data: d }) => ({
    donationId: id,
    participantId: d.participantId,
    platform: d.platform,
    imageCount: Array.isArray(d.images) ? d.images.length : 0,
    youngPersonAgreedInApp: d.youngPersonAgreedInApp,
    assentStatusAtSend: d.assentStatusAtSend,
    agreementVia: d.agreement?.via,
    agreementAt: d.agreement?.respondedAt,
    needsReview: d.needsReview,
    receivedAt: d.receivedAt,
    createdAt: d.createdAt,
  }));
  const images = docs.flatMap(({ id, data: d }) =>
    ((d.images ?? []) as DocumentData[]).map((img) => ({
      donationId: id,
      participantId: d.participantId,
      uploadId: img.uploadId,
      file: exportImagePath(img.path),
      contentType: img.contentType,
      width: img.width,
      height: img.height,
      bytes: img.bytes,
      sha256: img.sha256,
      redacted: img.redacted,
      cropped: img.cropped,
      verdict: img.quality?.verdict,
      reasons: img.quality?.reasons,
      termsFound: img.quality?.termsFound,
      appsVisible: img.quality?.appsVisible,
      looksLikeScreen: img.quality?.looksLikeScreen,
      checkedWithVision: img.quality?.checkedWithVision,
      flatness: img.quality?.flatness,
      portrait: img.quality?.portrait,
      acknowledgedWarning: img.quality?.acknowledgedWarning,
      safeSearch: img.quality?.safeSearch,
    })),
  );
  return { records, images };
}

const README = `# MyPhone/MyBrain data export

Written automatically every night from the study's Firebase project. The
folder is a mirror of the current records: tables are rewritten each run,
new images are added, and anything deleted from the study (for example after
a withdrawal) disappears from here too. Do not edit or add files in this
folder; keep working copies elsewhere.

identifying/   names, dates of birth, contact details, consent and agreement
               records, signatures and website enquiries. Restricted to study
               coordinators.
research/      the parent's quick-question answers and the screenshot records
               and images, labelled by participant id only. No names.

participantId is the only link between the two folders. Timestamps are UTC
in ISO 8601. CSV files are UTF-8 with a byte-order mark and open directly in
Excel; lists are joined with "; ". raw/ holds every document as JSON Lines,
one document per line, for anything the tables leave out.

identifying/participants.csv          one row per young person, current details
identifying/consents.csv              every parent permission record (amendments are new rows; supersedes points back)
identifying/consent_statements.csv    one row per statement per permission record
identifying/assents.csv               every young person's agreement record
identifying/assent_statements.csv     one row per statement per agreement record
identifying/submissions.csv           one row per family: reference, current record ids, image count
identifying/enquiries.csv             messages from the website's contact and school forms
identifying/signatures/<participantId>/<recordId>.png
research/surveys.csv                  one row per questions record, one column per question
research/survey_answers.csv           one row per answer
research/donations.csv                one row per screenshot send
research/images.csv                   one row per image with its quality checks and file path
research/images/<participantId>/<uploadId>.png or .jpg
manifest.json                         when this export ran and how many of each thing it holds
`;

interface OutFile {
  path: string;
  body: string;
  contentType: string;
}

async function ensureBucket(name: string): Promise<void> {
  if (process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR === 'true') return;
  const bucket = getStorage().bucket(name);
  const [exists] = await bucket.exists();
  if (exists) return;
  await getStorage().bucket(name).create({ location: REGION, storageClass: 'STANDARD', iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'enforced' } } as object);
  logger.info('Export bucket created', { bucket: name });
}

/** Builds the whole export and makes the bucket match it. Returns what was written. */
export async function runExport(): Promise<Manifest> {
  const db = getFirestore();
  const source = getStorage().bucket();
  const bucketName = exportBucketName();
  await ensureBucket(bucketName);
  const dest = getStorage().bucket(bucketName);

  const load = async (name: string): Promise<Doc[]> => (await db.collection(name).get()).docs.map((d) => ({ id: d.id, data: plain(d.data()) as DocumentData }));
  const [participants, consents, assents, submissions, enquiries, surveys, donations] = await Promise.all(['participants', 'consents', 'assents', 'submissions', 'enquiries', 'surveys', 'donations'].map(load));

  const csv = (path: string, rows: Row[]): OutFile => ({ path, body: toCsv(rows), contentType: 'text/csv; charset=utf-8' });
  const jsonl = (path: string, docs: Doc[]): OutFile => ({ path, body: toJsonl(docs), contentType: 'application/x-ndjson' });
  const consent = consentRows(consents);
  const assent = assentRows(assents);
  const survey = surveyRows(surveys, parentQuestionsForm.questions.map((q) => q.id));
  const donation = donationRows(donations);
  const files: OutFile[] = [
    csv('identifying/participants.csv', participantRows(participants)),
    csv('identifying/consents.csv', consent.records),
    csv('identifying/consent_statements.csv', consent.statements),
    csv('identifying/assents.csv', assent.records),
    csv('identifying/assent_statements.csv', assent.statements),
    csv('identifying/submissions.csv', submissionRows(submissions)),
    csv('identifying/enquiries.csv', enquiryRows(enquiries)),
    jsonl('identifying/raw/participants.jsonl', participants),
    jsonl('identifying/raw/consents.jsonl', consents),
    jsonl('identifying/raw/assents.jsonl', assents),
    jsonl('identifying/raw/submissions.jsonl', submissions),
    jsonl('identifying/raw/enquiries.jsonl', enquiries),
    csv('research/surveys.csv', survey.wide),
    csv('research/survey_answers.csv', survey.long),
    csv('research/donations.csv', donation.records),
    csv('research/images.csv', donation.images),
    jsonl('research/raw/surveys.jsonl', surveys),
    jsonl('research/raw/donations.jsonl', donations),
    { path: 'README.md', body: README, contentType: 'text/markdown; charset=utf-8' },
  ];

  // Binary files: copied once, deleted when their record goes.
  const copies = new Map<string, string>();
  for (const d of donations) for (const img of (d.data.images ?? []) as DocumentData[]) if (typeof img.path === 'string') copies.set(img.path, exportImagePath(img.path));
  for (const d of [...consents, ...assents]) {
    const path = d.data.signature?.image?.path;
    if (typeof path === 'string') copies.set(path, exportSignaturePath(path));
  }

  const [existing] = await dest.getFiles();
  const present = new Set(existing.map((f) => f.name));
  const expected = new Set<string>([...files.map((f) => f.path), ...copies.values(), 'manifest.json']);

  const toCopy = Array.from(copies.entries()).filter(([, target]) => !present.has(target));
  let copied = 0;
  let missing = 0;
  for (let i = 0; i < toCopy.length; i += COPY_BATCH) {
    await Promise.all(
      toCopy.slice(i, i + COPY_BATCH).map(async ([from, to]) => {
        const file = source.file(from);
        const [exists] = await file.exists();
        if (!exists) {
          missing += 1;
          logger.warn('Export: file referenced by a record is missing', { path: from });
          return;
        }
        const [buffer] = await file.download();
        const [meta] = await file.getMetadata();
        await dest.file(to).save(buffer, { contentType: String(meta.contentType ?? 'application/octet-stream'), resumable: false });
        copied += 1;
      }),
    );
  }

  const manifest: Manifest = {
    exportedAt: new Date().toISOString(),
    bucket: bucketName,
    counts: {
      participants: participants.length,
      consents: consents.length,
      assents: assents.length,
      submissions: submissions.length,
      enquiries: enquiries.length,
      surveys: surveys.length,
      donations: donations.length,
      images: donation.images.length,
      signatures: copies.size - donation.images.length,
      imagesCopiedThisRun: copied,
      filesMissing: missing,
    },
    files: Array.from(expected).sort(),
  };
  files.push({ path: 'manifest.json', body: JSON.stringify(manifest, null, 2), contentType: 'application/json' });
  for (let i = 0; i < files.length; i += COPY_BATCH) {
    await Promise.all(files.slice(i, i + COPY_BATCH).map((f) => dest.file(f.path).save(f.body, { contentType: f.contentType, resumable: false, metadata: { cacheControl: 'private, max-age=0' } })));
  }

  const stale = existing.filter((f) => !expected.has(f.name));
  for (let i = 0; i < stale.length; i += COPY_BATCH) await Promise.all(stale.slice(i, i + COPY_BATCH).map((f) => f.delete({ ignoreNotFound: true })));
  logger.info('Export written', { ...manifest.counts, removed: stale.length });
  return manifest;
}

/** Every night at 02:30 UK time. */
export const exportData = onSchedule({ region: REGION, schedule: '30 2 * * *', timeZone: 'Europe/London', memory: '1GiB', timeoutSeconds: 540, retryCount: 1 }, async () => {
  await runExport();
});

/** Emulator only: lets the end-to-end test run the export on demand. Not deployed. */
export const exportNow =
  process.env.FUNCTIONS_EMULATOR === 'true'
    ? onRequest({ region: REGION, memory: '1GiB', timeoutSeconds: 540 }, async (_req, res) => {
        res.json(await runExport());
      })
    : undefined;
