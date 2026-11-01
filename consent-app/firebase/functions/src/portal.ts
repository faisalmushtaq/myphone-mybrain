import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { schools as siteSchools } from './forms.js';
import { icsFor } from './ics.js';
import { SITE } from './links.js';
import { sendMail, type Attachment, type MailOutcome } from './mail.js';
import { sendSms, ukMobile } from './sms.js';
import {
  confirmationMessage,
  copiesToDelete,
  countsFor,
  covers,
  docState,
  docTypeOf,
  eligibilityFor,
  expiryWarnings,
  isIsoDate,
  isRole,
  latestDocs,
  mayDo,
  offerMessage,
  planOffers,
  placesLeft,
  requirementsFor,
  respond,
  settingsOf,
  TIME,
  ukToday,
  validUntil,
  validateAvailability,
  validateVisit,
  VISIT_STATUSES,
  visitStatusAfter,
  type AssignmentStatus,
  type Availability,
  type DocType,
  type Eligibility,
  type PortalDoc,
  type Role,
  type Settings,
  type UserStatus,
  type VisitInfo,
  type VisitStatus,
} from './portalCore.js';

/**
 * The staff portal (myphonemybrain.com/portal/, 1 November 2026): one
 * callable, portalApi, with an action, for the project manager, the research
 * team and the research assistants, who sign in with an email link (Firebase
 * Authentication). Every call is checked here against the caller's account
 * in portalUsers; the browser has no direct access to any of the portal's
 * collections or files. See docs/portal.md.
 *
 * Collections
 *   portalUsers/{uid}           name, email, phone, role, status (pending, active, rejected, archived)
 *   portalSettings/main         thresholds, document types, retention
 *   portalSchools/{id}          schools (seeded from the website's list) and the forms each requires
 *   portalDocs/{id}             each upload: who, which document, its check, its details
 *   portalSessions/{id}         training sessions and pilots, with who attended
 *   portalAvailability/{uid_date}  a day's availability
 *   portalVisits/{id}           school visits
 *   portalInterest/{visit_uid}  a research assistant's interest in a visit
 *   portalAssignments/{visit_uid}  offers and their answers
 *   portalNotifications/{id}    in-portal notifications
 *   portalMail/{id}             every email and text the portal sent, and what happened
 *   portalAudit/{id}            who did what, when
 * Storage
 *   portal/docs/{uid}/{uploadId}  document copies (the owner uploads; only this function reads)
 */

const REGION = 'europe-west2';
const callOptions = { region: REGION, memory: '512MiB' as const, timeoutSeconds: 120, enforceAppCheck: process.env.MPMB_ENFORCE_APP_CHECK === 'true' };
export const PORTAL_URL = `${SITE}/portal/`;
export const DOC_ROOT = 'portal/docs';
const UPLOAD_ID = /^[0-9a-f-]{36}$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const DOC_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_DOC_BYTES = 15 * 1024 * 1024;

const bad = (message: string) => new HttpsError('invalid-argument', message);
const refused = (message = 'You do not have access to that.') => new HttpsError('permission-denied', message);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const idOf = (v: unknown, what: string) => {
  if (typeof v !== 'string' || !ID.test(v)) throw bad(`The ${what} is malformed.`);
  return v;
};
const iso = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') return (v as { toDate: () => Date }).toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  return null;
};

/* ── Who is calling ───────────────────────────────────────────────────── */

export interface Caller {
  uid: string;
  email: string;
  role: Role | null;
  status: UserStatus | null;
  name: string;
}

/** The caller: signed in with an email link (never the anonymous sessions the participant pages use), with their account if they have one. */
async function callerOf(db: Firestore, request: CallableRequest<unknown>): Promise<Caller> {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Please sign in.');
  const token = auth.token as Record<string, unknown> & { firebase?: { sign_in_provider?: string } };
  const email = typeof token.email === 'string' ? token.email.toLowerCase() : '';
  if (!email || token.email_verified !== true || token.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Please sign in with the link we email you.');
  const snap = await db.collection('portalUsers').doc(auth.uid).get();
  const d = snap.data();
  return { uid: auth.uid, email, role: isRole(d?.role) ? d.role : null, status: (d?.status as UserStatus) ?? null, name: typeof d?.name === 'string' ? d.name : '' };
}

async function audit(db: Firestore, who: Caller, action: string, target: string, details: Record<string, unknown> = {}) {
  await db.collection('portalAudit').add({ at: FieldValue.serverTimestamp(), by: who.uid, byEmail: who.email, byName: who.name, action, target, details });
}

async function settingsFrom(db: Firestore): Promise<Settings> {
  return settingsOf((await db.collection('portalSettings').doc('main').get()).data());
}

/* ── Notifications and mail ───────────────────────────────────────────── */

interface Note {
  title: string;
  body: string;
  /** Where it opens in the portal, for example "#offers". */
  link: string;
}

async function notify(db: Firestore, uids: string[], note: Note) {
  const batch = db.batch();
  for (const uid of new Set(uids)) batch.set(db.collection('portalNotifications').doc(), { uid, ...note, read: false, createdAt: FieldValue.serverTimestamp() });
  await batch.commit();
}

/** Sends an email and keeps a record of it (who, what, and whether it went). Never throws. */
async function mail(db: Firestore, to: string, subject: string, body: string, kind: string, attachments?: Attachment[]): Promise<MailOutcome> {
  const outcome = await sendMail({ to, subject, text: body, ...(attachments ? { attachments } : {}) });
  await db.collection('portalMail').add({ channel: 'email', to, subject, kind, outcome, at: FieldValue.serverTimestamp() });
  return outcome;
}

async function text_(db: Firestore, user: DocumentData, body: string, kind: string) {
  if (user.smsOptIn !== true) return;
  const to = ukMobile(String(user.phone ?? ''));
  if (!to) return;
  const outcome = await sendSms(to, body);
  await db.collection('portalMail').add({ channel: 'sms', to, subject: body.slice(0, 80), kind, outcome, at: FieldValue.serverTimestamp() });
}

async function teamOf(db: Firestore, roles: Role[] = ['pm', 'researcher']) {
  const snap = await db.collection('portalUsers').where('status', '==', 'active').get();
  return snap.docs.filter((d) => roles.includes(d.data().role)).map((d) => ({ uid: d.id, email: String(d.data().email ?? ''), name: String(d.data().name ?? '') }));
}

async function tellTeam(db: Firestore, note: Note, roles: Role[] = ['pm', 'researcher'], email?: { subject: string; body: string; kind: string }) {
  const team = await teamOf(db, roles);
  await notify(db, team.map((t) => t.uid), note);
  if (email) for (const t of team) if (t.email) await mail(db, t.email, email.subject, email.body, email.kind);
}

/* ── Schools ──────────────────────────────────────────────────────────── */

interface School {
  id: string;
  name: string;
  area: string;
  requiredDocs: DocType[];
  active: boolean;
}

/** The portal's schools: the website's list, added once, then whatever the team adds or changes here. */
async function schoolsOf(db: Firestore): Promise<School[]> {
  const snap = await db.collection('portalSchools').get();
  const have = new Set(snap.docs.map((d) => d.id));
  const missing = siteSchools.filter((s) => !have.has(s.id));
  if (missing.length) {
    const batch = db.batch();
    for (const s of missing) batch.set(db.collection('portalSchools').doc(s.id), { name: s.name, area: s.area, requiredDocs: [], active: true, createdAt: FieldValue.serverTimestamp() });
    await batch.commit();
  }
  const all = missing.length ? (await db.collection('portalSchools').get()).docs : snap.docs;
  return all
    .map((d) => {
      const x = d.data();
      return { id: d.id, name: String(x.name ?? d.id), area: String(x.area ?? ''), requiredDocs: (Array.isArray(x.requiredDocs) ? x.requiredDocs : []).map(docTypeOf).filter((t: DocType | null): t is DocType => !!t), active: x.active !== false };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ── Reading everything a staffing view needs ─────────────────────────── */

function docOf(id: string, x: DocumentData): PortalDoc & { path: string | null; fileName: string; verifiedBy: string | null; verifiedAt: string | null } {
  return {
    id,
    uid: String(x.uid),
    typeId: String(x.typeId),
    schoolId: typeof x.schoolId === 'string' ? x.schoolId : null,
    status: x.status === 'verified' || x.status === 'rejected' ? x.status : 'uploaded',
    uploadedAt: iso(x.uploadedAt) ?? '',
    details: (x.details ?? {}) as PortalDoc['details'],
    note: typeof x.note === 'string' ? x.note : undefined,
    deletedAt: iso(x.deletedAt),
    path: typeof x.path === 'string' ? x.path : null,
    fileName: String(x.fileName ?? ''),
    verifiedBy: typeof x.verifiedByName === 'string' ? x.verifiedByName : null,
    verifiedAt: iso(x.verifiedAt),
  };
}

async function docsOf(db: Firestore, uid?: string) {
  const q = uid ? db.collection('portalDocs').where('uid', '==', uid) : db.collection('portalDocs');
  return (await q.get()).docs.map((d) => docOf(d.id, d.data()));
}

async function sessionsOf(db: Firestore) {
  return (await db.collection('portalSessions').get()).docs.map((d) => {
    const x = d.data();
    return { id: d.id, kind: x.kind === 'pilot' ? 'pilot' : 'training', date: String(x.date ?? ''), title: String(x.title ?? ''), notes: String(x.notes ?? ''), attendees: Array.isArray(x.attendees) ? x.attendees.map(String) : [] };
  });
}

function visitOf(id: string, x: DocumentData) {
  return { visitId: id, schoolId: String(x.schoolId), date: String(x.date), start: String(x.start), end: String(x.end), meetingPoint: String(x.meetingPoint ?? ''), needed: Number(x.needed ?? 1), notes: String(x.notes ?? ''), status: (VISIT_STATUSES.includes(x.status) ? x.status : 'draft') as VisitStatus };
}

async function assignmentsOf(db: Firestore, visitId: string) {
  return (await db.collection('portalAssignments').where('visitId', '==', visitId).get()).docs.map((d) => {
    const x = d.data();
    return { uid: String(x.uid), status: x.status as AssignmentStatus, offeredAt: iso(x.offeredAt), respondedAt: iso(x.respondedAt), override: (x.override ?? null) as { reason: string; byName: string } | null, note: String(x.note ?? '') };
  });
}

function userRow(id: string, x: DocumentData) {
  return { uid: id, name: String(x.name ?? ''), email: String(x.email ?? ''), phone: String(x.phone ?? ''), role: isRole(x.role) ? x.role : null, requested: x.requested === 'team' ? 'team' : 'ra', status: (x.status ?? 'pending') as UserStatus, smsOptIn: x.smsOptIn === true, createdAt: iso(x.createdAt), archivedAt: iso(x.archivedAt) };
}

/** Each document someone needs, with where it stands today. `withDetails` adds the certificate details (the project manager and the person themselves). */
function docSummary(uid: string, all: ReturnType<typeof docOf>[], settings: Settings, schools: School[], today: string, withDetails: boolean) {
  const latest = latestDocs(all);
  const rows = [...requirementsFor(settings, null), ...schools.filter((s) => s.active).flatMap((s) => requirementsFor({ ...settings, docTypes: [] }, s))].map(({ type, schoolId }) => {
    const doc = latest.get(`${uid}|${type.id}|${schoolId ?? ''}`) as ReturnType<typeof docOf> | undefined;
    const state = docState(doc, type, settings, today);
    return {
      typeId: type.id,
      label: type.label,
      hint: type.hint,
      dbs: type.dbs === true,
      expires: type.expires === true,
      schoolId,
      schoolName: schoolId ? (schools.find((s) => s.id === schoolId)?.name ?? schoolId) : null,
      state,
      docId: doc?.id ?? null,
      uploadedAt: doc?.uploadedAt ?? null,
      validUntil: doc && doc.status === 'verified' ? validUntil(doc, type, settings) : null,
      note: doc?.status === 'rejected' ? (doc.note ?? '') : null,
      hasCopy: Boolean(doc?.path && !doc.deletedAt),
      ...(withDetails && doc ? { details: doc.details, fileName: doc.fileName, verifiedBy: doc.verifiedBy, verifiedAt: doc.verifiedAt } : {}),
    };
  });
  return rows;
}

/* ── The callable ─────────────────────────────────────────────────────── */

export const portalApi = onCall(callOptions, async (request) => {
  const db = getFirestore();
  const data = (request.data ?? {}) as Record<string, unknown>;
  const action = typeof data.action === 'string' ? data.action : '';
  const me = await callerOf(db, request);
  if (!mayDo(action, me.role, me.status)) throw refused(me.status === 'pending' ? 'Your account is waiting for the project manager to approve it.' : undefined);
  const today = ukToday();

  switch (action) {
    /* ── Everyone ── */
    case 'me': {
      const snap = await db.collection('portalUsers').doc(me.uid).get();
      const unread = me.status === 'active' ? (await db.collection('portalNotifications').where('uid', '==', me.uid).where('read', '==', false).count().get()).data().count : 0;
      return { email: me.email, user: snap.exists ? userRow(snap.id, snap.data()!) : null, unread };
    }
    case 'request-access': {
      const ref = db.collection('portalUsers').doc(me.uid);
      const had = await ref.get();
      if (had.exists && had.data()!.status !== 'rejected') return { user: userRow(had.id, had.data()!) };
      const name = text(data.name, 100);
      const phone = text(data.phone, 30);
      if (name.length < 2) throw bad('Please give your full name.');
      if (phone && !ukMobile(phone)) throw bad('Please give a UK mobile number, or leave it empty.');
      const requested = data.requested === 'team' ? 'team' : 'ra';
      await ref.set({ email: me.email, name, phone, requested, role: null, status: 'pending', smsOptIn: false, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      await audit(db, { ...me, name }, 'request-access', me.uid, { requested });
      await tellTeam(db, { title: 'New account request', body: `${name} (${me.email}) asked for ${requested === 'team' ? 'a research team' : 'a research assistant'} account.`, link: '#people' }, ['pm'], {
        subject: 'MyPhone/MyBrain portal: a new account to approve',
        body: `${name} (${me.email}) asked for ${requested === 'team' ? 'a research team' : 'a research assistant'} account.\n\nApprove or decline it in the portal: ${PORTAL_URL}#people`,
        kind: 'request',
      });
      return { user: userRow(me.uid, (await ref.get()).data()!) };
    }

    /* ── Yourself ── */
    case 'update-profile': {
      const name = text(data.name, 100);
      const phone = text(data.phone, 30);
      if (name.length < 2) throw bad('Please give your full name.');
      if (phone && !ukMobile(phone)) throw bad('Please give a UK mobile number, or leave it empty.');
      const smsOptIn = data.smsOptIn === true && Boolean(phone);
      await db.collection('portalUsers').doc(me.uid).set({ name, phone, smsOptIn, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { ok: true };
    }
    case 'notifications': {
      const snap = await db.collection('portalNotifications').where('uid', '==', me.uid).orderBy('createdAt', 'desc').limit(50).get();
      return { notifications: snap.docs.map((d) => ({ id: d.id, title: d.data().title, body: d.data().body, link: d.data().link, read: d.data().read === true, createdAt: iso(d.data().createdAt) })) };
    }
    case 'mark-read': {
      const snap = await db.collection('portalNotifications').where('uid', '==', me.uid).where('read', '==', false).get();
      const batch = db.batch();
      for (const d of snap.docs) batch.update(d.ref, { read: true });
      await batch.commit();
      return { ok: true };
    }
    case 'my-summary': {
      const [settings, schools, docs, sessions, avail, assignSnap, visitsSnap] = await Promise.all([
        settingsFrom(db),
        schoolsOf(db),
        docsOf(db, me.uid),
        sessionsOf(db),
        db.collection('portalAvailability').where('uid', '==', me.uid).where('date', '>=', today).get(),
        db.collection('portalAssignments').where('uid', '==', me.uid).get(),
        db.collection('portalVisits').where('date', '>=', today).get(),
      ]);
      const visits = new Map(visitsSnap.docs.map((d) => [d.id, visitOf(d.id, d.data())]));
      const counts = countsFor(me.uid, sessions);
      const mine = sessions.filter((s) => s.attendees.includes(me.uid)).map((s) => ({ id: s.id, kind: s.kind, date: s.date, title: s.title }));
      const assignments = assignSnap.docs
        .map((d) => d.data())
        .filter((a) => visits.has(a.visitId) && a.status !== 'withdrawn')
        .map((a) => {
          const v = visits.get(a.visitId)!;
          return { ...v, schoolName: schools.find((s) => s.id === v.schoolId)?.name ?? v.schoolId, visitStatus: v.status, status: a.status as AssignmentStatus };
        })
        .sort((a, b) => a.date.localeCompare(b.date));
      const user = (await db.collection('portalUsers').doc(me.uid).get()).data()!;
      return {
        user: userRow(me.uid, user),
        settings: { minTraining: settings.minTraining, minPilots: settings.minPilots },
        documents: docSummary(me.uid, docs, settings, schools, today, true),
        counts,
        sessions: mine,
        availability: avail.docs.map((d) => ({ date: d.data().date, value: d.data().value as Availability, note: String(d.data().note ?? '') })),
        assignments,
      };
    }
    case 'register-document': {
      const uploadId = typeof data.uploadId === 'string' && UPLOAD_ID.test(data.uploadId) ? data.uploadId : null;
      if (!uploadId) throw bad('The upload is malformed.');
      const settings = await settingsFrom(db);
      const schools = await schoolsOf(db);
      const schoolId = typeof data.schoolId === 'string' && data.schoolId ? data.schoolId : null;
      const school = schoolId ? schools.find((s) => s.id === schoolId) : null;
      if (schoolId && !school) throw bad('That school is not in the portal.');
      const types = school ? school.requiredDocs : settings.docTypes;
      const type = types.find((t) => t.id === data.typeId);
      if (!type) throw bad('Choose which document this is.');
      const path = `${DOC_ROOT}/${me.uid}/${uploadId}`;
      const file = getStorage().bucket().file(path);
      const [exists] = await file.exists();
      if (!exists) throw bad('The file did not arrive. Please try again.');
      const [meta] = await file.getMetadata();
      const size = Number(meta.size ?? 0);
      if (!DOC_TYPES.has(String(meta.contentType)) || size > MAX_DOC_BYTES) {
        await file.delete({ ignoreNotFound: true });
        throw bad('Please upload a PDF, JPG or PNG of up to 15 MB.');
      }
      const ref = db.collection('portalDocs').doc();
      await ref.set({ uid: me.uid, typeId: type.id, schoolId, path, fileName: text(data.fileName, 120) || 'document', contentType: meta.contentType, size, status: 'uploaded', details: {}, uploadedAt: FieldValue.serverTimestamp() });
      await audit(db, me, 'upload-document', ref.id, { typeId: type.id, schoolId });
      await tellTeam(db, { title: 'A document to check', body: `${me.name || me.email} uploaded: ${type.label}${school ? ` (${school.name})` : ''}.`, link: `#person/${me.uid}` }, ['pm']);
      return { docId: ref.id };
    }
    case 'document-url': {
      const id = idOf(data.docId, 'document');
      const snap = await db.collection('portalDocs').doc(id).get();
      if (!snap.exists) throw bad('That document is not there.');
      const d = snap.data()!;
      // The copies: the person themselves and the project manager, nobody else.
      if (d.uid !== me.uid && me.role !== 'pm') throw refused('Only the project manager can open other people’s documents.');
      if (typeof d.path !== 'string' || d.deletedAt) throw bad('The copy of this document has been deleted.');
      const file = getStorage().bucket().file(d.path);
      await audit(db, me, 'open-document', id, { owner: d.uid });
      try {
        const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 5 * 60_000, responseDisposition: `inline; filename="${String(d.fileName ?? 'document').replace(/"/g, '')}"` });
        return { url };
      } catch (error) {
        // Signing needs the service account's key or the IAM signer; in the emulator, send small files inline.
        if (process.env.FUNCTIONS_EMULATOR !== 'true') {
          logger.error('Portal: could not sign a document link', { error: String(error) });
          throw new HttpsError('internal', 'The document could not be opened. Please try again.');
        }
        const [bytes] = await file.download();
        return { url: `data:${d.contentType};base64,${bytes.toString('base64')}` };
      }
    }
    case 'set-availability': {
      const { days, problems } = validateAvailability(data.days, today);
      if (problems.length) throw bad(problems.join(' '));
      const batch = db.batch();
      for (const d of days) {
        const ref = db.collection('portalAvailability').doc(`${me.uid}_${d.date}`);
        if (d.value === null) batch.delete(ref);
        else batch.set(ref, { uid: me.uid, date: d.date, value: d.value, note: d.note, updatedAt: FieldValue.serverTimestamp() });
      }
      await batch.commit();
      return { saved: days.length };
    }
    case 'open-visits': {
      const [schools, visitsSnap, interestSnap] = await Promise.all([schoolsOf(db), db.collection('portalVisits').where('date', '>=', today).get(), db.collection('portalInterest').where('uid', '==', me.uid).get()]);
      const interested = new Set(interestSnap.docs.map((d) => d.data().visitId));
      const visits = visitsSnap.docs
        .map((d) => visitOf(d.id, d.data()))
        .filter((v) => v.status === 'staffing' || v.status === 'draft' || v.status === 'locked')
        .map((v) => ({ ...v, schoolName: schools.find((s) => s.id === v.schoolId)?.name ?? v.schoolId, interested: interested.has(v.visitId) }))
        .sort((a, b) => a.date.localeCompare(b.date));
      return { visits };
    }
    case 'set-interest': {
      const visitId = idOf(data.visitId, 'visit');
      const ref = db.collection('portalInterest').doc(`${visitId}_${me.uid}`);
      if (data.interested === true) await ref.set({ visitId, uid: me.uid, at: FieldValue.serverTimestamp() });
      else await ref.delete();
      return { ok: true };
    }
    case 'respond-offer': {
      const visitId = idOf(data.visitId, 'visit');
      const ref = db.collection('portalAssignments').doc(`${visitId}_${me.uid}`);
      const visitRef = db.collection('portalVisits').doc(visitId);
      const result = await db.runTransaction(async (tx) => {
        const [a, v] = await Promise.all([tx.get(ref), tx.get(visitRef)]);
        if (!v.exists) throw bad('That visit is not there.');
        const { next, problem } = respond(a.exists ? (a.data()!.status as AssignmentStatus) : undefined, data.response);
        if (problem || !next) throw bad(problem ?? 'Say confirm or decline.');
        tx.update(ref, { status: next, respondedAt: FieldValue.serverTimestamp(), note: text(data.note, 300) });
        return { next, visit: visitOf(v.id, v.data()!) };
      });
      const assignments = await assignmentsOf(db, visitId);
      const status = visitStatusAfter(result.visit.status, result.visit.needed, assignments);
      if (status !== result.visit.status) await visitRef.update({ status, updatedAt: FieldValue.serverTimestamp() });
      const schools = await schoolsOf(db);
      const info: VisitInfo = { schoolName: schools.find((s) => s.id === result.visit.schoolId)?.name ?? result.visit.schoolId, date: result.visit.date, start: result.visit.start, end: result.visit.end, meetingPoint: result.visit.meetingPoint };
      const who = me.name || me.email;
      await audit(db, me, result.next === 'confirmed' ? 'confirm-offer' : 'decline-offer', visitId, { note: text(data.note, 300) });
      if (result.next === 'confirmed') {
        const m = confirmationMessage(me.name.split(' ')[0] || 'there', info, `${PORTAL_URL}#my-visits`);
        const start = ukDateTime(info.date, info.start);
        const end = ukDateTime(info.date, info.end);
        const ics = icsFor({ uid: `portal-${visitId}-${me.uid}@myphonemybrain.com`, start, end, summary: `MyPhone/MyBrain school visit: ${info.schoolName}`, location: [info.schoolName, info.meetingPoint].filter(Boolean).join(', '), description: `MyPhone/MyBrain school visit. Meeting point: ${info.meetingPoint || 'to be confirmed'}.`, url: `${PORTAL_URL}#my-visits` });
        await mail(db, me.email, m.subject, m.email, 'confirmation', [{ filename: 'school-visit.ics', content: ics, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }]);
        await notify(db, [me.uid], { title: `Confirmed: ${info.schoolName}`, body: `${info.date}, ${info.start} to ${info.end}. A confirmation email with a calendar invitation is on its way.`, link: '#my-visits' });
        await tellTeam(db, { title: `${who} confirmed`, body: `${info.schoolName} on ${info.date}.`, link: `#visit/${visitId}` });
      } else {
        await tellTeam(db, { title: `${who} declined`, body: `${info.schoolName} on ${info.date}: a place is open again.${text(data.note, 300) ? ` “${text(data.note, 300)}”` : ''}`, link: `#visit/${visitId}` }, ['pm', 'researcher'], {
          subject: `MyPhone/MyBrain portal: ${who} declined ${info.schoolName} on ${info.date}`,
          body: `${who} declined the place on the visit to ${info.schoolName} on ${info.date}, so a place is open again.\n\nChoose someone else in the portal: ${PORTAL_URL}#visit/${visitId}`,
          kind: 'declined',
        });
      }
      return { status: result.next, visitStatus: status };
    }

    /* ── The research team ── */
    case 'people': {
      const [settings, schools, usersSnap, docs, sessions] = await Promise.all([settingsFrom(db), schoolsOf(db), db.collection('portalUsers').get(), docsOf(db), sessionsOf(db)]);
      const pm = me.role === 'pm';
      const people = usersSnap.docs
        .map((d) => userRow(d.id, d.data()))
        .filter((u) => pm || u.status === 'active')
        .map((u) => {
          const documents = docSummary(u.uid, docs.filter((d) => d.uid === u.uid), settings, schools, today, false).filter((r) => r.schoolId === null);
          const counts = countsFor(u.uid, sessions);
          const general = eligibilityFor(u.uid, latestDocs(docs), requirementsFor(settings, null), counts, settings, today);
          return { ...u, counts, documents: documents.map((r) => ({ typeId: r.typeId, label: r.label, state: r.state })), ready: general.eligible, reasons: general.reasons, toCheck: documents.filter((r) => r.state === 'uploaded').length };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return { people, settings: { minTraining: settings.minTraining, minPilots: settings.minPilots } };
    }
    case 'person': {
      const uid = idOf(data.uid, 'person');
      const [settings, schools, snap, docs, sessions, availSnap] = await Promise.all([settingsFrom(db), schoolsOf(db), db.collection('portalUsers').doc(uid).get(), docsOf(db, uid), sessionsOf(db), db.collection('portalAvailability').where('uid', '==', uid).where('date', '>=', today).get()]);
      if (!snap.exists) throw bad('That person is not in the portal.');
      const pm = me.role === 'pm';
      return {
        user: userRow(uid, snap.data()!),
        counts: countsFor(uid, sessions),
        sessions: sessions.filter((s) => s.attendees.includes(uid)).map((s) => ({ id: s.id, kind: s.kind, date: s.date, title: s.title })),
        // The copies, and the certificate details, are the project manager's; the team sees where each document stands.
        documents: docSummary(uid, docs, settings, schools, today, pm),
        history: pm ? docs.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).map((d) => ({ docId: d.id, typeId: d.typeId, schoolId: d.schoolId, status: d.status, uploadedAt: d.uploadedAt, fileName: d.fileName, hasCopy: Boolean(d.path && !d.deletedAt), note: d.note ?? null })) : [],
        availability: availSnap.docs.map((d) => ({ date: d.data().date, value: d.data().value, note: String(d.data().note ?? '') })),
      };
    }
    case 'schools':
      return { schools: await schoolsOf(db) };
    case 'save-school': {
      const name = text(data.name, 120);
      if (name.length < 2) throw bad('Give the school’s name.');
      const requiredDocs = (Array.isArray(data.requiredDocs) ? data.requiredDocs : []).map(docTypeOf).filter((t): t is DocType => !!t).slice(0, 10);
      const id = data.id ? idOf(data.id, 'school') : name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || db.collection('portalSchools').doc().id;
      await db.collection('portalSchools').doc(id).set({ name, area: text(data.area, 80), requiredDocs, active: data.active !== false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await audit(db, me, 'save-school', id, { name, requiredDocs: requiredDocs.map((t) => t.id) });
      return { id };
    }
    case 'sessions': {
      const [sessions, usersSnap] = await Promise.all([sessionsOf(db), db.collection('portalUsers').where('status', '==', 'active').get()]);
      return { sessions: sessions.sort((a, b) => b.date.localeCompare(a.date)), people: usersSnap.docs.map((d) => ({ uid: d.id, name: String(d.data().name ?? ''), role: d.data().role })) };
    }
    case 'save-session': {
      const kind = data.kind === 'pilot' ? 'pilot' : data.kind === 'training' ? 'training' : null;
      if (!kind) throw bad('Say whether it was training or a pilot.');
      if (!isIsoDate(data.date)) throw bad('Give the date.');
      const title = text(data.title, 120);
      if (!title) throw bad('Give it a title, for example “EEG set-up training”.');
      const attendees = [...new Set((Array.isArray(data.attendees) ? data.attendees : []).filter((u): u is string => typeof u === 'string' && ID.test(u)))].slice(0, 200);
      const ref = data.id ? db.collection('portalSessions').doc(idOf(data.id, 'session')) : db.collection('portalSessions').doc();
      await ref.set({ kind, date: data.date, title, notes: text(data.notes, 1000), attendees, updatedBy: me.uid, updatedAt: FieldValue.serverTimestamp(), ...(data.id ? {} : { createdBy: me.uid, createdAt: FieldValue.serverTimestamp() }) }, { merge: true });
      await audit(db, me, 'save-session', ref.id, { kind, date: data.date, attendees: attendees.length });
      return { id: ref.id };
    }
    case 'delete-session': {
      const id = idOf(data.id, 'session');
      await db.collection('portalSessions').doc(id).delete();
      await audit(db, me, 'delete-session', id);
      return { ok: true };
    }
    case 'visits': {
      const [schools, snap] = await Promise.all([schoolsOf(db), db.collection('portalVisits').where('date', '>=', text(data.from, 10) || addMonthsBack(today)).get()]);
      const all = (await db.collection('portalAssignments').get()).docs.map((d) => d.data());
      return {
        visits: snap.docs
          .map((d) => visitOf(d.id, d.data()))
          .map((v) => {
            const mine = all.filter((a) => a.visitId === v.visitId);
            return { ...v, schoolName: schools.find((s) => s.id === v.schoolId)?.name ?? v.schoolId, confirmed: mine.filter((a) => a.status === 'confirmed').length, offered: mine.filter((a) => a.status === 'offered').length };
          })
          .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)),
        schools,
      };
    }
    case 'save-visit': {
      const schools = await schoolsOf(db);
      const { visit, problems } = validateVisit(data, schools.filter((s) => s.active).map((s) => s.id), today);
      if (!visit) throw bad(problems.join(' '));
      const ref = data.visitId ? db.collection('portalVisits').doc(idOf(data.visitId, 'visit')) : db.collection('portalVisits').doc();
      await ref.set({ ...visit, ...(data.visitId ? {} : { status: 'draft', createdBy: me.uid, createdAt: FieldValue.serverTimestamp() }), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await audit(db, me, data.visitId ? 'update-visit' : 'add-visit', ref.id, { ...visit });
      return { visitId: ref.id };
    }
    case 'set-visit-status': {
      const visitId = idOf(data.visitId, 'visit');
      const status = data.status as VisitStatus;
      if (!VISIT_STATUSES.includes(status)) throw bad('Choose a status.');
      await db.collection('portalVisits').doc(visitId).update({ status, updatedAt: FieldValue.serverTimestamp() });
      await audit(db, me, 'visit-status', visitId, { status });
      if (status === 'cancelled') {
        const people = (await assignmentsOf(db, visitId)).filter((a) => a.status === 'offered' || a.status === 'confirmed').map((a) => a.uid);
        await notify(db, people, { title: 'A school visit was cancelled', body: 'A visit you were offered or confirmed for is cancelled. See your visits in the portal.', link: '#my-visits' });
      }
      return { ok: true };
    }
    case 'visit': {
      const visitId = idOf(data.visitId, 'visit');
      const snap = await db.collection('portalVisits').doc(visitId).get();
      if (!snap.exists) throw bad('That visit is not there.');
      const v = visitOf(visitId, snap.data()!);
      const [settings, schools, usersSnap, docs, sessions, availSnap, interestSnap, assignments] = await Promise.all([
        settingsFrom(db),
        schoolsOf(db),
        db.collection('portalUsers').where('status', '==', 'active').get(),
        docsOf(db),
        sessionsOf(db),
        db.collection('portalAvailability').where('date', '==', v.date).get(),
        db.collection('portalInterest').where('visitId', '==', visitId).get(),
        assignmentsOf(db, visitId),
      ]);
      const school = schools.find((s) => s.id === v.schoolId) ?? null;
      const requirements = requirementsFor(settings, school);
      const latest = latestDocs(docs);
      const avail = new Map(availSnap.docs.map((d) => [String(d.data().uid), d.data() as { value: Availability; note?: string }]));
      const interested = new Set(interestSnap.docs.map((d) => String(d.data().uid)));
      const candidates = usersSnap.docs
        .filter((d) => d.data().role === 'ra')
        .map((d) => {
          const counts = countsFor(d.id, sessions);
          const e = eligibilityFor(d.id, latest, requirements, counts, settings, v.date);
          const day = avail.get(d.id);
          return { uid: d.id, name: String(d.data().name ?? ''), email: String(d.data().email ?? ''), availability: day?.value ?? null, availabilityNote: day?.note ?? '', covers: covers(day?.value, v.start, v.end), interested: interested.has(d.id), counts, eligible: e.eligible, reasons: e.reasons, assignment: assignments.find((a) => a.uid === d.id) ?? null };
        })
        .sort((a, b) => Number(b.eligible) - Number(a.eligible) || (a.covers === 'yes' ? 0 : 1) - (b.covers === 'yes' ? 0 : 1) || Number(b.interested) - Number(a.interested) || a.name.localeCompare(b.name));
      return { visit: { ...v, schoolName: school?.name ?? v.schoolId, requiredDocs: requirements.map((r) => r.type.label) }, candidates, placesLeft: placesLeft(v.needed, assignments), mayOverride: me.role === 'pm' };
    }
    case 'offer': {
      const visitId = idOf(data.visitId, 'visit');
      const visitRef = db.collection('portalVisits').doc(visitId);
      const snap = await visitRef.get();
      if (!snap.exists) throw bad('That visit is not there.');
      const v = visitOf(visitId, snap.data()!);
      const [settings, schools, usersSnap, docs, sessions, assignments] = await Promise.all([settingsFrom(db), schoolsOf(db), db.collection('portalUsers').where('status', '==', 'active').get(), docsOf(db), sessionsOf(db), assignmentsOf(db, visitId)]);
      const school = schools.find((s) => s.id === v.schoolId) ?? null;
      const ras = usersSnap.docs.filter((d) => d.data().role === 'ra');
      const requirements = requirementsFor(settings, school);
      const latest = latestDocs(docs);
      const eligible = new Map<string, Eligibility>(ras.map((d) => [d.id, eligibilityFor(d.id, latest, requirements, countsFor(d.id, sessions), settings, v.date)]));
      const overrides = (data.overrides && typeof data.overrides === 'object' ? data.overrides : {}) as Record<string, string>;
      const chosen = (Array.isArray(data.uids) ? data.uids : []).filter((u): u is string => typeof u === 'string');
      const plan = planOffers(chosen, { needed: v.needed, assignments, active: new Set(ras.map((d) => d.id)), eligible, overrides, mayOverride: me.role === 'pm', visitStatus: v.status });
      if (plan.problems.length) throw bad(plan.problems.join(' '));
      const info: VisitInfo = { schoolName: school?.name ?? v.schoolId, date: v.date, start: v.start, end: v.end, meetingPoint: v.meetingPoint };
      const batch = db.batch();
      for (const uid of plan.offer) {
        const reason = !eligible.get(uid)?.eligible ? text(overrides[uid], 300) : '';
        batch.set(db.collection('portalAssignments').doc(`${visitId}_${uid}`), { visitId, uid, status: 'offered', offeredAt: FieldValue.serverTimestamp(), offeredBy: me.uid, respondedAt: null, note: '', override: reason ? { reason, by: me.uid, byName: me.name } : null });
      }
      await batch.commit();
      const after = await assignmentsOf(db, visitId);
      await visitRef.update({ status: visitStatusAfter(v.status, v.needed, after), updatedAt: FieldValue.serverTimestamp() });
      for (const uid of plan.offer) {
        const u = ras.find((d) => d.id === uid)!.data();
        const m = offerMessage(String(u.name ?? '').split(' ')[0] || 'there', info, `${PORTAL_URL}#offers`);
        await notify(db, [uid], { title: m.title, body: m.body, link: '#offers' });
        await mail(db, String(u.email), m.subject, m.email, 'offer');
        await text_(db, u, `MyPhone/MyBrain: you're selected for ${info.schoolName} on ${info.date}, ${info.start}. Please confirm in the portal: ${PORTAL_URL}`, 'offer');
        const reason = !eligible.get(uid)?.eligible ? text(overrides[uid], 300) : '';
        await audit(db, me, reason ? 'offer-override' : 'offer', visitId, { uid, ...(reason ? { reason, reasons: eligible.get(uid)?.reasons ?? [] } : {}) });
      }
      return { offered: plan.offer.length };
    }
    case 'withdraw-offer': {
      const visitId = idOf(data.visitId, 'visit');
      const uid = idOf(data.uid, 'person');
      const ref = db.collection('portalAssignments').doc(`${visitId}_${uid}`);
      const a = await ref.get();
      if (!a.exists || a.data()!.status === 'withdrawn' || a.data()!.status === 'declined') throw bad('There is no open place to withdraw.');
      await ref.update({ status: 'withdrawn', respondedAt: FieldValue.serverTimestamp() });
      const v = visitOf(visitId, (await db.collection('portalVisits').doc(visitId).get()).data()!);
      await db.collection('portalVisits').doc(visitId).update({ status: visitStatusAfter(v.status, v.needed, await assignmentsOf(db, visitId)) });
      await notify(db, [uid], { title: 'A school visit place was withdrawn', body: `Your place on ${v.date} is no longer needed. Sorry for the change.`, link: '#my-visits' });
      await audit(db, me, 'withdraw-offer', visitId, { uid });
      return { ok: true };
    }

    /* ── The project manager ── */
    case 'requests': {
      const snap = await db.collection('portalUsers').where('status', '==', 'pending').get();
      return { requests: snap.docs.map((d) => userRow(d.id, d.data())) };
    }
    case 'approve':
    case 'set-role': {
      const uid = idOf(data.uid, 'person');
      const role = data.role;
      if (!isRole(role)) throw bad('Choose a role.');
      if (uid === me.uid && role !== 'pm') throw bad('You cannot remove your own project manager role; ask another project manager.');
      const ref = db.collection('portalUsers').doc(uid);
      const snap = await ref.get();
      if (!snap.exists) throw bad('That person is not in the portal.');
      await ref.update({ role, status: 'active', archivedAt: null, approvedBy: me.uid, updatedAt: FieldValue.serverTimestamp() });
      await setPortalClaim(uid, role);
      await audit(db, me, action, uid, { role });
      if (action === 'approve') {
        const u = snap.data()!;
        await notify(db, [uid], { title: 'Welcome to the MyPhone/MyBrain portal', body: role === 'ra' ? 'Start with your documents and availability.' : 'Your account is ready.', link: '#home' });
        await mail(db, String(u.email), 'MyPhone/MyBrain portal: your account is ready', `Hello ${String(u.name ?? '').split(' ')[0] || 'there'},\n\nYour account on the MyPhone/MyBrain staff portal is approved.${role === 'ra' ? ' Please upload your documents and add the days you are available.' : ''}\n\nSign in: ${PORTAL_URL}\n\nThe MyPhone/MyBrain team, University of Leeds`, 'approved');
      }
      return { ok: true };
    }
    case 'reject': {
      const uid = idOf(data.uid, 'person');
      await db.collection('portalUsers').doc(uid).update({ status: 'rejected', role: null, updatedAt: FieldValue.serverTimestamp() });
      await setPortalClaim(uid, null);
      await audit(db, me, 'reject', uid, { note: text(data.note, 300) });
      return { ok: true };
    }
    case 'archive':
    case 'restore': {
      const uid = idOf(data.uid, 'person');
      if (uid === me.uid) throw bad('You cannot archive yourself.');
      const ref = db.collection('portalUsers').doc(uid);
      const snap = await ref.get();
      if (!snap.exists) throw bad('That person is not in the portal.');
      if (action === 'archive') {
        await ref.update({ status: 'archived', archivedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        await setPortalClaim(uid, null);
      } else {
        const role = isRole(snap.data()!.role) ? snap.data()!.role : 'ra';
        await ref.update({ status: 'active', role, archivedAt: null, updatedAt: FieldValue.serverTimestamp() });
        await setPortalClaim(uid, role);
      }
      await audit(db, me, action, uid);
      return { ok: true };
    }
    case 'verify-document': {
      const id = idOf(data.docId, 'document');
      const ref = db.collection('portalDocs').doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw bad('That document is not there.');
      const d = snap.data()!;
      const decision = data.decision === 'verified' ? 'verified' : data.decision === 'rejected' ? 'rejected' : null;
      if (!decision) throw bad('Accept or reject the document.');
      const settings = await settingsFrom(db);
      const schools = await schoolsOf(db);
      const types = d.schoolId ? (schools.find((s) => s.id === d.schoolId)?.requiredDocs ?? []) : settings.docTypes;
      const type = types.find((t) => t.id === d.typeId);
      const raw = (data.details && typeof data.details === 'object' ? data.details : {}) as Record<string, unknown>;
      const details: Record<string, unknown> = {};
      if (decision === 'verified') {
        if (type?.dbs) {
          const number = text(raw.certificateNumber, 20).replace(/\s+/g, '');
          if (!/^\d{12}$/.test(number)) throw bad('Give the DBS certificate number (12 digits).');
          if (!isIsoDate(raw.issueDate)) throw bad('Give the DBS issue date.');
          Object.assign(details, { certificateNumber: number, issueDate: raw.issueDate, updateService: raw.updateService === true });
        }
        if (raw.expiresOn) {
          if (!isIsoDate(raw.expiresOn)) throw bad('The expiry or recheck date is not a date.');
          details.expiresOn = raw.expiresOn;
        } else if (type?.expires && !type.dbs) throw bad('Give the date this document expires.');
      }
      const note = text(data.note, 300);
      if (decision === 'rejected' && !note) throw bad('Say why it was not accepted, so they know what to send instead.');
      await ref.update({ status: decision, details, note, verifiedBy: me.uid, verifiedByName: me.name, verifiedAt: FieldValue.serverTimestamp() });
      await audit(db, me, decision === 'verified' ? 'verify-document' : 'reject-document', id, { owner: d.uid, typeId: d.typeId });
      await notify(db, [String(d.uid)], decision === 'verified' ? { title: `${type?.label ?? 'Document'} accepted`, body: 'Thank you: it has been checked.', link: '#documents' } : { title: `${type?.label ?? 'Document'} not accepted`, body: `${note} Please upload it again.`, link: '#documents' });
      return { ok: true };
    }
    case 'settings':
      return { settings: await settingsFrom(db) };
    case 'save-settings': {
      const settings = settingsOf(data.settings);
      await db.collection('portalSettings').doc('main').set({ ...settings, updatedBy: me.uid, updatedAt: FieldValue.serverTimestamp() });
      await audit(db, me, 'save-settings', 'main', { minTraining: settings.minTraining, minPilots: settings.minPilots, retentionDays: settings.retentionDays, docTypes: settings.docTypes.map((t) => t.id) });
      return { settings };
    }
    case 'audit': {
      const snap = await db.collection('portalAudit').orderBy('at', 'desc').limit(Math.min(500, Number(data.limit) || 200)).get();
      return { entries: snap.docs.map((d) => ({ id: d.id, at: iso(d.data().at), by: d.data().byName || d.data().byEmail, action: d.data().action, target: d.data().target, details: d.data().details ?? {} })) };
    }
    default:
      throw bad('Unknown action.');
  }
});

/** The role mirrored to the person's sign-in token (portalRole), alongside any study roles they already have. */
async function setPortalClaim(uid: string, role: Role | null) {
  const auth = getAuth();
  const user = await auth.getUser(uid);
  const claims = { ...(user.customClaims ?? {}) } as Record<string, unknown>;
  if (role) claims.portalRole = role;
  else delete claims.portalRole;
  await auth.setCustomUserClaims(uid, claims);
}

function addMonthsBack(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

/** A UK wall-clock time on a day, as an instant (handles summer time). */
export function ukDateTime(date: string, time: string): Date {
  if (!TIME.test(time)) throw new Error('bad time');
  const [h, m] = time.split(':').map(Number);
  const guess = new Date(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(guess);
  const shown = Number(parts.find((p) => p.type === 'hour')!.value) * 60 + Number(parts.find((p) => p.type === 'minute')!.value);
  return new Date(guess.getTime() - (shown - (h * 60 + m)) * 60_000);
}

/* ── Every day ────────────────────────────────────────────────────────── */

/**
 * Deletes the document copies of anyone archived longer ago than the
 * retention period (the records of what was checked stay), and warns people,
 * and the project manager, about documents running out within the warning
 * window.
 */
export async function housekeeping(db: Firestore, now = new Date()) {
  const settings = await settingsFrom(db);
  const users = (await db.collection('portalUsers').get()).docs.map((d) => ({ uid: d.id, status: d.data().status as UserStatus, archivedAt: iso(d.data().archivedAt), email: String(d.data().email ?? ''), name: String(d.data().name ?? '') }));
  const docsSnap = await db.collection('portalDocs').get();
  const docs = docsSnap.docs.map((d) => docOf(d.id, d.data()));
  const toDelete = copiesToDelete(users, docs, settings, now);
  const bucket = getStorage().bucket();
  for (const id of toDelete) {
    const d = docs.find((x) => x.id === id)!;
    await bucket.file(d.path!).delete({ ignoreNotFound: true });
    await db.collection('portalDocs').doc(id).update({ path: null, deletedAt: FieldValue.serverTimestamp(), deletedReason: `archived over ${settings.retentionDays} days` });
    await db.collection('portalAudit').add({ at: FieldValue.serverTimestamp(), by: 'system', byEmail: '', byName: 'Automatic retention', action: 'delete-copy', target: id, details: { owner: d.uid } });
  }
  const today = ukToday(now);
  const schools = (await db.collection('portalSchools').get()).docs.flatMap((d) => (Array.isArray(d.data().requiredDocs) ? d.data().requiredDocs : []).map(docTypeOf).filter((t: DocType | null): t is DocType => !!t));
  const types = new Map([...settings.docTypes, ...schools].map((t) => [t.id, t]));
  const warnedSnap = await db.collection('portalWarnings').get();
  const warned = new Set(warnedSnap.docs.map((d) => d.id));
  const active = new Set(users.filter((u) => u.status === 'active').map((u) => u.uid));
  const warnings = expiryWarnings(docs.filter((d) => active.has(d.uid)), types, settings, today, warned);
  for (const { doc, until } of warnings) {
    const label = types.get(doc.typeId)?.label ?? 'A document';
    await notify(db, [doc.uid], { title: `${label} runs out on ${until}`, body: 'Please upload a new one so you can keep being booked onto visits.', link: '#documents' });
    const u = users.find((x) => x.uid === doc.uid);
    if (u?.email) await mail(db, u.email, `MyPhone/MyBrain: your ${label.toLowerCase()} runs out on ${until}`, `Hello ${u.name.split(' ')[0] || 'there'},\n\nYour ${label.toLowerCase()} runs out on ${until}. Please upload a new one in the portal so you can keep being booked onto school visits: ${PORTAL_URL}#documents\n\nThe MyPhone/MyBrain team, University of Leeds`, 'expiry');
    await tellTeam(db, { title: `${u?.name ?? 'Someone'}: ${label} runs out on ${until}`, body: 'They have been asked for a new one.', link: `#person/${doc.uid}` }, ['pm']);
    await db.collection('portalWarnings').doc(`${doc.id}|${until}`).set({ at: FieldValue.serverTimestamp() });
  }
  if (toDelete.length || warnings.length) logger.info('Portal housekeeping', { copiesDeleted: toDelete.length, expiryWarnings: warnings.length });
  return { copiesDeleted: toDelete.length, expiryWarnings: warnings.length };
}

export const portalHousekeeping = onSchedule({ region: REGION, schedule: 'every day 06:30', timeZone: 'Europe/London' }, async () => {
  await housekeeping(getFirestore());
});
