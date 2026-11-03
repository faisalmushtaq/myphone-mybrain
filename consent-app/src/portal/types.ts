/** What portalApi returns (firebase/functions/src/portal.ts). */
export type Role = 'pm' | 'researcher' | 'ra';
export type UserStatus = 'pending' | 'active' | 'rejected' | 'archived';
export type DocState = 'missing' | 'uploaded' | 'verified' | 'rejected' | 'expiring-soon' | 'expired';
export type Availability = 'all' | 'am' | 'pm' | 'no' | 'maybe';
export type VisitStatus = 'draft' | 'provisional' | 'staffing' | 'locked' | 'done' | 'cancelled';
export type CanvassAnswer = 'yes' | 'maybe' | 'no';
export type AssignmentStatus = 'offered' | 'confirmed' | 'declined' | 'withdrawn' | 'removed';

export interface PortalUser {
  uid: string;
  name: string;
  email: string;
  phone: string;
  role: Role | null;
  requested: 'ra' | 'team';
  status: UserStatus;
  smsOptIn: boolean;
  /** Push and email when new dates are announced. */
  notifyPrefs: { newDatesPush: boolean; newDatesEmail: boolean };
  createdAt: string | null;
  archivedAt: string | null;
}

export interface Me {
  email: string;
  user: PortalUser | null;
  unread: number;
}

export interface DocRow {
  typeId: string;
  label: string;
  hint: string;
  dbs: boolean;
  expires: boolean;
  schoolId: string | null;
  schoolName: string | null;
  state: DocState;
  docId: string | null;
  uploadedAt: string | null;
  validUntil: string | null;
  note: string | null;
  hasCopy: boolean;
  details?: { certificateNumber?: string; issueDate?: string; updateService?: boolean; expiresOn?: string };
  fileName?: string;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
}

export interface Counts {
  training: number;
  pilots: number;
}

/** The jobs on a visit day. */
export type DayRole = 'eeg' | 'copro';
export const DAY_ROLES: DayRole[] = ['eeg', 'copro'];
export const DAY_ROLE_LABEL: Record<DayRole, string> = { eeg: 'EEG', copro: 'Co-production' };
export interface RoleNeeds {
  eeg: number;
  copro: number;
}

/** A status the team gives someone (only "Ready" or "On hold" is ever shown to them). */
export interface StatusTag {
  id: string;
  label: string;
  retired?: boolean;
}
export type Level = 1 | 2 | 3 | 4;
export const LEVEL_LABEL: Record<Level, string> = { 1: 'New', 2: 'Developing', 3: 'Experienced', 4: 'Lead' };

/** What the team keeps about a person (never shown to research assistants). */
export interface TeamExtras {
  tags: StatusTag[];
  level: Level | null;
  levelReason: string;
  capabilities: DayRole[];
  availabilityNote: string;
}

/** How the team gets to the school. */
export interface Travel {
  arrival: string;
  taxiFrom: string;
  taxiTime: string;
  direct: string;
}

/** One day of a visit: whether it runs, its times, and its own numbers and travel times if they differ. */
export interface VisitDay {
  date: string;
  start: string;
  end: string;
  on: boolean;
  eeg?: number;
  copro?: number;
  arrival?: string;
  taxiTime?: string;
}

/** Each job's need on a day, and how many are offered and confirmed. */
export interface DayCoverage {
  date: string;
  start: string;
  end: string;
  eeg: { need: number; offered: number; confirmed: number };
  copro: { need: number; offered: number; confirmed: number };
}

export type AttendanceMark = 'attended' | 'absent' | 'late' | 'left-early';
export const ATTENDANCE_LABEL: Record<AttendanceMark, string> = { attended: 'Attended', absent: 'Absent', late: 'Late', 'left-early': 'Left early' };

export interface Visit {
  visitId: string;
  schoolId: string;
  schoolName: string;
  /** The period entered, and the usual times. */
  startDate: string;
  endDate: string;
  start: string;
  end: string;
  days: VisitDay[];
  /** The first and last days it runs. */
  date: string;
  lastDate: string;
  /** An address, a room or a meeting point. */
  location: string;
  roleNeeds: RoleNeeds;
  travel: Travel;
  notes: string;
  status: VisitStatus;
}

export interface Contact {
  name: string;
  email: string;
}

export interface MySummary {
  user: PortalUser;
  settings: { minTraining: number; minPilots: number; withdrawalContact: Contact };
  documents: DocRow[];
  counts: Counts;
  /** Logged by the person and waiting for the team: not counted yet. */
  waiting: { training: number; pilots: number };
  sessions: { id: string; kind: 'training' | 'pilot'; date: string; title: string }[];
  availability: { date: string; value: Availability; note: string }[];
  /** "Ready" or "On hold", when the team has said so. */
  standing: string | null;
  daysAttended: number;
  /** Visits offered to or taken by this person, with only their days: status is their place's, visitStatus the visit's. */
  assignments: (Omit<Visit, 'status'> & { status: AssignmentStatus; visitStatus: VisitStatus; removedReason: string; role: DayRole; dates: string[]; timeNotes: Record<string, string> })[];
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string | null;
}

export interface DocType {
  id: string;
  label: string;
  hint: string;
  dbs?: boolean;
  expires?: boolean;
}

export interface School {
  id: string;
  name: string;
  area: string;
  requiredDocs: DocType[];
  active: boolean;
  contactName?: string;
  contactEmails?: string[];
  includeDbs?: boolean;
  dbsCopies?: boolean;
  emailIntro?: string;
  dbsAccess?: { active: boolean; setAt: string | null; lastViewedAt: string | null; link: string };
}

export interface Settings {
  minTraining: number;
  minPilots: number;
  retentionDays: number;
  expiringSoonDays: number;
  dbsValidYears: number;
  docTypes: DocType[];
  withdrawalContact: Contact;
  tags: StatusTag[];
  roleNeeds: RoleNeeds;
  /** Copied into every portal email to people outside the sender. */
  alwaysCopy: string[];
}

export const DOC_STATE_LABEL: Record<DocState, string> = {
  missing: 'Not uploaded',
  uploaded: 'Waiting to be checked',
  verified: 'Checked',
  rejected: 'Not accepted',
  'expiring-soon': 'Runs out soon',
  expired: 'Out of date',
};

export const AVAILABILITY_LABEL: Record<Availability, string> = { all: 'All day', am: 'Morning', pm: 'Afternoon', no: 'Not available', maybe: 'Maybe' };
export const CANVASS_LABEL: Record<CanvassAnswer, string> = { yes: 'Can do', maybe: 'Maybe', no: 'Can’t do' };
export const ROLE_LABEL: Record<Role, string> = { pm: 'Project manager', researcher: 'Research team', ra: 'Research assistant' };
export const VISIT_STATUS_LABEL: Record<VisitStatus, string> = { draft: 'Draft', provisional: 'Provisional (asking who could do it)', staffing: 'Staffing', locked: 'Fully staffed', done: 'Done', cancelled: 'Cancelled' };
export const ASSIGNMENT_LABEL: Record<AssignmentStatus, string> = { offered: 'Offered: waiting for an answer', confirmed: 'Confirmed', declined: 'Declined', withdrawn: 'Withdrawn', removed: 'Removed by the project manager' };

/** "Friday 20 November 2026". */
export function longDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}
/** "Fri 20 Nov". */
export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}
export function stamp(isoTime: string | null): string {
  if (!isoTime) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).format(new Date(isoTime));
}
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** The days a visit runs. */
export const daysOn = (v: Pick<Visit, 'days'>) => v.days.filter((d) => d.on);

/** "Fri 20 Nov, 08:30–15:00", or "Fri 20 Nov to Tue 24 Nov (2 days)". */
export function visitWhen(v: Pick<Visit, 'days'>): string {
  const on = daysOn(v);
  if (!on.length) return 'No days chosen';
  if (on.length === 1) return `${shortDate(on[0].date)}, ${on[0].start}–${on[0].end}`;
  return `${shortDate(on[0].date)} to ${shortDate(on.at(-1)!.date)} (${on.length} days)`;
}

/** "7:45 am" from "07:45". */
export function clock(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** The travel on a day: the day's own times where it has them. */
export function travelOn(d: VisitDay, t: Travel): Travel {
  return { ...t, arrival: d.arrival || t.arrival, taxiTime: d.taxiTime || t.taxiTime };
}

/** Each day it runs, with its times: "Friday 20 November 2026, 08:30 to 15:00". */
export const dayLines = (v: Pick<Visit, 'days'>) => daysOn(v).map((d) => `${longDate(d.date)}, ${d.start} to ${d.end}`);

/** Saves text as a file (a calendar file, say) from the browser. */
export function saveFile(filename: string, content: string, type = 'text/calendar;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Training or a pilot someone logged themselves (4 November 2026): it counts once the team confirms it. */
export interface TrainingClaim {
  id: string;
  status: 'waiting' | 'confirmed' | 'declined';
  sessionId: string | null;
  kind: 'training' | 'pilot';
  date: string;
  title: string;
  role: DayRole | null;
  notes: string;
  ranBy: string;
  reason: string;
  createdAt: string | null;
  decidedAt: string | null;
}
