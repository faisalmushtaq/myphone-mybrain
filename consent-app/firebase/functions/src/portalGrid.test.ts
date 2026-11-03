import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availabilityGrid, mayDo, weekDates, weekStartOf, type GridPerson, type GridVisit } from './portalCore.js';

const MON = '2026-11-23';

const person = (uid: string, over: Partial<GridPerson> = {}): GridPerson => ({ uid, name: uid.toUpperCase(), role: 'ra', level: 2, capabilities: ['eeg'], tagIds: [], ...over });

const visit = (over: Partial<GridVisit> = {}): GridVisit => ({
  visitId: 'v1',
  schoolId: 'GSAL',
  schoolShort: 'GSAL',
  schoolName: 'The Grammar School at Leeds',
  status: 'staffing',
  days: [
    { date: MON, start: '08:30', end: '15:00', on: true },
    { date: '2026-11-24', start: '08:30', end: '15:00', on: false },
    { date: '2026-11-25', start: '09:00', end: '12:00', on: true, eeg: 1, copro: 0 },
  ],
  roleNeeds: { eeg: 2, copro: 1 },
  assignments: [],
  ...over,
});

test('weeks start on Monday', () => {
  assert.equal(weekStartOf('2026-11-26'), MON);
  assert.equal(weekStartOf(MON), MON);
  assert.equal(weekStartOf('2026-11-29'), MON);
  assert.deepEqual(weekDates(MON).slice(0, 2), [MON, '2026-11-24']);
  assert.equal(weekDates(MON).length, 7);
});

test('each cell shows the answer, places held and why someone could not be booked', () => {
  const grid = availabilityGrid({
    weekStart: MON,
    people: [person('a'), person('b', { capabilities: ['copro'] }), person('t', { role: 'researcher' })],
    availability: [
      { uid: 'a', date: MON, value: 'all' },
      { uid: 'b', date: MON, value: 'am', note: 'until 1' },
      { uid: 'a', date: '2026-11-25', value: 'maybe' },
      { uid: 't', date: MON, value: 'all' },
    ],
    visits: [
      visit({
        assignments: [
          { uid: 'a', status: 'confirmed', role: 'eeg', dates: [MON, '2026-11-25'], timeNotes: { [MON]: 'until 1:00 pm' } },
          { uid: 'b', status: 'offered', role: 'copro', dates: [MON] },
          { uid: 'b', status: 'declined', role: 'eeg', dates: ['2026-11-25'] },
        ],
      }),
    ],
    notReady: (uid, date) => (uid === 'b' && date >= '2026-11-25' ? ['Enhanced DBS certificate: out of date by the visit'] : []),
  });
  const a = grid.rows.find((r) => r.person.uid === 'a')!;
  const b = grid.rows.find((r) => r.person.uid === 'b')!;
  const t = grid.rows.find((r) => r.person.uid === 't')!;
  assert.equal(a.cells[0].value, 'all');
  assert.deepEqual(a.cells[0].places, [{ visitId: 'v1', school: 'GSAL', role: 'eeg', status: 'confirmed', timeNote: 'until 1:00 pm' }]);
  assert.equal(a.cells[2].value, 'maybe');
  assert.equal(a.cells[2].places[0].timeNote, null);
  assert.equal(a.availableDays, 1);
  assert.equal(b.cells[0].note, 'until 1');
  assert.equal(b.cells[0].places[0].status, 'offered');
  // A declined offer is not a place.
  assert.equal(b.cells[2].places.length, 0);
  assert.deepEqual(b.cells[2].notReady, ['Enhanced DBS certificate: out of date by the visit']);
  assert.deepEqual(b.cells[0].notReady, []);
  // The team's own row: no readiness check, and not counted in the day's totals.
  assert.deepEqual(t.cells[0].notReady, []);
  assert.equal(grid.days[0].available, 2);
  assert.equal(grid.days[0].availableEeg, 1);
  assert.equal(grid.days[0].availableCopro, 1);
  assert.equal(grid.days[2].maybe, 1);
  assert.equal(grid.days[1].noAnswer, 2);
});

test('day headers show each visit running, its needs against confirmed, and when it is short', () => {
  const grid = availabilityGrid({
    weekStart: MON,
    people: [person('a')],
    availability: [],
    visits: [
      visit({ assignments: [{ uid: 'a', status: 'confirmed', role: 'eeg', dates: ['2026-11-25'] }, { uid: 'x', status: 'offered', role: 'eeg', dates: [MON] }] }),
      visit({ visitId: 'v2', status: 'provisional', days: [{ date: MON, start: '08:30', end: '15:00', on: true }] }),
      visit({ visitId: 'v3', status: 'cancelled', days: [{ date: MON, start: '08:30', end: '15:00', on: true }] }),
    ],
    notReady: () => [],
  });
  const mon = grid.days[0];
  assert.deepEqual(mon.visits.map((v) => v.visitId), ['v1', 'v2']);
  assert.deepEqual(mon.visits[0].need, { eeg: 2, copro: 1 });
  assert.deepEqual(mon.visits[0].confirmed, { eeg: 0, copro: 0 });
  assert.deepEqual(mon.visits[0].offered, { eeg: 1, copro: 0 });
  assert.equal(mon.visits[0].short, true);
  // A provisional visit is not being staffed yet, so it is never short.
  assert.equal(mon.visits[1].short, false);
  assert.equal(mon.short, true);
  // A day switched off has no visit; a day's own numbers win.
  assert.equal(grid.days[1].visits.length, 0);
  assert.deepEqual(grid.days[2].visits[0].need, { eeg: 1, copro: 0 });
  assert.equal(grid.days[2].visits[0].short, false);
  assert.equal(grid.days[2].short, false);
});

test('only the team may load the grid', () => {
  assert.equal(mayDo('availability-grid', 'pm', 'active'), true);
  assert.equal(mayDo('availability-grid', 'researcher', 'active'), true);
  assert.equal(mayDo('availability-grid', 'ra', 'active'), false);
  assert.equal(mayDo('availability-grid', 'researcher', 'pending'), false);
});
