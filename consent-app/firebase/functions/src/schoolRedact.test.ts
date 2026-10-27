import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactionsFor } from './schoolRedact.js';

const pupil = (first: string, last: string) => ({ row: 2, upn: 'A123456789012', firstName: first, lastName: last, dateOfBirth: '2012-03-04', gender: 'F', ethnicity: 'WBRI', yearGroup: '8', className: '8B', formTutor: 'Ms X', address: '1 Road', postcode: 'LS2 9JT', email: 'p@school.org', fsm: 'Y', sen: 'K' });
const optOut = { id: 'o1', data: { firstName: 'Zoë', lastName: "O'Brien", schoolId: 'GSAL', status: 'active', kind: 'workshop-and-data', receivedOn: '2026-10-20' } };

test('an opted-out pupil keeps only names, school and UPN, with the opt-out; earlier fields go for everyone; the file read automatically goes', () => {
  const uploads = [{ id: 'u1', data: { schoolId: 'GSAL', path: 'schoolupns/gsal/u1/list.csv', pupils: [pupil('ZOE', 'OBRIEN'), pupil('Sam', 'Lee')] } }];
  const [r] = redactionsFor(uploads, [optOut], '2026-10-26T12:00:00Z');
  assert.equal(r.newly, 1);
  assert.equal(r.removeOriginal, 'schoolupns/gsal/u1/list.csv');
  const [z, s] = r.pupils;
  assert.deepEqual([z.upn, z.firstName, z.lastName, z.optedOut, z.optOutKind], ['A123456789012', 'ZOE', 'OBRIEN', true, 'workshop-and-data']);
  assert.equal(z.dateOfBirth, null);
  for (const f of ['gender', 'ethnicity', 'yearGroup', 'className', 'formTutor', 'address', 'postcode', 'email', 'fsm', 'sen']) {
    assert.ok(!(f in z), f);
    assert.ok(!(f in s), `${f} removed for every pupil (read before 27 October 2026)`);
  }
  assert.equal(s.dateOfBirth, '2012-03-04', 'other pupils keep their date of birth');
  // Run again: nothing more to do.
  const again = [{ id: 'u1', data: { schoolId: 'GSAL', path: null, pupils: r.pupils } }];
  assert.deepEqual(redactionsFor(again, [optOut], '2026-10-26T13:00:00Z'), []);
});

test('a file read by hand is kept for the team; a cancelled opt-out redacts nothing', () => {
  const manual = [{ id: 'u2', data: { schoolId: 'GSAL', path: 'schoolupns/gsal/u2/scan.pdf', needsManualReading: true, pupils: [pupil('Zoe', 'OBrien')] } }];
  const [r] = redactionsFor(manual, [optOut], 'now');
  assert.equal(r.removeOriginal, null);
  assert.equal(r.byHand, true);
  const cancelled = redactionsFor(manual, [{ id: 'o1', data: { ...optOut.data, status: 'cancelled' } }], 'now');
  assert.equal(cancelled.length, 1, 'only the earlier fields are removed');
  assert.equal(cancelled[0].newly, 0);
  assert.equal(cancelled[0].pupils[0].optedOut, undefined);
  const lean = [{ id: 'u3', data: { schoolId: 'GSAL', path: 'x', pupils: [{ row: 2, upn: 'A123456789012', firstName: 'Sam', lastName: 'Lee', dateOfBirth: '2012-01-01' }] } }];
  assert.deepEqual(redactionsFor(lean, [], 'now'), [], 'a list read since 27 October 2026 needs nothing');
});
