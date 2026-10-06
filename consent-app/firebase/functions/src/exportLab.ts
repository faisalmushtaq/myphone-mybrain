import type { DocumentData } from 'firebase-admin/firestore';
import JSZip from 'jszip';
import { jsonFile, jsonlFile, textFile, toTsv, tsvFile, type Doc, type OutFile, type Row } from './export.js';
import { cleaner, labCheckInForm, labConsentForm, labStudy } from './forms.js';

/**
 * The social media break study's part of the hourly export: its own folder,
 * social-media-break/, holding the website's dataset, donations/, in BIDS
 * layout labelled by participant code (already a pseudonym: the lab
 * questionnaire builds the same code, so the laboratory data and this
 * donated data meet without a name), and its own identifying/ folder for the
 * consent records, names and signatures. The laboratory's own datasets (the
 * visits, any tracking) are expected to sit beside donations/, written by
 * the team, never inside it.
 *
 *   social-media-break/donations/participants.tsv              one row per consenting code
 *   social-media-break/donations/sub-<CODE>/sub-<CODE>_sessions.tsv
 *                                               one session per phase of the study
 *                                               (ses-pre before the break, ses-mid the
 *                                               check-ins during it, ses-post after),
 *                                               however many sends it took
 *   social-media-break/donations/phenotype/checkin.tsv   the check-in answers, one row each
 *   social-media-break/donations/sub-<CODE>/ses-<phase>/beh/*_task-donation_beh.tsv
 *                                               the files of that phase, with what the
 *                                               cleaner's manifest says is inside, or
 *                                               the screenshot checks
 *   social-media-break/donations/sourcedata/sub-<CODE>/ses-<phase>/   the archives and screenshots
 *   social-media-break/identifying/consents.tsv, consent_statements.tsv, signatures/
 */

const BIDS_VERSION = '1.10.0';
const TASK = 'donation';
const CODE_URL = 'https://github.com/faisalmushtaq/myphone-mybrain';
/** The study's folder in the export bucket, and its two website-owned subfolders. */
export const LAB_ROOT = 'social-media-break';
const B = `${LAB_ROOT}/donations`;
const I = `${LAB_ROOT}/identifying`;
const two = (n: number) => String(n).padStart(2, '0');

/** Where in the study a send belongs, from the page it came from: before the break, a check-in during it, after it. */
export type LabPhase = 'pre' | 'mid' | 'post';
export const LAB_PHASES: LabPhase[] = ['pre', 'mid', 'post'];

export interface LabSnapshot {
  participants: Doc[];
  consents: Doc[];
  donations: Doc[];
  reminders: Doc[];
  checkIns: Doc[];
}

/** Everything a participant sent in one phase of the study: one BIDS session, however many sends it took. */
export interface LabSession {
  code: string;
  label: string;
  /** ses-pre, ses-mid, ses-post, or ses-unspecified for sends recorded without a phase. */
  session: string;
  phase: string;
  /** The sends, in time order. */
  donations: Doc[];
  /** The files of those sends, in time order, each with the send it came in. */
  files: { file: DocumentData; donation: Doc }[];
}

/** sub-JA101CD: the participant code is the BIDS label. */
export const labLabel = (code: string) => `sub-${code}`;

/** ses-pre, ses-mid or ses-post; anything else was recorded without a phase. */
export const labSessionLabel = (phase: unknown) => `ses-${LAB_PHASES.includes(phase as LabPhase) ? String(phase) : 'unspecified'}`;

/** Sends are grouped by participant and phase, so a participant has at most one pre, one mid and one post session. */
export function labSessionsOf(snap: LabSnapshot): LabSession[] {
  const sorted = [...snap.donations].sort((a, b) => String(a.data.receivedAt ?? '').localeCompare(String(b.data.receivedAt ?? '')));
  const byKey = new Map<string, LabSession>();
  for (const d of sorted) {
    const code = String(d.data.participantCode);
    const session = labSessionLabel(d.data.phase);
    const key = `${code}/${session}`;
    if (!byKey.has(key)) byKey.set(key, { code, label: labLabel(code), session, phase: session.slice('ses-'.length), donations: [], files: [] });
    const s = byKey.get(key)!;
    s.donations.push(d);
    for (const file of (d.data.files ?? []) as DocumentData[]) s.files.push({ file, donation: d });
  }
  const order = (s: LabSession) => {
    const i = LAB_PHASES.indexOf(s.phase as LabPhase);
    return i < 0 ? LAB_PHASES.length : i;
  };
  return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label) || order(a) - order(b));
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
const last = <T>(xs: T[]): T | undefined => xs[xs.length - 1];

export function labParticipantsTable(snap: LabSnapshot): Row[] {
  const sessions = labSessionsOf(snap);
  const consentBy = new Map(snap.consents.map((c) => [c.id, c]));
  return snap.participants
    .filter((p) => p.data.consentId)
    .map(({ id, data: d }) => {
      const consent = consentBy.get(String(d.consentId));
      const mine = sessions.filter((s) => s.code === id);
      const files = mine.flatMap((s) => s.files.map((f) => f.file));
      const sends = mine.flatMap((s) => s.donations).sort((a, b) => String(a.data.receivedAt ?? '').localeCompare(String(b.data.receivedAt ?? '')));
      return {
        participant_id: labLabel(id),
        consented_on: consent?.data.confirmedDate,
        consent_version: consent?.data.formVersion,
        information_version: consent?.data.informationVersion,
        consent_n: d.consentVersion,
        phases: mine.map((s) => s.phase),
        sends_n: sends.length,
        checkins_n: snap.checkIns.filter((c) => c.data.participantCode === id).length,
        archives_n: files.filter((f) => f.kind === 'archive').length,
        screenshots_n: files.filter((f) => f.kind === 'screenshot').length,
        platforms: Array.from(new Set(files.flatMap((f) => (Array.isArray(f.platforms) ? (f.platforms as string[]) : [])))).sort(),
        phone: d.phone ?? last(sends)?.data.phone,
        first_send_at: sends[0]?.data.receivedAt,
        last_send_at: last(sends)?.data.receivedAt,
      };
    })
    .sort(byLabel);
}

export function labSessionsTable(sessions: LabSession[]): Row[] {
  return sessions.map((s) => ({
    session_id: s.session,
    phase: s.phase,
    acq_time: s.donations[0]?.data.receivedAt,
    last_send_at: last(s.donations)?.data.receivedAt,
    sends_n: s.donations.length,
    archives_n: s.files.filter((f) => f.file.kind === 'archive').length,
    screenshots_n: s.files.filter((f) => f.file.kind === 'screenshot').length,
    phone: last(s.donations)?.data.phone,
    needs_review: s.donations.some((d) => d.data.needsReview === true),
  }));
}

export function labBehTable(s: LabSession): Row[] {
  return s.files.map(({ file: f, donation }, i) => ({
    run: two(i + 1),
    kind: f.kind,
    filename: labFile(s, i + 1, f),
    tables: f.kind === 'archive' ? archiveTablesFor(f).map((t) => t.task) : null,
    received_at: donation.data.receivedAt,
    send_id: donation.id,
    check_in_id: donation.data.checkInId ?? null,
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

/* ── The archives, BIDS-ified ─────────────────────────────────────────────
 * A cleaned archive has no BIDS modality of its own, so besides keeping the
 * ZIP under sourcedata/ the export unpacks it, once, into tidy behavioural
 * tables, one per kind of record, each with a data dictionary:
 *   task-tiktokwatch    one row per video watched: time, link
 *   task-tiktoksearch   one row per search: time, search_term
 *   task-tiktokengage   likes, reposts and shares: time, action, link, method
 *   task-tiktokapp      app opens: time
 *   task-tiktoktotals   activity totals per section of the export
 *   task-youtubewatch   time, title, url, channel, channel_url
 *   task-youtubesearch  time, query, url
 *   task-youtubesubs    channel_id, channel_url, channel_title
 *   task-instagramreels, -instagramposts, -instagramlikes   time, url
 *   task-instagramsearch   time, search_term
 * Rows are the participant's own records as the cleaner left them; dates
 * stay as the platform wrote them (TikTok: "YYYY-MM-DD HH:MM:SS" UTC;
 * YouTube: ISO 8601). A derivatives dataset can aggregate them later.
 */

export interface ArchiveTable {
  task: string;
  columns: string[];
  dictionary: Record<string, unknown>;
  /** Which archive entry and (for TikTok) which cleaner category produce it. */
  entry: string;
  category?: string;
}

const dict = (description: string, columns: Record<string, string>) => ({ TaskDescription: description, ...Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, { Description: v }])) });

export const ARCHIVE_TABLES: ArchiveTable[] = [
  { task: 'tiktokwatch', entry: 'tiktok_cleaned.json', category: 'tt_watch', columns: ['time', 'link'], dictionary: dict('Videos watched on TikTok, from the participant’s own data export, reduced on their device to time and link.', { time: 'When the video was watched, as TikTok wrote it (YYYY-MM-DD HH:MM:SS, UTC)', link: 'Link to the video' }) },
  { task: 'tiktoksearch', entry: 'tiktok_cleaned.json', category: 'tt_search', columns: ['time', 'search_term'], dictionary: dict('Searches made on TikTok.', { time: 'When the search was made (YYYY-MM-DD HH:MM:SS, UTC)', search_term: 'The words searched for' }) },
  { task: 'tiktokengage', entry: 'tiktok_cleaned.json', category: 'tt_engage', columns: ['time', 'action', 'link', 'method'], dictionary: dict('Videos the participant liked, reposted or shared on TikTok.', { time: 'When (YYYY-MM-DD HH:MM:SS, UTC; likes may carry a date only)', action: 'like, repost or share', link: 'Link to the video', method: 'For shares, how it was shared' }) },
  { task: 'tiktokapp', entry: 'tiktok_cleaned.json', category: 'tt_login', columns: ['time'], dictionary: dict('Times the TikTok app was opened (TikTok’s login history, stripped of device and network details).', { time: 'When the app was opened (YYYY-MM-DD HH:MM:SS, UTC)' }) },
  { task: 'tiktoktotals', entry: 'tiktok_cleaned.json', category: 'tt_counts', columns: ['section', 'items'], dictionary: dict('How many records each section of the TikTok export held, counted on the device; the content itself was not kept.', { section: 'Section of the TikTok export', items: 'Number of records in it' }) },
  { task: 'youtubewatch', entry: 'youtube/history/watch-history.json', columns: ['time', 'title', 'url', 'channel', 'channel_url'], dictionary: dict('Videos watched on YouTube, from the participant’s Google Takeout export.', { time: 'When the video was watched (ISO 8601, as Google wrote it)', title: 'Video title, as recorded by Google (usually prefixed "Watched")', url: 'Link to the video', channel: 'Channel name', channel_url: 'Link to the channel' }) },
  { task: 'youtubesearch', entry: 'youtube/history/search-history.json', columns: ['time', 'query', 'url'], dictionary: dict('Searches made on YouTube.', { time: 'When the search was made (ISO 8601, as Google wrote it)', query: 'The words searched for', url: 'Link to the search results' }) },
  { task: 'youtubesubs', entry: 'youtube/subscriptions/subscriptions.csv', columns: ['channel_id', 'channel_url', 'channel_title'], dictionary: dict('Channels the participant subscribes to on YouTube.', { channel_id: 'YouTube channel id', channel_url: 'Link to the channel', channel_title: 'Channel name' }) },
  { task: 'instagramreels', entry: 'instagram/reels_watched.json', columns: ['time', 'url'], dictionary: dict('Reels watched on Instagram, from the participant’s own data export, reduced on their device to time and link.', { time: 'When the reel was watched (ISO 8601, UTC)', url: 'Link to the reel' }) },
  { task: 'instagramposts', entry: 'instagram/posts_viewed.json', columns: ['time', 'url'], dictionary: dict('Posts viewed on Instagram.', { time: 'When the post was viewed (ISO 8601, UTC)', url: 'Link to the post' }) },
  { task: 'instagramlikes', entry: 'instagram/likes.json', columns: ['time', 'url'], dictionary: dict('Posts liked on Instagram.', { time: 'When the post was liked (ISO 8601, UTC)', url: 'Link to the post' }) },
  { task: 'instagramsearch', entry: 'instagram/searches.json', columns: ['time', 'search_term'], dictionary: dict('Searches made on Instagram (accounts and words).', { time: 'When the search was made (ISO 8601, UTC)', search_term: 'The account or words searched for' }) },
];

/** The tables an archive yields, decided from its record alone (entries and kept categories), so the expected paths are known without opening it. */
export function archiveTablesFor(file: DocumentData): ArchiveTable[] {
  const entries = new Set(Array.isArray(file.entries) ? (file.entries as string[]) : []);
  const categories = new Set(Array.isArray(file.categories) ? (file.categories as string[]) : []);
  return ARCHIVE_TABLES.filter((t) => entries.has(t.entry) && (!t.category || categories.has(t.category)));
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
type Json = Record<string, unknown>;
const asRows = (v: unknown): Json[] => (Array.isArray(v) ? v.filter((x): x is Json => typeof x === 'object' && x !== null) : []);

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim().length));
}

/** Turns the files inside a cleaned archive into rows for one table. */
export function archiveTableRows(table: ArchiveTable, texts: Map<string, string>): Row[] {
  const text = texts.get(table.entry);
  if (text === undefined) return [];
  if (table.entry === 'tiktok_cleaned.json') {
    const data = JSON.parse(text) as Json;
    const act = (data.Activity ?? {}) as Json;
    switch (table.task) {
      case 'tiktokwatch':
        return asRows(act.WatchHistory).map((r) => ({ time: str(r.Date), link: str(r.Link) }));
      case 'tiktoksearch':
        return asRows(act.Searches).map((r) => ({ time: str(r.Date), search_term: str(r.SearchTerm) }));
      case 'tiktokengage':
        return [
          ...asRows(act.Likes).map((r) => ({ time: str(r.date ?? r.Date), action: 'like', link: str(r.link ?? r.Link), method: '' })),
          ...asRows(act.Reposts).map((r) => ({ time: str(r.Date), action: 'repost', link: str(r.Link), method: '' })),
          ...asRows(act.Shares).map((r) => ({ time: str(r.Date), action: 'share', link: str(r.Link), method: str(r.Method) })),
        ].sort((a, b) => a.time.localeCompare(b.time));
      case 'tiktokapp':
        return asRows(act.LoginTimestamps).map((r) => ({ time: str(r.Date) }));
      case 'tiktoktotals':
        return Object.entries((data.AggregateCounts ?? {}) as Record<string, unknown>).map(([section, items]) => ({ section, items }));
      default:
        return [];
    }
  }
  if (table.task === 'youtubewatch') return asRows(JSON.parse(text)).map((r) => ({ time: str(r.time), title: str(r.title), url: str(r.titleUrl), channel: str(asRows(r.subtitles)[0]?.name), channel_url: str(asRows(r.subtitles)[0]?.url) }));
  if (table.task === 'youtubesearch') return asRows(JSON.parse(text)).map((r) => ({ time: str(r.time), query: str(r.title).replace(/^Searched for /, ''), url: str(r.titleUrl) }));
  if (table.task.startsWith('instagram')) return asRows(JSON.parse(text)).map((r) => (table.task === 'instagramsearch' ? { time: str(r.time), search_term: str(r.search) } : { time: str(r.time), url: str(r.url) }));
  if (table.task === 'youtubesubs') {
    const [header, ...rows] = parseCsv(text);
    const col = (name: RegExp) => header?.findIndex((h) => name.test(h)) ?? -1;
    const id = col(/id/i);
    const url = col(/url/i);
    const title = col(/title/i);
    return rows.map((r) => ({ channel_id: r[id] ?? '', channel_url: r[url] ?? '', channel_title: r[title] ?? '' }));
  }
  return [];
}

/** Where an archive's tables go, relative to the dataset root: beside the index, named by task and the archive's run. */
export function archiveTablePath(s: LabSession, run: number, task: string): string {
  return `${s.label}/${s.session}/beh/${s.label}_${s.session}_task-${task}_run-${two(run)}_beh`;
}

/** Something to build from a stored file once, when its outputs are missing from the bucket. */
export interface Derivation {
  source: string;
  paths: string[];
  build: (buffer: Buffer) => Promise<OutFile[]>;
}

export async function buildArchiveTables(zipBuffer: Buffer, tables: { table: ArchiveTable; base: string }[]): Promise<OutFile[]> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const texts = new Map<string, string>();
  for (const name of Object.keys(zip.files)) if (!zip.files[name].dir) texts.set(name, await zip.files[name].async('string'));
  const out: OutFile[] = [];
  for (const { table, base } of tables) {
    const rows = archiveTableRows(table, texts);
    out.push({ path: `${base}.tsv`, body: toTsv(rows, table.columns), contentType: 'text/tab-separated-values; charset=utf-8' }, jsonFile(`${base}.json`, { TaskName: table.task, ...table.dictionary }));
  }
  return out;
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

/** The mid-break check-ins: one row per check-in, in time order, with one column per question. */
export function labCheckInTable(checkIns: Doc[]): Row[] {
  return [...checkIns]
    .sort((a, b) => String(a.data.participantCode).localeCompare(String(b.data.participantCode)) || String(a.data.receivedAt ?? '').localeCompare(String(b.data.receivedAt ?? '')))
    .map(({ id, data: d }) => ({
      participant_id: labLabel(String(d.participantCode)),
      session_id: 'ses-mid',
      check_in_id: id,
      check_in_n: d.number,
      submitted_at: d.receivedAt,
      form_version: d.formVersion,
      ...Object.fromEntries(labCheckInForm.questions.map((q) => [q.id.replace(/-/g, '_'), (d.answers as Record<string, unknown> | undefined)?.[q.id] ?? null])),
    }));
}

export function labCheckInColumns(): string[] {
  return ['participant_id', 'session_id', 'check_in_id', 'check_in_n', 'submitted_at', 'form_version', ...labCheckInForm.questions.map((q) => q.id.replace(/-/g, '_'))];
}

export function labCheckInDictionary(): Record<string, unknown> {
  const out: Record<string, unknown> = {
    MeasurementToolMetadata: { Description: `The website’s mid-break check-in (${labCheckInForm.id} ${labCheckInForm.version}): a few questions answered during the social media break, as often as the participant checks in.` },
    participant_id: { Description: 'sub- followed by the participant code' },
    session_id: { Description: 'Always ses-mid: the check-ins happen during the break; screenshots sent with them are in that session, linked by check_in_id' },
    check_in_id: { Description: 'Identifier of the check-in; the check_in_id column of ses-mid’s donation index points here' },
    check_in_n: { Description: 'Which check-in this was for the participant: 1 for the first' },
    submitted_at: { Description: 'When the check-in was received (ISO 8601, UTC)' },
    form_version: { Description: 'Version of the check-in questions answered' },
  };
  for (const q of labCheckInForm.questions) {
    out[q.id.replace(/-/g, '_')] = q.type === 'choice' ? { LongName: q.label, Description: q.text, Levels: Object.fromEntries(q.options.map((o) => [o.value, o.label])) } : { LongName: q.label, Description: `${q.text} Free text, at most ${q.maxLength} characters; n/a when left blank.` };
  }
  return out;
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
    phases: { Description: 'Phases of the study with data: one session each', Levels: { pre: 'Before the social media break, from the first page (ses-pre)', mid: 'Screenshots sent with the mid-break check-ins (ses-mid)', post: 'After the break, from the after-break page (ses-post)', unspecified: 'Sent before phases were recorded (ses-unspecified)' } },
    sends_n: { Description: 'Occasions on which files were sent, across all phases' },
    checkins_n: { Description: 'Mid-break check-ins sent; the answers are in phenotype/checkin.tsv' },
    archives_n: { Description: 'Cleaned TikTok or YouTube archives accepted in total' },
    screenshots_n: { Description: 'Screen-time screenshots accepted in total' },
    platforms: { Description: 'Platforms found in the cleaned archives', Levels: { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram' } },
    phone: { Description: 'Phone the screen-time screenshots come from, as chosen in the guide', Levels: { iphone: 'iPhone', android: 'Android' } },
    first_send_at: { Description: 'When the first send was received (ISO 8601, UTC)' },
    last_send_at: { Description: 'When the latest send was received (ISO 8601, UTC)' },
  };
}

export function labBehDictionary(): Record<string, unknown> {
  const out: Record<string, unknown> = {
    TaskName: TASK,
    TaskDescription: 'The participant downloaded their own TikTok, YouTube or Instagram data, removed everything but dates, links and search words on their own device (keeping only the categories they ticked), and sent the cleaned archive together with screenshots of their phone’s screen-time summary: before their social media break from the first page (ses-pre), with the weekly check-ins during it (screenshots only, ses-mid), and after it from the after-break page (ses-post). The files are under sourcedata/; this table lists them with what each archive’s manifest says is inside and the automatic checks run on each screenshot.',
    run: { Description: 'Order of the file within this session (all sends of this phase, in time order)' },
    kind: { Description: 'What the file is', Levels: { archive: 'A cleaned ZIP archive made by the website’s cleaner', screenshot: 'A screen-time screenshot, re-encoded without device metadata' } },
    filename: { Description: 'Path of the file, relative to the dataset root' },
    tables: { Description: 'For an archive, the task labels of the behavioural tables it was unpacked into, beside this file (sub-<CODE>_ses-<phase>_task-<label>_run-<nn>_beh.tsv)' },
    received_at: { Description: 'When the send that carried this file was received (ISO 8601, UTC)' },
    send_id: { Description: 'Identifier of the send; files with the same id arrived together' },
    check_in_id: { Description: 'For screenshots sent with a mid-break check-in (ses-mid), the check-in they belong to; see phenotype/checkin.tsv' },
    bytes: { Description: 'File size as stored', Units: 'bytes' },
    sha256: { Description: 'SHA-256 of the stored file' },
    platforms: { Description: 'Platforms the archive holds (archives only)', Levels: { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram' } },
    categories: { Description: 'Categories the participant chose to keep (archives only); see the kept_* columns' },
  };
  const platformName: Record<string, string> = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram' };
  for (const id of cleaner.categoryIds) out[`kept_${id}`] = { Description: `Rows kept in “${cleaner.titleOf[id]}” (${platformName[cleaner.platformOf[id]] ?? cleaner.platformOf[id]}); n/a when the category was not kept or this is a screenshot` };
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
from social media) download their own TikTok, YouTube or Instagram data, keep
only the categories they choose, reduced on their own device to dates, links
and search words, and send the cleaned archive together with screenshots of
their phone's screen-time summary: before the break from the first page, and
again after it from the after-break page. During the break they check in on
a third page with a few questions and, if they can, a screenshot. This
dataset is regenerated automatically every hour from the study's database
and mirrors the current records. Do not edit files here.

participants.tsv          one row per participant with consent on file:
                          consent dates and versions, phases with data, sends,
                          check-ins, archives and screenshots, platforms, phone
phenotype/checkin.tsv     the mid-break check-ins: one row per check-in, one
                          column per question, with checkin.json describing
                          each question and its answers
sub-<CODE>/               one session per phase of the study: ses-pre holds
                          everything sent before the break, ses-mid the
                          screenshots sent with the check-ins (check_in_id links
                          each to phenotype/checkin.tsv), ses-post everything
                          sent after it (ses-unspecified for sends recorded
                          before phases were), however many sends it took.
                          Its beh/ folder holds
                          *_task-donation_beh.tsv, the index of files sent (with
                          what each archive's manifest says is inside, or the
                          screenshot's automatic checks), and, unpacked from each
                          archive, one table per kind of record with its own
                          data dictionary:
                            task-tiktokwatch    videos watched: time, link
                            task-tiktoksearch   searches: time, search_term
                            task-tiktokengage   likes, reposts, shares
                            task-tiktokapp      app opens: time
                            task-tiktoktotals   record counts per section
                            task-youtubewatch   time, title, url, channel
                            task-youtubesearch  time, query, url
                            task-youtubesubs    subscriptions
                            task-instagramreels, -posts, -likes   time, url
                            task-instagramsearch   time, search_term
                          The run number ties a table to its archive in the index.
                          The sessions file gives each phase's first and last send.
sourcedata/               the cleaned archives (.zip) and screenshots as received,
                          named by subject, session and run, plus raw JSON Lines dumps

Participants are labelled by the code the laboratory questionnaire builds
(sub-JA101CD), so this data and the laboratory data can be joined without a
name. Names and signatures from the consent records are kept outside this
dataset, in the identifying/ folder next to it, for study coordinators only,
together with the four answers the code was built from (mother's first name,
house number, birth month and postcode), which the team also uses as research
variables. Participants listed in participants.tsv without a subject folder
have consented but not sent anything yet.

Inside a cleaned archive: manifest.json (what was kept and removed),
tiktok_cleaned.json (TikTok: watch history, searches, likes, reposts, shares,
app-open times, activity totals, each reduced to dates, links and terms),
youtube/history/watch-history.json, youtube/history/search-history.json,
youtube/subscriptions/subscriptions.csv, and instagram/reels_watched.json,
posts_viewed.json, likes.json and searches.json (time and link, or the search
words). The server accepts no other file names and never opens the content
beyond checking it is well-formed and unpacking it into the tables above.

Timestamps are ISO 8601 in UTC. Missing values are n/a.
`;

const LAB_SOURCEDATA_README = `Cleaned archives and screenshots as received, named
sub-<CODE>_ses-<phase>_run-<nn>_archive.zip or _screenshot.png/.jpg, and raw
JSON Lines dumps of the lab collections. See ../README.
`;

const LAB_ROOT_README = `# MyPhone/MyBrain: the social media break study

The adult laboratory study (two EEG visits around a break from social
media). This folder gathers the study's datasets, all labelled by the
participant code the laboratory questionnaire builds (sub-JA101CD), so they
join without a name.

donations/     written by the website every hour: the TikTok, YouTube and
               Instagram data participants cleaned on their own device and
               donated, with their screen-time screenshots, before and after
               the break, and the mid-break check-ins; BIDS layout, no
               names; for researchers
identifying/   written by the website every hour: consent records with typed
               names, the answers the code was built from (including
               postcode), and signatures; for study coordinators only

The two folders above are mirrors: anything added inside them is removed on
the next run. Keep the laboratory's own datasets (the visits, any tracking)
beside them in this folder, for example lab-visits/, never inside them.
`;

const LAB_IDENTIFYING_README = `Identifying data for the social media break study. Study coordinators only.
Regenerated every hour as a mirror of the database; do not edit files here.

consents.tsv             every consent record, by participant code, with the typed
                         name and the four answers the code was built from
                         (mother's first name, house number, birth month, postcode);
                         a second consent for the same code is a new row and
                         supersedes points at the one before
consent_statements.tsv   one row per statement per consent record
reminders.tsv            email addresses of participants who asked for a progress
                         email, when it and the one follow-up were sent
signatures/              drawn signatures, named by participant code and version
raw/                     every document as JSON Lines

Files are tab-separated UTF-8 with n/a for missing values; timestamps are
ISO 8601 in UTC. The donated data, labelled by code only, is in the
donations/ folder next to this one.
`;

/** The lab study's files, binary copies and counts, for runExport to merge with the schools study's. */
export function labExport(snap: LabSnapshot, exportedAt: string): { files: OutFile[]; copies: Map<string, string>; derived: Derivation[]; counts: Record<string, number> } {
  const sessions = labSessionsOf(snap);
  const behColumns = Object.keys(labBehDictionary()).filter((k) => !['TaskName', 'TaskDescription'].includes(k));
  const files: OutFile[] = [
    textFile(`${LAB_ROOT}/README.md`, LAB_ROOT_README, 'text/markdown; charset=utf-8'),
    jsonFile(`${B}/dataset_description.json`, labDatasetDescription(exportedAt)),
    textFile(`${B}/README`, LAB_README),
    textFile(`${B}/CHANGES`, `1.0.0 ${exportedAt.slice(0, 10)}\n  - Regenerated automatically every hour; see ../../manifest.json.\n`),
    tsvFile(`${B}/participants.tsv`, labParticipantsTable(snap), ['participant_id', 'consented_on', 'consent_version', 'information_version', 'consent_n', 'phases', 'sends_n', 'checkins_n', 'archives_n', 'screenshots_n', 'platforms', 'phone', 'first_send_at', 'last_send_at']),
    jsonFile(`${B}/participants.json`, labParticipantsDictionary()),
    tsvFile(`${B}/phenotype/checkin.tsv`, labCheckInTable(snap.checkIns), labCheckInColumns()),
    jsonFile(`${B}/phenotype/checkin.json`, labCheckInDictionary()),
    textFile(`${B}/sourcedata/README.md`, LAB_SOURCEDATA_README, 'text/markdown; charset=utf-8'),
    jsonlFile(`${B}/sourcedata/raw/labParticipants.jsonl`, snap.participants),
    jsonlFile(`${B}/sourcedata/raw/labDonations.jsonl`, snap.donations),
    jsonlFile(`${B}/sourcedata/raw/labCheckIns.jsonl`, snap.checkIns),
    textFile(`${I}/README.md`, LAB_IDENTIFYING_README, 'text/markdown; charset=utf-8'),
    jsonlFile(`${I}/raw/consents.jsonl`, snap.consents),
  ];
  const { records, statements } = labConsentTables(snap.consents);
  files.push(tsvFile(`${I}/consents.tsv`, records), tsvFile(`${I}/consent_statements.tsv`, statements));
  files.push(
    tsvFile(
      `${I}/reminders.tsv`,
      snap.reminders.map(({ id, data: d }) => ({ participant_code: id, participant_id: labLabel(id), email: d.email, requested_at: d.requestedAt, status_email: d.statusOutcome, follow_up_due_at: d.followUpDueAt, follow_up_sent_at: d.followUpSentAt, follow_up_email: d.followUpOutcome, completed_at: d.completedAt })),
      ['participant_code', 'participant_id', 'email', 'requested_at', 'status_email', 'follow_up_due_at', 'follow_up_sent_at', 'follow_up_email', 'completed_at'],
    ),
    jsonlFile(`${I}/raw/reminders.jsonl`, snap.reminders),
  );

  const bySubject = new Map<string, LabSession[]>();
  for (const s of sessions) {
    if (!bySubject.has(s.label)) bySubject.set(s.label, []);
    bySubject.get(s.label)!.push(s);
  }
  for (const [label, mine] of bySubject) {
    files.push(tsvFile(`${B}/${label}/${label}_sessions.tsv`, labSessionsTable(mine), ['session_id', 'phase', 'acq_time', 'last_send_at', 'sends_n', 'archives_n', 'screenshots_n', 'phone', 'needs_review']));
    for (const s of mine) {
      const base = `${B}/${label}/${s.session}/beh/${label}_${s.session}_task-${TASK}_beh`;
      files.push(tsvFile(`${base}.tsv`, labBehTable(s), behColumns), jsonFile(`${base}.json`, labBehDictionary()));
    }
  }

  const copies = new Map<string, string>();
  const derived: Derivation[] = [];
  for (const s of sessions) {
    s.files.forEach(({ file }, i) => {
      if (typeof file.path !== 'string') return;
      copies.set(file.path, `${B}/${labFile(s, i + 1, file)}`);
      if (file.kind !== 'archive') return;
      const tables = archiveTablesFor(file).map((table) => ({ table, base: `${B}/${archiveTablePath(s, i + 1, table.task)}` }));
      if (tables.length) derived.push({ source: file.path, paths: tables.flatMap((t) => [`${t.base}.tsv`, `${t.base}.json`]), build: (buffer) => buildArchiveTables(buffer, tables) });
    });
  }
  for (const c of snap.consents) {
    const path = c.data.signature?.image?.path;
    if (typeof path === 'string') copies.set(path, `${I}/${labSignatureFile(String(c.data.participantCode), c.data.version)}`);
  }

  const all = sessions.flatMap((s) => s.files.map((f) => f.file));
  const counts = {
    labParticipants: snap.participants.filter((p) => p.data.consentId).length,
    labConsents: snap.consents.length,
    labDonations: snap.donations.length,
    labArchives: all.filter((f) => f.kind === 'archive').length,
    labScreenshots: all.filter((f) => f.kind === 'screenshot').length,
    labSignatures: snap.consents.filter((c) => typeof c.data.signature?.image?.path === 'string').length,
    labCheckIns: snap.checkIns.length,
  };
  return { files, copies, derived, counts };
}
