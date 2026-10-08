import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateConsentPayload, validateDonationPayload, type ConsentPayload, type DonationPayload } from './validate.js';

const now = new Date().toISOString();
const signature = { method: 'drawn' as const, imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=', typedName: null, strokeCount: 2, pointerType: 'touch', capturedAt: now };
const r = (statementId: string, response: 'agreed' | 'declined', via: 'individual' | 'group' | 'signature' | 'action', version = '0.3-draft') => ({ statementId, version, response, respondedAt: now, via });

/** A date of birth that makes someone `age` today. */
const dobFor = (age: number) => ({ day: '1', month: '1', year: String(new Date().getFullYear() - age) });

/** An under-16 on their own route, whose parent said yes: the screen time comes from the young person's phone, with their signed agreement. */
function valid(): ConsentPayload {
  return {
    kind: 'consent',
    referenceCode: null,
    studyId: 'MPMB',
    siteId: 'LEEDS-BRADFORD',
    route: 'young',
    identity: { firstName: 'Kai', lastName: 'Patel', dateOfBirth: dobFor(13), schoolId: 'BRD-001', schoolOther: '', yearGroup: 'Year 8' },
    guardian: { fullName: 'Priya Patel', relationship: 'mother', relationshipOther: '', address: '1 Long Lane, Leeds', postcode: 'LS6 1AB', email: '', phone: '' },
    consent: {
      formId: 'mpmb-parent-consent',
      formVersion: '0.9-draft',
      informationVersion: '0.6-draft',
      responses: {
        'read-information': r('read-information', 'agreed', 'group', '0.5-draft'),
        answers: r('answers', 'agreed', 'group', '0.3-draft'),
        'understand-withdraw': r('understand-withdraw', 'agreed', 'group', '0.5-draft'),
        'records-checked': r('records-checked', 'agreed', 'group', '0.4-draft'),
      },
      typedName: 'Priya Patel',
      signature,
      confirmedDate: now.slice(0, 10),
      completedAt: now,
      revisedAt: null,
    },
    assent: {
      formId: 'mpmb-child-assent',
      formVersion: '0.6-draft',
      status: 'completed',
      deferredBy: null,
      responses: { understand: r('understand', 'agreed', 'signature', '0.5-draft'), 'can-stop': r('can-stop', 'agreed', 'signature'), 'take-part': r('take-part', 'agreed', 'signature', '0.4-draft') },
      signature,
      handoverConfirmedAt: now,
      startedAt: now,
      completedAt: now,
    },
    survey: {
      formId: 'mpmb-parent-perceptions',
      formVersion: '0.2-draft',
      status: 'completed',
      responses: { concern: { questionId: 'concern', version: '0.1-draft', value: 'somewhat', answeredAt: now }, 'anything-else': { questionId: 'anything-else', version: '0.1-draft', value: 'Mostly YouTube, late at night.', answeredAt: now } },
      startedAt: now,
      completedAt: now,
    },
    phoneSource: 'child',
    more: null,
    client: { userAgent: 'test', submittedAt: now, timezoneOffset: 0 },
  };
}

const notAsked = (): ConsentPayload['assent'] => ({ formId: 'mpmb-child-assent', formVersion: '0.6-draft', status: 'not-started', deferredBy: null, responses: {}, signature: null, handoverConfirmedAt: null, startedAt: null, completedAt: null });

function validDonation(): DonationPayload {
  return {
    referenceCode: 'MPMB-AB2C-D3E',
    platform: 'ios',
    uploads: [{ uploadId: '123e4567-e89b-12d3-a456-426614174000', redacted: true, cropped: false, acknowledgedWarning: false }],
    agreement: r('phone-use', 'agreed', 'action', '0.5-draft'),
    client: { userAgent: 'test', submittedAt: now, timezoneOffset: 0 },
  };
}

test('accepts a complete permission record without an email address', () => {
  assert.deepEqual(validateConsentPayload(valid()), []);
});

test('accepts an amendment carrying a reference code, and rejects a malformed one', () => {
  const p = valid();
  p.referenceCode = 'MPMB-AB2C-D3E';
  assert.deepEqual(validateConsentPayload(p), []);
  p.referenceCode = 'MPMB-1234-567';
  assert.ok(validateConsentPayload(p).some((m) => m.includes('reference code')));
});

test('an email address is optional, but must be valid when given', () => {
  const p = valid();
  p.guardian.email = 'priya@example.com';
  assert.deepEqual(validateConsentPayload(p), []);
  p.guardian.email = 'not-an-email';
  assert.ok(validateConsentPayload(p).some((m) => m.includes('not valid')));
});

test('the parent’s home address and postcode are required; email and phone are optional', () => {
  const p = valid();
  assert.ok(validateConsentPayload({ ...p, guardian: { ...p.guardian, address: ' ' } }).includes('The home address is missing.'));
  assert.ok(validateConsentPayload({ ...p, guardian: { ...p.guardian, postcode: '' } }).includes('The postcode is missing.'));
  // The property's UPRN, only from the address finder: digits, or nothing.
  assert.deepEqual(validateConsentPayload({ ...p, guardian: { ...p.guardian, uprn: '72001234' } }), validateConsentPayload(p));
  assert.ok(validateConsentPayload({ ...p, guardian: { ...p.guardian, uprn: '72-001' } }).includes('The property reference is not valid.'));
  assert.ok(validateConsentPayload({ ...p, guardian: { ...p.guardian, uprn: '1234567890123' } }).includes('The property reference is not valid.'));
  assert.ok(validateConsentPayload({ ...p, guardian: { ...p.guardian, postcode: 'LS2' } }).includes('The postcode is not valid.'));
  assert.deepEqual(validateConsentPayload({ ...p, guardian: { ...p.guardian, email: '', phone: '' } }), [], 'no email or phone is fine');
});

test('a typed-in school name needs at least three letters', () => {
  const p = valid();
  p.identity.schoolId = 'other';
  p.identity.schoolOther = 'St';
  assert.ok(validateConsentPayload(p).some((m) => m.includes('at least 3 letters')));
  p.identity.schoolOther = 'St Bede’s';
  assert.deepEqual(validateConsentPayload(p), []);
});

test('rejects a missing required statement, and the statements no longer asked', () => {
  const p = valid();
  delete p.consent!.responses.answers;
  assert.ok(validateConsentPayload(p).some((m) => m.includes('"answers"')));
  // Since 7 October 2026 the workshop and record linkage are opt-out, the parent's yes to the screen time is their answer to where it comes from, and future contact is not asked: none of these is a statement on the form.
  for (const gone of ['take-part', 'link-records', 'phone-use', 'recontact']) {
    const q = valid();
    q.consent!.responses[gone] = r(gone, 'agreed', 'group', '0.4-draft');
    assert.ok(validateConsentPayload(q).some((m) => m.includes(`unknown statement "${gone}"`)), gone);
  }
});

test('the current information, or a recent earlier version for a family who signed before an update', () => {
  const p = valid();
  assert.deepEqual(validateConsentPayload({ ...p, consent: { ...p.consent!, informationVersion: '0.5-draft' } }), []);
  assert.ok(validateConsentPayload({ ...p, consent: { ...p.consent!, informationVersion: '0.4-draft' } }).some((m) => m.includes('information shown must be version 0.6-draft')));
});

test('rejects an old statement version', () => {
  const p = valid();
  p.consent!.responses['records-checked'].version = '0.1-draft';
  assert.ok(validateConsentPayload(p).some((m) => m.includes('version')));
});

test('rejects an 18-year-old', () => {
  const p = valid();
  p.identity.dateOfBirth = { day: '1', month: '1', year: String(new Date().getFullYear() - 19) };
  assert.ok(validateConsentPayload(p).some((m) => m.includes('aged')));
});

test('rejects an empty drawn signature', () => {
  const p = valid();
  p.consent!.signature = { ...signature, strokeCount: 0 };
  assert.ok(validateConsentPayload(p).some((m) => m.includes('empty')));
});

test('the parent’s questions are optional and checked against the form', () => {
  const p = valid();
  p.survey = null;
  assert.deepEqual(validateConsentPayload(p), []);
  const q = valid();
  q.survey!.responses.evil = { questionId: 'evil', version: '0.1-draft', value: 'x', answeredAt: now };
  assert.ok(validateConsentPayload(q).some((m) => m.includes('Unknown question')));
  const v = valid();
  v.survey!.responses.concern.value = 'wildly';
  assert.ok(validateConsentPayload(v).some((m) => m.includes('Malformed answer')));
  const w = valid();
  w.survey!.responses.concern.version = '0.0-draft';
  assert.ok(validateConsentPayload(w).some((m) => m.includes('"concern"') && m.includes('version')));
  const t = valid();
  t.survey!.responses['anything-else'].value = 'x'.repeat(501);
  assert.ok(validateConsentPayload(t).some((m) => m.includes('"anything-else"')));
  t.survey!.responses['anything-else'].value = '   ';
  assert.ok(validateConsentPayload(t).some((m) => m.includes('"anything-else"')));
  t.survey!.responses['anything-else'].value = 'Fine.';
  assert.deepEqual(validateConsentPayload(t), []);
});

test('there is no "declined" record any more: a young person’s no is part of the parent’s record', () => {
  const p = valid() as unknown as Record<string, unknown>;
  p.kind = 'declined';
  assert.ok(validateConsentPayload(p).some((m) => m.includes('Unknown submission kind')));
  const q = valid();
  q.assent = { ...q.assent, status: 'declined', signature: null, completedAt: now, responses: { 'take-part': r('take-part', 'declined', 'individual', '0.4-draft') } };
  assert.deepEqual(validateConsentPayload(q), []);
  q.assent.responses = {};
  assert.ok(validateConsentPayload(q).some((m) => m.includes('must record the young person’s no')));
});

test('16 or over on their own: their own postcode, no parent, no permission record, their own signed agreement', () => {
  const p = valid();
  p.identity.dateOfBirth = dobFor(16);
  p.identity.postcode = 'LS6 1AB';
  p.guardian = { fullName: '', relationship: '', relationshipOther: '', address: '', postcode: '', email: '', phone: '' };
  p.consent = null;
  p.survey = null;
  assert.deepEqual(validateConsentPayload(p), []);
  assert.ok(validateConsentPayload({ ...p, guardian: { ...p.guardian, fullName: 'Priya Patel' } }).some((m) => m.includes('no parent or carer details')));
  assert.ok(validateConsentPayload({ ...p, identity: { ...p.identity, postcode: '' } }).some((m) => m.includes('postcode is missing')));
  assert.ok(validateConsentPayload({ ...p, identity: { ...p.identity, postcode: 'LS6' } }).some((m) => m.includes('postcode is not valid')));
  // 18-year-olds at college take part too, on their own.
  assert.deepEqual(validateConsentPayload({ ...p, identity: { ...p.identity, dateOfBirth: dobFor(18) } }), []);
  assert.ok(validateConsentPayload({ ...p, identity: { ...p.identity, dateOfBirth: dobFor(19) } }).some((m) => m.includes('aged 11 to 18')));
  assert.ok(validateConsentPayload({ ...p, consent: valid().consent }).some((m) => m.includes('no permission record')));
  assert.ok(validateConsentPayload({ ...p, survey: valid().survey }).some((m) => m.includes('no questions')));
  assert.ok(validateConsentPayload({ ...p, assent: { ...p.assent, status: 'deferred', deferredBy: 'young', signature: null } }).some((m) => m.includes('only once they have agreed')));
  // Under 16 the same record needs the parent, and the parent's postcode is the one kept.
  assert.ok(validateConsentPayload({ ...p, identity: { ...p.identity, dateOfBirth: dobFor(15) } }).some((m) => m.includes('permission record is missing')));
  assert.ok(validateConsentPayload({ ...valid(), identity: { ...valid().identity, postcode: 'LS6 1AB' } }).some((m) => m.includes('Only a young person deciding alone')));
});

test('the parent of a young person of 16 or over is not asked about the screenshots: the young person decides, from their own phone', () => {
  const p = valid();
  p.route = 'parent';
  p.identity.dateOfBirth = dobFor(17);
  assert.deepEqual(validateConsentPayload(p), []);
  assert.ok(validateConsentPayload({ ...p, phoneSource: 'parent' }).some((m) => m.includes('does not match')));
  assert.ok(validateConsentPayload({ ...p, phoneSource: null }).some((m) => m.includes('does not match')));
});

test('under 16: the screen time comes from where the parent chose, and the record is saved from the moment they sign', () => {
  const p = valid();
  p.route = 'parent';
  p.phoneSource = 'parent';
  p.assent = notAsked();
  assert.deepEqual(validateConsentPayload(p), [], 'from the parent’s own phone, no agreement is asked of the young person');
  assert.deepEqual(validateConsentPayload({ ...p, phoneSource: null, survey: { ...p.survey!, status: 'in-progress', completedAt: null } }), [], 'signed, part-way through the questions, before saying where the screen time comes from');
  assert.deepEqual(validateConsentPayload({ ...p, phoneSource: 'child' }), [], 'from the young person’s phone, before they have answered');
  assert.deepEqual(validateConsentPayload({ ...p, phoneSource: 'child', assent: valid().assent }), []);
  assert.ok(validateConsentPayload({ ...p, phoneSource: 'somewhere' as never }).some((m) => m.includes('does not match')));
  // On the young person's own route it is their phone, or none.
  assert.ok(validateConsentPayload({ ...valid(), phoneSource: 'parent' }).some((m) => m.includes('does not match')));
  assert.deepEqual(validateConsentPayload({ ...valid(), phoneSource: 'none', assent: notAsked() }), []);
});

test('when the parent says no to sharing, there is no screen time, and the longer questions are checked against their form', () => {
  const p = valid();
  p.route = 'parent';
  p.phoneSource = 'none';
  p.assent = notAsked();
  p.more = { formId: 'mpmb-parent-phone-use', formVersion: '0.3-draft', status: 'completed', responses: { 'school-day-time': { questionId: 'school-day-time', version: '0.1-draft', value: '2-3', answeredAt: now }, 'after-bedtime': { questionId: 'after-bedtime', version: '0.1-draft', value: 'sometimes', answeredAt: now } }, startedAt: now, completedAt: now };
  assert.deepEqual(validateConsentPayload(p), []);
  assert.deepEqual(validateConsentPayload({ ...p, more: { ...p.more, status: 'in-progress', completedAt: null } }), [], 'part-way through the longer questions');
  // The age at their own smartphone, year by year from under 5, or not remembered.
  const age = (value: string) => validateConsentPayload({ ...p, more: { ...p.more!, responses: { 'own-phone-age': { questionId: 'own-phone-age', version: '0.2-draft', value, answeredAt: now } } } });
  for (const value of ['under-5', '7', '14', '15-plus', 'none', 'unsure']) assert.deepEqual(age(value), [], value);
  assert.ok(age('under-9').some((m) => m.includes('Malformed answer')), 'the old bands are not offered any more');
  // More than one app, joined by ";": each from the list, once; "I don't know" on its own.
  const apps = (value: string) => validateConsentPayload({ ...p, more: { ...p.more!, responses: { 'top-app': { questionId: 'top-app', version: '0.2-draft', value, answeredAt: now } } } });
  assert.deepEqual(apps('tiktok'), []);
  assert.deepEqual(apps('tiktok;youtube;games'), []);
  assert.deepEqual(apps('unsure'), []);
  for (const bad of ['tiktok;tiktok', 'tiktok;myspace', 'tiktok;unsure', '', 'tiktok;']) assert.ok(apps(bad).some((m) => m.includes('Malformed answer')), bad);
  assert.ok(validateConsentPayload({ ...p, more: { ...p.more, formVersion: '0.0-draft' } }).some((m) => m.includes('longer questions form')));
  assert.ok(validateConsentPayload({ ...p, more: { ...p.more, responses: { concern: { questionId: 'concern', version: '0.1-draft', value: 'somewhat', answeredAt: now } } } }).some((m) => m.includes('Unknown question')));
  assert.ok(validateConsentPayload({ ...p, more: { ...p.more, responses: { 'school-day-time': { questionId: 'school-day-time', version: '0.1-draft', value: 'all day', answeredAt: now } } } }).some((m) => m.includes('Malformed answer')));
});

test('rejects unknown statements and bad shapes', () => {
  const p = valid() as unknown as Record<string, unknown>;
  (p.consent as Record<string, unknown>).responses = { evil: r('evil', 'agreed', 'individual') };
  assert.ok(validateConsentPayload(p).some((m) => m.includes('unknown statement')));
  assert.ok(validateConsentPayload('nope').length === 1);
  assert.ok(validateDonationPayload(42).length === 1);
});

test('accepts a screenshot record', () => {
  assert.deepEqual(validateDonationPayload(validDonation()), []);
});

test('an agreement record, when present, must be by action at the current version', () => {
  const d = validDonation();
  d.agreement = r('phone-use', 'agreed', 'individual', '0.5-draft');
  assert.ok(validateDonationPayload(d).some((m) => m.includes('malformed')));
  d.agreement = r('phone-use', 'agreed', 'action', '0.1-draft');
  assert.ok(validateDonationPayload(d).some((m) => m.includes('version')));
  d.agreement = r('take-part', 'agreed', 'action');
  assert.ok(validateDonationPayload(d).some((m) => m.includes('malformed')));
});

test('screenshots from the parent’s own phone come without an agreement from the young person', () => {
  const d = validDonation();
  d.agreement = null;
  assert.deepEqual(validateDonationPayload(d), []);
});

test('screenshot record needs a reference and well-formed, distinct uploads', () => {
  const d = validDonation();
  d.referenceCode = 'nope';
  assert.ok(validateDonationPayload(d).some((m) => m.includes('reference code')));
  const e = validDonation();
  e.uploads = [];
  assert.ok(validateDonationPayload(e).some((m) => m.includes('No images')));
  e.uploads = Array.from({ length: 7 }, (_, i) => ({ uploadId: `123e4567-e89b-12d3-a456-42661417400${i}`, redacted: false, cropped: false, acknowledgedWarning: false }));
  assert.ok(validateDonationPayload(e).some((m) => m.includes('At most')));
  e.uploads = [validDonation().uploads[0], validDonation().uploads[0]];
  assert.ok(validateDonationPayload(e).some((m) => m.includes('twice')));
  e.uploads = [{ ...validDonation().uploads[0], acknowledgedWarning: 'yes' as unknown as boolean }];
  assert.ok(validateDonationPayload(e).some((m) => m.includes('malformed')));
});
