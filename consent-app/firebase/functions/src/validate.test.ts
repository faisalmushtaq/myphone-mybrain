import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateConsentPayload, validateDonationPayload, type ConsentPayload, type DonationPayload } from './validate.js';

const now = new Date().toISOString();
const signature = { method: 'drawn' as const, imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=', typedName: null, strokeCount: 2, pointerType: 'touch', capturedAt: now };
const r = (statementId: string, response: 'agreed' | 'declined', via: 'individual' | 'group' | 'signature' | 'action', version = '0.3-draft') => ({ statementId, version, response, respondedAt: now, via });

function valid(): ConsentPayload {
  return {
    kind: 'consent',
    referenceCode: null,
    studyId: 'MPMB',
    siteId: 'LEEDS-BRADFORD',
    route: 'young',
    identity: { firstName: 'Kai', lastName: 'Patel', dateOfBirth: { day: '14', month: '3', year: '2013' }, schoolId: 'BRD-001', schoolOther: '', yearGroup: 'Year 8' },
    guardian: { fullName: 'Priya Patel', relationship: 'mother', relationshipOther: '', hasParentalResponsibility: true, email: '', phone: '', postcode: '' },
    consent: {
      formId: 'mpmb-parent-consent',
      formVersion: '0.5-draft',
      informationVersion: '0.3-draft',
      responses: {
        'read-information': r('read-information', 'agreed', 'group'),
        'take-part': r('take-part', 'agreed', 'group'),
        'understand-withdraw': r('understand-withdraw', 'agreed', 'group'),
        'records-checked': r('records-checked', 'agreed', 'group'),
        'phone-use': r('phone-use', 'agreed', 'individual', '0.4-draft'),
        'link-records': r('link-records', 'declined', 'individual', '0.4-draft'),
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
      formVersion: '0.4-draft',
      status: 'completed',
      deferredBy: null,
      responses: { understand: r('understand', 'agreed', 'signature'), 'can-stop': r('can-stop', 'agreed', 'signature'), 'take-part': r('take-part', 'agreed', 'signature') },
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
    client: { userAgent: 'test', submittedAt: now, timezoneOffset: 0 },
  };
}

function validDonation(): DonationPayload {
  return {
    referenceCode: 'MPMB-AB2C-D3E',
    platform: 'ios',
    uploads: [{ uploadId: '123e4567-e89b-12d3-a456-426614174000', redacted: true, cropped: false, acknowledgedWarning: false }],
    agreement: r('phone-use', 'agreed', 'action', '0.4-draft'),
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

test('rejects a missing required statement', () => {
  const p = valid();
  delete p.consent!.responses['take-part'];
  assert.ok(validateConsentPayload(p).some((m) => m.includes('"take-part"')));
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

test('the parent’s questions are optional, checked against the form, and never sent with a declined record', () => {
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

test('declined record carries no permission record and no date of birth', () => {
  const p = valid();
  p.kind = 'declined';
  p.assent.status = 'declined';
  p.assent.responses = { 'take-part': r('take-part', 'declined', 'individual') };
  p.assent.signature = null;
  assert.ok(validateConsentPayload(p).some((m) => m.includes('must not carry a permission')));
  assert.ok(validateConsentPayload(p).some((m) => m.includes('must not carry the questions')));
  p.consent = null;
  p.survey = null;
  p.identity.dateOfBirth = { day: '', month: '', year: '' };
  assert.deepEqual(validateConsentPayload(p), []);
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
  d.agreement = r('phone-use', 'agreed', 'individual', '0.4-draft');
  assert.ok(validateDonationPayload(d).some((m) => m.includes('malformed')));
  d.agreement = r('phone-use', 'agreed', 'action', '0.1-draft');
  assert.ok(validateDonationPayload(d).some((m) => m.includes('version')));
  d.agreement = r('take-part', 'agreed', 'action');
  assert.ok(validateDonationPayload(d).some((m) => m.includes('malformed')));
});

test('screenshots are accepted without the young person’s in-app agreement (it may be collected on paper)', () => {
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
