/**
 * The staff portal's rules, kept apart from Firebase so they can be tested
 * (portal.ts calls them; portalCore.test.ts checks them). The portal is
 * myphonemybrain.com/portal/: one place for the project manager, the
 * research team and the research assistants (1 November 2026).
 *
 * Three roles:
 *   pm          the project manager: everything, including approving accounts,
 *               roles, document copies and their checks, settings, the audit log
 *   researcher  the research team: schools, visits, training and pilots,
 *               staffing and offers; sees whether documents are in order,
 *               never the copies themselves
 *   ra          a research assistant: their own profile, documents,
 *               availability, counts, offers and visits
 */

export type Role = 'pm' | 'researcher' | 'ra';
export type UserStatus = 'pending' | 'active' | 'rejected' | 'archived';
export const ROLES: Role[] = ['pm', 'researcher', 'ra'];

export const isRole = (v: unknown): v is Role => v === 'pm' || v === 'researcher' || v === 'ra';
export const isTeam = (role: Role | null | undefined) => role === 'pm' || role === 'researcher';

/** Who may do what. Anything not listed needs the project manager. */
const TEAM_ACTIONS = new Set([
  'visit-ics',
  'visits-ics',
  'people',
  'person',
  'schools',
  'save-school',
  'sessions',
  'save-session',
  'delete-session',
  'visits',
  'visit',
  'save-visit',
  'set-visit-status',
  'offer',
  'withdraw-offer',
  'save-person',
  'add-note',
  'delete-note',
  'mark-attendance',
  'report',
  'school-email-preview',
  'send-school-email',
  'set-time-note',
  'team-email-preview',
  'send-team-email',
]);
const PM_ACTIONS = new Set(['requests', 'approve', 'reject', 'set-role', 'archive', 'restore', 'verify-document', 'settings', 'save-settings', 'audit', 'override', 'remove-confirmed', 'save-doc-details', 'make-dbs-password', 'close-dbs-access']);
/** Every active user, for themselves. */
const SELF_ACTIONS = new Set(['me', 'my-summary', 'update-profile', 'notifications', 'mark-read', 'register-document', 'document-url', 'set-availability', 'open-visits', 'set-interest', 'respond-offer', 'canvass-answer', 'push-key', 'push-subscribe', 'push-unsubscribe', 'push-test']);
/** Anyone signed in with a checked email, active or not: asking for an account, and seeing where the request stands. */
const OPEN_ACTIONS = new Set(['me', 'request-access']);

export function mayDo(action: string, role: Role | null, status: UserStatus | null): boolean {
  if (OPEN_ACTIONS.has(action)) return true;
  if (status !== 'active' || !role) return false;
  if (SELF_ACTIONS.has(action)) return true;
  if (TEAM_ACTIONS.has(action)) return isTeam(role);
  if (PM_ACTIONS.has(action)) return role === 'pm';
  return false;
}

/* ── Settings ─────────────────────────────────────────────────────────── */

export interface DocType {
  id: string;
  label: string;
  /** What the person is asked to upload. */
  hint: string;
  /** A DBS certificate: number, issue date, Update Service and recheck date are recorded when it is checked. */
  dbs?: boolean;
  /** Whether it has an expiry or renewal date the checker records. */
  expires?: boolean;
}

/** The two jobs on a school visit day (4 November 2026). */
export type DayRole = 'eeg' | 'copro';
export const DAY_ROLES: DayRole[] = ['eeg', 'copro'];
export const DAY_ROLE_LABEL: Record<DayRole, string> = { eeg: 'EEG', copro: 'Co-production' };
export const isDayRole = (v: unknown): v is DayRole => v === 'eeg' || v === 'copro';
/** How many people each job needs on a day. */
export interface RoleNeeds {
  eeg: number;
  copro: number;
}

/** A status the team gives someone who signed up (never shown to research assistants, apart from "Ready" and "On hold"). */
export interface StatusTag {
  id: string;
  label: string;
  /** No longer offered for new tagging; kept on the people who have it. */
  retired?: boolean;
}

/** Experience, set by the team: 1 New, 2 Developing, 3 Experienced, 4 Lead. */
export type Level = 1 | 2 | 3 | 4;
export const LEVEL_LABEL: Record<Level, string> = { 1: 'New', 2: 'Developing', 3: 'Experienced', 4: 'Lead' };
export const levelOf = (v: unknown): Level | null => (v === 1 || v === 2 || v === 3 || v === 4 ? v : null);

export interface Settings {
  minTraining: number;
  minPilots: number;
  /** Days after someone is archived before their document copies are deleted. */
  retentionDays: number;
  /** A verified document within this many days of its expiry shows as "expiring soon". */
  expiringSoonDays: number;
  /** A DBS without the Update Service counts as current for this many years from issue, unless a recheck date is recorded. */
  dbsValidYears: number;
  /** Required of everyone, at every school. */
  docTypes: DocType[];
  /** Who a research assistant emails to withdraw from a visit they have confirmed (they cannot withdraw in the portal). */
  withdrawalContact: { name: string; email: string };
  /** The status tags the team can give people. */
  tags: StatusTag[];
  /** People needed per day for each job, unless a visit or a day says otherwise. */
  roleNeeds: RoleNeeds;
  /** "Always copy in": copied into every portal email to people outside the sender (5 November 2026). */
  alwaysCopy: string[];
}

export const DEFAULT_TAGS: StatusTag[] = [
  { id: 'new', label: 'New' },
  { id: 'in-training', label: 'In training' },
  { id: 'ready', label: 'Ready' },
  { id: 'on-hold', label: 'On hold' },
  { id: 'left', label: 'Left' },
];

export const DEFAULT_SETTINGS: Settings = {
  minTraining: 2,
  minPilots: 1,
  retentionDays: 183,
  expiringSoonDays: 30,
  dbsValidYears: 3,
  docTypes: [
    { id: 'dbs', label: 'Enhanced DBS certificate', hint: 'A photo or scan of both sides of your enhanced DBS certificate.', dbs: true, expires: true },
    { id: 'health', label: 'Health form', hint: 'The completed occupational health form.' },
    { id: 'safeguarding', label: 'Safeguarding training certificate', hint: 'Your certificate for the University safeguarding training.', expires: true },
  ],
  withdrawalContact: { name: 'Dr Sarmad Ali', email: 'S.A.Ali1@leeds.ac.uk' },
  tags: DEFAULT_TAGS,
  roleNeeds: { eeg: 6, copro: 2 },
  alwaysCopy: ['brainpop@leeds.ac.uk', 'S.A.Ali1@leeds.ac.uk'],
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function contactOf(v: unknown): { name: string; email: string } {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const name = text(o.name, 120);
  const email = text(o.email, 200);
  return name && EMAIL_RE.test(email) ? { name, email } : DEFAULT_SETTINGS.withdrawalContact;
}

const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function docTypeOf(v: unknown): DocType | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = text(o.id, 40).toLowerCase();
  const label = text(o.label, 120);
  if (!SLUG.test(id) || !label) return null;
  return { id, label, hint: text(o.hint, 300), ...(o.dbs === true ? { dbs: true } : {}), ...(o.expires === true ? { expires: true } : {}) };
}

/** Settings as stored, with anything missing or out of range taken from the defaults. */
export function settingsOf(v: unknown): Settings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const types = Array.isArray(o.docTypes) ? o.docTypes.map(docTypeOf).filter((t): t is DocType => !!t) : [];
  const unique = types.filter((t, i) => types.findIndex((x) => x.id === t.id) === i);
  return {
    minTraining: int(o.minTraining, 0, 50, DEFAULT_SETTINGS.minTraining),
    minPilots: int(o.minPilots, 0, 50, DEFAULT_SETTINGS.minPilots),
    retentionDays: int(o.retentionDays, 0, 3650, DEFAULT_SETTINGS.retentionDays),
    expiringSoonDays: int(o.expiringSoonDays, 0, 365, DEFAULT_SETTINGS.expiringSoonDays),
    dbsValidYears: int(o.dbsValidYears, 1, 10, DEFAULT_SETTINGS.dbsValidYears),
    docTypes: unique.length ? unique : DEFAULT_SETTINGS.docTypes,
    withdrawalContact: contactOf(o.withdrawalContact),
    tags: tagsSetting(o.tags),
    roleNeeds: roleNeedsOf(o.roleNeeds) ?? DEFAULT_SETTINGS.roleNeeds,
    alwaysCopy: Array.isArray(o.alwaysCopy) ? [...new Map(o.alwaysCopy.map((e) => text(e, 200)).filter((e) => EMAIL_RE.test(e)).map((e) => [e.toLowerCase(), e])).values()].slice(0, 5) : DEFAULT_SETTINGS.alwaysCopy,
  };
}

/** Splits "a@x, b@y" (or a list) into addresses. */
const addressesOf = (v: string | string[] | undefined) => (Array.isArray(v) ? v : String(v ?? '').split(/[,;]/)).map((e) => e.trim()).filter(Boolean);

/**
 * Who to copy in on a portal email: the "Always copy in" addresses, less any
 * already on it (To, CC or BCC, whatever the case). An email only to people
 * on the list (a system email to Sarmad himself, say) gets no copy.
 */
export function copyFor(alwaysCopy: string[], mail: { to: string | string[]; cc?: string | string[]; bcc?: string | string[] }): string[] {
  const on = new Set([...addressesOf(mail.to), ...addressesOf(mail.cc), ...addressesOf(mail.bcc)].map((e) => e.toLowerCase()));
  const always = new Set(alwaysCopy.map((e) => e.toLowerCase()));
  if (on.size && [...on].every((e) => always.has(e))) return [];
  return [...new Map(alwaysCopy.filter((e) => !on.has(e.toLowerCase())).map((e) => [e.toLowerCase(), e])).values()];
}

function tagsSetting(v: unknown): StatusTag[] {
  if (!Array.isArray(v)) return DEFAULT_TAGS;
  const out: StatusTag[] = [];
  for (const t of v) {
    const o = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
    const id = text(o.id, 40).toLowerCase();
    const label = text(o.label, 60);
    if (!SLUG.test(id) || !label || out.some((x) => x.id === id)) continue;
    out.push({ id, label, ...(o.retired === true ? { retired: true } : {}) });
  }
  return out.length ? out.slice(0, 30) : DEFAULT_TAGS;
}

/** People needed for each job; null when not given or none at all. */
export function roleNeedsOf(v: unknown): RoleNeeds | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const eeg = Number(o.eeg);
  const copro = Number(o.copro);
  if (!Number.isInteger(eeg) || !Number.isInteger(copro) || eeg < 0 || copro < 0 || eeg > 30 || copro > 30 || eeg + copro < 1) return null;
  return { eeg, copro };
}

/** The tags someone has that the settings still know (in the settings' order). */
export function tagsFor(v: unknown, settings: Settings): string[] {
  const have = new Set(Array.isArray(v) ? v.map(String) : []);
  return settings.tags.filter((t) => have.has(t.id)).map((t) => t.id);
}

/** What a research assistant is told of their tags: only "Ready" or "On hold". */
export function standingOf(tags: string[]): 'Ready' | 'On hold' | null {
  if (tags.includes('on-hold')) return 'On hold';
  if (tags.includes('ready')) return 'Ready';
  return null;
}

export const capabilitiesOf = (v: unknown): DayRole[] => DAY_ROLES.filter((r) => Array.isArray(v) && v.includes(r));

/* ── Dates ────────────────────────────────────────────────────────────── */

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (v: unknown): v is string => typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function addYearsIso(iso: string, years: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}
/** Today in the UK, as YYYY-MM-DD. */
export function ukToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/* ── Documents ────────────────────────────────────────────────────────── */

export interface DocDetails {
  certificateNumber?: string;
  issueDate?: string;
  updateService?: boolean;
  /** The recheck or expiry date. */
  expiresOn?: string;
}

export interface PortalDoc {
  id: string;
  uid: string;
  typeId: string;
  /** Null for a document everyone needs; a school's id for one that school asks for. */
  schoolId: string | null;
  status: 'uploaded' | 'verified' | 'rejected';
  uploadedAt: string;
  details: DocDetails;
  note?: string;
  deletedAt?: string | null;
}

export type DocState = 'missing' | 'uploaded' | 'verified' | 'rejected' | 'expiring-soon' | 'expired';

/** The latest upload of each kind, per person: the one that counts. */
export function latestDocs(docs: PortalDoc[]): Map<string, PortalDoc> {
  const out = new Map<string, PortalDoc>();
  for (const d of docs) {
    const key = `${d.uid}|${d.typeId}|${d.schoolId ?? ''}`;
    const had = out.get(key);
    if (!had || d.uploadedAt > had.uploadedAt) out.set(key, d);
  }
  return out;
}

/** The date a verified document stops counting, or null when it does not expire. */
export function validUntil(doc: PortalDoc, type: DocType | undefined, settings: Settings): string | null {
  if (doc.details.expiresOn && isIsoDate(doc.details.expiresOn)) return doc.details.expiresOn;
  if (type?.dbs) {
    if (doc.details.updateService) return null;
    if (doc.details.issueDate && isIsoDate(doc.details.issueDate)) return addYearsIso(doc.details.issueDate, settings.dbsValidYears);
  }
  return null;
}

/** Where one document stands on a given day. */
export function docState(doc: PortalDoc | undefined, type: DocType | undefined, settings: Settings, onDate: string): DocState {
  if (!doc) return 'missing';
  if (doc.status !== 'verified') return doc.status;
  const until = validUntil(doc, type, settings);
  if (until && until < onDate) return 'expired';
  if (until && until <= addDaysIso(onDate, settings.expiringSoonDays)) return 'expiring-soon';
  return 'verified';
}

export interface Requirement {
  type: DocType;
  schoolId: string | null;
}

/** What someone needs for a school: everyone's documents, then the school's own. */
export function requirementsFor(settings: Settings, school: { id: string; requiredDocs?: DocType[] } | null): Requirement[] {
  return [...settings.docTypes.map((type) => ({ type, schoolId: null })), ...(school?.requiredDocs ?? []).map((type) => ({ type, schoolId: school!.id }))];
}

/* ── Eligibility ──────────────────────────────────────────────────────── */

export interface Counts {
  training: number;
  pilots: number;
  /** Training sessions marked for a job (4 November 2026). */
  byRole?: Record<DayRole, number>;
}

export interface Eligibility {
  eligible: boolean;
  reasons: string[];
}

/**
 * Whether someone can be booked onto a visit: a verified DBS still in date on
 * the visit's day, every required document (the school's too) verified and in
 * date, and at least the set number of training sessions and pilots.
 */
export function eligibilityFor(uid: string, docs: Map<string, PortalDoc>, requirements: Requirement[], counts: Counts, settings: Settings, visitDate: string): Eligibility {
  const reasons: string[] = [];
  for (const { type, schoolId } of requirements) {
    const doc = docs.get(`${uid}|${type.id}|${schoolId ?? ''}`);
    const state = docState(doc, type, settings, visitDate);
    const name = type.label;
    if (state === 'missing') reasons.push(`${name}: not uploaded`);
    else if (state === 'uploaded') reasons.push(`${name}: waiting to be checked`);
    else if (state === 'rejected') reasons.push(`${name}: not accepted${doc?.note ? ` (${doc.note})` : ''}`);
    else if (state === 'expired') reasons.push(`${name}: out of date by the visit`);
  }
  if (counts.training < settings.minTraining) reasons.push(`Training: ${counts.training} of ${settings.minTraining}`);
  if (counts.pilots < settings.minPilots) reasons.push(`Pilots: ${counts.pilots} of ${settings.minPilots}`);
  return { eligible: reasons.length === 0, reasons };
}

export function countsFor(uid: string, sessions: { kind: string; attendees: string[]; role?: string | null }[]): Counts {
  let training = 0;
  let pilots = 0;
  const byRole: Record<DayRole, number> = { eeg: 0, copro: 0 };
  for (const s of sessions) {
    if (!s.attendees.includes(uid)) continue;
    if (s.kind === 'training') {
      training += 1;
      if (isDayRole(s.role)) byRole[s.role] += 1;
    } else if (s.kind === 'pilot') pilots += 1;
  }
  return { training, pilots, byRole };
}

/* ── Availability ─────────────────────────────────────────────────────── */

/** 'maybe' comes from an answer to provisional dates (3 November 2026). */
export type Availability = 'all' | 'am' | 'pm' | 'no' | 'maybe';
export const AVAILABILITY: Availability[] = ['all', 'am', 'pm', 'no', 'maybe'];
export const AVAILABILITY_LABEL: Record<Availability, string> = { all: 'Available all day', am: 'Morning only', pm: 'Afternoon only', no: 'Not available', maybe: 'Maybe' };

/** Whether someone's day covers a visit's times (morning ends at 12:30, afternoon starts at 12:00). */
export function covers(day: Availability | undefined, start: string, end: string): 'yes' | 'no' | 'unknown' {
  if (!day) return 'unknown';
  if (day === 'all') return 'yes';
  if (day === 'no') return 'no';
  if (day === 'maybe') return 'unknown';
  if (day === 'am') return end <= '12:30' ? 'yes' : 'no';
  return start >= '12:00' ? 'yes' : 'no';
}

export function validateAvailability(input: unknown, today: string): { days: { date: string; value: Availability | null; note: string }[]; problems: string[] } {
  const problems: string[] = [];
  if (!Array.isArray(input) || !input.length) return { days: [], problems: ['No days to save.'] };
  if (input.length > 120) return { days: [], problems: ['At most 120 days at once.'] };
  const days: { date: string; value: Availability | null; note: string }[] = [];
  for (const d of input) {
    const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
    if (!isIsoDate(o.date)) {
      problems.push('A day has no valid date.');
      continue;
    }
    if (o.date < today) {
      problems.push(`${o.date} is in the past.`);
      continue;
    }
    if (o.value !== null && !AVAILABILITY.includes(o.value as Availability)) {
      problems.push(`${o.date}: choose all day, morning, afternoon or not available.`);
      continue;
    }
    days.push({ date: o.date, value: (o.value as Availability | null) ?? null, note: text(o.note, 200) });
  }
  return { days, problems };
}

/* ── Visits ───────────────────────────────────────────────────────────── */

/** provisional (3 November 2026): dates not yet agreed with the school, put out to ask who could do them; no offers until they move on to staffing. */
export type VisitStatus = 'draft' | 'provisional' | 'staffing' | 'locked' | 'done' | 'cancelled';
export const VISIT_STATUSES: VisitStatus[] = ['draft', 'provisional', 'staffing', 'locked', 'done', 'cancelled'];

/** One day of a visit: its date, its times, and whether the visit runs that day. */
export interface VisitDay {
  date: string;
  start: string;
  end: string;
  on: boolean;
  /** The day's own numbers for each job, when they differ from the visit's. */
  eeg?: number;
  copro?: number;
  /** The day's own arrival and taxi times, when they differ from the visit's travel. */
  arrival?: string;
  taxiTime?: string;
}

/** How the team gets there (4 November 2026): all optional. */
export interface Travel {
  /** When everyone should be at the school, "07:45". */
  arrival: string;
  /** Where the taxi leaves from, and when. */
  taxiFrom: string;
  taxiTime: string;
  /** A line for people going straight to the school. */
  direct: string;
}
export const DEFAULT_TAXI_FROM = 'School of Psychology, University of Leeds';
export function travelOf(v: unknown): Travel {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const time = (t: unknown) => (typeof t === 'string' && TIME.test(t) ? t : '');
  return { arrival: time(o.arrival), taxiFrom: text(o.taxiFrom, 160) || DEFAULT_TAXI_FROM, taxiTime: time(o.taxiTime), direct: text(o.direct, 300) };
}
/** The travel on a day: the day's own times where it has them. */
export function travelOn(day: VisitDay, travel: Travel): Travel {
  return { ...travel, arrival: day.arrival ?? travel.arrival, taxiTime: day.taxiTime ?? travel.taxiTime };
}

export interface VisitInput {
  schoolId: string;
  /** The first and last dates of the period the admin entered. */
  startDate: string;
  endDate: string;
  /** The usual times; a day can have its own. */
  start: string;
  end: string;
  /** Every day of the period, in order, with whether the visit runs and its times. */
  days: VisitDay[];
  /** Where the team meets: an address, a room or a meeting point (the school's name is added in front). */
  location: string;
  /** People needed per day for each job; a day can have its own. */
  roleNeeds: RoleNeeds;
  travel: Travel;
  notes: string;
}

export const MAX_VISIT_DAYS = 62;
const weekend = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};

/** The days of a period: weekdays on and weekends off unless said otherwise, at the usual times unless a day has its own. */
const dayNeed = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 30 ? n : undefined;
};

export function periodDays(startDate: string, endDate: string, start: string, end: string, overrides: { date: string; on?: boolean; start?: string; end?: string; eeg?: unknown; copro?: unknown; arrival?: unknown; taxiTime?: unknown }[] = []): VisitDay[] {
  const out: VisitDay[] = [];
  for (let d = startDate, n = 0; d <= endDate && n < MAX_VISIT_DAYS; d = addDaysIso(d, 1), n += 1) {
    const o = overrides.find((x) => x.date === d);
    const eeg = dayNeed(o?.eeg);
    const copro = dayNeed(o?.copro);
    const arrival = typeof o?.arrival === 'string' && TIME.test(o.arrival) ? o.arrival : undefined;
    const taxiTime = typeof o?.taxiTime === 'string' && TIME.test(o.taxiTime) ? o.taxiTime : undefined;
    out.push({ date: d, on: typeof o?.on === 'boolean' ? o.on : !weekend(d), start: o?.start && TIME.test(o.start) ? o.start : start, end: o?.end && TIME.test(o.end) ? o.end : end, ...(eeg !== undefined ? { eeg } : {}), ...(copro !== undefined ? { copro } : {}), ...(arrival ? { arrival } : {}), ...(taxiTime ? { taxiTime } : {}) });
  }
  return out;
}

export function validateVisit(input: unknown, schoolIds: string[], today: string, defaults: RoleNeeds = DEFAULT_SETTINGS.roleNeeds): { visit: VisitInput | null; problems: string[] } {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof o.schoolId !== 'string' || !schoolIds.includes(o.schoolId)) problems.push('Choose the school.');
  // A visit saved before 3 November 2026 has one date: the same as a period of one day.
  const startDate = (o.startDate ?? o.date) as unknown;
  const endDate = (o.endDate ?? o.startDate ?? o.date) as unknown;
  if (!isIsoDate(startDate)) problems.push('Give the first date.');
  if (!isIsoDate(endDate)) problems.push('Give the last date.');
  else if (isIsoDate(startDate) && endDate < startDate) problems.push('The last date is before the first.');
  else if (isIsoDate(startDate) && addDaysIso(startDate, MAX_VISIT_DAYS - 1) < endDate) problems.push(`A visit can cover at most ${MAX_VISIT_DAYS} days.`);
  else if (endDate < today) problems.push('The dates are in the past.');
  if (typeof o.start !== 'string' || !TIME.test(o.start)) problems.push('Give the usual start time (for example 08:30).');
  if (typeof o.end !== 'string' || !TIME.test(o.end)) problems.push('Give the usual end time (for example 15:00).');
  else if (typeof o.start === 'string' && TIME.test(o.start) && o.end <= o.start) problems.push('The usual end time is before the start.');
  const location = text(o.location ?? o.meetingPoint, 200);
  if (!location) problems.push('Say where: an address, a room or a meeting point.');
  // How many for each job; a visit saved before 4 November 2026 had one number of research assistants, all on EEG.
  const needed = Number(o.needed);
  const roleNeeds = o.roleNeeds !== undefined ? roleNeedsOf(o.roleNeeds) : o.needed !== undefined ? (Number.isInteger(needed) && needed >= 1 && needed <= 30 ? { eeg: needed, copro: 0 } : null) : defaults;
  if (!roleNeeds) problems.push('Say how many people are needed for EEG and for co-production (0 to 30 each, at least one in all).');
  if (problems.length) return { visit: null, problems };
  const overrides = (Array.isArray(o.days) ? o.days : []).filter((d): d is Record<string, unknown> => !!d && typeof d === 'object').map((d) => ({ date: String(d.date ?? ''), on: typeof d.on === 'boolean' ? d.on : undefined, start: typeof d.start === 'string' ? d.start : undefined, end: typeof d.end === 'string' ? d.end : undefined, eeg: d.eeg, copro: d.copro, arrival: d.arrival, taxiTime: d.taxiTime }));
  for (const d of overrides) {
    if ((d.start && !TIME.test(d.start)) || (d.end && !TIME.test(d.end))) problems.push(`${d.date}: give times like 08:30.`);
  }
  const days = periodDays(startDate as string, endDate as string, o.start as string, o.end as string, overrides);
  for (const d of days) if (d.on && d.end <= d.start) problems.push(`${d.date}: the end time is before the start.`);
  if (!days.some((d) => d.on)) problems.push('Choose at least one day the visit runs.');
  for (const d of includedDays(days)) {
    const n = needsOn(d, roleNeeds!);
    if (n.eeg + n.copro < 1) problems.push(`${d.date}: nobody is needed that day; switch the day off instead.`);
  }
  if (problems.length) return { visit: null, problems };
  return { visit: { schoolId: o.schoolId as string, startDate: startDate as string, endDate: endDate as string, start: o.start as string, end: o.end as string, days, location, roleNeeds: roleNeeds!, travel: travelOf(o.travel), notes: text(o.notes, 1000) }, problems };
}

export interface StoredVisit {
  startDate: string;
  endDate: string;
  start: string;
  end: string;
  days: VisitDay[];
  location: string;
  roleNeeds: RoleNeeds;
  travel: Travel;
}

/**
 * A stored visit in today's shape: one saved before 3 November 2026 (a single
 * date and a meeting point) becomes a period of one day; one saved before 4
 * November 2026 (one number of research assistants) needs that many on EEG.
 */
export function normaliseVisit(x: Record<string, unknown>, defaults: RoleNeeds = DEFAULT_SETTINGS.roleNeeds): StoredVisit {
  const start = typeof x.start === 'string' && TIME.test(x.start) ? x.start : '08:30';
  const end = typeof x.end === 'string' && TIME.test(x.end) ? x.end : '15:00';
  const raw = Array.isArray(x.days) ? (x.days as Record<string, unknown>[]) : [];
  const days: VisitDay[] = raw.length
    ? raw.filter((d) => isIsoDate(d?.date)).map((d) => {
        const eeg = dayNeed(d.eeg);
        const copro = dayNeed(d.copro);
        const arrival = typeof d.arrival === 'string' && TIME.test(d.arrival) ? d.arrival : undefined;
        const taxiTime = typeof d.taxiTime === 'string' && TIME.test(d.taxiTime) ? d.taxiTime : undefined;
        return { date: String(d.date), on: d.on !== false, start: typeof d.start === 'string' && TIME.test(d.start) ? d.start : start, end: typeof d.end === 'string' && TIME.test(d.end) ? d.end : end, ...(eeg !== undefined ? { eeg } : {}), ...(copro !== undefined ? { copro } : {}), ...(arrival ? { arrival } : {}), ...(taxiTime ? { taxiTime } : {}) };
      })
    : isIsoDate(x.date)
      ? [{ date: x.date, on: true, start, end }]
      : [];
  days.sort((a, b) => a.date.localeCompare(b.date));
  const location = text(x.location, 200) || text(x.meetingPoint, 200);
  const needed = Number(x.needed);
  const roleNeeds = roleNeedsOf(x.roleNeeds) ?? (Number.isInteger(needed) && needed >= 1 ? { eeg: needed, copro: 0 } : defaults);
  return { startDate: days[0]?.date ?? String(x.date ?? ''), endDate: days.at(-1)?.date ?? String(x.date ?? ''), start, end, days, location, roleNeeds, travel: travelOf(x.travel) };
}

/** The numbers each job needs on a day: the day's own, else the visit's. */
export function needsOn(day: VisitDay, roleNeeds: RoleNeeds): RoleNeeds {
  return { eeg: day.eeg ?? roleNeeds.eeg, copro: day.copro ?? roleNeeds.copro };
}

/** The days a visit runs. */
export const includedDays = (days: VisitDay[]) => days.filter((d) => d.on);

/** Whether the visit's days or place changed in a way the people confirmed need to hear about. */
export function scheduleChanged(before: StoredVisit, after: StoredVisit): { changed: boolean; removedDays: VisitDay[] } {
  const key = (d: VisitDay) => `${d.date} ${d.start}-${d.end}`;
  const was = includedDays(before.days);
  const now = includedDays(after.days);
  const changed = before.location !== after.location || was.map(key).join('|') !== now.map(key).join('|');
  // Only the dates, times and place matter to the people booked; the numbers needed are the team's business.
  return { changed, removedDays: was.filter((d) => !now.some((n) => n.date === d.date)) };
}

export type Coverage = 'all' | 'some' | 'none' | 'unknown';

/** Someone's availability across a visit's days: day by day, and in a word. */
export function coverageFor(days: VisitDay[], availability: Map<string, Availability>): { perDay: { date: string; value: Availability | null; covers: 'yes' | 'no' | 'unknown' }[]; coverage: Coverage; availableDates: string[] } {
  const perDay = includedDays(days).map((d) => {
    const value = availability.get(d.date) ?? null;
    return { date: d.date, value, covers: covers(value ?? undefined, d.start, d.end) };
  });
  const yes = perDay.filter((d) => d.covers === 'yes').map((d) => d.date);
  const coverage: Coverage = !perDay.length ? 'unknown' : yes.length === perDay.length ? 'all' : yes.length ? 'some' : perDay.every((d) => d.covers === 'unknown') ? 'unknown' : 'none';
  return { perDay, coverage, availableDates: yes };
}

/* ── Offers ───────────────────────────────────────────────────────────── */

export type AssignmentStatus = 'offered' | 'confirmed' | 'declined' | 'withdrawn' | 'removed';

/**
 * A place on a visit: one person, one job, the days they do it (4 November
 * 2026; before then a place was the whole visit, on EEG).
 */
export interface Assignment {
  uid: string;
  status: AssignmentStatus;
  role: DayRole;
  dates: string[];
  /** A note on a day's times for this person, such as "until 1:00 pm" (shown in brackets after their name). */
  timeNotes?: Record<string, string>;
}

/** A stored place in today's shape: one saved before 4 November 2026 is EEG on every day the visit runs. */
export function assignmentOf(x: Record<string, unknown>, visitDays: VisitDay[]): Assignment {
  const on = includedDays(visitDays).map((d) => d.date);
  const dates = Array.isArray(x.dates) ? x.dates.map(String).filter((d) => on.includes(d)) : on;
  const notes = (x.timeNotes && typeof x.timeNotes === 'object' ? x.timeNotes : {}) as Record<string, unknown>;
  const timeNotes = Object.fromEntries(Object.entries(notes).filter(([d, n]) => on.includes(d) && typeof n === 'string' && n.trim()).map(([d, n]) => [d, String(n).trim().slice(0, 60)]));
  return { uid: String(x.uid), status: x.status as AssignmentStatus, role: isDayRole(x.role) ? x.role : 'eeg', dates: Array.isArray(x.dates) ? dates : on, ...(Object.keys(timeNotes).length ? { timeNotes } : {}) };
}

/** A time note from someone's availability that day: "morning only" or "afternoon only" (none for a whole day). */
export function timeNoteFrom(day: Availability | undefined): string | null {
  return day === 'am' ? 'morning only' : day === 'pm' ? 'afternoon only' : null;
}

const holds = (a: Assignment) => a.status === 'offered' || a.status === 'confirmed';

export interface DayCoverage {
  date: string;
  start: string;
  end: string;
  eeg: { need: number; offered: number; confirmed: number };
  copro: { need: number; offered: number; confirmed: number };
}

/** For each day the visit runs: each job's need, and how many hold an open offer or a confirmed place. */
export function coverageByDay(days: VisitDay[], roleNeeds: RoleNeeds, assignments: Assignment[]): DayCoverage[] {
  return includedDays(days).map((d) => {
    const need = needsOn(d, roleNeeds);
    const count = (role: DayRole, status: AssignmentStatus) => assignments.filter((a) => a.role === role && a.status === status && a.dates.includes(d.date)).length;
    return { date: d.date, start: d.start, end: d.end, eeg: { need: need.eeg, offered: count('eeg', 'offered'), confirmed: count('eeg', 'confirmed') }, copro: { need: need.copro, offered: count('copro', 'offered'), confirmed: count('copro', 'confirmed') } };
  });
}

/** Every day the visit runs has enough confirmed people for both jobs. */
export function fullyStaffed(days: VisitDay[], roleNeeds: RoleNeeds, assignments: Assignment[]): boolean {
  const cover = coverageByDay(days, roleNeeds, assignments);
  return cover.length > 0 && cover.every((c) => c.eeg.confirmed >= c.eeg.need && c.copro.confirmed >= c.copro.need);
}

/** Places still open on a day for a job: needed, less those offered and those confirmed. */
export function placesLeftOn(cover: DayCoverage, role: DayRole): number {
  const c = cover[role];
  return Math.max(0, c.need - c.offered - c.confirmed);
}

/** What the team asks for: someone, a job, and the days. */
export interface OfferItem {
  uid: string;
  role: DayRole;
  dates: string[];
  timeNotes?: Record<string, string>;
}

export interface OfferPlan {
  offer: OfferItem[];
  problems: string[];
}

export function offerItemsOf(input: unknown): OfferItem[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .map((o) => {
      const notes = (o.timeNotes && typeof o.timeNotes === 'object' ? o.timeNotes : {}) as Record<string, unknown>;
      const timeNotes = Object.fromEntries(Object.entries(notes).filter(([, n]) => typeof n === 'string' && n.trim()).map(([d, n]) => [d, String(n).trim().slice(0, 60)]));
      return { uid: String(o.uid ?? ''), role: (isDayRole(o.role) ? o.role : '') as DayRole, dates: Array.isArray(o.dates) ? [...new Set(o.dates.map(String))].sort() : [], ...(Object.keys(timeNotes).length ? { timeNotes } : {}) };
    });
}

/**
 * Which of the chosen places can be offered: each to an active research
 * assistant who has no place on the visit yet, for a job they do, on days the
 * visit runs, without going over any day's numbers for that job; eligible, or
 * set up for the job, unless the project manager gives a reason to override.
 */
export function planOffers(
  chosen: OfferItem[],
  args: { days: VisitDay[]; roleNeeds: RoleNeeds; assignments: Assignment[]; active: Set<string>; eligible: Map<string, Eligibility>; capabilities: Map<string, DayRole[]>; overrides: Record<string, string>; mayOverride: boolean; visitStatus: VisitStatus },
): OfferPlan {
  const problems: string[] = [];
  if (args.visitStatus === 'cancelled' || args.visitStatus === 'done') return { offer: [], problems: ['This visit is closed.'] };
  if (args.visitStatus === 'provisional') return { offer: [], problems: ['These dates are provisional: confirm them with the school and move the visit on to staffing before offering places.'] };
  if (!chosen.length) return { offer: [], problems: ['Choose who to offer the visit to.'] };
  const on = new Set(includedDays(args.days).map((d) => d.date));
  const seen = new Set<string>();
  const offer: OfferItem[] = [];
  for (const item of chosen) {
    if (seen.has(item.uid)) {
      problems.push(`${item.uid} is chosen twice: one job per person on a visit.`);
      continue;
    }
    seen.add(item.uid);
    if (!args.active.has(item.uid)) {
      problems.push(`${item.uid} is not an active research assistant.`);
      continue;
    }
    if (!isDayRole(item.role)) {
      problems.push(`${item.uid}: choose EEG or co-production.`);
      continue;
    }
    if (!item.dates.length || item.dates.some((d) => !on.has(d))) {
      problems.push(`${item.uid}: choose days the visit runs.`);
      continue;
    }
    const current = args.assignments.find((a) => a.uid === item.uid && holds(a));
    if (current) {
      problems.push(`${item.uid} already has this visit (${current.status}).`);
      continue;
    }
    const reasons: string[] = [];
    const e = args.eligible.get(item.uid);
    if (!e?.eligible) reasons.push(`not eligible: ${(e?.reasons ?? ['unknown']).join('; ')}`);
    if (!(args.capabilities.get(item.uid) ?? []).includes(item.role)) reasons.push(`not set up for ${DAY_ROLE_LABEL[item.role]}`);
    if (reasons.length) {
      const reason = (args.overrides[item.uid] ?? '').trim();
      if (!reason) {
        problems.push(`${item.uid} is ${reasons.join(', and ')}.`);
        continue;
      }
      if (!args.mayOverride) {
        problems.push('Only the project manager can book someone who is not eligible or not set up for the job.');
        continue;
      }
    }
    offer.push(item);
  }
  // No day may end up with more people on a job than it needs.
  const after = [...args.assignments, ...offer.map((o) => ({ ...o, status: 'offered' as const }))];
  for (const c of coverageByDay(args.days, args.roleNeeds, after)) {
    for (const role of DAY_ROLES) {
      const held = c[role].offered + c[role].confirmed;
      if (held > c[role].need) problems.push(`${c.date}: ${held} for ${DAY_ROLE_LABEL[role]}, but only ${c[role].need} needed.`);
    }
  }
  return problems.length ? { offer: [], problems } : { offer, problems };
}

export interface SuggestCandidate {
  uid: string;
  name: string;
  eligible: boolean;
  capabilities: DayRole[];
  level: Level | null;
  training: number;
  pilots: number;
  /** The visit's days they are available for. */
  availableDates: string[];
}

/**
 * The strongest team the people available can make: for each job (the scarcer
 * first), the most experienced eligible people who do that job, each for every
 * day they are free that still needs someone, so the same people carry across
 * the days; training and pilots break ties; nobody gets two jobs. People who do
 * only that job come before equally experienced people who do both, so the
 * others stay free for the job only they can do.
 */
export function suggestTeam(args: { days: VisitDay[]; roleNeeds: RoleNeeds; candidates: SuggestCandidate[]; assignments: Assignment[] }): OfferItem[] {
  const cover = coverageByDay(args.days, args.roleNeeds, args.assignments);
  const left = new Map<string, number>();
  for (const c of cover) for (const role of DAY_ROLES) left.set(`${c.date}|${role}`, placesLeftOn(c, role));
  const taken = new Set(args.assignments.filter(holds).map((a) => a.uid));
  const pool = args.candidates.filter((c) => c.eligible && !taken.has(c.uid) && c.availableDates.length);
  const capable = (role: DayRole) => pool.filter((c) => c.capabilities.includes(role)).length;
  const shortBy = (role: DayRole) => cover.reduce((n, c) => n + placesLeftOn(c, role), 0);
  // The job with fewest people who can do it, for what it still needs, goes first.
  const order = [...DAY_ROLES].sort((a, b) => capable(a) / Math.max(1, shortBy(a)) - capable(b) / Math.max(1, shortBy(b)));
  const out: OfferItem[] = [];
  for (const role of order) {
    const people = pool
      .filter((c) => c.capabilities.includes(role) && !out.some((o) => o.uid === c.uid))
      .sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || a.capabilities.length - b.capabilities.length || b.training + b.pilots - (a.training + a.pilots) || b.availableDates.length - a.availableDates.length || a.name.localeCompare(b.name));
    for (const p of people) {
      const dates = cover.map((c) => c.date).filter((d) => p.availableDates.includes(d) && (left.get(`${d}|${role}`) ?? 0) > 0);
      if (!dates.length) continue;
      for (const d of dates) left.set(`${d}|${role}`, (left.get(`${d}|${role}`) ?? 0) - 1);
      out.push({ uid: p.uid, role, dates });
    }
  }
  return out;
}

/** An answer to an offer: only an open offer can be confirmed or declined, by the person it was made to. */
export function respond(current: AssignmentStatus | undefined, response: unknown): { next: AssignmentStatus | null; problem: string | null } {
  if (response !== 'confirm' && response !== 'decline') return { next: null, problem: 'Say confirm or decline.' };
  if (current === 'confirmed') return { next: null, problem: 'You have confirmed this visit, so it cannot be cancelled here. To withdraw, email the project manager.' };
  if (current !== 'offered') return { next: null, problem: current ? `This place is already ${current}.` : 'There is no offer for you on this visit.' };
  return { next: response === 'confirm' ? 'confirmed' : 'declined', problem: null };
}

/**
 * Taking someone off a visit. An offer not yet answered can be withdrawn by the
 * research team; a confirmed place only by the project manager, with a reason,
 * for every day or for some of them.
 */
export function removalProblem(current: AssignmentStatus | undefined, action: 'withdraw-offer' | 'remove-confirmed', role: Role, reason: string, dates?: { chosen: string[]; held: string[] }): string | null {
  if (action === 'withdraw-offer') {
    if (current === 'offered') return null;
    if (current === 'confirmed') return 'They have confirmed: only the project manager can remove them, with a reason.';
    return 'There is no open offer to withdraw.';
  }
  if (role !== 'pm') return 'Only the project manager can remove someone who has confirmed.';
  if (current !== 'confirmed') return 'They have not confirmed this visit.';
  if (!reason.trim()) return 'Give the reason for removing them (it is recorded and sent to them).';
  if (dates && (!dates.chosen.length || dates.chosen.some((d) => !dates.held.includes(d)))) return 'Choose days they are booked for.';
  return null;
}

/** The visit's status after its places change: locked once every day has every job confirmed, back to staffing when a place opens up. */
export function visitStatusAfter(status: VisitStatus, days: VisitDay[], roleNeeds: RoleNeeds, assignments: Assignment[]): VisitStatus {
  if (status === 'provisional') return status;
  if (status === 'cancelled' || status === 'done' || status === 'draft') return status === 'draft' && assignments.some(holds) ? 'staffing' : status;
  return fullyStaffed(days, roleNeeds, assignments) ? 'locked' : 'staffing';
}

/* ── Retention ────────────────────────────────────────────────────────── */

/** Copies to delete: everything kept for someone archived longer ago than the retention period. */
export function copiesToDelete(people: { uid: string; status: UserStatus; archivedAt: string | null }[], docs: { id: string; uid: string; path: string | null; deletedAt?: string | null }[], settings: Settings, now: Date): string[] {
  const cutoff = now.getTime() - settings.retentionDays * 86_400_000;
  const due = new Set(people.filter((p) => p.status === 'archived' && p.archivedAt && Date.parse(p.archivedAt) <= cutoff).map((p) => p.uid));
  return docs.filter((d) => due.has(d.uid) && d.path && !d.deletedAt).map((d) => d.id);
}

/** Verified documents running out within the warning window, not yet warned about for this expiry date. */
export function expiryWarnings(docs: PortalDoc[], types: Map<string, DocType>, settings: Settings, today: string, warned: Set<string>): { doc: PortalDoc; until: string }[] {
  const out: { doc: PortalDoc; until: string }[] = [];
  for (const doc of latestDocs(docs).values()) {
    if (doc.status !== 'verified' || doc.deletedAt) continue;
    const until = validUntil(doc, types.get(doc.typeId), settings);
    if (!until || until < today || until > addDaysIso(today, settings.expiringSoonDays)) continue;
    if (warned.has(`${doc.id}|${until}`)) continue;
    out.push({ doc, until });
  }
  return out;
}

/* ── Messages ─────────────────────────────────────────────────────────── */

export function niceDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

export interface VisitInfo {
  schoolName: string;
  /** The days the visit runs. */
  days: VisitDay[];
  location: string;
}

/** "Friday 20 November 2026, 08:30 to 15:00", one line per day. */
export function whenLines(days: VisitDay[]): string[] {
  return includedDays(days).map((d) => `${niceDate(d.date)}, ${d.start} to ${d.end}`);
}

/** "on Friday 20 November 2026", or "from Friday 20 to Tuesday 24 November 2026 (3 days)". */
export function whenShort(days: VisitDay[]): string {
  const on = includedDays(days);
  if (!on.length) return '';
  if (on.length === 1) return `on ${niceDate(on[0].date)}`;
  return `from ${niceDate(on[0].date)} to ${niceDate(on.at(-1)!.date)} (${on.length} days)`;
}

export const placeOf = (v: VisitInfo) => [v.schoolName, v.location].filter(Boolean).join(', ');

/** The job line in messages: "Your role: EEG". */
const roleLine = (role?: DayRole) => (role ? [`Your role: ${DAY_ROLE_LABEL[role]}`] : []);

/** `v.days` are the days the person is offered (their days, not necessarily the whole visit). */
export function offerMessage(name: string, v: VisitInfo, link: string, role?: DayRole): { title: string; body: string; subject: string; email: string } {
  const lines = whenLines(v.days);
  const as = role ? ` (${DAY_ROLE_LABEL[role]})` : '';
  return {
    title: `You've been selected: ${v.schoolName}${as}`,
    body: `${role ? `${DAY_ROLE_LABEL[role]}, ` : ''}${lines.length === 1 ? lines[0] : `${lines.length} days, ${whenShort(v.days)}`}. ${v.location}. Please confirm or decline in the portal.`,
    subject: `MyPhone/MyBrain: you're selected for ${v.schoolName} ${whenShort(v.days)}${as}`,
    email: [`Hello ${name},`, '', `You've been selected to help at a MyPhone/MyBrain school visit:`, '', v.schoolName, ...roleLine(role), `Where: ${v.location}`, ...(lines.length > 1 ? ['On these days:'] : []), ...lines, '', `Please confirm or decline as soon as you can: ${link}`, '', 'Once you confirm, you are booked for every day listed.', '', 'The MyPhone/MyBrain team, University of Leeds'].join('\n'),
  };
}

export function confirmationMessage(name: string, v: VisitInfo, link: string, contact: { name: string; email: string } = DEFAULT_SETTINGS.withdrawalContact, role?: DayRole): { subject: string; email: string } {
  const lines = whenLines(v.days);
  return {
    subject: `MyPhone/MyBrain: confirmed for ${v.schoolName} ${whenShort(v.days)}${role ? ` (${DAY_ROLE_LABEL[role]})` : ''}`,
    email: [
      `Hello ${name},`,
      '',
      `Thank you: you're confirmed for this MyPhone/MyBrain school visit.`,
      '',
      v.schoolName,
      ...roleLine(role),
      `Where: ${v.location}`,
      ...(lines.length > 1 ? ['On these days:'] : []),
      ...lines,
      '',
      `The calendar invitation is attached${lines.length > 1 ? ', with every day' : ''}. Please bring your University ID card.`,
      `If you can no longer do it, email ${contact.name} at ${contact.email} as soon as you can: places cannot be cancelled in the portal once confirmed.`,
      '',
      `Your visits: ${link}`,
      '',
      'The MyPhone/MyBrain team, University of Leeds',
    ].join('\n'),
  };
}

/** `v.days` are the days taken off; `kept` any days they are still booked for. */
export function removalMessage(name: string, v: VisitInfo, reason: string, link: string, kept: VisitDay[] = []): { subject: string; email: string } {
  return {
    subject: `MyPhone/MyBrain: you're no longer booked for ${v.schoolName} ${whenShort(v.days)}`,
    email: [
      `Hello ${name},`,
      '',
      `The project manager has taken you off ${kept.length ? 'some days of ' : ''}this school visit:`,
      '',
      v.schoolName,
      `Where: ${v.location}`,
      ...whenLines(v.days),
      '',
      `Reason: ${reason}`,
      ...(kept.length ? ['', 'You are still booked for:', ...whenLines(kept)] : []),
      '',
      'A calendar update is attached to remove those days from your calendar.',
      '',
      `Your visits: ${link}`,
      '',
      'The MyPhone/MyBrain team, University of Leeds',
    ].join('\n'),
  };
}

export function changeMessage(name: string, v: VisitInfo, removedDays: VisitDay[], link: string): { subject: string; email: string } {
  const lines = whenLines(v.days);
  return {
    subject: `MyPhone/MyBrain: ${v.schoolName} visit changed`,
    email: [
      `Hello ${name},`,
      '',
      `The details of a school visit you're confirmed for have changed. Here they are now:`,
      '',
      v.schoolName,
      `Where: ${v.location}`,
      ...(lines.length > 1 ? ['On these days:'] : []),
      ...lines,
      ...(removedDays.length ? ['', `No longer needed: ${removedDays.map((d) => niceDate(d.date)).join(', ')}.`] : []),
      '',
      'An updated calendar invitation is attached. If you can no longer do it, email the project manager as soon as you can.',
      '',
      `Your visits: ${link}`,
      '',
      'The MyPhone/MyBrain team, University of Leeds',
    ].join('\n'),
  };
}

/* ── Provisional dates: asking who could do them (3 November 2026) ──── */

export type CanvassAnswer = 'yes' | 'maybe' | 'no';
export const CANVASS_ANSWERS: CanvassAnswer[] = ['yes', 'maybe', 'no'];
export const CANVASS_LABEL: Record<CanvassAnswer, string> = { yes: 'Can do', maybe: 'Maybe', no: 'Can’t do' };
/** How an answer is kept as the person's availability for that day. */
export const CANVASS_AVAILABILITY: Record<CanvassAnswer, Availability> = { yes: 'all', maybe: 'maybe', no: 'no' };

/** A research assistant's answers for a provisional visit: one per day it runs, can do, maybe or can't do. */
export function validateCanvass(input: unknown, days: VisitDay[], status: VisitStatus): { answers: Record<string, CanvassAnswer>; problems: string[] } {
  if (status !== 'provisional') return { answers: {}, problems: ['These dates are no longer provisional.'] };
  const on = new Set(includedDays(days).map((d) => d.date));
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const answers: Record<string, CanvassAnswer> = {};
  const problems: string[] = [];
  for (const [date, a] of Object.entries(o)) {
    if (!on.has(date)) problems.push(`${date} is not one of the visit's days.`);
    else if (!CANVASS_ANSWERS.includes(a as CanvassAnswer)) problems.push(`${date}: answer can do, maybe or can't do.`);
    else answers[date] = a as CanvassAnswer;
  }
  if (!problems.length && !Object.keys(answers).length) problems.push('Answer for at least one day.');
  return { answers, problems };
}

export interface CanvassRow {
  uid: string;
  name: string;
  answers: Record<string, CanvassAnswer>;
}

/** Per day of a provisional visit: who can, who might, who can't, and who hasn't answered. */
export function canvassSummary(days: VisitDay[], rows: CanvassRow[], everyone: { uid: string; name: string }[]) {
  return includedDays(days).map((d) => {
    const by = (a: CanvassAnswer) => rows.filter((r) => r.answers[d.date] === a).map((r) => r.name).sort();
    const answered = new Set(rows.filter((r) => r.answers[d.date]).map((r) => r.uid));
    return { date: d.date, start: d.start, end: d.end, yes: by('yes'), maybe: by('maybe'), no: by('no'), noAnswer: everyone.filter((p) => !answered.has(p.uid)).map((p) => p.name).sort() };
  });
}

/** Answers that still stand after the dates change: only for days that run, at the same times as before. */
export function answersAfterChange(answers: Record<string, CanvassAnswer>, before: VisitDay[], after: VisitDay[]): Record<string, CanvassAnswer> {
  const was = new Map(includedDays(before).map((d) => [d.date, `${d.start}-${d.end}`]));
  const out: Record<string, CanvassAnswer> = {};
  for (const d of includedDays(after)) if (answers[d.date] && was.get(d.date) === `${d.start}-${d.end}`) out[d.date] = answers[d.date];
  return out;
}

/* ── Announcing dates ─────────────────────────────────────────────────── */

export type Announcement = 'provisional' | 'new-dates' | 'confirmed' | 'cancelled-provisional' | 'provisional-changed' | 'days-added';

/**
 * What, if anything, research assistants hear when a visit is saved or its
 * status changes: dates put out as provisional; dates published (straight
 * from draft, or confirmed after being provisional); provisional dates
 * cancelled or changed; days added to a visit already open.
 */
export function announcementFor(before: { status: VisitStatus; days: VisitDay[] } | null, after: { status: VisitStatus; days: VisitDay[] }): { kind: Announcement; days: VisitDay[] } | null {
  const was = before?.status ?? 'draft';
  const open = (s: VisitStatus) => s === 'staffing' || s === 'locked';
  if (after.status === 'provisional' && was !== 'provisional') return { kind: 'provisional', days: includedDays(after.days) };
  if (after.status === 'cancelled' && was === 'provisional') return { kind: 'cancelled-provisional', days: includedDays(before!.days) };
  if (open(after.status) && was === 'provisional') return { kind: 'confirmed', days: includedDays(after.days) };
  if (open(after.status) && was === 'draft') return { kind: 'new-dates', days: includedDays(after.days) };
  if (before && after.status === 'provisional' && was === 'provisional' && scheduleChanged({ startDate: '', endDate: '', start: '', end: '', location: '', days: before.days, roleNeeds: DEFAULT_SETTINGS.roleNeeds, travel: travelOf({}) }, { startDate: '', endDate: '', start: '', end: '', location: '', days: after.days, roleNeeds: DEFAULT_SETTINGS.roleNeeds, travel: travelOf({}) }).changed) return { kind: 'provisional-changed', days: includedDays(after.days) };
  if (before && open(after.status) && open(was)) {
    const had = new Set(includedDays(before.days).map((d) => d.date));
    const added = includedDays(after.days).filter((d) => !had.has(d.date));
    if (added.length) return { kind: 'days-added', days: added };
  }
  return null;
}

export interface NotifyPrefs {
  /** Push and email when new dates are announced (offers, changes and removals always come). */
  newDatesPush: boolean;
  newDatesEmail: boolean;
}
export function notifyPrefsOf(v: unknown): NotifyPrefs {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { newDatesPush: o.newDatesPush !== false, newDatesEmail: o.newDatesEmail !== false };
}

const shortDay = (iso: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
/** "Fri 20 Nov, Tue 24 Nov", or the first and last of a long run. */
export function datesShort(days: VisitDay[]): string {
  const on = includedDays(days);
  if (on.length <= 3) return on.map((d) => shortDay(d.date)).join(', ');
  return `${shortDay(on[0].date)} to ${shortDay(on.at(-1)!.date)} (${on.length} days)`;
}

/**
 * The words for an announcement: the push (only the school and the dates,
 * nothing personal), the in-portal note and the email.
 */
export function announcementMessage(kind: Announcement, schoolName: string, days: VisitDay[], location: string, link: string, name = 'there') {
  const dates = datesShort(days);
  const lines = whenLines(days);
  const t: Record<Announcement, { push: string; title: string; body: string; subject: string; lead: string; ask: string }> = {
    provisional: { push: `Possible school dates (not yet confirmed): ${schoolName}, ${dates}. Tell us if you could do them.`, title: `Possible dates: ${schoolName}`, body: `Not yet confirmed: ${dates}. Tell us if you could do them.`, subject: `MyPhone/MyBrain: possible school dates (not yet confirmed), ${schoolName}`, lead: 'These school visit dates are provisional: they are not yet confirmed with the school. Could you do them?', ask: 'Tell us day by day (can do, maybe, can’t do)' },
    'new-dates': { push: `New school dates: ${schoolName}, ${dates}. Mark your availability.`, title: `New dates: ${schoolName}`, body: `${dates}. Mark your availability.`, subject: `MyPhone/MyBrain: new school dates, ${schoolName}`, lead: 'New school visit dates are out:', ask: 'Mark your availability' },
    confirmed: { push: `School dates confirmed: ${schoolName}, ${dates}.`, title: `Dates confirmed: ${schoolName}`, body: `${dates} are now confirmed. The team will offer places soon.`, subject: `MyPhone/MyBrain: school dates confirmed, ${schoolName}`, lead: 'The school has confirmed these visit dates. The team will now offer places; if you said you could do them, keep an eye out for an offer.', ask: 'Check your availability' },
    'cancelled-provisional': { push: `Possible school dates won't go ahead: ${schoolName}, ${dates}.`, title: `Not going ahead: ${schoolName}`, body: `The possible dates ${dates} won't go ahead. Thank you for answering.`, subject: `MyPhone/MyBrain: possible dates at ${schoolName} won't go ahead`, lead: 'The possible school visit dates you answered about will not go ahead. Thank you for letting us know if you could do them.', ask: 'See other dates' },
    'provisional-changed': { push: `Possible school dates changed: ${schoolName}, ${dates}. Please check again.`, title: `Possible dates changed: ${schoolName}`, body: `Now ${dates}. Please check your answers again.`, subject: `MyPhone/MyBrain: possible school dates changed, ${schoolName}`, lead: 'The provisional dates you answered about have changed. Please check your answers again (answers for days that changed have been cleared):', ask: 'Check your answers' },
    'days-added': { push: `New school dates: ${schoolName}, ${dates}. Mark your availability.`, title: `New dates: ${schoolName}`, body: `${dates} added. Mark your availability.`, subject: `MyPhone/MyBrain: new school dates, ${schoolName}`, lead: 'More days have been added to a school visit:', ask: 'Mark your availability' },
  };
  const w = t[kind];
  return {
    push: { title: w.title, body: w.push },
    note: { title: w.title, body: w.body, link: link.slice(link.indexOf('#')) },
    email: { subject: w.subject, body: [`Hello ${name},`, '', w.lead, '', schoolName, ...(location ? [`Where: ${location}`] : []), ...lines, '', `${w.ask}: ${link}`, '', 'You can turn off emails and notifications about new dates in your details in the portal.', '', 'The MyPhone/MyBrain team, University of Leeds'].join('\n') },
  };
}

/* ── Attendance (4 November 2026) ─────────────────────────────────────── */

export type AttendanceMark = 'attended' | 'absent' | 'late' | 'left-early';
export const ATTENDANCE_MARKS: AttendanceMark[] = ['attended', 'absent', 'late', 'left-early'];
export const ATTENDANCE_LABEL: Record<AttendanceMark, string> = { attended: 'Attended', absent: 'Absent', late: 'Late', 'left-early': 'Left early' };
export const isAttendanceMark = (v: unknown): v is AttendanceMark => ATTENDANCE_MARKS.includes(v as AttendanceMark);
/** Late or leaving early still counts as a day attended. */
export const wasThere = (m: AttendanceMark) => m !== 'absent';

export interface AttendanceRecord {
  visitId: string;
  uid: string;
  date: string;
  mark: AttendanceMark;
  note: string;
}

/** Hours between two times on a day, such as 08:30 to 15:00 (6.5). */
export function hoursBetween(start: string, end: string): number {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return Math.max(0, (m(end) - m(start)) / 60);
}

/** Marking a day: only a day the visit ran (today or earlier), only for people confirmed that day. */
export function attendanceProblem(day: VisitDay | undefined, today: string, confirmedThatDay: Set<string>, marks: { uid: string; mark: unknown }[]): string | null {
  if (!day || !day.on) return 'That is not one of the visit’s days.';
  if (day.date > today) return 'Attendance can be marked from the day itself.';
  if (!marks.length) return 'Mark at least one person.';
  for (const m of marks) {
    if (!confirmedThatDay.has(m.uid)) return 'Mark only people confirmed for that day.';
    if (!isAttendanceMark(m.mark)) return 'Choose attended, absent, late or left early.';
  }
  return null;
}

/** Past days with confirmed people not all marked: what the overview reminds the team about. */
export function attendanceDue(visits: { visitId: string; days: VisitDay[]; assignments: Assignment[] }[], marked: Set<string>, today: string): { visitId: string; date: string; unmarked: number }[] {
  const out: { visitId: string; date: string; unmarked: number }[] = [];
  for (const v of visits) {
    for (const d of includedDays(v.days)) {
      if (d.date > today) continue;
      const people = v.assignments.filter((a) => a.status === 'confirmed' && a.dates.includes(d.date));
      const unmarked = people.filter((a) => !marked.has(`${v.visitId}|${a.uid}|${d.date}`)).length;
      if (unmarked) out.push({ visitId: v.visitId, date: d.date, unmarked });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ── Reports ──────────────────────────────────────────────────────────── */

export interface ReportVisit {
  visitId: string;
  schoolId: string;
  schoolName: string;
  days: VisitDay[];
  roleNeeds: RoleNeeds;
  assignments: Assignment[];
}

export interface PersonReportRow {
  uid: string;
  name: string;
  offeredDays: number;
  confirmedDays: number;
  attended: number;
  absent: number;
  late: number;
  leftEarly: number;
  hours: number;
  eegDays: number;
  coproDays: number;
}

export interface VisitReportDay {
  visitId: string;
  schoolName: string;
  date: string;
  start: string;
  end: string;
  eegNeed: number;
  coproNeed: number;
  eegConfirmed: number;
  coproConfirmed: number;
  attended: string[];
  absent: string[];
  notMarked: string[];
}

/**
 * Who was offered, confirmed and turned up, between two dates (and for one
 * school or one person if asked): per person, per visit day, and in total.
 * Hours are each attended day's times; days by job count days attended.
 */
export function buildReport(args: { visits: ReportVisit[]; attendance: AttendanceRecord[]; people: { uid: string; name: string }[]; from: string; to: string; schoolId?: string | null; uid?: string | null }) {
  const inRange = (d: string) => d >= args.from && d <= args.to;
  const visits = args.visits.filter((v) => !args.schoolId || v.schoolId === args.schoolId);
  const markOf = new Map(args.attendance.map((a) => [`${a.visitId}|${a.uid}|${a.date}`, a.mark]));
  const name = (uid: string) => args.people.find((p) => p.uid === uid)?.name ?? uid;
  const rows = new Map<string, PersonReportRow>();
  const row = (uid: string) => {
    if (!rows.has(uid)) rows.set(uid, { uid, name: name(uid), offeredDays: 0, confirmedDays: 0, attended: 0, absent: 0, late: 0, leftEarly: 0, hours: 0, eegDays: 0, coproDays: 0 });
    return rows.get(uid)!;
  };
  const days: VisitReportDay[] = [];
  for (const v of visits) {
    for (const d of includedDays(v.days)) {
      if (!inRange(d.date)) continue;
      const need = needsOn(d, v.roleNeeds);
      const here = v.assignments.filter((a) => a.dates.includes(d.date) && (!args.uid || a.uid === args.uid));
      const confirmed = here.filter((a) => a.status === 'confirmed');
      for (const a of here) {
        if (a.status === 'withdrawn') continue;
        const r = row(a.uid);
        r.offeredDays += 1;
        if (a.status !== 'confirmed') continue;
        r.confirmedDays += 1;
        const mark = markOf.get(`${v.visitId}|${a.uid}|${d.date}`);
        if (!mark) continue;
        if (mark === 'absent') r.absent += 1;
        else {
          r.attended += 1;
          if (mark === 'late') r.late += 1;
          if (mark === 'left-early') r.leftEarly += 1;
          r.hours += hoursBetween(d.start, d.end);
          if (a.role === 'eeg') r.eegDays += 1;
          else r.coproDays += 1;
        }
      }
      const marked = (want: (m: AttendanceMark | undefined) => boolean) => confirmed.filter((a) => want(markOf.get(`${v.visitId}|${a.uid}|${d.date}`))).map((a) => name(a.uid)).sort();
      days.push({
        visitId: v.visitId,
        schoolName: v.schoolName,
        date: d.date,
        start: d.start,
        end: d.end,
        eegNeed: need.eeg,
        coproNeed: need.copro,
        eegConfirmed: confirmed.filter((a) => a.role === 'eeg').length,
        coproConfirmed: confirmed.filter((a) => a.role === 'copro').length,
        attended: marked((m) => !!m && wasThere(m)),
        absent: marked((m) => m === 'absent'),
        notMarked: marked((m) => !m),
      });
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date) || a.schoolName.localeCompare(b.schoolName));
  const people = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  const sum = (k: keyof PersonReportRow) => people.reduce((n, r) => n + Number(r[k]), 0);
  return {
    people,
    days,
    totals: { visits: new Set(days.map((d) => d.visitId)).size, days: days.length, offeredDays: sum('offeredDays'), confirmedDays: sum('confirmedDays'), attended: sum('attended'), absent: sum('absent'), hours: Math.round(sum('hours') * 10) / 10, notMarked: days.reduce((n, d) => n + d.notMarked.length, 0) },
  };
}

/** A table as CSV (comma-separated, quoted where needed), for spreadsheets. */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

/* ── Emails to schools (4 November 2026) ──────────────────────────────── */

export interface DbsInfo {
  certificateNumber: string;
  issueDate: string;
  updateService: boolean;
}

/** Who is confirmed on each day: what the school is told, and what a later change is measured against. */
export function confirmedSnapshot(days: VisitDay[], assignments: Assignment[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const d of includedDays(days)) out[d.date] = assignments.filter((a) => a.status === 'confirmed' && a.dates.includes(d.date)).map((a) => a.uid).sort();
  return out;
}

/** Whether the people confirmed (or the days) changed since the school was last told. */
export function changedSince(before: Record<string, string[]> | null, now: Record<string, string[]>): boolean {
  if (!before) return false;
  const key = (s: Record<string, string[]>) => Object.keys(s).sort().map((d) => `${d}:${s[d].join(',')}`).join('|');
  return key(before) !== key(now);
}

export const DEFAULT_SCHOOL_INTRO = 'Thank you for hosting the MyPhone/MyBrain team. Below are the dates of our visit and the members of our team who will be with you on each day.';

/**
 * The email to a school: the visit's days and place, and on each day the full
 * names of the people coming (never their jobs). DBS details never go in an
 * email (4 November 2026): with "Include DBS details" on, it points the school
 * to its own password-protected DBS page instead. `dbsChecked` says who has a
 * DBS the project manager checked, so the sender can be warned about the rest.
 */
export function schoolEmail(args: {
  schoolName: string;
  contactName: string;
  location: string;
  days: VisitDay[];
  people: Map<string, string>;
  snapshot: Record<string, string[]>;
  intro: string;
  team: { name: string; email: string };
  /** With DBS details: the school's DBS page and who to ask for the password. */
  dbsPage: { url: string; contactName: string; contactEmail: string } | null;
  dbsChecked: Set<string>;
  update?: boolean;
}): { subject: string; body: string; dbsMissing: string[]; people: number } {
  const on = includedDays(args.days);
  const everyone = [...new Set(on.flatMap((d) => args.snapshot[d.date] ?? []))];
  const nameOf = (uid: string) => args.people.get(uid) ?? uid;
  const dbsMissing = args.dbsPage ? everyone.filter((u) => !args.dbsChecked.has(u)).map(nameOf).sort() : [];
  const lines = [
    `Dear ${args.contactName || args.schoolName},`,
    '',
    ...(args.update ? ['This is an update to the details we sent before: the team for the visit has changed.', ''] : []),
    args.intro.trim() || DEFAULT_SCHOOL_INTRO,
    '',
    `School: ${args.schoolName}`,
    `Where: ${args.location}`,
    '',
  ];
  for (const d of on) {
    const who = (args.snapshot[d.date] ?? []).map(nameOf).sort();
    lines.push(`${niceDate(d.date)}, ${d.start} to ${d.end}`, ...(who.length ? who.map((n) => `  ${n}`) : ['  (to be confirmed)']), '');
  }
  if (args.dbsPage) {
    lines.push(
      `You can see the DBS details for everyone attending at ${args.dbsPage.url}`,
      `The password is the one our project manager gave you by phone; if you don't have it, please contact ${args.dbsPage.contactName} at ${args.dbsPage.contactEmail}.`,
      '',
    );
  }
  lines.push(`If you have any questions, please contact ${args.team.name} at ${args.team.email}.`, '', 'With thanks,', 'The MyPhone/MyBrain team, University of Leeds');
  const first = on[0]?.date;
  const last = on.at(-1)?.date;
  const when = first ? (first === last ? niceDate(first) : `${niceDate(first)} to ${niceDate(last!)}`) : '';
  return { subject: `MyPhone/MyBrain visit${args.update ? ' (updated)' : ''}: ${args.schoolName}, ${when}`, body: lines.join('\n'), dbsMissing, people: everyone.length };
}

/**
 * What a school's DBS page shows: its visits still to come or ended within the
 * last 30 days (not drafts, provisional or cancelled), by date, the people
 * confirmed, each with the DBS details the project manager checked, or none
 * ("being checked").
 */
export function dbsPageRows(args: { visits: { visitId: string; status: VisitStatus; days: VisitDay[]; location: string; assignments: Assignment[] }[]; today: string; names: Map<string, string>; dbs: Map<string, (DbsInfo & { docId: string | null }) | null> }) {
  const since = addDaysIso(args.today, -30);
  return args.visits
    .filter((v) => v.status === 'staffing' || v.status === 'locked' || v.status === 'done')
    .map((v) => ({
      visitId: v.visitId,
      location: v.location,
      days: includedDays(v.days)
        .filter((d) => d.date >= since)
        .map((d) => ({
          date: d.date,
          start: d.start,
          end: d.end,
          people: v.assignments
            .filter((a) => a.status === 'confirmed' && a.dates.includes(d.date))
            .map((a) => ({ uid: a.uid, name: args.names.get(a.uid) ?? a.uid, dbs: args.dbs.get(a.uid) ?? null }))
            .sort((x, y) => x.name.localeCompare(y.name)),
        })),
    }))
    .filter((v) => v.days.length)
    .sort((a, b) => a.days[0].date.localeCompare(b.days[0].date));
}

/* ── Emails to the team (4 November 2026) ─────────────────────────────── */

/** "7:45 am" from "07:45". */
export function clock(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
const weekdayOf = (iso: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const dayHeading = (iso: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
/** "Grace", "Grace and Ali", "Grace, Ali and Sam". */
export function andList(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
/** "4–6 November", "30 November–2 December". */
export function dateRange(first: string, last: string): string {
  const f = (iso: string, month: boolean) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', ...(month ? { month: 'long' } : {}), timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
  if (first === last) return f(first, true);
  return first.slice(0, 7) === last.slice(0, 7) ? `${f(first, false)}–${f(last, true)}` : `${f(first, true)}–${f(last, true)}`;
}

export interface TeamEmailDay {
  date: string;
  /** Confirmed that day: who, their job and any time note. */
  people: { uid: string; role: DayRole; note?: string }[];
  travel: Travel;
}

export interface TeamEmailSections {
  subject: string;
  intro: string;
  allocations: string;
  travel: string;
  checks: string;
  closing: string;
}

export const DEFAULT_TEAM_INTRO = 'Please see below the team allocations for the {school} sessions{range}.';
export const DEFAULT_TEAM_CLOSING = 'Thank you all for your support!\n\nBest wishes,\n{sender}';

/**
 * The allocations email to the team, by section (each editable before
 * sending): the subject; an intro ("updated … following changes to
 * availability" once allocations changed since the team was last told); each
 * day with the full names of the people on it (their jobs only if asked) and
 * any time note in brackets; travel; DBS and ID checks for anyone whose first
 * day at that school falls in these dates; and the closing, signed with the
 * sender's first name.
 */
export function teamEmail(args: { schoolName: string; days: TeamEmailDay[]; names: Map<string, string>; showRoles: boolean; firstDays: Map<string, string>; update: boolean; intro?: string; closing?: string; sender: string }): TeamEmailSections {
  const days = [...args.days].sort((a, b) => a.date.localeCompare(b.date));
  const first = days[0]?.date ?? '';
  const last = days.at(-1)?.date ?? first;
  const range = first ? dateRange(first, last) : '';
  const nameOf = (uid: string) => args.names.get(uid) ?? uid;
  const fill = (t: string) => t.replace(/\{school\}/g, args.schoolName).replace(/\{range\}/g, range ? ` (${range})` : '').replace(/\{sender\}/g, firstName(args.sender));
  const intro = args.update
    ? `Please see below the updated team allocations for the ${args.schoolName} sessions${range ? ` (${range})` : ''}, following a few changes to availability.`
    : fill(args.intro?.trim() || DEFAULT_TEAM_INTRO);
  const allocations = days
    .map((d) => {
      const people = [...d.people].sort((a, b) => (args.showRoles ? DAY_ROLES.indexOf(a.role) - DAY_ROLES.indexOf(b.role) : 0) || nameOf(a.uid).localeCompare(nameOf(b.uid)));
      const lines = people.map((p) => `${nameOf(p.uid)}${args.showRoles ? ` – ${DAY_ROLE_LABEL[p.role]}` : ''}${p.note ? ` (${p.note})` : ''}`);
      return [dayHeading(d.date), ...(lines.length ? lines : ['(nobody confirmed yet)'])].join('\n');
    })
    .join('\n\n');
  // Travel: one block if every day is the same, else a line per day.
  const travelText = (t: Travel, prefix = '') => {
    const out: string[] = [];
    if (t.arrival) out.push(`${prefix}Everyone should arrive at ${args.schoolName} by ${clock(t.arrival)}.`);
    if (t.taxiTime) out.push(`${prefix}The taxi will leave from ${t.taxiFrom}, at ${clock(t.taxiTime)}, so please make sure you're there in good time.`);
    if (t.direct) out.push(`${prefix}${t.direct}`);
    else if (t.arrival && t.taxiTime) out.push(`${prefix}If you're travelling directly to ${args.schoolName}, please make sure you arrive by ${clock(t.arrival)}.`);
    return out;
  };
  const sameTravel = days.every((d) => JSON.stringify(d.travel) === JSON.stringify(days[0]?.travel));
  const travel = days.length ? (sameTravel ? travelText(days[0].travel) : days.flatMap((d) => travelText(d.travel, `${weekdayOf(d.date)}: `))).join('\n') : '';
  // DBS and ID: everyone whose first day at the school is in these dates, grouped by that day.
  const inRange = new Set(days.map((d) => d.date));
  const firsts = new Map<string, string[]>();
  for (const d of days) for (const p of d.people) if (args.firstDays.get(p.uid) === d.date && inRange.has(d.date)) firsts.set(d.date, [...new Set([...(firsts.get(d.date) ?? []), p.uid])]);
  const checks = [...firsts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, uids]) => {
      const who = andList(uids.map((u) => firstName(nameOf(u))).sort());
      return `${who}, as ${weekdayOf(date)} will be your first day at ${args.schoolName}, please make sure you bring your original Enhanced DBS certificate and ID for the school's checks.`;
    })
    .join('\n');
  return {
    subject: `${args.schoolName} team allocations${args.update ? ' (updated)' : ''}: ${range}`,
    intro,
    allocations,
    travel,
    checks,
    closing: fill(args.closing?.trim() || DEFAULT_TEAM_CLOSING),
  };
}

/** The email from its sections: plain text, and a simple HTML version with headings. */
export function teamEmailBody(s: TeamEmailSections): { text: string; html: string } {
  const parts: [string | null, string][] = [
    [null, `Hi all,\n\n${s.intro}`],
    [null, s.allocations],
    ...(s.travel.trim() ? ([['Travel Arrangements', s.travel]] as [string, string][]) : []),
    ...(s.checks.trim() ? ([['DBS and ID Checks', s.checks]] as [string, string][]) : []),
    [null, s.closing],
  ];
  const text = parts.map(([h, b]) => (h ? `${h}\n${b.trim()}` : b.trim())).join('\n\n');
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const para = (t: string) => `<p>${esc(t.trim()).replace(/\n/g, '<br>')}</p>`;
  // The allocations: each day's first line as a heading, the names under it.
  const allocations = s.allocations
    .split(/\n\s*\n/)
    .map((block) => {
      const [head, ...rest] = block.trim().split('\n');
      return `<h3>${esc(head)}</h3>${rest.length ? para(rest.join('\n')) : ''}`;
    })
    .join('');
  const html = [para(`Hi all,\n\n${s.intro}`), allocations, ...(s.travel.trim() ? [`<h3>Travel Arrangements</h3>${para(s.travel)}`] : []), ...(s.checks.trim() ? [`<h3>DBS and ID Checks</h3>${para(s.checks)}`] : []), para(s.closing)].join('\n');
  return { text, html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">${html}</div>` };
}

/** Each person's first day at a school: the earliest day they were confirmed for on any of its visits. */
export function firstDaysAt(places: Assignment[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of places) {
    if (a.status !== 'confirmed') continue;
    for (const d of a.dates) if (!out.has(a.uid) || d < out.get(a.uid)!) out.set(a.uid, d);
  }
  return out;
}

/** Who is confirmed each day, with their jobs and time notes: what the team was told, and what a later change is measured against. */
export function teamSnapshot(days: { date: string; people: { uid: string; role: DayRole; note?: string }[] }[]): Record<string, string[]> {
  return Object.fromEntries(days.map((d) => [d.date, d.people.map((p) => `${p.uid}:${p.role}:${p.note ?? ''}`).sort()]));
}
