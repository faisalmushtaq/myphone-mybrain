import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { assess, FAMILY_REASONS, findTerms, flatnessOfPixels, type SafeSearch } from './quality.js';

const safe: SafeSearch = { adult: 'VERY_UNLIKELY', violence: 'VERY_UNLIKELY', racy: 'UNLIKELY', medical: 'VERY_UNLIKELY', spoof: 'UNLIKELY' };
const screenText = 'Screen Time\nDaily Average\n4h 12m\nMost Used\nInstagram 1h 40m\nYouTube 55m\nMessages 30m';

test('finds screen-time words and durations', () => {
  const found = findTerms(screenText);
  assert.ok(found.includes('screen time') && found.includes('most used') && found.some((t) => t.endsWith('durations')));
  assert.deepEqual(findTerms('Happy birthday Grandma!'), []);
});

test('flatness is high for flat colour and low for noise', () => {
  const flat = new Uint8Array(96 * 96 * 3).fill(240);
  assert.ok(flatnessOfPixels(flat, 3) === 1);
  const noise = new Uint8Array(randomBytes(96 * 96 * 3));
  assert.ok(flatnessOfPixels(noise, 3) < 0.1);
  assert.equal(flatnessOfPixels(new Uint8Array(0), 3), 0);
});

test('a clean screen-time screenshot is accepted', () => {
  const q = assess({ width: 1170, height: 2532, flatness: 0.8, vision: { safeSearch: safe, text: screenText }, acknowledgedWarning: false });
  assert.equal(q.verdict, 'accepted');
  assert.equal(q.familyReason, null);
  assert.ok(q.checkedWithVision && q.looksLikeScreen);
});

test('unsafe content is rejected with a plain reason and never stored', () => {
  const q = assess({ width: 1170, height: 2532, flatness: 0.8, vision: { safeSearch: { ...safe, adult: 'LIKELY' }, text: screenText }, acknowledgedWarning: true });
  assert.equal(q.verdict, 'rejected');
  assert.equal(q.familyReason, FAMILY_REASONS.unsafe);
  assert.ok(q.reasons.some((r) => r.startsWith('SafeSearch adult')));
  const v = assess({ width: 1170, height: 2532, flatness: 0.8, vision: { safeSearch: { ...safe, violence: 'VERY_LIKELY' }, text: '' }, acknowledgedWarning: false });
  assert.equal(v.verdict, 'rejected');
});

test('a photograph with no screen-time words is rejected; an unclear image is kept for review', () => {
  const photo = assess({ width: 3000, height: 4000, flatness: 0.08, vision: { safeSearch: safe, text: 'Happy birthday' }, acknowledgedWarning: true });
  assert.equal(photo.verdict, 'rejected');
  assert.equal(photo.familyReason, FAMILY_REASONS.notScreen);
  const unclear = assess({ width: 1170, height: 2532, flatness: 0.6, vision: { safeSearch: safe, text: 'Settings\nGeneral\nAbout' }, acknowledgedWarning: false });
  assert.equal(unclear.verdict, 'review');
  assert.equal(unclear.familyReason, null);
  const possible = assess({ width: 1170, height: 2532, flatness: 0.8, vision: { safeSearch: { ...safe, racy: 'POSSIBLE' }, text: screenText }, acknowledgedWarning: false });
  assert.equal(possible.verdict, 'review');
  assert.ok(possible.reasons.some((r) => r.includes('possible')));
});

test('without Vision, shape and colour decide between accepted and review, never rejected', () => {
  assert.equal(assess({ width: 1170, height: 2532, flatness: 0.7, vision: null, acknowledgedWarning: false }).verdict, 'accepted');
  const photo = assess({ width: 4000, height: 3000, flatness: 0.1, vision: null, acknowledgedWarning: true });
  assert.equal(photo.verdict, 'review');
  assert.ok(photo.reasons.some((r) => r.includes('photograph')) && photo.reasons.some((r) => r.includes('Not portrait')) && photo.reasons.some((r) => r.includes('said the image was right')));
  assert.equal(photo.checkedWithVision, false);
});
