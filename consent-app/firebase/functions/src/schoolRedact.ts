import { FieldValue, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions/v2';
import type { Doc } from './export.js';
import { optOutFor, optOutsOf, type OptOut } from './exportUpn.js';

/**
 * Opted-out pupils keep only a minimal record (26 October 2026). Since 27
 * October 2026 a class list gives only the UPN, names and date of birth. For a
 * pupil whose parent or carer opted them out, only what honours the opt-out is
 * kept: their names, school and UPN, with the opt-out's kind and date; the
 * date of birth is blanked in the stored list, and so in the export.
 *
 * Lists read before 27 October 2026 may also hold year group, class, gender,
 * ethnicity, address, postcode, email, FSM and SEN (the earlier template):
 * those fields are removed from every pupil, opted out or not (LEGACY_FIELDS).
 *
 * The file as the school sent it holds those fields too, so once a file that
 * the website read automatically names an opted-out pupil, the file itself is
 * deleted: what was read from it (redacted) is the record, with its SHA-256.
 * A file the website could not read (read by hand) is kept for the team, who
 * remove the opted-out pupils' details by hand; the staff page and the export
 * say which.
 */

/** The fields blanked for an opted-out pupil. */
export const REDACTED_FIELDS = ['dateOfBirth'] as const;

/** Read from lists before 27 October 2026, and no longer kept for anyone. */
export const LEGACY_FIELDS = ['gender', 'ethnicity', 'schoolName', 'yearGroup', 'formTutor', 'className', 'address', 'postcode', 'email', 'fsm', 'sen'] as const;

/** A pupil's row without the fields the study no longer keeps; null when it had none of them. */
export function withoutLegacy(p: Record<string, unknown>): Record<string, unknown> | null {
  if (!LEGACY_FIELDS.some((f) => f in p)) return null;
  const out = { ...p };
  for (const f of LEGACY_FIELDS) delete out[f];
  return out;
}

export interface Redaction {
  uploadId: string;
  pupils: Record<string, unknown>[];
  /** Rows newly redacted in this pass. */
  newly: number;
  /** The original file to delete: read automatically, still kept, and naming an opted-out pupil. */
  removeOriginal: string | null;
  /** Read by hand, and naming an opted-out pupil: the team removes their details from the file by hand. */
  byHand: boolean;
}

/** One pupil's row, reduced to the minimal record, with the opt-out it honours. */
export function redactPupil(p: Record<string, unknown>, o: OptOut, at: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...p };
  for (const f of REDACTED_FIELDS) out[f] = null;
  for (const f of LEGACY_FIELDS) delete out[f];
  return { ...out, optedOut: true, optOutId: o.id, optOutKind: o.kind, optOutReceivedOn: o.receivedOn, redactedAt: at };
}

/** What to change in each school's uploads for the standing opt-outs (pure, for the tests). */
export function redactionsFor(uploads: Doc[], optOutDocs: Doc[], at: string): Redaction[] {
  const optOuts = optOutsOf(optOutDocs);
  const out: Redaction[] = [];
  for (const { id, data: d } of uploads) {
    const school = String(d.schoolId ?? '');
    let newly = 0;
    let named = false;
    let trimmed = false;
    const pupils = ((d.pupils ?? []) as Record<string, unknown>[]).map((row) => {
      const lean = withoutLegacy(row);
      if (lean) trimmed = true;
      const p = lean ?? row;
      if (p.optedOut === true) {
        named = true;
        return p;
      }
      const o = optOutFor({ schoolId: school, firstName: p.firstName, lastName: p.lastName, dateOfBirth: p.dateOfBirth }, optOuts);
      if (!o) return p;
      named = true;
      newly += 1;
      return redactPupil(p, o, at);
    });
    const kept = typeof d.path === 'string' && d.path;
    const removeOriginal = named && kept && d.needsManualReading !== true ? (d.path as string) : null;
    if (newly || removeOriginal || trimmed) out.push({ uploadId: id, pupils, newly, removeOriginal, byHand: named && d.needsManualReading === true });
  }
  return out;
}

/** Apply the redactions: run with each hourly export, when an opt-out is logged and when a school sends a list. Never throws. */
export async function redactOptedOutPupils(db: Firestore): Promise<{ rows: number; filesRemoved: number }> {
  try {
    const [uploads, optOuts] = await Promise.all([db.collection('schoolUploads').get(), db.collection('optOuts').get()]);
    const at = new Date().toISOString();
    const plan = redactionsFor(
      uploads.docs.map((x) => ({ id: x.id, data: x.data() as DocumentData })),
      optOuts.docs.map((x) => ({ id: x.id, data: x.data() as DocumentData })),
      at,
    );
    let rows = 0;
    let filesRemoved = 0;
    for (const r of plan) {
      const update: Record<string, unknown> = { pupils: r.pupils, optOutRedactedAt: FieldValue.serverTimestamp(), optOutByHand: r.byHand };
      if (r.removeOriginal) {
        await getStorage().bucket().file(r.removeOriginal).delete({ ignoreNotFound: true });
        Object.assign(update, { path: null, removedPath: r.removeOriginal, originalRemovedAt: FieldValue.serverTimestamp(), originalRemovedReason: 'names an opted-out pupil; what was read from it is kept, redacted' });
        filesRemoved += 1;
      }
      await db.collection('schoolUploads').doc(r.uploadId).set(update, { merge: true });
      rows += r.newly;
    }
    if (rows || filesRemoved) logger.info('Opted-out pupils redacted', { rows, filesRemoved });
    return { rows, filesRemoved };
  } catch (error) {
    logger.error('Opted-out pupils could not be redacted', { error: String((error as Error)?.message ?? error) });
    return { rows: 0, filesRemoved: 0 };
  }
}
