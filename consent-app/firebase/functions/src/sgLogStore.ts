import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { schools as siteSchools } from './forms.js';
import { isHolder, mayAddStep, reporterView, sgAlert, sgInput, sgSettingsOf, SG_ID, SG_STEP_LABEL, withStep, type Role, type SgRecord, type SgStep, type SgStepKind, type SgViewer } from './sgLog.js';

/**
 * The safeguarding log in Firestore (22 November 2026): portalSafeguarding/{id},
 * the id made by the browser so a report sent twice is stored once. Only the
 * functions touch it (firestore.rules); it is not read by the export, the Sheet
 * or the daily email. The audit log records that something happened, never what.
 */

export interface Who {
  uid: string;
  email: string;
  name: string;
  role: Role | null;
}
const bad = (m: string) => new HttpsError('invalid-argument', m);
const refused = (m = 'Only the people who hold the safeguarding log can see that.') => new HttpsError('permission-denied', m);
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const SCHOOL = new Map(siteSchools.map((s) => [s.id, s.name]));
export const SG_URL = 'https://myphonemybrain.com/portal/#safeguarding-log';

function recordOf(id: string, x: Record<string, unknown>): SgRecord {
  return {
    id,
    uid: String(x.uid ?? ''),
    reporterName: String(x.reporterName ?? ''),
    reporterRole: String(x.reporterRole ?? ''),
    occurredAt: String(x.occurredAt ?? ''),
    receivedAt: String(x.receivedAt ?? ''),
    source: (x.source as SgRecord['source']) ?? 'other',
    visitId: typeof x.visitId === 'string' ? x.visitId : null,
    schoolId: typeof x.schoolId === 'string' ? x.schoolId : null,
    about: String(x.about ?? ''),
    yearGroup: String(x.yearGroup ?? ''),
    account: String(x.account ?? ''),
    immediate: String(x.immediate ?? ''),
    immediateDanger: x.immediateDanger === true,
    dsl: (x.dsl as SgRecord['dsl']) ?? 'not-yet',
    dslName: String(x.dslName ?? ''),
    dslAt: typeof x.dslAt === 'string' ? x.dslAt : null,
    dslHow: (x.dslHow as SgRecord['dslHow']) ?? null,
    status: x.status === 'closed' ? 'closed' : 'open',
    outcome: String(x.outcome ?? ''),
    steps: (Array.isArray(x.steps) ? x.steps : []) as SgStep[],
  };
}
const withSchool = <T extends SgRecord>(r: T) => ({ ...r, schoolName: r.schoolId ? (SCHOOL.get(r.schoolId) ?? r.schoolId) : '' });

async function settings(db: Firestore) {
  return sgSettingsOf((await db.collection('portalSettings').doc('safeguarding').get()).data());
}
async function audit(db: Firestore, who: Who, action: string, target: string) {
  await db.collection('portalAudit').add({ at: FieldValue.serverTimestamp(), by: who.uid, byEmail: who.email, byName: who.name, action, target, details: {} });
}

export async function sgAction(db: Firestore, who: Who, action: string, data: Record<string, unknown>, send: (to: string, subject: string, text: string, html: string) => Promise<unknown>): Promise<unknown> {
  const v: SgViewer = { uid: who.uid, email: who.email, role: who.role };
  const s = await settings(db);
  const holder = isHolder(v, s);
  switch (action) {
    case 'sg-holder':
      return { holder };

    case 'sg-report': {
      const parsed = sgInput(data.report as Record<string, unknown>);
      if (!parsed.ok) throw bad(parsed.problem);
      const r = parsed.value;
      const ref = db.collection('portalSafeguarding').doc(r.id);
      const visit = r.visitId ? await db.collection('portalVisits').doc(r.visitId).get() : null;
      const record: Omit<SgRecord, 'id'> = { ...r, visitId: visit?.exists ? r.visitId : null, schoolId: visit?.exists ? String(visit.data()?.schoolId ?? '') || null : null, uid: who.uid, reporterName: who.name || who.email, reporterRole: who.role ?? '', receivedAt: new Date().toISOString(), status: 'open', outcome: '', steps: [] };
      const created = await db.runTransaction(async (tx) => {
        const had = await tx.get(ref);
        if (had.exists) {
          if (had.data()?.uid !== who.uid) throw refused('That report belongs to someone else.');
          return false;
        }
        tx.create(ref, { ...record, createdAt: FieldValue.serverTimestamp() });
        return true;
      });
      if (created) {
        await audit(db, who, 'sg-report', r.id);
        // The log holders hear that there is something to read; the details stay in the portal.
        const pms = (await db.collection('portalUsers').where('role', '==', 'pm').get()).docs.filter((d) => d.data().status === 'active').map((d) => String(d.data().email ?? '').toLowerCase());
        const to = [...new Set([...pms, ...s.holders])].filter(Boolean);
        const alert = sgAlert({ ...record }, `${SG_URL}/${r.id}`);
        if (to.length)
          await send(to.join(', '), alert.subject, alert.text, alert.html).catch((error) => {
            logger.error('Safeguarding alert not sent', { error: error instanceof Error ? error.message : String(error) });
          });
      }
      return { id: r.id, duplicate: !created };
    }

    case 'sg-mine': {
      const snap = await db.collection('portalSafeguarding').where('uid', '==', who.uid).get();
      return { reports: snap.docs.map((d) => withSchool(reporterView(recordOf(d.id, d.data())))).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), holder };
    }

    case 'sg-list': {
      if (!holder) throw refused();
      const snap = await db.collection('portalSafeguarding').get();
      await audit(db, who, 'sg-list', 'safeguarding log');
      return { records: snap.docs.map((d) => withSchool(recordOf(d.id, d.data()))).sort((a, b) => (a.status === b.status ? b.occurredAt.localeCompare(a.occurredAt) : a.status === 'open' ? -1 : 1)) };
    }

    case 'sg-step': {
      const id = clip(data.id, 64);
      if (!SG_ID.test(id)) throw bad('Which record?');
      const kind = (Object.keys(SG_STEP_LABEL) as SgStepKind[]).includes(data.kind as SgStepKind) ? (data.kind as SgStepKind) : null;
      if (!kind) throw bad('What are you adding?');
      const text = clip(data.text, 4000);
      if (!text && kind !== 'reopened') throw bad(kind === 'closed' ? 'Write the outcome first.' : 'Write it first.');
      const ref = db.collection('portalSafeguarding').doc(id);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw bad('That record is not there.');
        const r = recordOf(id, snap.data()!);
        if (!mayAddStep(r, kind, v, s)) throw refused(kind === 'addendum' ? 'You can add only to your own reports.' : r.uid === who.uid && !holder ? 'Only the people who hold the safeguarding log can record actions or close it.' : 'That can’t be done to this record now.');
        const step: SgStep = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), by: who.uid, byName: who.name || who.email, kind, text };
        tx.update(ref, { ...withStep(r, step), updatedAt: FieldValue.serverTimestamp() });
      });
      await audit(db, who, `sg-${kind}`, id);
      return { ok: true };
    }

    case 'sg-settings':
      return { settings: s };

    case 'sg-save-settings': {
      const next = sgSettingsOf({ holders: data.holders });
      await db.collection('portalSettings').doc('safeguarding').set({ ...next, updatedBy: who.uid, updatedAt: FieldValue.serverTimestamp() });
      await db.collection('portalAudit').add({ at: FieldValue.serverTimestamp(), by: who.uid, byEmail: who.email, byName: who.name, action: 'sg-save-settings', target: 'safeguarding', details: { ...next } });
      return { settings: next };
    }
  }
  throw bad('Unknown action.');
}
