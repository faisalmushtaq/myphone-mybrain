import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBackup, isBackupId, matchStreets, splitQuery, type BackupFiles, type BackupPostcode, type BackupStreet } from './addressBackup.js';

const LS6: Record<string, BackupPostcode> = {
  'LS6 1DE': {
    lat: 53.816, lon: -1.573, d: 'Leeds', w: 'Headingley & Hyde Park',
    a: [['1 Manor Drive', '', 'Headingley', 'Leeds'], ['12 Manor Drive', '', 'Headingley', 'Leeds'], ['2 Manor Drive', '', 'Headingley', 'Leeds']],
  },
  'LS6 3EL': { lat: 53.82, lon: -1.58, d: 'Leeds', w: 'Headingley & Hyde Park', a: [['Flat 3, 24 Headingley Mount', '', '', 'Leeds']] },
  'LS6 9ZZ': { lat: 53.82, lon: -1.58, d: 'Leeds', w: 'Headingley & Hyde Park', a: [] },
};
const BD16: Record<string, BackupPostcode> = {
  'BD16 1PL': { lat: 53.83, lon: -1.82, d: 'Bradford', w: 'Bingley', a: [['12 Manor Drive', '', '', 'Bingley']] },
};
const M: BackupStreet[] = [
  ['Manor Drive', '', 'Leeds', 'LS6', '1DE', 1, 'Headingley Hyde Park'],
  ['Manor Drive', 'Bingley', 'Bradford', 'BD16', '1PL', 1, ''],
  ['Manor Road', 'Keighley', 'Bradford', 'BD20', '6AA', 0, ''],
];
const H: BackupStreet[] = [['Headingley Mount', '', 'Leeds', 'LS6', '3EL', 1, 'Headingley Hyde Park']];

let reads = 0;
const files: BackupFiles = {
  async outcode(o) { reads++; return ({ LS6, BD16 } as Record<string, Record<string, BackupPostcode>>)[o] ?? null; },
  async streets(l) { return ({ m: M, h: H } as Record<string, BackupStreet[]>)[l] ?? null; },
};
const backup = createBackup(files);

test('splits the house part from the street', () => {
  assert.deepEqual(splitQuery('12 Manor Dr'), { house: ['12'], rest: ['manor', 'dr'] });
  assert.deepEqual(splitQuery('Flat 3, 24 Headingley Mount'), { house: ['flat', '3', '24'], rest: ['headingley', 'mount'] });
  assert.deepEqual(splitQuery("St Mary's Rd"), { house: [], rest: ['st', 'marys', 'rd'] });
});

test('matches streets by name, abbreviation, part words and area', () => {
  assert.equal(matchStreets(M, ['manor', 'dr']).length, 2);
  assert.equal(matchStreets(M, ['manor', 'drive', 'headingley'])[0]!.oc, 'LS6', 'a ward or locality word narrows it');
  assert.equal(matchStreets(M, ['manor', 'drive', 'bingley'])[0]!.oc, 'BD16');
  assert.equal(matchStreets(M, ['headingley']).length, 0, 'an area alone does not match a street');
});

test('addresses at a postcode, in house-number order, with no UPRN', async () => {
  const found = await backup.postcode('LS61DE');
  assert.equal(found.status, 'found');
  if (found.status !== 'found') return;
  assert.equal(found.postcode, 'LS6 1DE');
  assert.deepEqual(found.addresses.map((a) => a.label), ['1 Manor Drive, Headingley', '2 Manor Drive, Headingley', '12 Manor Drive, Headingley']);
  assert.equal(found.addresses[0]!.address, '1 Manor Drive, Headingley, Leeds');
  assert.equal(found.addresses[0]!.uprn, null);
  assert.deepEqual(await backup.postcode('LS69ZZ'), { status: 'not-found' }, 'a real postcode with nothing listed');
  assert.deepEqual(await backup.postcode('ZZ99ZZ'), { status: 'not-found' });
});

test('suggestions as the parent types, then the full address when picked', async () => {
  const s = await backup.suggest('12 manor drive headingley');
  assert.equal(s.status, 'suggestions');
  assert.deepEqual(s.suggestions.map((x) => x.label), ['12 Manor Drive, Headingley, Leeds, LS6 1DE']);
  const id = s.suggestions[0]!.id;
  assert.ok(isBackupId(id));
  assert.deepEqual(await backup.pick(id), { status: 'picked', postcode: 'LS6 1DE', address: '12 Manor Drive, Headingley, Leeds', uprn: null });

  const both = await backup.suggest('12 manor dr');
  assert.deepEqual(both.suggestions.map((x) => x.label).sort(), ['12 Manor Drive, Bingley, BD16 1PL', '12 Manor Drive, Headingley, Leeds, LS6 1DE']);

  const flat = await backup.suggest('flat 3 24 headingley mount');
  assert.deepEqual(flat.suggestions.map((x) => x.label), ['Flat 3, 24 Headingley Mount, Leeds, LS6 3EL']);

  assert.deepEqual((await backup.suggest('zzzz road')).suggestions, []);
  assert.deepEqual(await backup.pick('wy:LS61DE:99'), { status: 'not-found' });
  assert.deepEqual(await backup.pick('paf_123'), { status: 'not-found' });
  assert.ok(!isBackupId('paf_123'));
});

test('a missing bucket or file is "nothing found", not an error', async () => {
  const empty = createBackup({ outcode: async () => null, streets: async () => null });
  assert.deepEqual(await empty.postcode('LS61DE'), { status: 'not-found' });
  assert.deepEqual(await empty.suggest('12 manor drive'), { status: 'suggestions', suggestions: [] });
  assert.ok(reads > 0);
});
