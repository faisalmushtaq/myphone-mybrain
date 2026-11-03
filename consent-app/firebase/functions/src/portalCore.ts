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
]);
const PM_ACTIONS = new Set(['requests', 'approve', 'reject', 'set-role', 'archive', 'restore', 'verify-document', 'settings', 'save-settings', 'audit', 'override', 'remove-confirmed']);
/** Every active user, for themselves. */
const SELF_ACTIONS = new Set(['me', 'my-summary', 'update-profile', 'notifications', 'mark-read', 'register-document', 'document-url', 'set-availability', 'open-visits', 'set-interest', 'respond-offer']);
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
}

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
  };
}

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

export function countsFor(uid: string, sessions: { kind: string; attendees: string[] }[]): Counts {
  let training = 0;
  let pilots = 0;
  for (const s of sessions) {
    if (!s.attendees.includes(uid)) continue;
    if (s.kind === 'training') training += 1;
    else if (s.kind === 'pilot') pilots += 1;
  }
  return { training, pilots };
}

/* ── Availability ─────────────────────────────────────────────────────── */

export type Availability = 'all' | 'am' | 'pm' | 'no';
export const AVAILABILITY: Availability[] = ['all', 'am', 'pm', 'no'];
export const AVAILABILITY_LABEL: Record<Availability, string> = { all: 'Available all day', am: 'Morning only', pm: 'Afternoon only', no: 'Not available' };

/** Whether someone's day covers a visit's times (morning ends at 12:30, afternoon starts at 12:00). */
export function covers(day: Availability | undefined, start: string, end: string): 'yes' | 'no' | 'unknown' {
  if (!day) return 'unknown';
  if (day === 'all') return 'yes';
  if (day === 'no') return 'no';
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

export type VisitStatus = 'draft' | 'staffing' | 'locked' | 'done' | 'cancelled';
export const VISIT_STATUSES: VisitStatus[] = ['draft', 'staffing', 'locked', 'done', 'cancelled'];

/** One day of a visit: its date, its times, and whether the visit runs that day. */
export interface VisitDay {
  date: string;
  start: string;
  end: string;
  on: boolean;
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
  needed: number;
  notes: string;
}

export const MAX_VISIT_DAYS = 62;
const weekend = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};

/** The days of a period: weekdays on and weekends off unless said otherwise, at the usual times unless a day has its own. */
export function periodDays(startDate: string, endDate: string, start: string, end: string, overrides: { date: string; on?: boolean; start?: string; end?: string }[] = []): VisitDay[] {
  const out: VisitDay[] = [];
  for (let d = startDate, n = 0; d <= endDate && n < MAX_VISIT_DAYS; d = addDaysIso(d, 1), n += 1) {
    const o = overrides.find((x) => x.date === d);
    out.push({ date: d, on: typeof o?.on === 'boolean' ? o.on : !weekend(d), start: o?.start && TIME.test(o.start) ? o.start : start, end: o?.end && TIME.test(o.end) ? o.end : end });
  }
  return out;
}

export function validateVisit(input: unknown, schoolIds: string[], today: string): { visit: VisitInput | null; problems: string[] } {
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
  const needed = Number(o.needed);
  if (!Number.isInteger(needed) || needed < 1 || needed > 30) problems.push('Say how many research assistants are needed (1 to 30).');
  if (problems.length) return { visit: null, problems };
  const overrides = (Array.isArray(o.days) ? o.days : []).filter((d): d is Record<string, unknown> => !!d && typeof d === 'object').map((d) => ({ date: String(d.date ?? ''), on: typeof d.on === 'boolean' ? d.on : undefined, start: typeof d.start === 'string' ? d.start : undefined, end: typeof d.end === 'string' ? d.end : undefined }));
  for (const d of overrides) {
    if ((d.start && !TIME.test(d.start)) || (d.end && !TIME.test(d.end))) problems.push(`${d.date}: give times like 08:30.`);
  }
  const days = periodDays(startDate as string, endDate as string, o.start as string, o.end as string, overrides);
  for (const d of days) if (d.on && d.end <= d.start) problems.push(`${d.date}: the end time is before the start.`);
  if (!days.some((d) => d.on)) problems.push('Choose at least one day the visit runs.');
  if (problems.length) return { visit: null, problems };
  return { visit: { schoolId: o.schoolId as string, startDate: startDate as string, endDate: endDate as string, start: o.start as string, end: o.end as string, days, location, needed, notes: text(o.notes, 1000) }, problems };
}

export interface StoredVisit {
  startDate: string;
  endDate: string;
  start: string;
  end: string;
  days: VisitDay[];
  location: string;
}

/** A stored visit in today's shape: one saved before 3 November 2026 (a single date and a meeting point) becomes a period of one day. */
export function normaliseVisit(x: Record<string, unknown>): StoredVisit {
  const start = typeof x.start === 'string' && TIME.test(x.start) ? x.start : '08:30';
  const end = typeof x.end === 'string' && TIME.test(x.end) ? x.end : '15:00';
  const raw = Array.isArray(x.days) ? (x.days as Record<string, unknown>[]) : [];
  const days: VisitDay[] = raw.length
    ? raw.filter((d) => isIsoDate(d?.date)).map((d) => ({ date: String(d.date), on: d.on !== false, start: typeof d.start === 'string' && TIME.test(d.start) ? d.start : start, end: typeof d.end === 'string' && TIME.test(d.end) ? d.end : end }))
    : isIsoDate(x.date)
      ? [{ date: x.date, on: true, start, end }]
      : [];
  days.sort((a, b) => a.date.localeCompare(b.date));
  const location = text(x.location, 200) || text(x.meetingPoint, 200);
  return { startDate: days[0]?.date ?? String(x.date ?? ''), endDate: days.at(-1)?.date ?? String(x.date ?? ''), start, end, days, location };
}

/** The days a visit runs. */
export const includedDays = (days: VisitDay[]) => days.filter((d) => d.on);

/** Whether the visit's days or place changed in a way the people confirmed need to hear about. */
export function scheduleChanged(before: StoredVisit, after: StoredVisit): { changed: boolean; removedDays: VisitDay[] } {
  const key = (d: VisitDay) => `${d.date} ${d.start}-${d.end}`;
  const was = includedDays(before.days);
  const now = includedDays(after.days);
  const changed = before.location !== after.location || was.map(key).join('|') !== now.map(key).join('|');
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

export interface Assignment {
  uid: string;
  status: AssignmentStatus;
}

/** Places still open: needed, less those offered and not yet answered, less those confirmed. */
export function placesLeft(needed: number, assignments: Assignment[]): number {
  const held = assignments.filter((a) => a.status === 'offered' || a.status === 'confirmed').length;
  return Math.max(0, needed - held);
}

export interface OfferPlan {
  offer: string[];
  problems: string[];
}

/**
 * Which of the chosen people can be offered a place: each must be an active
 * research assistant, not already offered or confirmed, and eligible unless
 * the project manager has given a reason to override; no more than the places
 * left.
 */
export function planOffers(chosen: string[], args: { needed: number; assignments: Assignment[]; active: Set<string>; eligible: Map<string, Eligibility>; overrides: Record<string, string>; mayOverride: boolean; visitStatus: VisitStatus }): OfferPlan {
  const problems: string[] = [];
  if (args.visitStatus === 'cancelled' || args.visitStatus === 'done') return { offer: [], problems: ['This visit is closed.'] };
  const unique = [...new Set(chosen)];
  if (!unique.length) return { offer: [], problems: ['Choose who to offer the visit to.'] };
  const left = placesLeft(args.needed, args.assignments);
  if (unique.length > left) problems.push(`Only ${left} place${left === 1 ? '' : 's'} left; ${unique.length} chosen.`);
  const offer: string[] = [];
  for (const uid of unique) {
    if (!args.active.has(uid)) {
      problems.push(`${uid} is not an active research assistant.`);
      continue;
    }
    const current = args.assignments.find((a) => a.uid === uid);
    if (current && (current.status === 'offered' || current.status === 'confirmed')) {
      problems.push(`${uid} already has this visit (${current.status}).`);
      continue;
    }
    const e = args.eligible.get(uid);
    if (!e?.eligible) {
      const reason = (args.overrides[uid] ?? '').trim();
      if (!reason) {
        problems.push(`${uid} is not eligible: ${(e?.reasons ?? ['unknown']).join('; ')}.`);
        continue;
      }
      if (!args.mayOverride) {
        problems.push('Only the project manager can book someone who is not eligible.');
        continue;
      }
    }
    offer.push(uid);
  }
  return problems.length ? { offer: [], problems } : { offer, problems };
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
 * research team; a confirmed place only by the project manager, with a reason.
 */
export function removalProblem(current: AssignmentStatus | undefined, action: 'withdraw-offer' | 'remove-confirmed', role: Role, reason: string): string | null {
  if (action === 'withdraw-offer') {
    if (current === 'offered') return null;
    if (current === 'confirmed') return 'They have confirmed: only the project manager can remove them, with a reason.';
    return 'There is no open offer to withdraw.';
  }
  if (role !== 'pm') return 'Only the project manager can remove someone who has confirmed.';
  if (current !== 'confirmed') return 'They have not confirmed this visit.';
  if (!reason.trim()) return 'Give the reason for removing them (it is recorded and sent to them).';
  return null;
}

/** The visit's status after its places change: locked once every place is confirmed, back to staffing when one opens up. */
export function visitStatusAfter(status: VisitStatus, needed: number, assignments: Assignment[]): VisitStatus {
  if (status === 'cancelled' || status === 'done' || status === 'draft') return status === 'draft' && assignments.some((a) => a.status === 'offered' || a.status === 'confirmed') ? 'staffing' : status;
  const confirmed = assignments.filter((a) => a.status === 'confirmed').length;
  return confirmed >= needed ? 'locked' : 'staffing';
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

export function offerMessage(name: string, v: VisitInfo, link: string): { title: string; body: string; subject: string; email: string } {
  const lines = whenLines(v.days);
  return {
    title: `You've been selected: ${v.schoolName}`,
    body: `${lines.length === 1 ? lines[0] : `${lines.length} days, ${whenShort(v.days)}`}. ${v.location}. Please confirm or decline in the portal.`,
    subject: `MyPhone/MyBrain: you're selected for ${v.schoolName} ${whenShort(v.days)}`,
    email: [`Hello ${name},`, '', `You've been selected to help at a MyPhone/MyBrain school visit:`, '', v.schoolName, `Where: ${v.location}`, ...(lines.length > 1 ? ['On these days:'] : []), ...lines, '', `Please confirm or decline as soon as you can: ${link}`, '', 'Once you confirm, you are booked for every day listed.', '', 'The MyPhone/MyBrain team, University of Leeds'].join('\n'),
  };
}

export function confirmationMessage(name: string, v: VisitInfo, link: string, contact: { name: string; email: string } = DEFAULT_SETTINGS.withdrawalContact): { subject: string; email: string } {
  const lines = whenLines(v.days);
  return {
    subject: `MyPhone/MyBrain: confirmed for ${v.schoolName} ${whenShort(v.days)}`,
    email: [
      `Hello ${name},`,
      '',
      `Thank you: you're confirmed for this MyPhone/MyBrain school visit.`,
      '',
      v.schoolName,
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

export function removalMessage(name: string, v: VisitInfo, reason: string, link: string): { subject: string; email: string } {
  return {
    subject: `MyPhone/MyBrain: you're no longer booked for ${v.schoolName} ${whenShort(v.days)}`,
    email: [`Hello ${name},`, '', `The project manager has taken you off this school visit:`, '', v.schoolName, `Where: ${v.location}`, ...whenLines(v.days), '', `Reason: ${reason}`, '', 'A calendar update is attached to remove it from your calendar.', '', `Your visits: ${link}`, '', 'The MyPhone/MyBrain team, University of Leeds'].join('\n'),
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
