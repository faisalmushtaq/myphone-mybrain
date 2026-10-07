import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateOptOut } from './staff.js';

test('an opt-out email as logged on the staff page: names and school needed, dates checked, the rest optional', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  const ok = validateOptOut({ firstName: ' Kai ', lastName: 'Patel', schoolId: 'DUA', receivedOn: '2026-10-08', afterWorkshop: true, notes: 'Replied to confirm.' }, now);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.optOut, { firstName: 'Kai', lastName: 'Patel', dateOfBirth: null, schoolId: 'DUA', yearGroup: '', className: '', parentName: '', receivedOn: '2026-10-08', afterWorkshop: true, notes: 'Replied to confirm.' });
  assert.equal(validateOptOut({ firstName: 'Kai', lastName: 'Patel', schoolId: 'DUA' }, now).optOut?.receivedOn, '2026-10-08', 'today when not given');
  assert.match(validateOptOut({ firstName: 'Kai', schoolId: 'DUA' }, now).problems.join(' '), /first and last name/);
  assert.match(validateOptOut({ firstName: 'Kai', lastName: 'Patel', schoolId: 'NOWHERE' }, now).problems.join(' '), /Choose the school/);
  assert.match(validateOptOut({ firstName: 'Kai', lastName: 'Patel', schoolId: 'DUA', receivedOn: '2026-10-09' }, now).problems.join(' '), /in the past/);
  assert.match(validateOptOut({ firstName: 'Kai', lastName: 'Patel', schoolId: 'DUA', dateOfBirth: '14/03/2013' }, now).problems.join(' '), /date of birth/);
  assert.equal(validateOptOut('nope', now).optOut, null);
});
