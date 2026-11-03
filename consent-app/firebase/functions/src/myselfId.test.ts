import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MYSELF_ID_PATTERN, myselfId, nameKey, otherForms, variantIds } from './myselfId.js';

// Produced by MySelf's own deriveParticipantId (packages/store/src/identity.ts).
const VECTORS: [string, string, string, string][] = [
  ['Amara', 'Ahmed', '2012-05-04', 'PNNTN6X2K00'],
  ['Zoë', "O'Neill-Bárta", '2010-01-31', 'P4NK3PPJCKA'],
  ['Zoe', 'ONeill Barta', '2010-01-31', 'P4NK3PPJCKA'],
  ['Ben', 'Brook', '2011-11-11', 'P8153060583'],
  ['Mohammed', 'Khan', '2013-02-28', 'PJ8DHY9XY6R'],
  ['Anne-Marie', 'Smith-Jones', '2012-12-01', 'P703PDK6C3Y'],
];

test('gives the same IDs as MySelf', () => {
  for (const [f, l, d, id] of VECTORS) {
    assert.equal(myselfId(f, l, d), id, `${f} ${l} ${d}`);
    assert.match(id, MYSELF_ID_PATTERN);
  }
  assert.equal(myselfId('  AMARA ', 'ahmed', ' 2012-05-04 '), 'PNNTN6X2K00');
});

test('gives no ID without both names and a real date', () => {
  assert.equal(myselfId('', 'Ahmed', '2012-05-04'), null);
  assert.equal(myselfId('Amara', "'-", '2012-05-04'), null);
  assert.equal(myselfId('Amara', 'Ahmed', '04/05/2012'), null);
  assert.equal(myselfId('Amara', 'Ahmed', '2012-13-04'), null);
  assert.equal(myselfId(undefined, 'Ahmed', '2012-05-04'), null);
});

test('reads names as MySelf does', () => {
  assert.equal(nameKey("O'Neill-Bárta"), 'oneillbarta');
  assert.ok(otherForms('Tom').includes('thomas'));
  assert.ok(otherForms('Muhammad').includes('mohammed'));
  assert.ok(!otherForms('Thomas').includes('thomas'));
  assert.deepEqual(otherForms('Xyzzy'), []);
});

test('suggests the IDs common slips would give, never the exact one', () => {
  const v = variantIds({ firstName: 'Thomas', lastName: 'Smith-Jones', dob: '2012-05-04', schoolFirstName: 'Tomasz', schoolLastName: 'Smith-Jones' });
  const kinds = new Set(v.map((x) => x.kind));
  for (const k of ['nickname', 'dob-day-month-swapped', 'names-swapped', 'surname-part', 'class-list-name']) assert.ok(kinds.has(k as never), k);
  assert.ok(!v.some((x) => x.id === myselfId('Thomas', 'Smith-Jones', '2012-05-04')));
  assert.ok(v.some((x) => x.id === myselfId('Tom', 'Smith-Jones', '2012-05-04')));
  assert.ok(v.some((x) => x.id === myselfId('Thomas', 'Smith-Jones', '2012-04-05')));
  assert.ok(v.some((x) => x.id === myselfId('Thomas', 'Jones', '2012-05-04')));
  assert.equal(new Set(v.map((x) => x.id)).size, v.length);
  // No swap when the day cannot be a month, or day equals month.
  assert.ok(!variantIds({ firstName: 'Ben', lastName: 'Brook', dob: '2011-11-11' }).some((x) => x.kind === 'dob-day-month-swapped'));
  assert.ok(!variantIds({ firstName: 'Ben', lastName: 'Brook', dob: '2011-05-20' }).some((x) => x.kind === 'dob-day-month-swapped'));
  const fp = variantIds({ firstName: 'Anne-Marie', lastName: 'Smith', dob: '2012-12-01' });
  assert.ok(fp.some((x) => x.kind === 'first-name-part' && x.firstName === 'Anne'));
  assert.deepEqual(variantIds({ firstName: '', lastName: 'Smith', dob: '2012-12-01' }).filter((x) => x.kind !== 'names-swapped' && x.kind !== 'surname-part'), []);
});
