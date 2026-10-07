import { FieldValue, getFirestore, Timestamp, type DocumentData, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { labBooking, labJourneyHour, labJourneyMessages, labStudy, storyModes, type JourneyMessage } from './forms.js';
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
 * A first visit can be booked only once the data from before the break has
 * arrived (labBooking.requires); the second only once the first is booked,
 * in the window after it that ends the 30-day break. Every booking, change
 * and cancellation is emailed to the participant with a calendar file and
 * copied to the study's contact; reminders go by email and, for people who
 * asked, by text. Every quarter of an hour, labMessages sends what is due.
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
  /** What has still to arrive before a first visit can be booked, in plain words. */
  missing: string[];
  /** The standing booking for each visit. */
  active: Record<Visit, BookingRecord | null>;
  /** The visit to book next, if any. */
  next: Visit | null;
  /** The UK dates the next visit can be on, inclusive. */
  window: { from: string; to: string } | null;
}

/**
 * Where a participant stands: a first visit once consent and the data from
 * before the break are in (a missed first visit can be booked again); a
 * second once the first stands, in the days that end the break.
 */
export function bookingState(participant: DocumentData | undefined, bookings: BookingRecord[], now: Date): BookingState {
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
  let next: Visit | null = null;
  let window: BookingState['window'] = null;
  if (!active[1]) {
    if (!missing.length) {
      next = 1;
      window = { from: ukDate(now), to: ukDate(new Date(now.getTime() + labBooking.horizonDays * DAY)) };
    }
  } else if (!active[2]) {
    next = 2;
    const first = ukDate(active[1].start);
    window = { from: addDays(first, labBooking.visit2AfterDays.min), to: addDays(first, labBooking.visit2AfterDays.max) };
  }
  return { consent, missing, active, next, window };
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
  if (window && (ukDate(start) < window.from || ukDate(start) > window.to)) return visit === 2 ? `Your second visit needs to be between ${ukLongDate(atUkTime(window.from, 12))} and ${ukLongDate(atUkTime(window.to, 12))}, at the end of your break.` : 'That time is too far ahead. Please choose another.';
  return null;
}

/** The open times for a visit in its window, soonest first. */
export async function openSlots(db: Firestore, visit: Visit, window: { from: string; to: string }, now: Date, byStaff = false): Promise<SlotView[]> {
  const from = atUkTime(window.from, 0);
  const to = new Date(atUkTime(window.to, 0).getTime() + DAY);
  const snap = await db.collection('labSlots').where('start', '>=', from).where('start', '<', to).orderBy('start').limit(400).get();
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

function whenWhere(b: BookingRecord): string[] {
  return [`When:  ${ukSpan(b.start, b.end)} (UK time)`, `Where: ${b.place.name}`, ...(b.place.address ? [`       ${b.place.address}`] : []), ...(b.place.directions ? [`       ${b.place.directions}`] : []), `Participant ID: ${b.participantCode}`];
}

function reminderPromise(contact: Contact): string {
  const texts = contact.smsReminders && contact.mobile;
  return texts ? 'We will email you the day before, and text you the day before and on the day.' : 'We will email you a reminder the day before.';
}

/** The email for a booking, a change of time or a cancellation; always copied to the study's contact. */
export function bookingEmail(kind: 'booked' | 'moved' | 'cancelled', b: BookingRecord, contact: Contact, opts: { previous?: BookingRecord; byTeam?: boolean; reason?: string } = {}): { subject: string; text: string } {
  const info = visitInfo(b.visit);
  const links = participantLinks(b.participantCode);
  const when = `${ukShortDate(b.start)}, ${ukClock(b.start)}`;
  if (kind === 'cancelled') {
    return {
      subject: `MyPhone/MyBrain: your ${visitWords(b.visit)} on ${when} is cancelled`,
      text: [
        'Hello,',
        '',
        `Your ${visitWords(b.visit)} for the ${labStudy.name} on ${ukSpan(b.start, b.end)} has been cancelled${opts.byTeam ? ' by the research team' : ''}.${opts.reason ? ` ${opts.reason}` : ''}`,
        'The attached calendar file removes it from your calendar, if you added it.',
        '',
        `To book another time: ${links.book}`,
        '',
        `Questions? ${contactLine[0].toUpperCase()}${contactLine.slice(1)}.`,
        ...signOff,
      ].join('\n'),
    };
  }
  const story = b.visit === 1 ? ['', `Before your visit, if you have a few minutes: tell us about your phone in your own words, in ${storyModes.pre.mode === 'native' ? 'MyStory' : storyModes.pre.name}. It takes about five minutes.`, links.story.pre] : [];
  return {
    subject: kind === 'moved' ? `MyPhone/MyBrain: your ${visitWords(b.visit)} has moved to ${when}` : `MyPhone/MyBrain: your ${visitWords(b.visit)} is booked for ${when}`,
    text: [
      'Hello,',
      '',
      kind === 'moved'
        ? `Your ${visitWords(b.visit)} for the ${labStudy.name} has moved${opts.previous ? ` from ${ukSpan(opts.previous.start, opts.previous.end)}` : ''}. The new time:`
        : `Your ${visitWords(b.visit)} for the ${labStudy.name} is booked. Thank you!`,
      '',
      ...whenWhere(b),
      '',
      `What happens: ${info.what}`,
      `Please bring: ${labBooking.bring.join(' ')}`,
      '',
      `The attached calendar file adds the visit to your calendar${kind === 'moved' ? ' and replaces the earlier time' : ''}, with a reminder the day before. ${reminderPromise(contact)}`,
      '',
      `To change or cancel, up to ${labBooking.changeUntilHours} hours before the visit: ${links.book}`,
      `After that, or if anything is unclear, ${contactLine}.`,
      ...story,
      ...signOff,
    ].join('\n'),
  };
}

/** Texts are kept to one message: plain characters, under 160 where possible. */
export function bookingText(kind: 'booked' | 'moved' | 'day-before' | 'same-day', b: BookingRecord): string {
  const where = b.place.name;
  const when = `${ukShortDate(b.start)}, ${ukClock(b.start)}`;
  switch (kind) {
    case 'booked':
      return `MyPhone/MyBrain: your ${visitWords(b.visit)} is booked for ${when}, ${where}. Details are in your email.`;
    case 'moved':
      return `MyPhone/MyBrain: your ${visitWords(b.visit)} has moved to ${when}, ${where}. Details are in your email.`;
    case 'day-before':
      return `MyPhone/MyBrain reminder: your lab visit is tomorrow (${ukShortDate(b.start)}) at ${ukClock(b.start)}, ${where}. Can't come? Email ${labStudy.contactEmail}`;
    case 'same-day':
      return `MyPhone/MyBrain: see you today at ${ukClock(b.start)}, ${where}. Running late? Email ${labStudy.contactEmail}`;
  }
}

export function reminderEmail(b: BookingRecord): { subject: string; text: string } {
  const info = visitInfo(b.visit);
  const links = participantLinks(b.participantCode);
  return {
    subject: `MyPhone/MyBrain: your ${visitWords(b.visit)} is tomorrow at ${ukClock(b.start)}`,
    text: [
      'Hello,',
      '',
      `A reminder: your ${visitWords(b.visit)} for the ${labStudy.name} is tomorrow.`,
      '',
      ...whenWhere(b),
      '',
      `What happens: ${info.what}`,
      `Please bring: ${labBooking.bring.join(' ')}`,
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
  const end = ['', `Questions, or problems with Brick or the break? ${contactLine[0].toUpperCase()}${contactLine.slice(1)}.`, ...signOff];
  if (id.startsWith('check-in-')) {
    const week = id.slice('check-in-'.length);
    return {
      subject: `MyPhone/MyBrain: your week ${week} check-in`,
      text: [...hello, `It's time for your weekly check-in for the ${labStudy.name}: a few quick questions about your break, and a screenshot of your screen time if you can. It takes about two minutes, and there is an optional MyStory at the end.`, '', links.checkIn, ...(visit2Line ? ['', visit2Line] : []), ...end].join('\n'),
      sms: `MyPhone/MyBrain: time for your week ${week} check-in, about 2 minutes: ${links.checkIn}`,
    };
  }
  if (id === 'book-visit-2' || id === 'book-visit-2-again') {
    return {
      subject: 'MyPhone/MyBrain: book your second lab visit',
      text: [...hello, `${id === 'book-visit-2' ? 'Thank you for coming to your first lab visit.' : 'A reminder:'} Please book your second lab visit, at the end of your 30-day break. The booking page shows the times that fit.`, '', links.book, ...end].join('\n'),
      sms: `MyPhone/MyBrain: please book your second lab visit, for the end of your break: ${links.book}`,
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

/** Emails the participant (copied to the study's contact) about a booking, with its calendar file, and texts them if they asked. Never throws. */
export async function notifyBooking(kind: 'booked' | 'moved' | 'cancelled', b: BookingRecord, contact: Contact, opts: { previous?: BookingRecord; byTeam?: boolean; reason?: string } = {}): Promise<{ email: MailOutcome | 'no-contact'; sms: SmsOutcome | 'not-wanted' }> {
  const message = bookingEmail(kind, b, contact, opts);
  const email = contact.email ? await sendMail({ to: contact.email, cc: labStudy.contactEmail, replyTo: labStudy.contactEmail, ...message, attachments: [{ filename: icsName(b), content: bookingIcs(b, kind === 'cancelled'), contentType: `text/calendar; charset=utf-8; method=${kind === 'cancelled' ? 'CANCEL' : 'PUBLISH'}` }] }) : 'no-contact';
  const sms = kind !== 'cancelled' && labBooking.textOnBooking && wantsTexts(contact) ? await sendSms(contact.mobile!, bookingText(kind, b)) : 'not-wanted';
  return { email, sms };
}

/* ── Placing and cancelling ────────────────────────────────────────────── */

export interface PlaceRequest {
  code: string;
  slotId: string;
  visit: Visit;
  /** The booking this one replaces (a change of time). */
  replaces: string | null;
  by: 'participant' | 'staff';
  uid: string;
  client: ClientInfo | null;
}

/**
 * Books a slot in one transaction: the slot still has room, the visit is
 * not already booked (unless this replaces that booking), and for a change
 * of time the old booking is released. The team may book any open time with
 * room, without the notice, window or data checks.
 */
export async function placeBooking(db: Firestore, req: PlaceRequest, now = new Date()): Promise<{ booking: BookingRecord; previous: BookingRecord | null }> {
  const participantRef = db.collection('labParticipants').doc(req.code);
  const slotRef = db.collection('labSlots').doc(req.slotId);
  const bookingRef = db.collection('labBookings').doc();
  const byStaff = req.by === 'staff';
  return db.runTransaction(async (tx) => {
    const [participantSnap, slotSnap, mine] = await Promise.all([tx.get(participantRef), tx.get(slotRef), tx.get(db.collection('labBookings').where('participantCode', '==', req.code))]);
    const participant = participantSnap.data();
    if (!participant?.consentId) throw new HttpsError('failed-precondition', 'We have no consent on file for this participant ID.');
    if (!slotSnap.exists) throw new HttpsError('not-found', 'That time is no longer available. Please choose another.');
    const bookings = mine.docs.map((d) => bookingFrom(d.id, d.data()));
    const previous = req.replaces ? (bookings.find((b) => b.id === req.replaces) ?? null) : null;
    if (req.replaces && (!previous || previous.visit !== req.visit || previous.status !== 'booked')) throw new HttpsError('failed-precondition', 'The booking to change was not found. Please reload the page.');
    if (previous && previous.slotId === req.slotId) throw new HttpsError('failed-precondition', 'That is the time you already have. Choose a different one, or keep it.');
    if (previous && !byStaff && !changeable(previous, now)) throw new HttpsError('failed-precondition', `Visits can be changed online up to ${labBooking.changeUntilHours} hours before. Please contact ${labStudy.contactName} at ${labStudy.contactEmail}.`);
    // Where the participant stands without the booking being replaced.
    const state = bookingState(participant, bookings.filter((b) => b.id !== req.replaces), now);
    if (state.active[req.visit]) throw new HttpsError('failed-precondition', `Your ${visitWords(req.visit)} is already booked. To move it, use “Change time”.`);
    if (!byStaff && state.next !== req.visit) {
      throw new HttpsError('failed-precondition', req.visit === 1 ? `Your first visit can be booked once ${state.missing.join(' and ')} ${state.missing.length === 1 ? 'has' : 'have'} arrived.` : 'Your second visit can be booked once your first is booked.');
    }
    if (req.visit === 1 && previous && state.active[2]) throw new HttpsError('failed-precondition', `Your second visit is already booked for ${ukSpan(state.active[2].start, state.active[2].end)}. To move your first visit, please contact ${labStudy.contactName} at ${labStudy.contactEmail}.`);
    const slot = slotSnap.data()!;
    // The window for the visit; the team's own bookings are not held to it.
    const problem = slotProblem(slot, req.visit, state.next === req.visit ? state.window : null, now, byStaff);
    if (problem) throw new HttpsError('failed-precondition', problem);

    const sequence = Math.max(-1, ...bookings.filter((b) => b.visit === req.visit).map((b) => b.sequence)) + 1;
    const booking: BookingRecord = { id: bookingRef.id, participantCode: req.code, visit: req.visit, slotId: req.slotId, start: toDate(slot.start), end: toDate(slot.end), place: placeOf(slot), status: 'booked', bookedAt: now, sequence };
    tx.set(bookingRef, {
      studyId: labStudy.studyId,
      participantCode: req.code,
      visit: req.visit,
      slotId: req.slotId,
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
    tx.update(slotRef, { booked: FieldValue.increment(1), bookingIds: FieldValue.arrayUnion(bookingRef.id), updatedAt: FieldValue.serverTimestamp() });
    if (previous) {
      tx.update(db.collection('labBookings').doc(previous.id), { status: 'cancelled', cancelledAt: now, cancelledBy: req.by, cancelReason: 'moved', replacedBy: bookingRef.id, updatedAt: FieldValue.serverTimestamp() });
      tx.update(db.collection('labSlots').doc(previous.slotId), { booked: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() });
    }
    tx.set(participantRef, { bookingIds: FieldValue.arrayUnion(bookingRef.id), [`visit${req.visit}At`]: booking.start, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { booking, previous };
  });
}

/** Cancels a standing booking and frees its place. */
export async function cancelBooking(db: Firestore, bookingId: string, by: 'participant' | 'staff', reason: string | null, now = new Date(), code: string | null = null): Promise<BookingRecord> {
  const ref = db.collection('labBookings').doc(bookingId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'That booking was not found.');
    const booking = bookingFrom(snap.id, snap.data()!);
    if (code && booking.participantCode !== code) throw new HttpsError('not-found', 'That booking was not found.');
    if (booking.status !== 'booked') throw new HttpsError('failed-precondition', 'That booking is no longer standing.');
    if (by === 'participant' && !changeable(booking, now)) throw new HttpsError('failed-precondition', `Visits can be cancelled online up to ${labBooking.changeUntilHours} hours before. Please contact ${labStudy.contactName} at ${labStudy.contactEmail}.`);
    // The cancellation's calendar file must be newer than the booking's, and the next booking's newer still.
    tx.update(ref, { status: 'cancelled', cancelledAt: now, cancelledBy: by, cancelReason: reason, sequence: booking.sequence + 1, updatedAt: FieldValue.serverTimestamp() });
    tx.update(db.collection('labSlots').doc(booking.slotId), { booked: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() });
    tx.set(db.collection('labParticipants').doc(booking.participantCode), { [`visit${booking.visit}At`]: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ...booking, status: 'cancelled' as const, sequence: booking.sequence + 1 };
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
  if (typeof input.slotId !== 'string' || !DOC_ID.test(input.slotId)) problems.push('Choose a time.');
  if (input.visit !== 1 && input.visit !== 2) problems.push('The visit is malformed.');
  if (!str(input.email, 254) || !EMAIL.test(String(input.email).trim())) problems.push('Enter an email address in the format name@example.com.');
  if (input.mobile !== null && input.mobile !== undefined && input.mobile !== '') {
    if (!str(input.mobile, 30) || !ukMobile(String(input.mobile))) problems.push('Enter a UK mobile number, such as 07700 900123, or leave it empty.');
  }
  if (typeof input.smsReminders !== 'boolean') problems.push('Say whether you want text reminders.');
  else if (input.smsReminders && !input.mobile) problems.push('Enter your mobile number for text reminders, or untick them.');
  if (input.replaces !== null && input.replaces !== undefined && (typeof input.replaces !== 'string' || !DOC_ID.test(input.replaces))) problems.push('The booking to change is malformed.');
  validateClient(input.client, problems);
  return problems;
}

/** Where someone stands, their visits, and the open times for the next one. */
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
  const slots = state.next && state.window ? await openSlots(db, state.next, state.window, now) : [];
  // A visit being changed: the times for it, in its own window.
  const changing: Partial<Record<Visit, SlotView[]>> = {};
  for (const visit of [1, 2] as Visit[]) {
    const b = state.active[visit];
    if (!b || !changeable(b, now)) continue;
    const others = bookingState(participant, bookings.filter((x) => x.id !== b.id), now);
    if (others.next === visit && others.window && !(visit === 1 && state.active[2])) changing[visit] = (await openSlots(db, visit, others.window, now)).filter((s) => s.slotId !== b.slotId);
  }
  return {
    consent: state.consent,
    missing: state.missing,
    bookings: bookings
      .filter((b) => b.status !== 'cancelled')
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((b) => bookingView(b, now)),
    next: state.next,
    window: state.window,
    slots,
    changing,
    smsAvailable: await smsReady(),
    rules: { minNoticeHours: labBooking.minNoticeHours, changeUntilHours: labBooking.changeUntilHours },
  };
});

/** Books (or moves) a visit, then emails the confirmation with its calendar file, copied to the study's contact. */
export const bookLabSlot = onCall(callOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const problems = validateBookingPayload(request.data);
  if (problems.length) throw new HttpsError('invalid-argument', problems[0], { problems });
  const p = request.data as { participantCode: string; slotId: string; visit: Visit; email: string; mobile?: string | null; smsReminders: boolean; replaces?: string | null; client: ClientInfo };
  const code = normaliseCode(p.participantCode)!;
  const db = getFirestore();
  await rateLimitLookups(db, uid, 'lab-booking', BOOKINGS_PER_HOUR);
  const now = new Date();
  const { booking, previous } = await placeBooking(db, { code, slotId: p.slotId, visit: p.visit, replaces: p.replaces ?? null, by: 'participant', uid, client: p.client }, now);
  const mobile = p.mobile ? ukMobile(p.mobile) : null;
  const contact: Contact = { email: p.email.trim(), mobile, smsReminders: Boolean(p.smsReminders && mobile) };
  await db.collection('labContacts').doc(code).set({ participantCode: code, ...contact, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const outcome = await notifyBooking(previous ? 'moved' : 'booked', booking, contact, { previous: previous ?? undefined });
  await db.collection('labBookings').doc(booking.id).set({ confirmation: { at: new Date(), ...outcome } }, { merge: true });
  logger.info(previous ? 'Lab visit moved' : 'Lab visit booked', { participantCode: code, bookingId: booking.id, visit: booking.visit, ...outcome });
  return { booking: bookingView(booking, now), email: outcome.email, sms: outcome.sms };
});

/** Cancels a visit (up to the cut-off), and emails the cancellation, copied to the study's contact. */
export const cancelLabBooking = onCall(callOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const data = request.data as { participantCode?: unknown; bookingId?: unknown } | undefined;
  const code = normaliseCode(data?.participantCode);
  if (!code) throw new HttpsError('invalid-argument', 'The participant ID is malformed.');
  if (typeof data?.bookingId !== 'string' || !DOC_ID.test(data.bookingId)) throw new HttpsError('invalid-argument', 'The booking is malformed.');
  const db = getFirestore();
  await rateLimitLookups(db, uid, 'lab-booking', BOOKINGS_PER_HOUR);
  const cancelled = await cancelBooking(db, data.bookingId, 'participant', null, new Date(), code);
  const outcome = await notifyBooking('cancelled', cancelled, await contactOf(db, code));
  await db.collection('labBookings').doc(cancelled.id).set({ cancellation: { at: new Date(), ...outcome } }, { merge: true });
  logger.info('Lab visit cancelled', { participantCode: code, bookingId: cancelled.id, visit: cancelled.visit, email: outcome.email });
  return { bookingId: cancelled.id, email: outcome.email };
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

export type JourneyAction = 'wait' | 'send' | 'skip-stale' | 'skip-unless' | 'skip-visit-2-done';

/** When a break-time message is due: its day after the first visit, at the set hour, UK time. */
export const journeyDueAt = (m: JourneyMessage, visit1Start: Date) => atUkTime(addDays(ukDate(visit1Start), m.day), labJourneyHour);

export function journeyAction(m: JourneyMessage, ctx: { visit1Start: Date; visit2: BookingRecord | null; lastCheckInAt: Date | null }, now: Date): JourneyAction {
  const dueAt = journeyDueAt(m, ctx.visit1Start);
  if (now.getTime() < dueAt.getTime()) return 'wait';
  if (now.getTime() - dueAt.getTime() > STALE_AFTER) return 'skip-stale';
  if (ctx.visit2 && ctx.visit2.start.getTime() <= now.getTime()) return 'skip-visit-2-done';
  if (m.unless === 'visit-2-booked' && ctx.visit2) return 'skip-unless';
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
