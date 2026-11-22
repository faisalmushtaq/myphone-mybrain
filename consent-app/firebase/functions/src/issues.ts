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
/** Open and "Action taken" are still to finish; Cleared, Handled in analysis and Not relevant are done (22 November 2026: Action taken and Cleared added). */
export const ISSUE_STATUSES = ['open', 'actioned', 'cleared', 'handled', 'not-relevant'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const STATUS_LABEL: Record<IssueStatus, string> = { open: 'Open', actioned: 'Action taken', cleared: 'Cleared', handled: 'Handled in analysis', 'not-relevant': 'Not relevant' };
export const isDone = (s: IssueStatus) => s === 'cleared' || s === 'handled' || s === 'not-relevant';

/* ── Equipment (22 November 2026) ─────────────────────────────────────── */

/**
 * Faults with a headset, laptop or iPad, logged like any other problem but
 * against the device, so everyone can see what is already known about it
 * before they log it again. Replaces the headset spreadsheet (headset_list,
 * 14 November 2026: code, old or new, the issue in words, low/medium/high).
 */
export const DEVICE_KINDS = ['headset', 'laptop', 'ipad', 'other'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
export const DEVICE_KIND_LABEL: Record<DeviceKind, string> = { headset: 'EEG headset', laptop: 'Laptop', ipad: 'iPad/tablet', other: 'Other equipment' };
/** What can go wrong, by kind of device: the headset list's own words, as chips. */
export const FAULTS: { key: string; label: string; kinds: readonly DeviceKind[] }[] = [
  { key: 'no-signal', label: 'No EEG signal (all grey)', kinds: ['headset'] },
  { key: 'left-grey', label: 'Left side grey', kinds: ['headset'] },
  { key: 'right-grey', label: 'Right side grey', kinds: ['headset'] },
  { key: 'channels', label: 'Particular channels', kinds: ['headset'] },
  { key: 'poor-signal', label: 'Poor or patchy signal', kinds: ['headset'] },
  { key: 'not-registering', label: 'Green but not registering', kinds: ['headset'] },
  { key: 'motion-only', label: 'Motion works, EEG doesn’t', kinds: ['headset'] },
  { key: 'contact', label: 'Contact quality', kinds: ['headset'] },
  { key: 'bluetooth', label: 'Bluetooth: won’t connect', kinds: ['headset', 'laptop', 'ipad', 'other'] },
  { key: 'disconnects', label: 'Disconnects mid-task', kinds: ['headset', 'laptop', 'ipad', 'other'] },
  { key: 'battery', label: 'Battery or charging', kinds: ['headset', 'laptop', 'ipad', 'other'] },
  { key: 'wont-start', label: 'Won’t turn on', kinds: ['laptop', 'ipad', 'other'] },
  { key: 'crash', label: 'App or task crashed', kinds: ['laptop', 'ipad'] },
  { key: 'screen', label: 'Screen, touch or keyboard', kinds: ['laptop', 'ipad'] },
  { key: 'network', label: 'Wi-Fi or network', kinds: ['laptop', 'ipad'] },
  { key: 'damage', label: 'Physical damage', kinds: ['headset', 'laptop', 'ipad', 'other'] },
  { key: 'other', label: 'Something else', kinds: ['headset', 'laptop', 'ipad', 'other'] },
];
export const FAULT_LABEL: Record<string, string> = Object.fromEntries(FAULTS.map((f) => [f.key, f.label]));
/** The 14 sensors of the EPOC headsets, left to right. */
export const CHANNELS = ['AF3', 'F7', 'F3', 'FC5', 'T7', 'P7', 'O1', 'O2', 'P8', 'T8', 'FC6', 'F4', 'F8', 'AF4'] as const;
/** How bad the fault is for the device (the headset list's "level of issue"); separate from what it did to the data. */
export const SEVERITIES = ['low', 'medium', 'high'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABEL: Record<Severity, string> = { low: 'Low', medium: 'Medium', high: 'High' };
export const DEVICE_STATUSES = ['ok', 'care', 'out', 'repair', 'retired'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];
export const DEVICE_STATUS_LABEL: Record<DeviceStatus, string> = { ok: 'In use', care: 'Use with care', out: 'Out of service', repair: 'Away for repair', retired: 'Retired' };

export interface DeviceRef {
  kind: DeviceKind;
  code: string;
}
/** A device in the register (portalEquipment/{code}). */
export interface Device {
  /** The unique id: as on its label (the headsets' serial-like code, or "LT-01"). */
  code: string;
  /** A unique name the team calls it by ("Laptop 3", "Blue iPad"); optional. */
  name: string;
  model: string;
  serial: string;
  /** Where it is kept, or who has it. */
  location: string;
  kind: DeviceKind;
  /** "old" or "new" batch for the headsets; free text otherwise. */
  batch: string;
  status: DeviceStatus;
  notes: string;
  history: Change[];
}
/** A device code as typed: capitals, spaces to hyphens ("e502033e" -> "E502033E"). */
export const deviceCode = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase().replace(/\s+/g, '-').slice(0, 40) : '');
export const DEVICE_CODE = /^[A-Z0-9][A-Z0-9-]{1,39}$/;

export type DeviceFields = Pick<Device, 'code' | 'name' | 'model' | 'serial' | 'location' | 'kind' | 'batch' | 'status' | 'notes'>;
/** Names are unique whatever the case or spacing: "laptop  3" is "Laptop 3". */
export const nameKey = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ');
export function deviceInput(raw: Record<string, unknown>): { ok: true; value: DeviceFields } | { ok: false; problem: string } {
  const code = deviceCode(raw.code);
  if (!DEVICE_CODE.test(code)) return { ok: false, problem: 'Give the device’s code (letters and numbers, as on its label).' };
  const kind = DEVICE_KINDS.includes(raw.kind as DeviceKind) ? (raw.kind as DeviceKind) : null;
  if (!kind) return { ok: false, problem: 'Choose what kind of device it is.' };
  const status = DEVICE_STATUSES.includes(raw.status as DeviceStatus) ? (raw.status as DeviceStatus) : 'ok';
  return { ok: true, value: { code, name: clip(raw.name, 60).replace(/\s+/g, ' '), model: clip(raw.model, 80), serial: clip(raw.serial, 80), location: clip(raw.location, 120), kind, batch: clip(raw.batch, 40), status, notes: clip(raw.notes, 2000) } };
}

/** "One device a line": code, name, kind, model, serial, where kept (commas or tabs, as pasted from a spreadsheet). The kind may be left out for the one chosen. */
export function bulkDevices(text: string, defaultKind: DeviceKind): { devices: DeviceFields[]; problems: string[] } {
  const devices: DeviceFields[] = [];
  const problems: string[] = [];
  const kinds = new Map<string, DeviceKind>([...DEVICE_KINDS.map((k) => [k, k] as const), ...Object.entries(DEVICE_KIND_LABEL).map(([k, l]) => [l.toLowerCase(), k as DeviceKind] as const), ['eeg', 'headset'], ['tablet', 'ipad'], ['ipad', 'ipad']]);
  text.split(/\r?\n/).forEach((line, n) => {
    if (!line.trim()) return;
    const cells = line.split(/\t|,/).map((c) => c.trim());
    if (n === 0 && /^code$/i.test(cells[0])) return;
    const kind = cells[2] ? kinds.get(cells[2].toLowerCase()) : defaultKind;
    if (!kind) return void problems.push(`Line ${n + 1}: “${cells[2]}” is not a kind of device (headset, laptop, iPad, other).`);
    const r = deviceInput({ code: cells[0], name: cells[1] ?? '', kind, model: cells[3] ?? '', serial: cells[4] ?? '', location: cells[5] ?? '' });
    if (!r.ok) return void problems.push(`Line ${n + 1}: ${r.problem}`);
    if (devices.some((d) => d.code === r.value.code)) return void problems.push(`Line ${n + 1}: ${r.value.code} is in the list twice.`);
    if (r.value.name && devices.some((d) => d.name && nameKey(d.name) === nameKey(r.value.name))) return void problems.push(`Line ${n + 1}: the name “${r.value.name}” is in the list twice.`);
    devices.push(r.value);
  });
  return { devices: devices.slice(0, 200), problems };
}

/** What logging a fault does to the device's status: a high fault takes it out of service; any fault on a device in use makes it "use with care". Never brings one back. */
export function statusAfterFault(now: DeviceStatus, severity: Severity | null): DeviceStatus {
  if (now === 'repair' || now === 'retired' || now === 'out') return now;
  if (severity === 'high') return 'out';
  return 'care';
}

/** What the register shows a device: its open faults (not yet marked fixed), the worst of them, and when it was last reported. */
export function deviceSummary(code: string, issues: Pick<Issue, 'id' | 'device' | 'faults' | 'channels' | 'severity' | 'fixedAt' | 'deviceAt'>[]) {
  const mine = issues.filter((i) => i.device?.code === code).sort((a, b) => b.deviceAt.localeCompare(a.deviceAt));
  const open = mine.filter((i) => !i.fixedAt);
  const rank = (s: Severity | null) => (s ? SEVERITIES.indexOf(s) : -1);
  const worst = open.reduce<Severity | null>((w, i) => (rank(i.severity) > rank(w) ? i.severity : w), null);
  const faults = [...new Set(open.flatMap((i) => i.faults))];
  const channels = [...new Set(open.flatMap((i) => i.channels))].sort((a, b) => CHANNELS.indexOf(a as (typeof CHANNELS)[number]) - CHANNELS.indexOf(b as (typeof CHANNELS)[number]));
  return { open: open.map((i) => i.id), all: mine.length, worst, faults, channels, lastReported: mine[0]?.deviceAt ?? null };
}

/** Who or what an entry is about: a young person with a study ID, a name an assistant typed (resolved later), or the whole room. */
export type About = { kind: 'person'; studyId: string } | { kind: 'typed'; name: string; studyId: string | null } | { kind: 'room' };

export interface Comment {
  id: string;
  at: string;
  by: string;
  byName: string;
  text: string;
}
/** Something the team did about an entry ("Swapped the felts", "Emailed the school"), kept in order. */
export interface Action {
  id: string;
  at: string;
  by: string;
  byName: string;
  text: string;
  /** The status it moved the entry to, if any. */
  status: IssueStatus | null;
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
  /** The headset, laptop or iPad at fault, if any (22 November 2026). */
  device: DeviceRef | null;
  faults: string[];
  channels: string[];
  severity: Severity | null;
  /** When the device fault was marked fixed (the register), and by whom. */
  fixedAt: string | null;
  fixedBy: string;
  /** An entry brought in from an earlier record (the headset list), not logged in the portal. */
  importedFrom: string;
  status: IssueStatus;
  resolution: string;
  comments: Comment[];
  actions: Action[];
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

/**
 * Everyone in the team sees every entry (22 November 2026), so a fault already
 * logged is not logged again. Pupils an assistant typed stay hidden from other
 * assistants (issuesStore view()).
 */
export const canSee = (_i: Pick<Issue, 'uid'>, v: Viewer) => v.role !== null;
/** The team can always edit; an assistant their own, for 24 hours after it arrived. */
export const canEdit = (i: Pick<Issue, 'uid' | 'receivedAt'>, v: Viewer, now = Date.now()) => team(v) || (i.uid === v.uid && now - Date.parse(i.receivedAt) < OWN_EDIT_MS);
/** Comments: anyone on any entry ("seen again", "fixed it by reseating the felt"). */
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
export type IssueFields = Pick<Issue, 'id' | 'deviceAt' | 'visitId' | 'about' | 'type' | 'impact' | 'note' | 'recordings' | 'device' | 'faults' | 'channels' | 'severity'>;
export function issueInput(raw: Record<string, unknown>, v: Viewer, now = new Date()): { ok: true; value: IssueFields } | { ok: false; problem: string } {
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
  const d = (raw.device ?? null) as Record<string, unknown> | null;
  const code = d ? deviceCode(d.code) : '';
  const kind = d && DEVICE_KINDS.includes(d.kind as DeviceKind) ? (d.kind as DeviceKind) : null;
  if (d && code && !DEVICE_CODE.test(code)) return { ok: false, problem: 'The device code should be letters and numbers, as on its label.' };
  const device: DeviceRef | null = code && kind ? { kind, code } : null;
  const faults = device ? [...new Set((Array.isArray(raw.faults) ? raw.faults : []).map(String))].filter((f) => FAULTS.some((x) => x.key === f && x.kinds.includes(device.kind))) : [];
  const channels = device?.kind === 'headset' ? CHANNELS.filter((c) => (Array.isArray(raw.channels) ? raw.channels : []).map(String).includes(c)) : [];
  const severity = device && SEVERITIES.includes(raw.severity as Severity) ? (raw.severity as Severity) : null;
  if (!note && !about.length && !faults.length) return { ok: false, problem: 'Say what happened, or who it was about.' };
  const recordings = [...new Set((Array.isArray(raw.recordings) ? raw.recordings : []).map((r) => String(r).trim()).filter((r) => REC.test(r)))].slice(0, 40);
  const visitId = typeof raw.visitId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(raw.visitId) ? raw.visitId : null;
  void v;
  return { ok: true, value: { id, deviceAt: new Date(t).toISOString(), visitId, about: dedupeAbout(about), type, impact, note, recordings, device, faults, channels, severity } };
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
export const ISSUE_COLUMNS = ['issue_id', 'logged_at', 'logged_day', 'received_at', 'school_id', 'visit_id', 'participant_ids', 'whole_room', 'unresolved_pupils', 'recording_ids', 'type', 'impact', 'status', 'resolution', 'actions', 'note', 'device_kind', 'device_code', 'faults', 'channels', 'severity', 'fixed_at', 'imported_from'];
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
      actions: i.actions.map((a) => `${ukDay(a.at)}: ${a.text}`).join(' | ') || null,
      note: i.note || null,
      device_kind: i.device?.kind ?? null,
      device_code: i.device?.code ?? null,
      faults: i.faults.join(',') || null,
      channels: i.channels.join(',') || null,
      severity: i.severity,
      fixed_at: i.fixedAt,
      imported_from: i.importedFrom || null,
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
    actions: { Description: 'What the team did about it, in order: "day: action", separated by " | ".' },
    note: { Description: 'What happened, as the person wrote it.' },
    device_kind: { Description: 'The kind of device at fault, if any', Levels: DEVICE_KIND_LABEL },
    device_code: { Description: 'The device at fault (its code, as on its label; the EEG headsets’ serial).' },
    faults: { Description: 'What was wrong with the device, comma-separated', Levels: FAULT_LABEL },
    channels: { Description: 'The headset sensors affected (EPOC 14-channel montage).' },
    severity: { Description: 'How bad the fault was for the device (not the data)', Levels: SEVERITY_LABEL },
    fixed_at: { Description: 'When the device fault was marked fixed in the portal’s equipment register.' },
    imported_from: { Description: 'Brought in from an earlier record rather than logged in the portal (e.g. the headset list of 14 November 2026).' },
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
    return { time: `${late ? `${ukDay(e.deviceAt).slice(8, 10)}/${ukDay(e.deviceAt).slice(5, 7)} ` : ''}${ukClock(e.deviceAt)}`, late, head: `${ISSUE_TYPE_LABEL[e.type]} · ${IMPACT_LABEL[e.impact]}${e.device ? ` · ${e.device.code}${e.faults.length ? ` (${e.faults.map((f) => (f === 'channels' && e.channels.length ? e.channels.join(', ') : FAULT_LABEL[f] ?? f).toLowerCase()).join('; ')})` : ''}` : ''}${who ? ` · ${who}` : ''}`, place: e.schoolName ? `${e.schoolName}${e.visitLabel ? ` · ${e.visitLabel}` : ''}` : 'Not at a visit', note: e.note, by: e.authorName, recordings: e.recordings, link: e.link };
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
export const ISSUE_SELF_ACTIONS = ['issue-context', 'issue-pupils', 'issue-log', 'issue-list', 'issue-edit', 'issue-comment', 'issue-equipment'];
/** The register: adding a device, its status and notes, marking faults fixed. */
export const ISSUE_TEAM_ACTIONS = ['issue-status', 'issue-action', 'issue-resolve-pupil', 'issue-equipment-save', 'issue-equipment-bulk', 'issue-equipment-fixed'];
export const ISSUE_PM_ACTIONS = ['issue-digest-settings', 'issue-save-digest', 'issue-digest-now', 'issue-equipment-import'];

/* ── The headset list of 14 November 2026 ─────────────────────────────── */

/**
 * The spreadsheet the team kept before the portal had this (headset_list,
 * 14 November 2026), as the register's starting point: each headset, and each
 * fault as an open entry with the sheet's words kept in the note. The project
 * manager brings it in once (Equipment › Bring in the headset list); doing it
 * again changes nothing.
 */
export const HEADSET_LIST_SOURCE = 'Headset list, 14 November 2026';
export const HEADSET_LIST_AT = '2026-11-14T12:00:00.000Z';
export const HEADSET_LIST: { code: string; batch: 'old' | 'new'; issue: string; level: string; faults: string[]; channels: string[]; severity: Severity | null }[] = [
  { code: 'E502033E', batch: 'old', issue: 'eeg signal issues (all grey/one side grey), bluetooth connection issues (initial)', level: 'high', faults: ['no-signal', 'bluetooth'], channels: [], severity: 'high' },
  { code: 'E7020341', batch: 'old', issue: 'eeg signal issues (left side all grey, and whole headset)', level: 'medium', faults: ['left-grey', 'no-signal'], channels: [], severity: 'medium' },
  { code: 'E70204BB', batch: 'old', issue: 'contact and eeg signal issues (all grey but motion worked, right side all grey), bluetooth connection issues', level: 'high', faults: ['contact', 'no-signal', 'motion-only', 'right-grey', 'bluetooth'], channels: [], severity: 'high' },
  { code: 'E70205F7', batch: 'old', issue: 'bluetooth connection issues', level: 'low', faults: ['bluetooth'], channels: [], severity: 'low' },
  { code: 'E50203BF', batch: 'old', issue: 'O1 signal issues', level: 'low', faults: ['channels'], channels: ['O1'], severity: 'low' },
  { code: 'E702033A', batch: 'old', issue: 'bluetooth connection issues, contact and eeg signal issues (all grey, motion worked)', level: 'medium', faults: ['bluetooth', 'contact', 'no-signal', 'motion-only'], channels: [], severity: 'medium' },
  { code: 'E50211E8', batch: 'new', issue: 'occasionally disconnects mid-task, F3&F4 and overall eeg signal issues', level: 'low', faults: ['disconnects', 'channels', 'poor-signal'], channels: ['F3', 'F4'], severity: 'low' },
  { code: 'E50211EE', batch: 'new', issue: 'no issue', level: 'NA', faults: [], channels: [], severity: null },
  { code: 'E50211F4', batch: 'new', issue: 'P8&O1 minor signal issues', level: 'low', faults: ['channels'], channels: ['O1', 'P8'], severity: 'low' },
  { code: 'E50211F5', batch: 'new', issue: 'bluetooth connection issues, potential battery issue?, eeg signal issues (half of headset not registering)', level: 'medium/high', faults: ['bluetooth', 'battery', 'not-registering'], channels: [], severity: 'high' },
  { code: 'E5021212', batch: 'new', issue: 'contact and eeg signal issues (all grey or left side green but not registering noise), bluetooth connection issues (initial and mid-task)', level: 'high', faults: ['contact', 'no-signal', 'not-registering', 'bluetooth', 'disconnects'], channels: [], severity: 'high' },
  { code: 'E50211F6', batch: 'new', issue: 'no eeg signal (all grey) in last few sessions', level: 'medium', faults: ['no-signal'], channels: [], severity: 'medium' },
  { code: 'E50211FC', batch: 'new', issue: 'eeg signal issues (right side and whole all grey at separate points), bluetooth connection issues (initial)', level: 'medium', faults: ['right-grey', 'no-signal', 'bluetooth'], channels: [], severity: 'medium' },
  { code: 'E50211EF', batch: 'new', issue: 'bluetooth connection issues (initial), minor eeg signal quality issues, no eeg signal in last few sessions', level: 'medium', faults: ['bluetooth', 'poor-signal', 'no-signal'], channels: [], severity: 'medium' },
  { code: 'E50211F7', batch: 'new', issue: 'bluetooth connection issues (initial), P8&O2 minor signal issues', level: 'medium', faults: ['bluetooth', 'channels'], channels: ['O2', 'P8'], severity: 'medium' },
  { code: 'E50211DA', batch: 'new', issue: 'bluetooth connection issues (initial), occasional O1&O2 eeg signal issues', level: 'low', faults: ['bluetooth', 'channels'], channels: ['O1', 'O2'], severity: 'low' },
];
/** The entry id for a headset's line in the list: fixed, so bringing it in twice stores it once. */
export const headsetListEntryId = (code: string) => `import-hl261114-${code}`;
/** The device status a severity from the list starts at. */
export const statusFromList = (s: Severity | null): DeviceStatus => (s === 'high' ? 'out' : s ? 'care' : 'ok');
