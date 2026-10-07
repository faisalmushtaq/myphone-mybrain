import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addressChangedEmail, bookingIcs, bookingState, offerWindows, bookingText, journeyAction, journeyMessage, maskedContact, maskEmail, nextTextTime, reminderAction, reminderEmail, slotProblem, validateBookingPayload, visitsEmail, visitsText, visitWindow, type BookingRecord } from './booking.js';
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

test('who can book what: nothing until the data is in, then both visits together', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const none = bookingState(undefined, [], now);
  assert.deepEqual(none.missing, ['your consent', 'your screen-time screenshots', 'the cleaned data from at least one of your apps']);
  assert.deepEqual(none.toBook, []);
  const consented = { consentId: 'c1', phaseCounts: { pre: { screenshots: 2, archives: 0 }, mid: { screenshots: 0, archives: 0 }, post: { screenshots: 0, archives: 0 } } };
  assert.deepEqual(bookingState(consented, [], now).missing, ['the cleaned data from at least one of your apps']);
  assert.deepEqual(bookingState(consented, [], now).toBook, [], 'nothing to book while data is missing');
  const ready = { ...consented, phaseCounts: { ...consented.phaseCounts, pre: { screenshots: 2, archives: 1 } } };
  assert.deepEqual(bookingState(ready, [], now).toBook, [1, 2]);
  const v1 = booking();
  const v2 = booking({ id: 'b2', visit: 2, slotId: 's2', start: new Date('2026-11-12T10:00:00Z'), end: new Date('2026-11-12T12:00:00Z') });
  assert.deepEqual(bookingState(ready, [v1, v2], now).toBook, []);
  assert.equal(bookingState(ready, [v1, v2], now).active[2]?.id, 'b2');
  // A missed or cancelled visit leaves that one to book again.
  assert.deepEqual(bookingState(ready, [booking({ status: 'missed' }), v2], now).toBook, [1]);
  assert.deepEqual(bookingState(ready, [booking({ status: 'attended' }), { ...v2, status: 'cancelled' }], now).toBook, [2]);
  // Rows from before phases were counted hold only totals, from the first page.
  assert.deepEqual(bookingState({ consentId: 'c', screenshotCount: 1, archiveCount: 1 }, [], now).toBook, [1, 2]);
});

test('the days each visit can be on: the second 28 to 35 days after the first', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  assert.deepEqual(labBooking.visit2AfterDays, { min: 28, max: 35 });
  assert.deepEqual(visitWindow(1, null, now), { from: '2026-10-01', to: addDays('2026-10-01', labBooking.horizonDays) });
  assert.deepEqual(visitWindow(2, null, now), { from: '2026-10-29', to: addDays(addDays('2026-10-01', labBooking.horizonDays), 35) });
  assert.deepEqual(visitWindow(2, new Date('2026-10-14T09:00:00Z'), now), { from: '2026-11-11', to: '2026-11-18' });
  // A first visit moved against a second that stays: 28 to 35 days before it, never in the past.
  assert.deepEqual(visitWindow(1, new Date('2026-11-13T10:00:00Z'), now), { from: '2026-10-09', to: '2026-10-16' });
  assert.deepEqual(visitWindow(1, new Date('2026-11-01T10:00:00Z'), now), { from: '2026-10-01', to: '2026-10-04' });
  // The page's lists: the second visit's from 28 days on, or sooner after a first visit already held.
  const ready = { consentId: 'c', screenshotCount: 1, archiveCount: 1 };
  assert.deepEqual(offerWindows(bookingState(ready, [], now), now)[2].from, '2026-10-29');
  assert.deepEqual(offerWindows(bookingState(ready, [booking({ status: 'attended', start: new Date('2026-09-20T09:00:00Z') })], now), now)[2].from, '2026-10-18');
  assert.deepEqual(offerWindows(bookingState(ready, [booking({ status: 'attended', start: new Date('2026-08-01T09:00:00Z') })], now), now)[2].from, '2026-10-01');
  assert.deepEqual(offerWindows(bookingState(ready, [booking()], now), now)[2].from, '2026-10-29');
  // Near midnight the UK date counts, not the UTC one: 23:30 UTC on 30 June is 1 July in Leeds.
  assert.equal(visitWindow(2, new Date('2026-06-30T23:30:00Z'), now).from, '2026-07-29');
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
  assert.equal(slotProblem(slot({ start: new Date('2026-11-13T10:00:00Z') }), 2, { from: '2026-11-11', to: '2026-11-18' }, now), null);
  assert.equal(slotProblem(slot({ start: new Date('2026-11-18T22:30:00Z') }), 2, { from: '2026-11-11', to: '2026-11-18' }, now), null, 'the last day counts until midnight UK time');
  const late = slotProblem(slot({ start: new Date('2026-11-20T10:00:00Z') }), 2, { from: '2026-11-11', to: '2026-11-18' }, now)!;
  assert.equal(late, 'Your second visit needs to be 28 to 35 days after your first: between Wednesday 11 November 2026 and Wednesday 18 November 2026.');
  assert.match(slotProblem(slot({ start: new Date('2026-10-20T09:00:00Z') }), 1, { from: '2026-10-09', to: '2026-10-16' }, now)!, /first visit needs to be 28 to 35 days before your second/);
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

test('break-time messages: weekly check-ins and the end of the break, on their day at nine, skipped when stale or not needed', () => {
  assert.deepEqual(
    labJourneyMessages.map((m) => `${m.id}@${m.day}`),
    ['check-in-1@7', 'check-in-2@14', 'check-in-3@21', 'check-in-4@28', 'end-of-break@30'],
    'no nudge to book the second visit: both are booked together',
  );
  const visit1Start = new Date('2026-10-14T09:00:00Z');
  const checkIn1 = labJourneyMessages.find((m) => m.id === 'check-in-1')!;
  const due = atUkTime(addDays('2026-10-14', checkIn1.day), 9);
  assert.equal(due.toISOString(), '2026-10-21T08:00:00.000Z');
  const ctx = { visit1Start, visit2: null, lastCheckInAt: null };
  assert.equal(journeyAction(checkIn1, ctx, new Date(due.getTime() - 60_000)), 'wait');
  assert.equal(journeyAction(checkIn1, ctx, due), 'send');
  assert.equal(journeyAction(checkIn1, ctx, new Date(due.getTime() + 2 * D)), 'skip-stale');
  assert.equal(journeyAction(checkIn1, { ...ctx, lastCheckInAt: new Date(due.getTime() - D) }, due), 'skip-unless');
  assert.equal(journeyAction(checkIn1, { ...ctx, lastCheckInAt: new Date(due.getTime() - 4 * D) }, due), 'send');
  // A second visit 28 days on: the day-28 check-in and the day-30 message give way to the visit's own reminders.
  const end = labJourneyMessages.find((m) => m.id === 'end-of-break')!;
  const checkIn4 = labJourneyMessages.find((m) => m.id === 'check-in-4')!;
  const early2 = booking({ id: 'b2', visit: 2, start: new Date('2026-11-11T10:00:00Z'), end: new Date('2026-11-11T12:00:00Z') });
  assert.equal(journeyAction(checkIn4, { ...ctx, visit2: early2 }, atUkTime('2026-11-11', 9)), 'skip-visit-2');
  assert.equal(journeyAction(end, { ...ctx, visit2: early2 }, atUkTime('2026-11-13', 9)), 'skip-visit-2');
  // A second visit 35 days on: everything goes.
  const late2 = booking({ id: 'b2', visit: 2, start: new Date('2026-11-18T10:00:00Z'), end: new Date('2026-11-18T12:00:00Z') });
  assert.equal(journeyAction(end, { ...ctx, visit2: late2 }, atUkTime('2026-11-13', 9)), 'send');
  for (const m of labJourneyMessages) assert.ok(journeyMessage(m.id, 'MP2670FF90A5F2', late2), `${m.id} has wording`);
  for (const m of labJourneyMessages) assert.ok(journeyMessage(m.id, 'MP2670FF90A5F2', late2)!.sms.length <= 160, `${m.id} fits one text`);
  assert.match(journeyMessage('check-in-2', 'MP2670FF90A5F2', late2)!.text, /Your second lab visit is on Wednesday 18 November 2026, 10:00 to 12:00/);
  assert.match(journeyMessage('check-in-2', 'MP2670FF90A5F2', late2)!.text, /optional MyStory at the end/);
});

test('the confirmation email: both visits, what to bring, the links, copied to the team', () => {
  const contact = { email: 'jane@example.com', mobile: '+447700900123', smsReminders: true };
  const v1 = booking();
  const v2 = booking({ id: 'b2', visit: 2, slotId: 's2', start: new Date('2026-11-12T10:00:00Z'), end: new Date('2026-11-12T12:00:00Z') });
  assert.deepEqual(labBooking.copyTo, ['M.Faizah@leeds.ac.uk', 'brainpop@leeds.ac.uk']);
  const { subject, text } = visitsEmail('booked', [v2, v1], contact);
  assert.equal(subject, 'MyPhone/MyBrain: your lab visits are booked: Wed 14 Oct and Thu 12 Nov');
  assert.match(text, /Your two lab visits for the .+ are booked\./);
  assert.ok(text.indexOf('First lab visit') < text.indexOf('Second lab visit'), 'the first visit first');
  assert.match(text, /When: {2}Wednesday 14 October 2026, 10:00 to 12:00 \(UK time\)/);
  assert.match(text, /When: {2}Thursday 12 November 2026, 10:00 to 12:00 \(UK time\)/, 'GMT after the clocks go back');
  assert.match(text, /Participant ID: MP2670FF90A5F2/);
  assert.match(text, /Before each visit, please remember:\n- Your phone, charged\.\n- Clean, dry hair/);
  assert.match(text, /main entrance of the School of Psychology/);
  assert.match(text, /https:\/\/myphonemybrain\.com\/break\/book\/\?code=MP2670FF90A5F2/);
  assert.match(text, /text you the day before and on the day/);
  assert.match(text, /calendar files add the visits/);
  assert.doesNotMatch(text, /mystory/i, 'MyStory before the break is told at the first visit, not from the email');
  const moved = visitsEmail('moved', [v1, { ...v2, id: 'b3', start: new Date('2026-11-13T10:00:00Z'), end: new Date('2026-11-13T12:00:00Z') }], { ...contact, smsReminders: false }, { changed: ['b3'], byTeam: true });
  assert.equal(moved.subject, 'MyPhone/MyBrain: your lab visit times have changed');
  assert.match(moved.text, /the research team made the change/);
  assert.match(moved.text, /Second lab visit \(new time\)\nWhen: {2}Friday 13 November 2026/);
  assert.doesNotMatch(moved.text, /First lab visit \(new time\)/);
  assert.match(moved.text, /email you a reminder the day before each visit\./);
  const cancelled = visitsEmail('cancelled', [v1, v2], contact, { byTeam: true, reason: 'The lab is closed that week.' });
  assert.equal(cancelled.subject, 'MyPhone/MyBrain: your lab visits are cancelled');
  assert.match(cancelled.text, /have been cancelled by the research team\. The lab is closed that week\./);
  assert.match(cancelled.text, /To book again: https:\/\/myphonemybrain\.com\/break\/book\/\?code=MP2670FF90A5F2/);
  const one = visitsEmail('cancelled', [v2], contact);
  assert.equal(one.subject, 'MyPhone/MyBrain: your second lab visit on Thu 12 Nov, 10:00 is cancelled');
  const reminder = reminderEmail(v2);
  assert.equal(reminder.subject, 'MyPhone/MyBrain: your second lab visit is tomorrow at 10:00');
  assert.match(reminder.text, /Clean, dry hair/);
  assert.match(reminder.text, /\/break\/after\/\?code=MP2670FF90A5F2/, 'the second visit asks for the after-break screenshots');
  for (const t of [visitsText('booked', [v1, v2]), visitsText('moved', [v1, v2]), visitsText('booked', [v2]), visitsText('moved', [v1]), bookingText('day-before', v1), bookingText('same-day', v1)]) {
    assert.ok(t.length <= 160, `fits one text: ${t}`);
    assert.doesNotMatch(t, /[‘’“”]/, 'texts use plain characters');
  }
  assert.equal(visitsText('booked', [v2, v1]), 'MyPhone/MyBrain: your lab visits are booked for Wed 14 Oct, 10:00 and Thu 12 Nov, 10:00 at the School of Psychology. Details are in your email.');
  assert.match(bookingText('same-day', v1), /main entrance/);
});

test('booking requests: a time for each visit, an email, a UK mobile only when texts are wanted', () => {
  const ok = { participantCode: 'MP2670FF90A5F2', visits: [{ visit: 1, slotId: 'abc123' }, { visit: 2, slotId: 'def456' }], email: 'jane@example.com', mobile: '', smsReminders: false, client };
  assert.deepEqual(validateBookingPayload(ok), []);
  assert.deepEqual(validateBookingPayload({ ...ok, visits: [{ visit: 2, slotId: 'def456' }] }), [], 'one visit, to move it or book the one left');
  assert.deepEqual(validateBookingPayload({ ...ok, mobile: '07700 900123', smsReminders: true }), []);
  assert.match(validateBookingPayload({ ...ok, smsReminders: true }).join(' '), /mobile number for text reminders/);
  assert.match(validateBookingPayload({ ...ok, mobile: '0113 343 5000' }).join(' '), /UK mobile/);
  assert.match(validateBookingPayload({ ...ok, email: 'nope' }).join(' '), /email address/);
  assert.match(validateBookingPayload({ ...ok, visits: [{ visit: 3, slotId: 'abc123' }] }).join(' '), /Choose a time for each visit/);
  assert.match(validateBookingPayload({ ...ok, visits: [{ visit: 1, slotId: '../x' }] }).join(' '), /Choose a time/);
  assert.match(validateBookingPayload({ ...ok, visits: [{ visit: 1, slotId: 'a' }, { visit: 1, slotId: 'b' }] }).join(' '), /one time for each visit/);
  assert.match(validateBookingPayload({ ...ok, visits: [] }).join(' '), /Choose a time for each visit/);
  assert.match(validateBookingPayload({ ...ok, visits: [...ok.visits, { visit: 1, slotId: 'c' }] }).join(' '), /Choose a time for each visit/);
  assert.match(validateBookingPayload({ ...ok, slotId: 'abc123', visit: 1, visits: undefined }).join(' '), /Choose a time for each visit/, 'the old one-visit request is refused');
  // Changing visits on another device: the address on file is kept (email null), with nothing new for texts.
  assert.deepEqual(validateBookingPayload({ ...ok, email: null, mobile: null, smsReminders: false }), []);
  assert.deepEqual(validateBookingPayload({ ...ok, email: null, mobile: null, smsReminders: true }), [], 'the text setting on file is kept, whatever the page sends');
  assert.match(validateBookingPayload({ ...ok, email: null, mobile: '07700 900123', smsReminders: true }).join(' '), /mobile number needs the email address too/);
  assert.match(validateBookingPayload({ ...ok, email: undefined }).join(' '), /email address/, 'leaving the email out is not keeping it');
});

test('changing visits from another device: the address on file, masked; the old address told of a new one', () => {
  assert.equal(maskEmail('jane.smith@example.com'), 'j•••@example.com');
  assert.equal(maskEmail('x@leeds.ac.uk'), 'x•••@leeds.ac.uk');
  assert.equal(maskEmail('nonsense'), '•••');
  assert.deepEqual(maskedContact({ email: 'jane@example.com', mobile: '+447700900123', smsReminders: true }), { email: 'j•••@example.com', mobileEnding: '123', smsReminders: true });
  assert.deepEqual(maskedContact({ email: 'jane@example.com', mobile: null, smsReminders: true }), { email: 'j•••@example.com', mobileEnding: null, smsReminders: false }, 'no texts without a number');
  assert.equal(maskedContact({ email: null, mobile: null, smsReminders: false }), null, 'nothing on file before the first booking');
  const v1 = booking({ status: 'attended' });
  const v2 = booking({ id: 'b2', visit: 2, slotId: 's2', start: new Date('2026-11-12T10:00:00Z'), end: new Date('2026-11-12T12:00:00Z') });
  const gone = booking({ id: 'b0', visit: 2, status: 'cancelled' });
  const { subject, text } = addressChangedEmail([v2, gone, v1]);
  assert.equal(subject, 'MyPhone/MyBrain: your lab visit emails now go to a different address');
  assert.match(text, /went to a different email address from this one/);
  assert.match(text, /First lab visit: Wednesday 14 October 2026, 10:00 to 12:00 \(UK time\)\nSecond lab visit: Thursday 12 November 2026, 10:00 to 12:00/);
  assert.equal(text.match(/Second lab visit/g)?.length, 1, 'cancelled visits are left out');
  assert.match(text, /Participant ID: MP2670FF90A5F2/);
  assert.match(text, /If it was not, please reply to this email or contact .+ straight away\./);
  assert.doesNotMatch(text, /@example\.com/, 'the new address is not shown');
});

test('personal links: every page with the ID, MyStory by phase', () => {
  const links = participantLinks('MP2670FF90A5F2');
  assert.equal(links.takePart, 'https://myphonemybrain.com/break/take-part/?code=MP2670FF90A5F2');
  assert.equal(links.book, 'https://myphonemybrain.com/break/book/?code=MP2670FF90A5F2');
  assert.equal(links.checkIn, 'https://myphonemybrain.com/break/check-in/?code=MP2670FF90A5F2');
  assert.equal(links.after, 'https://myphonemybrain.com/break/after/?code=MP2670FF90A5F2');
  assert.equal(links.story.mid, 'https://myphonemybrain.com/break/mystory/?phase=mid&code=MP2670FF90A5F2');
  assert.equal(storyLink('post', 'MP2670FF90A5F2'), 'https://myphonemybrain.com/break/mystory/?phase=post&code=MP2670FF90A5F2');
  assert.equal(links.atLab.pre, 'https://myphonemybrain.com/break/mystory/?phase=pre&at=lab&code=MP2670FF90A5F2');
});
