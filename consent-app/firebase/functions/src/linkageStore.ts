import { FieldValue, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { schools as siteSchools } from './forms.js';
import { matchPupil, optOutFor, optOutsOf, pupilsBySchool } from './exportUpn.js';
import {
  candidateId,
  eegRecord,
  eegRowOf,
  kindOfKey,
  linkageTables,
  myselfRecord,
  plan,
  recordKey,
  refOfKey,
  websiteRecord,
  type Candidate,
  type Decision,
  type EegRow,
  type PersonDoc,
  type PersonStatus,
  type SourceKind,
  type SourceRecord,
} from './linkage.js';
import { MYSELF_IDENTITY_PROJECT, MYSELF_RESEARCH_PROJECT, MYSELF_STUDY, myselfSource, type MyselfNames, type MyselfParticipant, type MyselfSource, type MyselfStatus } from './linkageMyself.js';

/**
 * The linkage registry in Firestore (4 November 2026). Only the functions
 * touch these collections (firestore.rules denies every client):
 *   linkPeople/{sub-0001}   a study ID: its records (keys), how each joined, status
 *   linkCandidates/{id}     a suggested pair waiting for a person
 *   linkDecisions/{id}      same / different, by whom, when: never suggested again
 *   linkEeg/{recordingId}   the EEG manifest rows (names until the retention date)
 *   linkMyself/{code}       MySelf codes: sites, sittings, release, UPN (never names)
 *   linkMeta/{counter|state|settings}
 *   linkAudit               everything that changed, and who did it
 */

export interface Who {
  uid: string;
  email: string;
  name: string;
  role: string | null;
}
const SYSTEM: Who = { uid: 'system', email: '', name: 'Linkage', role: null };

/** How long EEG names are kept once the recording has a study ID. */
export const EEG_NAME_DAYS = 180;

const bad = (message: string) => new HttpsError('invalid-argument', message);
const refused = (message = 'Only the project manager can do that.') => new HttpsError('permission-denied', message);
const iso = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') return (v as { toDate: () => Date }).toDate().toISOString();
  return null;
};
const studyIdOf = (n: number) => `sub-${String(n).padStart(4, '0')}`;
const STUDY_ID = /^sub-\d{4,}$/;
const KEY = /^[wme]:[A-Za-z0-9._-]{1,80}$/;

async function linkAudit(db: Firestore, who: Who, action: string, target: string, details: Record<string, unknown> = {}) {
  await db.collection('linkAudit').add({ at: FieldValue.serverTimestamp(), by: who.uid, byName: who.name || who.email || who.uid, action, target, details });
}
async function portalAudit(db: Firestore, who: Who, action: string, target: string, details: Record<string, unknown> = {}) {
  await db.collection('portalAudit').add({ at: FieldValue.serverTimestamp(), by: who.uid, byEmail: who.email, byName: who.name, action, target, details });
}

/* ── Loading ──────────────────────────────────────────────────────────── */

export interface Settings {
  /** MySelf site code (the letters of a study code) -> the website's school id. */
  siteMap: Record<string, string>;
}
export async function settingsOf(db: Firestore): Promise<Settings> {
  const d = (await db.collection('linkMeta').doc('settings').get()).data() ?? {};
  const siteMap: Record<string, string> = {};
  for (const [k, v] of Object.entries((d.siteMap ?? {}) as Record<string, unknown>)) if (typeof v === 'string' && v) siteMap[k.toUpperCase()] = v;
  return { siteMap };
}

export interface WebsiteInfo {
  label: string | null;
  referenceCode: string | null;
  firstName: string;
  lastName: string;
  dob: string | null;
  schoolId: string;
  yearGroup: string;
  upn: string | null;
  withdrawn: string | null;
}
export interface Loaded {
  settings: Settings;
  records: Map<string, SourceRecord>;
  website: Map<string, WebsiteInfo>;
  myself: Map<string, MyselfParticipant & { source: string }>;
  eeg: Map<string, EegRow & { linkedAt: string | null; namesRemovedAt: string | null; uploadedAt: string | null }>;
  people: Map<string, PersonDoc & { links: LinkEntry[]; statusReason: string }>;
  decisions: (Decision & { by: string; at: string | null; note: string })[];
  candidates: (Candidate & { createdAt: string | null })[];
}
export interface LinkEntry {
  key: string;
  tier: string;
  matchedOn: string[];
  how: string;
  by: string;
  at: string | null;
}

/** Everything the registry knows, read in one go (the study is a few thousand records at most). Names for MySelf only when handed in. */
export async function loadAll(db: Firestore, myselfNames?: Map<string, MyselfNames>): Promise<Loaded> {
  const all = (name: string) => db.collection(name).get();
  const [settings, participants, optOutSnap, uploadSnap, myselfSnap, eegSnap, peopleSnap, decisionSnap, candidateSnap] = await Promise.all([settingsOf(db), all('participants'), all('optOuts'), all('schoolUploads'), all('linkMyself'), all('linkEeg'), all('linkPeople'), all('linkDecisions'), all('linkCandidates')]);
  const optOuts = optOutsOf(optOutSnap.docs.map((d) => ({ id: d.id, data: d.data() })));
  const pupils = pupilsBySchool(uploadSnap.docs.map((d) => ({ id: d.id, data: d.data() })));
  const records = new Map<string, SourceRecord>();
  const website = new Map<string, WebsiteInfo>();
  for (const doc of participants.docs) {
    const d = doc.data();
    if (d.kind !== 'consent') continue;
    const label = typeof d.studyNumber === 'number' ? `sub-${String(d.studyNumber).padStart(5, '0')}` : null;
    const m = pupils.get(String(d.schoolId ?? '')) ? matchPupil({ firstName: d.firstName, lastName: d.lastName, dateOfBirth: d.dateOfBirth }, pupils.get(String(d.schoolId ?? ''))!) : null;
    const optOut = optOutFor(d, optOuts);
    const r = websiteRecord(doc.id, d, { label, upn: m?.pupil?.upn ?? null, schoolFirstName: m?.pupil?.firstName ?? null, schoolLastName: m?.pupil?.lastName ?? null, withdrawn: Boolean(optOut) });
    records.set(r.key, r);
    website.set(doc.id, { label, referenceCode: typeof d.referenceCode === 'string' ? d.referenceCode : null, firstName: r.firstName, lastName: r.lastName, dob: r.dob, schoolId: r.schoolId, yearGroup: r.yearGroup, upn: r.upn, withdrawn: optOut ? optOut.kind : null });
  }
  const myself = new Map<string, MyselfParticipant & { source: string }>();
  for (const doc of myselfSnap.docs) {
    const x = doc.data();
    const p = { code: doc.id, sites: (x.sites ?? []) as string[], sittings: (x.sittings ?? []) as MyselfParticipant['sittings'], upn: typeof x.upn === 'string' && x.upn ? x.upn : null, source: String(x.source ?? 'live') };
    myself.set(doc.id, p);
    const r = myselfRecord(p, settings.siteMap, myselfNames?.get(doc.id) ?? null);
    records.set(r.key, r);
  }
  const eeg: Loaded['eeg'] = new Map();
  for (const doc of eegSnap.docs) {
    const x = doc.data();
    const row = { recordingId: doc.id, firstName: String(x.firstName ?? ''), lastName: String(x.lastName ?? ''), dob: x.dob ?? null, sex: String(x.sex ?? ''), ethnicity: String(x.ethnicity ?? ''), recordingDate: x.recordingDate ?? null, site: String(x.site ?? ''), schoolId: String(x.schoolId ?? ''), task: String(x.task ?? ''), fileName: String(x.fileName ?? ''), exactId: x.exactId ?? null, linkedAt: iso(x.linkedAt), namesRemovedAt: iso(x.namesRemovedAt), uploadedAt: iso(x.uploadedAt) };
    eeg.set(doc.id, row);
    const r = eegRecord(row);
    records.set(r.key, r);
  }
  const people: Loaded['people'] = new Map();
  for (const doc of peopleSnap.docs) {
    const x = doc.data();
    people.set(doc.id, { studyId: doc.id, number: Number(x.number ?? 0), status: (x.status ?? 'active') as PersonStatus, keys: (x.keys ?? []) as string[], createdAt: iso(x.createdAt), links: ((x.links ?? []) as DocumentData[]).map((l) => ({ key: String(l.key), tier: String(l.tier ?? ''), matchedOn: (l.matchedOn ?? []) as string[], how: String(l.how ?? ''), by: String(l.by ?? ''), at: iso(l.at) })), statusReason: String(x.statusReason ?? '') });
  }
  const decisions = decisionSnap.docs.map((d) => ({ recordKey: String(d.data().recordKey), studyId: String(d.data().studyId), decision: d.data().decision as Decision['decision'], by: String(d.data().byName ?? d.data().by ?? ''), at: iso(d.data().at), note: String(d.data().note ?? '') }));
  const candidates = candidateSnap.docs.map((d) => ({ id: d.id, recordKey: String(d.data().recordKey), studyId: String(d.data().studyId), tier: d.data().tier, score: Number(d.data().score ?? 0), matchedOn: (d.data().matchedOn ?? []) as string[], reason: String(d.data().reason ?? ''), createdAt: iso(d.data().createdAt) }));
  return { settings, records, website, myself, eeg, people, decisions, candidates };
}

/* ── A run ────────────────────────────────────────────────────────────── */

export class Busy extends Error {}

export interface RunResult {
  ok: boolean;
  busy?: boolean;
  newPeople: number;
  autoLinks: number;
  candidates: number;
  awaiting: number;
  myself: { synced: boolean; participants: number; status: MyselfStatus | null };
  eegNamesRemoved: number;
}

/**
 * One matching run: (optionally) MySelf brought up to date, then the plan,
 * then its changes written. One at a time (a five-minute lease in
 * linkMeta/state): a run that finds another going returns busy, and the next
 * hourly run picks up whatever it would have done.
 */
export async function runLinkage(db: Firestore, opts: { by?: Who; syncMyself?: boolean; names?: Map<string, MyselfNames>; source?: MyselfSource; now?: Date } = {}): Promise<RunResult> {
  const by = opts.by ?? SYSTEM;
  const now = opts.now ?? new Date();
  const stateRef = db.collection('linkMeta').doc('state');
  try {
    await db.runTransaction(async (tx) => {
      const lease = (await tx.get(stateRef)).data()?.leaseUntil;
      if (typeof lease === 'number' && lease > Date.now()) throw new Busy('A linkage run is already going.');
      tx.set(stateRef, { leaseUntil: Date.now() + 5 * 60_000 }, { merge: true });
    });
  } catch (e) {
    if (e instanceof Busy) return { ok: false, busy: true, newPeople: 0, autoLinks: 0, candidates: 0, awaiting: 0, myself: { synced: false, participants: 0, status: null }, eegNamesRemoved: 0 };
    throw e;
  }
  try {
    let names = opts.names ?? new Map<string, MyselfNames>();
    let status: MyselfStatus | null = null;
    let synced = false;
    let participantsN = 0;
    if (opts.syncMyself) {
      const source = opts.source ?? myselfSource(db);
      status = await source.status();
      if (status.research.ok && status.identity.ok) {
        try {
          const list = await source.participants();
          participantsN = list.length;
          await saveMyself(db, list, 'live');
          names = new Map([...(await source.names()), ...names]);
          synced = true;
        } catch (e) {
          status = { ...status, identity: { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) } };
        }
      }
      await stateRef.set({ myselfStatus: { ...status, checkedAt: now.toISOString(), synced, participants: participantsN } }, { merge: true });
    }

    const loaded = await loadAll(db, names);
    const result = plan({ records: [...loaded.records.values()], people: [...loaded.people.values()], decisions: loaded.decisions, carry: loaded.candidates });

    // New study IDs, numbered in one transaction so two runs can never hand out the same one.
    const realOf = new Map<string, string>();
    if (result.newPeople.length) {
      const counterRef = db.collection('linkMeta').doc('counter');
      const first = await db.runTransaction(async (tx) => {
        const next = Number((await tx.get(counterRef)).data()?.next ?? 1);
        tx.set(counterRef, { next: next + result.newPeople.length }, { merge: true });
        return next;
      });
      result.newPeople.forEach((t, i) => realOf.set(t, studyIdOf(first + i)));
    }
    const real = (id: string) => realOf.get(id) ?? id;

    const writer = db.bulkWriter();
    const stamp = now.toISOString();
    const touched = new Map<string, { keys: string[]; links: LinkEntry[]; status: PersonStatus; number: number; isNew: boolean }>();
    const personOf = (studyId: string) => {
      if (!touched.has(studyId)) {
        const p = loaded.people.get(studyId);
        touched.set(studyId, p ? { keys: [...p.keys], links: [...p.links], status: p.status, number: p.number, isNew: false } : { keys: [], links: [], status: 'active', number: Number(studyId.slice(4)), isNew: true });
      }
      return touched.get(studyId)!;
    };
    for (const a of result.attachments) {
      const id = real(a.studyId);
      const p = personOf(id);
      if (!p.keys.includes(a.recordKey)) p.keys.push(a.recordKey);
      p.links.push({ key: a.recordKey, tier: a.tier, matchedOn: a.matchedOn, how: a.how, by: by.name || 'Linkage', at: stamp });
      writer.create(db.collection('linkAudit').doc(), { at: FieldValue.serverTimestamp(), by: by.uid, byName: by.name || 'Linkage', action: a.how === 'new' ? 'link-new-id' : 'link-auto', target: id, details: { record: a.recordKey, tier: a.tier, matchedOn: a.matchedOn } });
      if (kindOfKey(a.recordKey) === 'eeg') writer.set(db.collection('linkEeg').doc(refOfKey(a.recordKey)), { linkedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    for (const [tempOrId, status] of result.statuses) {
      const id = real(tempOrId);
      const before = loaded.people.get(id)?.status;
      if (before === status && !touched.has(id)) continue;
      const p = personOf(id);
      if (before && before !== status) writer.create(db.collection('linkAudit').doc(), { at: FieldValue.serverTimestamp(), by: by.uid, byName: by.name || 'Linkage', action: status === 'withdrawn' ? 'link-withdrawn' : 'link-status', target: id, details: { from: before, to: status } });
      p.status = status;
    }
    for (const [id, p] of touched) {
      writer.set(db.collection('linkPeople').doc(id), { studyId: id, number: p.number, status: p.status, keys: p.keys, links: p.links, kinds: [...new Set(p.keys.map(kindOfKey))], updatedAt: FieldValue.serverTimestamp(), ...(p.isNew ? { createdAt: FieldValue.serverTimestamp(), statusReason: '' } : {}), ...(p.status === 'withdrawn' ? { statusReason: 'website opt-out' } : {}) }, { merge: true });
    }

    // Suggestions: the run's set replaces what was waiting.
    const wanted = new Map(result.candidates.map((c) => {
      const studyId = real(c.studyId);
      const id = candidateId(c.recordKey, studyId);
      return [id, { ...c, id, studyId }];
    }));
    for (const c of loaded.candidates) if (!wanted.has(c.id)) writer.delete(db.collection('linkCandidates').doc(c.id));
    const had = new Set(loaded.candidates.map((c) => c.id));
    for (const c of wanted.values()) writer.set(db.collection('linkCandidates').doc(c.id), { recordKey: c.recordKey, kind: kindOfKey(c.recordKey), studyId: c.studyId, tier: c.tier, score: c.score, matchedOn: c.matchedOn, reason: c.reason, ...(had.has(c.id) ? {} : { createdAt: FieldValue.serverTimestamp() }), updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    // EEG names: removed once a recording has had its study ID for EEG_NAME_DAYS (the ID their name gave is kept).
    let removed = 0;
    const cutoff = now.getTime() - EEG_NAME_DAYS * 86_400_000;
    for (const e of loaded.eeg.values()) {
      if (!e.linkedAt || e.namesRemovedAt || !e.firstName || Date.parse(e.linkedAt) > cutoff) continue;
      writer.set(db.collection('linkEeg').doc(e.recordingId), { firstName: '', lastName: '', namesRemovedAt: FieldValue.serverTimestamp() }, { merge: true });
      removed += 1;
    }
    await writer.close();

    const autoLinks = result.attachments.filter((a) => a.how === 'auto').length;
    const out: RunResult = { ok: true, newPeople: result.newPeople.length, autoLinks, candidates: wanted.size, awaiting: result.awaiting.length, myself: { synced, participants: participantsN, status }, eegNamesRemoved: removed };
    await stateRef.set({ lastRunAt: stamp, lastRunBy: by.name || 'Linkage', lastResult: { newPeople: out.newPeople, autoLinks, candidates: out.candidates, awaiting: out.awaiting, eegNamesRemoved: removed, myselfSynced: synced } }, { merge: true });
    if (out.newPeople || autoLinks || removed) await linkAudit(db, by, 'link-run', 'registry', { newPeople: out.newPeople, autoLinks, candidates: out.candidates, awaiting: out.awaiting, eegNamesRemoved: removed, myselfSynced: synced });
    return out;
  } finally {
    await stateRef.set({ leaseUntil: 0 }, { merge: true });
  }
}

async function saveMyself(db: Firestore, list: MyselfParticipant[], source: 'live' | 'upload') {
  const writer = db.bulkWriter();
  for (const p of list) writer.set(db.collection('linkMyself').doc(p.code), { code: p.code, sites: p.sites, sittings: p.sittings, upn: p.upn, source, syncedAt: FieldValue.serverTimestamp() });
  await writer.close();
}

/* ── What the pages show ──────────────────────────────────────────────── */

const SCHOOL_NAME = new Map(siteSchools.map((s) => [s.id, s.name]));
const schoolName = (id: string) => (id ? (SCHOOL_NAME.get(id) ?? id) : '');

/** A record as a review card shows it. MySelf names are never here: a reviewer asks for them (myself-names). */
export function cardOf(l: Loaded, key: string): Record<string, unknown> {
  const kind = kindOfKey(key);
  const ref = refOfKey(key);
  if (kind === 'website') {
    const w = l.website.get(ref);
    if (!w) return { key, kind, ref, missing: true };
    return { key, kind, ref, label: w.label, referenceCode: w.referenceCode, name: `${w.firstName} ${w.lastName}`.trim(), dob: w.dob, school: schoolName(w.schoolId), yearGroup: w.yearGroup, upn: w.upn, withdrawn: w.withdrawn };
  }
  if (kind === 'myself') {
    const m = l.myself.get(ref);
    if (!m) return { key, kind, ref, missing: true };
    const dates = m.sittings.map((s) => s.date).sort();
    return { key, kind, ref, code: ref, sites: m.sites.map((s) => (l.settings.siteMap[s] ? `${s} (${schoolName(l.settings.siteMap[s])})` : s)), sittings: m.sittings.length, firstSitting: dates[0] ?? null, lastSitting: dates.at(-1) ?? null, releases: [...new Set(m.sittings.map((s) => s.release).filter(Boolean))], upn: m.upn, source: m.source };
  }
  const e = l.eeg.get(ref);
  if (!e) return { key, kind, ref, missing: true };
  return { key, kind, ref, recordingId: ref, name: e.firstName ? `${e.firstName} ${e.lastName}` : '(names removed after the retention period)', dob: e.dob, sex: e.sex, ethnicity: e.ethnicity, recordingDate: e.recordingDate, site: e.site, school: schoolName(e.schoolId), task: e.task };
}

function personCard(l: Loaded, studyId: string) {
  const p = l.people.get(studyId);
  if (!p) return { studyId, missing: true, records: [] };
  return { studyId, status: p.status, statusReason: p.statusReason, records: p.keys.map((k) => cardOf(l, k)) };
}

function owners(l: Loaded): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of l.people.values()) if (p.status !== 'retired') for (const k of p.keys) m.set(k, p.studyId);
  return m;
}

export interface LinkSummary {
  people: number;
  active: number;
  withdrawn: number;
  sources: Record<SourceKind, { total: number; linked: number; awaiting: number; unlinked: number }>;
  pending: number;
  multiSource: number;
  lastRunAt: string | null;
  lastRunBy: string;
  myself: Record<string, unknown> | null;
  perSchool: { schoolId: string; school: string; people: number; website: number; myself: number; eeg: number; allThree: number }[];
}

export async function summaryOf(db: Firestore, l?: Loaded): Promise<LinkSummary> {
  const loaded = l ?? (await loadAll(db));
  const state = (await db.collection('linkMeta').doc('state').get()).data() ?? {};
  const own = owners(loaded);
  const awaiting = new Set(loaded.candidates.map((c) => c.recordKey));
  const sources = Object.fromEntries((['website', 'myself', 'eeg'] as SourceKind[]).map((k) => {
    const keys = [...loaded.records.keys()].filter((x) => kindOfKey(x) === k);
    const linked = keys.filter((x) => own.has(x)).length;
    const waiting = keys.filter((x) => !own.has(x) && awaiting.has(x)).length;
    return [k, { total: keys.length, linked, awaiting: waiting, unlinked: keys.length - linked - waiting }];
  })) as LinkSummary['sources'];
  const live = [...loaded.people.values()].filter((p) => p.status !== 'retired');
  const bySchool = new Map<string, LinkSummary['perSchool'][number]>();
  for (const p of live) {
    const recs = p.keys.map((k) => loaded.records.get(k)).filter((r): r is SourceRecord => Boolean(r));
    const school = recs.find((r) => r.kind === 'website' && r.schoolId)?.schoolId ?? recs.find((r) => r.schoolId)?.schoolId ?? '';
    const row = bySchool.get(school) ?? { schoolId: school, school: schoolName(school) || 'School not known', people: 0, website: 0, myself: 0, eeg: 0, allThree: 0 };
    const kinds = new Set(recs.map((r) => r.kind));
    row.people += 1;
    if (kinds.has('website')) row.website += 1;
    if (kinds.has('myself')) row.myself += 1;
    if (kinds.has('eeg')) row.eeg += 1;
    if (kinds.size === 3) row.allThree += 1;
    bySchool.set(school, row);
  }
  return {
    people: live.length,
    active: live.filter((p) => p.status === 'active').length,
    withdrawn: live.filter((p) => p.status === 'withdrawn').length,
    sources,
    pending: loaded.candidates.length,
    multiSource: live.filter((p) => new Set(p.keys.map(kindOfKey)).size > 1).length,
    lastRunAt: typeof state.lastRunAt === 'string' ? state.lastRunAt : null,
    lastRunBy: String(state.lastRunBy ?? ''),
    myself: (state.myselfStatus as Record<string, unknown>) ?? null,
    perSchool: [...bySchool.values()].sort((a, b) => a.school.localeCompare(b.school)),
  };
}

/** The files the hourly export writes under linkage/ (and the website's research tables' study-ID column). */
export async function linkageExport(db: Firestore): Promise<{ tables: ReturnType<typeof linkageTables>; websiteIds: Map<string, string> }> {
  const l = await loadAll(db);
  const records = new Map([...l.records].map(([k, r]) => [k, { ...r, label: r.kind === 'website' ? (l.website.get(r.ref)?.label ?? null) : null, referenceCode: r.kind === 'website' ? (l.website.get(r.ref)?.referenceCode ?? null) : null }]));
  const tables = linkageTables({ people: [...l.people.values()], records, eeg: [...l.eeg.values()], awaiting: new Set(l.candidates.map((c) => c.recordKey)) });
  const websiteIds = new Map<string, string>();
  for (const p of l.people.values()) if (p.status !== 'retired') for (const k of p.keys) if (kindOfKey(k) === 'website') websiteIds.set(refOfKey(k), p.studyId);
  return { tables, websiteIds };
}

/* ── The portal's actions ─────────────────────────────────────────────── */


const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function quietRun(db: Firestore, who: Who, extra: Parameters<typeof runLinkage>[1] = {}) {
  try {
    return await runLinkage(db, { by: who, ...extra });
  } catch (error) {
    logger.error('Linkage run failed', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export async function linkageAction(db: Firestore, who: Who, action: string, data: Record<string, unknown>): Promise<unknown> {
  switch (action) {
    case 'link-summary':
      return { summary: await summaryOf(db) };

    case 'link-queue': {
      const l = await loadAll(db);
      const own = owners(l);
      const byRecord = new Map<string, Candidate[]>();
      for (const c of l.candidates) byRecord.set(c.recordKey, [...(byRecord.get(c.recordKey) ?? []), c]);
      const items = l.candidates
        .filter((c) => !own.has(c.recordKey) && l.people.has(c.studyId))
        .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || b.score - a.score || a.recordKey.localeCompare(b.recordKey))
        .slice(0, 300)
        .map((c) => ({ id: c.id, tier: c.tier, score: c.score, matchedOn: c.matchedOn, reason: c.reason, others: (byRecord.get(c.recordKey)?.length ?? 1) - 1, record: cardOf(l, c.recordKey), person: personCard(l, c.studyId) }));
      return { items, total: l.candidates.length };
    }

    case 'link-decide': {
      const id = text(data.id, 40);
      const decision = data.decision === 'same' ? 'same' : data.decision === 'different' ? 'different' : null;
      if (!decision) throw bad('Say whether they are the same person.');
      const snap = await db.collection('linkCandidates').doc(id).get();
      if (!snap.exists) throw bad('That suggestion has already been dealt with. Reload the queue.');
      const c = snap.data()!;
      const recordKeyOf = String(c.recordKey);
      const studyId = String(c.studyId);
      const note = text(data.note, 500);
      await db.collection('linkDecisions').doc(candidateId(recordKeyOf, studyId)).set({ recordKey: recordKeyOf, studyId, decision, by: who.uid, byName: who.name || who.email, at: FieldValue.serverTimestamp(), note, tier: c.tier ?? '', score: c.score ?? 0 });
      if (decision === 'same') {
        await db.runTransaction(async (tx) => {
          const ref = db.collection('linkPeople').doc(studyId);
          const p = (await tx.get(ref)).data();
          if (!p || p.status === 'retired') throw bad('That study ID is no longer in use.');
          const keys = (p.keys ?? []) as string[];
          if (!keys.includes(recordKeyOf)) tx.set(ref, { keys: [...keys, recordKeyOf], kinds: [...new Set([...keys, recordKeyOf].map(kindOfKey))], links: [...((p.links ?? []) as unknown[]), { key: recordKeyOf, tier: 'decision', matchedOn: (c.matchedOn ?? []) as string[], how: 'decision', by: who.name || who.email, at: new Date().toISOString() }], updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        });
        if (kindOfKey(recordKeyOf) === 'eeg') await db.collection('linkEeg').doc(refOfKey(recordKeyOf)).set({ linkedAt: FieldValue.serverTimestamp() }, { merge: true });
        const others = await db.collection('linkCandidates').where('recordKey', '==', recordKeyOf).get();
        await Promise.all(others.docs.map((d) => d.ref.delete()));
      } else await snap.ref.delete();
      await linkAudit(db, who, decision === 'same' ? 'link-same' : 'link-different', studyId, { record: recordKeyOf, tier: c.tier, score: c.score, note });
      await portalAudit(db, who, `link-${decision}`, studyId, { record: recordKeyOf });
      // A record now without suggestions gets its study ID straight away.
      if (decision === 'different') await quietRun(db, who);
      return { ok: true };
    }

    case 'link-person': {
      const studyId = text(data.studyId, 20);
      if (!STUDY_ID.test(studyId)) throw bad('That is not a study ID.');
      const l = await loadAll(db);
      const p = l.people.get(studyId);
      if (!p) throw bad('No one has that study ID.');
      const history = await db.collection('linkAudit').where('target', '==', studyId).get();
      const decisions = l.decisions.filter((d) => d.studyId === studyId);
      return {
        person: { ...personCard(l, studyId), createdAt: p.createdAt, links: p.links },
        pending: l.candidates.filter((c) => c.studyId === studyId).map((c) => ({ id: c.id, tier: c.tier, record: cardOf(l, c.recordKey) })),
        decisions: decisions.map((d) => ({ record: d.recordKey, decision: d.decision, by: d.by, at: d.at, note: d.note })),
        history: history.docs.map((d) => ({ at: iso(d.data().at), by: d.data().byName, action: d.data().action, details: d.data().details ?? {} })).sort((a, b) => String(b.at).localeCompare(String(a.at))),
      };
    }

    case 'link-unlink': {
      if (who.role !== 'pm') throw refused();
      const studyId = text(data.studyId, 20);
      const key = text(data.recordKey, 90);
      const reason = text(data.reason, 500);
      if (!STUDY_ID.test(studyId) || !KEY.test(key)) throw bad('Choose a record to take off.');
      if (reason.length < 5) throw bad('Say why (it is kept in the history).');
      await db.runTransaction(async (tx) => {
        const ref = db.collection('linkPeople').doc(studyId);
        const p = (await tx.get(ref)).data();
        if (!p || !((p.keys ?? []) as string[]).includes(key)) throw bad('That record is not under this study ID.');
        const keys = ((p.keys ?? []) as string[]).filter((k) => k !== key);
        tx.set(ref, { keys, kinds: [...new Set(keys.map(kindOfKey))], links: ((p.links ?? []) as { key: string }[]).filter((x) => x.key !== key), status: keys.length ? p.status : 'retired', ...(keys.length ? {} : { statusReason: 'every record was taken off; the ID is not reused' }), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      });
      await db.collection('linkDecisions').doc(candidateId(key, studyId)).set({ recordKey: key, studyId, decision: 'different', by: who.uid, byName: who.name || who.email, at: FieldValue.serverTimestamp(), note: `unlinked: ${reason}` });
      if (kindOfKey(key) === 'eeg') await db.collection('linkEeg').doc(refOfKey(key)).set({ linkedAt: null }, { merge: true });
      await linkAudit(db, who, 'link-unlink', studyId, { record: key, reason });
      await portalAudit(db, who, 'link-unlink', studyId, { record: key, reason });
      await quietRun(db, who);
      return { ok: true };
    }

    case 'link-search': {
      const q = text(data.q, 80).toLowerCase();
      if (q.length < 2) return { people: [], records: [] };
      const l = await loadAll(db);
      const own = owners(l);
      const hits = new Set<string>();
      for (const [key, r] of l.records) {
        const w = r.kind === 'website' ? l.website.get(r.ref) : null;
        const hay = [r.ref, r.exactId, r.upn, `${r.firstName} ${r.lastName}`, w?.label, w?.referenceCode].filter(Boolean).join(' ').toLowerCase();
        if (hay.includes(q)) hits.add(key);
      }
      const people = new Set<string>();
      for (const p of l.people.values()) if (p.studyId.includes(q)) people.add(p.studyId);
      for (const k of hits) if (own.has(k)) people.add(own.get(k)!);
      return {
        people: [...people].slice(0, 50).map((id) => personCard(l, id)),
        records: [...hits].filter((k) => !own.has(k)).slice(0, 50).map((k) => ({ ...cardOf(l, k), awaiting: l.candidates.some((c) => c.recordKey === k) })),
      };
    }

    case 'link-run': {
      const r = await runLinkage(db, { by: who, syncMyself: true });
      if (r.busy) throw new HttpsError('failed-precondition', 'A matching run is already going. Try again in a minute.');
      await portalAudit(db, who, 'link-run', 'registry', { newPeople: r.newPeople, autoLinks: r.autoLinks, candidates: r.candidates });
      return { result: r };
    }

    case 'link-myself-status': {
      const status = await myselfSource(db).status();
      const counts = await db.collection('linkMyself').count().get();
      return { status, held: counts.data().count, grant: grantCommand(), settings: await settingsOf(db) };
    }

    case 'link-myself-names': {
      const code = text(data.code, 20);
      if (!/^[A-Z0-9]{4,20}$/.test(code)) throw bad('That is not a MySelf code.');
      const source = myselfSource(db);
      const st = await source.status();
      if (!st.identity.ok) throw new HttpsError('failed-precondition', 'MySelf’s identity project cannot be read from here yet, so names cannot be shown.');
      // Written before the read, as MySelf does: a look that found nothing is still a look.
      await linkAudit(db, who, 'link-myself-names', `m:${code}`, { project: st.identityProject });
      await portalAudit(db, who, 'link-myself-names', code, {});
      const n = (await source.names([code])).get(code);
      if (!n) throw bad('MySelf has no names for that code.');
      return { names: n };
    }

    case 'link-myself-upload': {
      const parts = Array.isArray(data.participants) ? (data.participants as Record<string, unknown>[]) : [];
      const ids = Array.isArray(data.identifiers) ? (data.identifiers as Record<string, unknown>[]) : [];
      if (!parts.length && !ids.length) throw bad('Choose MySelf’s participants.tsv (and the identifiers file, if you have it).');
      if (parts.length + ids.length > 20_000) throw bad('That is more rows than the portal takes in one go.');
      const code = (v: unknown) => String(v ?? '').trim().replace(/^sub-/, '').toUpperCase();
      const byCode = new Map<string, MyselfParticipant>();
      for (const r of parts) {
        const c = code(r.code);
        if (!/^[A-Z0-9]{4,20}$/.test(c)) continue;
        const sites = String(r.sites ?? '').split(/[,;\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
        const first = String(r.firstSeen ?? '').slice(0, 10);
        byCode.set(c, { code: c, sites, sittings: /^\d{4}-\d{2}-\d{2}$/.test(first) ? [{ date: first, release: '', site: sites[0] ?? '' }] : [], upn: null });
      }
      const names = new Map<string, MyselfNames>();
      for (const r of ids) {
        const c = code(r.code);
        if (!/^[A-Z0-9]{4,20}$/.test(c)) continue;
        const p = byCode.get(c) ?? { code: c, sites: [], sittings: [], upn: null };
        const upn = String(r.upn ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (/^[A-Z]\d{11}[0-9A-Z]$/.test(upn)) p.upn = upn;
        byCode.set(c, p);
        names.set(c, { givenName: String(r.givenName ?? '').slice(0, 80), familyName: String(r.familyName ?? '').slice(0, 80), dateOfBirth: /^\d{4}-\d{2}-\d{2}$/.test(String(r.dob ?? '')) ? String(r.dob) : null, postcode: String(r.postcode ?? '').slice(0, 10) });
      }
      await saveMyself(db, [...byCode.values()], 'upload');
      await linkAudit(db, who, 'link-myself-upload', 'myself', { participants: byCode.size, withNames: names.size });
      await portalAudit(db, who, 'link-myself-upload', 'myself', { participants: byCode.size, withNames: names.size });
      // The names are used for this run's matching and then dropped: never stored.
      const r = await quietRun(db, who, { names });
      return { saved: byCode.size, withNames: names.size, result: r };
    }

    case 'link-eeg-upload': {
      const rows = Array.isArray(data.rows) ? (data.rows as Record<string, unknown>[]) : [];
      if (!rows.length) throw bad('The manifest has no rows.');
      if (rows.length > 5000) throw bad('That is more rows than the portal takes in one go.');
      const settings = await settingsOf(db);
      const problems: string[] = [];
      const good: EegRow[] = [];
      const seen = new Set<string>();
      for (const raw of rows) {
        const r = eegRowOf(raw, siteSchools, settings.siteMap);
        if ('problem' in r) problems.push(r.problem);
        else if (seen.has(r.row.recordingId)) problems.push(`${r.row.recordingId}: on the manifest twice; the first row is used.`);
        else {
          seen.add(r.row.recordingId);
          good.push(r.row);
        }
      }
      if (!good.length) throw bad(`Nothing could be used. ${problems.slice(0, 5).join(' ')}`);
      const existing = new Set((await db.collection('linkEeg').select().get()).docs.map((d) => d.id));
      const writer = db.bulkWriter();
      for (const r of good) writer.set(db.collection('linkEeg').doc(r.recordingId), { ...r, exactId: eegRecord(r).exactId, uploadedBy: who.uid, uploadedByName: who.name, uploadedAt: FieldValue.serverTimestamp(), namesRemovedAt: null }, { merge: true });
      await writer.close();
      const added = good.filter((r) => !existing.has(r.recordingId)).length;
      await linkAudit(db, who, 'link-eeg-upload', 'eeg', { rows: good.length, added, updated: good.length - added, problems: problems.length, fileName: text(data.fileName, 200) });
      await portalAudit(db, who, 'link-eeg-upload', 'eeg', { rows: good.length, added, problems: problems.length });
      const r = await quietRun(db, who);
      return { saved: good.length, added, updated: good.length - added, problems, result: r };
    }

    case 'link-eeg-list': {
      const l = await loadAll(db);
      const own = owners(l);
      const waiting = new Set(l.candidates.map((c) => c.recordKey));
      return {
        recordings: [...l.eeg.values()]
          .sort((a, b) => String(b.recordingDate ?? '').localeCompare(String(a.recordingDate ?? '')) || a.recordingId.localeCompare(b.recordingId))
          .map((e) => {
            const key = recordKey('eeg', e.recordingId);
            return { recordingId: e.recordingId, name: e.firstName ? `${e.firstName} ${e.lastName}` : '', dob: e.dob, sex: e.sex, recordingDate: e.recordingDate, site: e.site, school: schoolName(e.schoolId), task: e.task, studyId: own.get(key) ?? null, status: own.has(key) ? (l.people.get(own.get(key)!)?.status === 'withdrawn' ? 'withdrawn' : 'linked') : waiting.has(key) ? 'awaiting review' : 'no study ID yet', namesRemovedAt: e.namesRemovedAt };
          }),
      };
    }

    case 'link-audit': {
      const snap = await db.collection('linkAudit').orderBy('at', 'desc').limit(Math.min(500, Number(data.limit) || 200)).get();
      return { entries: snap.docs.map((d) => ({ id: d.id, at: iso(d.data().at), by: d.data().byName, action: d.data().action, target: d.data().target, details: d.data().details ?? {} })) };
    }

    case 'link-settings':
      return { settings: await settingsOf(db), schools: siteSchools.map((s) => ({ id: s.id, name: s.name })) };

    case 'link-save-settings': {
      if (who.role !== 'pm') throw refused();
      const raw = (data.siteMap ?? {}) as Record<string, unknown>;
      const siteMap: Record<string, string> = {};
      const ids = new Set(siteSchools.map((s) => s.id));
      for (const [k, v] of Object.entries(raw)) {
        const code = k.trim().toUpperCase();
        const school = String(v ?? '').trim();
        if (!/^[A-Z]{2,10}$/.test(code)) throw bad(`“${k}” is not a MySelf site code (two or more letters).`);
        if (!ids.has(school)) throw bad(`“${school}” is not one of the website’s schools.`);
        siteMap[code] = school;
      }
      await db.collection('linkMeta').doc('settings').set({ siteMap, updatedBy: who.uid, updatedAt: FieldValue.serverTimestamp() });
      await linkAudit(db, who, 'link-save-settings', 'settings', { siteMap });
      await portalAudit(db, who, 'link-save-settings', 'linkage', { siteMap });
      return { settings: { siteMap } };
    }
  }
  throw bad('Unknown action.');
}

const tierRank = (t: string) => ({ decision: 0, exact: 1, variant: 2, upn: 3, fuzzy: 4, new: 5 })[t as 'exact'] ?? 9;

/** The command that lets the portal read MySelf, for the "not connected" message. */
export function grantCommand(): string {
  return `bash grant-myself-read.sh ${MYSELF_RESEARCH_PROJECT} ${MYSELF_IDENTITY_PROJECT}   # in Google Cloud Shell, as an owner of the MySelf projects (study ${MYSELF_STUDY})`;
}
