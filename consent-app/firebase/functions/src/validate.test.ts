import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validatePayload, type Payload } from './validate.js';

const now = new Date().toISOString();
const signature = { method: 'drawn' as const, imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=', typedName: null, strokeCount: 2, pointerType: 'touch', capturedAt: now };
const r = (statementId: string, response: 'agreed' | 'declined', via: 'individual' | 'group' | 'signature' | 'action') => ({ statementId, version: '0.3-draft', response, respondedAt: now, via });

function valid(): Payload {
  return {
    kind: 'consent',
    studyId: 'MPMB',
    siteId: 'LEEDS-BRADFORD',
    route: 'young',
    identity: { firstName: 'Kai', lastName: 'Patel', dateOfBirth: { day: '14', month: '3', year: '2013' }, schoolId: 'BRD-001', schoolOther: '', yearGroup: 'Year 8' },
    guardian: { fullName: 'Priya Patel', relationship: 'mother', relationshipOther: '', hasParentalResponsibility: true, email: 'priya@example.com', phone: '', postcode: '' },
    consent: {
      formId: 'mpmb-parent-consent',
      formVersion: '0.3-draft',
      informationVersion: '0.2-draft',
      responses: {
        'read-information': r('read-information', 'agreed', 'group'),
        'take-part': r('take-part', 'agreed', 'group'),
        'understand-withdraw': r('understand-withdraw', 'agreed', 'group'),
        'records-checked': r('records-checked', 'agreed', 'group'),
        'phone-use': r('phone-use', 'agreed', 'individual'),
        'link-health': r('link-health', 'agreed', 'individual'),
        'link-education': r('link-education', 'declined', 'individual'),
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
      formVersion: '0.3-draft',
      status: 'completed',
      deferredBy: null,
      responses: { understand: r('understand', 'agreed', 'signature'), 'can-stop': r('can-stop', 'agreed', 'signature'), 'take-part': r('take-part', 'agreed', 'signature'), 'phone-use': r('phone-use', 'agreed', 'action') },
      signature,
      handoverConfirmedAt: now,
      startedAt: now,
      completedAt: now,
    },
    donation: { status: 'completed', platform: 'ios', uploads: [{ uploadId: '123e4567-e89b-12d3-a456-426614174000', redacted: true, cropped: false }] },
    client: { userAgent: 'test', submittedAt: now, timezoneOffset: 0 },
  };
}

test('accepts a complete submission', () => {
  assert.deepEqual(validatePayload(valid()), []);
});

test('rejects a missing required statement', () => {
  const p = valid();
  delete p.consent!.responses['take-part'];
  assert.ok(validatePayload(p).some((m) => m.includes('"take-part"')));
});

test('rejects an old statement version', () => {
  const p = valid();
  p.consent!.responses['phone-use'].version = '0.1-draft';
  assert.ok(validatePayload(p).some((m) => m.includes('version')));
});

test('rejects images without both agreements', () => {
  const p = valid();
  p.assent.responses['phone-use'] = r('phone-use', 'declined', 'action');
  assert.ok(validatePayload(p).some((m) => m.includes('young person agreeing')));
});

test('rejects an 18-year-old', () => {
  const p = valid();
  p.identity.dateOfBirth = { day: '1', month: '1', year: String(new Date().getFullYear() - 19) };
  assert.ok(validatePayload(p).some((m) => m.includes('aged')));
});

test('rejects an empty drawn signature', () => {
  const p = valid();
  p.consent!.signature = { ...signature, strokeCount: 0 };
  assert.ok(validatePayload(p).some((m) => m.includes('empty')));
});

test('declined submission carries no permission record', () => {
  const p = valid();
  p.kind = 'declined';
  p.assent.status = 'declined';
  p.assent.responses = { 'take-part': r('take-part', 'declined', 'individual') };
  p.assent.signature = null;
  p.donation = { status: 'not-consented', platform: null, uploads: [] };
  assert.ok(validatePayload(p).some((m) => m.includes('must not carry')));
  p.consent = null;
  p.identity.dateOfBirth = { day: '', month: '', year: '' };
  assert.deepEqual(validatePayload(p), []);
});

test('rejects unknown statements and bad shapes', () => {
  const p = valid() as unknown as Record<string, unknown>;
  (p.consent as Record<string, unknown>).responses = { evil: r('evil', 'agreed', 'individual') };
  assert.ok(validatePayload(p).some((m) => m.includes('unknown statement')));
  assert.ok(validatePayload('nope').length === 1);
});
