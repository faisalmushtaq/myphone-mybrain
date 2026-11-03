import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { schools as siteSchools } from './forms.js';
import { icsForMany, type IcsEvent } from './ics.js';
import { SITE } from './links.js';
import { hashPassword, newSchoolPassword } from './schoolUpload.js';
import { sendMail, type Attachment, type Mail, type MailOutcome } from './mail.js';
import { pushConfigured, pushPublicKey, pushTo, subscriptionId, subscriptionOf } from './push.js';
import { sendSms, ukMobile } from './sms.js';
import {
  changeMessage,
  announcementFor,
  announcementMessage,
  answersAfterChange,
  CANVASS_AVAILABILITY,
  canvassSummary,
  confirmationMessage,
  datesShort,
  coverageFor,
  copiesToDelete,
  countsFor,
  docState,
  docTypeOf,
  eligibilityFor,
  includedDays,
  expiryWarnings,
  isIsoDate,
  isRole,
  latestDocs,
  mayDo,
  normaliseVisit,
  notifyPrefsOf,
  offerMessage,
  planOffers,
  placeOf,
  assignmentOf,
  attendanceDue,
  attendanceProblem,
  buildReport,
  capabilitiesOf,
  changedSince,
  confirmedSnapshot,
  coverageByDay,
  DAY_ROLE_LABEL,
  DEFAULT_SCHOOL_INTRO,
  firstDaysAt,
  teamEmail,
  teamEmailBody,
  teamSnapshot,
  timeNoteFrom,
  travelOn,
  type TeamEmailDay,
  isAttendanceMark,
  isDayRole,
  levelOf,
  offerItemsOf,
  schoolEmail,
  standingOf,
  suggestTeam,
  tagsFor,
  type AttendanceRecord,
  type DayRole,
  type DbsInfo,
  removalMessage,
  removalProblem,
  requirementsFor,
  respond,
  scheduleChanged,
  settingsOf,
  TIME,
  ukToday,
  validUntil,
  validateAvailability,
  validateCanvass,
  validateVisit,
  whenShort,
  VISIT_STATUSES,
  visitStatusAfter,
  type AssignmentStatus,
  type Announcement,
  type Availability,
  type CanvassAnswer,
  type DocType,
  type Eligibility,
  type PortalDoc,
  type Role,
  type Settings,
  type UserStatus,
  type VisitDay,
  type VisitInfo,
  type VisitStatus,
  copyFor,
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
 *   portalNotes/{id}            the team's notes on a person (never shown to research assistants)
 *   portalAttendance/{visit_uid_date}  who turned up on each day of a visit
 *   portalTeamEmails/{id}       each allocations email to the team: who sent it, to whom, the days and who was on them
 *   portalSchoolEmails/{id}     each email to a school about a visit: who sent it, to whom, with DBS details or not, and who was on it
 * Storage
 *   portal/docs/{uid}/{uploadId}  document copies (the owner uploads; only this function reads)
 */

const REGION = 'europe-west2';
const COVER_ORDER = { all: 0, some: 1, unknown: 2, none: 3 } as const;
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

/**
 * An in-portal notification; with `push`, also a push to the person's devices
 * (only the school and dates, never anything personal: `push` is its own text).
 */
async function notify(db: Firestore, uids: string[], note: Note, push?: { title: string; body: string }) {
  const batch = db.batch();
  for (const uid of new Set(uids)) batch.set(db.collection('portalNotifications').doc(), { uid, ...note, read: false, createdAt: FieldValue.serverTimestamp() });
  await batch.commit();
  if (push) await pushTo(db, uids, { title: push.title, body: push.body, link: note.link, tag: note.link });
}

/** The name portal emails come from; the address is always the study's configured sender (mail.ts). */
const PORTAL_SENDER = 'MyPhone/MyBrain team';

/**
 * Sends a portal email from the study's account, copying in the "Always copy
 * in" addresses (not twice, and not on an email only to them), and keeps a
 * record of it. Never throws.
 */
async function send(db: Firestore, message: Omit<Mail, 'fromName'>, kind: string): Promise<MailOutcome> {
  const { alwaysCopy } = await settingsFrom(db);
  const copy = copyFor(alwaysCopy, message);
  const cc = [...(message.cc ? [message.cc] : []), ...copy].join(', ') || undefined;
  const outcome = await sendMail({ ...message, fromName: PORTAL_SENDER, cc });
  await db.collection('portalMail').add({ channel: 'email', to: message.to, ...(cc ? { cc } : {}), ...(message.bcc ? { bcc: message.bcc } : {}), subject: message.subject, kind, outcome, at: FieldValue.serverTimestamp() });
  return outcome;
}

/** Sends an email to one person. Never throws. */
function mail(db: Firestore, to: string, subject: string, body: string, kind: string, attachments?: Attachment[]): Promise<MailOutcome> {
  return send(db, { to, subject, text: body, ...(attachments ? { attachments } : {}) }, kind);
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
  /** Who the team emails at the school about a visit (4 November 2026). */
  contactName: string;
  contactEmails: string[];
  /** Whether emails to this school include DBS details unless the sender turns them off. */
  includeDbs: boolean;
  /** The opening words of the emails to this school, kept from the last one sent. */
  emailIntro: string;
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
      return {
        id: d.id,
        name: String(x.name ?? d.id),
        area: String(x.area ?? ''),
        requiredDocs: (Array.isArray(x.requiredDocs) ? x.requiredDocs : []).map(docTypeOf).filter((t: DocType | null): t is DocType => !!t),
        active: x.active !== false,
        contactName: String(x.contactName ?? ''),
        contactEmails: Array.isArray(x.contactEmails) ? x.contactEmails.map(String) : [],
        includeDbs: x.includeDbs === true,
        emailIntro: String(x.emailIntro ?? ''),
      };
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
    return { id: d.id, kind: x.kind === 'pilot' ? 'pilot' : 'training', role: (isDayRole(x.role) ? x.role : null) as DayRole | null, date: String(x.date ?? ''), title: String(x.title ?? ''), notes: String(x.notes ?? ''), attendees: Array.isArray(x.attendees) ? x.attendees.map(String) : [] };
  });
}

/** A visit as the portal shows it. One saved before 3 November 2026 (one date, a meeting point) reads as a period of one day. */
function visitOf(id: string, x: DocumentData) {
  const n = normaliseVisit(x);
  const on = includedDays(n.days);
  return {
    visitId: id,
    schoolId: String(x.schoolId),
    ...n,
    /** The first and last days the visit runs: for sorting and for what is "coming up". */
    date: on[0]?.date ?? n.startDate,
    lastDate: on.at(-1)?.date ?? n.endDate,
    notes: String(x.notes ?? ''),
    status: (VISIT_STATUSES.includes(x.status) ? x.status : 'draft') as VisitStatus,
    version: Number(x.version ?? 0),
  };
}
type PortalVisit = ReturnType<typeof visitOf>;

/** Visits still running on or after a day (a visit over several days counts until its last). */
async function visitsFrom(db: Firestore, from: string): Promise<PortalVisit[]> {
  return (await db.collection('portalVisits').get()).docs.map((d) => visitOf(d.id, d.data())).filter((v) => v.lastDate >= from);
}

function infoOf(v: PortalVisit, schools: School[]): VisitInfo {
  return { schoolName: schools.find((s) => s.id === v.schoolId)?.name ?? v.schoolId, days: v.days, location: v.location };
}

/** Calendar events for a visit's days: one per day it runs. `who` makes them personal (a research assistant's) or the team's. */
function visitEvents(v: PortalVisit, info: VisitInfo, who: string, opts: { description: string | ((date: string) => string); cancelled?: boolean; days?: VisitDay[]; url: string }): IcsEvent[] {
  return includedDays(opts.days ?? v.days).map((d) => ({
    uid: `portal-${v.visitId}-${d.date}-${who}@myphonemybrain.com`,
    start: ukDateTime(d.date, d.start),
    end: ukDateTime(d.date, d.end),
    summary: `MyPhone/MyBrain school visit: ${info.schoolName}`,
    location: placeOf(info),
    description: typeof opts.description === 'function' ? opts.description(d.date) : opts.description,
    url: opts.url,
    sequence: v.version + (opts.cancelled ? 1 : 0),
    ...(opts.cancelled ? { status: 'cancelled' as const } : {}),
  }));
}
const icsAttachment = (ics: string, filename = 'school-visit.ics'): Attachment => ({ filename, content: ics, contentType: `text/calendar; charset=utf-8; method=${ics.includes('METHOD:CANCEL') ? 'CANCEL' : 'PUBLISH'}` });

/** A visit's places, in today's shape (one saved before 4 November 2026 is EEG on every day). */
async function assignmentsOf(db: Firestore, v: Pick<PortalVisit, 'visitId' | 'days'>) {
  return (await db.collection('portalAssignments').where('visitId', '==', v.visitId).get()).docs.map((d) => {
    const x = d.data();
    return { ...assignmentOf(x, v.days), offeredAt: iso(x.offeredAt), respondedAt: iso(x.respondedAt), override: (x.override ?? null) as { reason: string; byName: string } | null, note: String(x.note ?? ''), removedDates: Array.isArray(x.removedDates) ? x.removedDates.map(String) : [] };
  });
}

/** The visit's days that a place covers. */
const daysOf = (v: Pick<PortalVisit, 'days'>, dates: string[]) => includedDays(v.days).filter((d) => dates.includes(d.date));

/** The team's details about someone: tags, experience, the jobs they do, notes on availability (never for research assistants). */
function teamExtras(x: DocumentData, settings: Settings) {
  // The tags with their names, for the team's lists.
  const ids = tagsFor(x.tags, settings);
  return { tags: settings.tags.filter((t) => ids.includes(t.id)), level: levelOf(x.level), levelReason: String(x.levelReason ?? ''), capabilities: capabilitiesOf(x.capabilities), availabilityNote: String(x.availabilityNote ?? '') };
}

/** Each person's DBS as the project manager checked it (the latest checked one), or nothing. */
function checkedDbs(docs: ReturnType<typeof docOf>[], settings: Settings): Map<string, DbsInfo & { docId: string | null }> {
  const dbsTypes = new Set(settings.docTypes.filter((t) => t.dbs).map((t) => t.id));
  const out = new Map<string, DbsInfo & { docId: string | null; at: string }>();
  for (const d of docs) {
    if (d.status !== 'verified' || !dbsTypes.has(d.typeId) || d.schoolId) continue;
    const had = out.get(d.uid);
    if (had && had.at >= d.uploadedAt) continue;
    out.set(d.uid, { certificateNumber: String(d.details.certificateNumber ?? ''), issueDate: String(d.details.issueDate ?? ''), updateService: d.details.updateService === true, docId: d.path && !d.deletedAt ? d.id : null, at: d.uploadedAt });
  }
  return out;
}

/** The school's web address part: the website's slug for its own schools, else its id in lower case. */
export function schoolSlug(schoolId: string): string {
  return siteSchools.find((s) => s.id === schoolId)?.slug ?? schoolId.toLowerCase();
}
export const schoolDbsLink = (slug: string) => `${SITE}/schools/dbs/?school=${encodeURIComponent(slug)}`;

/** Days someone has attended a school visit (late or leaving early count). */
async function daysAttended(db: Firestore, uid: string): Promise<number> {
  return (await db.collection('portalAttendance').where('uid', '==', uid).get()).docs.filter((d) => isAttendanceMark(d.data().mark) && d.data().mark !== 'absent').length;
}

/** Everyone who answered a provisional visit's dates, with their answers. */
async function canvassOf(db: Firestore, visitId: string) {
  return (await db.collection('portalCanvass').where('visitId', '==', visitId).get()).docs.map((d) => ({ ref: d.ref, uid: String(d.data().uid), answers: (d.data().answers ?? {}) as Record<string, CanvassAnswer> }));
}

/**
 * Tells research assistants about dates: an in-portal note for everyone it
 * concerns, a push and an email as their choices allow for new dates, and
 * always for those it concerns directly (people who answered provisional
 * dates). Push carries only the school and the dates.
 */
async function announce(db: Firestore, v: PortalVisit, schools: School[], kind: Announcement, days: VisitDay[]) {
  const info = infoOf(v, schools);
  const users = (await db.collection('portalUsers').where('status', '==', 'active').get()).docs.filter((d) => d.data().role === 'ra');
  const answers = await canvassOf(db, v.visitId);
  const said = new Map(answers.map((a) => [a.uid, Object.values(a.answers)]));
  const link = `${PORTAL_URL}#offers`;
  // Who it concerns directly: they hear by push and email whatever their choices for new dates.
  const direct = new Set<string>(kind === 'cancelled-provisional' || kind === 'provisional-changed' ? [...said.keys()] : kind === 'confirmed' ? [...said].filter(([, a]) => a.includes('yes') || a.includes('maybe')).map(([uid]) => uid) : []);
  const everyone = kind === 'cancelled-provisional' || kind === 'provisional-changed' ? users.filter((u) => direct.has(u.id)) : users;
  let pushed = 0;
  let emailed = 0;
  // One email per kind, research assistants in blind copy (the "Always copy in" addresses are copied once, not per person).
  const bulk = new Map<Announcement, string[]>();
  for (const u of everyone) {
    const x = u.data();
    const prefs = notifyPrefsOf(x.notifyPrefs);
    // People who said they could do confirmed dates hear "confirmed"; everyone else hears about new dates.
    const theirKind: Announcement = kind === 'confirmed' && !direct.has(u.id) ? 'new-dates' : kind;
    const m = announcementMessage(theirKind, info.schoolName, days, info.location, link, String(x.name ?? '').split(' ')[0] || 'there');
    const always = direct.has(u.id);
    await notify(db, [u.id], m.note);
    if (always || prefs.newDatesPush) pushed += await pushTo(db, [u.id], { ...m.push, link: m.note.link, tag: `dates-${v.visitId}` });
    if ((always || prefs.newDatesEmail) && x.email) {
      bulk.set(theirKind, [...(bulk.get(theirKind) ?? []), String(x.email)]);
      emailed += 1;
    }
  }
  for (const [theirKind, emails] of bulk) {
    const m = announcementMessage(theirKind, info.schoolName, days, info.location, link, 'all');
    await send(db, { to: 'undisclosed-recipients:;', bcc: emails.join(', '), subject: m.email.subject, text: m.email.body }, `dates-${theirKind}`);
  }
  await db.collection('portalAudit').add({ at: FieldValue.serverTimestamp(), by: 'system', byEmail: '', byName: 'Announcements', action: `announce-${kind}`, target: v.visitId, details: { people: everyone.length, pushed, emailed, days: days.map((d) => d.date) } });
  return { people: everyone.length, pushed, emailed };
}

function userRow(id: string, x: DocumentData) {
  return { uid: id, name: String(x.name ?? ''), email: String(x.email ?? ''), phone: String(x.phone ?? ''), role: isRole(x.role) ? x.role : null, requested: x.requested === 'team' ? 'team' : 'ra', status: (x.status ?? 'pending') as UserStatus, smsOptIn: x.smsOptIn === true, notifyPrefs: notifyPrefsOf(x.notifyPrefs), createdAt: iso(x.createdAt), archivedAt: iso(x.archivedAt) };
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
      const notifyPrefs = notifyPrefsOf(data.notifyPrefs);
      await db.collection('portalUsers').doc(me.uid).set({ name, phone, smsOptIn, notifyPrefs, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
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
        visitsFrom(db, today),
      ]);
      const visits = new Map(visitsSnap.map((v) => [v.visitId, v]));
      const counts = countsFor(me.uid, sessions);
      const mine = sessions.filter((s) => s.attendees.includes(me.uid)).map((s) => ({ id: s.id, kind: s.kind, date: s.date, title: s.title }));
      const assignments = assignSnap.docs
        .map((d) => d.data())
        .filter((a) => visits.has(a.visitId) && a.status !== 'withdrawn')
        .map((a) => {
          const v = visits.get(a.visitId)!;
          const place = assignmentOf(a, v.days);
          // Their days only, with their job; never the team's notes or anyone else's place.
          return { ...v, days: daysOf(v, place.dates), schoolName: schools.find((s) => s.id === v.schoolId)?.name ?? v.schoolId, visitStatus: v.status, status: a.status as AssignmentStatus, role: place.role, dates: place.dates, timeNotes: place.timeNotes ?? {}, removedReason: a.status === 'removed' || (Array.isArray(a.removedDates) && a.removedDates.length) ? String(a.removedReason ?? '') : '' };
        })
        .sort((a, b) => a.date.localeCompare(b.date));
      const user = (await db.collection('portalUsers').doc(me.uid).get()).data()!;
      return {
        user: userRow(me.uid, user),
        // Of the team's tags, only "Ready" or "On hold" is shown to the person.
        standing: standingOf(tagsFor(user.tags, settings)),
        daysAttended: await daysAttended(db, me.uid),
        settings: { minTraining: settings.minTraining, minPilots: settings.minPilots, withdrawalContact: settings.withdrawalContact },
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
      const [schools, visitsSnap, interestSnap, canvassSnap] = await Promise.all([schoolsOf(db), visitsFrom(db, today), db.collection('portalInterest').where('uid', '==', me.uid).get(), db.collection('portalCanvass').where('uid', '==', me.uid).get()]);
      const interested = new Set(interestSnap.docs.map((d) => d.data().visitId));
      const mine = new Map(canvassSnap.docs.map((d) => [String(d.data().visitId), (d.data().answers ?? {}) as Record<string, CanvassAnswer>]));
      // Drafts stay with the team; provisional dates are shown, clearly marked, to ask who could do them.
      const visits = visitsSnap
        .filter((v) => v.status === 'staffing' || v.status === 'provisional' || v.status === 'locked')
        .map((v) => ({ ...v, schoolName: schools.find((s) => s.id === v.schoolId)?.name ?? v.schoolId, interested: interested.has(v.visitId), myAnswers: mine.get(v.visitId) ?? {} }))
        .sort((a, b) => a.date.localeCompare(b.date));
      return { visits };
    }
    case 'canvass-answer': {
      // A research assistant's answer to provisional dates, day by day; kept as their availability for those days too.
      const visitId = idOf(data.visitId, 'visit');
      const snap = await db.collection('portalVisits').doc(visitId).get();
      if (!snap.exists) throw bad('That visit is not there.');
      const v = visitOf(visitId, snap.data()!);
      const { answers, problems } = validateCanvass(data.answers, v.days, v.status);
      if (problems.length) throw bad(problems.join(' '));
      const ref = db.collection('portalCanvass').doc(`${visitId}_${me.uid}`);
      const had = ((await ref.get()).data()?.answers ?? {}) as Record<string, CanvassAnswer>;
      await ref.set({ visitId, uid: me.uid, answers: { ...had, ...answers }, updatedAt: FieldValue.serverTimestamp() });
      const schoolName = (await schoolsOf(db)).find((s) => s.id === v.schoolId)?.name ?? v.schoolId;
      const batch = db.batch();
      for (const [date, a] of Object.entries(answers)) batch.set(db.collection('portalAvailability').doc(`${me.uid}_${date}`), { uid: me.uid, date, value: CANVASS_AVAILABILITY[a], note: `Answer for ${schoolName} (provisional)`, visitId, updatedAt: FieldValue.serverTimestamp() });
      await batch.commit();
      await audit(db, me, 'canvass-answer', visitId, { answers });
      return { answers: { ...had, ...answers } };
    }
    case 'push-key':
      return { publicKey: pushPublicKey(), configured: await pushConfigured() };
    case 'push-subscribe': {
      const subscription = subscriptionOf(data.subscription);
      if (!subscription) throw bad('That device could not be set up for notifications.');
      await db.collection('portalPushSubs').doc(me.uid).collection('subs').doc(subscriptionId(subscription.endpoint)).set({ subscription, label: text(data.label, 80), at: FieldValue.serverTimestamp() });
      return { ok: true };
    }
    case 'push-unsubscribe': {
      if (typeof data.endpoint === 'string') await db.collection('portalPushSubs').doc(me.uid).collection('subs').doc(subscriptionId(data.endpoint)).delete();
      return { ok: true };
    }
    case 'push-test': {
      const sent = await pushTo(db, [me.uid], { title: 'MyPhone/MyBrain portal', body: 'Notifications are working on this device.', link: '#profile', tag: 'test' });
      return { sent };
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
        if (problem || !next) {
          if (a.exists && a.data()!.status === 'confirmed') {
            const contact = (await settingsFrom(db)).withdrawalContact;
            throw refused(`You have confirmed this visit, so it cannot be cancelled here. To withdraw, email ${contact.name} at ${contact.email}.`);
          }
          throw bad(problem ?? 'Say confirm or decline.');
        }
        tx.update(ref, { status: next, respondedAt: FieldValue.serverTimestamp(), note: text(data.note, 300) });
        return { next, visit: visitOf(v.id, v.data()!), place: assignmentOf(a.data()!, visitOf(v.id, v.data()!).days) };
      });
      const assignments = await assignmentsOf(db, result.visit);
      const status = visitStatusAfter(result.visit.status, result.visit.days, result.visit.roleNeeds, assignments);
      if (status !== result.visit.status) await visitRef.update({ status, updatedAt: FieldValue.serverTimestamp() });
      const schools = await schoolsOf(db);
      // Their days and job, not the whole visit.
      const info = { ...infoOf(result.visit, schools), days: daysOf(result.visit, result.place.dates) };
      const job = DAY_ROLE_LABEL[result.place.role];
      const when = whenShort(info.days);
      const who = me.name || me.email;
      await audit(db, me, result.next === 'confirmed' ? 'confirm-offer' : 'decline-offer', visitId, { note: text(data.note, 300) });
      if (result.next === 'confirmed') {
        const settings = await settingsFrom(db);
        const m = confirmationMessage(me.name.split(' ')[0] || 'there', info, `${PORTAL_URL}#my-visits`, settings.withdrawalContact, result.place.role);
        const ics = icsForMany(visitEvents(result.visit, info, me.uid, { days: info.days, description: `MyPhone/MyBrain school visit at ${placeOf(info)}. Your role: ${job}. To withdraw, email ${settings.withdrawalContact.name} at ${settings.withdrawalContact.email}.`, url: `${PORTAL_URL}#my-visits` }), new Date(), 'School visits');
        await mail(db, me.email, m.subject, m.email, 'confirmation', [icsAttachment(ics)]);
        await notify(db, [me.uid], { title: `Confirmed: ${info.schoolName} (${job})`, body: `${when}. ${info.location}. A confirmation email with a calendar invitation is on its way.`, link: '#my-visits' });
        await tellTeam(db, { title: `${who} confirmed (${job})`, body: `${info.schoolName} ${when}.`, link: `#visit/${visitId}` });
      } else {
        await tellTeam(db, { title: `${who} declined (${job})`, body: `${info.schoolName} ${when}: a place is open again.${text(data.note, 300) ? ` “${text(data.note, 300)}”` : ''}`, link: `#visit/${visitId}` }, ['pm', 'researcher'], {
          subject: `MyPhone/MyBrain portal: ${who} declined ${info.schoolName} ${when}`,
          body: `${who} declined the place on the visit to ${info.schoolName} ${when}, so a place is open again.\n\nChoose someone else in the portal: ${PORTAL_URL}#visit/${visitId}`,
          kind: 'declined',
        });
      }
      return { status: result.next, visitStatus: status };
    }

    /* ── The research team ── */
    case 'people': {
      const [settings, schools, usersSnap, docs, sessions, attendanceSnap] = await Promise.all([settingsFrom(db), schoolsOf(db), db.collection('portalUsers').get(), docsOf(db), sessionsOf(db), db.collection('portalAttendance').get()]);
      const attendedBy = new Map<string, number>();
      for (const d of attendanceSnap.docs) if (isAttendanceMark(d.data().mark) && d.data().mark !== 'absent') attendedBy.set(String(d.data().uid), (attendedBy.get(String(d.data().uid)) ?? 0) + 1);
      const pm = me.role === 'pm';
      const people = usersSnap.docs
        .map((d) => userRow(d.id, d.data()))
        .filter((u) => pm || u.status === 'active')
        .map((u) => {
          const documents = docSummary(u.uid, docs.filter((d) => d.uid === u.uid), settings, schools, today, false).filter((r) => r.schoolId === null);
          const counts = countsFor(u.uid, sessions);
          const general = eligibilityFor(u.uid, latestDocs(docs), requirementsFor(settings, null), counts, settings, today);
          const raw = usersSnap.docs.find((d) => d.id === u.uid)!.data();
          return { ...u, ...teamExtras(raw, settings), counts, daysAttended: attendedBy.get(u.uid) ?? 0, documents: documents.map((r) => ({ typeId: r.typeId, label: r.label, state: r.state })), ready: general.eligible, reasons: general.reasons, toCheck: documents.filter((r) => r.state === 'uploaded').length };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return { people, settings: { minTraining: settings.minTraining, minPilots: settings.minPilots, tags: settings.tags } };
    }
    case 'person': {
      const uid = idOf(data.uid, 'person');
      const [settings, schools, snap, docs, sessions, availSnap] = await Promise.all([settingsFrom(db), schoolsOf(db), db.collection('portalUsers').doc(uid).get(), docsOf(db, uid), sessionsOf(db), db.collection('portalAvailability').where('uid', '==', uid).where('date', '>=', today).get()]);
      if (!snap.exists) throw bad('That person is not in the portal.');
      const pm = me.role === 'pm';
      const notesSnap = await db.collection('portalNotes').where('uid', '==', uid).get();
      return {
        user: userRow(uid, snap.data()!),
        ...teamExtras(snap.data()!, settings),
        settings: { tags: settings.tags },
        daysAttended: await daysAttended(db, uid),
        notes: notesSnap.docs
          .map((d) => ({ id: d.id, text: String(d.data().text ?? ''), byName: String(d.data().byName ?? ''), mine: d.data().by === me.uid, at: iso(d.data().at) }))
          .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')),
        counts: countsFor(uid, sessions),
        sessions: sessions.filter((s) => s.attendees.includes(uid)).map((s) => ({ id: s.id, kind: s.kind, date: s.date, title: s.title })),
        // The copies, and the certificate details, are the project manager's; the team sees where each document stands.
        documents: docSummary(uid, docs, settings, schools, today, pm),
        history: pm ? docs.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).map((d) => ({ docId: d.id, typeId: d.typeId, schoolId: d.schoolId, status: d.status, uploadedAt: d.uploadedAt, fileName: d.fileName, hasCopy: Boolean(d.path && !d.deletedAt), note: d.note ?? null })) : [],
        availability: availSnap.docs.map((d) => ({ date: d.data().date, value: d.data().value, note: String(d.data().note ?? '') })),
      };
    }
    case 'save-person': {
      // The team's details about someone who signed up: their name and phone as the team keeps them, notes on availability, tags, experience and the jobs they do.
      const uid = idOf(data.uid, 'person');
      const ref = db.collection('portalUsers').doc(uid);
      const snap = await ref.get();
      if (!snap.exists) throw bad('That person is not in the portal.');
      const settings = await settingsFrom(db);
      const before = snap.data()!;
      const patch: Record<string, unknown> = {};
      if (data.name !== undefined) {
        const name = text(data.name, 100);
        if (name.length < 2) throw bad('Give their full name.');
        patch.name = name;
      }
      if (data.phone !== undefined) {
        const phone = text(data.phone, 30);
        if (phone && !ukMobile(phone)) throw bad('Give a UK mobile number, or leave it empty.');
        patch.phone = phone;
      }
      if (data.availabilityNote !== undefined) patch.availabilityNote = text(data.availabilityNote, 500);
      if (data.tags !== undefined) {
        const known = new Set(settings.tags.map((t) => t.id));
        patch.tags = [...new Set((Array.isArray(data.tags) ? data.tags : []).map(String))].filter((t) => known.has(t));
      }
      if (data.level !== undefined) {
        if (data.level !== null && !levelOf(data.level)) throw bad('Choose a level from 1 to 4.');
        patch.level = data.level === null ? null : levelOf(data.level);
        patch.levelReason = text(data.levelReason, 300);
      }
      if (data.capabilities !== undefined) patch.capabilities = capabilitiesOf(data.capabilities);
      if (!Object.keys(patch).length) throw bad('Nothing to save.');
      await ref.set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      const changed = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { from: before[k] ?? null, to: v }]));
      await audit(db, me, 'edit-person', uid, changed);
      return { ok: true };
    }
    case 'add-note': {
      const uid = idOf(data.uid, 'person');
      const note = text(data.text, 2000);
      if (!note) throw bad('Write the note.');
      if (!(await db.collection('portalUsers').doc(uid).get()).exists) throw bad('That person is not in the portal.');
      const ref = await db.collection('portalNotes').add({ uid, text: note, by: me.uid, byName: me.name || me.email, at: FieldValue.serverTimestamp() });
      await audit(db, me, 'add-note', uid, { noteId: ref.id });
      return { id: ref.id };
    }
    case 'delete-note': {
      const id = idOf(data.id, 'note');
      const ref = db.collection('portalNotes').doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw bad('That note is not there.');
      if (snap.data()!.by !== me.uid && me.role !== 'pm') throw refused('Only the person who wrote a note, or the project manager, can delete it.');
      await ref.delete();
      await audit(db, me, 'delete-note', String(snap.data()!.uid), { noteId: id, text: String(snap.data()!.text ?? '').slice(0, 200) });
      return { ok: true };
    }
    case 'schools': {
      const [schools, accessSnap] = await Promise.all([schoolsOf(db), db.collection('schoolDbsAccess').get()]);
      const access = new Map(accessSnap.docs.map((d) => [String(d.data().schoolId ?? ''), d.data()]));
      return {
        schools: schools.map((s) => {
          const a = access.get(s.id);
          return { ...s, dbsAccess: { active: a?.active === true, setAt: iso(a?.setAt), lastViewedAt: iso(a?.lastViewedAt), link: schoolDbsLink(schoolSlug(s.id)) } };
        }),
      };
    }
    case 'save-school': {
      const name = text(data.name, 120);
      if (name.length < 2) throw bad('Give the school’s name.');
      const requiredDocs = (Array.isArray(data.requiredDocs) ? data.requiredDocs : []).map(docTypeOf).filter((t): t is DocType => !!t).slice(0, 10);
      const id = data.id ? idOf(data.id, 'school') : name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || db.collection('portalSchools').doc().id;
      const contactEmails = (Array.isArray(data.contactEmails) ? data.contactEmails : String(data.contactEmails ?? '').split(/[,;\s]+/)).map((e) => String(e).trim().toLowerCase()).filter(Boolean);
      if (contactEmails.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e))) throw bad('One of the school’s email addresses is not valid.');
      await db.collection('portalSchools').doc(id).set({ name, area: text(data.area, 80), requiredDocs, active: data.active !== false, contactName: text(data.contactName, 120), contactEmails: contactEmails.slice(0, 5), includeDbs: data.includeDbs === true, ...(me.role === 'pm' && data.dbsCopies !== undefined ? { dbsCopies: data.dbsCopies === true } : {}), ...(typeof data.emailIntro === 'string' ? { emailIntro: text(data.emailIntro, 2000) } : {}), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
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
      const sessionRole = kind === 'training' && isDayRole(data.role) ? data.role : null;
      await ref.set({ kind, role: sessionRole, date: data.date, title, notes: text(data.notes, 1000), attendees, updatedBy: me.uid, updatedAt: FieldValue.serverTimestamp(), ...(data.id ? {} : { createdBy: me.uid, createdAt: FieldValue.serverTimestamp() }) }, { merge: true });
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
      const [schools, snap] = await Promise.all([schoolsOf(db), visitsFrom(db, text(data.from, 10) || addMonthsBack(today))]);
      const [all, marksSnap] = await Promise.all([db.collection('portalAssignments').get(), db.collection('portalAttendance').get()]);
      const rows = all.docs.map((d) => d.data());
      const withPlaces = snap.map((v) => ({ v, assignments: rows.filter((a) => a.visitId === v.visitId).map((a) => assignmentOf(a, v.days)) }));
      const marked = new Set(marksSnap.docs.map((d) => `${d.data().visitId}|${d.data().uid}|${d.data().date}`));
      const schoolName = (id: string) => schools.find((s) => s.id === id)?.name ?? id;
      return {
        visits: withPlaces
          .map(({ v, assignments }) => {
            // Person-days: each day's places for both jobs, against what is needed.
            const cover = coverageByDay(v.days, v.roleNeeds, assignments);
            const sum = (k: 'need' | 'offered' | 'confirmed') => cover.reduce((n, c) => n + c.eeg[k] + c.copro[k], 0);
            return { ...v, schoolName: schoolName(v.schoolId), needed: sum('need'), confirmed: sum('confirmed'), offered: sum('offered') };
          })
          .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)),
        schools,
        attendanceDue: attendanceDue(withPlaces.filter(({ v }) => v.status !== 'cancelled').map(({ v, assignments }) => ({ visitId: v.visitId, days: v.days, assignments })), marked, today).map((d) => ({ ...d, schoolName: schoolName(withPlaces.find((w) => w.v.visitId === d.visitId)!.v.schoolId) })),
      };
    }
    case 'save-visit': {
      const [schools, visitSettings] = await Promise.all([schoolsOf(db), settingsFrom(db)]);
      const { visit, problems } = validateVisit(data, schools.filter((s) => s.active).map((s) => s.id), today, visitSettings.roleNeeds);
      if (!visit) throw bad(problems.join(' '));
      const ref = data.visitId ? db.collection('portalVisits').doc(idOf(data.visitId, 'visit')) : db.collection('portalVisits').doc();
      const beforeSnap = data.visitId ? await ref.get() : null;
      if (data.visitId && !beforeSnap?.exists) throw bad('That visit is not there.');
      const before = beforeSnap ? visitOf(ref.id, beforeSnap.data()!) : null;
      const on = includedDays(visit.days);
      const change = before ? scheduleChanged(before, { ...visit }) : { changed: false, removedDays: [] as VisitDay[] };
      const version = (before?.version ?? 0) + (change.changed ? 1 : 0);
      // The first and last days it runs are kept too, for sorting; meetingPoint was the place before 3 November 2026.
      await ref.set({ ...visit, date: on[0].date, lastDate: on.at(-1)!.date, meetingPoint: FieldValue.delete(), needed: FieldValue.delete(), version, ...(data.visitId ? {} : { status: 'draft', createdBy: me.uid, createdAt: FieldValue.serverTimestamp() }), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await audit(db, me, data.visitId ? 'update-visit' : 'add-visit', ref.id, { schoolId: visit.schoolId, days: on.map((d) => `${d.date} ${d.start}-${d.end}${d.eeg !== undefined || d.copro !== undefined ? ` (EEG ${d.eeg ?? visit.roleNeeds.eeg}, co-production ${d.copro ?? visit.roleNeeds.copro})` : ''}`), location: visit.location, roleNeeds: visit.roleNeeds });
      if (before && change.changed) {
        // The people confirmed hear about the new days, times or place, with an updated calendar invitation.
        const after = visitOf(ref.id, (await ref.get()).data()!);
        const confirmed = (await assignmentsOf(db, after)).filter((a) => a.status === 'confirmed');
        for (const a of confirmed) {
          // Their days (those still running) and the days of theirs that went.
          const info = { ...infoOf(after, schools), days: daysOf(after, a.dates) };
          const theirRemoved = change.removedDays.filter((d) => a.dates.includes(d.date));
          if (!info.days.length && !theirRemoved.length) continue;
          const u = (await db.collection('portalUsers').doc(a.uid).get()).data() ?? {};
          const m = changeMessage(String(u.name ?? '').split(' ')[0] || 'there', info, theirRemoved, `${PORTAL_URL}#my-visits`);
          const attachments = [icsAttachment(icsForMany(visitEvents(after, info, a.uid, { days: info.days, description: `MyPhone/MyBrain school visit at ${placeOf(info)} (updated). Your role: ${DAY_ROLE_LABEL[a.role]}.`, url: `${PORTAL_URL}#my-visits` }), new Date(), 'School visits'))];
          if (theirRemoved.length) attachments.push(icsAttachment(icsForMany(visitEvents(after, info, a.uid, { description: 'No longer needed.', cancelled: true, days: theirRemoved, url: `${PORTAL_URL}#my-visits` }), new Date(), 'School visits'), 'school-visit-removed-days.ics'));
          await notify(db, [a.uid], { title: `Changed: ${info.schoolName}`, body: `${whenShort(info.days)}. ${info.location}. An updated calendar invitation is in your email.`, link: '#my-visits' }, { title: `Visit changed: ${info.schoolName}`, body: `Now ${datesShort(info.days)}. Check the details in the portal.` });
          if (u.email) await mail(db, String(u.email), m.subject, m.email, 'visit-changed', attachments);
        }
        if (confirmed.length) await audit(db, me, 'visit-change-sent', ref.id, { to: confirmed.map((a) => a.uid) });
      }
      if (before) {
        const after = visitOf(ref.id, (await ref.get()).data()!);
        const ann = announcementFor(before, after);
        if (ann?.kind === 'provisional-changed') {
          // Answers for days that changed or went no longer count: those who answered are asked to check again.
          for (const a of await canvassOf(db, ref.id)) await a.ref.update({ answers: answersAfterChange(a.answers, before.days, after.days), updatedAt: FieldValue.serverTimestamp() });
        }
        if (ann) await announce(db, after, schools, ann.kind, ann.days);
      }
      return { visitId: ref.id };
    }
    case 'set-visit-status': {
      const visitId = idOf(data.visitId, 'visit');
      const status = data.status as VisitStatus;
      if (!VISIT_STATUSES.includes(status)) throw bad('Choose a status.');
      const beforeSnap = await db.collection('portalVisits').doc(visitId).get();
      if (!beforeSnap.exists) throw bad('That visit is not there.');
      const before = visitOf(visitId, beforeSnap.data()!);
      if (status === 'provisional' && (await assignmentsOf(db, before)).some((a) => a.status === 'offered' || a.status === 'confirmed')) throw bad('Places have already been offered: a visit with offers cannot go back to provisional.');
      await db.collection('portalVisits').doc(visitId).update({ status, updatedAt: FieldValue.serverTimestamp() });
      await audit(db, me, 'visit-status', visitId, { status, was: before.status });
      const ann = announcementFor(before, { status, days: before.days });
      const announced = ann ? await announce(db, { ...before, status }, await schoolsOf(db), ann.kind, ann.days) : null;
      if (status === 'cancelled') {
        const people = (await assignmentsOf(db, before)).filter((a) => a.status === 'offered' || a.status === 'confirmed').map((a) => a.uid);
        await notify(db, people, { title: 'A school visit was cancelled', body: 'A visit you were offered or confirmed for is cancelled. See your visits in the portal.', link: '#my-visits' }, { title: 'School visit cancelled', body: 'A visit you were offered or confirmed for is cancelled.' });
      }
      return { ok: true, announced };
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
        db.collection('portalAvailability').where('date', '>=', v.date).where('date', '<=', v.lastDate).get(),
        db.collection('portalInterest').where('visitId', '==', visitId).get(),
        assignmentsOf(db, v),
      ]);
      const [attendanceSnap, emailsSnap, teamSnap, rawPlaces] = await Promise.all([db.collection('portalAttendance').where('visitId', '==', visitId).get(), db.collection('portalSchoolEmails').where('visitId', '==', visitId).get(), db.collection('portalTeamEmails').where('schoolId', '==', v.schoolId).get(), db.collection('portalAssignments').where('visitId', '==', visitId).get()]);
      // What the team sees beside a place: the person's note when answering, and why they were booked without being ready.
      const placeExtras = new Map(rawPlaces.docs.map((d) => [String(d.data().uid), { note: String(d.data().note ?? ''), override: d.data().override ? { reason: String(d.data().override.reason ?? ''), byName: String(d.data().override.byName ?? '') } : null, removedReason: String(d.data().removedReason ?? '') }]));
      const school = schools.find((s) => s.id === v.schoolId) ?? null;
      const requirements = requirementsFor(settings, school);
      const latest = latestDocs(docs);
      // Each person's availability on each day the visit runs.
      const availOf = new Map<string, Map<string, Availability>>();
      const notesOf = new Map<string, string[]>();
      for (const d of availSnap.docs) {
        const x = d.data();
        const uid = String(x.uid);
        if (!availOf.has(uid)) availOf.set(uid, new Map());
        availOf.get(uid)!.set(String(x.date), x.value as Availability);
        if (x.note && !x.visitId) notesOf.set(uid, [...(notesOf.get(uid) ?? []), `${x.date}: ${x.note}`]);
      }
      const interested = new Set(interestSnap.docs.map((d) => String(d.data().uid)));
      const candidates = usersSnap.docs
        .filter((d) => d.data().role === 'ra')
        .map((d) => {
          const counts = countsFor(d.id, sessions);
          // Documents must be in date on every day it runs: the last day decides.
          const e = eligibilityFor(d.id, latest, requirements, counts, settings, v.lastDate);
          const cover = coverageFor(v.days, availOf.get(d.id) ?? new Map());
          const extras = teamExtras(d.data(), settings);
          // The place that counts: an open or confirmed one, else the latest answer.
          const place = assignments.find((a) => a.uid === d.id && (a.status === 'offered' || a.status === 'confirmed')) ?? assignments.find((a) => a.uid === d.id) ?? null;
          return { uid: d.id, name: String(d.data().name ?? ''), email: String(d.data().email ?? ''), ...extras, perDay: cover.perDay, coverage: cover.coverage, availableDates: cover.availableDates, availabilityNote: [extras.availabilityNote, ...(notesOf.get(d.id) ?? [])].filter(Boolean).join(' · '), interested: interested.has(d.id), counts, eligible: e.eligible, reasons: e.reasons, assignment: place ? { ...place, ...(placeExtras.get(d.id) ?? { note: '', override: null, removedReason: '' }) } : null };
        })
        .sort((a, b) => Number(b.eligible) - Number(a.eligible) || COVER_ORDER[a.coverage] - COVER_ORDER[b.coverage] || (b.level ?? 0) - (a.level ?? 0) || b.availableDates.length - a.availableDates.length || Number(b.interested) - Number(a.interested) || a.name.localeCompare(b.name));
      const ras = usersSnap.docs.filter((d) => d.data().role === 'ra').map((d) => ({ uid: d.id, name: String(d.data().name ?? d.data().email ?? '') }));
      const answered = await canvassOf(db, visitId);
      const canvass = answered.length || v.status === 'provisional' ? canvassSummary(v.days, answered.map((a) => ({ uid: a.uid, name: ras.find((r) => r.uid === a.uid)?.name ?? a.uid, answers: a.answers })), ras) : null;
      const suggestion = v.status === 'staffing' || v.status === 'draft' || v.status === 'locked' ? suggestTeam({ days: v.days, roleNeeds: v.roleNeeds, assignments, candidates: candidates.map((c) => ({ uid: c.uid, name: c.name, eligible: c.eligible, capabilities: c.capabilities, level: c.level, training: c.counts.training, pilots: c.counts.pilots, availableDates: c.availableDates })) }) : [];
      const attendance = attendanceSnap.docs.map((d) => ({ uid: String(d.data().uid), date: String(d.data().date), mark: d.data().mark, note: String(d.data().note ?? '') }));
      const sent = emailsSnap.docs.map((d) => ({ at: iso(d.data().at), byName: String(d.data().byName ?? ''), to: (d.data().to ?? []) as string[], includeDbs: d.data().includeDbs === true, snapshot: (d.data().snapshot ?? {}) as Record<string, string[]> })).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
      const now = confirmedSnapshot(v.days, assignments);
      return {
        visit: { ...v, schoolName: school?.name ?? v.schoolId, requiredDocs: requirements.map((r) => r.type.label), schoolEmails: school?.contactEmails ?? [] },
        candidates,
        canvass,
        coverage: coverageByDay(v.days, v.roleNeeds, assignments),
        suggestion,
        attendance,
        teamEmail: (() => {
          // The last allocations email covering this visit's days, and whether who is on them has changed since.
          const nowTeam = teamSnapshot(includedDays(v.days).map((d) => ({ date: d.date, people: assignments.filter((a) => a.status === 'confirmed' && a.dates.includes(d.date)).map((a) => ({ uid: a.uid, role: a.role, ...(a.timeNotes?.[d.date] ? { note: a.timeNotes[d.date] } : {}) })) })));
          const last = teamSnap.docs.map((d) => d.data()).filter((e) => Object.keys(nowTeam).some((date) => (e.snapshot ?? {})[date])).sort((a, b) => (iso(b.at) ?? '').localeCompare(iso(a.at) ?? ''))[0];
          return last ? { lastAt: iso(last.at), lastBy: String(last.byName ?? ''), changedSince: Object.keys(nowTeam).some((date) => (last.snapshot ?? {})[date] && JSON.stringify(last.snapshot[date]) !== JSON.stringify(nowTeam[date])) } : null;
        })(),
        schoolEmail: sent[0] ? { lastAt: sent[0].at, lastBy: sent[0].byName, lastTo: sent[0].to, lastIncludedDbs: sent[0].includeDbs, changedSince: changedSince(sent[0].snapshot, now) } : null,
        mayOverride: me.role === 'pm',
        mayRemove: me.role === 'pm',
      };
    }
    case 'offer': {
      // Places: a person, a job (EEG or co-production) and the days (4 November 2026).
      const visitId = idOf(data.visitId, 'visit');
      const visitRef = db.collection('portalVisits').doc(visitId);
      const snap = await visitRef.get();
      if (!snap.exists) throw bad('That visit is not there.');
      const v = visitOf(visitId, snap.data()!);
      const [settings, schools, usersSnap, docs, sessions, assignments] = await Promise.all([settingsFrom(db), schoolsOf(db), db.collection('portalUsers').where('status', '==', 'active').get(), docsOf(db), sessionsOf(db), assignmentsOf(db, v)]);
      const school = schools.find((s) => s.id === v.schoolId) ?? null;
      const ras = usersSnap.docs.filter((d) => d.data().role === 'ra');
      const requirements = requirementsFor(settings, school);
      const latest = latestDocs(docs);
      const eligible = new Map<string, Eligibility>(ras.map((d) => [d.id, eligibilityFor(d.id, latest, requirements, countsFor(d.id, sessions), settings, v.lastDate)]));
      const capabilities = new Map<string, DayRole[]>(ras.map((d) => [d.id, capabilitiesOf(d.data().capabilities)]));
      const overrides = (data.overrides && typeof data.overrides === 'object' ? data.overrides : {}) as Record<string, string>;
      const chosen = offerItemsOf(data.offers);
      const plan = planOffers(chosen, { days: v.days, roleNeeds: v.roleNeeds, assignments, active: new Set(ras.map((d) => d.id)), eligible, capabilities, overrides, mayOverride: me.role === 'pm', visitStatus: v.status });
      if (plan.problems.length) throw bad(plan.problems.join(' '));
      const needsOverride = (o: { uid: string; role: DayRole }) => !eligible.get(o.uid)?.eligible || !(capabilities.get(o.uid) ?? []).includes(o.role);
      // A time note for a day the person can do only part of ("morning only"), unless the team wrote its own.
      const availSnap = await db.collection('portalAvailability').where('date', '>=', v.date).where('date', '<=', v.lastDate).get();
      const dayOf = new Map(availSnap.docs.map((d) => [`${d.data().uid}|${d.data().date}`, d.data().value as Availability]));
      const batch = db.batch();
      for (const o of plan.offer) {
        const reason = needsOverride(o) ? text(overrides[o.uid], 300) : '';
        const timeNotes = Object.fromEntries(o.dates.map((d) => [d, o.timeNotes?.[d] ?? timeNoteFrom(dayOf.get(`${o.uid}|${d}`)) ?? '']).filter(([, n]) => n));
        batch.set(db.collection('portalAssignments').doc(`${visitId}_${o.uid}`), { visitId, uid: o.uid, role: o.role, dates: o.dates, timeNotes, status: 'offered', offeredAt: FieldValue.serverTimestamp(), offeredBy: me.uid, respondedAt: null, remindedAt: null, note: '', removedDates: [], removedReason: null, override: reason ? { reason, by: me.uid, byName: me.name } : null });
      }
      await batch.commit();
      const after = await assignmentsOf(db, v);
      await visitRef.update({ status: visitStatusAfter(v.status, v.days, v.roleNeeds, after), updatedAt: FieldValue.serverTimestamp() });
      for (const o of plan.offer) {
        const u = ras.find((d) => d.id === o.uid)!.data();
        const info: VisitInfo = { schoolName: school?.name ?? v.schoolId, days: daysOf(v, o.dates), location: v.location };
        const job = DAY_ROLE_LABEL[o.role];
        const m = offerMessage(String(u.name ?? '').split(' ')[0] || 'there', info, `${PORTAL_URL}#offers`, o.role);
        await notify(db, [o.uid], { title: m.title, body: m.body, link: '#offers' }, { title: `You've been selected: ${info.schoolName}`, body: `${job}, ${datesShort(info.days)}. Please confirm or decline.` });
        await mail(db, String(u.email), m.subject, m.email, 'offer');
        await text_(db, u, `MyPhone/MyBrain: you're selected for ${info.schoolName} ${whenShort(info.days)} (${job}). Please confirm in the portal: ${PORTAL_URL}`, 'offer');
        const reason = needsOverride(o) ? text(overrides[o.uid], 300) : '';
        await audit(db, me, reason ? 'offer-override' : 'offer', visitId, { uid: o.uid, role: o.role, dates: o.dates, ...(reason ? { reason, reasons: eligible.get(o.uid)?.reasons ?? [] } : {}) });
      }
      return { offered: plan.offer.length };
    }
    case 'withdraw-offer':
    case 'remove-confirmed': {
      // An offer not yet answered: the research team can withdraw it. A confirmed place: only the project manager, with a reason (research assistants email them to withdraw).
      const visitId = idOf(data.visitId, 'visit');
      const uid = idOf(data.uid, 'person');
      const reason = text(data.reason, 500);
      const ref = db.collection('portalAssignments').doc(`${visitId}_${uid}`);
      const visitRef = db.collection('portalVisits').doc(visitId);
      const [a, vSnap] = await Promise.all([ref.get(), visitRef.get()]);
      if (!vSnap.exists) throw bad('That visit is not there.');
      const v = visitOf(visitId, vSnap.data()!);
      const held = a.exists ? assignmentOf(a.data()!, v.days) : null;
      // The project manager can take someone off some of their days, or all of them (the default).
      const chosenDates = action === 'remove-confirmed' && Array.isArray(data.dates) && data.dates.length ? [...new Set(data.dates.map(String))] : null;
      const problem = removalProblem(held?.status, action as 'withdraw-offer' | 'remove-confirmed', me.role!, reason, chosenDates && held ? { chosen: chosenDates, held: held.dates } : undefined);
      if (problem) throw (problem.startsWith('Only') || problem.startsWith('They have confirmed') ? refused(problem) : bad(problem));
      const removing = action === 'remove-confirmed';
      const goneDates = removing ? (chosenDates ?? held!.dates) : held!.dates;
      const keptDates = removing ? held!.dates.filter((d) => !goneDates.includes(d)) : [];
      const prevRemoved = Array.isArray(a.data()!.removedDates) ? a.data()!.removedDates.map(String) : [];
      if (removing && keptDates.length) await ref.update({ dates: keptDates, removedDates: [...prevRemoved, ...goneDates], removedReason: reason, removedBy: me.uid, removedByName: me.name, removedAt: FieldValue.serverTimestamp() });
      else await ref.update({ status: removing ? 'removed' : 'withdrawn', respondedAt: FieldValue.serverTimestamp(), ...(removing ? { removedDates: [...prevRemoved, ...goneDates], removedReason: reason, removedBy: me.uid, removedByName: me.name, removedAt: FieldValue.serverTimestamp() } : {}) });
      const status = visitStatusAfter(v.status, v.days, v.roleNeeds, await assignmentsOf(db, v));
      await visitRef.update({ status, updatedAt: FieldValue.serverTimestamp() });
      const schools = await schoolsOf(db);
      const info = { ...infoOf(v, schools), days: daysOf(v, goneDates) };
      const when = whenShort(info.days);
      const u = (await db.collection('portalUsers').doc(uid).get()).data() ?? {};
      const theirName = String(u.name ?? '') || 'Someone';
      if (removing) {
        const m = removalMessage(theirName.split(' ')[0] || 'there', info, reason, `${PORTAL_URL}#my-visits`, daysOf(v, keptDates));
        await notify(db, [uid], { title: `No longer booked: ${info.schoolName}`, body: `${when}. Reason: ${reason}`, link: '#my-visits' }, { title: `No longer booked: ${info.schoolName}`, body: `${datesShort(info.days)}. See the email for details.` });
        if (u.email) await mail(db, String(u.email), m.subject, m.email, 'removed', [icsAttachment(icsForMany(visitEvents(v, info, uid, { days: info.days, description: `Removed: ${reason}`, cancelled: true, url: `${PORTAL_URL}#my-visits` }), new Date(), 'School visits'))]);
        await tellTeam(db, { title: `${theirName} removed from ${info.schoolName}${keptDates.length ? ' (some days)' : ''}`, body: `${when}: a place is open again. Reason: ${reason}`, link: `#visit/${visitId}` });
        await audit(db, me, 'remove-confirmed', visitId, { uid, reason, dates: goneDates, kept: keptDates });
      } else {
        await notify(db, [uid], { title: 'A school visit offer was withdrawn', body: `${info.schoolName} ${when}: the place is no longer needed. Sorry for the change.`, link: '#my-visits' });
        await audit(db, me, 'withdraw-offer', visitId, { uid });
      }
      return { ok: true, visitStatus: status };
    }
    case 'set-time-note': {
      // A note on someone's times on a day ("until 1:00 pm"), shown in brackets after their name in the team's emails.
      const visitId = idOf(data.visitId, 'visit');
      const uid = idOf(data.uid, 'person');
      const date = String(data.date ?? '');
      const ref = db.collection('portalAssignments').doc(`${visitId}_${uid}`);
      const snap = await ref.get();
      if (!snap.exists || !(Array.isArray(snap.data()!.dates) ? snap.data()!.dates : []).includes(date)) throw bad('They have no place on that day.');
      const note = text(data.note, 60);
      await ref.update({ [`timeNotes.${date}`]: note ? note : FieldValue.delete() });
      await audit(db, me, 'set-time-note', visitId, { uid, date, note });
      return { ok: true };
    }
    case 'team-email-preview':
    case 'send-team-email': {
      // The allocations email to the team: a visit, or a school between two dates.
      const [schools, usersSnap, visitsSnap, assignSnap, sentSnap, meSnap] = await Promise.all([schoolsOf(db), db.collection('portalUsers').get(), db.collection('portalVisits').get(), db.collection('portalAssignments').get(), db.collection('portalTeamEmails').get(), db.collection('portalUsers').doc(me.uid).get()]);
      const all = visitsSnap.docs.map((d) => visitOf(d.id, d.data()));
      let schoolId: string;
      let from: string;
      let to: string;
      if (data.visitId) {
        const v = all.find((x) => x.visitId === data.visitId);
        if (!v) throw bad('That visit is not there.');
        schoolId = v.schoolId;
        from = v.date;
        to = v.lastDate;
      } else {
        schoolId = idOf(data.schoolId, 'school');
        if (!isIsoDate(data.from) || !isIsoDate(data.to) || data.to < data.from) throw bad('Give the first and last dates.');
        from = data.from;
        to = data.to;
      }
      const school = schools.find((s) => s.id === schoolId);
      if (!school) throw bad('That school is not in the portal.');
      const schoolVisits = all.filter((v) => v.schoolId === schoolId && v.status !== 'cancelled' && v.status !== 'draft' && v.status !== 'provisional');
      const placesOf = (v: (typeof all)[number]) => assignSnap.docs.filter((d) => d.data().visitId === v.visitId).map((d) => assignmentOf(d.data(), v.days));
      const days: TeamEmailDay[] = [];
      const visitIds: string[] = [];
      for (const v of schoolVisits) {
        const places = placesOf(v);
        for (const d of includedDays(v.days)) {
          if (d.date < from || d.date > to) continue;
          if (!visitIds.includes(v.visitId)) visitIds.push(v.visitId);
          days.push({ date: d.date, travel: travelOn(d, v.travel), people: places.filter((a) => a.status === 'confirmed' && a.dates.includes(d.date)).map((a) => ({ uid: a.uid, role: a.role, ...(a.timeNotes?.[d.date] ? { note: a.timeNotes[d.date] } : {}) })) });
        }
      }
      if (!days.length) throw bad('No visit days at that school in those dates.');
      const snapshot = teamSnapshot(days);
      const previous = sentSnap.docs.map((d) => d.data()).filter((e) => e.schoolId === schoolId && Object.keys(snapshot).some((date) => (e.snapshot ?? {})[date])).sort((a, b) => (iso(b.at) ?? '').localeCompare(iso(a.at) ?? ''))[0];
      const changed = Boolean(previous && Object.keys(snapshot).some((date) => (previous.snapshot ?? {})[date] && JSON.stringify(previous.snapshot[date]) !== JSON.stringify(snapshot[date])));
      const update = data.update === true || changed;
      const names = new Map(usersSnap.docs.map((d) => [d.id, String(d.data().name ?? d.data().email ?? '')]));
      const firstDays = firstDaysAt(all.filter((v) => v.schoolId === schoolId).flatMap(placesOf));
      const mine = meSnap.data() ?? {};
      const made = teamEmail({ schoolName: school.name, days, names, showRoles: data.showRoles === true, firstDays, update, intro: String(mine.teamIntro ?? ''), closing: String(mine.teamClosing ?? ''), sender: me.name || me.email });
      // Sections the sender edited replace the made ones.
      const edited = (data.sections && typeof data.sections === 'object' ? data.sections : {}) as Record<string, unknown>;
      const sections = Object.fromEntries(Object.entries(made).map(([k, v]) => [k, typeof edited[k] === 'string' ? text(edited[k], 8000) : v])) as typeof made;
      const confirmedUids = [...new Set(days.flatMap((d) => d.people.map((p) => p.uid)))];
      const team = (await teamOf(db)).filter((t) => t.email);
      const recipients = [...new Map([...confirmedUids.map((uid) => ({ uid, email: String(usersSnap.docs.find((d) => d.id === uid)?.data().email ?? ''), name: names.get(uid) ?? uid })), ...(data.includeTeam === true ? team : [])].filter((r) => r.email).map((r) => [r.email, r])).values()];
      if (action === 'team-email-preview') {
        return { schoolId, schoolName: school.name, from, to, sections, made, update, recipients: recipients.map((r) => ({ name: r.name, email: r.email })), lastSent: previous ? { at: iso(previous.at), byName: String(previous.byName ?? '') } : null, changed };
      }
      if (!recipients.length) throw bad('Nobody is confirmed in those dates yet.');
      const body = teamEmailBody(sections);
      const mode = data.mode === 'bcc' ? 'bcc' : 'individual';
      const outcomes: MailOutcome[] = [];
      // One email with everyone in blind copy, or one each; either way the "Always copy in" addresses get one copy, not one per person.
      if (mode === 'bcc') outcomes.push(await send(db, { to: me.email, bcc: recipients.map((r) => r.email).join(', '), replyTo: me.email, subject: sections.subject, text: body.text, html: body.html }, 'team-allocations'));
      else {
        const { alwaysCopy } = await settingsFrom(db);
        for (const r of recipients) {
          const outcome = await sendMail({ to: r.email, fromName: PORTAL_SENDER, replyTo: me.email, subject: sections.subject, text: body.text, html: body.html });
          await db.collection('portalMail').add({ channel: 'email', to: r.email, subject: sections.subject, kind: 'team-allocations', outcome, at: FieldValue.serverTimestamp() });
          outcomes.push(outcome);
        }
        const copy = copyFor(alwaysCopy, { to: recipients.map((r) => r.email) });
        if (copy.length) {
          const note = `(A copy: this email was sent individually to ${recipients.map((r) => r.name).join(', ')}.)\n\n`;
          await send(db, { to: copy.join(', '), replyTo: me.email, subject: sections.subject, text: note + body.text, html: `<p><em>${note.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;')}</em></p>${body.html}` }, 'team-allocations-copy');
        }
      }
      await db.collection('portalTeamEmails').add({ schoolId, from, to, visitIds, snapshot, by: me.uid, byName: me.name, at: FieldValue.serverTimestamp(), recipients: recipients.map((r) => r.email), mode, update });
      const range = `${datesShort(days.map((d) => ({ date: d.date, on: true, start: '', end: '' })))}`;
      await notify(db, recipients.map((r) => (r as { uid?: string }).uid).filter((u): u is string => !!u), { title: `Team allocations: ${school.name}`, body: `Team allocations for ${school.name} ${range} have been sent. Check your email.`, link: '#my-visits' }, { title: `Team allocations: ${school.name}`, body: `Team allocations for ${school.name} ${range} have been sent.` });
      if (data.saveTemplates === true) await db.collection('portalUsers').doc(me.uid).set({ ...(typeof edited.intro === 'string' && !update ? { teamIntro: text(edited.intro, 2000) } : {}), ...(typeof edited.closing === 'string' ? { teamClosing: text(edited.closing, 2000) } : {}) }, { merge: true });
      await audit(db, me, 'email-team', schoolId, { from, to, recipients: recipients.length, mode, update, showRoles: data.showRoles === true });
      return { sent: recipients.length, mode };
    }
    case 'mark-attendance': {
      // After a visit day: who came (late or leaving early still counts), who did not.
      const visitId = idOf(data.visitId, 'visit');
      const snap = await db.collection('portalVisits').doc(visitId).get();
      if (!snap.exists) throw bad('That visit is not there.');
      const v = visitOf(visitId, snap.data()!);
      const date = String(data.date ?? '');
      const places = await assignmentsOf(db, v);
      const confirmedThatDay = new Set(places.filter((a) => a.status === 'confirmed' && a.dates.includes(date)).map((a) => a.uid));
      const marks = (Array.isArray(data.marks) ? data.marks : []).filter((m): m is Record<string, unknown> => !!m && typeof m === 'object').map((m) => ({ uid: String(m.uid ?? ''), mark: m.mark, note: text(m.note, 300) }));
      const problem = attendanceProblem(v.days.find((d) => d.date === date), today, confirmedThatDay, marks);
      if (problem) throw bad(problem);
      const batch = db.batch();
      for (const m of marks) batch.set(db.collection('portalAttendance').doc(`${visitId}_${m.uid}_${date}`), { visitId, uid: m.uid, date, mark: m.mark, note: m.note, role: places.find((a) => a.uid === m.uid)?.role ?? null, by: me.uid, byName: me.name, at: FieldValue.serverTimestamp() });
      await batch.commit();
      await audit(db, me, 'mark-attendance', visitId, { date, marks: marks.map((m) => `${m.uid}: ${m.mark}`) });
      return { marked: marks.length };
    }
    case 'report': {
      const from = isIsoDate(data.from) ? data.from : addMonthsBack(today);
      const to = isIsoDate(data.to) ? data.to : today;
      const [schools, visitsSnap, attendanceSnap, usersSnap, assignSnap] = await Promise.all([schoolsOf(db), db.collection('portalVisits').get(), db.collection('portalAttendance').where('date', '>=', from).where('date', '<=', to).get(), db.collection('portalUsers').get(), db.collection('portalAssignments').get()]);
      const all = assignSnap.docs.map((d) => d.data());
      const visits = visitsSnap.docs
        .map((d) => visitOf(d.id, d.data()))
        .filter((v) => v.status !== 'cancelled' && v.lastDate >= from && v.date <= to)
        .map((v) => ({ visitId: v.visitId, schoolId: v.schoolId, schoolName: schools.find((s) => s.id === v.schoolId)?.name ?? v.schoolId, days: v.days, roleNeeds: v.roleNeeds, assignments: all.filter((a) => a.visitId === v.visitId).map((a) => assignmentOf(a, v.days)) }));
      const attendance: AttendanceRecord[] = attendanceSnap.docs.filter((d) => isAttendanceMark(d.data().mark)).map((d) => ({ visitId: String(d.data().visitId), uid: String(d.data().uid), date: String(d.data().date), mark: d.data().mark, note: String(d.data().note ?? '') }));
      const people = usersSnap.docs.map((d) => ({ uid: d.id, name: String(d.data().name ?? d.data().email ?? '') }));
      const report = buildReport({ visits, attendance, people, from, to, schoolId: typeof data.schoolId === 'string' && data.schoolId ? data.schoolId : null, uid: typeof data.uid === 'string' && data.uid ? data.uid : null });
      return { from, to, ...report, schools: schools.map((s) => ({ id: s.id, name: s.name })), people: report.people, everyone: people.filter((p) => usersSnap.docs.find((d) => d.id === p.uid)?.data().role === 'ra').sort((a, b) => a.name.localeCompare(b.name)) };
    }
    case 'school-email-preview':
    case 'send-school-email': {
      // The email to a school: the days, the place and who is coming each day (names only); with DBS details on, a link to the school's DBS page (never the numbers).
      const visitId = idOf(data.visitId, 'visit');
      const snap = await db.collection('portalVisits').doc(visitId).get();
      if (!snap.exists) throw bad('That visit is not there.');
      const v = visitOf(visitId, snap.data()!);
      const [settings, schools, places, usersSnap, docs, sentSnap] = await Promise.all([settingsFrom(db), schoolsOf(db), assignmentsOf(db, v), db.collection('portalUsers').get(), docsOf(db), db.collection('portalSchoolEmails').where('visitId', '==', visitId).get()]);
      const school = schools.find((s) => s.id === v.schoolId);
      if (!school) throw bad('That school is not in the portal.');
      const slug = schoolSlug(school.id);
      const access = (await db.collection('schoolDbsAccess').doc(slug).get()).data();
      const includeDbs = typeof data.includeDbs === 'boolean' ? data.includeDbs : school.includeDbs;
      const intro = typeof data.intro === 'string' ? text(data.intro, 2000) : school.emailIntro || DEFAULT_SCHOOL_INTRO;
      const snapshot = confirmedSnapshot(v.days, places);
      const last = sentSnap.docs.map((d) => d.data()).sort((a, b) => (iso(b.at) ?? '').localeCompare(iso(a.at) ?? ''))[0];
      const update = data.update === true || Boolean(last && changedSince((last.snapshot ?? {}) as Record<string, string[]>, snapshot));
      const names = new Map(usersSnap.docs.map((d) => [d.id, String(d.data().name ?? d.data().email ?? '')]));
      const dbs = checkedDbs(docs, settings);
      const team = { name: settings.withdrawalContact.name, email: settings.withdrawalContact.email };
      const m = schoolEmail({ schoolName: school.name, contactName: school.contactName, location: v.location, days: v.days, people: names, snapshot, intro, team, dbsPage: includeDbs ? { url: schoolDbsLink(slug), contactName: settings.withdrawalContact.name, contactEmail: settings.withdrawalContact.email } : null, dbsChecked: new Set(dbs.keys()), update });
      const warnings = [
        ...(!school.contactEmails.length ? ['The school has no email address: add one under Schools.'] : []),
        ...(includeDbs && access?.active !== true ? ['The school has no DBS page password yet, so it cannot open the DBS page. The project manager can make one under Schools.'] : []),
        ...(includeDbs && m.dbsMissing.length ? [`Not yet DBS-checked by the project manager: ${m.dbsMissing.join(', ')}. The DBS page shows them as “DBS being checked”.`] : []),
        ...(!m.people ? ['Nobody is confirmed for this visit yet.'] : []),
      ];
      if (action === 'school-email-preview') {
        const ccNow = [...new Set([me.email, settings.withdrawalContact.email.toLowerCase()])];
        return { to: school.contactEmails, cc: [...ccNow, ...copyFor(settings.alwaysCopy, { to: school.contactEmails, cc: ccNow })], subject: m.subject, body: m.body, intro, includeDbs, warnings, hasDbsPassword: access?.active === true, update, lastSent: last ? { at: iso(last.at), byName: String(last.byName ?? ''), to: last.to ?? [], includeDbs: last.includeDbs === true } : null };
      }
      if (!school.contactEmails.length) throw bad('Add the school’s email address under Schools first.');
      if (!m.people) throw bad('Nobody is confirmed for this visit yet.');
      if (includeDbs && access?.active !== true) throw bad('The school has no DBS page password yet. Make one under Schools (project manager), or turn off DBS details.');
      const cc = [...new Set([me.email, settings.withdrawalContact.email.toLowerCase()])].join(', ');
      const outcome = await send(db, { to: school.contactEmails.join(', '), cc, replyTo: me.email, subject: m.subject, text: m.body }, 'school');
      await db.collection('portalSchoolEmails').add({ visitId, schoolId: school.id, by: me.uid, byName: me.name, at: FieldValue.serverTimestamp(), to: school.contactEmails, cc, includeDbs, update, snapshot, outcome });
      if (data.saveIntro !== false) await db.collection('portalSchools').doc(school.id).set({ emailIntro: intro }, { merge: true });
      await audit(db, me, 'email-school', visitId, { schoolId: school.id, to: school.contactEmails, includeDbs, update, people: m.people });
      return { outcome, subject: m.subject };
    }
    case 'visit-ics':
    case 'visits-ics': {
      // Calendar files for the team: one visit, or every visit coming up, one event per day, with the place and who is confirmed.
      const schools = await schoolsOf(db);
      const visits = action === 'visit-ics' ? [await (async () => {
        const snap = await db.collection('portalVisits').doc(idOf(data.visitId, 'visit')).get();
        if (!snap.exists) throw bad('That visit is not there.');
        return visitOf(snap.id, snap.data()!);
      })()] : (await visitsFrom(db, today)).filter((v) => v.status !== 'cancelled' && v.status !== 'done');
      const names = new Map((await db.collection('portalUsers').get()).docs.map((d) => [d.id, String(d.data().name ?? d.data().email ?? '')]));
      const events: IcsEvent[] = [];
      for (const v of visits) {
        const info = infoOf(v, schools);
        const places = (await assignmentsOf(db, v)).filter((a) => a.status === 'confirmed');
        const cover = coverageByDay(v.days, v.roleNeeds, places);
        // Each day's entry says who is on it, by job.
        const description = (date: string) => {
          const c = cover.find((x) => x.date === date)!;
          const on = (role: DayRole) => places.filter((a) => a.role === role && a.dates.includes(date)).map((a) => names.get(a.uid) ?? a.uid).sort();
          return [`MyPhone/MyBrain school visit at ${placeOf(info)}.`, `EEG (${c.eeg.confirmed} of ${c.eeg.need}): ${on('eeg').join(', ') || 'none yet'}.`, `Co-production (${c.copro.confirmed} of ${c.copro.need}): ${on('copro').join(', ') || 'none yet'}.`, ...(v.notes ? [v.notes] : [])].join('\n');
        };
        events.push(...visitEvents(v, info, 'team', { description, url: `${PORTAL_URL}#visit/${v.visitId}` }));
      }
      const first = visits[0];
      const filename = action === 'visit-ics' && first ? `visit-${(schools.find((s) => s.id === first.schoolId)?.name ?? first.schoolId).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${first.date}.ics` : 'school-visits.ics';
      return { filename, ics: icsForMany(events, new Date(), 'School visits'), events: events.length };
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
        await notify(db, [uid], { title: 'Welcome to the MyPhone/MyBrain portal', body: role === 'ra' ? 'Start with your documents and availability.' : 'Your account is ready.', link: '#home' }, { title: 'Your portal account is ready', body: 'You can now use the MyPhone/MyBrain staff portal.' });
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
      await notify(db, [String(d.uid)], decision === 'verified' ? { title: `${type?.label ?? 'Document'} accepted`, body: 'Thank you: it has been checked.', link: '#documents' } : { title: `${type?.label ?? 'Document'} not accepted`, body: `${note} Please upload it again.`, link: '#documents' }, { title: decision === 'verified' ? 'Document checked' : 'Document not accepted', body: decision === 'verified' ? `${type?.label ?? 'A document'} has been checked.` : `${type?.label ?? 'A document'} needs uploading again.` });
      return { ok: true };
    }
    case 'make-dbs-password':
    case 'close-dbs-access': {
      // The school's DBS page has its own password, apart from the class-list one: another member of school staff may hold it.
      const schoolId = idOf(data.schoolId, 'school');
      const school = (await schoolsOf(db)).find((s) => s.id === schoolId);
      if (!school) throw bad('That school is not in the portal.');
      const slug = schoolSlug(school.id);
      const ref = db.collection('schoolDbsAccess').doc(slug);
      if (action === 'close-dbs-access') {
        await ref.set({ schoolId, slug, active: false, revokedAt: FieldValue.serverTimestamp() }, { merge: true });
        await audit(db, me, 'close-dbs-access', schoolId);
        return { ok: true };
      }
      const password = newSchoolPassword();
      await ref.set({ schoolId, slug, ...(await hashPassword(password)), active: true, setAt: FieldValue.serverTimestamp(), setBy: me.uid, revokedAt: null }, { merge: true });
      await audit(db, me, 'make-dbs-password', schoolId);
      return { password, link: schoolDbsLink(slug) };
    }
    case 'save-doc-details': {
      // The project manager corrects what was recorded from a checked document (DBS number, issue date, Update Service, expiry).
      const id = idOf(data.docId, 'document');
      const ref = db.collection('portalDocs').doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw bad('That document is not there.');
      const d = snap.data()!;
      if (d.status !== 'verified') throw bad('Only a checked document has details to edit; check it first.');
      const raw = (data.details && typeof data.details === 'object' ? data.details : {}) as Record<string, unknown>;
      const details: Record<string, unknown> = { ...(d.details ?? {}) };
      if (raw.certificateNumber !== undefined) {
        const number = text(raw.certificateNumber, 20).replace(/\s+/g, '');
        if (number && !/^\d{12}$/.test(number)) throw bad('A DBS certificate number has 12 digits.');
        details.certificateNumber = number || null;
      }
      for (const k of ['issueDate', 'expiresOn'] as const) {
        if (raw[k] === undefined) continue;
        if (raw[k] && !isIsoDate(raw[k])) throw bad('Give dates as dates.');
        details[k] = raw[k] || null;
      }
      if (raw.updateService !== undefined) details.updateService = raw.updateService === true;
      await ref.update({ details, detailsEditedBy: me.uid, detailsEditedAt: FieldValue.serverTimestamp() });
      await audit(db, me, 'edit-document-details', id, { owner: d.uid, before: d.details ?? {}, after: details });
      return { ok: true };
    }
    case 'settings':
      return { settings: await settingsFrom(db) };
    case 'save-settings': {
      const settings = settingsOf(data.settings);
      await db.collection('portalSettings').doc('main').set({ ...settings, updatedBy: me.uid, updatedAt: FieldValue.serverTimestamp() });
      await audit(db, me, 'save-settings', 'main', { minTraining: settings.minTraining, minPilots: settings.minPilots, retentionDays: settings.retentionDays, docTypes: settings.docTypes.map((t) => t.id), tags: settings.tags.map((t) => `${t.id}${t.retired ? ' (retired)' : ''}`), roleNeeds: settings.roleNeeds, alwaysCopy: settings.alwaysCopy });
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
  // Offers still unanswered after two days: one reminder, in the portal, by push and by email.
  const open = (await db.collection('portalAssignments').where('status', '==', 'offered').get()).docs.filter((d) => !d.data().remindedAt && iso(d.data().offeredAt) && Date.parse(iso(d.data().offeredAt)!) <= now.getTime() - 48 * 3600_000);
  const schoolList = await schoolsOf(db);
  let reminders = 0;
  for (const d of open) {
    const vSnap = await db.collection('portalVisits').doc(String(d.data().visitId)).get();
    if (!vSnap.exists) continue;
    const v = visitOf(vSnap.id, vSnap.data()!);
    if (v.lastDate < today || v.status === 'cancelled' || v.status === 'done') continue;
    const place = assignmentOf(d.data(), v.days);
    const info = { ...infoOf(v, schoolList), days: daysOf(v, place.dates) };
    const u = users.find((x) => x.uid === String(d.data().uid));
    await notify(db, [String(d.data().uid)], { title: `Reminder: ${info.schoolName}`, body: `You were selected for ${whenShort(info.days)}. Please confirm or decline.`, link: '#offers' }, { title: `Please answer: ${info.schoolName}`, body: `${datesShort(info.days)}. Please confirm or decline.` });
    if (u?.email) await mail(db, u.email, `MyPhone/MyBrain reminder: please confirm ${info.schoolName} ${whenShort(info.days)}`, `Hello ${u.name.split(' ')[0] || 'there'},\n\nYou were selected for the school visit to ${info.schoolName} ${whenShort(info.days)} and we haven't had your answer yet. Please confirm or decline in the portal: ${PORTAL_URL}#offers\n\nThe MyPhone/MyBrain team, University of Leeds`, 'offer-reminder');
    await d.ref.update({ remindedAt: FieldValue.serverTimestamp() });
    reminders += 1;
  }
  if (toDelete.length || warnings.length || reminders) logger.info('Portal housekeeping', { copiesDeleted: toDelete.length, expiryWarnings: warnings.length, offerReminders: reminders });
  return { copiesDeleted: toDelete.length, expiryWarnings: warnings.length, offerReminders: reminders };
}

export const portalHousekeeping = onSchedule({ region: REGION, schedule: 'every day 06:30', timeZone: 'Europe/London' }, async () => {
  await housekeeping(getFirestore());
});
