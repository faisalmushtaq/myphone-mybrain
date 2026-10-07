import { getApi } from '../api';
import { ApiError, type LabBooking } from '../api/types';
import type { SessionInfo } from '../model/types';

/**
 * Calls for the staff page and the schools' upload page: one callable each
 * (staffApi, schoolUpload in firebase/functions), with an action. The
 * session is the same anonymous one the participant pages use; the staff key
 * or the school's password travels with each call and is checked there.
 */
let session: SessionInfo | null = null;

export async function callTool<T>(name: 'staffApi' | 'schoolUpload', payload: Record<string, unknown>): Promise<T> {
  session ??= await getApi().startSession();
  try {
    return await getApi().callTool<T>(session, name, payload);
  } catch (error) {
    // An expired session: start a new one and try once more.
    if (error instanceof ApiError && error.code === 'expired') {
      session = await getApi().startSession();
      return getApi().callTool<T>(session, name, payload);
    }
    throw error;
  }
}

export function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'network') return 'Could not reach the server. Check the connection and try again.';
    return error.message || 'Something went wrong. Please try again.';
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export interface StaffSlot {
  slotId: string;
  start: string;
  end: string;
  visit: 1 | 2 | null;
  capacity: number;
  booked: number;
  status: 'open' | 'closed';
  location: string | null;
  note: string | null;
}

export interface Contact {
  email: string | null;
  mobile: string | null;
  smsReminders: boolean;
}

export interface StaffBooking extends LabBooking {
  participantCode: string;
  bookedAt: string;
  bookedBy: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  confirmation: { at?: string; email?: string; sms?: string } | null;
  reminders: Record<string, { at?: string; outcome?: string; skipped?: string; claimedAt?: string }> | null;
  contact: Contact | null;
}

export interface Overview {
  now: string;
  slots: StaffSlot[];
  bookings: StaffBooking[];
  ready: { email: boolean; sms: boolean };
  rules: { minutes: number; minNoticeHours: number; changeUntilHours: number; visit2AfterDays: { min: number; max: number }; location: string; messages: { id: string; day: number }[]; reminders: { id: string; hoursBefore: number; email: boolean; sms: boolean }[] };
}

export interface ParticipantRow {
  participantCode: string;
  consentedAt: string | null;
  pre: { archives: number; screenshots: number };
  mid: { archives: number; screenshots: number };
  post: { archives: number; screenshots: number };
  checkIns: number;
  stories: Record<string, number>;
  visit1: { start: string; status: string } | null;
  visit2: { start: string; status: string } | null;
  next: 1 | 2 | null;
  missing: string[];
  messagesPaused: boolean;
}

export interface ParticipantDetail {
  participantCode: string;
  exists: boolean;
  consentedAt: string | null;
  phases: Record<'pre' | 'mid' | 'post', { archives: number; screenshots: number }> | null;
  platformsNotUsed: string[];
  checkIns: number;
  lastCheckInAt: string | null;
  stories: Record<string, number>;
  missing: string[];
  next: 1 | 2 | null;
  window: { from: string; to: string } | null;
  bookings: StaffBooking[];
  contact: Contact;
  progressEmail: string | null;
  messages: Record<string, { at?: string; dueAt?: string; email?: string; sms?: string; skipped?: string }>;
  messagesPaused: boolean;
  links: { takePart: string; book: string; checkIn: string; after: string; story: Record<'pre' | 'mid' | 'post', string> };
}

export interface SchoolRow {
  slug: string;
  id: string;
  name: string;
  link: string;
  password: 'set' | 'revoked' | 'none';
  setAt: string | null;
  uploads: { uploadId: string; receivedAt: string | null; fileName: string; pupils: number; valid: number; problems: number; uploader: { name?: string; role?: string; email?: string } | null }[];
}

/** Copies text, falling back to selecting it for the person to copy. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const whenFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** "Wed 14 Oct, 10:00" in UK time. */
export const when = (iso: string | null | undefined) => (iso ? whenFormat.format(new Date(iso)).replace(',', '') : 'n/a');
