/** What portalApi returns (firebase/functions/src/portal.ts). */
export type Role = 'pm' | 'researcher' | 'ra';
export type UserStatus = 'pending' | 'active' | 'rejected' | 'archived';
export type DocState = 'missing' | 'uploaded' | 'verified' | 'rejected' | 'expiring-soon' | 'expired';
export type Availability = 'all' | 'am' | 'pm' | 'no';
export type VisitStatus = 'draft' | 'staffing' | 'locked' | 'done' | 'cancelled';
export type AssignmentStatus = 'offered' | 'confirmed' | 'declined' | 'withdrawn';

export interface PortalUser {
  uid: string;
  name: string;
  email: string;
  phone: string;
  role: Role | null;
  requested: 'ra' | 'team';
  status: UserStatus;
  smsOptIn: boolean;
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

export interface Visit {
  visitId: string;
  schoolId: string;
  schoolName: string;
  date: string;
  start: string;
  end: string;
  meetingPoint: string;
  needed: number;
  notes: string;
  status: VisitStatus;
}

export interface MySummary {
  user: PortalUser;
  settings: { minTraining: number; minPilots: number };
  documents: DocRow[];
  counts: Counts;
  sessions: { id: string; kind: 'training' | 'pilot'; date: string; title: string }[];
  availability: { date: string; value: Availability; note: string }[];
  /** Visits offered to or taken by this person: status is their place's, visitStatus the visit's. */
  assignments: (Omit<Visit, 'status'> & { status: AssignmentStatus; visitStatus: VisitStatus })[];
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
}

export interface Settings {
  minTraining: number;
  minPilots: number;
  retentionDays: number;
  expiringSoonDays: number;
  dbsValidYears: number;
  docTypes: DocType[];
}

export const DOC_STATE_LABEL: Record<DocState, string> = {
  missing: 'Not uploaded',
  uploaded: 'Waiting to be checked',
  verified: 'Checked',
  rejected: 'Not accepted',
  'expiring-soon': 'Runs out soon',
  expired: 'Out of date',
};

export const AVAILABILITY_LABEL: Record<Availability, string> = { all: 'All day', am: 'Morning', pm: 'Afternoon', no: 'Not available' };
export const ROLE_LABEL: Record<Role, string> = { pm: 'Project manager', researcher: 'Research team', ra: 'Research assistant' };
export const VISIT_STATUS_LABEL: Record<VisitStatus, string> = { draft: 'Draft', staffing: 'Staffing', locked: 'Fully staffed', done: 'Done', cancelled: 'Cancelled' };
export const ASSIGNMENT_LABEL: Record<AssignmentStatus, string> = { offered: 'Offered: waiting for an answer', confirmed: 'Confirmed', declined: 'Declined', withdrawn: 'Withdrawn' };

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
