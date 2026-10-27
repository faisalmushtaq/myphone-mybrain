import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { redactOptedOutPupils } from './schoolRedact.js';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual, type BinaryLike, type ScryptOptions } from 'node:crypto';
import { schools, type SchoolEntry } from './forms.js';
import { sha256 } from './images.js';
import { schoolUploadLink } from './links.js';
import { sendMail, sendTeamMail } from './mail.js';
import { fileKind, pupilsFrom, readTable, TableError, type Pupil, type PupilList } from './tables.js';
import { isObj, str, validateClient, type ClientInfo } from './validate.js';

/**
 * Schools send the UPNs of the classes taking part, so the study can match
 * each pupil's records here with the school's. Each school has its own
 * upload page (myphonemybrain.com/schools/upload/?school=<slug>) and a
 * password the team gives it (made on the staff page; only a hash is kept).
 * The school checks what was read from its file before sending it.
 *
 *   schoolUploadAccess/{slug}  the school's password hash, when it was set, whether it works
 *   schoolUploads/{id}         one per file: who sent it, what was read (UPN, names, date
 *                              of birth, year group, class), and any problems (identifying)
 *   Storage schoolupns/{slug}/{id}/<file name>   the file exactly as sent
 *
 * The export copies both into schools/upn-uploads/, a folder of its own, and
 * matches the UPNs with the families' records there (export.ts).
 */

const REGION = 'europe-west2';
const callOptions = { region: REGION, memory: '1GiB' as const, timeoutSeconds: 300, enforceAppCheck: process.env.MPMB_ENFORCE_APP_CHECK === 'true' };
/** Up to 50 MB (19 October 2026; it was 7 MB). */
export const MAX_BYTES = 50 * 1024 * 1024;
/** Up to 7 MB a file can come in the request itself, which Google caps at 10 MB once encoded; a larger one goes to Storage first (SCHOOL_QUARANTINE). */
const INLINE_MAX_BYTES = 7 * 1024 * 1024;
/** Where the browser puts a large file before the function reads it: schoolquarantine/{uid}/{uploadId}, its own session's only, deleted once sent or after a day (purgeQuarantine). */
export const SCHOOL_QUARANTINE = 'schoolquarantine';
const TOO_BIG = 'The file is larger than 50 MB. A class list should be much smaller: if it is a Word or PDF file with pictures, save it as Excel or CSV instead.';
const UPLOAD_ID = /^[0-9a-f-]{36}$/;
const MAX_PUPILS = 3000;
/** Wrong passwords allowed in an hour, from one browser and for one school. */
const FAILURES_PER_SESSION = 10;
const FAILURES_PER_SCHOOL = 25;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SCRYPT: ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const scryptAsync = (password: BinaryLike, salt: BinaryLike, keylen: number) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password, salt, keylen, SCRYPT, (error, key) => (error ? reject(error) : resolve(key))));

export const schoolBySlug = (slug: unknown): SchoolEntry | undefined => (typeof slug === 'string' ? schools.find((s) => s.slug === slug.trim().toLowerCase()) : undefined);

/** A new password for a school: twelve characters in three groups, with no letters or digits that look alike. */
export function newSchoolPassword(): string {
  const pick = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${pick()}-${pick()}-${pick()}`;
}

/** As typed: case, spaces and dashes do not matter. */
export const normalisePassword = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function hashPassword(password: string, salt = randomBytes(16)): Promise<{ hash: string; salt: string }> {
  const key = await scryptAsync(normalisePassword(password), salt, 32);
  return { hash: key.toString('hex'), salt: salt.toString('hex') };
}

export async function passwordMatches(password: string, stored: { hash: string; salt: string }): Promise<boolean> {
  const key = await scryptAsync(normalisePassword(password), Buffer.from(stored.salt, 'hex'), 32);
  const want = Buffer.from(stored.hash, 'hex');
  return want.length === key.length && timingSafeEqual(want, key);
}

/** Sets a new password for a school (any earlier one stops working) and returns it, the only time it is shown. */
export async function setSchoolPassword(db: Firestore, school: SchoolEntry): Promise<{ password: string; link: string }> {
  const password = newSchoolPassword();
  const { hash, salt } = await hashPassword(password);
  await db.collection('schoolUploadAccess').doc(school.slug).set({ schoolId: school.id, slug: school.slug, hash, salt, active: true, setAt: new Date(), revokedAt: null });
  logger.info('School upload password set', { school: school.slug });
  return { password, link: schoolUploadLink(school.slug) };
}

/** Checks (add false) or counts (add true) a failed attempt in this hour; true while still within the limit. */
export async function countFailure(db: Firestore, key: string, limit: number, add: boolean): Promise<boolean> {
  const ref = db.collection('ratelimits').doc(key);
  return db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    const now = Date.now();
    const sameWindow = typeof current?.windowStart === 'number' && now - current.windowStart < 3600_000;
    const count = sameWindow ? Number(current?.count ?? 0) : 0;
    if (add) tx.set(ref, { windowStart: sameWindow ? current!.windowStart : now, count: count + 1, updatedAt: FieldValue.serverTimestamp() });
    return count + (add ? 1 : 0) <= limit;
  });
}

/** Lets the request through only with the school's current password; wrong guesses are limited per browser and per school. */
async function checkPassword(db: Firestore, uid: string, school: SchoolEntry, password: unknown): Promise<void> {
  const keys = [`school-fail-${school.slug}`, `school-fail-uid-${uid}`];
  const limits = [FAILURES_PER_SCHOOL, FAILURES_PER_SESSION];
  const open = await Promise.all(keys.map((k, i) => countFailure(db, k, limits[i], false)));
  if (open.includes(false)) throw new HttpsError('failed-precondition', 'Too many wrong passwords. Please wait an hour, or ask the research team for help.');
  const access = (await db.collection('schoolUploadAccess').doc(school.slug).get()).data();
  if (!access?.active || typeof access.hash !== 'string') throw new HttpsError('failed-precondition', 'Uploads are not open for this school yet. Please ask the research team for a password.');
  const ok = typeof password === 'string' && password.length <= 40 && (await passwordMatches(password, { hash: access.hash, salt: String(access.salt) }));
  if (!ok) {
    await Promise.all(keys.map((k, i) => countFailure(db, k, limits[i], true)));
    throw new HttpsError('failed-precondition', 'That password is not right. Check it against the one the research team gave you; capitals and dashes do not matter.');
  }
}

export interface SchoolUploadPayload {
  school: string;
  password: string;
  action: 'check' | 'preview' | 'send';
  /** The file itself (`data`, base64, up to 7 MB), or the id of the copy the browser put in Storage (`uploadId`). */
  file?: { name: string; contentType: string; data?: string; uploadId?: string };
  uploader?: { name: string; role: string; email: string };
  note?: string;
  client: ClientInfo;
}

export function validateSchoolUploadPayload(input: unknown): string[] {
  const problems: string[] = [];
  if (!isObj(input)) return ['The request is not an object.'];
  const p = input as Partial<SchoolUploadPayload>;
  if (!schoolBySlug(p.school)) problems.push('This link does not name a school taking part. Please check the link the research team sent.');
  if (!str(p.password, 40)) problems.push('Enter the password the research team gave you.');
  if (!['check', 'preview', 'send'].includes(String(p.action))) problems.push('Unknown action.');
  if (p.action === 'preview' || p.action === 'send') {
    const f = p.file;
    if (!isObj(f) || !str(f.name, 200) || !str(f.contentType, 120) || (typeof f.data !== 'string' && !(typeof f.uploadId === 'string' && UPLOAD_ID.test(f.uploadId)))) problems.push('Choose a file to upload.');
    else if (typeof f.data === 'string' && f.data.length > Math.ceil((INLINE_MAX_BYTES * 4) / 3) + 8) problems.push(TOO_BIG);
  }
  if (p.action === 'send') {
    const u = p.uploader;
    if (!isObj(u) || !str(u.name, 100) || !u.name.trim()) problems.push('Enter your name.');
    else {
      if (!str(u.role, 100)) problems.push('Your role is malformed.');
      if (!str(u.email, 254) || !EMAIL.test(u.email.trim())) problems.push('Enter your school email address, so we can confirm we received the file.');
    }
    if (p.note !== undefined && !str(p.note, 1000)) problems.push('Please keep the note under 1,000 characters.');
  }
  validateClient(p.client, problems);
  return problems;
}

/** What the page shows before sending: the columns found, the first rows, the problems. */
export function previewOf(list: PupilList) {
  return {
    columns: list.columns,
    ignored: list.ignored,
    pupils: list.pupils.length,
    valid: list.valid,
    sample: list.pupils.slice(0, 8).map((x) => ({ row: x.row, upn: x.upn, firstName: x.firstName, lastName: x.lastName, dateOfBirth: x.dateOfBirth })),
    noHeadings: Boolean(list.noHeadings),
    problems: list.problems.slice(0, 50),
    problemCount: list.problems.length,
  };
}

const safeName = (name: string) => name.replace(/[\\/]/g, '_').replace(/[^A-Za-z0-9 ._()-]/g, '').trim().slice(0, 120) || 'upload';

export const schoolUpload = onCall({ ...callOptions }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const problems = validateSchoolUploadPayload(request.data);
  if (problems.length) throw new HttpsError('invalid-argument', problems[0], { problems });
  const p = request.data as SchoolUploadPayload;
  const school = schoolBySlug(p.school)!;
  const db = getFirestore();
  await checkPassword(db, uid, school, p.password);
  const earlier = await db.collection('schoolUploads').where('schoolSlug', '==', school.slug).get();
  if (p.action === 'check') return { school: { slug: school.slug, name: school.name }, uploads: earlier.size, lastUploadAt: earlier.docs.map((d) => d.data().receivedAt?.toDate?.()?.toISOString?.() ?? null).filter(Boolean).sort().pop() ?? null };

  const staged = p.file!.uploadId ? getStorage().bucket().file(`${SCHOOL_QUARANTINE}/${uid}/${p.file!.uploadId}`) : null;
  let buffer: Buffer;
  if (staged) {
    const [exists] = await staged.exists();
    if (!exists) throw new HttpsError('failed-precondition', 'The file did not arrive. Please choose it again.');
    const [meta] = await staged.getMetadata();
    if (Number(meta.size ?? 0) > MAX_BYTES) throw new HttpsError('invalid-argument', TOO_BIG);
    [buffer] = await staged.download();
  } else buffer = Buffer.from(p.file!.data ?? '', 'base64');
  if (!buffer.length) throw new HttpsError('invalid-argument', 'The file is empty.');
  if (buffer.length > MAX_BYTES) throw new HttpsError('invalid-argument', TOO_BIG);
  // Read what can be read. A file that cannot be read automatically (an older .xls or .doc, a scan, a list in a form we
  // do not recognise) is never turned away: it is kept as sent and the team reads it by hand (19 October 2026).
  let list: PupilList | null = null;
  let unreadable: string | null = null;
  try {
    list = pupilsFrom(await readTable(buffer, p.file!.name));
  } catch (error) {
    unreadable = error instanceof TableError ? error.message : 'This file could not be read automatically.';
    if (!(error instanceof TableError)) logger.warn('School upload could not be read', { school: school.slug, error: String((error as Error).message ?? error).slice(0, 200) });
  }
  if (list && list.pupils.length > MAX_PUPILS) throw new HttpsError('invalid-argument', `The file lists ${list.pupils.length} pupils; only the classes taking part are needed (at most ${MAX_PUPILS}).`);
  const preview = list ? previewOf(list) : null;
  const kind = await fileKind(buffer, p.file!.name);
  if (p.action === 'preview') return { preview, unreadable, kind };

  const uploadId = randomUUID();
  const receivedAt = new Date();
  const fileName = safeName(p.file!.name);
  const path = `schoolupns/${school.slug}/${uploadId}/${fileName}`;
  await getStorage()
    .bucket()
    .file(path)
    .save(buffer, { contentType: p.file!.contentType || 'application/octet-stream', resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
  await staged?.delete({ ignoreNotFound: true });
  const uploader = { name: p.uploader!.name.trim(), role: (p.uploader!.role ?? '').trim(), email: p.uploader!.email.trim() };
  await db
    .collection('schoolUploads')
    .doc(uploadId)
    .set({
      schoolId: school.id,
      schoolSlug: school.slug,
      schoolName: school.name,
      fileName,
      contentType: p.file!.contentType,
      bytes: buffer.length,
      sha256: sha256(buffer),
      path,
      fileKind: kind,
      // Not read automatically: the team reads the file by hand, and the staff page and the export say so.
      needsManualReading: !list,
      unreadableReason: unreadable,
      noHeadings: Boolean(list?.noHeadings),
      columns: list?.columns ?? null,
      ignored: list?.ignored ?? [],
      pupils: (list?.pupils ?? []).map((x: Pupil) => ({
        row: x.row,
        upn: x.upn,
        firstName: x.firstName,
        middleName: x.middleName ?? '',
        lastName: x.lastName,
        dateOfBirth: x.dateOfBirth,
      })),
      pupilCount: list?.pupils.length ?? 0,
      validUpns: list?.valid ?? 0,
      problems: (list?.problems ?? []).slice(0, 500),
      uploader,
      note: (p.note ?? '').trim() || null,
      sessionUid: uid,
      client: p.client,
      receivedAt,
      createdAt: FieldValue.serverTimestamp(),
    });
  const summary = list && preview
    ? `${list.pupils.length} pupils (${list.valid} with a usable UPN${list.problems.length ? `; ${list.problems.length} row${list.problems.length === 1 ? '' : 's'} to check` : ''})`
    : 'a file the website could not read automatically, so the research team will read it by hand';
  const team = await sendTeamMail({
    subject: `MyPhone/MyBrain: ${school.name} sent its UPN list`,
    text: [`${uploader.name}${uploader.role ? ` (${uploader.role})` : ''} at ${school.name} sent a UPN list: ${summary}.`, ...(unreadable ? ['', `TO READ BY HAND: ${unreadable} The file is in the export under schools/upn-uploads/, and on the staff page.`] : []), '', `File: ${fileName}`, `Upload: ${uploadId}`, ...(p.note?.trim() ? ['', `Their note: ${p.note.trim()}`] : []), '', 'It is in the export within the hour, under schools/upn-uploads/.'].join('\n'),
    replyTo: uploader.email,
  });
  const receipt = await sendMail({
    to: uploader.email,
    subject: `MyPhone/MyBrain: we received ${school.name}’s class list`,
    text: ['Hello,', '', `Thank you. We received your file ${fileName}: ${summary}.`, '', 'If you need to correct anything, upload the file again on the same page; the research team uses the latest one. Questions? Reply to this email.', '', 'The MyPhone/MyBrain team, University of Leeds'].join('\n'),
  });
  await db.collection('schoolUploads').doc(uploadId).set({ notified: { team, receipt } }, { merge: true });
  // Pupils already opted out keep only a minimal record from the start (schoolRedact.ts).
  await redactOptedOutPupils(db);
  logger.info('School UPN list received', { school: school.slug, uploadId, kind, manual: !list, pupils: list?.pupils.length ?? 0, valid: list?.valid ?? 0, problems: list?.problems.length ?? 0, team, receipt });
  return { uploadId, receivedAt: receivedAt.toISOString(), preview, receipt };
});
