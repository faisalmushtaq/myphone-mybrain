import assert from 'node:assert/strict';
import { test } from 'node:test';
import { study } from './forms.js';
import { mayAddTo, normaliseReference, resumeSummary, validateLateAgreement } from './resume.js';

const now = new Date().toISOString();
const signature = { method: 'drawn' as const, imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=', typedName: null, strokeCount: 2, pointerType: 'touch', capturedAt: now };
const r = (statementId: string, response: 'agreed' | 'declined', via: 'individual' | 'signature', version: string) => ({ statementId, version, response, respondedAt: now, via });
const signed = { understand: r('understand', 'agreed', 'signature', '0.4-draft'), 'can-stop': r('can-stop', 'agreed', 'signature', '0.3-draft'), 'take-part': r('take-part', 'agreed', 'signature', '0.4-draft') };
const client = { userAgent: 'test', submittedAt: now, timezoneOffset: 0 };
const yes = { referenceCode: 'MPMB-ABCD-EF2', assent: { formId: 'mpmb-child-assent', formVersion: '0.5-draft', status: 'completed', responses: signed, signature, startedAt: now, completedAt: now }, client };

test('a reference as typed: case, spaces and dashes do not matter; anything else is refused', () => {
  assert.equal(normaliseReference('MPMB-ABCD-EF2'), 'MPMB-ABCD-EF2');
  assert.equal(normaliseReference(' mpmb abcd ef2 '), 'MPMB-ABCD-EF2');
  assert.equal(normaliseReference('mpmbabcdef2'), 'MPMB-ABCD-EF2');
  assert.equal(normaliseReference('MPMB-ABCD-EF'), null);
  assert.equal(normaliseReference('MPMB-ABCD-EF1'), null, 'the codes never use 1, 0, I, L or O');
  assert.equal(normaliseReference('MP2670FF90A5F2'), null, 'a break-study participant ID is not a family reference');
  assert.equal(normaliseReference(42), null);
});

test('what a family coming back can add, from the records', () => {
  const base = { kind: 'consent', imageCount: 0, selfConsent: false };
  const kai = { firstName: 'Kai' };
  // The young person was not there, or wanted to decide later: they can now say yes (then screenshots) or no.
  const later = resumeSummary('MPMB-ABCD-EF2', { ...base, phoneSource: 'child' }, kai, { status: 'deferred' }, undefined);
  assert.deepEqual([later.canAgree, later.canAddScreenshots, later.reason, later.firstName, later.maxImages], [true, false, null, 'Kai', study.maxImages]);
  // They agreed, but no screenshots were sent: add them.
  const agreed = resumeSummary('MPMB-ABCD-EF2', { ...base, phoneSource: 'child' }, kai, { status: 'completed' }, undefined);
  assert.deepEqual([agreed.canAgree, agreed.canAddScreenshots, agreed.reason], [false, true, null]);
  // From the parent's own phone: screenshots, no agreement asked.
  const parent = resumeSummary('MPMB-ABCD-EF2', { ...base, phoneSource: 'parent', imageCount: 2 }, kai, { status: 'not-started' }, undefined);
  assert.deepEqual([parent.canAgree, parent.canAddScreenshots, parent.imageCount], [false, true, 2]);
  // A no stays a no here; no screen time stays none; a full record takes no more.
  assert.equal(resumeSummary('MPMB-ABCD-EF2', { ...base, phoneSource: 'child' }, kai, { status: 'declined' }, undefined).reason, 'declined');
  assert.equal(resumeSummary('MPMB-ABCD-EF2', { ...base, phoneSource: 'none' }, kai, { status: 'not-started' }, undefined).reason, 'no-screen-time');
  assert.equal(resumeSummary('MPMB-ABCD-EF2', { ...base, phoneSource: 'parent', imageCount: study.maxImages }, kai, { status: 'not-started' }, undefined).reason, 'full');
  // Records from before 7 October 2026 have no phoneSource: the parent's answer decides.
  assert.equal(resumeSummary('MPMB-ABCD-EF2', base, kai, { status: 'deferred' }, 'agreed').canAgree, true);
  assert.equal(resumeSummary('MPMB-ABCD-EF2', base, kai, { status: 'deferred' }, 'declined').reason, 'no-screen-time');
  // Saved when the parent signed, but left before they said whether to share it: nothing to add here.
  const unfinished = resumeSummary('MPMB-ABCD-EF2', { ...base, phoneSource: null }, kai, { status: 'not-started' }, undefined);
  assert.deepEqual([unfinished.canAgree, unfinished.canAddScreenshots, unfinished.reason], [false, false, 'unfinished']);
});

test('the young person’s answer given later: a signed yes, or a no', () => {
  assert.deepEqual(validateLateAgreement(yes), []);
  assert.deepEqual(validateLateAgreement({ ...yes, referenceCode: 'mpmb abcd ef2' }), [], 'the reference as typed');
  const no = { ...yes, assent: { ...yes.assent, status: 'declined', signature: null, completedAt: now, responses: { 'take-part': r('take-part', 'declined', 'individual', '0.4-draft') } } };
  assert.deepEqual(validateLateAgreement(no), []);
  assert.match(validateLateAgreement({ ...yes, assent: { ...yes.assent, status: 'deferred' } }).join(' '), /answer is missing/, 'putting it off again sends nothing');
  assert.match(validateLateAgreement({ ...yes, assent: { ...yes.assent, signature: null } }).join(' '), /signature/i);
  assert.match(validateLateAgreement({ ...yes, assent: { ...yes.assent, formVersion: '0.4-draft' } }).join(' '), /must be mpmb-child-assent 0\.5-draft/);
  assert.match(validateLateAgreement({ ...no, assent: { ...no.assent, responses: {} } }).join(' '), /record the young person’s no/);
  assert.match(validateLateAgreement({ ...yes, referenceCode: 'nope' }).join(' '), /reference is malformed/);
  assert.match(validateLateAgreement({ ...yes, client: null }).join(' '), /Client information/);
});

test('who may add to a record: the session that made it, or one that came back with the reference', () => {
  assert.equal(mayAddTo({ sessionUid: 'a' }, 'a'), true);
  assert.equal(mayAddTo({ sessionUid: 'a', resumeUids: ['b'] }, 'b'), true);
  assert.equal(mayAddTo({ sessionUid: 'a', resumeUids: ['b'] }, 'c'), false);
  assert.equal(mayAddTo({ sessionUid: 'a' }, 'c'), false);
});
