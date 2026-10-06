import type { DocumentData } from 'firebase-admin/firestore';
import { jsonFile, jsonlFile, textFile, tsvFile, type Doc, type OutFile, type Row } from './export.js';
import { cleaner, labConsentForm, labStudy } from './forms.js';

/**
 * The social media break study's part of the hourly export: its own folder,
 * social-media-break/, with a BIDS dataset labelled by participant code
 * (already a pseudonym: the lab questionnaire builds the same code, so the
 * EEG data and this donated data meet without a name) and its own
 * identifying/ folder for the consent records, names and signatures.
 *
 *   social-media-break/bids/participants.tsv              one row per consenting code
 *   social-media-break/bids/sub-<CODE>/sub-<CODE>_sessions.tsv   one session per send
 *   social-media-break/bids/sub-<CODE>/ses-NN/beh/*_task-donation_beh.tsv
 *                                               the files in that send, with what the
 *                                               cleaner's manifest says is inside, or
 *                                               the screenshot checks
 *   social-media-break/bids/sourcedata/sub-<CODE>/ses-NN/   the archives and screenshots
 *   social-media-break/identifying/consents.tsv, consent_statements.tsv, signatures/
 */

const BIDS_VERSION = '1.10.0';
const TASK = 'donation';
/** The study's folder in the export bucket, and its two subfolders. */
export const LAB_ROOT = 'social-media-break';
const B = `${LAB_ROOT}/bids`;
const I = `${LAB_ROOT}/identifying`;
const CODE_URL = 'https://github.com/faisalmushtaq/myphone-mybrain';
const two = (n: number) => String(n).padStart(2, '0');

export interface LabSnapshot {
  participants: Doc[];
  consents: Doc[];
  donations: Doc[];
}

export interface LabSession {
  code: string;
  label: string;
  session: string;
  donation: Doc;
  files: DocumentData[];
}

/** sub-JA101CD: the participant code is the BIDS label. */
export const labLabel = (code: string) => `sub-${code}`;

/** Each send is a BIDS session, numbered in time order per participant. */
export function labSessionsOf(snap: LabSnapshot): LabSession[] {
  const byCode = new Map<string, Doc[]>();
  for (const d of snap.donations) {
    const code = String(d.data.participantCode);
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code)!.push(d);
  }
  const out: LabSession[] = [];
  for (const [code, docs] of byCode) {
    docs.sort((a, b) => String(a.data.receivedAt ?? '').localeCompare(String(b.data.receivedAt ?? '')));
    docs.forEach((donation, i) => out.push({ code, label: labLabel(code), session: `ses-${two(i + 1)}`, donation, files: (donation.data.files ?? []) as DocumentData[] }));
  }
  return out.sort((a, b) => `${a.label}/${a.session}`.localeCompare(`${b.label}/${b.session}`));
}

/** Where a donated file lives inside the dataset, relative to the dataset root. */
export function labFile(s: LabSession, run: number, file: DocumentData): string {
  const kind = file.kind === 'archive' ? 'archive' : 'screenshot';
  const ext = kind === 'archive' ? 'zip' : /\.jpe?g$/i.test(String(file.path ?? '')) ? 'jpg' : 'png';
  return `sourcedata/${s.label}/${s.session}/${s.label}_${s.session}_run-${two(run)}_${kind}.${ext}`;
}

/** Where a signature image lives, relative to the study's identifying/ folder. */
export function labSignatureFile(code: string, version: unknown): string {
  const label = labLabel(code);
  return `signatures/${label}/${label}_consent-v${String(version ?? 1)}_signature.png`;
}

const byLabel = (a: Row, b: Row) => String(a.participant_id).localeCompare(String(b.participant_id));

export function labParticipantsTable(snap: LabSnapshot): Row[] {
  const sessions = labSessionsOf(snap);
  const consentBy = new Map(snap.consents.map((c) => [c.id, c]));
  return snap.participants
    .filter((p) => p.data.consentId)
    .map(({ id, data: d }) => {
      const consent = consentBy.get(String(d.consentId));
      const mine = sessions.filter((s) => s.code === id);
      const files = mine.flatMap((s) => s.files);
      return {
        participant_id: labLabel(id),
        consented_on: consent?.data.confirmedDate,
        consent_version: consent?.data.formVersion,
        information_version: consent?.data.informationVersion,
        consent_n: d.consentVersion,
        sessions_n: mine.length,
        archives_n: files.filter((f) => f.kind === 'archive').length,
        screenshots_n: files.filter((f) => f.kind === 'screenshot').length,
        platforms: Array.from(new Set(files.flatMap((f) => (Array.isArray(f.platforms) ? (f.platforms as string[]) : [])))).sort(),
        phone: d.phone ?? mine[mine.length - 1]?.donation.data.phone,
        first_donation_at: mine[0]?.donation.data.receivedAt,
        last_donation_at: mine[mine.length - 1]?.donation.data.receivedAt,
      };
    })
    .sort(byLabel);
}

export function labSessionsTable(sessions: LabSession[]): Row[] {
  return sessions.map((s) => ({
    session_id: s.session,
    acq_time: s.donation.data.receivedAt,
    archives_n: s.files.filter((f) => f.kind === 'archive').length,
    screenshots_n: s.files.filter((f) => f.kind === 'screenshot').length,
    phone: s.donation.data.phone,
    needs_review: s.donation.data.needsReview,
  }));
}

export function labBehTable(s: LabSession): Row[] {
  return s.files.map((f, i) => ({
    run: two(i + 1),
    kind: f.kind,
    filename: labFile(s, i + 1, f),
    bytes: f.bytes,
    sha256: f.sha256,
    platforms: f.platforms,
    categories: f.categories,
    ...Object.fromEntries(cleaner.categoryIds.map((id) => [`kept_${id}`, (f.kept as Record<string, number> | null | undefined)?.[id] ?? null])),
    cleaner: f.manifest?.cleaner,
    cleaned_at: f.manifest?.cleanedAt,
    entries: f.entries,
    unpacked_bytes: f.unpackedBytes,
    width: f.width,
    height: f.height,
    verdict: f.quality?.verdict,
    looks_like_screen: f.quality?.looksLikeScreen,
    apps_visible: f.quality?.appsVisible,
    checked_with_vision: f.quality?.checkedWithVision,
    terms_found: f.quality?.termsFound,
    reasons: f.quality?.reasons,
  }));
}

export function labConsentTables(docs: Doc[]): { records: Row[]; statements: Row[] } {
  const records = docs.map(({ id, data: d }) => ({
    consent_id: id,
    participant_id: labLabel(String(d.participantCode)),
    participant_code: d.participantCode,
    version: d.version,
    supersedes: d.supersedes,
    form_id: d.formId,
    form_version: d.formVersion,
    information_version: d.informationVersion,
    typed_name: d.typedName,
    mother_first_name: d.codeParts?.mother,
    house_number: d.codeParts?.house,
    birth_month: d.codeParts?.month,
    postcode: d.codeParts?.postcode,
    signature_method: d.signature?.method,
    signature_typed_name: d.signature?.typedName,
    signature_file: d.signature?.image?.path ? labSignatureFile(String(d.participantCode), d.version) : null,
    confirmed_date: d.confirmedDate,
    completed_at: d.completedAt,
    received_at: d.receivedAt,
    created_at: d.createdAt,
  }));
  const statements = docs.flatMap(({ id, data: d }) =>
    Object.entries((d.responses ?? {}) as Record<string, DocumentData>).map(([statementId, r]) => ({
      consent_id: id,
      participant_id: labLabel(String(d.participantCode)),
      version: d.version,
      statement_id: statementId,
      statement_version: r.version,
      response: r.response,
      responded_at: r.respondedAt,
      via: r.via,
    })),
  );
  return { records, statements };
}

export function labDatasetDescription(exportedAt: string): Record<string, unknown> {
  return {
    Name: 'MyPhone/MyBrain social media break study: donated social media and screen-time data',
    BIDSVersion: BIDS_VERSION,
    DatasetType: 'raw',
    License: 'Restricted. Research data for the named study team only.',
    Authors: ['The MyPhone/MyBrain team, University of Leeds'],
    EthicsApprovals: ['University of Leeds School of Psychology Research Ethics Committee, SoPREC 4202, approved 11 June 2026'],
    GeneratedBy: [{ Name: 'MyPhone/MyBrain data donation export', Version: `${labConsentForm.id} ${labConsentForm.version}; cleaner ${cleaner.version}`, Description: 'Regenerated every hour from the study database; see the README', CodeURL: CODE_URL }],
    SourceDatasets: [{ URL: `firestore://${labStudy.studyId}`, Version: exportedAt }],
  };
}

export function labParticipantsDictionary(): Record<string, unknown> {
  return {
    participant_id: { Description: 'sub- followed by the participant code the lab questionnaire builds (mother’s initials, house number digit, birth month, postcode letters). The same code labels the laboratory data, so the two meet without a name.' },
    consented_on: { Description: 'Date the participant confirmed consent on the website, from the current consent record' },
    consent_version: { Description: 'Version of the consent form wording agreed to' },
    information_version: { Description: 'Version of the participant information sheet shown' },
    consent_n: { Description: 'Number of consent records for this code (a second consent from another device is appended, never overwritten)' },
    sessions_n: { Description: 'Occasions on which files were sent; each is a session' },
    archives_n: { Description: 'Cleaned TikTok or YouTube archives accepted in total' },
    screenshots_n: { Description: 'Screen-time screenshots accepted in total' },
    platforms: { Description: 'Platforms found in the cleaned archives', Levels: { tiktok: 'TikTok', youtube: 'YouTube' } },
    phone: { Description: 'Phone the screen-time screenshots come from, as chosen in the guide', Levels: { iphone: 'iPhone', android: 'Android' } },
    first_donation_at: { Description: 'When the first send was received (ISO 8601, UTC)' },
    last_donation_at: { Description: 'When the latest send was received (ISO 8601, UTC)' },
  };
}

export function labBehDictionary(): Record<string, unknown> {
  const out: Record<string, unknown> = {
    TaskName: TASK,
    TaskDescription: 'The participant downloaded their own TikTok and YouTube data, removed everything but dates, links and search words on their own device (keeping only the categories they ticked), and sent the cleaned archive together with screenshots of their phone’s screen-time summary. The files are under sourcedata/; this table lists them with what each archive’s manifest says is inside and the automatic checks run on each screenshot.',
    run: { Description: 'Order of the file within this send' },
    kind: { Description: 'What the file is', Levels: { archive: 'A cleaned ZIP archive made by the website’s cleaner', screenshot: 'A screen-time screenshot, re-encoded without device metadata' } },
    filename: { Description: 'Path of the file, relative to the dataset root' },
    bytes: { Description: 'File size as stored', Units: 'bytes' },
    sha256: { Description: 'SHA-256 of the stored file' },
    platforms: { Description: 'Platforms the archive holds (archives only)', Levels: { tiktok: 'TikTok', youtube: 'YouTube' } },
    categories: { Description: 'Categories the participant chose to keep (archives only); see the kept_* columns' },
  };
  for (const id of cleaner.categoryIds) out[`kept_${id}`] = { Description: `Rows kept in “${cleaner.titleOf[id]}” (${cleaner.platformOf[id] === 'tiktok' ? 'TikTok' : 'YouTube'}); n/a when the category was not kept or this is a screenshot` };
  Object.assign(out, {
    cleaner: { Description: 'The cleaner that made the archive, from its manifest' },
    cleaned_at: { Description: 'When the archive was cleaned on the participant’s device (ISO 8601)' },
    entries: { Description: 'File names inside the archive' },
    unpacked_bytes: { Description: 'Total size of the files inside the archive', Units: 'bytes' },
    width: { Description: 'Screenshot width', Units: 'pixels' },
    height: { Description: 'Screenshot height', Units: 'pixels' },
    verdict: { Description: 'Automatic quality check on a screenshot', Levels: { accepted: 'Looks like a screen-time page', review: 'Kept, but a person should look' } },
    looks_like_screen: { Description: 'Whether the image looks like a phone screenshot rather than a photograph' },
    apps_visible: { Description: 'Whether the text suggests the per-app list with times is in the picture' },
    checked_with_vision: { Description: 'Whether Cloud Vision text and SafeSearch detection ran' },
    terms_found: { Description: 'Screen-time words found by text detection' },
    reasons: { Description: 'Notes from the checks, for the team' },
  });
  return out;
}

const LAB_README = `MyPhone/MyBrain social media break study: donated data

Adults taking part in the laboratory study (two EEG visits around a break
from social media) download their own TikTok and YouTube data, keep only the
categories they choose, reduced on their own device to dates, links and
search words, and send the cleaned archive together with screenshots of their
phone's screen-time summary. This dataset is regenerated automatically every
hour from the study's database and mirrors the current records. Do not edit
files here.

participants.tsv          one row per participant with consent on file:
                          consent dates and versions, number of sends,
                          archives and screenshots, platforms found
sub-<CODE>/               one session (ses-01, ses-02, ...) per send; each
                          holds beh/*_task-donation_beh.tsv listing the files
                          with what the archive's manifest says is inside, or
                          the screenshot's automatic checks, and a sessions file
sourcedata/               the cleaned archives (.zip) and screenshots
                          themselves, named by subject, session and run, plus
                          raw JSON Lines dumps

Participants are labelled by the code the laboratory questionnaire builds
(sub-JA101CD), so this data and the laboratory data can be joined without a
name. Names and signatures from the consent records are kept outside this
dataset, in the identifying/ folder next to it, for study coordinators only,
together with the four answers the code was built from (mother's first name,
house number, birth month and postcode), which the team also uses as research
variables. Participants listed in participants.tsv without a subject folder have
consented but not sent anything yet.

Inside a cleaned archive: manifest.json (what was kept and removed),
tiktok_cleaned.json (TikTok: watch history, searches, likes, reposts, shares,
app-open times, activity totals, each reduced to dates, links and terms) and
youtube/history/watch-history.json, youtube/history/search-history.json and
youtube/subscriptions/subscriptions.csv. The server accepts no other file
names and never opens the content beyond checking it is well-formed.

Timestamps are ISO 8601 in UTC. Missing values are n/a.
`;

const LAB_SOURCEDATA_README = `Cleaned archives and screenshots as received, named
sub-<CODE>_ses-<nn>_run-<nn>_archive.zip or _screenshot.png/.jpg, and raw
JSON Lines dumps of the lab collections. See ../README.
`;

const LAB_ROOT_README = `# MyPhone/MyBrain: the social media break study

The adult laboratory study (two EEG visits around a break from social
media). Participants download their own TikTok and YouTube data, clean it on
their own device and donate the result, with screen-time screenshots, on the
website. Regenerated automatically every hour; do not edit or add files here.

bids/          the donated data in BIDS layout, labelled by the participant
               code the laboratory questionnaire also uses (sub-JA101CD), no
               names; for researchers
identifying/   consent records with typed names, the answers the code was
               built from (including postcode), and signatures; for study
               coordinators only
`;

const LAB_IDENTIFYING_README = `Identifying data for the social media break study. Study coordinators only.
Regenerated every hour as a mirror of the database; do not edit files here.

consents.tsv             every consent record, by participant code, with the typed
                         name and the four answers the code was built from
                         (mother's first name, house number, birth month, postcode);
                         a second consent for the same code is a new row and
                         supersedes points at the one before
consent_statements.tsv   one row per statement per consent record
signatures/              drawn signatures, named by participant code and version
raw/                     every consent document as JSON Lines

Files are tab-separated UTF-8 with n/a for missing values; timestamps are
ISO 8601 in UTC. The donated data, labelled by code only, is in the bids/
folder next to this one.
`;

/** The lab study's files, binary copies and counts, for runExport to merge with the family study's. */
export function labExport(snap: LabSnapshot, exportedAt: string): { files: OutFile[]; copies: Map<string, string>; counts: Record<string, number> } {
  const sessions = labSessionsOf(snap);
  const behColumns = Object.keys(labBehDictionary()).filter((k) => !['TaskName', 'TaskDescription'].includes(k));
  const files: OutFile[] = [
    textFile(`${LAB_ROOT}/README.md`, LAB_ROOT_README, 'text/markdown; charset=utf-8'),
    jsonFile(`${B}/dataset_description.json`, labDatasetDescription(exportedAt)),
    textFile(`${B}/README`, LAB_README),
    textFile(`${B}/CHANGES`, `1.0.0 ${exportedAt.slice(0, 10)}\n  - Regenerated automatically every hour; see ../../manifest.json.\n`),
    tsvFile(`${B}/participants.tsv`, labParticipantsTable(snap), ['participant_id', 'consented_on', 'consent_version', 'information_version', 'consent_n', 'sessions_n', 'archives_n', 'screenshots_n', 'platforms', 'phone', 'first_donation_at', 'last_donation_at']),
    jsonFile(`${B}/participants.json`, labParticipantsDictionary()),
    textFile(`${B}/sourcedata/README.md`, LAB_SOURCEDATA_README, 'text/markdown; charset=utf-8'),
    jsonlFile(`${B}/sourcedata/raw/labParticipants.jsonl`, snap.participants),
    jsonlFile(`${B}/sourcedata/raw/labDonations.jsonl`, snap.donations),
    textFile(`${I}/README.md`, LAB_IDENTIFYING_README, 'text/markdown; charset=utf-8'),
    jsonlFile(`${I}/raw/consents.jsonl`, snap.consents),
  ];
  const { records, statements } = labConsentTables(snap.consents);
  files.push(tsvFile(`${I}/consents.tsv`, records), tsvFile(`${I}/consent_statements.tsv`, statements));

  const bySubject = new Map<string, LabSession[]>();
  for (const s of sessions) {
    if (!bySubject.has(s.label)) bySubject.set(s.label, []);
    bySubject.get(s.label)!.push(s);
  }
  for (const [label, mine] of bySubject) {
    files.push(tsvFile(`${B}/${label}/${label}_sessions.tsv`, labSessionsTable(mine), ['session_id', 'acq_time', 'archives_n', 'screenshots_n', 'phone', 'needs_review']));
    for (const s of mine) {
      const base = `${B}/${label}/${s.session}/beh/${label}_${s.session}_task-${TASK}_beh`;
      files.push(tsvFile(`${base}.tsv`, labBehTable(s), behColumns), jsonFile(`${base}.json`, labBehDictionary()));
    }
  }

  const copies = new Map<string, string>();
  for (const s of sessions) s.files.forEach((f, i) => typeof f.path === 'string' && copies.set(f.path, `${B}/${labFile(s, i + 1, f)}`));
  for (const c of snap.consents) {
    const path = c.data.signature?.image?.path;
    if (typeof path === 'string') copies.set(path, `${I}/${labSignatureFile(String(c.data.participantCode), c.data.version)}`);
  }

  const all = sessions.flatMap((s) => s.files);
  const counts = {
    labParticipants: snap.participants.filter((p) => p.data.consentId).length,
    labConsents: snap.consents.length,
    labDonations: snap.donations.length,
    labArchives: all.filter((f) => f.kind === 'archive').length,
    labScreenshots: all.filter((f) => f.kind === 'screenshot').length,
    labSignatures: snap.consents.filter((c) => typeof c.data.signature?.image?.path === 'string').length,
  };
  return { files, copies, counts };
}
