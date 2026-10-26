import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactionsFor } from './schoolRedact.js';

const pupil = (first: string, last: string) => ({ row: 2, upn: 'A123456789012', firstName: first, lastName: last, dateOfBirth: '2012-03-04', gender: 'F', ethnicity: 'WBRI', yearGroup: '8', className: '8B', formTutor: 'Ms X', address: '1 Road', postcode: 'LS2 9JT', email: 'p@school.org', fsm: 'Y', sen: 'K' });
const optOut = { id: 'o1', data: { firstName: 'Zoë', lastName: "O'Brien", schoolId: 'GSAL', status: 'active', kind: 'workshop-and-data', receivedOn: '2026-10-20' } };

test('an opted-out pupil keeps only names, school, year, class and UPN, with the opt-out; the file read automatically goes', () => {
  const uploads = [{ id: 'u1', data: { schoolId: 'GSAL', path: 'schoolupns/gsal/u1/list.csv', pupils: [pupil('ZOE', 'OBRIEN'), pupil('Sam', 'Lee')] } }];
  const [r] = redactionsFor(uploads, [optOut], '2026-10-26T12:00:00Z');
  assert.equal(r.newly, 1);
  assert.equal(r.removeOriginal, 'schoolupns/gsal/u1/list.csv');
  const [z, s] = r.pupils;
  assert.deepEqual([z.upn, z.firstName, z.lastName, z.yearGroup, z.className, z.optedOut, z.optOutKind], ['A123456789012', 'ZOE', 'OBRIEN', '8', '8B', true, 'workshop-and-data']);
  for (const f of ['gender', 'ethnicity', 'formTutor', 'address', 'postcode', 'email', 'fsm', 'sen']) assert.equal(z[f], '', f);
  assert.equal(z.dateOfBirth, null);
  assert.equal(s.ethnicity, 'WBRI', 'other pupils unchanged');
  // Run again: nothing more to do.
  const again = [{ id: 'u1', data: { schoolId: 'GSAL', path: null, pupils: r.pupils } }];
  assert.deepEqual(redactionsFor(again, [optOut], '2026-10-26T13:00:00Z'), []);
});

test('a file read by hand is kept for the team; a cancelled opt-out redacts nothing', () => {
  const manual = [{ id: 'u2', data: { schoolId: 'GSAL', path: 'schoolupns/gsal/u2/scan.pdf', needsManualReading: true, pupils: [pupil('Zoe', 'OBrien')] } }];
  const [r] = redactionsFor(manual, [optOut], 'now');
  assert.equal(r.removeOriginal, null);
  assert.equal(r.byHand, true);
  assert.deepEqual(redactionsFor(manual, [{ id: 'o1', data: { ...optOut.data, status: 'cancelled' } }], 'now'), []);
});
