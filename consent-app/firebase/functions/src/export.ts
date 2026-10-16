import { getFirestore, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions/v2';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { labExport, type Derivation } from './exportLab.js';
import { optOutFor, optOutsOf, upnExport } from './exportUpn.js';
import { usageExport } from './exportUsage.js';
import { COPY_LIMIT, needsWrite, planCopies, staleObjects, stampFor, copyState, UNPACK_LIMIT, unpackDue, type CopyJob, type ObjectInfo, type UnpackFailure } from './exportWrite.js';
import { moreQuestionTopics, moreQuestionWording, noPhoneQuestionWording, parentMoreForm, parentNoPhoneForm, parentQuestionsForm, questionWording, study, type ServedQuestionForm } from './forms.js';

/**
 * The hourly export: everything the studies have recorded, written into a
 * private bucket of its own, one folder per study, each with two subfolders.
 *
 *   schools/donations/       the young people's study: the research dataset
 *                            in BIDS layout, de-identified: a participants
 *                            table, the parent questionnaire as a phenotype
 *                            file, one session per screenshot send with a
 *                            behavioural table listing the images and their
 *                            quality checks, the images themselves under
 *                            sourcedata/, and data dictionaries.
 *   schools/identifying/     names, dates of birth, contact details, the
 *                            consent and agreement records, signatures and
 *                            website enquiries, with the key from BIDS labels
 *                            to people. Never inside the BIDS dataset.
 *   schools/upn-uploads/     the UPN lists schools send, matched to the families'
 *                            records (exportUpn.ts)
 *   social-media-break/      the adult laboratory study, same shape:
 *                            donations/ holds the donated archives and
 *                            screenshots, identifying/ the consent records
 *                            (exportLab.ts).
 *   website-usage/           the website's anonymous usage counts
 *                            (exportUsage.ts).
 *
 * Each study's datasets are named by what they are, because the website's is
 * one source among several: the teams keep their own datasets (workshop EEG,
 * laboratory visits) beside donations/ in the study folder. The folders the
 * export writes are mirrors, so nothing may be added inside them.
 *
 * The bucket is a mirror of the current records: every run writes the
 * tables that changed, copies any image or signature that is missing or
 * holds the wrong file (exportWrite.ts), and deletes anything that no longer
 * belongs (for example after a withdrawal). A read-only key for the bucket
 * lets one computer mirror it into OneDrive (scripts/setup-exports.sh,
 * scripts/mac-sync-install.sh), which since 16 October 2026 is the team's
 * main way into the data: manifest.json says what the last run did and
 * anything it could not do.
 */

const REGION = 'europe-west2';
const BATCH = 8;
/** The young people's study's folder, and its two subfolders. */
export const SCHOOLS = 'schools';
const B = `${SCHOOLS}/donations`;
const I = `${SCHOOLS}/identifying`;
const BIDS_VERSION = '1.10.0';
const TASK = 'screentime';
const CODE_URL = 'https://github.com/faisalmushtaq/myphone-mybrain';

export interface Doc {
  id: string;
  data: DocumentData;
}
export type Row = Record<string, unknown>;

export interface Manifest {
  exportedAt: string;
  bucket: string;
  /** complete: everything copied; incomplete: files still to copy (binaryBacklog) or something failed (the lists below). copying: written before the copies start, replaced when they end. */
  status: 'complete' | 'incomplete' | 'copying';
  counts: Record<string, number>;
  /** Images, signatures, archives, recordings and archive tables still to copy or build: later runs catch up. */
  binaryBacklog: number;
  /** Files that could not be copied this run (or whose record points at nothing in storage), with why. */
  copyFailures: { file: string; error: string }[];
  /** Archives that could not be unpacked into tables; each is tried again a day later. */
  unpackFailures: UnpackFailure[];
  /** Tables and text files that could not be written this run. */
  writeFailures: { file: string; error: string }[];
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

/** BIDS-style TSV: tab-separated, UTF-8 without a byte-order mark, "n/a" for missing values, no tabs or line breaks inside a cell. Lists join with "; ". */
export function toTsv(rows: Row[], columns?: string[]): string {
  const cols = columns ?? Array.from(rows.reduce((set, row) => (Object.keys(row).forEach((k) => set.add(k)), set), new Set<string>()));
  const cell = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return 'n/a';
    if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x))).join('; ') : 'n/a';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.replace(/[\t\r\n]+/g, ' ').trim() || 'n/a';
  };
  return `${[cols.join('\t'), ...rows.map((row) => cols.map((c) => cell(row[c])).join('\t'))].join('\n')}\n`;
}

/**
 * Keys never written to any raw file, at any depth (16 October 2026): the
 * anonymous sign-in ids that let a session add to a record, the hashes the
 * server compares a link key or the last save with, and any password hash
 * or salt. They are means of access, not data.
 */
export const SECRET_KEYS: ReadonlySet<string> = new Set(['sessionUid', 'sessionUids', 'resumeUids', 'hashes', 'youngLinkHash', 'linkKey', 'linkKeyHash', 'hash', 'salt', 'passwordHash']);

/** A record without the secret keys, at any depth. */
export function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => !SECRET_KEYS.has(k)).map(([k, v]) => [k, withoutSecrets(v)]));
  return value;
}

/** JSON Lines, one document a line, the secret keys left out. */
export function toJsonl(docs: Doc[]): string {
  return docs.map((d) => JSON.stringify(withoutSecrets({ id: d.id, ...d.data }))).join('\n') + (docs.length ? '\n' : '');
}

/** What a device said about itself (user agent, time zone): kept in identifying/ raw files only, never in a research dataset's. */
export const CLIENT_KEYS: ReadonlySet<string> = new Set(['client', 'userAgent']);

/** Records for a research dataset's raw files: no device details, and (for the schools' study) the sub- label in place of the database's participant id, so the dataset stands alone. Records without a label are left out. */
export function researchDocs(docs: Doc[], labels?: Map<string, string>): Doc[] {
  return docs.flatMap(({ id, data }) => {
    const out: DocumentData = Object.fromEntries(Object.entries(data).filter(([k]) => !CLIENT_KEYS.has(k)));
    if (!labels) return [{ id, data: out }];
    const label = labels.get(String(data.participantId));
    if (!label) return [];
    delete out.participantId;
    return [{ id, data: { participant_id: label, ...out } }];
  });
}

const two = (n: number) => String(n).padStart(2, '0');
/** sub-00001, sub-00002… in order of consent. */
export const subjectLabel = (studyNumber: number) => `sub-${String(studyNumber).padStart(5, '0')}`;
export const sessionLabel = (n: number) => `ses-${two(n)}`;
/** Column names in BIDS tables: question and statement ids use hyphens, columns use underscores. */
export const snake = (s: string) => s.replace(/-/g, '_');

/** Whole years between a date of birth and a date, both YYYY-MM-DD or ISO. */
export function ageAt(dateOfBirth: unknown, when: unknown): number | null {
  const dob = typeof dateOfBirth === 'string' ? new Date(dateOfBirth) : null;
  const at = typeof when === 'string' ? new Date(when) : null;
  if (!dob || !at || Number.isNaN(dob.getTime()) || Number.isNaN(at.getTime())) return null;
  let age = at.getUTCFullYear() - dob.getUTCFullYear();
  const months = at.getUTCMonth() - dob.getUTCMonth();
  if (months < 0 || (months === 0 && at.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

/** Everything the export needs in memory, with consenting participants mapped to their BIDS labels. */
export interface Snapshot {
  participants: Doc[];
  consents: Doc[];
  assents: Doc[];
  submissions: Doc[];
  enquiries: Doc[];
  surveys: Doc[];
  donations: Doc[];
  /** Parents' emailed opt-outs from the workshop, as the team logged them on the staff page. */
  optOuts?: Doc[];
  /** Firestore participant id → sub-label, for participants with a permission record. */
  labels: Map<string, string>;
}

export interface Session {
  participantId: string;
  label: string;
  session: string;
  donation: Doc;
  images: DocumentData[];
}

/** Each screenshot send is a BIDS session, numbered in time order per participant. */
export function sessionsOf(snap: Snapshot): Session[] {
  const byParticipant = new Map<string, Doc[]>();
  for (const d of snap.donations) {
    const pid = String(d.data.participantId);
    if (!byParticipant.has(pid)) byParticipant.set(pid, []);
    byParticipant.get(pid)!.push(d);
  }
  const out: Session[] = [];
  for (const [pid, docs] of byParticipant) {
    const label = snap.labels.get(pid);
    if (!label) continue;
    docs.sort((a, b) => String(a.data.receivedAt ?? '').localeCompare(String(b.data.receivedAt ?? '')));
    docs.forEach((donation, i) => out.push({ participantId: pid, label, session: sessionLabel(i + 1), donation, images: ((donation.data.images ?? []) as DocumentData[]) }));
  }
  return out.sort((a, b) => `${a.label}/${a.session}`.localeCompare(`${b.label}/${b.session}`));
}

/** Where a screenshot lives inside the dataset, relative to the dataset root. */
export function screenshotFile(s: Session, run: number, sourcePath: string): string {
  const ext = /\.jpe?g$/i.test(sourcePath) ? 'jpg' : 'png';
  return `sourcedata/${s.label}/${s.session}/${s.label}_${s.session}_task-${TASK}_run-${two(run)}_screenshot.${ext}`;
}

/** Where a signature image lives, relative to identifying/. */
export function signatureFile(label: string | undefined, participantId: string, kind: 'consent' | 'assent', version: unknown): string {
  const who = label ?? `unlabelled-${participantId}`;
  return `signatures/${who}/${who}_${kind}-v${String(version ?? 1)}_signature.png`;
}

/** Each participant's latest answers to one of the parent's question forms (records from before the longer questions are the quick ones). */
function latestSurveys(snap: Snapshot, formId: string = parentQuestionsForm.id): Map<string, Doc> {
  const latest = new Map<string, Doc>();
  for (const s of snap.surveys) {
    if (String(s.data.formId ?? parentQuestionsForm.id) !== formId) continue;
    const pid = String(s.data.participantId);
    const current = latest.get(pid);
    if (!current || Number(s.data.version ?? 0) > Number(current.data.version ?? 0)) latest.set(pid, s);
  }
  return latest;
}

const byLabel = (a: Row, b: Row) => String(a.participant_id).localeCompare(String(b.participant_id));

export function participantsTable(snap: Snapshot): Row[] {
  const sessions = sessionsOf(snap);
  const submissionBy = new Map(snap.submissions.map((s) => [String(s.data.participantId), s]));
  const consentBy = new Map(snap.consents.map((c) => [c.id, c]));
  const assentBy = new Map(snap.assents.map((a) => [a.id, a]));
  const surveyBy = latestSurveys(snap);
  const moreBy = latestSurveys(snap, parentMoreForm.id);
  const noPhoneBy = latestSurveys(snap, parentNoPhoneForm.id);
  const optOuts = optOutsOf(snap.optOuts ?? []);
  return snap.participants
    .filter((p) => snap.labels.has(p.id))
    .map((p) => {
      const submission = submissionBy.get(p.id);
      const consent = submission?.data.consentId ? consentBy.get(String(submission.data.consentId)) : undefined;
      const assent = submission?.data.assentId ? assentBy.get(String(submission.data.assentId)) : undefined;
      const mine = sessions.filter((s) => s.participantId === p.id);
      // A young person of 16 or over deciding alone has no permission record: their own agreement dates the record.
      const agreedOn = consent?.data.confirmedDate ?? (typeof assent?.data.completedAt === 'string' ? assent.data.completedAt.slice(0, 10) : null);
      return {
        participant_id: snap.labels.get(p.id),
        age: ageAt(p.data.dateOfBirth, agreedOn ?? consent?.data.completedAt),
        year_group: p.data.yearGroup,
        site: p.data.schoolId,
        route: consent?.data.route ?? submission?.data.route,
        consented_on: agreedOn,
        consent_version: consent?.data.formVersion ?? null,
        self_consent: Boolean(p.data.selfConsent ?? submission?.data.selfConsent),
        phone_source: p.data.phoneSource ?? submission?.data.phoneSource ?? null,
        assent_status: assent?.data.status,
        questions_status: surveyBy.get(p.id)?.data.status ?? 'not-started',
        more_questions_status: moreBy.get(p.id)?.data.status ?? 'not-asked',
        no_phone_questions_status: noPhoneBy.get(p.id)?.data.status ?? 'not-asked',
        sessions_n: mine.length,
        screenshots_n: mine.reduce((n, s) => n + s.images.length, 0),
        platform: mine.length ? mine[mine.length - 1].donation.data.platform : null,
        added_later_on: typeof submission?.data.resumedAt === 'string' ? submission.data.resumedAt.slice(0, 10) : null,
        young_link_opened_on: dayOf(submission?.data.youngLinkFirstOpenedAt),
        screen_time_off_on: dayOf(submission?.data.screenTimeOffAt),
        reminders_sent: ((submission?.data.reminders ?? []) as { outcome?: string }[]).filter((r) => r.outcome === 'sent').length,
        opted_out: Boolean(optOutFor(p.data, optOuts)),
      };
    })
    .sort(byLabel);
}

/** A date (YYYY-MM-DD) from a stored time, as an ISO string or a Firestore timestamp. */
function dayOf(value: unknown): string | null {
  if (typeof value === 'string' && value) return value.slice(0, 10);
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
  return null;
}

/** The columns of participants.tsv, in order. */
export const PARTICIPANT_COLUMNS = ['participant_id', 'age', 'year_group', 'site', 'route', 'consented_on', 'consent_version', 'self_consent', 'phone_source', 'assent_status', 'questions_status', 'more_questions_status', 'no_phone_questions_status', 'sessions_n', 'screenshots_n', 'platform', 'added_later_on', 'young_link_opened_on', 'screen_time_off_on', 'reminders_sent', 'opted_out'];

export function phenotypeTable(snap: Snapshot, form: ServedQuestionForm = parentQuestionsForm): Row[] {
  const ids = form.questions.map((q) => q.id);
  return Array.from(latestSurveys(snap, form.id).entries())
    .filter(([pid]) => snap.labels.has(pid))
    .map(([pid, s]) => ({
      participant_id: snap.labels.get(pid),
      ...Object.fromEntries(ids.map((q) => [snake(q), (s.data.responses as Record<string, DocumentData> | undefined)?.[q]?.value ?? ''])),
      status: s.data.status,
      form_version: s.data.formVersion,
      completed_at: s.data.completedAt,
    }))
    .sort(byLabel);
}

export function sessionsTable(sessions: Session[]): Row[] {
  return sessions.map((s) => ({
    session_id: s.session,
    acq_time: s.donation.data.receivedAt,
    platform: s.donation.data.platform,
    screenshots_n: s.images.length,
    young_person_agreed_in_app: s.donation.data.youngPersonAgreedInApp,
    assent_status_at_send: s.donation.data.assentStatusAtSend,
    needs_review: s.donation.data.needsReview,
    added_later: Boolean(s.donation.data.late),
    // Saved by the page when the screenshots were left on it; true when Send was pressed (always, before 15 October 2026).
    send_pressed: s.donation.data.sendPressed !== false,
    // Screenshots sent with this send that the checks refused, recorded from 16 October 2026 (identifying/rejected_uploads.tsv says why).
    rejected_n: rejectedOf(s.donation.data).length,
  }));
}

/** The columns of each sub-<label>_sessions.tsv, in order. */
export const SESSION_COLUMNS = ['session_id', 'acq_time', 'platform', 'screenshots_n', 'young_person_agreed_in_app', 'assent_status_at_send', 'needs_review', 'added_later', 'send_pressed', 'rejected_n'];

/** A refused upload, as submitDonation and submitLabDonation record it (16 October 2026): never the image, only why. */
export interface RejectedRecord {
  uploadId: string;
  reason: string;
  reasons?: string[];
  at: string;
  kind?: string;
  phase?: string;
}
export const rejectedOf = (d: DocumentData | undefined): RejectedRecord[] => (Array.isArray(d?.rejected) ? (d!.rejected as RejectedRecord[]) : []);

export const REJECTED_COLUMNS = ['participant_id', 'reference_code', 'donation_id', 'session_id', 'upload_id', 'rejected_at', 'reason', 'reasons'];

/**
 * Every screenshot the server refused, with why: from a send that kept
 * others (on its donation record, and so its session) or one that kept none
 * (on the family's submission). Recorded from 16 October 2026.
 */
export function rejectedUploadsTable(snap: Snapshot, sessions: Session[] = sessionsOf(snap)): Row[] {
  const sessionOf = new Map(sessions.map((s) => [s.donation.id, s.session]));
  const codeOf = new Map(snap.submissions.map((s) => [String(s.data.participantId), s.id]));
  const rows: Row[] = [];
  for (const d of snap.donations)
    for (const r of rejectedOf(d.data)) rows.push({ participant_id: snap.labels.get(String(d.data.participantId)) ?? null, reference_code: codeOf.get(String(d.data.participantId)) ?? null, donation_id: d.id, session_id: sessionOf.get(d.id) ?? null, upload_id: r.uploadId, rejected_at: r.at, reason: r.reason, reasons: r.reasons ?? [] });
  for (const s of snap.submissions)
    for (const r of rejectedOf(s.data)) rows.push({ participant_id: snap.labels.get(String(s.data.participantId)) ?? null, reference_code: s.id, donation_id: null, session_id: null, upload_id: r.uploadId, rejected_at: r.at, reason: r.reason, reasons: r.reasons ?? [] });
  return rows.sort((a, b) => String(a.rejected_at).localeCompare(String(b.rejected_at)) || String(a.upload_id).localeCompare(String(b.upload_id)));
}

/** The schools' upload passwords: when each was set and whether it works, never the hash or its salt. */
export function schoolUploadAccessTable(docs: Doc[]): Row[] {
  return docs.map(({ id, data: d }) => ({ slug: d.slug ?? id, school_id: d.schoolId ?? null, active: d.active === true, set_at: d.setAt ?? null, revoked_at: d.revokedAt ?? null })).sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
}

export function behTable(s: Session): Row[] {
  return s.images.map((img, i) => ({
    run: two(i + 1),
    filename: screenshotFile(s, i + 1, String(img.path ?? '')),
    width: img.width,
    height: img.height,
    bytes: img.bytes,
    sha256: img.sha256,
    redacted: img.redacted,
    cropped: img.cropped,
    verdict: img.quality?.verdict,
    apps_visible: img.quality?.appsVisible,
    looks_like_screen: img.quality?.looksLikeScreen,
    checked_with_vision: img.quality?.checkedWithVision,
    flatness: typeof img.quality?.flatness === 'number' ? Number(img.quality.flatness.toFixed(3)) : null,
    portrait: img.quality?.portrait,
    acknowledged_warning: img.quality?.acknowledgedWarning,
    terms_found: img.quality?.termsFound,
    reasons: img.quality?.reasons,
    safe_search_adult: img.quality?.safeSearch?.adult,
    safe_search_violence: img.quality?.safeSearch?.violence,
    safe_search_racy: img.quality?.safeSearch?.racy,
  }));
}

/* ── identifying/ tables ───────────────────────────────────────────────── */

export function participantsKey(snap: Snapshot): Row[] {
  const optOuts = optOutsOf(snap.optOuts ?? []);
  return snap.participants
    .map(({ id, data: d }) => ({
      participant_id: snap.labels.get(id) ?? null,
      firestore_id: id,
      reference_code: d.referenceCode,
      kind: d.kind,
      self_consent: Boolean(d.selfConsent),
      phone_source: d.phoneSource ?? null,
      opted_out: Boolean(optOutFor(d, optOuts)),
      opt_out_id: optOutFor(d, optOuts)?.id ?? null,
      first_name: d.firstName,
      last_name: d.lastName,
      date_of_birth: d.dateOfBirth,
      school_id: d.schoolId,
      school_other: d.schoolOther,
      year_group: d.yearGroup,
      guardian_name: d.guardian?.fullName,
      relationship: d.guardian?.relationship,
      relationship_other: d.guardian?.relationshipOther,
      address: d.guardian?.address ?? null,
      // The parent's postcode, or the young person's own when they decided alone.
      postcode: d.guardian?.postcode ?? d.postcode ?? null,
      uprn: d.guardian?.uprn ?? null,
      email: d.guardian?.email,
      phone: d.guardian?.phone,
      version: d.version,
      received_at: d.receivedAt,
      created_at: d.createdAt,
      updated_at: d.updatedAt,
    }))
    .sort((a, b) => String(a.participant_id ?? 'zzz').localeCompare(String(b.participant_id ?? 'zzz')));
}

function statementRows(idName: string, docs: Doc[], labels: Map<string, string>): Row[] {
  return docs.flatMap(({ id, data: d }) =>
    Object.entries((d.responses ?? {}) as Record<string, DocumentData>).map(([statementId, r]) => ({
      [idName]: id,
      participant_id: labels.get(String(d.participantId)) ?? null,
      version: d.version,
      statement_id: statementId,
      statement_version: r.version,
      response: r.response,
      responded_at: r.respondedAt,
      via: r.via,
    })),
  );
}

export function agreementTables(kind: 'consent' | 'assent', docs: Doc[], labels: Map<string, string>): { records: Row[]; statements: Row[] } {
  const idName = `${kind}_id`;
  const records = docs.map(({ id, data: d }) => {
    const label = labels.get(String(d.participantId));
    return {
      [idName]: id,
      participant_id: label ?? null,
      firestore_participant_id: d.participantId,
      reference_code: d.referenceCode,
      version: d.version,
      supersedes: d.supersedes,
      form_id: d.formId,
      form_version: d.formVersion,
      ...(kind === 'consent' ? { information_version: d.informationVersion, route: d.route, typed_name: d.typedName } : { status: d.status, deferred_by: d.deferredBy }),
      signature_method: d.signature?.method,
      signature_typed_name: d.signature?.typedName,
      signature_file: d.signature?.image?.path ? signatureFile(label, String(d.participantId), kind, d.version) : null,
      ...(kind === 'consent' ? { confirmed_date: d.confirmedDate, revised_at: d.revisedAt } : { handover_confirmed_at: d.handoverConfirmedAt, started_at: d.startedAt, quick_agreement_flag: d.quickAgreementFlag }),
      completed_at: d.completedAt,
      received_at: d.receivedAt,
      created_at: d.createdAt,
    };
  });
  return { records, statements: statementRows(idName, docs, labels) };
}

export function submissionsTable(snap: Snapshot): Row[] {
  return snap.submissions.map(({ id, data: d }) => ({
    reference_code: id,
    participant_id: snap.labels.get(String(d.participantId)) ?? null,
    firestore_participant_id: d.participantId,
    kind: d.kind,
    route: d.route,
    version: d.version,
    consent_id: d.consentId,
    assent_id: d.assentId,
    survey_id: d.surveyId,
    image_count: d.imageCount ?? 0,
    donation_count: Array.isArray(d.donationIds) ? d.donationIds.length : 0,
    platform: d.platform,
    last_donation_at: d.lastDonationAt,
    added_later_at: d.resumedAt ?? null,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  }));
}

export function enquiriesTable(docs: Doc[]): Row[] {
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
    year_groups: d.yearGroups,
    can_offer_slots: d.canOfferSlots,
    message: d.message,
    status: d.status,
    notified: d.notified,
    received_at: d.receivedAt,
    created_at: d.createdAt,
  }));
}

/* ── BIDS metadata ─────────────────────────────────────────────────────── */

export function datasetDescription(exportedAt: string): Record<string, unknown> {
  return {
    Name: 'MyPhone/MyBrain',
    BIDSVersion: BIDS_VERSION,
    DatasetType: 'raw',
    License: 'Restricted. Research data about young people; for the named study team only.',
    Authors: ['The MyPhone/MyBrain team, University of Leeds'],
    EthicsApprovals: ['University of Leeds School of Psychology Research Ethics Committee, SoPREC 4202, approved 11 June 2026'],
    GeneratedBy: [{ Name: 'MyPhone/MyBrain consent app export', Version: `${parentQuestionsForm.id} ${parentQuestionsForm.version}`, Description: 'Regenerated every hour from the study database; see the README', CodeURL: CODE_URL }],
    // The day, not the hour: the file then changes once a day, not every run (manifest.json has the exact time).
    SourceDatasets: [{ URL: `firestore://${study.studyId}`, Version: exportedAt.slice(0, 10) }],
  };
}

export function participantsDictionary(): Record<string, unknown> {
  return {
    participant_id: { Description: 'Participant label, assigned in order of consent. The key from labels to names is kept outside this dataset, in identifying/participants_key.tsv.' },
    age: { Description: 'Age in whole years on the date of the record (the parent’s confirmed date, or the young person’s agreement when they decided alone)', Units: 'years' },
    year_group: { Description: 'School year group at consent (England)' },
    site: { Description: 'School identifier from the study’s school list; "other" when the school was typed in (the name is in identifying/)' },
    route: { Description: 'Who started the form', Levels: { parent: 'A parent or carer started it', young: 'The young person started it' } },
    consented_on: { Description: 'Date of the record: the parent or carer’s confirmed date, or, for a young person of 16 or over deciding alone, the day they agreed' },
    consent_version: { Description: 'Version of the parent’s permission form agreed to; n/a when the young person decided alone' },
    self_consent: { Description: 'Whether the young person (16 or over) decided about sharing their screen time themselves (from 7 October 2026)' },
    phone_source: { Description: 'Where the screen time was to come from (from 7 October 2026)', Levels: { child: 'The young person’s own phone, with their agreement', parent: 'The parent or carer’s phone (Apple Family Sharing or Google Family Link), with the parent’s permission', none: 'Not shared: the parent said no or chose the longer questions instead', 'no-phone': 'Not shared: the young person has no phone of their own (from 9 October 2026)' } },
    assent_status: { Description: 'The young person’s own agreement to share their screen time, in the app', Levels: { completed: 'Signed in the app', deferred: 'Put off: not there, or deciding later', declined: 'Said no to sharing', 'not-started': 'Not asked (the screen time came from the parent’s phone, or was not shared)' } },
    questions_status: { Description: 'The parent or carer’s quick questions (phenotype/parent_perceptions.tsv)', Levels: { completed: 'Answered', 'in-progress': 'Partly answered', skipped: 'Skipped', 'not-started': 'Not reached' } },
    more_questions_status: { Description: 'The parent or carer’s longer questions: until 8 October 2026 asked when the screen time was not shared; since then asked of every parent, unless the young person has no phone of their own (phenotype/parent_phone_use.tsv)', Levels: { completed: 'Answered', 'in-progress': 'Partly answered', skipped: 'Skipped', 'not-asked': 'Not asked' } },
    no_phone_questions_status: { Description: 'The parent or carer’s questions about phones and social media, asked instead of the quick and the longer questions when the young person has no phone of their own (from 9 October 2026; phenotype/parent_no_phone.tsv)', Levels: { completed: 'Answered', 'in-progress': 'Partly answered', skipped: 'Skipped', 'not-asked': 'Not asked' } },
    sessions_n: { Description: 'Occasions on which screenshots were sent; each is a session' },
    screenshots_n: { Description: 'Screenshots accepted in total' },
    platform: { Description: 'Phone type reported at the latest send', Levels: { ios: 'iPhone', android: 'Android', other: 'Something else, or not sure' } },
    added_later_on: { Description: 'Date the family last came back with their reference to add the young person’s agreement or screenshots (often after the workshop); n/a when everything came at once. Each screenshot session’s own time is in the sessions files.' },
    young_link_opened_on: { Description: 'Date the young person’s own link was first opened (from 16 October 2026); n/a when it was not made, or not opened' },
    screen_time_off_on: { Description: 'Date the family said the phone was not keeping track of screen time and would turn it on (from 16 October 2026)' },
    reminders_sent: { Description: 'Reminders sent to the parent or carer to finish the screen time, by text or email (from 16 October 2026; at most one after 48 hours, and one a week after screen_time_off_on)' },
    opted_out: { Description: 'Whether a parent or carer has opted the young person out of the workshop and the study by email (identifying/opt_outs.tsv): if true, their data is not to be used, and is withdrawn as far as possible' },
  };
}

/** The data dictionary for the questions when the young person has no phone of their own (phenotype/parent_no_phone.tsv). */
export function noPhoneDictionary(): Record<string, unknown> {
  const out: Record<string, unknown> = {
    MeasurementToolMetadata: { Description: `MyPhone/MyBrain parent questions when the young person has no phone of their own (${parentNoPhoneForm.id} ${parentNoPhoneForm.version}): why not, what they use instead, and what the parent or carer thinks of phones and social media. Asked instead of the quick and the longer questions, from 9 October 2026. Wording is draft until approved by ethics.`, TermURL: CODE_URL },
    participant_id: { Description: 'Participant label; see participants.tsv' },
  };
  for (const q of parentNoPhoneForm.questions) {
    const wording = noPhoneQuestionWording[q.id];
    const entry: Record<string, unknown> = { Description: `${(wording?.text ?? q.id).replace(/\{child\}/g, 'the young person')}${q.type === 'multi' ? ' More than one answer can be given: the values are separated by semicolons.' : ''}` };
    if (q.type !== 'text') entry.Levels = Object.fromEntries(q.options.map((o) => [o, wording?.labels?.[o] ?? o]));
    out[snake(q.id)] = entry;
  }
  out.status = { Description: 'Whether the questions were answered', Levels: { completed: 'All reached and answered or skipped individually', 'in-progress': 'Partly answered', skipped: 'Skipped as a whole' } };
  out.form_version = { Description: 'Version of the questionnaire wording shown' };
  out.completed_at = { Description: 'When the questions were finished (ISO 8601, UTC)' };
  return out;
}

/** The data dictionary for the longer questions (phenotype/parent_phone_use.tsv). */
export function phoneUseDictionary(): Record<string, unknown> {
  const out: Record<string, unknown> = {
    MeasurementToolMetadata: { Description: `MyPhone/MyBrain parent questions on phone use (${parentMoreForm.id} ${parentMoreForm.version}): time and apps, night-time and sleep, and effects, asked of the parent or carer when the young person’s screen time was not shared. Wording is draft until approved by ethics.`, TermURL: CODE_URL },
    participant_id: { Description: 'Participant label; see participants.tsv' },
  };
  for (const q of parentMoreForm.questions) {
    const wording = moreQuestionWording[q.id];
    const entry: Record<string, unknown> = { Description: `${moreQuestionTopics[q.id] ? `${moreQuestionTopics[q.id]}: ` : ''}${(wording?.text ?? q.id).replace(/\{child\}/g, 'the young person')}${q.type === 'multi' ? ' More than one answer can be given: the values are separated by semicolons.' : ''}` };
    if (q.type !== 'text') entry.Levels = Object.fromEntries(q.options.map((o) => [o, wording?.labels?.[o] ?? o]));
    out[snake(q.id)] = entry;
  }
  out.status = { Description: 'Whether the questions were answered', Levels: { completed: 'All reached and answered or skipped individually', 'in-progress': 'Partly answered', skipped: 'Skipped as a whole' } };
  out.form_version = { Description: 'Version of the questionnaire wording shown' };
  out.completed_at = { Description: 'When the questions were finished (ISO 8601, UTC)' };
  return out;
}

export function phenotypeDictionary(): Record<string, unknown> {
  const out: Record<string, unknown> = {
    MeasurementToolMetadata: { Description: `MyPhone/MyBrain parent perceptions (${parentQuestionsForm.id} ${parentQuestionsForm.version}): three one-tap questions and an open text box, asked of the parent or guardian during consent. Wording is draft until approved by ethics.`, TermURL: CODE_URL },
    participant_id: { Description: 'Participant label; see participants.tsv' },
  };
  for (const q of parentQuestionsForm.questions) {
    const wording = questionWording[q.id];
    const entry: Record<string, unknown> = { Description: `${(wording?.text ?? q.id).replace(/\{child\}/g, 'the young person')}${q.type === 'multi' ? ' More than one answer can be given: the values are separated by semicolons.' : ''}` };
    if (q.type !== 'text') entry.Levels = Object.fromEntries(q.options.map((o) => [o, wording?.labels?.[o] ?? o]));
    out[snake(q.id)] = entry;
  }
  out.status = { Description: 'Whether the questions were answered', Levels: { completed: 'All reached and answered or skipped individually', 'in-progress': 'Partly answered', skipped: 'Skipped as a whole' } };
  out.form_version = { Description: 'Version of the questionnaire wording shown' };
  out.completed_at = { Description: 'When the questions were finished (ISO 8601, UTC)' };
  return out;
}

export function behDictionary(): Record<string, unknown> {
  return {
    TaskName: TASK,
    TaskDescription: 'The family shared screenshots of the phone’s screen-time summary showing which apps were used and for how long. The images are under sourcedata/; this table lists them with the automatic checks run when they were received.',
    run: { Description: 'Order of the screenshot within this send' },
    filename: { Description: 'Path of the image, relative to the dataset root' },
    width: { Description: 'Image width', Units: 'pixels' },
    height: { Description: 'Image height', Units: 'pixels' },
    bytes: { Description: 'File size of the stored, metadata-stripped copy', Units: 'bytes' },
    sha256: { Description: 'SHA-256 of the stored copy' },
    redacted: { Description: 'Whether the family hid part of the image before sending' },
    cropped: { Description: 'Whether the family cropped the image before sending' },
    verdict: { Description: 'Automatic quality check', Levels: { accepted: 'Looks like a screen-time page', review: 'Kept, but a person should look' } },
    apps_visible: { Description: 'Whether the text suggests the per-app list with times is in the picture, not just the total' },
    looks_like_screen: { Description: 'Whether the image looks like a phone screenshot rather than a photograph' },
    checked_with_vision: { Description: 'Whether Cloud Vision text and SafeSearch detection ran' },
    flatness: { Description: 'Share of pixels covered by the eight most common colours (1 = flat screenshot)' },
    portrait: { Description: 'Whether the image is taller than it is wide' },
    acknowledged_warning: { Description: 'Whether the family saw the on-device warning and said the image was right' },
    terms_found: { Description: 'Screen-time words found by text detection' },
    reasons: { Description: 'Notes from the checks, for the team' },
    safe_search_adult: { Description: 'Cloud Vision SafeSearch likelihood' },
    safe_search_violence: { Description: 'Cloud Vision SafeSearch likelihood' },
    safe_search_racy: { Description: 'Cloud Vision SafeSearch likelihood' },
  };
}

const BIDS_README = `MyPhone/MyBrain

A study of young people's smartphone use in Bradford and Leeds. This dataset
is regenerated automatically every hour from the study's database and is a
mirror of the current records. Do not edit files here.

participants.tsv          one row per consenting young person: age at consent,
                          year group, site, consent and agreement status,
                          number of screenshot sends and screenshots
phenotype/                the parent or carer's answers about the young
                          person's phone use, latest per participant, each
                          with a data dictionary: parent_perceptions (the quick
                          questions every parent is asked) and parent_phone_use
                          (the longer questions: time and apps, sleep, effects)
                          and parent_no_phone (asked instead, from 9 October
                          2026, when the young person has no phone of their own)
sub-<label>/              one session (ses-01, ses-02, ...) per occasion on
                          which the family sent screenshots; each holds
                          beh/*_task-screentime_beh.tsv listing the images with
                          the automatic quality checks, and a sessions file
sourcedata/               the screenshot images themselves, named by subject,
                          session and run, plus raw JSON Lines dumps of the
                          answers and the sends, labelled by participant_id
                          like the tables (no database ids, no device details)

Each sub-<label>_sessions.tsv says, per send, how many screenshots were
kept and (rejected_n, from 16 October 2026) how many the checks refused;
why each was refused is in identifying/rejected_uploads.tsv.

Participants are labelled in order of consent. The key from labels to names,
dates of birth and contact details, together with the consent records and
signatures, is kept outside this dataset in the identifying/ folder next to
it (schools/identifying/), for study coordinators only. Participants listed in participants.tsv
without a subject folder have not sent any screenshots yet.

Timestamps are ISO 8601 in UTC. Missing values are n/a.
`;

const SOURCEDATA_README = `Screenshot images as received (re-encoded to remove device metadata), named
sub-<label>_ses-<nn>_task-screentime_run-<nn>_screenshot.png or .jpg, and
raw JSON Lines dumps of the research collections (raw/surveys.jsonl, the
parent's answers; raw/donations.jsonl, the sends), one record a line,
labelled participant_id (sub-<label>) as in the tables, without the
database's own ids for people or anything about the device. Each image file
records where it came from in its metadata. See ../README.
`;

const IDENTIFYING_README = `Identifying data for the MyPhone/MyBrain young people's study. Study
coordinators only. Regenerated every hour as a mirror of the database; do not
edit files here.

participants_key.tsv       the key from participant labels (sub-00001...) to
                           names, date of birth, school, parent or carer and
                           contact details (with the address's UPRN when it was
                           picked with the address finder), whether the young
                           person decided alone (16 or over), and whether they
                           are opted out
consents.tsv               every parent permission record; an amendment is a
                           new row and supersedes points at the one before
consent_statements.tsv     one row per statement per permission record
assents.tsv                every young person's agreement record
assent_statements.tsv      one row per statement per agreement record
submissions.tsv            one row per family: reference code, current record
                           ids, image counts
rejected_uploads.tsv       every screenshot the checks refused (from 16 October
                           2026), with the reason the family was shown and the
                           checks' own notes; never the image, which is not kept
school_upload_access.tsv   each school's upload page: whether its password
                           works, when it was set and when it was stopped (the
                           password itself is never exported)
enquiries.tsv              messages from the website's contact and school forms
opt_outs.tsv               every opt-out from the workshop a parent or carer
                           emailed, as the team logged it on the staff page,
                           with the website record and the UPN it names, if any.
                           Opted out means no workshop and no data at all
                           (including linking); after the workshop, the data
                           is withdrawn as far as possible
signatures/                drawn signatures, named by participant label and record
raw/                       every document as JSON Lines, without the
                           sign-in ids and key hashes the website uses to let
                           a device add to a record; unlabelled_surveys.jsonl
                           holds answers from families without a label (they
                           are not in the research dataset)

Files are tab-separated UTF-8 with n/a for missing values; timestamps are
ISO 8601 in UTC. The research data, labelled by participant only, is in the
donations/ folder next to this one. The social media break study (adults) has
its own folder, social-media-break/, with the same layout.
`;

const SCHOOLS_README = `# MyPhone/MyBrain: the young people's study

What families in Bradford and Leeds schools gave online: since 7 October
2026, the opt-in for screen time (parents of under-16s, and young people
of 16 or over for themselves), the parents' answers about phone use, and the
screen-time screenshots; and the opt-outs from the workshop parents emailed,
as the team logged them. Regenerated automatically every hour; do not edit
or add files here.

donations/     written by the website every hour: the research dataset in
               BIDS layout, labelled sub-00001, sub-00002... in order of
               consent, no names; for researchers
identifying/   written by the website every hour: names, dates of birth,
               contact details, consent and agreement records, signatures,
               website enquiries, and the key from labels to people; for
               study coordinators only
upn-uploads/   written by the website every hour: the UPN lists schools sent
               through their upload page, each file as sent, what was read
               from it, and the match between UPNs and the families' records;
               for study coordinators only

The three folders above are mirrors: anything added inside them is removed on
the next run. Keep the team's own datasets (for example the workshop EEG
recordings) beside them in this folder, never inside them.
`;

const ROOT_README = `# MyPhone/MyBrain data export

Written automatically every hour from the programme's Firebase project, as a
mirror of the current records: tables are rewritten each run, new files are
added, and anything deleted from a study (for example after a withdrawal)
disappears from here too. Do not edit or add files in this folder.

One folder per study, each with the same two subfolders:

schools/              the young people's study (parents' consent, young
                      people's agreement, the parents' questions, screen-time
                      screenshots), labelled sub-00001... in order of consent;
                      also upn-uploads/, the UPN lists schools send, matched
                      to the families' records (study coordinators only)
social-media-break/   the adult laboratory study: cleaned TikTok, YouTube and
                      Instagram archives and screen-time screenshots donated
                      by participants, the mid-break check-ins, and MyStory
                      (donations/phenotype/mystory_<phase>.tsv, stories
                      written on the form; mystory_chat_<phase>.tsv,
                      conversations with the AI interviewer, in full in
                      donations/sourcedata/raw/labStoryChats.jsonl),
                      labelled by their participant ID; the recordings of
                      answers spoken in that chat identify a voice, so they
                      are in identifying/mystory_voice/
website-usage/        how the website is used: anonymous page-view counts,
                      a daily table and every view by month; nothing that
                      identifies anyone, and deleted after five years as the
                      privacy page promises

  <study>/donations/     what participants gave through the website, as a
                         research dataset in BIDS layout, no names; for
                         researchers
  <study>/identifying/   names, contact details, consent records,
                         signatures and voice recordings; for study
                         coordinators only

The folders the export writes are mirrors: anything added inside them is
removed on the next run. Each team's other datasets (laboratory visits,
workshop recordings, tracking) belong beside donations/ in the study's
folder, never inside it. The Mac mirror copies each written folder on its
own, so such sibling folders are left alone.

manifest.json says when the last export ran, how many of each thing it
holds, and whether anything is still to come: status is "complete" when
every file is in place; binaryBacklog counts images, archives, signatures
and recordings still to be copied (at most 500 are copied each hour, so a
large backlog clears over a few hours), and copyFailures, unpackFailures and
writeFailures list anything that could not be done, with why. Files that
have not changed are not rewritten.
`;

export interface OutFile {
  path: string;
  body: string;
  contentType: string;
  /** Custom metadata to store with it: the stamp of the archive a table was built from (exportWrite.ts). */
  metadata?: Record<string, string>;
}

export const tsvFile = (path: string, rows: Row[], columns?: string[]): OutFile => ({ path, body: toTsv(rows, columns), contentType: 'text/tab-separated-values; charset=utf-8' });
export const jsonFile = (path: string, value: unknown): OutFile => ({ path, body: `${JSON.stringify(value, null, 2)}\n`, contentType: 'application/json' });
export const textFile = (path: string, body: string, contentType = 'text/plain; charset=utf-8'): OutFile => ({ path, body, contentType });
export const jsonlFile = (path: string, docs: Doc[]): OutFile => ({ path, body: toJsonl(docs), contentType: 'application/x-ndjson' });

/** Consenting participants without a study number get the next one, once, in order of arrival. */
async function assignLabels(db: Firestore, participants: Doc[]): Promise<Map<string, string>> {
  const missing = participants.filter((p) => p.data.kind === 'consent' && typeof p.data.studyNumber !== 'number').sort((a, b) => String(a.data.createdAt ?? '').localeCompare(String(b.data.createdAt ?? '')));
  for (const p of missing) {
    const number = await db.runTransaction(async (tx) => {
      const counterRef = db.collection('meta').doc('counters');
      const participantRef = db.collection('participants').doc(p.id);
      const [counter, current] = await Promise.all([tx.get(counterRef), tx.get(participantRef)]);
      const existing = current.data()?.studyNumber;
      if (typeof existing === 'number') return existing;
      const next = Number(counter.data()?.participants ?? 0) + 1;
      tx.set(counterRef, { participants: next }, { merge: true });
      tx.update(participantRef, { studyNumber: next });
      return next;
    });
    p.data.studyNumber = number;
  }
  const labels = new Map<string, string>();
  for (const p of participants) if (p.data.kind === 'consent' && typeof p.data.studyNumber === 'number') labels.set(p.id, subjectLabel(p.data.studyNumber));
  return labels;
}

async function ensureBucket(name: string): Promise<void> {
  if (process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR === 'true') return;
  const bucket = getStorage().bucket(name);
  const [exists] = await bucket.exists();
  if (exists) return;
  await bucket.create({ location: REGION, storageClass: 'STANDARD', iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'enforced' } } as object);
  logger.info('Export bucket created', { bucket: name });
}

/** The collections the export reads. Never ratelimits, meta (counters), or anything holding a password hash, salt or the staff key: schoolUploadAccess is read for its audit fields only (schoolUploadAccessTable). */
export const COLLECTIONS = ['participants', 'consents', 'assents', 'submissions', 'enquiries', 'surveys', 'donations', 'labParticipants', 'labConsents', 'labDonations', 'labReminders', 'labCheckIns', 'labStories', 'labBookings', 'labContacts', 'schoolUploads', 'optOuts', 'labStoryChats', 'labSlots', 'schoolUploadAccess', 'usage'] as const;
export type Collections = Record<(typeof COLLECTIONS)[number], Doc[]>;

/** What the export is made of, from the records alone: the files to write, the files to copy, the tables to build from archives, and the counts. No bucket involved. */
export function buildExport(c: Collections, labels: Map<string, string>, exportedAt: string): { files: OutFile[]; jobs: CopyJob[]; derived: Derivation[]; counts: Record<string, number>; sessions: Session[] } {
  const snap: Snapshot = { participants: c.participants, consents: c.consents, assents: c.assents, submissions: c.submissions, enquiries: c.enquiries, surveys: c.surveys, donations: c.donations, optOuts: c.optOuts, labels };
  const sessions = sessionsOf(snap);
  const lab = labExport({ participants: c.labParticipants, consents: c.labConsents, donations: c.labDonations, reminders: c.labReminders, checkIns: c.labCheckIns, stories: c.labStories, storyChats: c.labStoryChats, bookings: c.labBookings, contacts: c.labContacts, slots: c.labSlots }, exportedAt);
  const upn = upnExport(c.schoolUploads, c.participants, labels, c.optOuts);
  const usage = usageExport(c.usage);

  const tsv = tsvFile;
  const json = jsonFile;
  const text = textFile;
  const jsonl = jsonlFile;
  // The research dataset's raw files carry the sub- label, not the database's ids (16 October 2026); answers from families without a label go to identifying/ only.
  const unlabelledSurveys = c.surveys.filter((s) => !labels.has(String(s.data.participantId)));

  const files: OutFile[] = [
    text('README.md', ROOT_README, 'text/markdown; charset=utf-8'),
    text(`${SCHOOLS}/README.md`, SCHOOLS_README, 'text/markdown; charset=utf-8'),
    json(`${B}/dataset_description.json`, datasetDescription(exportedAt)),
    text(`${B}/README`, BIDS_README),
    text(`${B}/CHANGES`, `1.0.0 ${exportedAt.slice(0, 10)}\n  - Regenerated automatically every hour; see ../../manifest.json.\n`),
    tsv(`${B}/participants.tsv`, participantsTable(snap), PARTICIPANT_COLUMNS),
    json(`${B}/participants.json`, participantsDictionary()),
    tsv(`${B}/phenotype/parent_perceptions.tsv`, phenotypeTable(snap), ['participant_id', ...parentQuestionsForm.questions.map((q) => snake(q.id)), 'status', 'form_version', 'completed_at']),
    json(`${B}/phenotype/parent_perceptions.json`, phenotypeDictionary()),
    tsv(`${B}/phenotype/parent_phone_use.tsv`, phenotypeTable(snap, parentMoreForm), ['participant_id', ...parentMoreForm.questions.map((q) => snake(q.id)), 'status', 'form_version', 'completed_at']),
    json(`${B}/phenotype/parent_phone_use.json`, phoneUseDictionary()),
    tsv(`${B}/phenotype/parent_no_phone.tsv`, phenotypeTable(snap, parentNoPhoneForm), ['participant_id', ...parentNoPhoneForm.questions.map((q) => snake(q.id)), 'status', 'form_version', 'completed_at']),
    json(`${B}/phenotype/parent_no_phone.json`, noPhoneDictionary()),
    text(`${B}/sourcedata/README.md`, SOURCEDATA_README, 'text/markdown; charset=utf-8'),
    jsonl(`${B}/sourcedata/raw/surveys.jsonl`, researchDocs(c.surveys, labels)),
    jsonl(`${B}/sourcedata/raw/donations.jsonl`, researchDocs(c.donations, labels)),
    text(`${I}/README.md`, IDENTIFYING_README, 'text/markdown; charset=utf-8'),
    tsv(`${I}/participants_key.tsv`, participantsKey(snap)),
    tsv(`${I}/submissions.tsv`, submissionsTable(snap)),
    tsv(`${I}/enquiries.tsv`, enquiriesTable(c.enquiries)),
    tsv(`${I}/rejected_uploads.tsv`, rejectedUploadsTable(snap, sessions), REJECTED_COLUMNS),
    tsv(`${I}/school_upload_access.tsv`, schoolUploadAccessTable(c.schoolUploadAccess), ['slug', 'school_id', 'active', 'set_at', 'revoked_at']),
    tsv(`${I}/opt_outs.tsv`, upn.optOutTable, ['opt_out_id', 'status', 'received_on', 'after_workshop', 'school_id', 'first_name', 'last_name', 'date_of_birth', 'year_group', 'class', 'parent_name', 'notes', 'recorded_at', 'website_participant_id', 'website_firestore_id', 'upn', 'upn_match']),
    jsonl(`${I}/raw/opt_outs.jsonl`, c.optOuts),
    jsonl(`${I}/raw/participants.jsonl`, c.participants),
    jsonl(`${I}/raw/consents.jsonl`, c.consents),
    jsonl(`${I}/raw/assents.jsonl`, c.assents),
    jsonl(`${I}/raw/submissions.jsonl`, c.submissions),
    jsonl(`${I}/raw/enquiries.jsonl`, c.enquiries),
    jsonl(`${I}/raw/unlabelled_surveys.jsonl`, unlabelledSurveys),
  ];
  for (const kind of ['consent', 'assent'] as const) {
    const { records, statements } = agreementTables(kind, kind === 'consent' ? c.consents : c.assents, labels);
    files.push(tsv(`${I}/${kind}s.tsv`, records), tsv(`${I}/${kind}_statements.tsv`, statements));
  }
  const bySubject = new Map<string, Session[]>();
  for (const s of sessions) {
    if (!bySubject.has(s.label)) bySubject.set(s.label, []);
    bySubject.get(s.label)!.push(s);
  }
  const behColumns = Object.keys(behDictionary()).filter((k) => !['TaskName', 'TaskDescription'].includes(k));
  for (const [label, mine] of bySubject) {
    files.push(tsv(`${B}/${label}/${label}_sessions.tsv`, sessionsTable(mine), SESSION_COLUMNS));
    for (const s of mine) {
      const base = `${B}/${label}/${s.session}/beh/${label}_${s.session}_task-${TASK}_beh`;
      files.push(tsv(`${base}.tsv`, behTable(s), behColumns), json(`${base}.json`, behDictionary()));
    }
  }
  files.push(...lab.files, ...upn.files, ...usage.files);

  // Binary files: copied bucket to bucket, each stamped with its source (exportWrite.ts), deleted when their record goes.
  const jobs: CopyJob[] = [];
  const hashes = new Map<string, string>([...lab.hashes, ...upn.hashes]);
  for (const [from, to] of [...lab.copies, ...upn.copies]) jobs.push({ source: from, target: to, sha256: hashes.get(from) ?? null });
  for (const s of sessions) s.images.forEach((img, i) => typeof img.path === 'string' && jobs.push({ source: img.path, target: `${B}/${screenshotFile(s, i + 1, img.path)}`, sha256: typeof img.sha256 === 'string' ? img.sha256 : null }));
  for (const kind of ['consent', 'assent'] as const) {
    for (const d of kind === 'consent' ? c.consents : c.assents) {
      const image = d.data.signature?.image;
      if (typeof image?.path === 'string') jobs.push({ source: image.path, target: `${I}/${signatureFile(labels.get(String(d.data.participantId)), String(d.data.participantId), kind, d.data.version)}`, sha256: typeof image.sha256 === 'string' ? image.sha256 : null });
    }
  }

  const counts = {
    participants: labels.size,
    declined: c.participants.length - labels.size,
    consents: c.consents.length,
    assents: c.assents.length,
    submissions: c.submissions.length,
    enquiries: c.enquiries.length,
    surveys: c.surveys.length,
    sessions: sessions.length,
    screenshots: sessions.reduce((n, s) => n + s.images.length, 0),
    screenshotsRejected: rejectedUploadsTable(snap, sessions).length,
    signatures: jobs.filter((j) => j.target.startsWith(`${I}/signatures/`)).length,
    ...lab.counts,
    ...upn.counts,
    ...usage.counts,
  };
  return { files, jobs, derived: lab.derived, counts, sessions };
}

/** What a listing says of an object. */
function objectInfo(f: { name: string; metadata: { md5Hash?: string; contentType?: string; metadata?: Record<string, unknown> } }): ObjectInfo {
  const custom = f.metadata.metadata ?? {};
  return { name: f.name, md5Hash: f.metadata.md5Hash, contentType: f.metadata.contentType, metadata: Object.fromEntries(Object.entries(custom).map(([k, v]) => [k, String(v ?? '')])) };
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

/** Runs a task over items a batch at a time; one failing never stops the others. Returns how many it started (it stops starting batches once the deadline passes). */
async function settle<T>(items: T[], task: (item: T) => Promise<unknown>, failed: (item: T, error: unknown) => void, deadline = Infinity, size = BATCH): Promise<number> {
  let started = 0;
  for (let i = 0; i < items.length && Date.now() < deadline; i += size) {
    const batch = items.slice(i, i + size);
    started += batch.length;
    const results = await Promise.allSettled(batch.map(task));
    results.forEach((r, j) => r.status === 'rejected' && failed(batch[j], r.reason));
  }
  return started;
}

/** How long a run may spend copying and unpacking before it writes its manifest and stops: the function has 540 seconds. */
const BUDGET_MS = 400_000;

/** Builds the whole export and makes the bucket match it: tables first, then the clean-up, then the copies, each part independent of the others. Returns the manifest. */
export async function runExport(): Promise<Manifest> {
  const deadline = Date.now() + BUDGET_MS;
  const db = getFirestore();
  const source = getStorage().bucket();
  const bucketName = exportBucketName();
  await ensureBucket(bucketName);
  const dest = getStorage().bucket(bucketName);
  const now = new Date();
  const exportedAt = now.toISOString();

  const load = async (name: string): Promise<Doc[]> => (await db.collection(name).get()).docs.map((d) => ({ id: d.id, data: plain(d.data()) as DocumentData }));
  const loaded = await Promise.all(COLLECTIONS.map(load));
  const c = Object.fromEntries(COLLECTIONS.map((name, i) => [name, loaded[i]])) as Collections;
  const labels = await assignLabels(db, c.participants);
  const { files, jobs, derived, counts } = buildExport(c, labels, exportedAt);

  // What is there already, what the last run left undone, and what the study's storage holds (listed, not fetched one by one).
  const [existingFiles] = await dest.getFiles();
  const existing = new Map(existingFiles.map((f) => [f.name, objectInfo(f)]));
  let previous: Partial<Manifest> = {};
  if (existing.has('manifest.json')) {
    try {
      previous = JSON.parse((await dest.file('manifest.json').download())[0].toString('utf8')) as Partial<Manifest>;
    } catch (error) {
      logger.warn('Export: the last manifest could not be read', { error: errorText(error) });
    }
  }
  const sources = new Map<string, ObjectInfo>();
  for (const prefix of new Set([...jobs.map((j) => j.source), ...derived.map((d) => d.source)].map((p) => `${p.split('/')[0]}/`))) {
    const [listed] = await source.getFiles({ prefix });
    for (const f of listed) sources.set(f.name, objectInfo(f));
  }

  // 1. Tables and text: written only when they changed.
  const writeFailures: Manifest['writeFailures'] = [];
  let written = 0;
  const save = (f: OutFile) => dest.file(f.path).save(f.body, { contentType: f.contentType, resumable: false, metadata: { cacheControl: 'private, max-age=0', ...(f.metadata ? { metadata: f.metadata } : {}) } });
  const changed = files.filter((f) => needsWrite(existing.get(f.path), f));
  await settle(
    changed,
    async (f) => {
      await save(f);
      written += 1;
    },
    (f, error) => writeFailures.push({ file: f.path, error: errorText(error) }),
  );

  // 2. Clean-up: anything that no longer belongs. Every file a record still points at is expected, copied or not, so a copy that fails is never deleted here.
  const expected = new Set<string>([...files.map((f) => f.path), ...jobs.map((j) => j.target), ...derived.flatMap((d) => d.paths), 'manifest.json']);
  const stale = staleObjects(existingFiles.map((f) => objectInfo(f)), expected);
  let removed = 0;
  await settle(
    stale,
    async (f) => {
      await dest.file(f.name).delete({ ignoreNotFound: true });
      removed += 1;
    },
    (f, error) => logger.warn('Export: a stale file could not be deleted', { path: f.name, error: errorText(error) }),
  );

  // What needs copying or building, and a first manifest saying so, so the tables' state is on record even if the copies run out of time.
  const plan = planCopies(jobs, existing, sources);
  const toBuild = derived.flatMap((d) => {
    const stamp = stampFor(d.source, d.sha256, sources.get(d.source));
    if (!stamp) return [];
    const states = d.paths.map((p) => copyState(existing.get(p), stamp));
    return states.every((s) => s === 'up-to-date') ? [] : [{ d, stamp, otherSource: d.paths.filter((p, i) => states[i] === 'other-source') }];
  });
  // An archive missing from storage is reported once, by its own copy.
  const copyFailures: Manifest['copyFailures'] = plan.missingSource.map((j) => ({ file: j.target, error: 'not found in the study’s storage: the record points at a file that is not there' }));
  const manifestOf = (status: Manifest['status'], extra: { binaryBacklog: number; unpackFailures: UnpackFailure[]; copied: number; built: number }): Manifest => ({
    exportedAt,
    bucket: bucketName,
    status,
    counts: { ...counts, filesWrittenThisRun: written, filesUnchanged: files.length - changed.length, filesRemovedThisRun: removed, filesCopiedThisRun: extra.copied, archivesUnpackedThisRun: extra.built, filesMissing: copyFailures.filter((f) => f.error.startsWith('not found')).length },
    binaryBacklog: extra.binaryBacklog,
    copyFailures,
    unpackFailures: extra.unpackFailures,
    writeFailures,
    files: Array.from(expected).sort(),
  });
  const writeManifest = async (m: Manifest) => {
    try {
      await save(jsonFile('manifest.json', m));
    } catch (error) {
      logger.error('Export: manifest.json could not be written', { error: errorText(error) });
    }
  };
  const earlierFailures = Array.isArray(previous.unpackFailures) ? previous.unpackFailures : [];
  await writeManifest(manifestOf('copying', { binaryBacklog: plan.toCopy.length + toBuild.length, unpackFailures: earlierFailures, copied: 0, built: 0 }));

  // 3. Archive tables: built when any is missing or from another archive; an archive that failed is tried again a day later.
  const unpackFailures: UnpackFailure[] = [];
  let built = 0;
  let unpackBacklog = 0;
  let attempts = 0;
  for (const { d, stamp, otherSource } of toBuild) {
    const due = unpackDue(earlierFailures, d.archive, d.sha256, now);
    if (!due || attempts >= UNPACK_LIMIT || Date.now() >= deadline) {
      if (!due) unpackFailures.push(earlierFailures.find((f) => (d.sha256 ? f.sha256 === d.sha256 : f.archive === d.archive))!);
      else unpackBacklog += 1;
      // Tables known to be from another archive are not left in place under this one's name.
      await Promise.allSettled(otherSource.map((p) => dest.file(p).delete({ ignoreNotFound: true })));
      continue;
    }
    attempts += 1;
    try {
      const [buffer] = await source.file(d.source).download();
      const out = (await d.build(buffer)).map((f) => ({ ...f, metadata: stamp }));
      const results = await Promise.allSettled(out.map(save));
      const failed = results.findIndex((r) => r.status === 'rejected');
      if (failed >= 0) throw (results[failed] as PromiseRejectedResult).reason;
      built += 1;
    } catch (error) {
      unpackFailures.push({ archive: d.archive, sha256: d.sha256 ?? null, error: errorText(error), at: exportedAt });
      logger.warn('Export: archive could not be unpacked into tables', { archive: d.archive, error: errorText(error) });
      await Promise.allSettled(otherSource.map((p) => dest.file(p).delete({ ignoreNotFound: true })));
    }
  }

  // 4. Binary files: at most COPY_LIMIT a run, server side, the most needed first; the rest wait for the next run.
  const batch = plan.toCopy.slice(0, COPY_LIMIT);
  let copied = 0;
  const startedCopies = await settle(
    batch,
    async (job) => {
      await source.file(job.source).copy(dest.file(job.target), { contentType: job.contentType, cacheControl: 'private, max-age=0', metadata: job.stamp });
      copied += 1;
    },
    (job, error) => {
      copyFailures.push({ file: job.target, error: errorText(error) });
      logger.warn('Export: file could not be copied', { target: job.target, error: errorText(error) });
      // A name known to hold another file must not keep it: removed, and copied again next run.
      if (job.state === 'other-source') void dest.file(job.target).delete({ ignoreNotFound: true }).catch(() => undefined);
    },
    deadline,
    BATCH * 2,
  );
  // Known to hold another file, but not reached this run: removed too, so no name holds the wrong file while it waits.
  const notReached = plan.toCopy.slice(startedCopies);
  await Promise.allSettled(notReached.filter((j) => j.state === 'other-source').map((j) => dest.file(j.target).delete({ ignoreNotFound: true })));

  const binaryBacklog = notReached.length + unpackBacklog;
  const failures = copyFailures.length + unpackFailures.length + writeFailures.length;
  const manifest = manifestOf(binaryBacklog || failures ? 'incomplete' : 'complete', { binaryBacklog, unpackFailures, copied, built });
  await writeManifest(manifest);
  logger.info('Export written', { ...manifest.counts, status: manifest.status, binaryBacklog, copyFailures: copyFailures.length, unpackFailures: unpackFailures.length, writeFailures: writeFailures.length });
  return manifest;
}

/** Every hour, five minutes past. 2GiB: an archive is unpacked in memory to build its tables. */
export const exportData = onSchedule({ region: REGION, schedule: '5 * * * *', timeZone: 'Europe/London', memory: '2GiB', timeoutSeconds: 540, retryCount: 1 }, async () => {
  await runExport();
});

/** Emulator only: lets the end-to-end test run the export on demand. Not deployed. */
export const exportNow =
  process.env.FUNCTIONS_EMULATOR === 'true'
    ? onRequest({ region: REGION, memory: '2GiB', timeoutSeconds: 540 }, async (_req, res) => {
        res.json(await runExport());
      })
    : undefined;
