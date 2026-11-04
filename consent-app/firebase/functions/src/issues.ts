/**
 * The issue log, "Notebook" (4 November 2026): anyone on a visit logs a data
 * problem in a few taps (a headset that would not settle, a fire alarm, a
 * pupil who left early), stamped with the time on their device, so the
 * analysis can flag or leave out the data it touches. Pure: the rules, the
 * export rows and the daily email. issuesStore.ts reads and writes Firestore.
 *
 * It is for data issues only. A worry about a child's safety or welfare goes
 * through the safeguarding procedure to the lead, never here.
 */

export const ISSUE_TYPES = ['eeg', 'noise', 'equipment', 'software', 'participant', 'timing', 'other'] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];
export const ISSUE_TYPE_LABEL: Record<IssueType, string> = {
  eeg: 'Headset/EEG signal',
  noise: 'Noise/interruption',
  equipment: 'Equipment (laptop/iPad)',
  software: 'Task/software',
  participant: 'Participant',
  timing: 'Timing/schedule',
  other: 'Other',
};
export const IMPACTS = ['minor', 'may-affect', 'unusable'] as const;
export type Impact = (typeof IMPACTS)[number];
export const IMPACT_LABEL: Record<Impact, string> = { minor: 'Minor', 'may-affect': 'May affect data', unusable: 'Data unusable' };
export const ISSUE_STATUSES = ['open', 'handled', 'not-relevant'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const STATUS_LABEL: Record<IssueStatus, string> = { open: 'Open', handled: 'Handled in analysis', 'not-relevant': 'Not relevant' };

/** Who or what an entry is about: a young person with a study ID, a name an assistant typed (resolved later), or the whole room. */
export type About = { kind: 'person'; studyId: string } | { kind: 'typed'; name: string; studyId: string | null } | { kind: 'room' };

export interface Comment {
  id: string;
  at: string;
  by: string;
  byName: string;
  text: string;
}
export interface Change {
  at: string;
  by: string;
  byName: string;
  /** Each field changed: what it was and what it became (the note's old text is never lost). */
  changes: Record<string, { from: unknown; to: unknown }>;
}
export interface Issue {
  id: string;
  uid: string;
  authorName: string;
  authorRole: string;
  /** When the button was pressed, by the device's clock (as adjusted by the author). */
  deviceAt: string;
  /** When the server got it (an entry queued offline arrives later). */
  receivedAt: string;
  visitId: string | null;
  schoolId: string | null;
  about: About[];
  type: IssueType;
  impact: Impact;
  note: string;
  recordings: string[];
  status: IssueStatus;
  resolution: string;
  comments: Comment[];
  history: Change[];
}

export type Role = 'pm' | 'researcher' | 'ra';
export interface Viewer {
  uid: string;
  role: Role | null;
}
const team = (v: Viewer) => v.role === 'pm' || v.role === 'researcher';
/** How long an assistant may change their own entry. */
export const OWN_EDIT_MS = 24 * 60 * 60 * 1000;

/** The project manager and the research team see every entry; an assistant sees their own. */
export const canSee = (i: Pick<Issue, 'uid'>, v: Viewer) => team(v) || i.uid === v.uid;
/** The team can always edit; an assistant their own, for 24 hours after it arrived. */
export const canEdit = (i: Pick<Issue, 'uid' | 'receivedAt'>, v: Viewer, now = Date.now()) => team(v) || (i.uid === v.uid && now - Date.parse(i.receivedAt) < OWN_EDIT_MS);
/** Comments: the team on any entry, an assistant on their own. */
export const canComment = canSee;
/** Open / handled / not relevant, and naming the pupil an assistant typed: the team only. */
export const canTriage = (v: Viewer) => team(v);

const STUDY_ID = /^sub-\d{4,}$/;
export const ISSUE_ID = /^[A-Za-z0-9-]{8,64}$/;
const REC = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/**
 * An entry as the browser sent it, checked. The device time is kept as given
 * (an entry from the offline queue may be hours old) unless it is in the
 * future by more than a few minutes, which only a wrong clock does.
 */
export function issueInput(raw: Record<string, unknown>, v: Viewer, now = new Date()): { ok: true; value: Pick<Issue, 'id' | 'deviceAt' | 'visitId' | 'about' | 'type' | 'impact' | 'note' | 'recordings'> } | { ok: false; problem: string } {
  const id = clip(raw.id, 64);
  if (!ISSUE_ID.test(id)) return { ok: false, problem: 'The entry has no id.' };
  const t = Date.parse(String(raw.deviceAt ?? ''));
  if (!Number.isFinite(t)) return { ok: false, problem: 'The time is missing.' };
  if (t > now.getTime() + 10 * 60_000) return { ok: false, problem: 'The time is in the future: check it.' };
  if (t < now.getTime() - 400 * 86_400_000) return { ok: false, problem: 'The time is more than a year ago: check it.' };
  const type = ISSUE_TYPES.includes(raw.type as IssueType) ? (raw.type as IssueType) : null;
  if (!type) return { ok: false, problem: 'Choose what kind of problem it was.' };
  const impact = IMPACTS.includes(raw.impact as Impact) ? (raw.impact as Impact) : null;
  if (!impact) return { ok: false, problem: 'Choose how much it affects the data.' };
  const note = clip(raw.note, 4000);
  const about: About[] = [];
  for (const a of (Array.isArray(raw.about) ? raw.about : []).slice(0, 40) as Record<string, unknown>[]) {
    if (a?.kind === 'room') about.push({ kind: 'room' });
    else if (a?.kind === 'person' && STUDY_ID.test(String(a.studyId))) about.push({ kind: 'person', studyId: String(a.studyId) });
    else if (a?.kind === 'typed' && clip(a.name, 80)) about.push({ kind: 'typed', name: clip(a.name, 80), studyId: null });
  }
  if (!note && !about.length) return { ok: false, problem: 'Say what happened, or who it was about.' };
  const recordings = [...new Set((Array.isArray(raw.recordings) ? raw.recordings : []).map((r) => String(r).trim()).filter((r) => REC.test(r)))].slice(0, 40);
  const visitId = typeof raw.visitId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(raw.visitId) ? raw.visitId : null;
  void v;
  return { ok: true, value: { id, deviceAt: new Date(t).toISOString(), visitId, about: dedupeAbout(about), type, impact, note, recordings } };
}

function dedupeAbout(about: About[]): About[] {
  const seen = new Set<string>();
  return about.filter((a) => {
    const k = a.kind === 'person' ? a.studyId : a.kind === 'typed' ? `t:${a.name.toLowerCase()}` : 'room';
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The field-by-field record of an edit: only what changed. */
export function changesBetween(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) out[k] = { from: before[k] ?? null, to: after[k] ?? null };
  return out;
}

/* ── Days, in UK time ─────────────────────────────────────────────────── */

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
const CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** The UK date (YYYY-MM-DD) of an instant: summer time handled. */
export const ukDay = (iso: string) => DAY.format(new Date(iso));
/** The UK clock time (HH:MM) of an instant. */
export const ukClock = (iso: string) => CLOCK.format(new Date(iso));

/* ── The export ───────────────────────────────────────────────────────── */

export type Row = Record<string, string | number | null>;
export const ISSUE_COLUMNS = ['issue_id', 'logged_at', 'logged_day', 'received_at', 'school_id', 'visit_id', 'participant_ids', 'whole_room', 'unresolved_pupils', 'recording_ids', 'type', 'impact', 'status', 'resolution', 'note'];
export const ISSUE_IDENTIFYING_COLUMNS = [...ISSUE_COLUMNS, 'typed_names', 'author_name', 'author_role', 'comments_n'];

/**
 * One row an entry. The research table has study IDs and recording ids,
 * never names: a name an assistant typed counts only as "unresolved_pupils"
 * until the team names the study ID. Notes go through as written (the form
 * asks for no names in notes). The identifying table adds the typed names
 * and the author.
 */
export function issueRows(issues: Issue[]): { research: Row[]; identifying: Row[] } {
  const sorted = [...issues].sort((a, b) => a.deviceAt.localeCompare(b.deviceAt) || a.id.localeCompare(b.id));
  const research = sorted.map((i) => {
    const ids = i.about.flatMap((a) => (a.kind === 'person' ? [a.studyId] : a.kind === 'typed' && a.studyId ? [a.studyId] : []));
    return {
      issue_id: i.id,
      logged_at: i.deviceAt,
      logged_day: ukDay(i.deviceAt),
      received_at: i.receivedAt,
      school_id: i.schoolId,
      visit_id: i.visitId,
      participant_ids: [...new Set(ids)].join(',') || null,
      whole_room: i.about.some((a) => a.kind === 'room') ? 'yes' : 'no',
      unresolved_pupils: i.about.filter((a) => a.kind === 'typed' && !a.studyId).length,
      recording_ids: i.recordings.join(',') || null,
      type: i.type,
      impact: i.impact,
      status: i.status,
      resolution: i.resolution || null,
      note: i.note || null,
    } as Row;
  });
  const identifying = sorted.map((i, n) => ({ ...research[n], typed_names: i.about.flatMap((a) => (a.kind === 'typed' ? [a.name] : [])).join('; ') || null, author_name: i.authorName, author_role: i.authorRole, comments_n: i.comments.length }));
  return { research, identifying };
}

export function issuesDictionary(): Record<string, unknown> {
  return {
    issue_id: { Description: 'The entry in the staff portal’s issue log (Notebook).' },
    logged_at: { Description: 'When it happened, by the logging device’s clock (ISO 8601, UTC).' },
    logged_day: { Description: 'The UK date it happened.' },
    received_at: { Description: 'When the portal received it; later than logged_at for an entry sent from the offline queue.' },
    school_id: { Description: 'The school of the visit.' },
    visit_id: { Description: 'The school visit (staff portal); empty when not logged at a visit.' },
    participant_ids: { Description: 'Study IDs (linkage/participants.tsv) the entry is about.' },
    whole_room: { Description: 'The entry is about the whole room or session.' },
    unresolved_pupils: { Description: 'Pupils named by a research assistant that the team has not yet tied to a study ID.' },
    recording_ids: { Description: 'EEG recordings affected (linkage/eeg_map.tsv).' },
    type: { Description: 'What kind of problem', Levels: ISSUE_TYPE_LABEL },
    impact: { Description: 'How much it affects the data', Levels: IMPACT_LABEL },
    status: { Description: 'Where it stands', Levels: STATUS_LABEL },
    resolution: { Description: 'What the team decided.' },
    note: { Description: 'What happened, as the person wrote it.' },
  };
}

/* ── The daily email ──────────────────────────────────────────────────── */

export interface DigestEntry extends Issue {
  schoolName: string;
  visitLabel: string;
  /** Pupils as the team reads them: first name and last initial, or the study ID. */
  pupils: string[];
  link: string;
}
export interface Digest {
  subject: string;
  text: string;
  html: string;
  counts: Record<Impact, number>;
  entries: number;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** "Amara Ahmed" -> "Amara A." */
export const shortName = (first: string, last: string) => `${first.trim()}${last.trim() ? ` ${last.trim()[0].toUpperCase()}.` : ''}`.trim();

/** Which entries belong to a UK day: those that happened that day, and those that arrived that day from earlier (marked). */
export function entriesForDay<T extends Pick<Issue, 'deviceAt' | 'receivedAt'>>(issues: T[], day: string): { entry: T; late: boolean }[] {
  const out: { entry: T; late: boolean }[] = [];
  for (const i of issues) {
    const happened = ukDay(i.deviceAt);
    if (happened === day) out.push({ entry: i, late: false });
    else if (happened < day && ukDay(i.receivedAt) === day) out.push({ entry: i, late: true });
  }
  return out;
}

/**
 * The day's email, or null when the day had nothing and the setting does not
 * ask for an empty one. "Data unusable" first, highlighted; then everything
 * else by school and visit, by time; then what is still open from before.
 */
export function buildDigest(input: { day: string; entries: DigestEntry[]; openEarlier: number; notebookLink: string; sendEmpty: boolean }): Digest | null {
  const items = entriesForDay(input.entries, input.day);
  if (!items.length && !input.sendEmpty) return null;
  const counts: Record<Impact, number> = { unusable: 0, 'may-affect': 0, minor: 0 };
  for (const { entry } of items) counts[entry.impact] += 1;
  const longDay = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${input.day}T12:00:00Z`));
  const byTime = (a: { entry: DigestEntry }, b: { entry: DigestEntry }) => a.entry.deviceAt.localeCompare(b.entry.deviceAt);
  const unusable = items.filter((x) => x.entry.impact === 'unusable').sort(byTime);
  const rest = items.filter((x) => x.entry.impact !== 'unusable');
  const groups = new Map<string, { title: string; items: typeof rest }>();
  for (const x of rest) {
    const title = x.entry.schoolName ? `${x.entry.schoolName}${x.entry.visitLabel ? ` · ${x.entry.visitLabel}` : ''}` : 'Not at a visit';
    if (!groups.has(title)) groups.set(title, { title, items: [] });
    groups.get(title)!.items.push(x);
  }
  const ordered = [...groups.values()].sort((a, b) => (a.title === 'Not at a visit' ? 1 : b.title === 'Not at a visit' ? -1 : a.title.localeCompare(b.title)));
  for (const g of ordered) g.items.sort(byTime);

  const line = ({ entry: e, late }: { entry: DigestEntry; late: boolean }) => {
    const who = [...e.pupils, ...(e.about.some((a) => a.kind === 'room') ? ['whole room/session'] : [])].join(', ');
    return { time: `${late ? `${ukDay(e.deviceAt).slice(8, 10)}/${ukDay(e.deviceAt).slice(5, 7)} ` : ''}${ukClock(e.deviceAt)}`, late, head: `${ISSUE_TYPE_LABEL[e.type]} · ${IMPACT_LABEL[e.impact]}${who ? ` · ${who}` : ''}`, place: e.schoolName ? `${e.schoolName}${e.visitLabel ? ` · ${e.visitLabel}` : ''}` : 'Not at a visit', note: e.note, by: e.authorName, recordings: e.recordings, link: e.link };
  };
  const total = items.length;
  const subject = total ? `Problems logged ${longDay}: ${total}${counts.unusable ? ` (${counts.unusable} data unusable)` : ''}` : `Problems logged ${longDay}: none`;

  const text: string[] = [`Problems logged on ${longDay}`, '', total ? `${total} in all: ${counts.unusable} data unusable, ${counts['may-affect']} may affect data, ${counts.minor} minor.` : 'Nothing was logged today.', ''];
  const textItem = (l: ReturnType<typeof line>, withPlace: boolean) => {
    text.push(`${l.time}  ${l.head}${l.late ? '  [logged earlier, arrived today]' : ''}`);
    if (withPlace) text.push(`       ${l.place}`);
    if (l.note) text.push(`       ${l.note.replace(/\n/g, '\n       ')}`);
    if (l.recordings.length) text.push(`       Recordings: ${l.recordings.join(', ')}`);
    text.push(`       ${l.by} · ${l.link}`, '');
  };
  if (unusable.length) {
    text.push(`*** DATA UNUSABLE (${unusable.length}) ***`, '');
    for (const x of unusable) textItem(line(x), true);
  }
  for (const g of ordered) {
    text.push(`== ${g.title} ==`, '');
    for (const x of g.items) textItem(line(x), false);
  }
  text.push(input.openEarlier ? `Still open from earlier days: ${input.openEarlier}. ${input.notebookLink}` : 'Nothing is still open from earlier days.', '', 'Data problems only. A worry about a child’s safety or welfare goes through the safeguarding procedure to the lead, not this log.');

  const htmlItem = (l: ReturnType<typeof line>, withPlace: boolean, hot: boolean) =>
    `<tr><td style="padding:8px 10px;vertical-align:top;white-space:nowrap;font-weight:700;${hot ? 'color:#bb1e50;' : ''}">${esc(l.time)}</td><td style="padding:8px 10px;vertical-align:top;${hot ? 'background:#fdecef;' : ''}"><div style="font-weight:700;">${esc(l.head)}${l.late ? ' <span style="font-weight:400;color:#4c6669;">(logged earlier, arrived today)</span>' : ''}</div>${withPlace ? `<div style="color:#4c6669;">${esc(l.place)}</div>` : ''}${l.note ? `<div style="margin-top:4px;white-space:pre-wrap;">${esc(l.note)}</div>` : ''}${l.recordings.length ? `<div style="color:#4c6669;">Recordings: ${esc(l.recordings.join(', '))}</div>` : ''}<div style="color:#4c6669;margin-top:4px;">${esc(l.by)} · <a href="${esc(l.link)}">open in the portal</a></div></td></tr>`;
  const html: string[] = [
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#113b3f;max-width:680px;">`,
    `<h1 style="font-size:20px;margin:0 0 8px;">Problems logged on ${esc(longDay)}</h1>`,
    total ? `<p style="margin:0 0 16px;"><strong style="color:#bb1e50;">${counts.unusable} data unusable</strong> · ${counts['may-affect']} may affect data · ${counts.minor} minor (${total} in all)</p>` : '<p>Nothing was logged today.</p>',
  ];
  if (unusable.length) html.push(`<h2 style="font-size:16px;color:#bb1e50;margin:16px 0 4px;">Data unusable (${unusable.length})</h2><table style="border-collapse:collapse;width:100%;border-left:4px solid #bb1e50;">${unusable.map((x) => htmlItem(line(x), true, true)).join('')}</table>`);
  for (const g of ordered) html.push(`<h2 style="font-size:16px;margin:16px 0 4px;">${esc(g.title)}</h2><table style="border-collapse:collapse;width:100%;">${g.items.map((x) => htmlItem(line(x), false, false)).join('')}</table>`);
  html.push(`<p style="margin-top:20px;">${input.openEarlier ? `Still open from earlier days: <strong>${input.openEarlier}</strong>. <a href="${esc(input.notebookLink)}">Open the notebook</a>.` : 'Nothing is still open from earlier days.'}</p>`, '<p style="color:#4c6669;font-size:13px;">Data problems only. A worry about a child’s safety or welfare goes through the safeguarding procedure to the lead, not this log.</p></div>');
  return { subject, text: text.join('\n'), html: html.join(''), counts, entries: total };
}

export interface DigestSettings {
  to: string[];
  sendEmpty: boolean;
}
export const DEFAULT_DIGEST: DigestSettings = { to: ['brainpop@leeds.ac.uk', 'f.mushtaq@leeds.ac.uk'], sendEmpty: false };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function digestSettingsOf(v: unknown): DigestSettings {
  const o = (v ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const to = Array.isArray(o.to) ? o.to.map((e) => String(e).trim()).filter((e) => EMAIL.test(e) && !seen.has(e.toLowerCase()) && seen.add(e.toLowerCase())).slice(0, 10) : DEFAULT_DIGEST.to;
  return { to: Array.isArray(o.to) ? to : DEFAULT_DIGEST.to, sendEmpty: o.sendEmpty === true };
}

/** The portal actions (portalCore.ts). Logging, the list, editing and comments: every active user (the rules above decide which entries). */
export const ISSUE_SELF_ACTIONS = ['issue-context', 'issue-pupils', 'issue-log', 'issue-list', 'issue-edit', 'issue-comment'];
export const ISSUE_TEAM_ACTIONS = ['issue-status', 'issue-resolve-pupil'];
export const ISSUE_PM_ACTIONS = ['issue-digest-settings', 'issue-save-digest', 'issue-digest-now'];
