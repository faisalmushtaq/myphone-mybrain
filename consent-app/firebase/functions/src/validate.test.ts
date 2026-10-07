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
    guardian: { fullName: 'Priya Patel', relationship: 'mother', relationshipOther: '', hasParentalResponsibility: true, email: '', phone: '', postcode: '' },
    consent: {
      formId: 'mpmb-parent-consent',
      formVersion: '0.6-draft',
      informationVersion: '0.4-draft',
      responses: {
        'read-information': r('read-information', 'agreed', 'group', '0.4-draft'),
        answers: r('answers', 'agreed', 'group', '0.1-draft'),
        'understand-withdraw': r('understand-withdraw', 'agreed', 'group', '0.4-draft'),
        'records-checked': r('records-checked', 'agreed', 'group'),
        'phone-use': r('phone-use', 'agreed', 'individual', '0.5-draft'),
        recontact: r('recontact', 'declined', 'individual'),
      },
      typedName: 'Priya Patel',
      signature,
      confirmedDate: now.slice(0, 10),
      completedAt: now,
      revisedAt: null,
    },
    assent: {
      formId: 'mpmb-child-assent',
      formVersion: '0.5-draft',
      status: 'completed',
      deferredBy: null,
      responses: { understand: r('understand', 'agreed', 'signature', '0.4-draft'), 'can-stop': r('can-stop', 'agreed', 'signature'), 'take-part': r('take-part', 'agreed', 'signature', '0.4-draft') },
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

const notAsked = (): ConsentPayload['assent'] => ({ formId: 'mpmb-child-assent', formVersion: '0.5-draft', status: 'not-started', deferredBy: null, responses: {}, signature: null, handoverConfirmedAt: null, startedAt: null, completedAt: null });

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
  // Since 7 October 2026 the workshop and record linkage are opt-out: neither is asked on the form.
  for (const gone of ['take-part', 'link-records']) {
    const q = valid();
    q.consent!.responses[gone] = r(gone, 'agreed', 'group', '0.4-draft');
    assert.ok(validateConsentPayload(q).some((m) => m.includes(`unknown statement "${gone}"`)), gone);
  }
});

test('rejects an old statement version', () => {
  const p = valid();
  p.consent!.responses['phone-use'].version = '0.1-draft';
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

test('16 or 17 on their own: no parent, no permission record, their own signed agreement', () => {
  const p = valid();
  p.identity.dateOfBirth = dobFor(16);
  p.guardian = { fullName: '', relationship: '', relationshipOther: '', hasParentalResponsibility: false, email: '', phone: '', postcode: '' };
  p.consent = null;
  p.survey = null;
  assert.deepEqual(validateConsentPayload(p), []);
  assert.ok(validateConsentPayload({ ...p, guardian: { ...p.guardian, fullName: 'Priya Patel' } }).some((m) => m.includes('no parent or carer details')));
  assert.ok(validateConsentPayload({ ...p, consent: valid().consent }).some((m) => m.includes('no permission record')));
  assert.ok(validateConsentPayload({ ...p, survey: valid().survey }).some((m) => m.includes('no questions')));
  assert.ok(validateConsentPayload({ ...p, assent: { ...p.assent, status: 'deferred', deferredBy: 'young', signature: null } }).some((m) => m.includes('only once they have agreed')));
  // Under 16 the same record needs the parent.
  assert.ok(validateConsentPayload({ ...p, identity: { ...p.identity, dateOfBirth: dobFor(15) } }).some((m) => m.includes('permission record is missing')));
});

test('the parent of a 16- or 17-year-old is not asked about the screenshots: the young person decides', () => {
  const p = valid();
  p.route = 'parent';
  p.identity.dateOfBirth = dobFor(17);
  delete p.consent!.responses['phone-use'];
  assert.deepEqual(validateConsentPayload(p), []);
  const q = valid();
  q.route = 'parent';
  q.identity.dateOfBirth = dobFor(17);
  assert.ok(validateConsentPayload(q).some((m) => m.includes('"phone-use" is not asked')));
});

test('under 16 on the parent’s route: the screen time comes from where the parent chose', () => {
  const p = valid();
  p.route = 'parent';
  p.phoneSource = 'parent';
  p.assent = notAsked();
  assert.deepEqual(validateConsentPayload(p), [], 'from the parent’s own phone, no agreement is asked of the young person');
  assert.ok(validateConsentPayload({ ...p, phoneSource: null }).some((m) => m.includes('Where the screen time comes from is missing')));
  assert.ok(validateConsentPayload({ ...p, phoneSource: 'child' }).some((m) => m.includes('agreement was not completed')));
  assert.deepEqual(validateConsentPayload({ ...p, phoneSource: 'child', assent: valid().assent }), []);
  // On the young person's own route it is their phone, whatever is claimed.
  assert.ok(validateConsentPayload({ ...valid(), phoneSource: 'parent' }).some((m) => m.includes('does not match')));
});

test('after the parent’s no there is no screen time, and the longer questions are checked against their form', () => {
  const p = valid();
  p.route = 'parent';
  p.consent!.responses['phone-use'] = r('phone-use', 'declined', 'individual', '0.5-draft');
  p.phoneSource = 'none';
  p.assent = notAsked();
  p.more = { formId: 'mpmb-parent-phone-use', formVersion: '0.1-draft', status: 'completed', responses: { 'school-day-time': { questionId: 'school-day-time', version: '0.1-draft', value: '2-3', answeredAt: now }, 'more-notes': { questionId: 'more-notes', version: '0.1-draft', value: 'Late nights.', answeredAt: now } }, startedAt: now, completedAt: now };
  assert.deepEqual(validateConsentPayload(p), []);
  assert.ok(validateConsentPayload({ ...p, phoneSource: 'parent' }).some((m) => m.includes('does not match')));
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
