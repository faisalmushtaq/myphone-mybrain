import { FieldValue, getFirestore, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { createHash, timingSafeEqual } from 'node:crypto';
import { bookingFrom, bookingsOf, bookingState, bookingView, cancelBooking, contactOf, notifyBooking, placeBooking, toDate, type Contact, type Visit } from './booking.js';
import { labBooking, labJourneyMessages, schools } from './forms.js';
import { normaliseCode, notUsedOf, phaseCountsOf, toIso } from './lab.js';
import { participantLinks, schoolUploadLink } from './links.js';
import { sendMail, settingsFromEnv } from './mail.js';
import { countFailure, schoolBySlug, setSchoolPassword } from './schoolUpload.js';
import { readSecret } from './secrets.js';
import { sendSms, smsReady, ukMobile } from './sms.js';
import { isObj } from './validate.js';

/**
 * The research team's page (myphonemybrain.com/break/staff/), behind the
 * staff key: a long random password kept in Secret Manager
 * (scripts/set-staff-key.sh makes it), shared only within the team. One
 * callable, staffApi, does everything the page needs:
 *
 *   overview        the lab slots and bookings from a fortnight ago onwards, and whether email and texts are set up
 *   add-slots       new times (one, or a batch the page builds from a pattern)
 *   update-slot     open or close a time, change its places, place name or note
 *   delete-slot     remove a time nobody has booked
 *   book-for        book a participant into a time (no notice, window or data checks)
 *   cancel-booking  cancel a booking, telling the participant or not
 *   mark-booking    attended, missed, or back to booked
 *   resend          send a booking's confirmation again
 *   participants    everyone in the break study, with where they stand
 *   participant     one participant: files, check-ins, stories, visits, contact, messages, their links
 *   pause-messages  stop (or restart) the automatic reminders and messages for someone
 *   schools         each school's upload page, whether it has a password, and what it has sent
 *   school-password a new password for a school's upload page, shown once
 *   school-revoke   close a school's upload page
 *   test-message    send a test email and text, to check they arrive
 */

const REGION = 'europe-west2';
const callOptions = { region: REGION, memory: '512MiB' as const, timeoutSeconds: 120, enforceAppCheck: process.env.MPMB_ENFORCE_APP_CHECK === 'true' };
const FAILURES_PER_HOUR = 10;
const DOC_ID = /^[A-Za-z0-9]{1,40}$/;
const DAY = 86_400_000;

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** Lets the call through only with the staff key; after too many wrong keys from one browser, nothing is checked for an hour. */
async function checkStaff(db: Firestore, uid: string, key: unknown): Promise<void> {
  if (!(await countFailure(db, `staff-fail-${uid}`, FAILURES_PER_HOUR, false))) throw new HttpsError('failed-precondition', 'Too many wrong staff keys from this browser. Please wait an hour.');
  const secret = await readSecret(process.env.MPMB_STAFF_SECRET?.trim() || 'mpmb-staff-key');
  if (!secret) throw new HttpsError('failed-precondition', 'The staff key is not set up yet. Run consent-app/firebase/scripts/set-staff-key.sh once in Cloud Shell.');
  const ok = typeof key === 'string' && key.length <= 200 && timingSafeEqual(digest(key.trim()), digest(secret));
  if (!ok) {
    await countFailure(db, `staff-fail-${uid}`, FAILURES_PER_HOUR, true);
    throw new HttpsError('permission-denied', 'That staff key is not right.');
  }
}

const bad = (message: string) => new HttpsError('invalid-argument', message);
const docId = (v: unknown, what: string) => {
  if (typeof v !== 'string' || !DOC_ID.test(v)) throw bad(`The ${what} is malformed.`);
  return v;
};
const codeOf = (v: unknown) => {
  const code = normaliseCode(v);
  if (!code) throw bad('That is not a participant ID (MP and twelve letters and digits).');
  return code;
};

function slotRow(id: string, d: DocumentData) {
  return { slotId: id, start: toDate(d.start).toISOString(), end: toDate(d.end).toISOString(), visit: d.visit === 1 || d.visit === 2 ? d.visit : null, capacity: Number(d.capacity ?? 1), booked: Number(d.booked ?? 0), status: d.status === 'closed' ? 'closed' : 'open', location: typeof d.location === 'string' ? d.location : null, note: typeof d.note === 'string' ? d.note : null };
}

function bookingRow(id: string, d: DocumentData, contact: Contact | null) {
  const b = bookingFrom(id, d);
  return { ...bookingView(b, new Date()), participantCode: b.participantCode, bookedAt: b.bookedAt.toISOString(), bookedBy: d.bookedBy ?? null, cancelledBy: d.cancelledBy ?? null, cancelReason: d.cancelReason ?? null, confirmation: plainOf(d.confirmation), reminders: plainOf(d.reminders), contact };
}

/** Firestore values as plain JSON for the page (times as ISO strings). */
function plainOf(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const iso = toIso(value);
  if (iso && typeof value !== 'string') return iso;
  if (Array.isArray(value)) return value.map(plainOf);
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plainOf(v)]));
  return value;
}

export interface NewSlot {
  start: string;
  minutes: number;
  capacity: number;
  visit: Visit | null;
  location: string | null;
  note: string | null;
}

export function validateNewSlots(input: unknown, now = new Date()): { slots: NewSlot[]; problems: string[] } {
  const problems: string[] = [];
  if (!Array.isArray(input) || !input.length) return { slots: [], problems: ['No times to add.'] };
  if (input.length > 300) return { slots: [], problems: ['At most 300 times at once.'] };
  const slots: NewSlot[] = [];
  input.forEach((s, i) => {
    const n = i + 1;
    if (!isObj(s)) return problems.push(`Time ${n} is malformed.`);
    const start = typeof s.start === 'string' ? new Date(s.start) : new Date(Number.NaN);
    if (Number.isNaN(start.getTime())) return problems.push(`Time ${n} has no valid start.`);
    if (start.getTime() < now.getTime()) return problems.push(`Time ${n} (${start.toISOString()}) is in the past.`);
    if (start.getTime() > now.getTime() + 400 * DAY) return problems.push(`Time ${n} is more than a year ahead.`);
    const minutes = Number(s.minutes ?? labBooking.minutes);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 600) return problems.push(`Time ${n} needs a length between 15 minutes and 10 hours.`);
    const capacity = Number(s.capacity ?? 1);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20) return problems.push(`Time ${n} needs between 1 and 20 places.`);
    const visit = s.visit === 1 || s.visit === 2 ? s.visit : s.visit === null || s.visit === undefined ? null : Number.NaN;
    if (Number.isNaN(visit)) return problems.push(`Time ${n} names an unknown visit.`);
    const location = typeof s.location === 'string' && s.location.trim() ? s.location.trim().slice(0, 200) : null;
    const note = typeof s.note === 'string' && s.note.trim() ? s.note.trim().slice(0, 500) : null;
    slots.push({ start: start.toISOString(), minutes, capacity, visit: visit as Visit | null, location, note });
  });
  return { slots, problems };
}

async function overview(db: Firestore) {
  const now = new Date();
  const from = new Date(now.getTime() - 14 * DAY);
  const [slotSnap, bookingSnap] = await Promise.all([db.collection('labSlots').where('start', '>=', from).orderBy('start').limit(2000).get(), db.collection('labBookings').where('start', '>=', from).orderBy('start').limit(2000).get()]);
  const codes = Array.from(new Set(bookingSnap.docs.map((d) => String(d.data().participantCode))));
  const contacts = new Map(await Promise.all(codes.map(async (c) => [c, await contactOf(db, c)] as const)));
  return {
    now: now.toISOString(),
    slots: slotSnap.docs.map((d) => slotRow(d.id, d.data())),
    bookings: bookingSnap.docs.map((d) => bookingRow(d.id, d.data(), contacts.get(String(d.data().participantCode)) ?? null)),
    ready: { email: Boolean(settingsFromEnv()), sms: await smsReady() },
    rules: { minutes: labBooking.minutes, minNoticeHours: labBooking.minNoticeHours, changeUntilHours: labBooking.changeUntilHours, visit2AfterDays: labBooking.visit2AfterDays, location: labBooking.location.name, messages: labJourneyMessages.map((m) => ({ id: m.id, day: m.day })), reminders: labBooking.reminders },
  };
}

async function participantDetail(db: Firestore, code: string) {
  const ref = db.collection('labParticipants').doc(code);
  const p = (await ref.get()).data();
  const bookings = await bookingsOf(db, code);
  const bookingDocs = await db.collection('labBookings').where('participantCode', '==', code).get();
  const contact = await contactOf(db, code);
  const reminder = (await db.collection('labReminders').doc(code).get()).data();
  const state = bookingState(p, bookings, new Date());
  return {
    participantCode: code,
    exists: Boolean(p?.consentId),
    consentedAt: toIso(p?.consentedAt),
    phases: p ? phaseCountsOf(p) : null,
    platformsNotUsed: p ? notUsedOf(p) : [],
    checkIns: Number(p?.checkInCount ?? 0),
    lastCheckInAt: toIso(p?.lastCheckInAt),
    stories: plainOf(p?.storyCounts) ?? {},
    missing: state.missing,
    next: state.next,
    window: state.window,
    bookings: bookingDocs.docs.map((d) => bookingRow(d.id, d.data(), null)).sort((a, b) => a.start.localeCompare(b.start)),
    contact,
    progressEmail: typeof reminder?.email === 'string' ? reminder.email : null,
    messages: plainOf(p?.messages) ?? {},
    messagesPaused: Boolean(p?.messagesPaused),
    links: participantLinks(code),
  };
}

async function participantsList(db: Firestore) {
  const now = new Date();
  const [participants, bookings] = await Promise.all([db.collection('labParticipants').get(), db.collection('labBookings').get()]);
  const byCode = new Map<string, ReturnType<typeof bookingFrom>[]>();
  for (const d of bookings.docs) {
    const b = bookingFrom(d.id, d.data());
    byCode.set(b.participantCode, [...(byCode.get(b.participantCode) ?? []), b]);
  }
  return participants.docs
    .filter((d) => d.data().consentId)
    .map((d) => {
      const p = d.data();
      const state = bookingState(p, byCode.get(d.id) ?? [], now);
      const phases = phaseCountsOf(p);
      return {
        participantCode: d.id,
        consentedAt: toIso(p.consentedAt),
        pre: phases.pre,
        mid: phases.mid,
        post: phases.post,
        checkIns: Number(p.checkInCount ?? 0),
        stories: plainOf(p.storyCounts) ?? {},
        visit1: state.active[1] ? { start: state.active[1].start.toISOString(), status: state.active[1].status } : null,
        visit2: state.active[2] ? { start: state.active[2].start.toISOString(), status: state.active[2].status } : null,
        next: state.next,
        missing: state.missing,
        messagesPaused: Boolean(p.messagesPaused),
      };
    })
    .sort((a, b) => String(b.consentedAt).localeCompare(String(a.consentedAt)));
}

async function schoolsList(db: Firestore) {
  const [access, uploads] = await Promise.all([db.collection('schoolUploadAccess').get(), db.collection('schoolUploads').get()]);
  const accessBy = new Map(access.docs.map((d) => [d.id, d.data()]));
  return schools.map((s) => {
    const a = accessBy.get(s.slug);
    return {
      slug: s.slug,
      id: s.id,
      name: s.name,
      link: schoolUploadLink(s.slug),
      password: a?.active ? 'set' : a ? 'revoked' : 'none',
      setAt: toIso(a?.setAt),
      uploads: uploads.docs
        .filter((u) => u.data().schoolSlug === s.slug)
        .map((u) => ({ uploadId: u.id, receivedAt: toIso(u.data().receivedAt), fileName: u.data().fileName, pupils: Number(u.data().pupilCount ?? 0), valid: Number(u.data().validUpns ?? 0), problems: Array.isArray(u.data().problems) ? u.data().problems.length : 0, uploader: plainOf(u.data().uploader) }))
        .sort((x, y) => String(y.receivedAt).localeCompare(String(x.receivedAt))),
    };
  });
}

export const staffApi = onCall(callOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const data = (isObj(request.data) ? request.data : {}) as Record<string, unknown>;
  const db = getFirestore();
  await checkStaff(db, uid, data.staffKey);
  const action = String(data.action ?? '');
  const now = new Date();
  switch (action) {
    case 'overview':
      return overview(db);

    case 'add-slots': {
      const { slots, problems } = validateNewSlots(data.slots, now);
      if (problems.length) throw new HttpsError('invalid-argument', problems[0], { problems });
      // The same start at the same place twice is a double click, not two rooms: skipped.
      const starts = slots.map((s) => new Date(s.start).getTime());
      const existing = await db.collection('labSlots').where('start', '>=', new Date(Math.min(...starts))).where('start', '<=', new Date(Math.max(...starts))).get();
      const taken = new Set(existing.docs.map((d) => `${toDate(d.data().start).toISOString()}|${d.data().location ?? ''}`));
      const batch = db.batch();
      const created: string[] = [];
      let skipped = 0;
      for (const s of slots) {
        const key = `${s.start}|${s.location ?? ''}`;
        if (taken.has(key)) {
          skipped += 1;
          continue;
        }
        taken.add(key);
        const ref = db.collection('labSlots').doc();
        const start = new Date(s.start);
        batch.set(ref, { start, end: new Date(start.getTime() + s.minutes * 60_000), visit: s.visit, capacity: s.capacity, booked: 0, bookingIds: [], location: s.location, note: s.note, status: 'open', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        created.push(ref.id);
      }
      await batch.commit();
      logger.info('Lab slots added', { created: created.length, skipped });
      return { created: created.length, skipped };
    }

    case 'update-slot': {
      const ref = db.collection('labSlots').doc(docId(data.slotId, 'time'));
      return db.runTransaction(async (tx) => {
        const slot = (await tx.get(ref)).data();
        if (!slot) throw new HttpsError('not-found', 'That time was not found.');
        const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
        if (data.status === 'open' || data.status === 'closed') patch.status = data.status;
        if (data.capacity !== undefined) {
          const capacity = Number(data.capacity);
          if (!Number.isInteger(capacity) || capacity < Number(slot.booked ?? 0) || capacity > 20) throw bad(`Places must be a whole number from ${Math.max(1, Number(slot.booked ?? 0))} (already booked) to 20.`);
          patch.capacity = capacity;
        }
        if (data.location !== undefined) patch.location = typeof data.location === 'string' && data.location.trim() ? data.location.trim().slice(0, 200) : null;
        if (data.note !== undefined) patch.note = typeof data.note === 'string' && data.note.trim() ? data.note.trim().slice(0, 500) : null;
        if (data.visit !== undefined) patch.visit = data.visit === 1 || data.visit === 2 ? data.visit : null;
        tx.update(ref, patch);
        return { ok: true };
      });
    }

    case 'delete-slot': {
      const ref = db.collection('labSlots').doc(docId(data.slotId, 'time'));
      return db.runTransaction(async (tx) => {
        const slot = (await tx.get(ref)).data();
        if (!slot) throw new HttpsError('not-found', 'That time was not found.');
        if (Number(slot.booked ?? 0) > 0) throw new HttpsError('failed-precondition', 'Someone is booked into this time. Cancel or move their booking first, or close the time instead.');
        tx.delete(ref);
        return { ok: true };
      });
    }

    case 'book-for': {
      const code = codeOf(data.participantCode);
      const visit = data.visit === 2 ? 2 : data.visit === 1 ? 1 : null;
      if (!visit) throw bad('Choose the visit.');
      const replaces = data.replaces === undefined || data.replaces === null ? null : docId(data.replaces, 'booking to replace');
      const { booking, previous } = await placeBooking(db, { code, slotId: docId(data.slotId, 'time'), visit, replaces, by: 'staff', uid, client: null }, now);
      const current = await contactOf(db, code);
      const email = typeof data.email === 'string' && data.email.trim() ? data.email.trim() : current.email;
      const mobile = typeof data.mobile === 'string' && data.mobile.trim() ? ukMobile(data.mobile) : current.mobile;
      if (typeof data.mobile === 'string' && data.mobile.trim() && !mobile) throw bad('That is not a UK mobile number.');
      const contact: Contact = { email, mobile, smsReminders: typeof data.smsReminders === 'boolean' ? data.smsReminders && Boolean(mobile) : current.smsReminders && Boolean(mobile) };
      if (email !== current.email || mobile !== current.mobile || contact.smsReminders !== current.smsReminders) await db.collection('labContacts').doc(code).set({ participantCode: code, ...contact, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      const outcome = data.notify === false ? { email: 'not-asked', sms: 'not-asked' } : await notifyBooking(previous ? 'moved' : 'booked', booking, contact, { previous: previous ?? undefined });
      await db.collection('labBookings').doc(booking.id).set({ confirmation: { at: new Date(), ...outcome } }, { merge: true });
      logger.info('Lab visit booked by the team', { participantCode: code, bookingId: booking.id, visit, ...outcome });
      return { bookingId: booking.id, ...outcome };
    }

    case 'cancel-booking': {
      const reason = typeof data.reason === 'string' && data.reason.trim() ? data.reason.trim().slice(0, 300) : null;
      const cancelled = await cancelBooking(db, docId(data.bookingId, 'booking'), 'staff', reason, now);
      const outcome = data.notify === false ? { email: 'not-asked', sms: 'not-asked' } : await notifyBooking('cancelled', cancelled, await contactOf(db, cancelled.participantCode), { byTeam: true, reason: reason ?? undefined });
      await db.collection('labBookings').doc(cancelled.id).set({ cancellation: { at: new Date(), ...outcome } }, { merge: true });
      return { ok: true, ...outcome };
    }

    case 'mark-booking': {
      const status = data.status;
      if (status !== 'attended' && status !== 'missed' && status !== 'booked') throw bad('Mark it attended, missed, or booked.');
      const ref = db.collection('labBookings').doc(docId(data.bookingId, 'booking'));
      const b = (await ref.get()).data();
      if (!b) throw new HttpsError('not-found', 'That booking was not found.');
      if (b.status === 'cancelled') throw new HttpsError('failed-precondition', 'That booking was cancelled.');
      await ref.set({ status, markedAt: now, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { ok: true };
    }

    case 'resend': {
      const snap = await db.collection('labBookings').doc(docId(data.bookingId, 'booking')).get();
      if (!snap.exists) throw new HttpsError('not-found', 'That booking was not found.');
      const b = bookingFrom(snap.id, snap.data()!);
      if (b.status !== 'booked') throw new HttpsError('failed-precondition', 'Only a standing booking can be confirmed again.');
      const outcome = await notifyBooking('booked', b, await contactOf(db, b.participantCode));
      await snap.ref.set({ resent: FieldValue.arrayUnion({ at: now, ...outcome }) }, { merge: true });
      return outcome;
    }

    case 'participants':
      return { participants: await participantsList(db) };

    case 'participant':
      return participantDetail(db, codeOf(data.participantCode));

    case 'pause-messages': {
      const code = codeOf(data.participantCode);
      await db.collection('labParticipants').doc(code).set({ messagesPaused: Boolean(data.paused), messagesPausedAt: data.paused ? now : null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { ok: true, messagesPaused: Boolean(data.paused) };
    }

    case 'schools':
      return { schools: await schoolsList(db) };

    case 'school-password': {
      const school = schoolBySlug(data.school);
      if (!school) throw bad('Unknown school.');
      return setSchoolPassword(db, school);
    }

    case 'school-revoke': {
      const school = schoolBySlug(data.school);
      if (!school) throw bad('Unknown school.');
      await db.collection('schoolUploadAccess').doc(school.slug).set({ active: false, revokedAt: now }, { merge: true });
      return { ok: true };
    }

    case 'test-message': {
      const email = typeof data.email === 'string' && data.email.trim() ? data.email.trim() : null;
      const mobile = typeof data.mobile === 'string' && data.mobile.trim() ? data.mobile.trim() : null;
      if (!email && !mobile) throw bad('Enter an email address or a mobile number to test.');
      return {
        email: email ? await sendMail({ to: email, subject: 'MyPhone/MyBrain: test email', text: 'This is a test from the MyPhone/MyBrain staff page. Booking confirmations and reminders will arrive like this.' }) : null,
        sms: mobile ? await sendSms(mobile, 'MyPhone/MyBrain: this is a test text from the staff page. Reminders will arrive like this.') : null,
      };
    }

    default:
      throw bad('Unknown action.');
  }
});
