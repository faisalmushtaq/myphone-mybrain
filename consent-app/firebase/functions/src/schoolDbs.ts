import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { assignmentOf, dbsPageRows, normaliseVisit, settingsOf, ukToday, type DbsInfo, type VisitStatus } from './portalCore.js';
import { countFailure, passwordMatches } from './schoolUpload.js';

/**
 * A school's DBS page (myphonemybrain.com/schools/dbs/?school=<slug>, 4
 * November 2026): the DBS details of the people coming to that school's
 * visits, as the project manager checked them, behind the school's own
 * password (schoolDbsAccess/{slug}: a scrypt hash, made by the project
 * manager in the portal and given to the school by phone; apart from the
 * class-list password, since another member of staff may hold it). Wrong
 * passwords are limited per browser and per school. Copies of certificates
 * only when the project manager allows them for that school (portalSchools
 * dbsCopies), as five-minute links. Every view is in the portal's audit log.
 */
const REGION = 'europe-west2';
const FAILURES_PER_SESSION = 10;
const FAILURES_PER_SCHOOL = 25;
const SLUG = /^[a-z0-9-]{1,40}$/;

export interface DbsAccess {
  schoolId: string;
  hash: string;
  salt: string;
  active: boolean;
}

/** Lets the request through only with the school's current DBS password; wrong guesses are limited per browser and per school. */
export async function checkDbsPassword(db: Firestore, uid: string, slug: string, password: unknown): Promise<DbsAccess> {
  const keys = [`dbs-fail-${slug}`, `dbs-fail-uid-${uid}`];
  const limits = [FAILURES_PER_SCHOOL, FAILURES_PER_SESSION];
  const open = await Promise.all(keys.map((k, i) => countFailure(db, k, limits[i], false)));
  if (open.includes(false)) throw new HttpsError('failed-precondition', 'Too many wrong passwords. Please wait an hour, or ask the research team for help.');
  const access = (await db.collection('schoolDbsAccess').doc(slug).get()).data();
  if (!access?.active || typeof access.hash !== 'string') throw new HttpsError('failed-precondition', 'This page is not open for your school. Please ask the research team for a password.');
  const ok = typeof password === 'string' && password.length <= 40 && (await passwordMatches(password, { hash: access.hash, salt: String(access.salt) }));
  if (!ok) {
    await Promise.all(keys.map((k, i) => countFailure(db, k, limits[i], true)));
    throw new HttpsError('failed-precondition', 'That password is not right. Check it against the one the research team gave you; capitals and dashes do not matter.');
  }
  return { schoolId: String(access.schoolId), hash: access.hash, salt: String(access.salt), active: true };
}

/** What the school's page shows, for the school whose password was given. */
export async function dbsPageFor(db: Firestore, schoolId: string, today = ukToday()) {
  const [settingsSnap, schoolSnap, visitsSnap, usersSnap, docsSnap] = await Promise.all([
    db.collection('portalSettings').doc('main').get(),
    db.collection('portalSchools').doc(schoolId).get(),
    db.collection('portalVisits').where('schoolId', '==', schoolId).get(),
    db.collection('portalUsers').get(),
    db.collection('portalDocs').where('status', '==', 'verified').get(),
  ]);
  const settings = settingsOf(settingsSnap.data());
  const dbsTypes = new Set(settings.docTypes.filter((t) => t.dbs).map((t) => t.id));
  const allowCopies = schoolSnap.data()?.dbsCopies === true;
  const dbs = new Map<string, (DbsInfo & { docId: string | null }) | null>();
  const at = new Map<string, string>();
  for (const d of docsSnap.docs) {
    const x = d.data();
    if (!dbsTypes.has(String(x.typeId)) || x.schoolId) continue;
    const when = String(x.uploadedAt?.toDate?.().toISOString?.() ?? x.uploadedAt ?? '');
    if ((at.get(String(x.uid)) ?? '') >= when) continue;
    at.set(String(x.uid), when);
    dbs.set(String(x.uid), { certificateNumber: String(x.details?.certificateNumber ?? ''), issueDate: String(x.details?.issueDate ?? ''), updateService: x.details?.updateService === true, docId: allowCopies && typeof x.path === 'string' && !x.deletedAt ? d.id : null });
  }
  const visits = await Promise.all(
    visitsSnap.docs.map(async (d) => {
      const n = normaliseVisit(d.data());
      const assignments = (await db.collection('portalAssignments').where('visitId', '==', d.id).get()).docs.map((a) => assignmentOf(a.data(), n.days));
      return { visitId: d.id, status: (d.data().status ?? 'draft') as VisitStatus, days: n.days, location: n.location, assignments };
    }),
  );
  const names = new Map(usersSnap.docs.map((d) => [d.id, String(d.data().name ?? '')]));
  const rows = dbsPageRows({ visits, today, names, dbs });
  return { schoolName: String(schoolSnap.data()?.name ?? schoolId), allowCopies, visits: rows };
}

export const schoolDbs = onCall({ region: REGION, memory: '512MiB', timeoutSeconds: 60, enforceAppCheck: process.env.MPMB_ENFORCE_APP_CHECK === 'true' }, async (request) => {
  const db = getFirestore();
  const data = (request.data ?? {}) as Record<string, unknown>;
  const slug = typeof data.school === 'string' ? data.school.trim().toLowerCase() : '';
  if (!SLUG.test(slug)) throw new HttpsError('invalid-argument', 'This link does not name a school. Please use the link the research team sent you.');
  const uid = request.auth?.uid ?? 'anon';
  const access = await checkDbsPassword(db, uid, slug, data.password);
  const page = await dbsPageFor(db, access.schoolId);
  const audit = (action: string, details: Record<string, unknown>) => db.collection('portalAudit').add({ at: FieldValue.serverTimestamp(), by: 'school', byEmail: '', byName: `${page.schoolName} (DBS page)`, action, target: access.schoolId, details });

  if (data.action === 'copy') {
    const docId = typeof data.docId === 'string' ? data.docId : '';
    if (!page.allowCopies) throw new HttpsError('permission-denied', 'Copies of certificates are not shared with this school.');
    const person = page.visits.flatMap((v) => v.days.flatMap((d) => d.people)).find((p) => p.dbs?.docId === docId);
    if (!person) throw new HttpsError('permission-denied', 'That certificate is not one of the people coming to your school.');
    const snap = await db.collection('portalDocs').doc(docId).get();
    const path = snap.data()?.path;
    if (typeof path !== 'string') throw new HttpsError('not-found', 'The copy is no longer kept.');
    await audit('school-dbs-copy', { uid: person.uid, docId });
    try {
      const [url] = await getStorage().bucket().file(path).getSignedUrl({ action: 'read', expires: Date.now() + 5 * 60_000 });
      return { url };
    } catch (error) {
      if (process.env.FUNCTIONS_EMULATOR !== 'true') {
        logger.error('School DBS page: could not sign a link', { error: String(error) });
        throw new HttpsError('internal', 'The copy could not be opened. Please try again.');
      }
      const [bytes] = await getStorage().bucket().file(path).download();
      return { url: `data:${String(snap.data()?.contentType ?? 'application/pdf')};base64,${bytes.toString('base64')}` };
    }
  }

  // Every view is recorded: which school, when, which visits.
  await db.collection('schoolDbsAccess').doc(slug).set({ lastViewedAt: FieldValue.serverTimestamp() }, { merge: true });
  await audit('school-dbs-view', { visits: page.visits.map((v) => v.visitId) });
  return {
    schoolName: page.schoolName,
    allowCopies: page.allowCopies,
    visits: page.visits.map((v) => ({
      location: v.location,
      days: v.days.map((d) => ({
        date: d.date,
        start: d.start,
        end: d.end,
        // Only what the project manager checked; nobody's job, contact details or anything else.
        people: d.people.map((p) => ({ name: p.name, dbs: p.dbs ? { certificateNumber: p.dbs.certificateNumber, issueDate: p.dbs.issueDate, updateService: p.dbs.updateService, enhanced: true, docId: p.dbs.docId } : null })),
      })),
    })),
  };
});
