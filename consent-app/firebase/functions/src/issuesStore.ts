import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { schools as siteSchools } from './forms.js';
import { loadAll } from './linkageStore.js';
import { sendPortalMail } from './portal.js';
import { includedDays, normaliseVisit, ukToday } from './portalCore.js';
import {
  buildDigest,
  canComment,
  canEdit,
  canSee,
  canTriage,
  changesBetween,
  CHANNELS,
  DEVICE_CODE,
  DEVICE_KINDS,
  DEVICE_STATUSES,
  deviceCode,
  deviceInput,
  deviceSummary,
  digestSettingsOf,
  FAULT_LABEL,
  HEADSET_LIST,
  HEADSET_LIST_AT,
  HEADSET_LIST_SOURCE,
  headsetListEntryId,
  ISSUE_ID,
  SEVERITIES,
  statusAfterFault,
  statusFromList,
  type Device,
  type DeviceKind,
  type DeviceStatus,
  type Severity,
  ISSUE_STATUSES,
  issueInput,
  issueRows,
  shortName,
  ukDay,
  type About,
  type Comment,
  type Change,
  type DigestEntry,
  type Issue,
  type IssueStatus,
  type Role,
  type Viewer,
} from './issues.js';

/**
 * The issue log in Firestore (4 November 2026): portalIssues/{id}, the id
 * made by the browser, so an entry sent twice (the offline queue retrying) is
 * stored once. The device's time and the server's are both kept. Only the
 * functions touch it (firestore.rules).
 */

export interface Who {
  uid: string;
  email: string;
  name: string;
  role: Role | null;
}
const bad = (m: string) => new HttpsError('invalid-argument', m);
const refused = (m = 'You do not have access to that.') => new HttpsError('permission-denied', m);
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const iso = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v && typeof (v as { toDate?: () => Date }).toDate === 'function') return (v as { toDate: () => Date }).toDate().toISOString();
  return new Date(0).toISOString();
};
const SCHOOL = new Map(siteSchools.map((s) => [s.id, s.name]));
export const NOTEBOOK_URL = 'https://myphonemybrain.com/portal/#notebook';

export function issueOf(id: string, x: Record<string, unknown>): Issue {
  return {
    id,
    uid: String(x.uid ?? ''),
    authorName: String(x.authorName ?? ''),
    authorRole: String(x.authorRole ?? ''),
    deviceAt: iso(x.deviceAt),
    receivedAt: iso(x.receivedAt),
    visitId: typeof x.visitId === 'string' ? x.visitId : null,
    schoolId: typeof x.schoolId === 'string' ? x.schoolId : null,
    about: (Array.isArray(x.about) ? x.about : []) as About[],
    type: x.type as Issue['type'],
    impact: x.impact as Issue['impact'],
    note: String(x.note ?? ''),
    recordings: (Array.isArray(x.recordings) ? x.recordings : []).map(String),
    device: x.device && typeof x.device === 'object' && DEVICE_CODE.test(String((x.device as { code?: unknown }).code)) ? { kind: (DEVICE_KINDS.includes((x.device as { kind: DeviceKind }).kind) ? (x.device as { kind: DeviceKind }).kind : 'other') as DeviceKind, code: String((x.device as { code: string }).code) } : null,
    faults: (Array.isArray(x.faults) ? x.faults : []).map(String),
    channels: (Array.isArray(x.channels) ? x.channels : []).map(String).filter((c) => (CHANNELS as readonly string[]).includes(c)),
    severity: SEVERITIES.includes(x.severity as Severity) ? (x.severity as Severity) : null,
    fixedAt: typeof x.fixedAt === 'string' ? x.fixedAt : null,
    fixedBy: String(x.fixedBy ?? ''),
    importedFrom: String(x.importedFrom ?? ''),
    status: (ISSUE_STATUSES.includes(x.status as IssueStatus) ? x.status : 'open') as IssueStatus,
    resolution: String(x.resolution ?? ''),
    comments: (Array.isArray(x.comments) ? x.comments : []) as Comment[],
    history: (Array.isArray(x.history) ? x.history : []) as Change[],
  };
}

interface VisitInfo {
  visitId: string;
  schoolId: string;
  schoolName: string;
  days: string[];
  status: string;
}
async function visitsOf(db: Firestore): Promise<VisitInfo[]> {
  return (await db.collection('portalVisits').get()).docs.map((d) => {
    const x = d.data();
    return { visitId: d.id, schoolId: String(x.schoolId ?? ''), schoolName: SCHOOL.get(String(x.schoolId ?? '')) ?? String(x.schoolId ?? ''), days: includedDays(normaliseVisit(x).days).map((v) => v.date), status: String(x.status ?? 'draft') };
  });
}
const visitLabel = (v: VisitInfo | undefined) => (v && v.days.length ? (v.days.length > 1 ? `visit ${v.days[0]} to ${v.days.at(-1)}` : `visit ${v.days[0]}`) : '');

/** First name and last initial a study ID, from its website or EEG record, for the team. */
async function teamNames(db: Firestore): Promise<Map<string, string>> {
  const l = await loadAll(db);
  const out = new Map<string, string>();
  for (const p of l.people.values()) {
    for (const k of p.keys) {
      const r = l.records.get(k);
      if (r && r.firstName) {
        out.set(p.studyId, shortName(r.firstName, r.lastName));
        break;
      }
    }
  }
  return out;
}

/** An entry as the list shows it: pupils named for the team only. */
function view(i: Issue, v: Viewer, names: Map<string, string>, visits: Map<string, VisitInfo>) {
  const team = v.role === 'pm' || v.role === 'researcher';
  const namesOk = team || i.uid === v.uid;
  return {
    ...i,
    mine: i.uid === v.uid,
    canEdit: canEdit(i, v),
    schoolName: i.schoolId ? (SCHOOL.get(i.schoolId) ?? i.schoolId) : '',
    visitLabel: visitLabel(i.visitId ? visits.get(i.visitId) : undefined),
    // Since everyone sees every entry (22 November 2026), a name an assistant typed reaches only the team and its author: never sent to anyone else, in the entry or its history.
    about: i.about.map((a) => (a.kind === 'person' ? { ...a, label: team ? `${names.get(a.studyId) ?? ''} (${a.studyId})`.trim() : a.studyId } : a.kind === 'typed' ? (namesOk ? { ...a, label: `${a.name}${a.studyId ? ` → ${a.studyId}` : ' (to resolve)'}` } : { kind: 'typed' as const, name: '', studyId: a.studyId, label: a.studyId ?? 'a pupil (named by the assistant)' }) : { ...a, label: 'Whole room/session' })),
    history: namesOk ? i.history : i.history.map((h) => ({ ...h, changes: Object.fromEntries(Object.entries(h.changes).map(([k, c]) => (k.startsWith('about') ? [k, { from: '(pupils)', to: '(pupils)' }] : [k, c]))) })),
  };
}

export function deviceOf(code: string, x: Record<string, unknown>): Device {
  return {
    code,
    kind: (DEVICE_KINDS.includes(x.kind as DeviceKind) ? x.kind : 'other') as DeviceKind,
    batch: String(x.batch ?? ''),
    status: (DEVICE_STATUSES.includes(x.status as DeviceStatus) ? x.status : 'ok') as DeviceStatus,
    notes: String(x.notes ?? ''),
    history: (Array.isArray(x.history) ? x.history : []) as Change[],
  };
}

async function audit(db: Firestore, who: Who, action: string, target: string, details: Record<string, unknown> = {}) {
  await db.collection('portalAudit').add({ at: FieldValue.serverTimestamp(), by: who.uid, byEmail: who.email, byName: who.name, action, target, details });
}

export async function issueAction(db: Firestore, who: Who, action: string, data: Record<string, unknown>, send: (to: string, subject: string, text: string, html: string) => Promise<unknown>): Promise<unknown> {
  const v: Viewer = { uid: who.uid, role: who.role };
  const team = canTriage(v);
  switch (action) {
    case 'issue-context': {
      const today = ukToday();
      const [visits, places] = await Promise.all([visitsOf(db), db.collection('portalAssignments').where('uid', '==', who.uid).get()]);
      const mine = new Set(places.docs.filter((d) => d.data().status === 'confirmed' && (!Array.isArray(d.data().dates) || d.data().dates.includes(today))).map((d) => String(d.data().visitId)));
      const near = (v: VisitInfo) => v.status !== 'cancelled' && v.days.some((d) => d >= addDays(today, -14) && d <= addDays(today, 7));
      const list = visits.filter((x) => near(x) && (team || mine.has(x.visitId) || places.docs.some((p) => p.data().visitId === x.visitId))).sort((a, b) => (b.days.includes(today) ? 1 : 0) - (a.days.includes(today) ? 1 : 0) || String(b.days[0]).localeCompare(String(a.days[0])));
      const todays = list.filter((x) => x.days.includes(today));
      const suggested = todays.find((x) => mine.has(x.visitId))?.visitId ?? (todays.length === 1 ? todays[0].visitId : null);
      return { today, suggested, visits: list.map((x) => ({ visitId: x.visitId, schoolId: x.schoolId, schoolName: x.schoolName, days: x.days, today: x.days.includes(today), label: `${x.schoolName} · ${visitLabel(x)}` })), names: team };
    }

    case 'issue-pupils': {
      const q = clip(data.q, 60).toLowerCase();
      const visitId = clip(data.visitId, 80);
      const day = clip(data.day, 10) || ukToday();
      const l = await loadAll(db);
      const visits = await visitsOf(db);
      const visit = visits.find((x) => x.visitId === visitId);
      const owner = new Map<string, string>();
      for (const p of l.people.values()) if (p.status !== 'retired') for (const k of p.keys) owner.set(k, p.studyId);
      const pupils: { studyId: string; label: string }[] = [];
      if (q.length >= 2) {
        for (const p of l.people.values()) {
          if (p.status === 'retired') continue;
          const recs = p.keys.map((k) => l.records.get(k)).filter((r): r is NonNullable<typeof r> => Boolean(r));
          const name = recs.find((r) => r.firstName);
          const hit = p.studyId.includes(q) || (team && recs.some((r) => `${r.firstName} ${r.lastName}`.toLowerCase().includes(q)));
          if (!hit) continue;
          if (visit && team && !recs.some((r) => !r.schoolId || r.schoolId === visit.schoolId) && !p.studyId.includes(q)) continue;
          pupils.push({ studyId: p.studyId, label: team && name ? `${shortName(name.firstName, name.lastName)} · ${p.studyId}` : p.studyId });
          if (pupils.length >= 20) break;
        }
      }
      // The day's EEG recordings at this visit's school (ids only), for "affected recordings".
      const recordings = [...l.eeg.values()].filter((e) => (!visit || !e.schoolId || e.schoolId === visit.schoolId) && (!e.recordingDate || e.recordingDate === day || (visit?.days.includes(e.recordingDate) ?? false))).map((e) => ({ recordingId: e.recordingId, studyId: owner.get(`e:${e.recordingId}`) ?? null, ...(team && e.firstName ? { label: `${e.recordingId} · ${shortName(e.firstName, e.lastName)}` } : { label: e.recordingId }) }));
      return { pupils, recordings: recordings.slice(0, 200) };
    }

    case 'issue-log': {
      const parsed = issueInput(data.entry as Record<string, unknown>, v);
      if (!parsed.ok) throw bad(parsed.problem);
      const e = parsed.value;
      // Assistants name pupils by typing; only the team picks from the registry.
      if (!team && e.about.some((a) => a.kind === 'person')) e.about = e.about.filter((a) => a.kind !== 'person');
      const ref = db.collection('portalIssues').doc(e.id);
      const dref = e.device ? db.collection('portalEquipment').doc(e.device.code) : null;
      const visit = e.visitId ? (await visitsOf(db)).find((x) => x.visitId === e.visitId) : undefined;
      const created = await db.runTransaction(async (tx) => {
        const had = await tx.get(ref);
        const dsnap = dref ? await tx.get(dref) : null;
        if (had.exists) {
          if (had.data()?.uid !== who.uid) throw refused('That entry belongs to someone else.');
          return false;
        }
        tx.create(ref, { ...e, visitId: visit ? e.visitId : null, schoolId: visit?.schoolId ?? null, uid: who.uid, authorName: who.name || who.email, authorRole: who.role, receivedAt: new Date().toISOString(), status: 'open', resolution: '', comments: [], history: [], fixedAt: null, fixedBy: '', importedFrom: '', createdAt: FieldValue.serverTimestamp() });
        // The device goes in the register if it is new, and a fault changes its status (a high one takes it out of service).
        if (dref && e.device) {
          const before = dsnap?.exists ? deviceOf(e.device.code, dsnap.data()!) : null;
          const status = e.faults.length ? statusAfterFault(before?.status ?? 'ok', e.severity) : (before?.status ?? 'ok');
          const change = { at: new Date().toISOString(), by: who.uid, byName: who.name || who.email, changes: before ? { status: { from: before.status, to: status } } : { added: { from: null, to: e.device.code } } };
          if (!before) tx.create(dref, { code: e.device.code, kind: e.device.kind, batch: '', status, notes: '', history: [change], createdAt: FieldValue.serverTimestamp() });
          else if (before.status !== status) tx.update(dref, { status, history: [...before.history, { ...change, note: `Fault logged${e.faults.length ? `: ${e.faults.map((f) => FAULT_LABEL[f] ?? f).join('; ')}` : ''}`, entry: e.id }], updatedAt: FieldValue.serverTimestamp() });
        }
        return true;
      });
      if (created) await audit(db, who, 'issue-log', e.id, { type: e.type, impact: e.impact, visitId: e.visitId });
      // Already there (a retry from the offline queue): the same answer, nothing stored twice.
      return { id: e.id, duplicate: !created };
    }

    case 'issue-list': {
      // Everyone sees every entry (22 November 2026), so nothing is logged twice; pupils' names stay with the team.
      const snap = await db.collection('portalIssues').get();
      const [names, visits] = await Promise.all([team ? teamNames(db) : Promise.resolve(new Map<string, string>()), visitsOf(db)]);
      const vmap = new Map(visits.map((x) => [x.visitId, x]));
      const issues = snap.docs.map((d) => issueOf(d.id, d.data())).filter((i) => canSee(i, v)).sort((a, b) => b.deviceAt.localeCompare(a.deviceAt));
      return { issues: issues.map((i) => view(i, v, names, vmap)), authors: [...new Map(issues.map((i) => [i.uid, i.authorName])).entries()].map(([uid, name]) => ({ uid, name })) };
    }

    case 'issue-edit': {
      const id = clip(data.id, 64);
      if (!ISSUE_ID.test(id)) throw bad('Which entry?');
      const ref = db.collection('portalIssues').doc(id);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw bad('That entry is not there.');
        const before = issueOf(id, snap.data()!);
        if (!canEdit(before, v)) throw refused(before.uid === who.uid ? 'Entries can be changed for 24 hours. Add a comment instead.' : undefined);
        const parsed = issueInput({ ...(data.entry as Record<string, unknown>), id }, v);
        if (!parsed.ok) throw bad(parsed.problem);
        const next = parsed.value;
        if (!team) next.about = [...before.about.filter((a) => a.kind === 'person'), ...next.about.filter((a) => a.kind !== 'person')];
        const fields = { deviceAt: next.deviceAt, visitId: next.visitId, about: next.about, type: next.type, impact: next.impact, note: next.note, recordings: next.recordings, device: next.device, faults: next.faults, channels: next.channels, severity: next.severity };
        const changes = changesBetween(before as unknown as Record<string, unknown>, fields);
        if (!Object.keys(changes).length) return;
        const visit = next.visitId ? (await visitsOf(db)).find((x) => x.visitId === next.visitId) : undefined;
        tx.update(ref, { ...fields, schoolId: visit?.schoolId ?? null, history: [...before.history, { at: new Date().toISOString(), by: who.uid, byName: who.name, changes }], updatedAt: FieldValue.serverTimestamp() });
      });
      await audit(db, who, 'issue-edit', id);
      return { ok: true };
    }

    case 'issue-comment': {
      const id = clip(data.id, 64);
      const textBody = clip(data.text, 2000);
      if (!textBody) throw bad('Write the comment first.');
      const ref = db.collection('portalIssues').doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw bad('That entry is not there.');
      if (!canComment(issueOf(id, snap.data()!), v)) throw refused();
      const c: Comment = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), by: who.uid, byName: who.name || who.email, text: textBody };
      await ref.update({ comments: FieldValue.arrayUnion(c), updatedAt: FieldValue.serverTimestamp() });
      await audit(db, who, 'issue-comment', id);
      return { comment: c };
    }

    case 'issue-status': {
      const id = clip(data.id, 64);
      const status = ISSUE_STATUSES.includes(data.status as IssueStatus) ? (data.status as IssueStatus) : null;
      if (!status) throw bad('Choose a status.');
      const resolution = clip(data.resolution, 2000);
      const ref = db.collection('portalIssues').doc(id);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw bad('That entry is not there.');
        const before = issueOf(id, snap.data()!);
        const changes = changesBetween(before as unknown as Record<string, unknown>, { status, resolution });
        if (!Object.keys(changes).length) return;
        tx.update(ref, { status, resolution, resolvedBy: status === 'open' ? null : who.name, resolvedAt: status === 'open' ? null : new Date().toISOString(), history: [...before.history, { at: new Date().toISOString(), by: who.uid, byName: who.name, changes }], updatedAt: FieldValue.serverTimestamp() });
      });
      await audit(db, who, 'issue-status', id, { status });
      return { ok: true };
    }

    case 'issue-resolve-pupil': {
      const id = clip(data.id, 64);
      const index = Number(data.index);
      const studyId = clip(data.studyId, 20);
      if (!/^sub-\d{4,}$/.test(studyId)) throw bad('Choose the young person.');
      if (!(await db.collection('linkPeople').doc(studyId).get()).exists) throw bad('No one has that study ID.');
      const ref = db.collection('portalIssues').doc(id);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw bad('That entry is not there.');
        const before = issueOf(id, snap.data()!);
        const a = before.about[index];
        if (!a || a.kind !== 'typed') throw bad('That is not a typed name.');
        const about = before.about.map((x, i) => (i === index ? { ...a, studyId } : x));
        tx.update(ref, { about, history: [...before.history, { at: new Date().toISOString(), by: who.uid, byName: who.name, changes: { [`about.${index}`]: { from: a.studyId, to: studyId } } }], updatedAt: FieldValue.serverTimestamp() });
      });
      await audit(db, who, 'issue-resolve-pupil', id, { studyId });
      return { ok: true };
    }

    case 'issue-equipment': {
      const [devs, snap] = await Promise.all([db.collection('portalEquipment').get(), db.collection('portalIssues').get()]);
      const issues = snap.docs.map((d) => issueOf(d.id, d.data())).filter((i) => i.device);
      const byId = new Map(issues.map((i) => [i.id, i]));
      const devices = devs.docs.map((d) => deviceOf(d.id, d.data()));
      // A device named in an entry but missing from the register (logged before it was added) is shown all the same.
      for (const i of issues) if (!devices.some((x) => x.code === i.device!.code)) devices.push({ code: i.device!.code, kind: i.device!.kind, batch: '', status: 'ok', notes: '', history: [] });
      return {
        devices: devices
          .map((d) => {
            const sum = deviceSummary(d.code, issues);
            return { ...d, ...sum, openEntries: sum.open.map((id) => byId.get(id)!).map((i) => ({ id: i.id, deviceAt: i.deviceAt, authorName: i.authorName, faults: i.faults, channels: i.channels, severity: i.severity, note: i.note, comments: i.comments.length, importedFrom: i.importedFrom })) };
          })
          .sort((a, b) => DEVICE_KINDS.indexOf(a.kind) - DEVICE_KINDS.indexOf(b.kind) || a.code.localeCompare(b.code)),
        listImported: issues.some((i) => i.importedFrom === HEADSET_LIST_SOURCE),
      };
    }

    case 'issue-equipment-save': {
      const parsed = deviceInput(data.device as Record<string, unknown>);
      if (!parsed.ok) throw bad(parsed.problem);
      const d = parsed.value;
      const ref = db.collection('portalEquipment').doc(d.code);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const at = new Date().toISOString();
        if (!snap.exists) {
          tx.create(ref, { ...d, history: [{ at, by: who.uid, byName: who.name, changes: { added: { from: null, to: d.code } } }], createdAt: FieldValue.serverTimestamp() });
          return;
        }
        const before = deviceOf(d.code, snap.data()!);
        const changes = changesBetween(before as unknown as Record<string, unknown>, { kind: d.kind, batch: d.batch, status: d.status, notes: d.notes });
        if (Object.keys(changes).length) tx.update(ref, { kind: d.kind, batch: d.batch, status: d.status, notes: d.notes, history: [...before.history, { at, by: who.uid, byName: who.name, changes }], updatedAt: FieldValue.serverTimestamp() });
      });
      await audit(db, who, 'issue-equipment-save', d.code, { status: d.status });
      return { ok: true };
    }

    case 'issue-equipment-fixed': {
      // The faults on a device are fixed (felt replaced, firmware updated, back from repair): its open entries are marked, and it goes back in use.
      const code = deviceCode(data.code);
      if (!DEVICE_CODE.test(code)) throw bad('Which device?');
      const how = clip(data.note, 1000);
      if (!how) throw bad('Say what was done to fix it.');
      const status: DeviceStatus = DEVICE_STATUSES.includes(data.status as DeviceStatus) ? (data.status as DeviceStatus) : 'ok';
      const open = (await db.collection('portalIssues').where('device.code', '==', code).get()).docs.filter((d) => !d.data().fixedAt);
      const at = new Date().toISOString();
      const c = (id: string): Comment => ({ id: `${Date.now().toString(36)}${id.slice(-4)}`, at, by: who.uid, byName: who.name || who.email, text: `Device fixed: ${how}` });
      const dref = db.collection('portalEquipment').doc(code);
      await db.runTransaction(async (tx) => {
        const dsnap = await tx.get(dref);
        for (const d of open) tx.update(d.ref, { fixedAt: at, fixedBy: who.name || who.email, comments: FieldValue.arrayUnion(c(d.id)), updatedAt: FieldValue.serverTimestamp() });
        const before = dsnap.exists ? deviceOf(code, dsnap.data()!) : null;
        const change = { at, by: who.uid, byName: who.name || who.email, changes: { status: { from: before?.status ?? null, to: status } }, note: `Fixed: ${how}` };
        if (before) tx.update(dref, { status, history: [...before.history, change], updatedAt: FieldValue.serverTimestamp() });
        else tx.create(dref, { code, kind: open[0]?.data().device?.kind ?? 'other', batch: '', status, notes: '', history: [change], createdAt: FieldValue.serverTimestamp() });
      });
      await audit(db, who, 'issue-equipment-fixed', code, { entries: open.length, status });
      return { fixed: open.length };
    }

    case 'issue-equipment-import': {
      // The headset list of 14 November 2026: each headset in the register, each fault an open entry (the sheet's words in the note). Twice is once.
      const at = new Date().toISOString();
      let devices = 0;
      let entries = 0;
      for (const h of HEADSET_LIST) {
        const dref = db.collection('portalEquipment').doc(h.code);
        const iref = db.collection('portalIssues').doc(headsetListEntryId(h.code));
        await db.runTransaction(async (tx) => {
          const [dsnap, isnap] = await Promise.all([tx.get(dref), tx.get(iref)]);
          if (!dsnap.exists) {
            tx.create(dref, { code: h.code, kind: 'headset', batch: h.batch, status: statusFromList(h.severity), notes: '', history: [{ at, by: who.uid, byName: who.name || who.email, changes: { added: { from: null, to: h.code } }, note: HEADSET_LIST_SOURCE }], createdAt: FieldValue.serverTimestamp() });
            devices += 1;
          }
          if (!isnap.exists && h.faults.length) {
            tx.create(iref, { id: iref.id, uid: who.uid, authorName: who.name || who.email, authorRole: who.role, deviceAt: HEADSET_LIST_AT, receivedAt: at, visitId: null, schoolId: null, about: [], type: 'eeg', impact: 'may-affect', note: `From the headset list (14 November 2026): ${h.issue}. Level: ${h.level}.`, recordings: [], device: { kind: 'headset', code: h.code }, faults: h.faults, channels: h.channels, severity: h.severity, fixedAt: null, fixedBy: '', importedFrom: HEADSET_LIST_SOURCE, status: 'open', resolution: '', comments: [], history: [], createdAt: FieldValue.serverTimestamp() });
            entries += 1;
          }
        });
      }
      await audit(db, who, 'issue-equipment-import', HEADSET_LIST_SOURCE, { devices, entries });
      return { devices, entries };
    }

    case 'issue-digest-settings':
      return { settings: digestSettingsOf((await db.collection('portalSettings').doc('issues').get()).data()) };

    case 'issue-save-digest': {
      const settings = digestSettingsOf({ to: data.to, sendEmpty: data.sendEmpty });
      if (!settings.to.length) throw bad('Give at least one email address.');
      await db.collection('portalSettings').doc('issues').set({ ...settings, updatedBy: who.uid, updatedAt: FieldValue.serverTimestamp() });
      await audit(db, who, 'issue-save-digest', 'issues', { ...settings });
      return { settings };
    }

    case 'issue-digest-now': {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(data.day ?? '')) ? String(data.day) : ukToday();
      const r = await sendDigest(db, day, send, data.force === true);
      await audit(db, who, 'issue-digest-now', day, { sent: r.sent, entries: r.entries });
      return r;
    }
  }
  throw bad('Unknown action.');
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** All entries, with what the email shows of each. */
export async function digestEntries(db: Firestore): Promise<{ entries: DigestEntry[]; all: Issue[] }> {
  const [snap, names, visits] = await Promise.all([db.collection('portalIssues').get(), teamNames(db), visitsOf(db)]);
  const vmap = new Map(visits.map((x) => [x.visitId, x]));
  const all = snap.docs.map((d) => issueOf(d.id, d.data()));
  const entries = all.map((i) => ({
    ...i,
    schoolName: i.schoolId ? (SCHOOL.get(i.schoolId) ?? i.schoolId) : '',
    visitLabel: visitLabel(i.visitId ? vmap.get(i.visitId) : undefined),
    pupils: i.about.flatMap((a) => (a.kind === 'person' ? [names.get(a.studyId) ?? a.studyId] : a.kind === 'typed' ? [a.studyId && names.get(a.studyId) ? names.get(a.studyId)! : (() => { const [f, ...l] = a.name.split(/\s+/); return shortName(f, l.at(-1) ?? ''); })()] : [])),
    link: `${NOTEBOOK_URL}/${i.id}`,
  }));
  return { entries, all };
}

/** The day's email to the people in the setting. Never throws for a send that fails: it is logged. */
export async function sendDigest(db: Firestore, day: string, send: (to: string, subject: string, text: string, html: string) => Promise<unknown>, forceEmpty = false): Promise<{ sent: boolean; entries: number; to: string[] }> {
  const settings = digestSettingsOf((await db.collection('portalSettings').doc('issues').get()).data());
  const got = await digestEntries(db);
  // Entries brought in from an earlier record (the headset list) are not the day's news.
  const entries = got.entries.filter((e) => !e.importedFrom || ukDay(e.deviceAt) === day);
  const all = got.all;
  const openEarlier = all.filter((i) => i.status === 'open' && ukDay(i.deviceAt) < day && ukDay(i.receivedAt) < day).length;
  const digest = buildDigest({ day, entries, openEarlier, notebookLink: NOTEBOOK_URL, sendEmpty: settings.sendEmpty || forceEmpty });
  if (!digest || !settings.to.length) {
    await db.collection('portalAudit').add({ at: FieldValue.serverTimestamp(), by: 'system', byEmail: '', byName: 'Daily problems email', action: 'issue-digest-skipped', target: day, details: { reason: digest ? 'no recipients' : 'nothing logged' } });
    return { sent: false, entries: 0, to: settings.to };
  }
  const outcome = await send(settings.to.join(', '), digest.subject, digest.text, digest.html);
  // The send, kept: what went to whom (the email itself, as the team's own record of the day).
  await db.collection('portalDigests').add({ day, at: FieldValue.serverTimestamp(), to: settings.to, subject: digest.subject, text: digest.text, html: digest.html, entries: digest.entries, counts: digest.counts, outcome: typeof outcome === 'string' ? outcome : 'sent' });
  await db.collection('portalAudit').add({ at: FieldValue.serverTimestamp(), by: 'system', byEmail: '', byName: 'Daily problems email', action: 'issue-digest', target: day, details: { to: settings.to, entries: digest.entries, counts: digest.counts } });
  return { sent: true, entries: digest.entries, to: settings.to };
}

/** For the export and the Sheet. */
export async function issueTables(db: Firestore) {
  return issueRows((await db.collection('portalIssues').get()).docs.map((d) => issueOf(d.id, d.data())));
}

/** 6 pm UK time (GMT or BST), every day: the day's problems to the people in the setting. */
export const issuesDigest = onSchedule({ region: 'europe-west2', schedule: '0 18 * * *', timeZone: 'Europe/London', memory: '512MiB', timeoutSeconds: 120 }, async () => {
  const db = getFirestore();
  const r = await sendDigest(db, ukToday(), (to, subject, text, html) => sendPortalMail(db, { to, subject, text, html }, 'issue-digest'));
  logger.info('Daily problems email', r);
});
