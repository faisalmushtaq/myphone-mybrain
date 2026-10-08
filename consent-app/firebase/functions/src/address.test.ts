import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addressesFrom, biasFor, compactPostcode, dailyCap, outcomeOf, searchText, suggestionsFrom, townCase } from './address.js';

test('accepts full UK postcodes in any spacing or case, nothing else', () => {
  assert.equal(compactPostcode('ls6 1ab'), 'LS61AB');
  assert.equal(compactPostcode(' BD7  1AB '), 'BD71AB');
  assert.equal(compactPostcode('SW1A 2AA'), 'SW1A2AA');
  assert.equal(compactPostcode('LS6'), null);
  assert.equal(compactPostcode('not a postcode'), null);
  assert.equal(compactPostcode(42), null);
});

test('turns the provider’s records into list labels, address lines and UPRNs', () => {
  const found = addressesFrom([
    { line_1: 'Flat 1', line_2: '10 Long Lane', line_3: '', post_town: 'LEEDS', postcode: 'LS6 1AB', uprn: 72001234, udprn: 1 },
    { line_1: 'The Old Mill', line_2: '', line_3: '', post_town: 'STOKE-ON-TRENT', postcode: 'ST1 1AA', uprn: '' },
    { line_1: '', post_town: 'LEEDS' },
    'junk',
  ]);
  assert.deepEqual(found, [
    { label: 'Flat 1, 10 Long Lane', address: 'Flat 1, 10 Long Lane, Leeds', uprn: '72001234' },
    { label: 'The Old Mill', address: 'The Old Mill, Stoke-on-Trent', uprn: null },
  ]);
  assert.deepEqual(addressesFrom(null), []);
  assert.equal(townCase('NEWCASTLE UPON TYNE'), 'Newcastle upon Tyne');
});

test('reads the provider’s answer: found, unknown postcode, or a problem to report', () => {
  assert.deepEqual(outcomeOf(200, { code: 2000, result: [] }), { kind: 'found' });
  assert.deepEqual(outcomeOf(404, { code: 4040 }), { kind: 'not-found' });
  assert.deepEqual(outcomeOf(404, { code: 4044 }), { kind: 'not-found' }, 'a chosen address that has gone');
  assert.deepEqual(outcomeOf(402, { code: 4020 }), { kind: 'unavailable', reason: 'no-credit' });
  assert.deepEqual(outcomeOf(402, { code: 4021 }), { kind: 'unavailable', reason: 'limit' });
  assert.deepEqual(outcomeOf(401, { code: 4010 }), { kind: 'unavailable', reason: 'key' });
  assert.deepEqual(outcomeOf(503, null), { kind: 'unavailable', reason: 'provider' });
});

test('suggestions: only sensible searches go out, near the postcode given, and only what the list needs comes back', () => {
  assert.equal(searchText('  12   long  la '), '12 long la');
  assert.equal(searchText('12'), null, 'too short to search');
  assert.equal(searchText('---'), null);
  assert.equal(searchText('x'.repeat(101)), null);
  assert.equal(searchText(null), null);
  assert.deepEqual(biasFor('ls6 1ab'), { bias_postcode: 'LS6 1AB' });
  assert.deepEqual(biasFor('ls6'), { bias_postcode_outward: 'LS6' });
  assert.deepEqual(biasFor('LS'), {});
  assert.deepEqual(biasFor(undefined), {});
  const hits = suggestionsFrom([
    { id: 'paf_8387729', suggestion: '12 Long Lane, Leeds, LS6', udprn: 8387729, urls: { udprn: '/v1/udprn/8387729' } },
    { id: '../../postcodes/LS61AB', suggestion: 'Not an id we would send on' },
    { id: 'paf_1', suggestion: '   ' },
    'junk',
    ...Array.from({ length: 12 }, (_, i) => ({ id: `paf_${100 + i}`, suggestion: `${i} Long Lane, Leeds, LS6` })),
  ]);
  assert.equal(hits.length, 8, 'at most eight');
  assert.deepEqual(hits[0], { id: 'paf_8387729', label: '12 Long Lane, Leeds, LS6' });
  assert.deepEqual(suggestionsFrom(undefined), []);
});

test('the site allows ten times as many suggestions as lookups a day', () => {
  const before = process.env.MPMB_ADDRESS_DAILY_CAP;
  delete process.env.MPMB_ADDRESS_DAILY_CAP;
  assert.equal(dailyCap('lookup'), 1500);
  assert.equal(dailyCap('suggestion'), 15000);
  process.env.MPMB_ADDRESS_DAILY_CAP = '50';
  assert.equal(dailyCap('suggestion'), 500);
  if (before === undefined) delete process.env.MPMB_ADDRESS_DAILY_CAP;
  else process.env.MPMB_ADDRESS_DAILY_CAP = before;
});
