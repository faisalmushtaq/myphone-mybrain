import {
  addDaysIso,
  ATTENDANCE_LABEL,
  AVAILABILITY_LABEL,
  buildReport,
  coverageByDay,
  DAY_ROLE_LABEL,
  DAY_ROLES,
  DBS_STATUS_LABEL,
  includedDays,
  LEVEL_LABEL,
  needsOn,
  SIGN_OFF_LABEL,
  weekStartOf,
  type Assignment,
  type AttendanceRecord,
  type Availability,
  type DayRole,
  type DbsStatus,
  type DocState,
  type Level,
  type Role,
  type RoleNeeds,
  type SignOff,
  type VisitDay,
  type VisitStatus,
} from './portalCore.js';

/**
 * The staff portal as a Google Sheet (5 November 2026): an overview, each
 * school's sessions and allocations laid out the way the team planned them
 * by hand, and the portal's records as plain tables. Built here as pure
 * functions from a snapshot of the records (portal.ts reads it), so the
 * layout can be tested without Google; portalSheetsSync.ts sends it.
 *
 * Never in it: DBS certificate numbers, copies of any document, email or
 * text bodies, and the team's notes on people unless the project manager
 * turns them on. The same tables are written to the export bucket's
 * staff-portal/tables/ (export.ts), with the same exclusions.
 */

/* ── What the sheet is built from ─────────────────────────────────────── */

export interface SheetPerson {
  uid: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  status: string;
  level: Level | null;
  capabilities: DayRole[];
  tags: string[];
  dbs: DbsStatus;
  /** The day they said they applied for a DBS (when they said so and gave a date). */
  dbsAppliedOn: string | null;
  dbsApplied: boolean;
  signOff: SignOff;
  signOffBy: string;
  signOffAt: string | null;
  approvals: { schoolId: string; schoolName: string; at: string | null; byName: string }[];
  training: number;
  pilots: number;
  daysAttended: number;
  /** Ready for any school today (everyone's documents, training and pilots). */
  ready: boolean;
  reasons: string[];
  /** Why not, for each school's own visits (its forms and approval too); empty when ready. */
  reasonsBySchool: Record<string, string[]>;
  joined: string | null;
}

export interface SheetDocument {
  uid: string;
  person: string;
  document: string;
  school: string;
  state: DocState;
  uploadedOn: string;
  checkedOn: string;
  checkedBy: string;
  validUntil: string;
  issueDate: string;
  updateService: boolean | null;
  hasCopy: boolean;
}

export interface SheetSchool {
  id: string;
  name: string;
  short: string;
  requireApproval: boolean;
  requiredDocs: string[];
}

export interface SheetPlace extends Assignment {
  offeredAt: string | null;
  respondedAt: string | null;
}

export interface SheetVisit {
  visitId: string;
  schoolId: string;
  schoolName: string;
  status: VisitStatus;
  location: string;
  days: VisitDay[];
  roleNeeds: RoleNeeds;
  assignments: SheetPlace[];
}

export interface SheetData {
  /** When the snapshot was taken (ISO). */
  syncedAt: string;
  today: string;
  portalUrl: string;
  people: SheetPerson[];
  documents: SheetDocument[];
  schools: SheetSchool[];
  visits: SheetVisit[];
  availability: { uid: string; date: string; value: Availability; note: string }[];
  attendance: AttendanceRecord[];
  sessions: { id: string; kind: 'training' | 'pilot'; date: string; title: string; role: DayRole | null; attendees: string[] }[];
  claims: { uid: string; kind: 'training' | 'pilot'; date: string; title: string; status: string }[];
  mail: { at: string | null; channel: string; kind: string; to: string; subject: string; outcome: string }[];
  audit: { at: string | null; by: string; action: string; target: string; details: unknown }[];
  /** Only when the project manager has turned team notes on. */
  notes: { uid: string; at: string | null; byName: string; text: string }[] | null;
  /** The linkage registry's counts (linkageStore.ts summaryOf): no names, no IDs. */
  linkage?: LinkageCounts | null;
  /** The issue log (issues.ts issueRows, identifying version): study IDs, never pupils' names. */
  issues?: Record<string, string | number | null>[] | null;
}

/** The Issues tab: every entry in the issue log, newest first. Study IDs and recording ids; the names an assistant typed are left out. */
export function issuesTable(rows: Record<string, string | number | null>[]): Table {
  const cols: [string, string][] = [['logged_at', 'Logged (UK)'], ['logged_day', 'Day'], ['school_id', 'School'], ['visit_id', 'Visit'], ['type', 'Type'], ['impact', 'Impact'], ['participant_ids', 'Study IDs'], ['whole_room', 'Whole room'], ['unresolved_pupils', 'Pupils to resolve'], ['recording_ids', 'Recordings'], ['note', 'Note'], ['status', 'Status'], ['resolution', 'Resolution'], ['author_name', 'Logged by'], ['received_at', 'Received (UK)'], ['issue_id', 'Entry']];
  return {
    name: 'Issues',
    file: 'issues',
    describe: 'The issue log (portal, Notebook): data problems the team logged, with the time on the logging device, the study IDs and recordings affected, and where each stands. Pupils’ names are not included.',
    header: cols.map(([, h]) => h),
    rows: [...rows].sort((a, b) => String(b.logged_at).localeCompare(String(a.logged_at))).map((r) => cols.map(([k]) => (k === 'logged_at' || k === 'received_at' ? ukStamp(r[k] ? String(r[k]) : null) : (r[k] ?? '')) as string | number)),
  };
}

export interface LinkageCounts {
  people: number;
  active: number;
  withdrawn: number;
  pending: number;
  multiSource: number;
  lastRunAt: string | null;
  sources: Record<'website' | 'myself' | 'eeg', { total: number; linked: number; awaiting: number; unlinked: number }>;
  perSchool: { school: string; people: number; website: number; myself: number; eeg: number; allThree: number }[];
}

/** The Linkage tab: how many young people have a study ID, school by school, and what is waiting. Counts only. */
export function linkageTable(l: LinkageCounts): Table {
  const rows: (string | number)[][] = l.perSchool.map((s) => [s.school, s.people, s.website, s.myself, s.eeg, s.allThree]);
  const sum = (k: 'people' | 'website' | 'myself' | 'eeg' | 'allThree') => l.perSchool.reduce((n, s) => n + s[k], 0);
  rows.push(['All schools', sum('people'), sum('website'), sum('myself'), sum('eeg'), sum('allThree')]);
  rows.push(['', '', '', '', '', '']);
  rows.push(['Source', 'Records', 'With a study ID', 'Waiting for review', 'No study ID yet', '']);
  const label = { website: 'Website', myself: 'MySelf', eeg: 'EEG' } as const;
  for (const k of ['website', 'myself', 'eeg'] as const) rows.push([label[k], l.sources[k].total, l.sources[k].linked, l.sources[k].awaiting, l.sources[k].unlinked, '']);
  rows.push(['', '', '', '', '', '']);
  rows.push(['Withdrawn (left out of the dataset)', l.withdrawn, '', '', '', '']);
  rows.push(['Suggestions waiting for a person', l.pending, '', '', '', '']);
  rows.push(['Last matching run', l.lastRunAt ? ukStamp(l.lastRunAt) : 'not yet', '', '', '', '']);
  return {
    name: 'Linkage',
    file: 'linkage',
    describe: 'The linkage registry (portal, Linkage tab): young people with a study ID, school by school, and which sources each has; then each source’s records and what is waiting for review. Counts only: no names or IDs.',
    header: ['School', 'Study IDs', 'With website', 'With MySelf', 'With EEG', 'All three'],
    rows,
  };
}

/* ── What a tab is ────────────────────────────────────────────────────── */

export interface CellX {
  v: string | number | null;
  bold?: boolean;
  italic?: boolean;
  /** Text colour, #rrggbb. */
  fg?: string;
  /** Fill, #rrggbb. */
  bg?: string;
  note?: string;
  link?: string;
  size?: number;
  align?: 'LEFT' | 'CENTER' | 'RIGHT';
  wrap?: boolean;
}
export type Cell = string | number | null | CellX;

export interface Tab {
  title: string;
  rows: Cell[][];
  frozenRows: number;
  frozenCols: number;
  /** Column widths in pixels, from the first column. */
  widths: number[];
  merges: { row: number; col: number; rows: number; cols: number }[];
  /** Alternate row colours below a header row (the plain tables). */
  banded: boolean;
}

/** The site's colours. */
export const PALETTE = {
  deep: '#003f46',
  teal: '#006b73',
  ink: '#113b3f',
  mist: '#d9eef4',
  line: '#c8ddda',
  paper: '#fbf8ee',
  band: '#f2f8f7',
  white: '#ffffff',
  red: '#bb1e50',
  redBg: '#fde3ea',
  green: '#1f8a5b',
  greenBg: '#eaf5ef',
  confirmed: '#00545b',
  offered: '#f5a300',
  available: '#cfeedd',
  maybe: '#fff3c4',
  cannot: '#e3e6e6',
  muted: '#6b7f81',
} as const;

const cellOf = (c: Cell): CellX => (c !== null && typeof c === 'object' ? c : { v: c });
const header = (labels: string[]): CellX[] => labels.map((v) => ({ v, bold: true, fg: PALETTE.white, bg: PALETTE.deep, wrap: true }));
const section = (v: string): CellX => ({ v, bold: true, size: 12, fg: PALETTE.deep });
const yes = (b: boolean | null | undefined) => (b === null || b === undefined ? '' : b ? 'Yes' : 'No');

/* ── Dates, as the team writes them ───────────────────────────────────── */

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const DAY_YEAR = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** "Mon 10 Nov". */
export const shortDate = (iso: string) => DAY.format(new Date(`${iso}T00:00:00Z`)).replace(',', '');
const longDate = (iso: string) => DAY_YEAR.format(new Date(`${iso}T00:00:00Z`)).replace(',', '');
/** An instant in UK time, "3 Nov 2026 14:05". */
export function ukStamp(isoInstant: string | null): string {
  if (!isoInstant) return '';
  const d = new Date(isoInstant);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(',', '');
}
const dayOnly = (isoInstant: string | null) => (isoInstant ? isoInstant.slice(0, 10) : '');

/* ── Shared reckoning ─────────────────────────────────────────────────── */

const JOB_SHORT: Record<DayRole, string> = { eeg: 'EEG', copro: 'Co-pro', lead: 'Lead' };
const JOB_PLURAL: Record<DayRole, string> = { eeg: 'EEG', copro: 'Co-pro', lead: 'Leads' };
const FREE = new Set<Availability>(['all', 'am', 'pm']);
const live = (v: SheetVisit) => v.status !== 'cancelled';
const holds = (a: Assignment) => a.status === 'offered' || a.status === 'confirmed';
const STAFFED = new Set<VisitStatus>(['staffing', 'locked', 'draft']);

/** One school's visit days, with what each job needs and has, adding up visits on the same day. */
export interface SchoolDay {
  date: string;
  start: string;
  end: string;
  visitIds: string[];
  status: VisitStatus;
  need: RoleNeeds;
  confirmed: RoleNeeds;
  offered: RoleNeeds;
  places: { uid: string; role: DayRole; status: 'offered' | 'confirmed'; visitId: string; offeredAt: string | null }[];
}

export function schoolDays(visits: SheetVisit[], schoolId: string | null, from: string, to: string): SchoolDay[] {
  const out = new Map<string, SchoolDay>();
  for (const v of visits.filter((x) => live(x) && (schoolId === null || x.schoolId === schoolId))) {
    for (const d of includedDays(v.days)) {
      if (d.date < from || d.date > to) continue;
      const key = schoolId === null ? `${d.date}|${v.schoolId}` : d.date;
      const need = needsOn(d, v.roleNeeds);
      const had = out.get(key) ?? { date: d.date, start: d.start, end: d.end, visitIds: [], status: v.status, need: { eeg: 0, copro: 0, lead: 0 }, confirmed: { eeg: 0, copro: 0, lead: 0 }, offered: { eeg: 0, copro: 0, lead: 0 }, places: [] };
      had.visitIds.push(v.visitId);
      if (d.start < had.start) had.start = d.start;
      if (d.end > had.end) had.end = d.end;
      for (const r of DAY_ROLES) had.need[r] += need[r];
      for (const a of v.assignments) {
        if (!holds(a) || !a.dates.includes(d.date)) continue;
        had[a.status as 'offered' | 'confirmed'][a.role] += 1;
        had.places.push({ uid: a.uid, role: a.role, status: a.status as 'offered' | 'confirmed', visitId: v.visitId, offeredAt: a.offeredAt });
      }
      out.set(key, had);
    }
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** How many more confirmed people each job needs on a day. */
export const shortOf = (d: Pick<SchoolDay, 'need' | 'confirmed'>): RoleNeeds => ({ eeg: Math.max(0, d.need.eeg - d.confirmed.eeg), copro: Math.max(0, d.need.copro - d.confirmed.copro), lead: Math.max(0, d.need.lead - d.confirmed.lead) });
const shortTotal = (d: Pick<SchoolDay, 'need' | 'confirmed'>) => DAY_ROLES.reduce((n, r) => n + shortOf(d)[r], 0);
/** "Short: EEG 1, Leads 2", or "Fully staffed". */
export function staffingLine(d: Pick<SchoolDay, 'need' | 'confirmed'>): string {
  const s = shortOf(d);
  const parts = DAY_ROLES.filter((r) => s[r] > 0).map((r) => `${JOB_PLURAL[r]} ${s[r]}`);
  return parts.length ? `Short: ${parts.join(', ')}` : 'Fully staffed';
}
const ratio = (confirmed: number, need: number) => `${confirmed}/${need}`;

/** The window the school tabs cover: four weeks back, twelve ahead. */
export const windowOf = (today: string) => ({ from: addDaysIso(today, -28), to: addDaysIso(today, 84) });

/** Why someone is not ready for a school's visits (empty when they are). */
const notReadyFor = (p: SheetPerson, schoolId: string) => p.reasonsBySchool[schoolId] ?? p.reasons;
const approvedBy = (p: SheetPerson, schoolId: string) => p.approvals.find((a) => a.schoolId === schoolId) ?? null;
const jobsOf = (p: SheetPerson) => (p.role === 'ra' ? p.capabilities.filter((r) => r !== 'lead').map((r) => JOB_SHORT[r]).join(', ') : 'Lead');
const levelText = (p: SheetPerson) => (p.level ? `${p.level} ${LEVEL_LABEL[p.level]}` : '');
const activeRas = (d: SheetData) => d.people.filter((p) => p.status === 'active' && p.role === 'ra').sort((a, b) => a.name.localeCompare(b.name));
const activeLeads = (d: SheetData) => d.people.filter((p) => p.status === 'active' && p.role !== 'ra').sort((a, b) => a.name.localeCompare(b.name));
const nameOf = (d: SheetData, uid: string) => d.people.find((p) => p.uid === uid)?.name || uid;

/** A short name for a school, for tab titles: its id when short, else its initials. */
export function schoolShort(s: { id: string; name: string }): string {
  if (s.id.length <= 8) return s.id;
  const initials = s.name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join('');
  return initials || s.name.slice(0, 12);
}

/* ── 1. Overview ──────────────────────────────────────────────────────── */

export function overviewTab(d: SheetData): Tab {
  const rows: Cell[][] = [];
  const merges: Tab['merges'] = [];
  const W = 9;
  const title = (v: Cell) => {
    rows.push([v]);
    merges.push({ row: rows.length - 1, col: 0, rows: 1, cols: W });
  };
  title({ v: 'MyPhone/MyBrain staff portal', bold: true, size: 16, fg: PALETTE.deep });
  title({ v: `Last synced ${ukStamp(d.syncedAt)} (UK time). This sheet is rewritten every hour from the portal: change things in the portal, not here.`, fg: PALETTE.muted });
  title({ v: 'Open the portal', link: d.portalUrl, fg: PALETTE.teal, bold: true });
  rows.push([]);

  const ras = activeRas(d);
  const until = addDaysIso(d.today, 41);
  const days = schoolDays(d.visits, null, d.today, until);
  const schoolName = (id: string) => d.schools.find((s) => s.id === id)?.name ?? id;
  const dayVisits = (sd: SchoolDay) => d.visits.find((v) => sd.visitIds.includes(v.visitId))!;
  const waitingDocs = d.documents.filter((x) => x.state === 'uploaded').length;
  const openOffers = d.visits.flatMap((v) => (live(v) ? v.assignments.filter((a) => a.status === 'offered') : []));
  title(section('At a glance'));
  const glance: [string, number][] = [
    ['Research assistants (active)', ras.length],
    ['Ready to book today', ras.filter((p) => p.ready).length],
    ['DBS confirmed (research assistants)', ras.filter((p) => p.dbs === 'confirmed').length],
    ['Research leads (the team)', activeLeads(d).length],
    ['Visit days in the next 6 weeks', days.length],
    ['Days short of people', days.filter((x) => STAFFED.has(x.status) && shortTotal(x) > 0).length],
    ['Offers waiting for an answer', openOffers.length],
    ['Documents waiting to be checked', waitingDocs],
  ];
  for (const [label, n] of glance) rows.push([label, { v: n, bold: true, align: 'RIGHT' }]);
  rows.push([]);

  title(section('Coming up: the next 6 weeks'));
  rows.push(header(['Date', 'School', 'Times', 'Status', 'EEG', 'Co-pro', 'Leads', 'Offered', 'Short by']));
  if (!days.length) rows.push([{ v: 'No visit days in the next 6 weeks.', fg: PALETTE.muted }]);
  for (const sd of days) {
    const v = dayVisits(sd);
    const short = shortTotal(sd);
    const offered = DAY_ROLES.reduce((n, r) => n + sd.offered[r], 0);
    const job = (r: DayRole) => ({ v: ratio(sd.confirmed[r], sd.need[r]), align: 'CENTER' as const, ...(sd.confirmed[r] < sd.need[r] ? { fg: PALETTE.red } : {}) });
    rows.push([
      shortDate(sd.date),
      schoolName(v.schoolId),
      `${sd.start}–${sd.end}`,
      sd.status,
      job('eeg'),
      job('copro'),
      job('lead'),
      { v: offered, align: 'CENTER' },
      short > 0 ? { v: short, bold: true, fg: PALETTE.white, bg: PALETTE.red, align: 'CENTER', note: staffingLine(sd) } : { v: 0, bold: true, fg: PALETTE.white, bg: PALETTE.green, align: 'CENTER', note: 'Fully staffed' },
    ]);
  }
  rows.push([]);

  title(section('Needs attention'));
  const alerts = overviewAlerts(d);
  if (!alerts.length) rows.push([{ v: 'Nothing needs attention.', fg: PALETTE.green }]);
  for (const a of alerts) {
    rows.push([{ v: a.kind, bold: true, fg: PALETTE.red }, a.text]);
    merges.push({ row: rows.length - 1, col: 1, rows: 1, cols: W - 1 });
  }
  return { title: 'Overview', rows, frozenRows: 0, frozenCols: 0, widths: [250, 200, 110, 90, 70, 70, 70, 70, 80], merges, banded: false };
}

export interface Alert {
  kind: 'Short' | 'No answer' | 'DBS' | 'Attendance';
  text: string;
}

/** What the overview flags: days short, offers unanswered over two days, people booked whose DBS is not confirmed, past days not marked. */
export function overviewAlerts(d: SheetData): Alert[] {
  const out: Alert[] = [];
  const schoolName = (id: string) => d.schools.find((s) => s.id === id)?.name ?? id;
  const until = addDaysIso(d.today, 41);
  for (const v of d.visits.filter(live)) {
    for (const day of includedDays(v.days)) {
      if (day.date < d.today || day.date > until || !STAFFED.has(v.status)) continue;
      const confirmed = { eeg: 0, copro: 0, lead: 0 };
      for (const a of v.assignments) if (a.status === 'confirmed' && a.dates.includes(day.date)) confirmed[a.role] += 1;
      const need = needsOn(day, v.roleNeeds);
      if (shortTotal({ need, confirmed }) > 0) out.push({ kind: 'Short', text: `${shortDate(day.date)}, ${schoolName(v.schoolId)}: ${staffingLine({ need, confirmed }).replace('Short: ', 'short of ')}` });
    }
  }
  const twoDaysAgo = new Date(Date.parse(d.syncedAt) - 2 * 24 * 3600 * 1000).toISOString();
  for (const v of d.visits.filter(live)) {
    for (const a of v.assignments) {
      if (a.status !== 'offered' || !a.offeredAt || a.offeredAt > twoDaysAgo) continue;
      out.push({ kind: 'No answer', text: `${nameOf(d, a.uid)}: offered ${schoolName(v.schoolId)} (${DAY_ROLE_LABEL[a.role]}) on ${ukStamp(a.offeredAt)}, no answer yet` });
    }
  }
  for (const v of d.visits.filter(live)) {
    const last = includedDays(v.days).at(-1)?.date ?? '';
    if (last < d.today) continue;
    for (const a of v.assignments) {
      if (!holds(a)) continue;
      const p = d.people.find((x) => x.uid === a.uid);
      if (!p || p.dbs === 'confirmed') continue;
      out.push({ kind: 'DBS', text: `${p.name} is ${a.status === 'confirmed' ? 'booked' : 'offered'} for ${schoolName(v.schoolId)} (${a.dates.filter((x) => x >= d.today).map(shortDate).join(', ')}) but their DBS is ${DBS_STATUS_LABEL[p.dbs].toLowerCase()}` });
    }
  }
  const marked = new Set(d.attendance.map((a) => `${a.visitId}|${a.uid}|${a.date}`));
  for (const v of d.visits.filter(live)) {
    for (const day of includedDays(v.days)) {
      if (day.date > d.today) continue;
      const unmarked = v.assignments.filter((a) => a.status === 'confirmed' && a.dates.includes(day.date) && !marked.has(`${v.visitId}|${a.uid}|${day.date}`));
      if (unmarked.length) out.push({ kind: 'Attendance', text: `${schoolName(v.schoolId)}, ${shortDate(day.date)}: ${unmarked.length} not marked (${unmarked.map((a) => nameOf(d, a.uid)).join(', ')})` });
    }
  }
  return out;
}

/* ── 2. A school's sessions: who could come each day, and who is on ──── */

const AVAIL_CELL: Record<Availability, { v: string; bg: string }> = {
  all: { v: 'Available', bg: PALETTE.available },
  am: { v: 'AM only', bg: PALETTE.available },
  pm: { v: 'PM only', bg: PALETTE.available },
  maybe: { v: 'Maybe', bg: PALETTE.maybe },
  no: { v: 'Can’t', bg: PALETTE.cannot },
};

export function sessionsTab(d: SheetData, school: SheetSchool): Tab {
  const { from, to } = windowOf(d.today);
  const days = schoolDays(d.visits, school.id, from, to);
  const answer = new Map(d.availability.map((a) => [`${a.uid}|${a.date}`, a]));
  const rows: Cell[][] = [];
  const fixed = ['#', 'Name', 'Email', 'Level', 'Jobs', 'DBS status', 'Training sign-off', `Approved by ${school.short}`];
  rows.push([{ v: `${school.name}: sessions`, bold: true, size: 14, fg: PALETTE.deep }]);
  rows.push([{ v: days.length ? `Visit days ${shortDate(days[0].date)} to ${shortDate(days.at(-1)!.date)} (4 weeks back, 12 ahead). Last synced ${ukStamp(d.syncedAt)}.` : 'No visit days in the 4 weeks back or the 12 ahead.', fg: PALETTE.muted }]);
  rows.push([
    { v: 'Key:', bold: true },
    { v: 'EEG ✓ confirmed', bg: PALETTE.confirmed, fg: PALETTE.white, bold: true },
    { v: 'EEG? offered', bg: PALETTE.offered, fg: PALETTE.ink },
    { v: 'Available', bg: PALETTE.available },
    { v: 'Maybe', bg: PALETTE.maybe },
    { v: 'Can’t', bg: PALETTE.cannot },
    { v: 'Name in red: not ready (see the note)', fg: PALETTE.red },
  ]);
  rows.push([]);
  rows.push(header([...fixed, ...days.map((x) => shortDate(x.date)), 'Days available', 'Days booked']));
  const headerRow = rows.length - 1;

  const personRow = (p: SheetPerson, i: number): Cell[] => {
    const reasons = notReadyFor(p, school.id);
    const approval = approvedBy(p, school.id);
    let available = 0;
    let booked = 0;
    const cells: Cell[] = days.map((sd) => {
      const place = sd.places.find((x) => x.uid === p.uid);
      if (place) {
        if (place.status === 'confirmed') booked += 1;
        return place.status === 'confirmed' ? { v: `${JOB_SHORT[place.role]} ✓`, bg: PALETTE.confirmed, fg: PALETTE.white, bold: true, align: 'CENTER' } : { v: `${JOB_SHORT[place.role]}?`, bg: PALETTE.offered, fg: PALETTE.ink, italic: true, align: 'CENTER', note: 'Offered, not yet confirmed' };
      }
      const a = answer.get(`${p.uid}|${sd.date}`);
      if (!a) return null;
      if (FREE.has(a.value)) available += 1;
      return { ...AVAIL_CELL[a.value], align: 'CENTER', ...(a.note ? { note: a.note } : {}) };
    });
    // A day booked counts as available too.
    available += days.filter((sd) => sd.places.some((x) => x.uid === p.uid)).length;
    return [
      i + 1,
      reasons.length ? { v: p.name, fg: PALETTE.red, bold: true, note: `Not ready:\n${reasons.join('\n')}` } : { v: p.name, bold: true },
      p.email,
      levelText(p),
      jobsOf(p),
      dbsCell(p),
      signOffCell(p.signOff),
      approval ? { v: `Yes, ${approval.at ? approval.at.slice(0, 10) : ''}`.trim().replace(/,$/, ''), fg: PALETTE.green, note: approval.byName ? `Recorded by ${approval.byName}` : undefined } : { v: school.requireApproval ? 'Not yet' : '', fg: PALETTE.red },
      ...cells,
      { v: available, align: 'CENTER' },
      { v: booked, align: 'CENTER', bold: booked > 0 },
    ];
  };
  rows.push([section('Research assistants')]);
  activeRas(d).forEach((p, i) => rows.push(personRow(p, i)));
  rows.push([section('Research leads')]);
  activeLeads(d).forEach((p, i) => rows.push(personRow(p, i)));
  rows.push([]);

  // Per-day totals.
  const pad = fixed.length;
  const free = (people: SheetPerson[], date: string) => people.filter((p) => {
    const a = answer.get(`${p.uid}|${date}`);
    return (a && FREE.has(a.value)) || days.find((x) => x.date === date)?.places.some((x) => x.uid === p.uid && x.status === 'confirmed');
  }).length;
  const total = (label: string, f: (sd: SchoolDay) => Cell): Cell[] => [null, { v: label, bold: true }, ...Array(pad - 2).fill(null), ...days.map(f)];
  rows.push(total('RAs available', (sd) => ({ v: free(activeRas(d), sd.date), align: 'CENTER' })));
  rows.push(total('Leads available', (sd) => ({ v: free(activeLeads(d), sd.date), align: 'CENTER' })));
  rows.push(total('Total available', (sd) => ({ v: free([...activeRas(d), ...activeLeads(d)], sd.date), align: 'CENTER', bold: true })));
  for (const r of DAY_ROLES) rows.push(total(`${JOB_PLURAL[r]} confirmed / needed`, (sd) => ({ v: ratio(sd.confirmed[r], sd.need[r]), align: 'CENTER', ...(sd.confirmed[r] < sd.need[r] ? { fg: PALETTE.red, bold: true } : { fg: PALETTE.green }) })));
  rows.push(total('Fully staffed', (sd) => (shortTotal(sd) ? { v: 'No', bg: PALETTE.red, fg: PALETTE.white, bold: true, align: 'CENTER', note: staffingLine(sd) } : { v: 'Yes', bg: PALETTE.green, fg: PALETTE.white, bold: true, align: 'CENTER' })));

  return { title: `${school.short} sessions`, rows, frozenRows: headerRow + 1, frozenCols: 2, widths: [36, 190, 220, 110, 110, 120, 150, 120, ...days.map(() => 92), 90, 90], merges: [], banded: false };
}

function dbsCell(p: SheetPerson): CellX {
  const v = DBS_STATUS_LABEL[p.dbs];
  if (p.dbs === 'confirmed') return { v, fg: PALETTE.green, bold: true };
  if (p.dbs === 'processing') return { v, fg: PALETTE.offered, bold: true, ...(p.dbsApplied ? { note: `They said they have applied${p.dbsAppliedOn ? ` on ${p.dbsAppliedOn}` : ''}.` } : {}) };
  return { v, fg: PALETTE.red, bold: true };
}
function signOffCell(s: SignOff): CellX {
  return { v: SIGN_OFF_LABEL[s], fg: s === 'signed-off' ? PALETTE.green : s === 'assess' ? PALETTE.offered : PALETTE.red };
}

/* ── 3. A school's allocations, a week at a time ──────────────────────── */

export function allocationsTab(d: SheetData, school: SheetSchool): Tab {
  const { from, to } = windowOf(d.today);
  const days = schoolDays(d.visits, school.id, from, to);
  const byDate = new Map(days.map((x) => [x.date, x]));
  const rows: Cell[][] = [];
  const merges: Tab['merges'] = [];
  const W = 6;
  const wide = (c: Cell) => {
    rows.push([c]);
    merges.push({ row: rows.length - 1, col: 0, rows: 1, cols: W });
  };
  wide({ v: `${school.name}: allocations`, bold: true, size: 14, fg: PALETTE.deep });
  wide({ v: `Who is on each day. Names in italics are offered, not yet confirmed; names in red have no confirmed DBS. Last synced ${ukStamp(d.syncedAt)}.`, fg: PALETTE.muted, wrap: true });
  rows.push([]);
  const weeks = [...new Set(days.map((x) => weekStartOf(x.date)))];
  if (!weeks.length) rows.push([{ v: 'No visit days in the 4 weeks back or the 12 ahead.', fg: PALETTE.muted }]);
  const person = (uid: string) => d.people.find((p) => p.uid === uid);
  for (const monday of weeks) {
    const dates = [0, 1, 2, 3, 4].map((i) => addDaysIso(monday, i));
    wide({ v: `Week of ${longDate(monday)}`, bold: true, fg: PALETTE.deep, bg: PALETTE.mist });
    rows.push(header(['', ...dates.map((x) => shortDate(x))]));
    rows.push([{ v: 'Times', bold: true }, ...dates.map((x) => (byDate.has(x) ? `${byDate.get(x)!.start}–${byDate.get(x)!.end}` : { v: 'No visit', fg: PALETTE.muted, italic: true }))]);
    for (const role of ['lead', 'eeg', 'copro'] as DayRole[]) {
      const lists = dates.map((x) => {
        const sd = byDate.get(x);
        if (!sd) return { names: [] as CellX[], need: 0 };
        const places = sd.places.filter((p) => p.role === role).sort((a, b) => Number(b.status === 'confirmed') - Number(a.status === 'confirmed') || (person(a.uid)?.name ?? '').localeCompare(person(b.uid)?.name ?? ''));
        const names = places.map((p): CellX => {
          const who = person(p.uid);
          const noDbs = who && who.dbs !== 'confirmed';
          return { v: `${who?.name ?? p.uid}${p.status === 'offered' ? ' (offered)' : ''}`, italic: p.status === 'offered', ...(noDbs ? { fg: PALETTE.red, note: `DBS: ${DBS_STATUS_LABEL[who!.dbs]}` } : {}) };
        });
        return { names, need: sd.need[role] };
      });
      const height = Math.max(1, ...lists.map((l) => Math.max(l.names.length, l.need)));
      for (let i = 0; i < height; i += 1) {
        rows.push([
          i === 0 ? { v: `${JOB_PLURAL[role]}`, bold: true, fg: PALETTE.teal } : null,
          ...lists.map((l, j) => (l.names[i] ? l.names[i] : byDate.has(dates[j]) && i < l.need ? { v: 'needed', fg: PALETTE.red, bg: PALETTE.redBg, italic: true } : null)),
        ]);
      }
    }
    rows.push([{ v: 'Status', bold: true }, ...dates.map((x) => {
      const sd = byDate.get(x);
      if (!sd) return null;
      const line = staffingLine(sd);
      return line === 'Fully staffed' ? { v: line, bold: true, fg: PALETTE.white, bg: PALETTE.green } : { v: line, bold: true, fg: PALETTE.white, bg: PALETTE.red, wrap: true };
    })]);
    rows.push([]);
  }

  wide(section(`Approved by ${school.name}`));
  const approved = d.people.filter((p) => p.status === 'active').map((p) => ({ p, a: approvedBy(p, school.id) })).filter((x) => x.a).sort((a, b) => a.p.name.localeCompare(b.p.name));
  if (!approved.length) rows.push([{ v: school.requireApproval ? 'Nobody yet: this school books only people it has approved.' : 'Nobody recorded.', fg: PALETTE.muted }]);
  else rows.push(header(['Name', 'Approved on', 'Recorded by', 'DBS status']));
  for (const { p, a } of approved) rows.push([p.name, a!.at ? a!.at.slice(0, 10) : '', a!.byName, dbsCell(p)]);
  return { title: `${school.short} allocations`, rows, frozenRows: 0, frozenCols: 0, widths: [140, 180, 180, 180, 180, 180], merges, banded: false };
}

/* ── 4. The records as plain tables ───────────────────────────────────── */

export interface Table {
  /** The tab's title, and the file's name in the export. */
  name: string;
  file: string;
  header: string[];
  rows: (string | number)[][];
  /** What each column holds, for the export's data dictionary. */
  describe: string;
}

const STATE_LABEL: Record<DocState, string> = { missing: 'Not uploaded', uploaded: 'Waiting to be checked', verified: 'Checked', rejected: 'Not accepted', 'expiring-soon': 'Checked, expiring soon', expired: 'Expired' };
const ROLE_LABEL: Record<Role, string> = { pm: 'Project manager', researcher: 'Research team', ra: 'Research assistant' };
/** Keys that never leave the portal, wherever they sit in a record (certificate numbers, passwords, links). */
const SECRET_KEY = /certificate|password|hash|token|secret|key$/i;

/** A record's details with anything secret taken out, as short text. */
export function safeDetails(v: unknown, max = 500): string {
  const strip = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(strip);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([k]) => !SECRET_KEY.test(k)).map(([k, val]) => [k, strip(val)]));
    return x;
  };
  const s = JSON.stringify(strip(v ?? {}));
  return s === '{}' ? '' : s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function dataTables(d: SheetData): Table[] {
  const schoolName = (id: string) => d.schools.find((s) => s.id === id)?.name ?? id;
  const { from, to } = windowOf(d.today);
  const tables: Table[] = [];
  tables.push({
    name: 'People',
    file: 'people',
    describe: 'Everyone with a portal account. DBS status: Confirmed (checked and in date), Processing (uploaded, or they said they have applied), Starting process, Expired.',
    header: ['Name', 'Email', 'Phone', 'Role', 'Account', 'Level', 'Jobs', 'Tags', 'DBS status', 'Said they applied for DBS on', 'Training sign-off', 'Signed off by', 'Signed off on', 'Approved by schools', 'Training sessions', 'Pilots', 'Days attended', 'Ready today', 'Why not', 'Joined'],
    rows: [...d.people].sort((a, b) => a.name.localeCompare(b.name)).map((p) => [p.name, p.email, p.phone, ROLE_LABEL[p.role], p.status, levelText(p), jobsOf(p), p.tags.join(', '), DBS_STATUS_LABEL[p.dbs], p.dbsApplied ? p.dbsAppliedOn || 'yes, no date' : '', SIGN_OFF_LABEL[p.signOff], p.signOffBy, dayOnly(p.signOffAt), p.approvals.map((a) => `${a.schoolName}${a.at ? ` (${a.at.slice(0, 10)})` : ''}`).join(', '), p.training, p.pilots, p.daysAttended, yes(p.ready), p.reasons.join('; '), dayOnly(p.joined)]),
  });
  tables.push({
    name: 'Documents',
    file: 'documents',
    describe: 'Each document someone has uploaded (the latest of each kind), where it stands, and its dates. Never certificate numbers or the copies themselves.',
    header: ['Name', 'Document', 'School', 'Status', 'Uploaded', 'Checked on', 'Checked by', 'Valid until', 'Issue date', 'Update Service', 'Copy held'],
    rows: [...d.documents].sort((a, b) => a.person.localeCompare(b.person) || a.document.localeCompare(b.document)).map((x) => [x.person, x.document, x.school, STATE_LABEL[x.state], x.uploadedOn, x.checkedOn, x.checkedBy, x.validUntil, x.issueDate, yes(x.updateService), yes(x.hasCopy)]),
  });
  tables.push({
    name: 'Availability',
    file: 'availability',
    describe: `Each answer someone gave for a day, from 4 weeks back to 12 weeks ahead (${from} to ${to}).`,
    header: ['Name', 'Role', 'Date', 'Day', 'Answer', 'Note'],
    rows: d.availability.filter((a) => a.date >= from && a.date <= to).map((a) => {
      const p = d.people.find((x) => x.uid === a.uid);
      return [p?.name ?? a.uid, p ? ROLE_LABEL[p.role] : '', a.date, shortDate(a.date).split(' ')[0], AVAILABILITY_LABEL[a.value], a.note];
    }).sort((a, b) => String(a[2]).localeCompare(String(b[2])) || String(a[0]).localeCompare(String(b[0]))),
  });
  const visits = [...d.visits].sort((a, b) => (includedDays(a.days)[0]?.date ?? '').localeCompare(includedDays(b.days)[0]?.date ?? ''));
  tables.push({
    name: 'Visits',
    file: 'visits',
    describe: 'Each school visit: its status, days and place, and how many people each job needs on a day unless a day says otherwise.',
    header: ['Visit', 'School', 'Status', 'First day', 'Last day', 'Days', 'Place', 'EEG a day', 'Co-pro a day', 'Leads a day'],
    rows: visits.map((v) => {
      const on = includedDays(v.days);
      return [v.visitId, schoolName(v.schoolId), v.status, on[0]?.date ?? '', on.at(-1)?.date ?? '', on.length, v.location, v.roleNeeds.eeg, v.roleNeeds.copro, v.roleNeeds.lead];
    }),
  });
  tables.push({
    name: 'Staffing',
    file: 'staffing',
    describe: 'Every place offered on a visit: who, which job, which days, and the answer.',
    header: ['Visit', 'School', 'Name', 'Job', 'Status', 'Days', 'Offered on', 'Answered on'],
    rows: visits.flatMap((v) => v.assignments.map((a) => [v.visitId, schoolName(v.schoolId), nameOf(d, a.uid), DAY_ROLE_LABEL[a.role], a.status, a.dates.join(' '), ukStamp(a.offeredAt), ukStamp(a.respondedAt)])),
  });
  tables.push({
    name: 'Coverage',
    file: 'coverage',
    describe: 'For each visit day: what each job needs, and how many are offered and confirmed.',
    header: ['Date', 'School', 'Visit', 'Visit status', 'Times', 'EEG needed', 'EEG confirmed', 'EEG offered', 'Co-pro needed', 'Co-pro confirmed', 'Co-pro offered', 'Leads needed', 'Leads confirmed', 'Leads offered', 'Fully staffed'],
    rows: visits
      .filter(live)
      .flatMap((v) => coverageByDay(v.days, v.roleNeeds, v.assignments).map((c) => [c.date, schoolName(v.schoolId), v.visitId, v.status, `${c.start}–${c.end}`, c.eeg.need, c.eeg.confirmed, c.eeg.offered, c.copro.need, c.copro.confirmed, c.copro.offered, c.lead.need, c.lead.confirmed, c.lead.offered, yes(DAY_ROLES.every((r) => c[r].confirmed >= c[r].need))]))
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
  tables.push({
    name: 'Attendance',
    file: 'attendance',
    describe: 'Who turned up on each day of a visit, as the team marked it.',
    header: ['Date', 'School', 'Visit', 'Name', 'Mark', 'Note'],
    rows: d.attendance
      .map((a) => {
        const v = d.visits.find((x) => x.visitId === a.visitId);
        return [a.date, v ? schoolName(v.schoolId) : '', a.visitId, nameOf(d, a.uid), ATTENDANCE_LABEL[a.mark], a.note];
      })
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[3]).localeCompare(String(b[3]))),
  });
  tables.push({
    name: 'Training and pilots',
    file: 'training_and_pilots',
    describe: 'Each training session and pilot, one row per person: recorded by the team, or logged by the person and waiting for the team (or declined).',
    header: ['Date', 'Kind', 'Title', 'Job', 'Name', 'Recorded'],
    rows: [
      ...d.sessions.flatMap((s) => s.attendees.map((uid) => [s.date, s.kind === 'pilot' ? 'Pilot' : 'Training', s.title, s.role ? DAY_ROLE_LABEL[s.role] : '', nameOf(d, uid), 'By the team'])),
      ...d.claims.filter((c) => c.status !== 'confirmed').map((c) => [c.date, c.kind === 'pilot' ? 'Pilot' : 'Training', c.title, '', nameOf(d, c.uid), c.status === 'waiting' ? 'Logged by them, waiting' : 'Logged by them, declined']),
    ].sort((a, b) => String(b[0]).localeCompare(String(a[0])) || String(a[4]).localeCompare(String(b[4]))),
  });
  const report = buildReport({ visits: d.visits.map((v) => ({ visitId: v.visitId, schoolId: v.schoolId, schoolName: schoolName(v.schoolId), days: v.days, roleNeeds: v.roleNeeds, assignments: v.assignments })), attendance: d.attendance, people: d.people.map((p) => ({ uid: p.uid, name: p.name })), from: '2000-01-01', to: d.today });
  tables.push({
    name: 'Report — per person',
    file: 'report_per_person',
    describe: 'Everyone offered a place up to today: days offered, confirmed and attended, hours, and days by job.',
    header: ['Name', 'Days offered', 'Days confirmed', 'Attended', 'Absent', 'Late', 'Left early', 'Hours', 'EEG days', 'Co-pro days', 'Lead days'],
    rows: report.people.map((r) => [r.name, r.offeredDays, r.confirmedDays, r.attended, r.absent, r.late, r.leftEarly, Math.round(r.hours * 10) / 10, r.eegDays, r.coproDays, r.leadDays]),
  });
  tables.push({
    name: 'Emails sent',
    file: 'emails_sent',
    describe: 'Every email and text the portal sent: when, what kind, to whom, the subject, and what happened. Never the message itself.',
    header: ['Sent', 'Channel', 'Kind', 'To', 'Subject', 'Outcome'],
    rows: [...d.mail].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')).map((m) => [ukStamp(m.at), m.channel, m.kind, m.to, m.channel === 'sms' ? '(text message)' : m.subject, m.outcome]),
  });
  tables.push({
    name: 'Audit log',
    file: 'audit_log',
    describe: 'Who did what in the portal, newest first (the latest 5,000). Certificate numbers and passwords are never included.',
    header: ['When', 'Who', 'Action', 'Target', 'Details'],
    rows: [...d.audit].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')).slice(0, 5000).map((a) => [ukStamp(a.at), a.by, a.action, a.target, safeDetails(a.details)]),
  });
  if (d.notes) {
    tables.push({
      name: 'Notes',
      file: 'notes',
      describe: 'The team’s notes on people (included because the project manager turned them on).',
      header: ['Name', 'When', 'By', 'Note'],
      rows: [...d.notes].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')).map((n) => [nameOf(d, n.uid), ukStamp(n.at), n.byName, n.text]),
    });
  }
  if (d.linkage) tables.push(linkageTable(d.linkage));
  if (d.issues) tables.push(issuesTable(d.issues));
  return tables;
}

const DATA_WIDTH = (h: string) => (/note|why|details|subject|title|approved|place|to$/i.test(h) ? 260 : /name|email|school|document|tags|outcome|who/i.test(h) ? 190 : 110);

export function tableTab(t: Table): Tab {
  return {
    title: t.name,
    rows: [header(t.header), ...t.rows],
    frozenRows: 1,
    frozenCols: 1,
    widths: t.header.map(DATA_WIDTH),
    merges: [],
    banded: true,
  };
}

/** Every tab, in order: the overview, each school's sessions and allocations, then the tables. */
export function buildWorkbook(d: SheetData): Tab[] {
  const { from, to } = windowOf(d.today);
  // Schools with visit days in the window, the soonest coming up first.
  const next = (id: string) => {
    const days = schoolDays(d.visits, id, from, to).map((x) => x.date);
    return days.find((x) => x >= d.today) ?? `~${days.at(-1) ?? ''}`;
  };
  const busy = d.schools.filter((s) => schoolDays(d.visits, s.id, from, to).length > 0).sort((a, b) => next(a.id).localeCompare(next(b.id)) || a.name.localeCompare(b.name));
  return [overviewTab(d), ...busy.flatMap((s) => [sessionsTab(d, s), allocationsTab(d, s)]), ...dataTables(d).map(tableTab)];
}

/* ── The Sheets API requests that write it ────────────────────────────── */

export interface ExistingTab {
  sheetId: number;
  title: string;
  bandIds: number[];
}

const rgb = (hex: string) => ({ red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255 });

function cellData(c: Cell): Record<string, unknown> {
  const x = cellOf(c);
  const out: Record<string, unknown> = {};
  if (typeof x.v === 'number') out.userEnteredValue = { numberValue: x.v };
  else if (x.v !== null && x.v !== '') out.userEnteredValue = { stringValue: String(x.v) };
  const text: Record<string, unknown> = {};
  if (x.bold) text.bold = true;
  if (x.italic) text.italic = true;
  if (x.fg) text.foregroundColor = rgb(x.fg);
  if (x.size) text.fontSize = x.size;
  if (x.link) text.link = { uri: x.link };
  const format: Record<string, unknown> = { verticalAlignment: 'MIDDLE' };
  if (Object.keys(text).length) format.textFormat = text;
  if (x.bg) format.backgroundColor = rgb(x.bg);
  if (x.align) format.horizontalAlignment = x.align;
  if (x.wrap) format.wrapStrategy = 'WRAP';
  out.userEnteredFormat = format;
  if (x.note) out.note = x.note;
  return out;
}

/** A sheet id for a new tab: stable for its title, and not one the spreadsheet uses. */
export function newSheetId(title: string, taken: Set<number>): number {
  let h = 7;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) % 1_000_000_000;
  let id = 100_000 + h;
  while (taken.has(id)) id += 1;
  taken.add(id);
  return id;
}

/**
 * The batchUpdate requests that make each of our tabs match what was built:
 * missing tabs added, each one cleared (values, formats, merges, banding)
 * and written again with its formatting, in order at the front. Tabs the
 * team added themselves are never touched.
 */
export function sheetRequests(tabs: Tab[], existing: ExistingTab[]): Record<string, unknown>[] {
  const taken = new Set(existing.map((e) => e.sheetId));
  const reqs: Record<string, unknown>[] = [];
  const ids = tabs.map((t) => existing.find((e) => e.title === t.title)?.sheetId ?? null);
  tabs.forEach((t, i) => {
    if (ids[i] !== null) return;
    const id = newSheetId(t.title, taken);
    ids[i] = id;
    reqs.push({ addSheet: { properties: { sheetId: id, title: t.title } } });
  });
  tabs.forEach((t, i) => {
    const sheetId = ids[i]!;
    const cols = Math.max(1, t.frozenCols + 1, ...t.rows.map((r) => r.length), t.widths.length);
    const rowCount = Math.max(t.rows.length + 2, t.frozenRows + 2);
    for (const bandedRangeId of existing.find((e) => e.sheetId === sheetId)?.bandIds ?? []) reqs.push({ deleteBanding: { bandedRangeId } });
    reqs.push({ unmergeCells: { range: { sheetId } } });
    reqs.push({ updateCells: { range: { sheetId }, fields: '*' } });
    reqs.push({ updateSheetProperties: { properties: { sheetId, index: i, gridProperties: { rowCount, columnCount: cols, frozenRowCount: t.frozenRows, frozenColumnCount: t.frozenCols, hideGridlines: !t.banded } }, fields: 'index,gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount,gridProperties.frozenColumnCount,gridProperties.hideGridlines' } });
    reqs.push({ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: t.rows.map((r) => ({ values: r.map(cellData) })), fields: 'userEnteredValue,userEnteredFormat,note' } });
    for (const m of t.merges) reqs.push({ mergeCells: { range: { sheetId, startRowIndex: m.row, endRowIndex: m.row + m.rows, startColumnIndex: m.col, endColumnIndex: m.col + m.cols }, mergeType: 'MERGE_ALL' } });
    t.widths.forEach((px, c) => reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } }));
    if (t.banded && t.rows.length > 1) {
      reqs.push({ addBanding: { bandedRange: { range: { sheetId, startRowIndex: 0, endRowIndex: t.rows.length, startColumnIndex: 0, endColumnIndex: cols }, rowProperties: { headerColor: rgb(PALETTE.deep), firstBandColor: rgb(PALETTE.white), secondBandColor: rgb(PALETTE.band) } } } });
    }
  });
  return reqs;
}

/** The spreadsheet's id from its address (or the id itself); null when it is not one. */
export function spreadsheetIdOf(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  const m = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/) ?? s.match(/^([A-Za-z0-9_-]{30,})$/);
  return m ? m[1] : null;
}

/** What went wrong, in words the project manager can act on. */
export function sheetErrorText(status: number, message: string, serviceAccount: string, project: string): string {
  const m = message || '';
  if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(m)) return `The Google Sheets API is not turned on for the project. Turn it on at https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=${project}, then press Sync now.`;
  if (status === 403 || /permission/i.test(m)) return `The sheet is not shared with the portal. Share it with ${serviceAccount || 'the service account shown above'} as an Editor, then press Sync now.`;
  if (status === 404) return 'No spreadsheet at that address. Check the link (it should start https://docs.google.com/spreadsheets/d/).';
  if (status === 429) return 'Google asked the portal to slow down. It will try again at the next hourly sync.';
  return `Google Sheets said: ${m.slice(0, 300) || `error ${status}`}`;
}
