import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  changeMessage,
  confirmationMessage,
  coverageFor,
  copiesToDelete,
  countsFor,
  covers,
  DEFAULT_SETTINGS,
  docState,
  eligibilityFor,
  expiryWarnings,
  includedDays,
  latestDocs,
  mayDo,
  normaliseVisit,
  offerMessage,
  removalMessage,
  requirementsFor,
  scheduleChanged,
  settingsOf,
  validateAvailability,
  validateVisit,
  whenShort,
  type PortalDoc,
} from './portalCore.js';
import { icsForMany } from './ics.js';
import { ukDateTime } from './portal.js';

const S = DEFAULT_SETTINGS;
const doc = (over: Partial<PortalDoc>): PortalDoc => ({ id: 'd', uid: 'ra1', typeId: 'dbs', schoolId: null, status: 'verified', uploadedAt: '2026-10-01T10:00:00Z', details: {}, ...over });

test('roles: the project manager does everything, the team nearly everything, research assistants only their own; pending accounts only ask', () => {
  for (const a of ['approve', 'verify-document', 'save-settings', 'audit', 'archive']) {
    assert.equal(mayDo(a, 'pm', 'active'), true, a);
    assert.equal(mayDo(a, 'researcher', 'active'), false, a);
    assert.equal(mayDo(a, 'ra', 'active'), false, a);
  }
  assert.equal(mayDo('remove-confirmed', 'pm', 'active'), true);
  assert.equal(mayDo('remove-confirmed', 'researcher', 'active'), false);
  assert.equal(mayDo('visits-ics', 'ra', 'active'), false);
  for (const a of ['people', 'visit', 'offer', 'save-session', 'save-visit', 'visit-ics', 'visits-ics', 'withdraw-offer']) {
    assert.equal(mayDo(a, 'researcher', 'active'), true, a);
    assert.equal(mayDo(a, 'ra', 'active'), false, a);
  }
  for (const a of ['my-summary', 'register-document', 'set-availability', 'respond-offer']) assert.equal(mayDo(a, 'ra', 'active'), true, a);
  assert.equal(mayDo('my-summary', 'ra', 'pending'), false);
  assert.equal(mayDo('my-summary', 'pm', 'archived'), false);
  assert.equal(mayDo('request-access', null, null), true);
  assert.equal(mayDo('me', null, 'pending'), true);
  assert.equal(mayDo('nonsense', 'pm', 'active'), false);
});

test('settings: stored values within range, defaults for the rest', () => {
  const s = settingsOf({ minTraining: 3, minPilots: -1, retentionDays: 'x', docTypes: [{ id: 'dbs', label: 'DBS', dbs: true }, { id: 'Bad Id', label: 'x' }, { id: 'dbs', label: 'again' }] });
  assert.equal(s.minTraining, 3);
  assert.equal(s.minPilots, 1);
  assert.equal(s.retentionDays, 183);
  assert.deepEqual(s.docTypes.map((t) => t.id), ['dbs']);
  assert.deepEqual(settingsOf(undefined).docTypes.map((t) => t.id), ['dbs', 'health', 'safeguarding']);
});

test('documents: missing, waiting, rejected, verified, expiring soon and expired; a DBS lasts three years unless on the Update Service', () => {
  const dbs = S.docTypes[0];
  assert.equal(docState(undefined, dbs, S, '2026-11-01'), 'missing');
  assert.equal(docState(doc({ status: 'uploaded' }), dbs, S, '2026-11-01'), 'uploaded');
  assert.equal(docState(doc({ status: 'rejected' }), dbs, S, '2026-11-01'), 'rejected');
  assert.equal(docState(doc({ details: { issueDate: '2025-01-10' } }), dbs, S, '2026-11-01'), 'verified');
  assert.equal(docState(doc({ details: { issueDate: '2023-11-20' } }), dbs, S, '2026-11-01'), 'expiring-soon');
  assert.equal(docState(doc({ details: { issueDate: '2023-01-10' } }), dbs, S, '2026-11-01'), 'expired');
  assert.equal(docState(doc({ details: { issueDate: '2020-01-10', updateService: true } }), dbs, S, '2026-11-01'), 'verified');
  assert.equal(docState(doc({ details: { issueDate: '2025-01-10', expiresOn: '2026-10-31' } }), dbs, S, '2026-11-01'), 'expired', 'a recheck date wins');
  // The latest upload counts.
  const latest = latestDocs([doc({ id: 'old', status: 'verified', uploadedAt: '2026-01-01T00:00:00Z' }), doc({ id: 'new', status: 'uploaded', uploadedAt: '2026-10-30T00:00:00Z' })]);
  assert.equal(latest.get('ra1|dbs|')?.id, 'new');
});

test('eligibility: DBS in date on the visit day, every form (the school’s too), enough training and pilots; reasons for anyone not', () => {
  const school = { id: 'GSAL', requiredDocs: [{ id: 'gsal-volunteer', label: 'GSAL volunteer form', hint: '' }] };
  const req = requirementsFor(S, school);
  const ok = latestDocs([
    doc({ typeId: 'dbs', details: { issueDate: '2025-06-01' } }),
    doc({ typeId: 'health' }),
    doc({ typeId: 'safeguarding', details: { expiresOn: '2027-06-01' } }),
    doc({ typeId: 'gsal-volunteer', schoolId: 'GSAL' }),
  ]);
  assert.deepEqual(eligibilityFor('ra1', ok, req, { training: 2, pilots: 1 }, S, '2026-11-20'), { eligible: true, reasons: [] });
  const r = eligibilityFor('ra1', ok, req, { training: 1, pilots: 0 }, S, '2028-07-01');
  assert.equal(r.eligible, false);
  assert.deepEqual(r.reasons, ['Enhanced DBS certificate: out of date by the visit', 'Safeguarding training certificate: out of date by the visit', 'Training: 1 of 2', 'Pilots: 0 of 1']);
  const none = eligibilityFor('ra2', ok, req, { training: 5, pilots: 5 }, S, '2026-11-20');
  assert.equal(none.reasons.length, 4);
  assert.match(none.reasons[3], /GSAL volunteer form: not uploaded/);
  // Expiring soon still counts: only expired does not.
  const soon = latestDocs([doc({ typeId: 'dbs', details: { issueDate: '2023-11-25' } }), doc({ typeId: 'health' }), doc({ typeId: 'safeguarding' })]);
  assert.equal(eligibilityFor('ra1', soon, requirementsFor(S, null), { training: 2, pilots: 1 }, S, '2026-11-20').eligible, true);
});

test('counts and availability: sessions attended; whether a day covers a visit; saving days', () => {
  assert.deepEqual(countsFor('a', [{ kind: 'training', attendees: ['a', 'b'] }, { kind: 'pilot', attendees: ['a'] }, { kind: 'training', attendees: ['b'] }]), { training: 1, pilots: 1, byRole: { eeg: 0, copro: 0 } });
  assert.equal(covers('all', '08:30', '15:00'), 'yes');
  assert.equal(covers('am', '08:30', '12:00'), 'yes');
  assert.equal(covers('am', '08:30', '15:00'), 'no');
  assert.equal(covers('pm', '13:00', '15:00'), 'yes');
  assert.equal(covers(undefined, '13:00', '15:00'), 'unknown');
  const v = validateAvailability([{ date: '2026-11-03', value: 'am', note: 'lecture at 2' }, { date: '2026-10-01', value: 'all' }, { date: '2026-11-04', value: 'often' }, { date: '2026-11-05', value: null }], '2026-11-01');
  assert.deepEqual(v.days, [{ date: '2026-11-03', value: 'am', note: 'lecture at 2' }, { date: '2026-11-05', value: null, note: '' }]);
  assert.equal(v.problems.length, 2);
});

test('visits: school, period, days, times, place and places checked', () => {
  // Friday 20 to Tuesday 24 November 2026: the weekend off by default, Monday switched off, Tuesday with its own times.
  const ok = validateVisit({ schoolId: 'GSAL', startDate: '2026-11-20', endDate: '2026-11-24', start: '08:30', end: '15:00', needed: 4, location: ' Main reception ', days: [{ date: '2026-11-23', on: false }, { date: '2026-11-24', start: '09:00', end: '12:00' }] }, ['GSAL'], '2026-11-01');
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.visit?.location, 'Main reception');
  assert.deepEqual(ok.visit?.days.map((d) => `${d.date} ${d.on ? `${d.start}-${d.end}` : 'off'}`), ['2026-11-20 08:30-15:00', '2026-11-21 off', '2026-11-22 off', '2026-11-23 off', '2026-11-24 09:00-12:00']);
  assert.deepEqual(includedDays(ok.visit!.days).map((d) => d.date), ['2026-11-20', '2026-11-24']);
  // A one-day visit is a period with the same first and last day; the old shape (date, meetingPoint) still reads.
  const one = validateVisit({ schoolId: 'GSAL', date: '2026-11-20', start: '08:30', end: '15:00', needed: 1, meetingPoint: 'Reception' }, ['GSAL'], '2026-11-01');
  assert.deepEqual(one.visit?.days, [{ date: '2026-11-20', on: true, start: '08:30', end: '15:00' }]);
  assert.equal(one.visit?.location, 'Reception');
  const bad = validateVisit({ schoolId: 'X', startDate: '2026-10-20', start: '9', end: '08:00', needed: 0 }, ['GSAL'], '2026-11-01');
  assert.equal(bad.visit, null);
  assert.deepEqual(bad.problems, ['Choose the school.', 'The dates are in the past.', 'Give the usual start time (for example 08:30).', 'Say where: an address, a room or a meeting point.', 'Say how many people are needed for EEG and for co-production (0 to 30 each, at least one in all).']);
  assert.match(validateVisit({ schoolId: 'GSAL', startDate: '2026-11-21', endDate: '2026-11-22', start: '08:30', end: '15:00', needed: 1, location: 'Hall' }, ['GSAL'], '2026-11-01').problems.join(' '), /at least one day/);
  assert.match(validateVisit({ schoolId: 'GSAL', startDate: '2026-11-24', endDate: '2026-11-20', start: '08:30', end: '15:00', needed: 1, location: 'Hall' }, ['GSAL'], '2026-11-01').problems.join(' '), /last date is before/);
  assert.match(validateVisit({ schoolId: 'GSAL', startDate: '2026-11-20', endDate: '2026-11-20', start: '08:30', end: '15:00', needed: 1, location: 'Hall', days: [{ date: '2026-11-20', start: '14:00', end: '13:00' }] }, ['GSAL'], '2026-11-01').problems.join(' '), /2026-11-20: the end time/);
});

test('stored visits: an old single-date visit reads as one day; a change of days, times or place is noticed', () => {
  const old = normaliseVisit({ date: '2026-11-20', start: '08:30', end: '15:00', meetingPoint: 'Reception' });
  assert.deepEqual(old, { startDate: '2026-11-20', endDate: '2026-11-20', start: '08:30', end: '15:00', days: [{ date: '2026-11-20', on: true, start: '08:30', end: '15:00' }], location: 'Reception', roleNeeds: { eeg: 6, copro: 2 }, travel: { arrival: '', taxiFrom: 'School of Psychology, University of Leeds', taxiTime: '', direct: '' } });
  const moved = { ...old, days: [{ date: '2026-11-20', on: true, start: '09:00', end: '15:00' }] };
  assert.deepEqual(scheduleChanged(old, moved), { changed: true, removedDays: [] });
  assert.deepEqual(scheduleChanged(old, { ...old, location: 'Hall' }).changed, true);
  assert.deepEqual(scheduleChanged(old, { ...old }).changed, false);
  const two = { ...old, days: [old.days[0], { date: '2026-11-23', on: true, start: '08:30', end: '15:00' }] };
  assert.deepEqual(scheduleChanged(two, { ...two, days: [two.days[0], { ...two.days[1], on: false }] }).removedDays.map((d) => d.date), ['2026-11-23']);
});

test('availability across a visit’s days: all, some or none, day by day', () => {
  const days = [
    { date: '2026-11-20', on: true, start: '08:30', end: '15:00' },
    { date: '2026-11-21', on: false, start: '08:30', end: '15:00' },
    { date: '2026-11-24', on: true, start: '09:00', end: '12:00' },
  ];
  assert.equal(coverageFor(days, new Map([['2026-11-20', 'all'], ['2026-11-24', 'am']])).coverage, 'all');
  const some = coverageFor(days, new Map([['2026-11-20', 'no'], ['2026-11-24', 'am']]));
  assert.equal(some.coverage, 'some');
  assert.deepEqual(some.availableDates, ['2026-11-24']);
  assert.deepEqual(some.perDay.map((d) => d.covers), ['no', 'yes'], 'the day switched off is left out');
  assert.equal(coverageFor(days, new Map([['2026-11-20', 'no']])).coverage, 'none');
  assert.equal(coverageFor(days, new Map()).coverage, 'unknown');
});

test('retention: copies go once someone has been archived longer than the period; nothing for active people or copies already gone', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const people = [
    { uid: 'old', status: 'archived' as const, archivedAt: '2026-04-01T00:00:00Z' },
    { uid: 'recent', status: 'archived' as const, archivedAt: '2026-10-01T00:00:00Z' },
    { uid: 'active', status: 'active' as const, archivedAt: null },
  ];
  const docs = [
    { id: '1', uid: 'old', path: 'portal/docs/old/x' },
    { id: '2', uid: 'old', path: null, deletedAt: '2026-05-01' },
    { id: '3', uid: 'recent', path: 'portal/docs/recent/x' },
    { id: '4', uid: 'active', path: 'portal/docs/active/x' },
  ];
  assert.deepEqual(copiesToDelete(people, docs, S, now), ['1']);
  assert.deepEqual(copiesToDelete(people, docs, { ...S, retentionDays: 10 }, now), ['1', '3']);
});

test('expiry warnings: once per document and date, only within the window', () => {
  const types = new Map(S.docTypes.map((t) => [t.id, t]));
  const docs = [doc({ id: 'x', typeId: 'safeguarding', details: { expiresOn: '2026-11-20' } }), doc({ id: 'y', typeId: 'health' }), doc({ id: 'z', uid: 'ra2', typeId: 'safeguarding', details: { expiresOn: '2027-06-01' } })];
  assert.deepEqual(expiryWarnings(docs, types, S, '2026-11-01', new Set()).map((w) => [w.doc.id, w.until]), [['x', '2026-11-20']]);
  assert.deepEqual(expiryWarnings(docs, types, S, '2026-11-01', new Set(['x|2026-11-20'])), []);
});

test('messages: the offer, the confirmation, a change and a removal say where, when and what to do', () => {
  const one = { schoolName: 'The Grammar School at Leeds', days: [{ date: '2026-11-20', on: true, start: '08:30', end: '15:00' }], location: 'Main reception' };
  const o = offerMessage('Sam', one, 'https://myphonemybrain.com/portal/#offers', 'copro');
  assert.match(o.email, /Your role: Co-production/);
  assert.match(o.subject, /selected for The Grammar School at Leeds on Friday, 20 November 2026 \(Co-production\)/);
  assert.match(o.email, /Hello Sam,[\s\S]*Where: Main reception[\s\S]*08:30 to 15:00[\s\S]*#offers/);
  const c = confirmationMessage('Sam', one, 'https://myphonemybrain.com/portal/#my-visits', { name: 'Dr Sarmad Ali', email: 'S.A.Ali1@leeds.ac.uk' });
  assert.match(c.email, /confirmed[\s\S]*calendar invitation is attached[\s\S]*email Dr Sarmad Ali at S\.A\.Ali1@leeds\.ac\.uk/);
  const two = { ...one, days: [...one.days, { date: '2026-11-23', on: false, start: '08:30', end: '15:00' }, { date: '2026-11-24', on: true, start: '09:00', end: '12:00' }] };
  assert.equal(whenShort(two.days), 'from Friday, 20 November 2026 to Tuesday, 24 November 2026 (2 days)');
  assert.match(offerMessage('Sam', two, 'x').email, /On these days:\nFriday, 20 November 2026, 08:30 to 15:00\nTuesday, 24 November 2026, 09:00 to 12:00/);
  assert.match(changeMessage('Sam', one, [two.days[2]], 'x').email, /have changed[\s\S]*No longer needed: Tuesday, 24 November 2026/);
  assert.match(removalMessage('Sam', one, 'Emailed to withdraw', 'x').email, /taken you off[\s\S]*Reason: Emailed to withdraw/);
});

test('settings: the withdrawal contact defaults to Dr Sarmad Ali and can be changed', () => {
  assert.deepEqual(settingsOf({}).withdrawalContact, { name: 'Dr Sarmad Ali', email: 'S.A.Ali1@leeds.ac.uk' });
  assert.deepEqual(settingsOf({ withdrawalContact: { name: 'Faisal Mushtaq', email: 'f.mushtaq@leeds.ac.uk' } }).withdrawalContact, { name: 'Faisal Mushtaq', email: 'f.mushtaq@leeds.ac.uk' });
  assert.deepEqual(settingsOf({ withdrawalContact: { name: 'X', email: 'not-an-email' } }).withdrawalContact.name, 'Dr Sarmad Ali');
});

test('calendar: one event per day the visit runs, in UK time, all in one file', () => {
  const ics = icsForMany(
    [
      { uid: 'a', start: ukDateTime('2026-11-20', '08:30'), end: ukDateTime('2026-11-20', '15:00'), summary: 'Visit', location: 'GSAL, Main reception', description: 'x' },
      { uid: 'b', start: ukDateTime('2026-11-24', '09:00'), end: ukDateTime('2026-11-24', '12:00'), summary: 'Visit', location: 'GSAL, Main reception', description: 'x' },
    ],
    new Date('2026-11-01T00:00:00Z'),
  );
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 2);
  assert.match(ics, /DTSTART:20261120T083000Z[\s\S]*DTSTART:20261124T090000Z/);
  assert.match(ics, /LOCATION:GSAL\\, Main reception/);
  assert.match(icsForMany([{ uid: 'a', start: new Date(0), end: new Date(1), summary: 's', location: '', description: '', status: 'cancelled' }]), /METHOD:CANCEL/);
});

test('UK times: a visit’s start in winter and in summer', () => {
  assert.equal(ukDateTime('2026-11-20', '08:30').toISOString(), '2026-11-20T08:30:00.000Z');
  assert.equal(ukDateTime('2027-06-10', '08:30').toISOString(), '2027-06-10T07:30:00.000Z');
});
