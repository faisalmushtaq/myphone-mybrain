import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookingEmail, bookingIcs, bookingState, bookingText, journeyAction, journeyMessage, nextTextTime, reminderAction, slotProblem, validateBookingPayload, type BookingRecord } from './booking.js';
import { labBooking, labJourneyMessages } from './forms.js';
import { foldLine, icsFor } from './ics.js';
import { participantLinks, storyLink } from './links.js';
import { ukMobile } from './sms.js';
import { addDays, atUkTime, ukClock, ukDate, ukLongDate, ukSpan } from './ukTime.js';

const client = { userAgent: 'test', submittedAt: new Date().toISOString(), timezoneOffset: 0 };
const H = 3600_000;
const D = 24 * H;

function booking(over: Partial<BookingRecord> = {}): BookingRecord {
  return {
    id: 'b1',
    participantCode: 'MP2670FF90A5F2',
    visit: 1,
    slotId: 's1',
    start: new Date('2026-10-14T09:00:00Z'),
    end: new Date('2026-10-14T11:00:00Z'),
    place: { ...labBooking.location },
    status: 'booked',
    bookedAt: new Date('2026-10-01T12:00:00Z'),
    sequence: 0,
    ...over,
  };
}

test('UK time: dates and clock times in GMT and in BST', () => {
  // 14 October is BST (UTC+1): 09:00 UTC is 10:00 in Leeds.
  assert.equal(ukClock(new Date('2026-10-14T09:00:00Z')), '10:00');
  assert.equal(atUkTime('2026-10-14', 10).toISOString(), '2026-10-14T09:00:00.000Z');
  // 14 December is GMT.
  assert.equal(atUkTime('2026-12-14', 10).toISOString(), '2026-12-14T10:00:00.000Z');
  // Just after midnight in Leeds is still the day before in UTC.
  assert.equal(ukDate(new Date('2026-06-30T23:30:00Z')), '2026-07-01');
  assert.equal(addDays('2026-10-14', 30), '2026-11-13');
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(ukLongDate(new Date('2026-10-14T09:00:00Z')), 'Wednesday 14 October 2026');
  assert.equal(ukSpan(new Date('2026-10-14T09:00:00Z'), new Date('2026-10-14T11:00:00Z')), 'Wednesday 14 October 2026, 10:00 to 12:00');
  // The night the clocks go back (25 October 2026): 09:00 is GMT again.
  assert.equal(atUkTime('2026-10-25', 9).toISOString(), '2026-10-25T09:00:00.000Z');
});

test('calendar files: folded lines, CRLF, a reminder the day before, cancellations', () => {
  const long = `DESCRIPTION:${'é'.repeat(60)}`;
  for (const line of foldLine(long).split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, 'every folded line within 75 octets');
  assert.equal(foldLine(long).replace(/\r\n /g, ''), long, 'unfolding gives the line back');
  const ics = bookingIcs(booking(), false, new Date('2026-10-01T12:00:00Z'));
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'every line ends in CRLF');
  assert.match(ics, /UID:MP2670FF90A5F2-visit-1@myphonemybrain\.com/);
  assert.match(ics, /DTSTART:20261014T090000Z/);
  assert.match(ics, /DTEND:20261014T110000Z/);
  assert.match(ics, /METHOD:PUBLISH/);
  assert.match(ics, /TRIGGER:-P1D/);
  assert.match(ics, /LOCATION:School of Psychology\\, University of Leeds\\, Leeds LS2 9JT/);
  const cancelled = bookingIcs(booking({ sequence: 1 }), true);
  assert.match(cancelled, /METHOD:CANCEL/);
  assert.match(cancelled, /STATUS:CANCELLED/);
  assert.match(cancelled, /SEQUENCE:1/);
  assert.doesNotMatch(cancelled, /VALARM/);
  assert.match(icsFor({ uid: 'x', start: new Date(0), end: new Date(1), summary: 'a;b,c', location: '', description: 'line\nnext' }), /SUMMARY:a\\;b\\,c\r\n/);
});

test('UK mobile numbers in their usual forms; anything else is refused', () => {
  for (const n of ['07700 900123', '+44 7700 900123', '0044 7700 900123', '447700900123', '7700900123', '(07700) 900-123']) assert.equal(ukMobile(n), '+447700900123', n);
  for (const n of ['0113 343 5000', '+33 6 12 34 56 78', '0770090012', '', 'phone']) assert.equal(ukMobile(n), null, n);
});

test('who can book what: a first visit once the data is in, a second in the window after it', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const none = bookingState(undefined, [], now);
  assert.deepEqual(none.missing, ['your consent', 'your screen-time screenshots', 'the cleaned data from at least one of your apps']);
  assert.equal(none.next, null);
  const consented = { consentId: 'c1', phaseCounts: { pre: { screenshots: 2, archives: 0 }, mid: { screenshots: 0, archives: 0 }, post: { screenshots: 0, archives: 0 } } };
  assert.deepEqual(bookingState(consented, [], now).missing, ['the cleaned data from at least one of your apps']);
  const ready = { ...consented, phaseCounts: { ...consented.phaseCounts, pre: { screenshots: 2, archives: 1 } } };
  const first = bookingState(ready, [], now);
  assert.equal(first.next, 1);
  assert.equal(first.window?.from, '2026-10-01');
  const v1 = booking();
  const second = bookingState(ready, [v1], now);
  assert.equal(second.next, 2);
  assert.deepEqual(second.window, { from: addDays('2026-10-14', labBooking.visit2AfterDays.min), to: addDays('2026-10-14', labBooking.visit2AfterDays.max) });
  assert.equal(bookingState(ready, [v1, booking({ id: 'b2', visit: 2, start: new Date('2026-11-13T10:00:00Z') })], now).next, null);
  // A missed first visit can be booked again; a cancelled one is gone.
  assert.equal(bookingState(ready, [booking({ status: 'missed' })], now).next, 1);
  assert.equal(bookingState(ready, [booking({ status: 'cancelled' })], now).next, 1);
  // Rows from before phases were counted hold only totals, from the first page.
  assert.equal(bookingState({ consentId: 'c', screenshotCount: 1, archiveCount: 1 }, [], now).next, 1);
});

test('a slot can take a visit only when open, not full, for that visit, with notice, in the window', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const slot = (over: Record<string, unknown> = {}) => ({ status: 'open', booked: 0, capacity: 1, visit: null, start: new Date('2026-10-14T09:00:00Z'), ...over });
  const window = { from: '2026-10-01', to: '2026-12-31' };
  assert.equal(slotProblem(slot(), 1, window, now), null);
  assert.match(slotProblem(slot({ status: 'closed' }), 1, window, now)!, /no longer available/);
  assert.match(slotProblem(slot({ booked: 1 }), 1, window, now)!, /just been taken/);
  assert.equal(slotProblem(slot({ booked: 1, capacity: 2 }), 1, window, now), null);
  assert.match(slotProblem(slot({ visit: 2 }), 1, window, now)!, /second lab visit/);
  assert.match(slotProblem(slot({ start: new Date(now.getTime() + 2 * H) }), 1, window, now)!, /24 hours ahead/);
  assert.equal(slotProblem(slot({ start: new Date(now.getTime() + 2 * H) }), 1, window, now, true), null, 'the team may book at short notice');
  assert.match(slotProblem(slot({ start: new Date(now.getTime() - H) }), 1, window, now, true)!, /passed/);
  assert.match(slotProblem(slot({ start: new Date('2026-10-20T09:00:00Z') }), 2, { from: '2026-11-13', to: '2026-11-18' }, now)!, /between Friday 13 November 2026 and Wednesday 18 November 2026/);
});

test('visit reminders: due times, texts only in the daytime, nothing after a late booking or too close to the visit', () => {
  const start = new Date('2026-10-14T08:00:00Z'); // 09:00 in Leeds
  const b = { start, bookedAt: new Date('2026-10-01T12:00:00Z') };
  assert.equal(reminderAction(24, 'email', b, new Date(start.getTime() - 25 * H)), 'wait');
  assert.equal(reminderAction(24, 'email', b, new Date(start.getTime() - 24 * H)), 'send');
  // Two hours before a 09:00 visit is 07:00: the text waits for 08:00.
  assert.equal(reminderAction(2, 'sms', b, new Date(start.getTime() - 2 * H)), 'wait');
  assert.equal(reminderAction(2, 'sms', b, new Date(start.getTime() - H)), 'send');
  assert.equal(nextTextTime(new Date('2026-10-14T05:00:00Z')).toISOString(), '2026-10-14T07:00:00.000Z');
  assert.equal(nextTextTime(new Date('2026-10-14T21:30:00Z')).toISOString(), '2026-10-15T07:00:00.000Z');
  // For an 08:00 visit the 06:00 text would only be possible at 08:00: skipped.
  const early = { start: new Date('2026-10-14T07:00:00Z'), bookedAt: b.bookedAt };
  assert.equal(reminderAction(2, 'sms', early, new Date('2026-10-14T07:00:00Z')), 'skip-too-late');
  assert.equal(reminderAction(24, 'email', { start, bookedAt: new Date(start.getTime() - 20 * H) }, new Date(start.getTime() - 19 * H)), 'skip-booked-late');
});

test('break-time messages: on their day at nine, skipped when stale or not needed', () => {
  const visit1Start = new Date('2026-10-14T09:00:00Z');
  const checkIn1 = labJourneyMessages.find((m) => m.id === 'check-in-1')!;
  const due = atUkTime(addDays('2026-10-14', checkIn1.day), 9);
  assert.equal(due.toISOString(), '2026-10-21T08:00:00.000Z');
  const ctx = { visit1Start, visit2: null, lastCheckInAt: null };
  assert.equal(journeyAction(checkIn1, ctx, new Date(due.getTime() - 60_000)), 'wait');
  assert.equal(journeyAction(checkIn1, ctx, due), 'send');
  assert.equal(journeyAction(checkIn1, ctx, new Date(due.getTime() + 2 * D)), 'skip-stale');
  assert.equal(journeyAction(checkIn1, { ...ctx, lastCheckInAt: new Date(due.getTime() - D) }, due), 'skip-unless');
  const book2 = labJourneyMessages.find((m) => m.id === 'book-visit-2')!;
  const book2Due = atUkTime(addDays('2026-10-14', book2.day), 9);
  assert.equal(journeyAction(book2, { ...ctx, visit2: booking({ visit: 2, start: new Date('2026-11-13T10:00:00Z') }) }, book2Due), 'skip-unless');
  assert.equal(journeyAction(book2, ctx, book2Due), 'send');
  for (const m of labJourneyMessages) assert.ok(journeyMessage(m.id, 'MP2670FF90A5F2', null), `${m.id} has wording`);
  for (const m of labJourneyMessages) assert.ok(journeyMessage(m.id, 'MP2670FF90A5F2', null)!.sms.length <= 160, `${m.id} fits one text`);
});

test('the confirmation email: the time, the place, the links, and what to do to change it', () => {
  const contact = { email: 'jane@example.com', mobile: '+447700900123', smsReminders: true };
  const { subject, text } = bookingEmail('booked', booking(), contact);
  assert.equal(subject, 'MyPhone/MyBrain: your first lab visit is booked for Wed 14 Oct, 10:00');
  assert.match(text, /When: {2}Wednesday 14 October 2026, 10:00 to 12:00 \(UK time\)/);
  assert.match(text, /Participant ID: MP2670FF90A5F2/);
  assert.match(text, /https:\/\/myphonemybrain\.com\/break\/book\/\?code=MP2670FF90A5F2/);
  assert.match(text, /text you the day before and on the day/);
  assert.match(text, /\/break\/mystory\/\?phase=pre&code=MP2670FF90A5F2/);
  const moved = bookingEmail('moved', booking({ start: new Date('2026-10-15T09:00:00Z'), end: new Date('2026-10-15T11:00:00Z') }), { ...contact, smsReminders: false }, { previous: booking() });
  assert.match(moved.subject, /has moved to Thu 15 Oct, 10:00/);
  assert.match(moved.text, /from Wednesday 14 October 2026, 10:00 to 12:00/);
  assert.match(moved.text, /email you a reminder the day before\./);
  const cancelled = bookingEmail('cancelled', booking(), contact, { byTeam: true, reason: 'The lab is closed that day.' });
  assert.match(cancelled.text, /cancelled by the research team\. The lab is closed that day\./);
  for (const kind of ['booked', 'moved', 'day-before', 'same-day'] as const) assert.ok(bookingText(kind, booking()).length <= 160, `${kind} text fits one message`);
  assert.doesNotMatch(bookingText('day-before', booking()), /[‘’“”]/, 'texts use plain characters');
});

test('booking requests: an email, a UK mobile only when texts are wanted', () => {
  const ok = { participantCode: 'MP2670FF90A5F2', slotId: 'abc123', visit: 1, email: 'jane@example.com', mobile: '', smsReminders: false, client };
  assert.deepEqual(validateBookingPayload(ok), []);
  assert.deepEqual(validateBookingPayload({ ...ok, mobile: '07700 900123', smsReminders: true }), []);
  assert.match(validateBookingPayload({ ...ok, smsReminders: true }).join(' '), /mobile number for text reminders/);
  assert.match(validateBookingPayload({ ...ok, mobile: '0113 343 5000' }).join(' '), /UK mobile/);
  assert.match(validateBookingPayload({ ...ok, email: 'nope' }).join(' '), /email address/);
  assert.match(validateBookingPayload({ ...ok, visit: 3 }).join(' '), /visit/);
  assert.match(validateBookingPayload({ ...ok, slotId: '../x' }).join(' '), /Choose a time/);
});

test('personal links: every page with the ID, MyStory by phase', () => {
  const links = participantLinks('MP2670FF90A5F2');
  assert.equal(links.takePart, 'https://myphonemybrain.com/break/take-part/?code=MP2670FF90A5F2');
  assert.equal(links.book, 'https://myphonemybrain.com/break/book/?code=MP2670FF90A5F2');
  assert.equal(links.checkIn, 'https://myphonemybrain.com/break/check-in/?code=MP2670FF90A5F2');
  assert.equal(links.after, 'https://myphonemybrain.com/break/after/?code=MP2670FF90A5F2');
  assert.equal(links.story.mid, 'https://myphonemybrain.com/break/mystory/?phase=mid&code=MP2670FF90A5F2');
  assert.equal(storyLink('post', 'MP2670FF90A5F2'), 'https://myphonemybrain.com/break/mystory/?phase=post&code=MP2670FF90A5F2');
});
