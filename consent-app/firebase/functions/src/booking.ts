import { FieldValue, getFirestore, Timestamp, type DocumentData, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { labBooking, labJourneyHour, labJourneyMessages, labStudy, type JourneyMessage } from './forms.js';
import { icsFor } from './ics.js';
import { normaliseCode, phaseCountsOf, rateLimitLookups } from './lab.js';
import { participantLinks } from './links.js';
import { sendMail, type MailOutcome } from './mail.js';
import { sendSms, smsReady, ukMobile, type SmsOutcome } from './sms.js';
import { addDays, atUkTime, ukClock, ukDate, ukLongDate, ukParts, ukShortDate, ukSpan } from './ukTime.js';
import { isObj, str, validateClient, type ClientInfo } from './validate.js';

/**
 * Booking the social media break study's two lab visits, and the messages
 * that keep the study moving (src/lab/booking.ts in the app says what, when
 * and how often).
 *
 *   labSlots/{id}       times the team offers: start, end, capacity, how many
 *                       are booked, open or closed, which visit (or either)
 *   labBookings/{id}    one per booking, by participant ID: the slot and its
 *                       times, booked, attended, missed or cancelled, and
 *                       every confirmation and reminder sent, with its outcome
 *   labContacts/{code}  the email address and UK mobile number given when
 *                       booking, and whether texts are wanted (identifying)
 *
 * Nothing can be booked until the data from before the break has arrived
 * (labBooking.requires); then both visits are booked together, the second
 * 28 to 35 days after the first (docs/decisions.md). Every booking, change
 * and cancellation is emailed to the participant with a calendar file per
 * visit and copied to Miftah and the team inbox (labBooking.copyTo);
 * reminders go by email and, for people who asked, by text. Every quarter of
 * an hour, labMessages sends what is due.
 */

const REGION = 'europe-west2';
const callOptions = { region: REGION, memory: '512MiB' as const, timeoutSeconds: 120, enforceAppCheck: process.env.MPMB_ENFORCE_APP_CHECK === 'true' };
const BOOKINGS_PER_HOUR = 12;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DOC_ID = /^[A-Za-z0-9]{1,40}$/;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** A reminder or message is not sent once the visit is closer than this. */
const TOO_CLOSE = 30 * 60_000;
/** A break-time message more than this overdue is skipped, never sent late. */
const STALE_AFTER = DAY;

export type Visit = 1 | 2;
export type BookingStatus = 'booked' | 'attended' | 'missed' | 'cancelled';
/** A booking still standing: a missed visit can be booked again, a cancelled one is gone. */
const ACTIVE: BookingStatus[] = ['booked', 'attended'];

export interface Place {
  name: string;
  address: string;
  directions: string;
}

export interface BookingRecord {
  id: string;
  participantCode: string;
  visit: Visit;
  slotId: string;
  start: Date;
  end: Date;
  place: Place;
  status: BookingStatus;
  bookedAt: Date;
  sequence: number;
}

export interface Contact {
  email: string | null;
  mobile: string | null;
  smsReminders: boolean;
}

export const toDate = (v: unknown): Date => (v instanceof Timestamp ? v.toDate() : v instanceof Date ? v : new Date(String(v)));

export function bookingFrom(id: string, d: DocumentData): BookingRecord {
  return {
    id,
    participantCode: String(d.participantCode),
    visit: d.visit === 2 ? 2 : 1,
    slotId: String(d.slotId ?? ''),
    start: toDate(d.start),
    end: toDate(d.end),
    place: isObj(d.place) ? { name: String(d.place.name ?? ''), address: String(d.place.address ?? ''), directions: String(d.place.directions ?? '') } : defaultPlace(),
    status: (['booked', 'attended', 'missed', 'cancelled'].includes(d.status) ? d.status : 'booked') as BookingStatus,
    bookedAt: toDate(d.bookedAt ?? d.createdAt ?? d.start),
    sequence: Number(d.sequence ?? 0),
  };
}

export const defaultPlace = (): Place => ({ ...labBooking.location });

/** Where a slot is: the study's usual place, or the slot's own (a name the team typed). */
export function placeOf(slot: DocumentData): Place {
  const own = typeof slot.location === 'string' ? slot.location.trim() : '';
  return own ? { name: own, address: '', directions: '' } : defaultPlace();
}

const visitInfo = (visit: Visit) => labBooking.visits.find((v) => v.visit === visit) ?? labBooking.visits[0];
const visitWords = (visit: Visit) => (visit === 1 ? 'first lab visit' : 'second lab visit');
const placeLine = (p: Place) => [p.name, p.address].filter(Boolean).join(', ');

/* ── Who can book what ─────────────────────────────────────────────────── */

export interface BookingState {
  consent: boolean;
  /** What has still to arrive before the visits can be booked, in plain words. */
  missing: string[];
  /** The standing booking for each visit (booked or attended). */
  active: Record<Visit, BookingRecord | null>;
  /** The visits still to book: both at first, since they are booked together; afterwards only one a missed or cancelled visit left open. */
  toBook: Visit[];
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * Where a participant stands: nothing can be booked until consent and the
 * data from before the break are in; then both visits, together. A missed or
 * cancelled visit leaves that visit to book again.
 */
export function bookingState(participant: DocumentData | undefined, bookings: BookingRecord[], _now: Date = new Date()): BookingState {
  const consent = Boolean(participant?.consentId);
  const pre = participant ? phaseCountsOf(participant).pre : { screenshots: 0, archives: 0 };
  const missing: string[] = [];
  if (!consent) missing.push('your consent');
  if (pre.screenshots < labBooking.requires.screenshots) missing.push('your screen-time screenshots');
  if (pre.archives < labBooking.requires.archives) missing.push('the cleaned data from at least one of your apps');
  const standing = (visit: Visit) =>
    bookings
      .filter((b) => b.visit === visit && ACTIVE.includes(b.status))
      .sort((a, b) => b.start.getTime() - a.start.getTime())[0] ?? null;
  const active: Record<Visit, BookingRecord | null> = { 1: standing(1), 2: standing(2) };
  const toBook = missing.length ? [] : ([1, 2] as Visit[]).filter((v) => !active[v]);
  return { consent, missing, active, toBook };
}

const GAP = labBooking.visit2AfterDays;

/**
 * The UK dates a visit can be on: the first from today; the second 28 to 35
 * days after the first; and, when only the first is being chosen against a
 * second that stays, 28 to 35 days before it.
 */
export function visitWindow(visit: Visit, other: Date | null, now: Date): { from: string; to: string } {
  const today = ukDate(now);
  const horizon = addDays(today, labBooking.horizonDays);
  if (visit === 1) {
    if (!other) return { from: today, to: horizon };
    const from = addDays(ukDate(other), -GAP.max);
    return { from: from > today ? from : today, to: addDays(ukDate(other), -GAP.min) };
  }
  if (!other) return { from: addDays(today, GAP.min), to: addDays(horizon, GAP.max) };
  return { from: addDays(ukDate(other), GAP.min), to: addDays(ukDate(other), GAP.max) };
}

/**
 * The days to list open times for on the booking page: the first visit from
 * today; the second from 28 days on, or from 28 days after a first visit that
 * has already happened. The page narrows each list to fit the other visit.
 */
export function offerWindows(state: BookingState, now: Date): Record<Visit, { from: string; to: string }> {
  const today = ukDate(now);
  const second = visitWindow(2, null, now);
  const afterFirst = state.active[1] ? visitWindow(2, state.active[1].start, now).from : second.from;
  const from = afterFirst < second.from ? (afterFirst > today ? afterFirst : today) : second.from;
  return { 1: visitWindow(1, null, now), 2: { from, to: second.to } };
}

export interface SlotView {
  slotId: string;
  start: string;
  end: string;
  visit: Visit | null;
  place: Place;
  spaces: number;
}

/** Whether a slot can take this visit now: open, not full, for this visit or either, in the window, with enough notice (unless the team is booking). */
export function slotProblem(slot: DocumentData, visit: Visit, window: { from: string; to: string } | null, now: Date, byStaff = false): string | null {
  if (slot.status !== 'open') return 'That time is no longer available. Please choose another.';
  if (Number(slot.booked ?? 0) >= Number(slot.capacity ?? 1)) return 'That time has just been taken. Please choose another.';
  if (slot.visit !== null && slot.visit !== undefined && slot.visit !== visit) return `That time is for the ${visitWords(slot.visit === 2 ? 2 : 1)}. Please choose another.`;
  const start = toDate(slot.start);
  if (start.getTime() <= now.getTime()) return 'That time has passed. Please choose another.';
  if (byStaff) return null;
  if (start.getTime() < now.getTime() + labBooking.minNoticeHours * HOUR) return `Times can be booked online up to ${labBooking.minNoticeHours} hours ahead. For anything sooner, contact ${labStudy.contactName} at ${labStudy.contactEmail}.`;
  if (window && (ukDate(start) < window.from || ukDate(start) > window.to)) {
    const between = `between ${ukLongDate(atUkTime(window.from, 12))} and ${ukLongDate(atUkTime(window.to, 12))}`;
    return visit === 2 ? `Your second visit needs to be ${GAP.min} to ${GAP.max} days after your first: ${between}.` : `Your first visit needs to be ${GAP.min} to ${GAP.max} days before your second: ${between}.`;
  }
  return null;
}

/** The open times for a visit in a window, soonest first. */
export async function openSlots(db: Firestore, visit: Visit, window: { from: string; to: string }, now: Date, byStaff = false): Promise<SlotView[]> {
  const from = atUkTime(window.from, 0);
  const to = new Date(atUkTime(window.to, 0).getTime() + DAY);
  const snap = await db.collection('labSlots').where('start', '>=', from).where('start', '<', to).orderBy('start').limit(800).get();
  return snap.docs
    .filter((d) => !slotProblem(d.data(), visit, window, now, byStaff))
    .map((d) => ({ slotId: d.id, start: toDate(d.data().start).toISOString(), end: toDate(d.data().end).toISOString(), visit: d.data().visit === 1 || d.data().visit === 2 ? d.data().visit : null, place: placeOf(d.data()), spaces: Number(d.data().capacity ?? 1) - Number(d.data().booked ?? 0) }));
}

export async function bookingsOf(db: Firestore, code: string): Promise<BookingRecord[]> {
  const snap = await db.collection('labBookings').where('participantCode', '==', code).get();
  return snap.docs.map((d) => bookingFrom(d.id, d.data()));
}

/** Whether the participant may still change or cancel this booking online. */
export const changeable = (b: BookingRecord, now: Date) => b.status === 'booked' && b.start.getTime() - now.getTime() >= labBooking.changeUntilHours * HOUR;

/* ── Calendar files and messages ───────────────────────────────────────── */

export function bookingIcs(b: BookingRecord, cancelled = false, now = new Date()): string {
  const info = visitInfo(b.visit);
  const links = participantLinks(b.participantCode);
  return icsFor(
    {
      // The same id for a visit however often it moves, so calendars update the entry instead of adding another.
      uid: `${b.participantCode}-visit-${b.visit}@myphonemybrain.com`,
      sequence: b.sequence,
      start: b.start,
      end: b.end,
      summary: info.summary,
      location: placeLine(b.place),
      description: [info.what, b.place.directions, `Participant ID: ${b.participantCode}`, `To change or cancel: ${links.book}`, `Questions: ${labStudy.contactName}, ${labStudy.contactEmail}`].filter(Boolean).join('\n'),
      url: links.book,
      status: cancelled ? 'cancelled' : 'confirmed',
    },
    now,
  );
}

export const icsName = (b: BookingRecord) => `myphone-mybrain-visit-${b.visit}.ics`;

const signOff = ['', 'The MyPhone/MyBrain team, University of Leeds'];
const contactLine = `reply to this email or contact ${labStudy.contactName} at ${labStudy.contactEmail}`;
const Contact_ = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;
const visitTitle = (visit: Visit) => (visit === 1 ? 'First lab visit' : 'Second lab visit');
const shortWhen = (b: BookingRecord) => `${ukShortDate(b.start)}, ${ukClock(b.start)}`;
const byVisit = (xs: BookingRecord[]) => [...xs].sort((a, b) => a.visit - b.visit || a.start.getTime() - b.start.getTime());

function whereLines(b: BookingRecord): string[] {
  return [`Where: ${b.place.name}`, ...(b.place.address ? [`       ${b.place.address}`] : []), ...(b.place.directions ? [`       ${b.place.directions}`] : [])];
}

/** One visit in an email: its title, when, where and what happens. */
function visitBlock(b: BookingRecord, note = ''): string[] {
  return [`${visitTitle(b.visit)}${note}`, `When:  ${ukSpan(b.start, b.end)} (UK time)`, ...whereLines(b), `What happens: ${visitInfo(b.visit).what}`];
}

const bringLines = () => ['Before each visit, please remember:', ...labBooking.bring.map((x) => `- ${x}`)];

function reminderPromise(contact: Contact): string {
  const texts = contact.smsReminders && contact.mobile;
  return texts ? 'We will email you the day before each visit, and text you the day before and on the day.' : 'We will email you a reminder the day before each visit.';
}

/**
 * The email for booked visits, changed times or cancelled visits. For a
 * booking or a change it lists every visit now standing (the new times
 * marked); for a cancellation, the visits cancelled. Copied to the study's
 * contact and the team inbox (labBooking.copyTo).
 */
export function visitsEmail(kind: 'booked' | 'moved' | 'cancelled', visits: BookingRecord[], contact: Contact, opts: { changed?: string[]; byTeam?: boolean; reason?: string } = {}): { subject: string; text: string } {
  const sorted = byVisit(visits);
  const code = sorted[0]?.participantCode ?? '';
  const links = participantLinks(code);
  const both = sorted.length > 1;
  if (kind === 'cancelled') {
    return {
      subject: both ? 'MyPhone/MyBrain: your lab visits are cancelled' : `MyPhone/MyBrain: your ${visitWords(sorted[0].visit)} on ${shortWhen(sorted[0])} is cancelled`,
      text: [
        'Hello,',
        '',
        `${both ? 'Your lab visits' : `Your ${visitWords(sorted[0].visit)}`} for the ${labStudy.name} ${both ? 'have' : 'has'} been cancelled${opts.byTeam ? ' by the research team' : ''}.${opts.reason ? ` ${opts.reason}` : ''}`,
        '',
        ...sorted.flatMap((b) => [`${visitTitle(b.visit)}: ${ukSpan(b.start, b.end)}`]),
        `Participant ID: ${code}`,
        '',
        `The attached calendar file${both ? 's remove them' : ' removes it'} from your calendar, if you added ${both ? 'them' : 'it'}.`,
        '',
        `To book again: ${links.book}`,
        '',
        `Questions? ${Contact_(contactLine)}.`,
        ...signOff,
      ].join('\n'),
    };
  }
  const changed = new Set(opts.changed ?? []);
  const intro =
    kind === 'moved'
      ? `Your lab visit times for the ${labStudy.name} have changed${opts.byTeam ? ' (the research team made the change)' : ''}. Your visits now:`
      : `Your ${both ? 'two lab visits' : visitWords(sorted[0].visit)} for the ${labStudy.name} ${both ? 'are' : 'is'} booked. Thank you!`;
  return {
    subject: kind === 'moved' ? 'MyPhone/MyBrain: your lab visit times have changed' : both ? `MyPhone/MyBrain: your lab visits are booked: ${ukShortDate(sorted[0].start)} and ${ukShortDate(sorted[1].start)}` : `MyPhone/MyBrain: your ${visitWords(sorted[0].visit)} is booked for ${shortWhen(sorted[0])}`,
    text: [
      'Hello,',
      '',
      intro,
      ...sorted.flatMap((b) => ['', ...visitBlock(b, kind === 'moved' && changed.has(b.id) ? ' (new time)' : '')]),
      '',
      `Participant ID: ${code}`,
      '',
      ...bringLines(),
      '',
      `The attached calendar file${both ? 's add the visits' : ' adds the visit'} to your calendar${kind === 'moved' ? ', replacing the earlier times' : ''}, with a reminder the day before. ${reminderPromise(contact)}`,
      '',
      `To change or cancel, up to ${labBooking.changeUntilHours} hours before a visit: ${links.book}`,
      `After that, or if anything is unclear, ${contactLine}.`,
      ...signOff,
    ].join('\n'),
  };
}

const placeShort = (b: BookingRecord) => b.place.name.split(',')[0];

/** Texts are kept to one message: plain characters, under 160 where possible. */
export function visitsText(kind: 'booked' | 'moved', visits: BookingRecord[]): string {
  const sorted = byVisit(visits);
  if (sorted.length > 1) {
    const times = sorted.map(shortWhen).join(' and ');
    return kind === 'moved' ? `MyPhone/MyBrain: your lab visits are now ${times} at the ${placeShort(sorted[0])}. Details are in your email.` : `MyPhone/MyBrain: your lab visits are booked for ${times} at the ${placeShort(sorted[0])}. Details are in your email.`;
  }
  const b = sorted[0];
  return kind === 'moved' ? `MyPhone/MyBrain: your ${visitWords(b.visit)} has moved to ${shortWhen(b)}, ${b.place.name}. Details are in your email.` : `MyPhone/MyBrain: your ${visitWords(b.visit)} is booked for ${shortWhen(b)}, ${b.place.name}. Details are in your email.`;
}

/** The reminder texts before a visit. */
export function bookingText(kind: 'day-before' | 'same-day', b: BookingRecord): string {
  return kind === 'day-before'
    ? `MyPhone/MyBrain reminder: your lab visit is tomorrow (${ukShortDate(b.start)}) at ${ukClock(b.start)}, ${placeShort(b)}. Can't come? Email ${labStudy.contactEmail}`
    : `MyPhone/MyBrain: see you today at ${ukClock(b.start)} at the main entrance, ${placeShort(b)}. Running late? Email ${labStudy.contactEmail}`;
}

export function reminderEmail(b: BookingRecord): { subject: string; text: string } {
  const links = participantLinks(b.participantCode);
  return {
    subject: `MyPhone/MyBrain: your ${visitWords(b.visit)} is tomorrow at ${ukClock(b.start)}`,
    text: [
      'Hello,',
      '',
      `A reminder: your ${visitWords(b.visit)} for the ${labStudy.name} is tomorrow.`,
      '',
      ...visitBlock(b),
      `Participant ID: ${b.participantCode}`,
      '',
      ...bringLines(),
      ...(b.visit === 2 ? ['', `If you have not sent your screen-time screenshots from the end of your break yet, please do it before the visit: ${links.after}`] : []),
      '',
      `Can't come? Please ${contactLine} as soon as you can, so the time can go to someone else.`,
      ...signOff,
    ].join('\n'),
  };
}

/** The break-time messages (labJourneyMessages): an email and a one-line text for each. */
export function journeyMessage(id: string, code: string, visit2: BookingRecord | null): { subject: string; text: string; sms: string } | null {
  const links = participantLinks(code);
  const visit2Line = visit2 ? `Your second lab visit is on ${ukSpan(visit2.start, visit2.end)}.` : '';
  const hello = ['Hello,', ''];
  const end = ['', `Questions, or problems with Brick or the break? ${Contact_(contactLine)}.`, ...signOff];
  if (id.startsWith('check-in-')) {
    const week = id.slice('check-in-'.length);
    return {
      subject: `MyPhone/MyBrain: your week ${week} check-in`,
      text: [...hello, `It's time for your weekly check-in for the ${labStudy.name}: a few quick questions about your break, and a screenshot of your screen time if you can. It takes about two minutes, and there is an optional MyStory at the end.`, '', links.checkIn, ...(visit2Line ? ['', visit2Line] : []), ...end].join('\n'),
      sms: `MyPhone/MyBrain: time for your week ${week} check-in, about 2 minutes: ${links.checkIn}`,
    };
  }
  if (id === 'end-of-break') {
    return {
      subject: 'MyPhone/MyBrain: the last day of your break',
      text: [
        ...hello,
        'Today is the last day of your 30-day social media break. Well done!',
        '',
        'Before you unlock your apps, please take your screen-time screenshots and send them on the after-break page:',
        links.after,
        '',
        'Once your apps are unlocked, request your new data downloads from TikTok, YouTube or Instagram; the same page shows you how, and you send the files there when they arrive.',
        ...(visit2Line ? ['', visit2Line] : []),
        ...end,
      ].join('\n'),
      sms: `MyPhone/MyBrain: last day of your break. Before you unlock your apps, send your screenshots: ${links.after}`,
    };
  }
  return null;
}

/* ── Sending ───────────────────────────────────────────────────────────── */

export async function contactOf(db: Firestore, code: string): Promise<Contact> {
  const d = (await db.collection('labContacts').doc(code).get()).data();
  return { email: typeof d?.email === 'string' ? d.email : null, mobile: typeof d?.mobile === 'string' ? d.mobile : null, smsReminders: Boolean(d?.smsReminders) };
}

const wantsTexts = (c: Contact) => Boolean(c.smsReminders && c.mobile);

/** An email address with only its first letter and its domain showing: j•••@example.com. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  return at < 1 ? '•••' : `${email.slice(0, 1)}•••@${email.slice(at + 1)}`;
}

/** The contact on file as the booking page shows it: enough to recognise, not to read. */
export function maskedContact(c: Contact): { email: string; mobileEnding: string | null; smsReminders: boolean } | null {
  if (!c.email) return null;
  return { email: maskEmail(c.email), mobileEnding: c.mobile ? c.mobile.replace(/\D/g, '').slice(-3) : null, smsReminders: wantsTexts(c) };
}

/**
 * To the address on file when visits are booked or changed with a different
 * one: the new address is not shown, only that it changed, the visits as
 * they stand, and who to contact if it was not them.
 */
export function addressChangedEmail(visits: BookingRecord[]): { subject: string; text: string } {
  const sorted = byVisit(visits).filter((b) => b.status === 'booked' || b.status === 'attended');
  const code = sorted[0]?.participantCode ?? '';
  return {
    subject: 'MyPhone/MyBrain: your lab visit emails now go to a different address',
    text: [
      'Hello,',
      '',
      `Your lab visits for the ${labStudy.name} were just booked or changed, and the confirmation went to a different email address from this one. From now on, emails about your visits go to that address.`,
      '',
      ...(sorted.length ? ['Your visits now:', ...sorted.map((b) => `${visitTitle(b.visit)}: ${ukSpan(b.start, b.end)} (UK time)`), ''] : []),
      `Participant ID: ${code}`,
      '',
      `If this was you, there is nothing to do. If it was not, please ${contactLine} straight away.`,
      ...signOff,
    ].join('\n'),
  };
}

/**
 * Emails the participant about booked, changed or cancelled visits, with a
 * calendar file per visit, copied to the study's contact and the team inbox;
 * texts them about a booking or a change if they asked. Never throws.
 */
export async function notifyVisits(kind: 'booked' | 'moved' | 'cancelled', visits: BookingRecord[], contact: Contact, opts: { changed?: string[]; byTeam?: boolean; reason?: string } = {}): Promise<{ email: MailOutcome | 'no-contact'; sms: SmsOutcome | 'not-wanted' }> {
  const message = visitsEmail(kind, visits, contact, opts);
  const attachments = byVisit(visits)
    .filter((b) => kind === 'cancelled' || b.status === 'booked')
    .map((b) => ({ filename: icsName(b), content: bookingIcs(b, kind === 'cancelled'), contentType: `text/calendar; charset=utf-8; method=${kind === 'cancelled' ? 'CANCEL' : 'PUBLISH'}` }));
  const email = contact.email ? await sendMail({ to: contact.email, cc: labBooking.copyTo.join(', '), replyTo: labStudy.contactEmail, ...message, attachments }) : 'no-contact';
  const sms = kind !== 'cancelled' && labBooking.textOnBooking && wantsTexts(contact) ? await sendSms(contact.mobile!, visitsText(kind, visits.filter((b) => b.status === 'booked'))) : 'not-wanted';
  return { email, sms };
}

/* ── Placing and cancelling ────────────────────────────────────────────── */

export interface VisitChoice {
  visit: Visit;
  slotId: string;
}

export interface PlaceRequest {
  code: string;
  /** One time per visit being booked or moved. */
  choices: VisitChoice[];
  by: 'participant' | 'staff';
  uid: string;
  client: ClientInfo | null;
}

export interface PlaceResult {
  /** The new bookings. */
  booked: BookingRecord[];
  /** The bookings they replace (moved). */
  replaced: BookingRecord[];
  /** Every visit standing afterwards. */
  standing: BookingRecord[];
}

/**
 * Books visits in one transaction. A participant books both visits together
 * (or the one a missed or cancelled visit left), with consent and the data
 * from before the break in, the second 28 to 35 days after the first, each
 * at least 24 hours ahead; choosing a new time for a visit already booked
 * moves it (up to 24 hours before). The team may book any open time with
 * room, one visit at a time, without the notice, window or data checks.
 */
export async function placeVisits(db: Firestore, req: PlaceRequest, now = new Date()): Promise<PlaceResult> {
  if (!req.choices.length || req.choices.length > 2 || new Set(req.choices.map((c) => c.visit)).size !== req.choices.length) throw new HttpsError('invalid-argument', 'Choose one time for each visit.');
  const participantRef = db.collection('labParticipants').doc(req.code);
  const slotRefs = req.choices.map((c) => db.collection('labSlots').doc(c.slotId));
  const byStaff = req.by === 'staff';
  return db.runTransaction(async (tx) => {
    const [participantSnap, mine, ...slotSnaps] = await Promise.all([tx.get(participantRef), tx.get(db.collection('labBookings').where('participantCode', '==', req.code)), ...slotRefs.map((r) => tx.get(r))]);
    const participant = participantSnap.data();
    if (!participant?.consentId) throw new HttpsError('failed-precondition', 'We have no consent on file for this participant ID.');
    const bookings = mine.docs.map((d) => bookingFrom(d.id, d.data()));
    const state = bookingState(participant, bookings, now);
    if (!byStaff && state.missing.length) throw new HttpsError('failed-precondition', `Your lab visits can be booked once ${list(state.missing)} ${state.missing.length === 1 ? 'has' : 'have'} arrived.`);
    const plan: Record<Visit, { start: Date; end: Date } | null> = { 1: state.active[1], 2: state.active[2] };
    const replaced: BookingRecord[] = [];
    req.choices.forEach((c, i) => {
      const snap = slotSnaps[i];
      if (!snap.exists) throw new HttpsError('not-found', 'That time is no longer available. Please choose another.');
      const previous = state.active[c.visit];
      if (previous) {
        if (previous.status !== 'booked') throw new HttpsError('failed-precondition', `Your ${visitWords(c.visit)} has already happened.`);
        if (previous.slotId === c.slotId) throw new HttpsError('failed-precondition', `That is the time you already have for your ${visitWords(c.visit)}.`);
        if (!byStaff && !changeable(previous, now)) throw new HttpsError('failed-precondition', `Visits can be changed online up to ${labBooking.changeUntilHours} hours before. Please contact ${labStudy.contactName} at ${labStudy.contactEmail}.`);
        replaced.push(previous);
      }
      plan[c.visit] = { start: toDate(snap.data()!.start), end: toDate(snap.data()!.end) };
    });
    if (!byStaff && (!plan[1] || !plan[2])) throw new HttpsError('failed-precondition', 'Please choose a time for both visits: they are booked together.');
    if (plan[1] && plan[2] && plan[2].start.getTime() <= plan[1].end.getTime()) throw new HttpsError('failed-precondition', 'The second visit must come after the first.');
    req.choices.forEach((c, i) => {
      const other = plan[c.visit === 1 ? 2 : 1];
      const problem = slotProblem(slotSnaps[i].data()!, c.visit, byStaff ? null : visitWindow(c.visit, other?.start ?? null, now), now, byStaff);
      if (problem) throw new HttpsError('failed-precondition', problem);
    });

    // One update per slot, however many bookings it gains or loses here.
    const slotDelta = new Map<string, { delta: number; add: string[] }>();
    const touch = (slotId: string, delta: number, add?: string) => {
      const d = slotDelta.get(slotId) ?? { delta: 0, add: [] };
      d.delta += delta;
      if (add) d.add.push(add);
      slotDelta.set(slotId, d);
    };
    const booked: BookingRecord[] = [];
    req.choices.forEach((c, i) => {
      const slot = slotSnaps[i].data()!;
      const ref = db.collection('labBookings').doc();
      const previous = replaced.find((b) => b.visit === c.visit) ?? null;
      const sequence = Math.max(-1, ...bookings.filter((b) => b.visit === c.visit).map((b) => b.sequence)) + 1;
      const booking: BookingRecord = { id: ref.id, participantCode: req.code, visit: c.visit, slotId: c.slotId, start: toDate(slot.start), end: toDate(slot.end), place: placeOf(slot), status: 'booked', bookedAt: now, sequence };
      tx.set(ref, {
        studyId: labStudy.studyId,
        participantCode: req.code,
        visit: c.visit,
        slotId: c.slotId,
        start: booking.start,
        end: booking.end,
        place: booking.place,
        status: 'booked',
        bookedAt: now,
        bookedBy: req.by,
        sequence,
        replaces: previous?.id ?? null,
        replacedBy: null,
        cancelledAt: null,
        cancelledBy: null,
        reminders: {},
        sessionUid: req.uid,
        client: req.client,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      touch(c.slotId, 1, ref.id);
      if (previous) {
        tx.update(db.collection('labBookings').doc(previous.id), { status: 'cancelled', cancelledAt: now, cancelledBy: req.by, cancelReason: 'moved', replacedBy: ref.id, updatedAt: FieldValue.serverTimestamp() });
        touch(previous.slotId, -1);
      }
      booked.push(booking);
    });
    for (const [slotId, d] of slotDelta) {
      tx.update(db.collection('labSlots').doc(slotId), { booked: FieldValue.increment(d.delta), ...(d.add.length ? { bookingIds: FieldValue.arrayUnion(...d.add) } : {}), updatedAt: FieldValue.serverTimestamp() });
    }
    tx.set(participantRef, { bookingIds: FieldValue.arrayUnion(...booked.map((b) => b.id)), ...Object.fromEntries(booked.map((b) => [`visit${b.visit}At`, b.start])), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const standing = ([1, 2] as Visit[]).map((v) => booked.find((b) => b.visit === v) ?? state.active[v]).filter((b): b is BookingRecord => Boolean(b));
    return { booked, replaced, standing };
  });
}

/**
 * Cancels standing bookings and frees their places: the ones named, or, with
 * none named, every visit still to come. A participant can cancel online up
 * to 24 hours before each.
 */
export async function cancelVisits(db: Firestore, req: { code: string | null; bookingIds: string[] | null; by: 'participant' | 'staff'; reason: string | null }, now = new Date()): Promise<BookingRecord[]> {
  return db.runTransaction(async (tx) => {
    let targets: BookingRecord[];
    if (req.bookingIds?.length) {
      const snaps = await Promise.all(req.bookingIds.map((id) => tx.get(db.collection('labBookings').doc(id))));
      targets = snaps.map((s) => {
        if (!s.exists) throw new HttpsError('not-found', 'That booking was not found.');
        const b = bookingFrom(s.id, s.data()!);
        if (req.code && b.participantCode !== req.code) throw new HttpsError('not-found', 'That booking was not found.');
        if (b.status !== 'booked') throw new HttpsError('failed-precondition', 'That booking is no longer standing.');
        return b;
      });
    } else {
      if (!req.code) throw new HttpsError('invalid-argument', 'Name the bookings to cancel.');
      const mine = await tx.get(db.collection('labBookings').where('participantCode', '==', req.code));
      targets = mine.docs.map((d) => bookingFrom(d.id, d.data())).filter((b) => b.status === 'booked' && b.start.getTime() > now.getTime());
      if (!targets.length) throw new HttpsError('failed-precondition', 'There are no visits to cancel.');
    }
    if (req.by === 'participant' && targets.some((b) => !changeable(b, now))) throw new HttpsError('failed-precondition', `Visits can be cancelled online up to ${labBooking.changeUntilHours} hours before. Please contact ${labStudy.contactName} at ${labStudy.contactEmail}.`);
    const slotDelta = new Map<string, number>();
    for (const b of targets) {
      // The cancellation's calendar file must be newer than the booking's, and the next booking's newer still.
      tx.update(db.collection('labBookings').doc(b.id), { status: 'cancelled', cancelledAt: now, cancelledBy: req.by, cancelReason: req.reason, sequence: b.sequence + 1, updatedAt: FieldValue.serverTimestamp() });
      slotDelta.set(b.slotId, (slotDelta.get(b.slotId) ?? 0) - 1);
    }
    for (const [slotId, delta] of slotDelta) tx.update(db.collection('labSlots').doc(slotId), { booked: FieldValue.increment(delta), updatedAt: FieldValue.serverTimestamp() });
    const byCode = new Map<string, BookingRecord[]>();
    for (const b of targets) byCode.set(b.participantCode, [...(byCode.get(b.participantCode) ?? []), b]);
    for (const [code, mine] of byCode) tx.set(db.collection('labParticipants').doc(code), { ...Object.fromEntries(mine.map((b) => [`visit${b.visit}At`, null])), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return targets.map((b) => ({ ...b, status: 'cancelled' as const, sequence: b.sequence + 1 }));
  });
}

/* ── What the page sees ────────────────────────────────────────────────── */

export interface BookingView {
  bookingId: string;
  visit: Visit;
  start: string;
  end: string;
  place: Place;
  status: BookingStatus;
  canChange: boolean;
  ics: string;
}

export const bookingView = (b: BookingRecord, now: Date): BookingView => ({ bookingId: b.id, visit: b.visit, start: b.start.toISOString(), end: b.end.toISOString(), place: b.place, status: b.status, canChange: changeable(b, now), ics: bookingIcs(b, false, now) });

export function validateBookingPayload(input: unknown): string[] {
  const problems: string[] = [];
  if (!isObj(input)) return ['The request is not an object.'];
  if (!normaliseCode(input.participantCode)) problems.push('The participant ID is malformed.');
  const visits = input.visits;
  if (!Array.isArray(visits) || !visits.length || visits.length > 2) problems.push('Choose a time for each visit.');
  else {
    for (const v of visits) {
      if (!isObj(v) || (v.visit !== 1 && v.visit !== 2) || typeof v.slotId !== 'string' || !DOC_ID.test(v.slotId)) problems.push('Choose a time for each visit.');
    }
    if (new Set(visits.map((v) => (isObj(v) ? v.visit : null))).size !== visits.length) problems.push('Choose one time for each visit.');
  }
  // null: keep the email address and text settings already on file (changing visits on another device, without typing them again).
  const keep = input.email === null;
  if (!keep && (!str(input.email, 254) || !EMAIL.test(String(input.email).trim()))) problems.push('Enter an email address in the format name@example.com.');
  // The mobile number is required with new contact details: the team needs it to contact people about their visits (decided 7 October 2026).
  const hasMobile = input.mobile !== null && input.mobile !== undefined && input.mobile !== '';
  if (keep && hasMobile) problems.push('A new mobile number needs the email address too.');
  else if (!keep && !hasMobile) problems.push('Enter your mobile number, so the team can contact you about your visits.');
  else if (!keep && (!str(input.mobile, 30) || !ukMobile(String(input.mobile)))) problems.push('Enter a UK mobile number, such as 07700 900123.');
  if (typeof input.smsReminders !== 'boolean') problems.push('Say whether you want text reminders.');
  validateClient(input.client, problems);
  return problems;
}

/** Where someone stands, their visits, and the open times for each visit. */
export const labBookingOptions = onCall(callOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const code = normaliseCode((request.data as { participantCode?: unknown } | undefined)?.participantCode);
  if (!code) throw new HttpsError('invalid-argument', 'The participant ID is malformed.');
  const db = getFirestore();
  await rateLimitLookups(db, uid);
  const now = new Date();
  const participant = (await db.collection('labParticipants').doc(code).get()).data();
  const bookings = await bookingsOf(db, code);
  const state = bookingState(participant, bookings, now);
  const anyBooked = Boolean(state.active[1] || state.active[2]);
  // Open times for each visit, widely: the page narrows the second to 28 to 35 days after the first chosen (or kept).
  const offer = !state.missing.length && (state.toBook.length || anyBooked);
  const windows = offerWindows(state, now);
  const [first, second] = offer ? await Promise.all([openSlots(db, 1, windows[1], now), openSlots(db, 2, windows[2], now)]) : [[], []];
  return {
    consent: state.consent,
    missing: state.missing,
    bookings: bookings
      .filter((b) => b.status !== 'cancelled')
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((b) => bookingView(b, now)),
    toBook: state.toBook,
    slots: { 1: first, 2: second },
    gap: { min: GAP.min, max: GAP.max },
    smsAvailable: await smsReady(),
    rules: { minNoticeHours: labBooking.minNoticeHours, changeUntilHours: labBooking.changeUntilHours },
    // Where confirmations go now, masked: a change can keep it without typing it again.
    contact: maskedContact(await contactOf(db, code)),
  };
});

/** Books both visits (or moves them), then emails the confirmation with the calendar files, copied to Miftah and the team inbox. */
export const bookLabSlot = onCall(callOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const problems = validateBookingPayload(request.data);
  if (problems.length) throw new HttpsError('invalid-argument', problems[0], { problems });
  const p = request.data as { participantCode: string; visits: VisitChoice[]; email: string | null; mobile?: string | null; smsReminders: boolean; client: ClientInfo };
  const code = normaliseCode(p.participantCode)!;
  const db = getFirestore();
  await rateLimitLookups(db, uid, 'lab-booking', BOOKINGS_PER_HOUR);
  const onFile = await contactOf(db, code);
  if (p.email === null && !onFile.email) throw new HttpsError('invalid-argument', 'Enter your email address, so we can send you the details.');
  if (p.email === null && !onFile.mobile) throw new HttpsError('invalid-argument', 'Enter your mobile number, so the team can contact you about your visits.');
  const now = new Date();
  const result = await placeVisits(db, { code, choices: p.visits.map((v) => ({ visit: v.visit, slotId: v.slotId })), by: 'participant', uid, client: p.client }, now);
  const mobile = p.mobile ? ukMobile(p.mobile) : null;
  const contact: Contact = p.email === null ? onFile : { email: p.email.trim(), mobile, smsReminders: Boolean(p.smsReminders && mobile) };
  if (p.email !== null) await db.collection('labContacts').doc(code).set({ participantCode: code, ...contact, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const kind = result.replaced.length ? 'moved' : 'booked';
  // Anyone with the participant ID can change the visits, so a new address never silences the old one: it hears about the change once.
  if (onFile.email && contact.email && onFile.email.trim().toLowerCase() !== contact.email.trim().toLowerCase()) {
    const told = await sendMail({ to: onFile.email, replyTo: labStudy.contactEmail, ...addressChangedEmail(result.standing) });
    await db.collection('labContacts').doc(code).set({ addressChanges: FieldValue.arrayUnion({ from: onFile.email, at: new Date(), told }) }, { merge: true });
    logger.info('Old address told of a new one', { participantCode: code, email: told });
  }
  const outcome = await notifyVisits(kind, result.standing, contact, { changed: result.booked.map((b) => b.id) });
  await Promise.all(result.booked.map((b) => db.collection('labBookings').doc(b.id).set({ confirmation: { at: new Date(), ...outcome } }, { merge: true })));
  logger.info(kind === 'moved' ? 'Lab visits moved' : 'Lab visits booked', { participantCode: code, bookingIds: result.booked.map((b) => b.id), ...outcome });
  return { booked: result.booked.map((b) => bookingView(b, now)), kind, email: outcome.email, sms: outcome.sms };
});

/** Cancels the visits still to come (up to the cut-off), and emails the cancellation, copied to Miftah and the team inbox. */
export const cancelLabBooking = onCall(callOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const data = request.data as { participantCode?: unknown; bookingIds?: unknown } | undefined;
  const code = normaliseCode(data?.participantCode);
  if (!code) throw new HttpsError('invalid-argument', 'The participant ID is malformed.');
  const ids = data?.bookingIds === undefined || data?.bookingIds === null ? null : data.bookingIds;
  if (ids !== null && (!Array.isArray(ids) || ids.length > 2 || ids.some((x) => typeof x !== 'string' || !DOC_ID.test(x)))) throw new HttpsError('invalid-argument', 'The bookings are malformed.');
  const db = getFirestore();
  await rateLimitLookups(db, uid, 'lab-booking', BOOKINGS_PER_HOUR);
  const cancelled = await cancelVisits(db, { code, bookingIds: ids as string[] | null, by: 'participant', reason: null }, new Date());
  const outcome = await notifyVisits('cancelled', cancelled, await contactOf(db, code));
  await Promise.all(cancelled.map((b) => db.collection('labBookings').doc(b.id).set({ cancellation: { at: new Date(), ...outcome } }, { merge: true })));
  logger.info('Lab visits cancelled', { participantCode: code, bookingIds: cancelled.map((b) => b.id), email: outcome.email });
  return { bookingIds: cancelled.map((b) => b.id), email: outcome.email };
});

/* ── Reminders and messages, every quarter of an hour ──────────────────── */

/** The first moment at or after this one when texts may go (labBooking.textHours, UK time). */
export function nextTextTime(at: Date): Date {
  const { hour } = ukParts(at);
  if (hour >= labBooking.textHours.from && hour < labBooking.textHours.to) return at;
  const day = ukDate(at);
  return atUkTime(hour < labBooking.textHours.from ? day : addDays(day, 1), labBooking.textHours.from);
}

export type DueAction = 'wait' | 'send' | 'skip-booked-late' | 'skip-too-late';

/** What to do now about one channel of one visit reminder. */
export function reminderAction(hoursBefore: number, channel: 'email' | 'sms', b: { start: Date; bookedAt: Date }, now: Date): DueAction {
  const dueAt = new Date(b.start.getTime() - hoursBefore * HOUR);
  if (b.bookedAt.getTime() >= dueAt.getTime()) return 'skip-booked-late';
  const sendAt = channel === 'sms' ? nextTextTime(dueAt) : dueAt;
  if (now.getTime() < sendAt.getTime()) return 'wait';
  if (b.start.getTime() - now.getTime() < TOO_CLOSE) return 'skip-too-late';
  return 'send';
}

export type JourneyAction = 'wait' | 'send' | 'skip-stale' | 'skip-unless' | 'skip-visit-2';

/** When a break-time message is due: its day after the first visit, at the set hour, UK time. */
export const journeyDueAt = (m: JourneyMessage, visit1Start: Date) => atUkTime(addDays(ukDate(visit1Start), m.day), labJourneyHour);

export function journeyAction(m: JourneyMessage, ctx: { visit1Start: Date; visit2: BookingRecord | null; lastCheckInAt: Date | null }, now: Date): JourneyAction {
  const dueAt = journeyDueAt(m, ctx.visit1Start);
  if (now.getTime() < dueAt.getTime()) return 'wait';
  if (now.getTime() - dueAt.getTime() > STALE_AFTER) return 'skip-stale';
  // From a day before the second visit, its own reminders say what to do (a visit 28 or 29 days on comes before the day-30 message).
  if (ctx.visit2 && ctx.visit2.start.getTime() - now.getTime() < DAY) return 'skip-visit-2';
  if (m.unless === 'checked-in' && ctx.lastCheckInAt && now.getTime() - ctx.lastCheckInAt.getTime() < 3 * DAY) return 'skip-unless';
  return 'send';
}

/** Claims one message for sending (so two runs never send it twice): true when this run should send it. */
async function claim(db: Firestore, ref: DocumentReference, field: string, key: string, now: Date): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    if (d?.[field]?.[key]) return false;
    tx.set(ref, { [field]: { [key]: { claimedAt: now } } }, { merge: true });
    return true;
  });
}

async function record(ref: DocumentReference, field: string, key: string, value: Record<string, unknown>): Promise<void> {
  await ref.set({ [field]: { [key]: value }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export async function runLabMessages(now = new Date()): Promise<{ reminders: number; messages: number; skipped: number }> {
  const db = getFirestore();
  let reminders = 0;
  let messages = 0;
  let skipped = 0;
  const contacts = new Map<string, Contact>();
  const contactFor = async (code: string) => contacts.get(code) ?? contacts.set(code, await contactOf(db, code)).get(code)!;
  const participants = new Map<string, DocumentData | undefined>();
  const participantFor = async (code: string) => (participants.has(code) ? participants.get(code) : participants.set(code, (await db.collection('labParticipants').doc(code).get()).data()).get(code));

  // Visit reminders: standing bookings in the next day or so.
  const horizon = Math.max(...labBooking.reminders.map((r) => r.hoursBefore)) + 1;
  const soon = await db.collection('labBookings').where('start', '>', now).where('start', '<=', new Date(now.getTime() + horizon * HOUR)).get();
  for (const doc of soon.docs) {
    const b = bookingFrom(doc.id, doc.data());
    if (b.status !== 'booked') continue;
    const sent = (doc.data().reminders ?? {}) as Record<string, unknown>;
    for (const r of labBooking.reminders) {
      for (const channel of ['email', 'sms'] as const) {
        if (!r[channel]) continue;
        const key = `${r.id}-${channel}`;
        if (sent[key]) continue;
        const action = reminderAction(r.hoursBefore, channel, b, now);
        if (action === 'wait') continue;
        if (!(await claim(db, doc.ref, 'reminders', key, now))) continue;
        if (action !== 'send') {
          await record(doc.ref, 'reminders', key, { at: now, skipped: action });
          skipped += 1;
          continue;
        }
        const participant = await participantFor(b.participantCode);
        const contact = await contactFor(b.participantCode);
        let outcome: string;
        if (participant?.messagesPaused) outcome = 'paused';
        else if (channel === 'email') outcome = contact.email ? await sendMail({ to: contact.email, replyTo: labStudy.contactEmail, ...reminderEmail(b) }) : 'no-contact';
        else outcome = wantsTexts(contact) ? await sendSms(contact.mobile!, bookingText(r.id === 'same-day' ? 'same-day' : 'day-before', b)) : 'not-wanted';
        await record(doc.ref, 'reminders', key, { at: now, outcome });
        reminders += 1;
      }
    }
  }

  // Break-time messages: everyone whose first visit was in the last few weeks.
  const longest = Math.max(...labJourneyMessages.map((m) => m.day)) + 2;
  const recent = await db.collection('labBookings').where('start', '>=', new Date(now.getTime() - longest * DAY)).where('start', '<=', now).get();
  const firstVisits = new Map<string, BookingRecord>();
  for (const doc of recent.docs) {
    const b = bookingFrom(doc.id, doc.data());
    if (b.visit !== 1 || !ACTIVE.includes(b.status)) continue;
    const seen = firstVisits.get(b.participantCode);
    if (!seen || seen.start < b.start) firstVisits.set(b.participantCode, b);
  }
  for (const [code, visit1] of firstVisits) {
    const participant = await participantFor(code);
    if (!participant?.consentId || participant.messagesPaused || participant.withdrawnAt) continue;
    const ref = db.collection('labParticipants').doc(code);
    const done = (participant.messages ?? {}) as Record<string, unknown>;
    let visit2: BookingRecord | null = null;
    for (const m of labJourneyMessages) {
      if (done[m.id]) continue;
      if (journeyAction(m, { visit1Start: visit1.start, visit2: null, lastCheckInAt: null }, now) === 'wait') continue;
      visit2 ??= (await bookingsOf(db, code)).filter((b) => b.visit === 2 && ACTIVE.includes(b.status)).sort((a, b) => b.start.getTime() - a.start.getTime())[0] ?? null;
      const lastCheckInAt = participant.lastCheckInAt ? toDate(participant.lastCheckInAt) : null;
      const action = journeyAction(m, { visit1Start: visit1.start, visit2, lastCheckInAt }, now);
      if (action === 'wait') continue;
      if (!(await claim(db, ref, 'messages', m.id, now))) continue;
      const message = action === 'send' ? journeyMessage(m.id, code, visit2) : null;
      if (!message) {
        await record(ref, 'messages', m.id, { at: now, skipped: action === 'send' ? 'no-wording' : action });
        skipped += 1;
        continue;
      }
      const contact = await contactFor(code);
      const email = contact.email ? await sendMail({ to: contact.email, replyTo: labStudy.contactEmail, subject: message.subject, text: message.text }) : 'no-contact';
      const sms = wantsTexts(contact) ? await sendSms(contact.mobile!, message.sms) : 'not-wanted';
      await record(ref, 'messages', m.id, { at: now, dueAt: journeyDueAt(m, visit1.start), email, sms });
      messages += 1;
    }
  }
  if (reminders || messages || skipped) logger.info('Lab messages', { reminders, messages, skipped });
  return { reminders, messages, skipped };
}

export const labMessages = onSchedule({ region: REGION, schedule: 'every 15 minutes', timeZone: 'Europe/London', memory: '512MiB', timeoutSeconds: 300 }, async () => {
  await runLabMessages();
});

/** Emulator only: lets the end-to-end test run the quarter-hourly messages at a chosen moment (?at=ISO time). Not deployed. */
export const labMessagesNow =
  process.env.FUNCTIONS_EMULATOR === 'true'
    ? onRequest({ region: REGION, timeoutSeconds: 300 }, async (req, res) => {
        const at = typeof req.query.at === 'string' ? new Date(req.query.at) : new Date();
        res.json(await runLabMessages(Number.isNaN(at.getTime()) ? new Date() : at));
      })
    : undefined;
