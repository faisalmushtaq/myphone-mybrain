import { childAssentForm, parentConsentForm, parentQuestionsForm, informationVersion, REFERENCE_CODE, study } from './forms.js';

/**
 * Server-side validation. Mirrors the browser rules in src/lib/validation.ts
 * but trusts nothing: shapes, lengths, enumerations, age range, statement
 * ids and versions, signatures and upload references.
 *
 * Two payloads arrive at different moments (see src/api/types.ts in the app):
 *   - the permission and agreement (validateConsentPayload), sent as soon as
 *     the young person has signed, declined or deferred, and again as an
 *     amendment when something is changed;
 *   - the screenshots (validateDonationPayload), sent from the screen-time
 *     screen and linked by the reference code.
 * Each function returns a list of plain-English problems; empty means accepted.
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

export interface ClientInfo {
  userAgent: string;
  submittedAt: string;
  timezoneOffset: number;
}

export interface ConsentPayload {
  kind: 'consent' | 'declined';
  /** Set when amending a record this session already sent. */
  referenceCode: string | null;
  studyId: string;
  siteId: string;
  route: 'parent' | 'young';
  identity: { firstName: string; lastName: string; dateOfBirth: { day: string; month: string; year: string }; schoolId: string; schoolOther: string; yearGroup: string };
  guardian: { fullName: string; relationship: string; relationshipOther: string; hasParentalResponsibility: boolean; wantsCopy: boolean; email: string; phone: string; postcode: string };
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
  /** The parent's quick questions; research data, never sent with a declined record. */
  survey: {
    formId: string;
    formVersion: string;
    status: 'not-started' | 'in-progress' | 'completed' | 'skipped';
    responses: Record<string, { questionId: string; version: string; value: string; answeredAt: string }>;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
  client: ClientInfo;
}

export interface DonationPayload {
  referenceCode: string;
  platform: string | null;
  uploads: { uploadId: string; redacted: boolean; cropped: boolean; acknowledgedWarning: boolean }[];
  /** The young person's agreement to share, given by sending when they signed in the app; null otherwise (it may be collected separately, on paper). */
  agreement: StatementRecord | null;
  client: ClientInfo;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const PHONE = /^\+?[\d\s()-]{7,20}$/;
const UUID = /^[0-9a-f-]{36}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RELATIONSHIPS = ['mother', 'father', 'step-parent', 'grandparent', 'foster-carer', 'legal-guardian', 'other'];
const PLATFORMS = ['ios', 'android', 'other'];
const limits = { name: 100, email: 254, phone: 20, postcode: 10, school: 150, relationship: 60 };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
const blank = (v: string) => v.trim().length === 0;
const validTime = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

function ageOn(dob: Date, today = new Date()): number {
  const age = today.getUTCFullYear() - dob.getUTCFullYear();
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
  if (!validTime(sig.capturedAt)) problems.push(`${who}: the signature has no valid time.`);
}

function validateStatement(r: unknown, served: { id: string; version: string }, who: string, problems: string[]): void {
  if (!isObj(r) || r.statementId !== served.id) {
    problems.push(`${who}: malformed response for "${served.id}".`);
    return;
  }
  if (r.version !== served.version) problems.push(`${who}: statement "${served.id}" was shown as version ${String(r.version)} but the current version is ${served.version}.`);
  if (r.response !== 'agreed' && r.response !== 'declined') problems.push(`${who}: statement "${served.id}" has no valid response.`);
  if (!validTime(r.respondedAt)) problems.push(`${who}: statement "${served.id}" has no valid time.`);
  if (!['individual', 'group', 'signature', 'action'].includes(String(r.via))) problems.push(`${who}: statement "${served.id}" has an unknown response method.`);
}

function validateResponses(responses: unknown, form: { id: string; statements: { id: string; version: string; kind: string }[] }, problems: string[], who: string): void {
  if (!isObj(responses)) {
    problems.push(`${who}: responses are missing.`);
    return;
  }
  for (const key of Object.keys(responses)) {
    const served = form.statements.find((s) => s.id === key);
    if (!served) {
      problems.push(`${who}: unknown statement "${key}".`);
      continue;
    }
    validateStatement(responses[key], served, who, problems);
  }
}

function validateClient(cl: unknown, problems: string[]): void {
  if (!isObj(cl) || !str(cl.userAgent, 400) || !validTime(cl.submittedAt) || typeof cl.timezoneOffset !== 'number') problems.push('Client information is malformed.');
}

export function validateConsentPayload(input: unknown): string[] {
  const problems: string[] = [];
  if (!isObj(input)) return ['The submission is not an object.'];
  const p = input as Partial<ConsentPayload>;

  if (p.kind !== 'consent' && p.kind !== 'declined') problems.push('Unknown submission kind.');
  if (p.referenceCode !== null && p.referenceCode !== undefined && (typeof p.referenceCode !== 'string' || !REFERENCE_CODE.test(p.referenceCode))) problems.push('The reference code is malformed.');
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
    if (id.schoolId === 'other' && (!str(id.schoolOther, limits.school) || (id.schoolOther as string).trim().length < study.schoolMin)) problems.push(`The school name needs at least ${study.schoolMin} letters.`);
    if (!str(id.yearGroup, 20)) problems.push('The year group is malformed.');
    if (p.kind === 'consent') {
      const dob = isObj(id.dateOfBirth) ? parseDate(id.dateOfBirth as ConsentPayload['identity']['dateOfBirth']) : null;
      if (!dob) problems.push('The date of birth is not a valid date.');
      else {
        const age = ageOn(dob);
        if (age < study.minAge || age > study.maxAge) problems.push(`The young person must be aged ${study.minAge} to ${study.maxAge}.`);
      }
    }
  }

  // Guardian. An email address is only needed when a copy was asked for.
  const g = p.guardian;
  if (!isObj(g)) problems.push('Parent or guardian details are missing.');
  else {
    if (!str(g.fullName, limits.name) || blank(g.fullName as string)) problems.push('The parent or guardian’s name is missing.');
    if (typeof g.relationship !== 'string' || !RELATIONSHIPS.includes(g.relationship)) problems.push('The relationship is not one of the allowed values.');
    if (g.relationship === 'other' && (!str(g.relationshipOther, limits.relationship) || blank(g.relationshipOther as string))) problems.push('The relationship description is missing.');
    if (p.kind === 'consent' && g.hasParentalResponsibility !== true) problems.push('Parental responsibility was not confirmed.');
    if (typeof g.wantsCopy !== 'boolean') problems.push('The copy preference is malformed.');
    if (!str(g.email, limits.email)) problems.push('The email address is malformed.');
    else if (g.wantsCopy === true && !EMAIL.test((g.email as string).trim())) problems.push('An email address is needed to send the copy.');
    else if (!blank(g.email as string) && !EMAIL.test((g.email as string).trim())) problems.push('The email address is not valid.');
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
      if (!validTime(c.completedAt)) problems.push('The permission record has no completion time.');
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
      for (const sid of childAssentForm.signed) {
        if (responses[sid]?.response !== 'agreed' || responses[sid]?.via !== 'signature') problems.push(`Agreement statement "${sid}" was not signed.`);
      }
      validateSignature(a.signature, 'Agreement', problems);
      if (!validTime(a.completedAt)) problems.push('The agreement has no completion time.');
    } else if (a.status === 'deferred') {
      if (a.deferredBy !== 'parent' && a.deferredBy !== 'young') problems.push('A deferred agreement must say who deferred it.');
    } else if (a.status === 'not-started') {
      problems.push('The agreement was not completed, deferred or declined.');
    }
  }

  // The parent's quick questions (optional; only with a permission record)
  const sv = p.survey;
  if (p.kind === 'declined') {
    if (sv !== null && sv !== undefined) problems.push('A declined submission must not carry the questions.');
  } else if (sv !== null && sv !== undefined) {
    if (!isObj(sv)) problems.push('The questions record is malformed.');
    else {
      if (sv.formId !== parentQuestionsForm.id || sv.formVersion !== parentQuestionsForm.version) problems.push(`The questions form must be ${parentQuestionsForm.id} ${parentQuestionsForm.version}.`);
      if (!['not-started', 'in-progress', 'completed', 'skipped'].includes(String(sv.status))) problems.push('Unknown questions status.');
      if (!isObj(sv.responses)) problems.push('Question responses are missing.');
      else {
        for (const key of Object.keys(sv.responses)) {
          const q = parentQuestionsForm.questions.find((qq) => qq.id === key);
          const r = sv.responses[key];
          if (!q) {
            problems.push(`Unknown question "${key}".`);
            continue;
          }
          if (!isObj(r)) {
            problems.push(`Malformed answer for "${key}".`);
            continue;
          }
          const valueOk = q.type === 'text' ? typeof r.value === 'string' && !blank(r.value) && r.value.length <= q.maxLength : q.options.includes(String(r.value));
          if (r.questionId !== key || !valueOk || !validTime(r.answeredAt)) problems.push(`Malformed answer for "${key}".`);
          else if (r.version !== q.version) problems.push(`Question "${key}" was shown as version ${String(r.version)} but the current version is ${q.version}.`);
        }
      }
      if (sv.startedAt !== null && !validTime(sv.startedAt)) problems.push('The questions record has no valid start time.');
      if (sv.completedAt !== null && !validTime(sv.completedAt)) problems.push('The questions record has no valid completion time.');
    }
  }

  validateClient(p.client, problems);
  return problems;
}

export function validateDonationPayload(input: unknown): string[] {
  const problems: string[] = [];
  if (!isObj(input)) return ['The submission is not an object.'];
  const p = input as Partial<DonationPayload>;

  if (typeof p.referenceCode !== 'string' || !REFERENCE_CODE.test(p.referenceCode)) problems.push('The reference code is missing or malformed.');
  if (p.platform !== null && !PLATFORMS.includes(String(p.platform))) problems.push('Unknown phone platform.');

  if (!Array.isArray(p.uploads)) problems.push('Uploads are malformed.');
  else {
    if (p.uploads.length === 0) problems.push('No images were sent.');
    if (p.uploads.length > study.maxImages) problems.push(`At most ${study.maxImages} images can be sent.`);
    const seen = new Set<string>();
    for (const u of p.uploads) {
      if (!isObj(u) || typeof u.uploadId !== 'string' || !UUID.test(u.uploadId) || typeof u.redacted !== 'boolean' || typeof u.cropped !== 'boolean' || typeof u.acknowledgedWarning !== 'boolean') {
        problems.push('An upload reference is malformed.');
        continue;
      }
      if (seen.has(u.uploadId)) problems.push('An image was listed twice.');
      seen.add(u.uploadId);
    }
  }

  // The young person's agreement travels with the screenshots when they signed in the app; otherwise it is collected separately and nothing waits for it.
  const served = childAssentForm.statements.find((s) => s.id === 'phone-use');
  const a = p.agreement;
  if (a !== null && a !== undefined) {
    if (!isObj(a) || !served) problems.push('The young person’s agreement record is malformed.');
    else {
      validateStatement(a, served, 'Agreement', problems);
      if (a.response !== 'agreed' || a.via !== 'action') problems.push('The young person’s agreement record is malformed.');
    }
  }

  validateClient(p.client, problems);
  return problems;
}
