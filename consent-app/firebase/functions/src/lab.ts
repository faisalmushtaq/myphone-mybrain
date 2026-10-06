import { FieldValue, getFirestore, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import JSZip from 'jszip';
import { cleaner, labCheckInForm, labConsentForm, labInformationVersion, labStudy, PARTICIPANT_CODE, UK_POSTCODE } from './forms.js';
import { checkImage, cleanImage, RejectedUpload, sha256 } from './images.js';
import type { Quality } from './quality.js';
import { sendMail } from './mail.js';
import { signatureRecord, storeSignature } from './signatures.js';
import { blank, isObj, ISO_DATE, limits, str, UUID, validateClient, validateResponses, validateSignature, validTime, type ClientInfo, type SignatureRecord, type StatementRecord } from './validate.js';

/**
 * The social media break study (adults, the laboratory study). Participants
 * are known by the code the lab questionnaire builds (for example JA101CD),
 * never by name, and the process spans days: consent first, then cleaned
 * TikTok and YouTube exports and screen-time screenshots when they arrive,
 * possibly from another device.
 *
 *   labParticipants/{code}   one row per code: current consent, counts (in total and by
 *                            phase), check-ins, sessions seen
 *   labConsents/             the consent records (name and signature: identifying)
 *   labDonations/            one record per send, listing the stored files, filed under the
 *                            phase of the page it came from: pre (the first page, before the
 *                            break), mid (a check-in during it), post (the after-break page)
 *   labCheckIns/             one record per mid-break check-in: the answers, by code
 *   labReminders/{code}      a participant's email, when they asked to be sent their
 *                            progress and one follow-up (identifying)
 *   Storage lab/{code}/      the files themselves; labquarantine/{uid}/ uploads
 *                            waiting to be checked; signatures/lab/{code}/
 */

export const LAB_QUARANTINE = 'labquarantine';
const REGION = 'europe-west2';
const callOptions = { region: REGION, memory: '1GiB' as const, timeoutSeconds: 300, enforceAppCheck: process.env.MPMB_ENFORCE_APP_CHECK === 'true' };
const LOOKUPS_PER_HOUR = 30;
const REMINDERS_PER_HOUR = 5;
const CHECKINS_PER_HOUR = 10;
const PLATFORM_UPDATES_PER_HOUR = 30;
/** How long after a progress email the one follow-up goes, unless files have arrived. */
const FOLLOW_UP_AFTER_MS = 48 * 3600_000;
const SITE = 'https://myphonemybrain.com';
/** The page each phase's files are sent from. */
const PAGE: Record<string, string> = { pre: `${SITE}/break/take-part/`, mid: `${SITE}/break/check-in/`, post: `${SITE}/break/after/` };
/** A link that opens the right page ready for this code, on any device. */
const pageFor = (phase: string, code: string) => `${PAGE[phase] ?? PAGE.pre}?code=${encodeURIComponent(code)}`;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Bytes an archive may expand to, in total. The cleaned files are small; anything near this was not made by the cleaner. */
const MAX_UNPACKED = 400 * 1024 * 1024;
const PLATFORMS = ['tiktok', 'youtube', 'instagram'];
const PLATFORM_NAMES: Record<string, string> = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram' };
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const PHONES = ['iphone', 'android'];
/** Where in the study a send belongs, set by the page it came from: before the break, a check-in during it, after it. */
const PHASES = ['pre', 'mid', 'post'] as const;
type Phase = (typeof PHASES)[number];
/** Firestore document ids, as given to the client for a check-in. */
const DOC_ID = /^[A-Za-z0-9]{1,40}$/;
const NOT_OURS = 'This file is not a cleaned export made on the “Choose what to share” step. Please prepare it there again and add the result.';

export interface LabConsentPayload {
  participantCode: string;
  consent: {
    formId: string;
    formVersion: string;
    informationVersion: string;
    responses: Record<string, StatementRecord>;
    typedName: string;
    signature: SignatureRecord | null;
    confirmedDate: string;
    completedAt: string | null;
  };
  /** The answers the code was built from; null when an existing code was typed. Identifying: stored with the consent only. */
  codeParts: CodeParts | null;
  client: ClientInfo;
}

export interface CodeParts {
  firstName: string;
  house: string;
  month: string;
  postcode: string;
}

export interface LabUpload {
  uploadId: string;
  kind: 'archive' | 'screenshot';
  name: string;
  contentType: string;
  size: number;
  platforms?: string[];
  categories?: string[];
  kept?: Record<string, number>;
}

export interface LabDonationPayload {
  participantCode: string;
  uploads: LabUpload[];
  /** The phase of the page the files were sent from. */
  phase: string;
  phone?: string | null;
  /** For screenshots sent with a mid-break check-in: that check-in. */
  checkInId?: string | null;
  client: ClientInfo;
}

export interface LabCheckInPayload {
  participantCode: string;
  formId: string;
  formVersion: string;
  answers: Record<string, string>;
  client: ClientInfo;
}

/** Upper-cased and stripped of anything but letters and digits; null unless it has the questionnaire's shape. */
export function normaliseCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return PARTICIPANT_CODE.test(c) ? c : null;
}

/** The questionnaire's rule, as in the app's src/lab/config.ts: the first two letters of the person's own first name (accents dropped), house number's first digit, birth month, postcode's last two letters. */
export function buildParticipantCode(parts: CodeParts): string {
  const letters = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
  const name = letters(parts.firstName).slice(0, 2);
  const house = parts.house.replace(/\D/g, '').slice(0, 1);
  const month = parts.month.replace(/\D/g, '');
  const postcode = letters(parts.postcode).slice(-2);
  const mm = month.length === 1 ? `0${month}` : month.slice(-2);
  return `${name}${house}${mm}${postcode}`;
}

/** A postcode upper-cased with one space before the inward code ("ls29jt" → "LS2 9JT"). */
export function formatPostcode(input: string): string {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

/** The answers as kept: trimmed, the postcode in its standard form, the month two digits. */
export function normaliseCodeParts(parts: CodeParts): CodeParts {
  const month = parts.month.replace(/\D/g, '');
  return { firstName: parts.firstName.trim(), house: parts.house.trim(), month: month.length === 1 ? `0${month}` : month.slice(-2), postcode: formatPostcode(parts.postcode) };
}

export function validateLabConsentPayload(input: unknown): string[] {
  const problems: string[] = [];
  if (!isObj(input)) return ['The submission is not an object.'];
  const p = input as Partial<LabConsentPayload>;
  const code = normaliseCode(p.participantCode);
  if (!code) problems.push('The participant code is malformed.');
  if (p.codeParts !== null && p.codeParts !== undefined) {
    const cp = p.codeParts;
    if (!isObj(cp) || !str(cp.firstName, 40) || !str(cp.house, 10) || !str(cp.month, 2) || !str(cp.postcode, 10)) problems.push('The code answers are malformed.');
    else {
      if (!UK_POSTCODE.test(formatPostcode(cp.postcode as string))) problems.push('The postcode is not a full UK postcode.');
      if (code && buildParticipantCode(cp as unknown as CodeParts) !== code) problems.push('The participant code does not match the answers it was built from.');
    }
  }
  const c = p.consent;
  if (!isObj(c)) problems.push('The consent record is missing.');
  else {
    if (c.formId !== labConsentForm.id || c.formVersion !== labConsentForm.version) problems.push(`The consent form must be ${labConsentForm.id} ${labConsentForm.version}.`);
    if (c.informationVersion !== labInformationVersion) problems.push(`The information shown must be version ${labInformationVersion}.`);
    validateResponses(c.responses, labConsentForm, problems, 'Consent');
    const responses = isObj(c.responses) ? (c.responses as Record<string, StatementRecord>) : {};
    for (const s of labConsentForm.statements) {
      if (s.kind === 'optional') {
        if (!responses[s.id]) problems.push(`Optional statement "${s.id}" was not answered.`);
      } else if (responses[s.id]?.response !== 'agreed') problems.push(`Statement "${s.id}" was not agreed; it is needed to take part.`);
    }
    if (!str(c.typedName, limits.name) || blank(c.typedName as string)) problems.push('The signer’s name is missing.');
    validateSignature(c.signature, 'Consent', problems);
    if (typeof c.confirmedDate !== 'string' || !ISO_DATE.test(c.confirmedDate) || Date.parse(c.confirmedDate) > Date.now() + 24 * 3600 * 1000) problems.push('The confirmed date is not valid.');
    if (!validTime(c.completedAt)) problems.push('The consent record has no completion time.');
  }
  validateClient(p.client, problems);
  return problems;
}

export function validateLabDonationPayload(input: unknown): string[] {
  const problems: string[] = [];
  if (!isObj(input)) return ['The submission is not an object.'];
  const p = input as Partial<LabDonationPayload>;
  if (!normaliseCode(p.participantCode)) problems.push('The participant code is malformed.');
  if (!Array.isArray(p.uploads)) problems.push('Uploads are malformed.');
  else {
    if (p.uploads.length === 0) problems.push('No files were sent.');
    if (p.uploads.length > labStudy.maxArchives + labStudy.maxScreenshots) problems.push('Too many files in one send.');
    if (p.phone !== null && p.phone !== undefined && !PHONES.includes(String(p.phone))) problems.push('Unknown phone type.');
    if (!PHASES.includes(String(p.phase) as Phase)) problems.push('The phase of the study is missing or unknown.');
    else if (p.phase === 'mid' && p.uploads.some((u) => isObj(u) && u.kind === 'archive')) problems.push('Only screenshots can be sent with a check-in.');
    if (p.checkInId !== null && p.checkInId !== undefined && (typeof p.checkInId !== 'string' || !DOC_ID.test(p.checkInId))) problems.push('The check-in reference is malformed.');
    const seen = new Set<string>();
    for (const u of p.uploads) {
      if (!isObj(u) || typeof u.uploadId !== 'string' || !UUID.test(u.uploadId) || (u.kind !== 'archive' && u.kind !== 'screenshot') || !str(u.name, 200) || !str(u.contentType, 100) || typeof u.size !== 'number' || u.size < 1) {
        problems.push('An upload reference is malformed.');
        continue;
      }
      if (seen.has(u.uploadId)) problems.push('A file was listed twice.');
      seen.add(u.uploadId);
      if (u.kind === 'archive' && u.size > labStudy.maxArchiveBytes) problems.push(`A cleaned file is larger than ${Math.round(labStudy.maxArchiveBytes / 1024 / 1024)} MB.`);
      if (u.kind === 'screenshot' && u.size > 10 * 1024 * 1024) problems.push('A screenshot is larger than 10 MB.');
      if (u.platforms !== undefined && (!Array.isArray(u.platforms) || u.platforms.some((x) => !PLATFORMS.includes(String(x))))) problems.push('An upload names an unknown platform.');
      if (u.categories !== undefined && (!Array.isArray(u.categories) || u.categories.some((x) => !cleaner.categoryIds.includes(String(x))))) problems.push('An upload names an unknown category.');
      if (u.kept !== undefined && (!isObj(u.kept) || Object.values(u.kept).some((v) => typeof v !== 'number'))) problems.push('An upload’s counts are malformed.');
    }
  }
  validateClient(p.client, problems);
  return problems;
}

/** A check-in carries the current form's answers: every required question answered with one of its options, free text within its limit, nothing else. */
export function validateLabCheckInPayload(input: unknown): string[] {
  const problems: string[] = [];
  if (!isObj(input)) return ['The check-in is not an object.'];
  const p = input as Partial<LabCheckInPayload>;
  if (!normaliseCode(p.participantCode)) problems.push('The participant code is malformed.');
  if (p.formId !== labCheckInForm.id || p.formVersion !== labCheckInForm.version) problems.push(`The check-in must be ${labCheckInForm.id} ${labCheckInForm.version}.`);
  if (!isObj(p.answers)) problems.push('The answers are malformed.');
  else {
    const answers = p.answers as Record<string, unknown>;
    const known = new Set(labCheckInForm.questions.map((q) => q.id));
    for (const id of Object.keys(answers)) if (!known.has(id)) problems.push(`Unknown question "${id}".`);
    for (const q of labCheckInForm.questions) {
      const a = answers[q.id];
      if (a === undefined || a === null || a === '') {
        if (q.required) problems.push(`Question "${q.id}" was not answered.`);
        continue;
      }
      if (typeof a !== 'string') problems.push(`The answer to "${q.id}" is malformed.`);
      else if (q.type === 'choice' && !q.options.some((o) => o.value === a)) problems.push(`The answer to "${q.id}" is not one of its options.`);
      else if (q.type === 'text' && a.length > q.maxLength) problems.push(`The answer to "${q.id}" is longer than ${q.maxLength} characters.`);
    }
  }
  validateClient(p.client, problems);
  return problems;
}

/* ── Cleaned archives ──────────────────────────────────────────────────── */

export interface ArchiveManifest {
  cleanedAt: string | null;
  cleaner: string;
  platforms: string[];
  categories: string[];
  kept: Record<string, number>;
  removed: string[];
}

export interface ArchiveFacts {
  /** File names inside the archive, sorted. */
  entries: string[];
  unpackedBytes: number;
  manifest: ArchiveManifest;
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Reads one entry, giving up once the running total passes the cap (a zip bomb is not one of ours). */
function readEntry(entry: JSZip.JSZipObject, cap: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const stream = entry.nodeStream('nodebuffer') as NodeJS.ReadableStream & { destroy?: () => void };
    stream.on('data', (chunk: Buffer) => {
      if (done) return;
      total += chunk.length;
      if (total > cap) {
        done = true;
        stream.destroy?.();
        reject(new RejectedUpload('This file is far larger inside than a cleaned export should be. Please prepare it again.'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', (error) => {
      if (done) return;
      done = true;
      reject(error);
    });
    stream.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    });
  });
}

function parseManifest(text: string): ArchiveManifest {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    throw new RejectedUpload(NOT_OURS);
  }
  if (!isObj(m) || typeof m.cleaner !== 'string' || !m.cleaner.startsWith('MyPhone/MyBrain data donation cleaner')) throw new RejectedUpload(NOT_OURS);
  const platforms = Array.isArray(m.platforms) ? m.platforms.map(String).filter((p) => PLATFORMS.includes(p)) : [];
  if (!platforms.length) throw new RejectedUpload(NOT_OURS);
  const categories = Array.isArray(m.categories) ? m.categories.map(String).filter((c) => cleaner.categoryIds.includes(c)) : [];
  const kept = isObj(m.kept) ? Object.fromEntries(Object.entries(m.kept).filter(([k, v]) => cleaner.categoryIds.includes(k) && typeof v === 'number') as [string, number][]) : {};
  const removed = Array.isArray(m.removed) ? m.removed.filter((s): s is string => typeof s === 'string').slice(0, 40) : [];
  return { cleanedAt: validTime(m.cleanedAt) ? (m.cleanedAt as string) : null, cleaner: m.cleaner.slice(0, 100), platforms, categories, kept, removed };
}

/**
 * Proves a donated archive is what the in-browser cleaner produces and
 * nothing more: a real ZIP within the size limit, holding only the allowed
 * file names, each JSON file parsing, with the cleaner's manifest. The
 * participant chose what to keep on their own device; the server keeps the
 * file as it came and records what the manifest says is inside.
 */
export async function inspectCleanedArchive(buffer: Buffer): Promise<ArchiveFacts> {
  if (buffer.length > labStudy.maxArchiveBytes) throw new RejectedUpload(`This file is larger than ${Math.round(labStudy.maxArchiveBytes / 1024 / 1024)} MB. Untick a large category and prepare it again, or ask the team.`);
  if (buffer.length < 22 || !buffer.subarray(0, 4).equals(ZIP_MAGIC)) throw new RejectedUpload('This file is not a ZIP archive. ' + NOT_OURS);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new RejectedUpload('This ZIP file could not be read. ' + NOT_OURS);
  }
  const allowed = new Set(cleaner.allowedFiles);
  const allowedDirs = new Set<string>();
  for (const file of cleaner.allowedFiles) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i += 1) allowedDirs.add(`${parts.slice(0, i).join('/')}/`);
  }
  const entries: string[] = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    const norm = name.replace(/\\/g, '/');
    if (entry.dir) {
      if (!allowedDirs.has(norm.endsWith('/') ? norm : `${norm}/`)) throw new RejectedUpload(NOT_OURS);
      continue;
    }
    if (!allowed.has(norm)) throw new RejectedUpload(NOT_OURS);
    entries.push(norm);
  }
  if (!entries.includes('manifest.json')) throw new RejectedUpload(NOT_OURS);
  if (entries.length < 2) throw new RejectedUpload('The file holds no data, only a manifest. Tick at least one category before adding it.');
  let unpacked = 0;
  let manifestText = '';
  for (const name of entries.sort()) {
    const data = await readEntry(zip.file(name)!, MAX_UNPACKED - unpacked);
    unpacked += data.length;
    if (name.endsWith('.json')) {
      const text = data.toString('utf8');
      if (name === 'manifest.json') manifestText = text;
      else {
        try {
          JSON.parse(text);
        } catch {
          throw new RejectedUpload(`${name} inside the file is not valid JSON. ` + NOT_OURS);
        }
      }
    }
  }
  return { entries, unpackedBytes: unpacked, manifest: parseManifest(manifestText) };
}

/* ── Functions ─────────────────────────────────────────────────────────── */

function toIso(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}

/** A file name safe to keep: no path, no control characters. */
function safeName(name: string): string {
  return name.replace(/[\\/]/g, '_').replace(/[^\x20-\x7e -￿]/g, '').slice(0, 120) || 'file';
}

async function rateLimitLookups(db: Firestore, uid: string, what = 'lab-lookup', limit = LOOKUPS_PER_HOUR): Promise<void> {
  const ref = db.collection('ratelimits').doc(`${what}-${uid}`);
  const allowed = await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    const now = Date.now();
    const sameWindow = typeof current?.windowStart === 'number' && now - current.windowStart < 3600_000;
    const windowStart = sameWindow ? (current!.windowStart as number) : now;
    const count = sameWindow ? Number(current?.count ?? 0) + 1 : 1;
    tx.set(ref, { windowStart, count, updatedAt: FieldValue.serverTimestamp() });
    return count <= limit;
  });
  if (!allowed) throw new HttpsError('failed-precondition', 'Too many attempts from this device. Please wait an hour and try again.');
}

/**
 * Records an adult participant's consent against their code. A second
 * consent for the same code (for example after "that isn't me", or from a
 * new device) is appended as a new version pointing at the one before.
 */
export const submitLabConsent = onCall(callOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const problems = validateLabConsentPayload(request.data);
  if (problems.length) {
    logger.warn('Rejected lab consent', { uid, problems });
    throw new HttpsError('invalid-argument', problems[0], { problems });
  }
  const payload = request.data as LabConsentPayload;
  const code = normaliseCode(payload.participantCode)!;
  const db = getFirestore();
  const receivedAt = new Date();
  const participantRef = db.collection('labParticipants').doc(code);
  const previous = (await participantRef.get()).data() ?? null;
  const version = Number(previous?.consentVersion ?? 0) + 1;
  const consentRef = db.collection('labConsents').doc();
  const sig = payload.consent.signature;
  const stored = sig?.method === 'drawn' && sig.imageDataUrl ? await storeSignature(`lab/${code}`, consentRef.id, sig.imageDataUrl) : null;

  const batch = db.batch();
  batch.set(consentRef, {
    studyId: labStudy.studyId,
    participantCode: code,
    version,
    supersedes: (previous?.consentId as string | undefined) ?? null,
    formId: payload.consent.formId,
    formVersion: payload.consent.formVersion,
    informationVersion: payload.consent.informationVersion,
    responses: payload.consent.responses,
    typedName: payload.consent.typedName.trim(),
    signature: signatureRecord(sig, stored),
    confirmedDate: payload.consent.confirmedDate,
    completedAt: payload.consent.completedAt,
    codeParts: payload.codeParts ? normaliseCodeParts(payload.codeParts) : null,
    sessionUid: uid,
    client: payload.client,
    receivedAt,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(
    participantRef,
    {
      studyId: labStudy.studyId,
      participantCode: code,
      consentId: consentRef.id,
      consentVersion: version,
      consentedAt: previous?.consentedAt ?? receivedAt,
      lastConsentAt: receivedAt,
      sessionUids: FieldValue.arrayUnion(uid),
      ...(previous ? { updatedAt: FieldValue.serverTimestamp() } : { archiveCount: 0, screenshotCount: 0, phaseCounts: emptyPhases(), donationIds: [], checkInCount: 0, checkInIds: [], createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  );
  await batch.commit();
  logger.info(version > 1 ? 'Lab consent amended' : 'Lab consent recorded', { participantCode: code, consentId: consentRef.id, version });
  return { participantCode: code, consentId: consentRef.id, receivedAt: receivedAt.toISOString(), version };
});

/** Whether a code already has consent on file, so someone can carry on from another device. Rate-limited per session. */
export const lookupLabParticipant = onCall(callOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const code = normaliseCode((request.data as { participantCode?: unknown } | undefined)?.participantCode);
  if (!code) throw new HttpsError('invalid-argument', 'The participant code is malformed.');
  const db = getFirestore();
  await rateLimitLookups(db, uid);
  const participant = (await db.collection('labParticipants').doc(code).get()).data();
  if (!participant?.consentId) return { exists: false, consentedAt: null, archives: 0, screenshots: 0, phases: emptyPhases(), checkIns: 0, lastCheckInAt: null, platformsNotUsed: [] };
  // Which apps' data has arrived in each phase, so the pages can tick them off on any device.
  const phases = phaseCountsOf(participant);
  const donations = await db.collection('labDonations').where('participantCode', '==', code).get();
  const seen: Record<Phase, Set<string>> = { pre: new Set(), mid: new Set(), post: new Set() };
  for (const d of donations.docs) {
    const phase = (d.data().phase ?? 'pre') as Phase;
    for (const f of (d.data().files ?? []) as DocumentData[]) for (const pl of (f.platforms ?? []) as string[]) seen[phase]?.add(pl);
  }
  return {
    exists: true,
    consentedAt: toIso(participant.consentedAt),
    archives: Number(participant.archiveCount ?? 0),
    screenshots: Number(participant.screenshotCount ?? 0),
    phases: Object.fromEntries(PHASES.map((ph) => [ph, { ...phases[ph], platforms: Array.from(seen[ph]).sort() }])),
    checkIns: Number(participant.checkInCount ?? 0),
    lastCheckInAt: toIso(participant.lastCheckInAt),
    platformsNotUsed: notUsedOf(participant),
  };
});

/** The apps a participant has said they do not use. */
export function notUsedOf(participant: DocumentData): string[] {
  return Array.isArray(participant.platformsNotUsed) ? (participant.platformsNotUsed as unknown[]).map(String).filter((p) => PLATFORMS.includes(p)).sort() : [];
}

export function validateLabPlatformsPayload(input: unknown): string[] {
  const problems: string[] = [];
  if (!isObj(input)) return ['The request is not an object.'];
  if (!normaliseCode(input.participantCode)) problems.push('The participant code is malformed.');
  const apps = input.notUsed;
  if (!Array.isArray(apps) || apps.length > PLATFORMS.length || apps.some((x) => !PLATFORMS.includes(String(x))) || new Set(apps).size !== apps.length) problems.push('The list of apps is malformed.');
  return problems;
}

/**
 * Records the apps a participant does not use (the whole list each time), so
 * the pages grey them out and stop asking for their data. Sending an app's
 * data later takes it off the list again.
 */
export const updateLabPlatforms = onCall(callOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const problems = validateLabPlatformsPayload(request.data);
  if (problems.length) throw new HttpsError('invalid-argument', problems[0], { problems });
  const { participantCode, notUsed } = request.data as { participantCode: string; notUsed: string[] };
  const code = normaliseCode(participantCode)!;
  const db = getFirestore();
  await rateLimitLookups(db, uid, 'lab-platforms', PLATFORM_UPDATES_PER_HOUR);
  const ref = db.collection('labParticipants').doc(code);
  const participant = (await ref.get()).data();
  if (!participant?.consentId) throw new HttpsError('failed-precondition', 'We have no consent on file for this participant code. Please check the code.');
  const apps = Array.from(new Set(notUsed.map(String))).sort();
  await ref.set({ platformsNotUsed: apps, platformsNotUsedAt: new Date(), sessionUids: FieldValue.arrayUnion(uid), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  logger.info('Lab apps not used', { participantCode: code, notUsed: apps });
  return { notUsed: apps };
});

type PhaseCounts = Record<Phase, { archives: number; screenshots: number }>;
const emptyPhases = (): PhaseCounts => ({ pre: { archives: 0, screenshots: 0 }, mid: { archives: 0, screenshots: 0 }, post: { archives: 0, screenshots: 0 } });

/** Files received by phase. Rows from before phases were counted hold only totals, all of which came from the first page. */
export function phaseCountsOf(participant: DocumentData): PhaseCounts {
  const out = emptyPhases();
  const stored = isObj(participant.phaseCounts) ? (participant.phaseCounts as Record<string, DocumentData>) : null;
  if (!stored) {
    out.pre = { archives: Number(participant.archiveCount ?? 0), screenshots: Number(participant.screenshotCount ?? 0) };
    return out;
  }
  for (const phase of PHASES) out[phase] = { archives: Number(stored[phase]?.archives ?? 0), screenshots: Number(stored[phase]?.screenshots ?? 0) };
  return out;
}

interface StoredLabFile {
  uploadId: string;
  kind: 'archive' | 'screenshot';
  path: string;
  name: string;
  contentType: string;
  bytes: number;
  sha256: string;
  platforms: string[] | null;
  categories: string[] | null;
  kept: Record<string, number> | null;
  manifest: ArchiveManifest | null;
  entries: string[] | null;
  unpackedBytes: number | null;
  width: number | null;
  height: number | null;
  quality: Quality | null;
}

/** Moves one upload out of the lab quarantine into lab/{code}/, checked; anything refused is deleted, never stored. */
async function acceptLabUpload(uid: string, code: string, upload: LabUpload): Promise<StoredLabFile> {
  const bucket = getStorage().bucket();
  const source = bucket.file(`${LAB_QUARANTINE}/${uid}/${upload.uploadId}`);
  const [exists] = await source.exists();
  if (!exists) throw new RejectedUpload('This file was not uploaded correctly. Please add it again.');
  const [original] = await source.download();
  try {
    const save = (path: string, data: Buffer, contentType: string) => bucket.file(path).save(data, { contentType, resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
    const base = { uploadId: upload.uploadId, name: safeName(upload.name) };
    if (upload.kind === 'archive') {
      const facts = await inspectCleanedArchive(original);
      const path = `lab/${code}/${upload.uploadId}.zip`;
      await save(path, original, 'application/zip');
      return { ...base, kind: 'archive', path, contentType: 'application/zip', bytes: original.length, sha256: sha256(original), platforms: facts.manifest.platforms, categories: facts.manifest.categories, kept: facts.manifest.kept, manifest: facts.manifest, entries: facts.entries, unpackedBytes: facts.unpackedBytes, width: null, height: null, quality: null };
    }
    const image = await cleanImage(original);
    const quality = await checkImage(image, false, { uploadId: upload.uploadId });
    if (quality.verdict === 'rejected') throw new RejectedUpload(quality.familyReason ?? 'This image could not be accepted.', quality);
    const path = `lab/${code}/${upload.uploadId}.${image.ext}`;
    await save(path, image.data, image.contentType);
    return { ...base, kind: 'screenshot', path, contentType: image.contentType, bytes: image.data.length, sha256: image.sha256, platforms: null, categories: null, kept: null, manifest: null, entries: null, unpackedBytes: null, width: image.width, height: image.height, quality };
  } finally {
    await source.delete({ ignoreNotFound: true });
  }
}

/**
 * Records cleaned archives and screenshots against a code that has consent
 * on file. Each file is checked (archives: only the cleaner's files inside;
 * screenshots: a real image, re-encoded without metadata and run through the
 * quality checks) and stored under lab/{code}/. Anything refused is reported
 * back with a reason and not kept.
 */
export const submitLabDonation = onCall(callOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const problems = validateLabDonationPayload(request.data);
  if (problems.length) {
    logger.warn('Rejected lab donation', { uid, problems });
    throw new HttpsError('invalid-argument', problems[0], { problems });
  }
  const payload = request.data as LabDonationPayload;
  const code = normaliseCode(payload.participantCode)!;
  const db = getFirestore();
  const receivedAt = new Date();
  const participantRef = db.collection('labParticipants').doc(code);
  const participant = (await participantRef.get()).data();
  if (!participant?.consentId) throw new HttpsError('failed-precondition', 'We have no consent on file for this participant code. Please give your consent first.');
  const phase = payload.phase as Phase;
  const archives = payload.uploads.filter((u) => u.kind === 'archive').length;
  const screenshots = payload.uploads.length - archives;
  const already = phaseCountsOf(participant)[phase];
  const maxShots = phase === 'mid' ? labStudy.maxCheckInScreenshots : labStudy.maxScreenshots;
  if (already.archives + archives > labStudy.maxArchives) throw new HttpsError('invalid-argument', `At most ${labStudy.maxArchives} cleaned files can be sent ${phase === 'post' ? 'after the break' : 'before the break'}. Contact the team if you need to send more.`);
  if (already.screenshots + screenshots > maxShots) throw new HttpsError('invalid-argument', `At most ${maxShots} screenshots can be sent ${phase === 'mid' ? 'with the check-ins' : phase === 'post' ? 'after the break' : 'before the break'}. Contact the team if you need to send more.`);
  if (payload.checkInId) {
    const checkIn = (await db.collection('labCheckIns').doc(payload.checkInId).get()).data();
    if (!checkIn || checkIn.participantCode !== code) throw new HttpsError('invalid-argument', 'That check-in does not belong to this participant code.');
  }
  // The study's minimum (a screenshot plus a cleaned archive) is asked for twice in the app, then may be skipped; the send records what came.

  const stored: StoredLabFile[] = [];
  const rejected: { uploadId: string; reason: string }[] = [];
  for (const upload of payload.uploads) {
    try {
      stored.push(await acceptLabUpload(uid, code, upload));
    } catch (error) {
      if (!(error instanceof RejectedUpload)) throw error;
      rejected.push({ uploadId: upload.uploadId, reason: error.reason });
      logger.warn('Lab file rejected', { participantCode: code, uploadId: upload.uploadId, kind: upload.kind, reasons: error.quality?.reasons ?? [error.reason] });
    }
  }

  let donationId: string | null = null;
  // Sending an app's data means the person uses it: it comes off their "not used" list.
  const sentPlatforms = Array.from(new Set(stored.flatMap((f) => f.platforms ?? [])));
  if (stored.length) {
    const batch = db.batch();
    const ref = db.collection('labDonations').doc();
    donationId = ref.id;
    batch.set(ref, {
      studyId: labStudy.studyId,
      participantCode: code,
      files: stored,
      archives: stored.filter((f) => f.kind === 'archive').length,
      screenshots: stored.filter((f) => f.kind === 'screenshot').length,
      needsReview: stored.some((f) => f.quality?.verdict === 'review'),
      phase: payload.phase,
      phone: payload.phone ?? null,
      checkInId: payload.checkInId ?? null,
      sessionUid: uid,
      client: payload.client,
      receivedAt,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(
      participantRef,
      {
        donationIds: FieldValue.arrayUnion(donationId),
        archiveCount: FieldValue.increment(stored.filter((f) => f.kind === 'archive').length),
        screenshotCount: FieldValue.increment(stored.filter((f) => f.kind === 'screenshot').length),
        // Rows from before phases were counted start from their totals, all from the first page.
        phaseCounts: participant.phaseCounts
          ? { [phase]: { archives: FieldValue.increment(stored.filter((f) => f.kind === 'archive').length), screenshots: FieldValue.increment(stored.filter((f) => f.kind === 'screenshot').length) } }
          : (() => {
              const next = phaseCountsOf(participant);
              next[phase] = { archives: next[phase].archives + stored.filter((f) => f.kind === 'archive').length, screenshots: next[phase].screenshots + stored.filter((f) => f.kind === 'screenshot').length };
              return next;
            })(),
        lastDonationAt: receivedAt,
        lastPhase: payload.phase,
        ...(sentPlatforms.length ? { platformsNotUsed: FieldValue.arrayRemove(...sentPlatforms) } : {}),
        ...(payload.phone ? { phone: payload.phone } : {}),
        sessionUids: FieldValue.arrayUnion(uid),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await batch.commit();
    await settleReminder(db, code, receivedAt, phase);
  }
  logger.info('Lab files recorded', { participantCode: code, donationId, accepted: stored.length, rejected: rejected.length });
  return { donationId, receivedAt: receivedAt.toISOString(), accepted: stored.map((f) => f.uploadId), rejected };
});

/**
 * A mid-break check-in: the answers to the current check-in questions,
 * filed under a code with consent on file. Any screenshots follow through
 * submitLabDonation (phase mid) carrying the check-in's id.
 */
export const submitLabCheckIn = onCall(callOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const problems = validateLabCheckInPayload(request.data);
  if (problems.length) {
    logger.warn('Rejected lab check-in', { uid, problems });
    throw new HttpsError('invalid-argument', problems[0], { problems });
  }
  const payload = request.data as LabCheckInPayload;
  const code = normaliseCode(payload.participantCode)!;
  const db = getFirestore();
  await rateLimitLookups(db, uid, 'lab-checkin', CHECKINS_PER_HOUR);
  const participantRef = db.collection('labParticipants').doc(code);
  const participant = (await participantRef.get()).data();
  if (!participant?.consentId) throw new HttpsError('failed-precondition', 'We have no consent on file for this participant code. Please check the code.');
  const receivedAt = new Date();
  const ref = db.collection('labCheckIns').doc();
  const count = Number(participant.checkInCount ?? 0) + 1;
  const batch = db.batch();
  batch.set(ref, {
    studyId: labStudy.studyId,
    participantCode: code,
    number: count,
    formId: payload.formId,
    formVersion: payload.formVersion,
    answers: Object.fromEntries(Object.entries(payload.answers).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => [k, String(v).trim()])),
    sessionUid: uid,
    client: payload.client,
    receivedAt,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(participantRef, { checkInIds: FieldValue.arrayUnion(ref.id), checkInCount: FieldValue.increment(1), lastCheckInAt: receivedAt, sessionUids: FieldValue.arrayUnion(uid), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  logger.info('Lab check-in recorded', { participantCode: code, checkInId: ref.id, number: count });
  return { checkInId: ref.id, receivedAt: receivedAt.toISOString(), count };
});

export type { DocumentData };

/* ── Progress emails ───────────────────────────────────────────────────── */

export interface LabProgress {
  participantCode: string;
  consentedAt: string | null;
  /** The page the email is about: before the break (pre) or after it (post). */
  phase: 'pre' | 'post';
  screenshots: number;
  archives: number;
  /** The apps whose data has arrived for this page. */
  platforms: string[];
  /** The apps the participant has said they do not use. */
  notUsed: string[];
}

/** What a participant still owes for this page, in plain words; empty when everything is in: each app they use is sent or set aside. */
export function outstanding(p: LabProgress): string[] {
  const out: string[] = [];
  if (!p.consentedAt) out.push('your consent');
  if (!p.screenshots) out.push('screenshots of your phone’s screen-time summary');
  const remaining = appsToCome(p);
  if (remaining.length) out.push(`your ${list(remaining.map((pl) => PLATFORM_NAMES[pl]))} data`);
  return out;
}

/** The apps whose data has neither arrived nor been set aside as not used. */
export function appsToCome(p: LabProgress): string[] {
  return PLATFORMS.filter((pl) => !p.platforms.includes(pl) && !p.notUsed.includes(pl));
}

/** Said whenever apps are still to come: not using one is a fine answer, given on the page. */
const notUsedNote = (p: LabProgress) => (appsToCome(p).length ? `If you don’t use ${appsToCome(p).length === 1 ? 'that app' : 'one of these apps'}, open the page and press “I don’t use it”, and we will stop asking for it.` : '');

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const whenOf = (p: LabProgress) => (p.phase === 'post' ? 'after your break' : 'before your break');

/** The email sent when someone presses "I'll come back later": where they are and how to carry on. */
export function labStatusEmail(p: LabProgress): { subject: string; text: string } {
  const owed = outstanding(p);
  const link = pageFor(p.phase, p.participantCode);
  const received = [p.screenshots ? plural(p.screenshots, 'screen-time screenshot', 'screen-time screenshots') : '', p.archives ? `${plural(p.archives, 'cleaned file', 'cleaned files')}${p.platforms.length ? ` (${p.platforms.map((pl) => PLATFORM_NAMES[pl] ?? pl).join(', ')})` : ''}` : ''].filter(Boolean);
  const text = [
    `Hello,`,
    ``,
    `Thank you for taking part in the ${labStudy.name}. Here is where your data donation ${whenOf(p)} stands.`,
    ``,
    `Participant code: ${p.participantCode}`,
    `Consent: ${p.consentedAt ? `recorded on ${p.consentedAt.slice(0, 10)}` : 'not yet given'}`,
    `Received so far: ${received.length ? list(received) : 'nothing yet'}`,
    owed.length ? `Still to come: ${list(owed)}.` : `Everything the study needs is in. Thank you!`,
    ...(notUsedNote(p) ? [notUsedNote(p)] : []),
    ``,
    owed.length
      ? [
          `When your data download arrives, open the link below on the device that has the file. It opens the right page with your participant code filled in, so you carry on from where you left off; the guide there shows every step.`,
          link,
          ``,
          `If we have not received your files in two days, we will send one reminder.`,
        ].join('\n')
      : `If more data arrives later, you can add it here: ${link}`,
    ``,
    `What you have sent is kept and used in the research unless you contact us to withdraw.`,
    `Questions? Reply to this email or write to ${labStudy.contactName} at ${labStudy.contactEmail}.`,
    ``,
    `The MyPhone/MyBrain team, University of Leeds`,
  ].join('\n');
  return { subject: `MyPhone/MyBrain: your data donation so far (${p.participantCode})`, text };
}

/** The one follow-up, two days on, when the files have not arrived. */
export function labFollowUpEmail(p: LabProgress): { subject: string; text: string } {
  const owed = outstanding(p);
  const text = [
    `Hello,`,
    ``,
    `A quick reminder from the ${labStudy.name}: we have not yet received ${list(owed)} from ${whenOf(p)} for participant code ${p.participantCode}.`,
    ``,
    `If your data download has arrived, open the link below on the device that has the file and follow the steps; your participant code is filled in for you. If it has not arrived yet, or anything is unclear, reply to this email and we will help.`,
    pageFor(p.phase, p.participantCode),
    ...(notUsedNote(p) ? [``, notUsedNote(p)] : []),
    ``,
    `This is the only reminder we will send.`,
    ``,
    `Questions? Reply to this email or write to ${labStudy.contactName} at ${labStudy.contactEmail}.`,
    ``,
    `The MyPhone/MyBrain team, University of Leeds`,
  ].join('\n');
  return { subject: `MyPhone/MyBrain: a reminder about your data (${p.participantCode})`, text };
}

export function validateLabReminderPayload(input: unknown): string[] {
  const problems: string[] = [];
  if (!isObj(input)) return ['The request is not an object.'];
  if (!normaliseCode(input.participantCode)) problems.push('The participant code is malformed.');
  if (!str(input.email, 254) || !EMAIL.test(String(input.email).trim())) problems.push('Enter an email address in the format name@example.com.');
  if (input.phase !== undefined && input.phase !== 'pre' && input.phase !== 'post') problems.push('Reminders are for the files before or after the break.');
  return problems;
}

/** Where a code stands for one page: consent, and the files of that phase. */
async function progressOf(db: Firestore, code: string, phase: 'pre' | 'post'): Promise<LabProgress | null> {
  const participant = (await db.collection('labParticipants').doc(code).get()).data();
  if (!participant?.consentId) return null;
  const donations = await db.collection('labDonations').where('participantCode', '==', code).get();
  const platforms = new Set<string>();
  let screenshots = 0;
  let archives = 0;
  for (const d of donations.docs) {
    // Sends from before phases were recorded all came from the first page.
    if ((d.data().phase ?? 'pre') !== phase) continue;
    for (const f of (d.data().files ?? []) as DocumentData[]) {
      if (f.kind === 'archive') archives += 1;
      else screenshots += 1;
      for (const pl of (f.platforms ?? []) as string[]) platforms.add(pl);
    }
  }
  return { participantCode: code, consentedAt: toIso(participant.consentedAt), phase, screenshots, archives, platforms: Array.from(platforms).sort(), notUsed: notUsedOf(participant) };
}

/**
 * "I'll come back later": emails the participant where they are and a link
 * back, and books one follow-up for two days later unless files arrive first.
 * The address is kept only for that, in labReminders (identifying).
 */
export const requestLabReminder = onCall(callOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const problems = validateLabReminderPayload(request.data);
  if (problems.length) throw new HttpsError('invalid-argument', problems[0], { problems });
  const { participantCode, email, phase: asked } = request.data as { participantCode: string; email: string; phase?: 'pre' | 'post' };
  const phase = asked ?? 'pre';
  const code = normaliseCode(participantCode)!;
  const db = getFirestore();
  await rateLimitLookups(db, uid, 'lab-reminder', REMINDERS_PER_HOUR);
  const progress = await progressOf(db, code, phase);
  if (!progress) throw new HttpsError('failed-precondition', 'We have no consent on file for this participant code. Please give your consent first.');
  const now = new Date();
  const outcome = await sendMail({ to: email.trim(), replyTo: labStudy.contactEmail, ...labStatusEmail(progress) });
  const followUpDueAt = new Date(now.getTime() + FOLLOW_UP_AFTER_MS);
  await db
    .collection('labReminders')
    .doc(code)
    .set({ participantCode: code, email: email.trim(), phase, requestedAt: now, statusOutcome: outcome, followUpDueAt, followUpSentAt: null, followUpOutcome: null, completedAt: null, sessionUid: uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  logger.info('Lab progress email', { participantCode: code, phase, outcome });
  return { outcome, followUpAt: followUpDueAt.toISOString() };
});

/** Marks a participant's reminder as done once files for its page arrive, so no follow-up goes. */
export async function settleReminder(db: Firestore, code: string, receivedAt: Date, phase: string): Promise<void> {
  const ref = db.collection('labReminders').doc(code);
  const snap = await ref.get();
  const r = snap.data();
  if (snap.exists && !r?.completedAt && (r?.phase ?? 'pre') === phase) await ref.set({ completedAt: receivedAt, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** Every hour: send the follow-up to anyone whose two days are up and whose files have not arrived. */
export const labFollowUps = onSchedule({ region: REGION, schedule: 'every 60 minutes', timeZone: 'Europe/London' }, async () => {
  await runFollowUps();
});

export async function runFollowUps(now = new Date()): Promise<{ sent: number; settled: number }> {
  const db = getFirestore();
  const due = await db.collection('labReminders').where('followUpSentAt', '==', null).where('completedAt', '==', null).where('followUpDueAt', '<=', now).get();
  let sent = 0;
  let settled = 0;
  for (const doc of due.docs) {
    const r = doc.data();
    const code = String(r.participantCode);
    const progress = await progressOf(db, code, r.phase === 'post' ? 'post' : 'pre');
    const requestedAt = r.requestedAt instanceof Timestamp ? r.requestedAt.toDate() : new Date(String(r.requestedAt));
    const since = await db.collection('labDonations').where('participantCode', '==', code).where('receivedAt', '>', requestedAt).get();
    const arrived = since.docs.some((d) => (d.data().phase ?? 'pre') === (r.phase === 'post' ? 'post' : 'pre'));
    if (!progress || arrived || !outstanding(progress).length) {
      await doc.ref.set({ completedAt: now, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      settled += 1;
      continue;
    }
    const outcome = await sendMail({ to: String(r.email), replyTo: labStudy.contactEmail, ...labFollowUpEmail(progress) });
    await doc.ref.set({ followUpSentAt: now, followUpOutcome: outcome, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    sent += 1;
  }
  logger.info('Lab follow-ups', { sent, settled });
  return { sent, settled };
}
