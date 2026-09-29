import { childAssentForm, parentConsentForm, informationVersion, study } from './forms.js';

/**
 * Server-side validation of a submission. Mirrors the browser rules in
 * src/lib/validation.ts but trusts nothing: shapes, lengths, enumerations,
 * age range, statement ids and versions, signatures and upload references.
 * Returns a list of plain-English problems; an empty list means accepted.
 */
export interface StatementRecord {
  statementId: string;
  version: string;
  response: 'agreed' | 'declined';
  respondedAt: string;
  via: 'individual' | 'group' | 'signature' | 'action';
}

export interface SignatureRecord {
  method: 'drawn' | 'typed';
  imageDataUrl: string | null;
  typedName: string | null;
  strokeCount: number;
  pointerType: string | null;
  capturedAt: string;
}

export interface Payload {
  kind: 'consent' | 'declined';
  studyId: string;
  siteId: string;
  route: 'parent' | 'young';
  identity: { firstName: string; lastName: string; dateOfBirth: { day: string; month: string; year: string }; schoolId: string; schoolOther: string; yearGroup: string };
  guardian: { fullName: string; relationship: string; relationshipOther: string; hasParentalResponsibility: boolean; email: string; phone: string; postcode: string };
  consent: {
    formId: string;
    formVersion: string;
    informationVersion: string | null;
    responses: Record<string, StatementRecord>;
    typedName: string;
    signature: SignatureRecord | null;
    confirmedDate: string;
    completedAt: string | null;
    revisedAt: string | null;
  } | null;
  assent: {
    formId: string;
    formVersion: string;
    status: 'not-started' | 'completed' | 'deferred' | 'declined';
    deferredBy: 'parent' | 'young' | null;
    responses: Record<string, StatementRecord>;
    signature: SignatureRecord | null;
    handoverConfirmedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
  };
  donation: { status: string; platform: string | null; uploads: { uploadId: string; redacted: boolean; cropped: boolean }[] };
  client: { userAgent: string; submittedAt: string; timezoneOffset: number };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const PHONE = /^\+?[\d\s()-]{7,20}$/;
const UUID = /^[0-9a-f-]{36}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RELATIONSHIPS = ['mother', 'father', 'step-parent', 'grandparent', 'foster-carer', 'legal-guardian', 'other'];
const PLATFORMS = ['ios', 'android', 'other'];
const DONATION_STATUSES = ['not-started', 'in-progress', 'completed', 'skipped', 'not-consented', 'deferred'];
const limits = { name: 100, email: 254, phone: 20, postcode: 10, school: 150, relationship: 60 };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
const blank = (v: string) => v.trim().length === 0;

function ageOn(dob: Date, today = new Date()): number {
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const before = today.getUTCMonth() < dob.getUTCMonth() || (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate());
  return before ? age - 1 : age;
}

export function parseDate(parts: { day: string; month: string; year: string }): Date | null {
  const d = Number(parts.day);
  const m = Number(parts.month);
  const y = Number(parts.year);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y) || parts.year.length !== 4) return null;
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

function validateSignature(sig: unknown, who: string, problems: string[]): void {
  if (!isObj(sig)) {
    problems.push(`${who}: signature is missing.`);
    return;
  }
  if (sig.method === 'drawn') {
    if (typeof sig.imageDataUrl !== 'string' || !sig.imageDataUrl.startsWith('data:image/png;base64,')) problems.push(`${who}: the drawn signature is not a PNG image.`);
    else if (sig.imageDataUrl.length > study.maxSignatureBytes * 1.4) problems.push(`${who}: the signature image is too large.`);
    if (typeof sig.strokeCount !== 'number' || sig.strokeCount < 1) problems.push(`${who}: the signature is empty.`);
  } else if (sig.method === 'typed') {
    if (!str(sig.typedName, limits.name) || blank(sig.typedName as string)) problems.push(`${who}: the typed signature is empty.`);
  } else {
    problems.push(`${who}: unknown signature method.`);
  }
  if (typeof sig.capturedAt !== 'string' || Number.isNaN(Date.parse(sig.capturedAt))) problems.push(`${who}: the signature has no valid time.`);
}

function validateResponses(responses: unknown, form: { id: string; statements: { id: string; version: string; kind: string }[] }, problems: string[], who: string): void {
  if (!isObj(responses)) {
    problems.push(`${who}: responses are missing.`);
    return;
  }
  for (const key of Object.keys(responses)) {
    const served = form.statements.find((s) => s.id === key);
    const r = responses[key];
    if (!served) {
      problems.push(`${who}: unknown statement "${key}".`);
      continue;
    }
    if (!isObj(r) || r.statementId !== key) {
      problems.push(`${who}: malformed response for "${key}".`);
      continue;
    }
    if (r.version !== served.version) problems.push(`${who}: statement "${key}" was shown as version ${String(r.version)} but the current version is ${served.version}.`);
    if (r.response !== 'agreed' && r.response !== 'declined') problems.push(`${who}: statement "${key}" has no valid response.`);
    if (typeof r.respondedAt !== 'string' || Number.isNaN(Date.parse(r.respondedAt))) problems.push(`${who}: statement "${key}" has no valid time.`);
    if (!['individual', 'group', 'signature', 'action'].includes(String(r.via))) problems.push(`${who}: statement "${key}" has an unknown response method.`);
  }
}

export function validatePayload(input: unknown): string[] {
  const problems: string[] = [];
  if (!isObj(input)) return ['The submission is not an object.'];
  const p = input as Partial<Payload>;

  if (p.kind !== 'consent' && p.kind !== 'declined') problems.push('Unknown submission kind.');
  if (p.studyId !== study.studyId) problems.push('Unknown study.');
  if (typeof p.siteId !== 'string' || !study.siteIds.includes(p.siteId)) problems.push('Unknown site.');
  if (p.route !== 'parent' && p.route !== 'young') problems.push('Unknown route.');

  // Identity
  const id = p.identity;
  if (!isObj(id)) problems.push('Young person’s details are missing.');
  else {
    if (!str(id.firstName, limits.name) || blank(id.firstName as string)) problems.push('The young person’s first name is missing.');
    if (!str(id.lastName, limits.name) || blank(id.lastName as string)) problems.push('The young person’s last name is missing.');
    if (!str(id.schoolId, 40) || blank(id.schoolId as string)) problems.push('The school is missing.');
    if (id.schoolId === 'other' && (!str(id.schoolOther, limits.school) || blank(id.schoolOther as string))) problems.push('The school name is missing.');
    if (!str(id.yearGroup, 20)) problems.push('The year group is malformed.');
    if (p.kind === 'consent') {
      const dob = isObj(id.dateOfBirth) ? parseDate(id.dateOfBirth as Payload['identity']['dateOfBirth']) : null;
      if (!dob) problems.push('The date of birth is not a valid date.');
      else {
        const age = ageOn(dob);
        if (age < study.minAge || age > study.maxAge) problems.push(`The young person must be aged ${study.minAge} to ${study.maxAge}.`);
      }
    }
  }

  // Guardian
  const g = p.guardian;
  if (!isObj(g)) problems.push('Parent or guardian details are missing.');
  else {
    if (!str(g.fullName, limits.name) || blank(g.fullName as string)) problems.push('The parent or guardian’s name is missing.');
    if (typeof g.relationship !== 'string' || !RELATIONSHIPS.includes(g.relationship)) problems.push('The relationship is not one of the allowed values.');
    if (g.relationship === 'other' && (!str(g.relationshipOther, limits.relationship) || blank(g.relationshipOther as string))) problems.push('The relationship description is missing.');
    if (p.kind === 'consent' && g.hasParentalResponsibility !== true) problems.push('Parental responsibility was not confirmed.');
    if (!str(g.email, limits.email) || !EMAIL.test((g.email as string).trim())) problems.push('The email address is not valid.');
    if (!str(g.phone, limits.phone) || (!blank(g.phone as string) && !PHONE.test((g.phone as string).trim()))) problems.push('The phone number is not valid.');
    if (!str(g.postcode, limits.postcode) || (!blank(g.postcode as string) && !UK_POSTCODE.test((g.postcode as string).trim()))) problems.push('The postcode is not valid.');
  }

  // Consent record
  if (p.kind === 'consent') {
    const c = p.consent;
    if (!isObj(c)) problems.push('The permission record is missing.');
    else {
      if (c.formId !== parentConsentForm.id || c.formVersion !== parentConsentForm.version) problems.push(`The permission form must be ${parentConsentForm.id} ${parentConsentForm.version}.`);
      if (c.informationVersion !== informationVersion) problems.push(`The information shown must be version ${informationVersion}.`);
      validateResponses(c.responses, parentConsentForm, problems, 'Permission');
      const responses = isObj(c.responses) ? (c.responses as Record<string, StatementRecord>) : {};
      for (const s of parentConsentForm.statements) {
        const r = responses[s.id];
        if (s.kind === 'required' && r?.response !== 'agreed') problems.push(`Required statement "${s.id}" was not agreed.`);
        if (s.kind === 'optional' && !r) problems.push(`Optional statement "${s.id}" was not answered.`);
      }
      if (!str(c.typedName, limits.name) || blank(c.typedName as string)) problems.push('The signer’s name is missing.');
      validateSignature(c.signature, 'Permission', problems);
      if (typeof c.confirmedDate !== 'string' || !ISO_DATE.test(c.confirmedDate) || Date.parse(c.confirmedDate) > Date.now() + 24 * 3600 * 1000) problems.push('The confirmed date is not valid.');
      if (typeof c.completedAt !== 'string' || Number.isNaN(Date.parse(c.completedAt))) problems.push('The permission record has no completion time.');
    }
  } else if (p.consent !== null && p.consent !== undefined) {
    problems.push('A declined submission must not carry a permission record.');
  }

  // Assent record
  const a = p.assent;
  if (!isObj(a)) problems.push('The agreement record is missing.');
  else {
    if (a.formId !== childAssentForm.id || a.formVersion !== childAssentForm.version) problems.push(`The agreement form must be ${childAssentForm.id} ${childAssentForm.version}.`);
    if (!['not-started', 'completed', 'deferred', 'declined'].includes(String(a.status))) problems.push('Unknown agreement status.');
    validateResponses(a.responses, childAssentForm, problems, 'Agreement');
    const responses = isObj(a.responses) ? (a.responses as Record<string, StatementRecord>) : {};
    if (p.kind === 'declined') {
      if (a.status !== 'declined' || responses['take-part']?.response !== 'declined') problems.push('A declined submission must carry a declined agreement.');
    } else if (a.status === 'declined') {
      problems.push('A declined agreement must be sent as a declined submission.');
    } else if (a.status === 'completed') {
      for (const id of childAssentForm.signed) {
        if (responses[id]?.response !== 'agreed' || responses[id]?.via !== 'signature') problems.push(`Agreement statement "${id}" was not signed.`);
      }
      validateSignature(a.signature, 'Agreement', problems);
      if (typeof a.completedAt !== 'string' || Number.isNaN(Date.parse(a.completedAt))) problems.push('The agreement has no completion time.');
    } else if (a.status === 'deferred') {
      if (a.deferredBy !== 'parent' && a.deferredBy !== 'young') problems.push('A deferred agreement must say who deferred it.');
    } else if (a.status === 'not-started') {
      problems.push('The agreement was not completed, deferred or declined.');
    }
  }

  // Donation
  const d = p.donation;
  if (!isObj(d)) problems.push('The screen-time record is missing.');
  else {
    if (!DONATION_STATUSES.includes(String(d.status))) problems.push('Unknown screen-time status.');
    if (d.platform !== null && !PLATFORMS.includes(String(d.platform))) problems.push('Unknown phone platform.');
    if (!Array.isArray(d.uploads)) problems.push('Uploads are malformed.');
    else {
      if (d.uploads.length > study.maxImages) problems.push(`At most ${study.maxImages} images can be sent.`);
      for (const u of d.uploads) {
        if (!isObj(u) || typeof u.uploadId !== 'string' || !UUID.test(u.uploadId) || typeof u.redacted !== 'boolean' || typeof u.cropped !== 'boolean') problems.push('An upload reference is malformed.');
      }
      if (d.status === 'completed' && d.uploads.length === 0) problems.push('The screen-time record says completed but has no images.');
      if (d.status !== 'completed' && d.uploads.length > 0) problems.push('Images were sent without the screen-time record being completed.');
      if (d.uploads.length > 0 && p.kind === 'consent') {
        const parentYes = isObj(p.consent) && isObj(p.consent.responses) && (p.consent.responses as Record<string, StatementRecord>)['phone-use']?.response === 'agreed';
        const youngYes = isObj(a) && isObj(a.responses) && (a.responses as Record<string, StatementRecord>)['phone-use']?.response === 'agreed';
        if (!parentYes) problems.push('Images were sent without the parent or guardian agreeing to screen-time screenshots.');
        if (!youngYes) problems.push('Images were sent without the young person agreeing to screen-time screenshots.');
      }
    }
  }

  // Client
  const cl = p.client;
  if (!isObj(cl) || !str(cl.userAgent, 400) || typeof cl.submittedAt !== 'string' || Number.isNaN(Date.parse(cl.submittedAt)) || typeof cl.timezoneOffset !== 'number') problems.push('Client information is malformed.');

  return problems;
}
