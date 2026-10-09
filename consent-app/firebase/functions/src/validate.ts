import { childAssentForm, earlierInformationVersions, parentConsentForm, parentMoreForm, parentQuestionsForm, informationVersion, REFERENCE_CODE, study, type ServedQuestionForm } from './forms.js';

/**
 * Server-side validation. Mirrors the browser rules in src/lib/validation.ts
 * but trusts nothing: shapes, lengths, enumerations, age range, statement
 * ids and versions, signatures and upload references.
 *
 * Two payloads arrive at different moments (see src/api/types.ts in the app):
 *   - the record (validateConsentPayload): the parent's permission and
 *     answers, and the young person's agreement when they are asked for it,
 *     sent from the moment the parent signs (or a young person of 16 or over on
 *     their own agrees) and again as answers are added or changed, so what
 *     a family gives counts even if they stop part-way (decided 7 October
 *     2026). Since 7 October 2026 the workshop is opt-out (by
 *     email) and this form is the opt-in for screen time: young people of
 *     16 or over decide alone (no parent, no permission record); for
 *     under-16s the parent's yes comes first, and the screen time comes from
 *     the parent's own phone, the young person's (with their agreement), or
 *     nowhere (the parent answers the longer questions instead);
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

export type SurveyPayload = {
  formId: string;
  formVersion: string;
  status: 'not-started' | 'in-progress' | 'completed' | 'skipped';
  responses: Record<string, { questionId: string; version: string; value: string; answeredAt: string }>;
  startedAt: string | null;
  completedAt: string | null;
};

/** Where the young person's screen time comes from: their own phone, the parent's family view, or nowhere. */
export type PhoneSource = 'parent' | 'child' | 'none' | 'no-phone';

export interface ConsentPayload {
  kind: 'consent';
  /** Set when amending a record this session already sent. */
  referenceCode: string | null;
  studyId: string;
  siteId: string;
  route: 'parent' | 'young';
  identity: { firstName: string; lastName: string; dateOfBirth: { day: string; month: string; year: string }; schoolId: string; schoolOther: string; yearGroup: string; postcode?: string };
  /** The home address and postcode are required (7 October 2026); email and phone are optional. No parental-responsibility tick: only a parent or carer fills it in. */
  guardian: { fullName: string; relationship: string; relationshipOther: string; address: string; postcode: string; email: string; phone: string; uprn?: string };
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
  /** The parent's quick questions; null when a young person decides alone. */
  survey: SurveyPayload | null;
  phoneSource: PhoneSource | null;
  /** The parent's longer questions, when the screen time is not coming through the form. */
  more: SurveyPayload | null;
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
export const UUID = /^[0-9a-f-]{36}$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RELATIONSHIPS = ['mother', 'father', 'step-parent', 'grandparent', 'foster-carer', 'legal-guardian', 'other'];
const PLATFORMS = ['ios', 'android', 'other'];
export const limits = { name: 100, email: 254, phone: 20, postcode: 10, address: 200, school: 150, relationship: 60 };

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
export const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
export const blank = (v: string) => v.trim().length === 0;
export const validTime = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

export function ageOn(dob: Date, today = new Date()): number {
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

export function validateSignature(sig: unknown, who: string, problems: string[]): void {
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

export function validateStatement(r: unknown, served: { id: string; version: string }, who: string, problems: string[]): void {
  if (!isObj(r) || r.statementId !== served.id) {
    problems.push(`${who}: malformed response for "${served.id}".`);
    return;
  }
  if (r.version !== served.version) problems.push(`${who}: statement "${served.id}" was shown as version ${String(r.version)} but the current version is ${served.version}.`);
  if (r.response !== 'agreed' && r.response !== 'declined') problems.push(`${who}: statement "${served.id}" has no valid response.`);
  if (!validTime(r.respondedAt)) problems.push(`${who}: statement "${served.id}" has no valid time.`);
  if (!['individual', 'group', 'signature', 'action'].includes(String(r.via))) problems.push(`${who}: statement "${served.id}" has an unknown response method.`);
}

export function validateResponses(responses: unknown, form: { id: string; statements: { id: string; version: string; kind: string }[] }, problems: string[], who: string): void {
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

export function validateClient(cl: unknown, problems: string[]): void {
  if (!isObj(cl) || !str(cl.userAgent, 400) || !validTime(cl.submittedAt) || typeof cl.timezoneOffset !== 'number') problems.push('Client information is malformed.');
}

/** More than one answer: values from the list, each once, joined by ";"; "I don't know" stands alone. */
function validMulti(value: unknown, options: string[]): boolean {
  if (typeof value !== 'string' || value.length > 500) return false;
  const parts = value.split(';');
  return parts.length > 0 && parts.every((p) => options.includes(p)) && new Set(parts).size === parts.length && (parts.length === 1 || !parts.includes('unsure'));
}

/** One of the parent's question forms: the right form and version, known questions, answers from the list (or short text), valid times. */
function validateSurvey(sv: unknown, form: ServedQuestionForm, what: string, problems: string[]): void {
  if (!isObj(sv)) {
    problems.push(`The ${what} record is malformed.`);
    return;
  }
  if (sv.formId !== form.id || sv.formVersion !== form.version) problems.push(`The ${what} form must be ${form.id} ${form.version}.`);
  if (!['not-started', 'in-progress', 'completed', 'skipped'].includes(String(sv.status))) problems.push(`Unknown ${what} status.`);
  if (!isObj(sv.responses)) problems.push(`The ${what} responses are missing.`);
  else {
    for (const key of Object.keys(sv.responses)) {
      const q = form.questions.find((qq) => qq.id === key);
      const r = sv.responses[key];
      if (!q) {
        problems.push(`Unknown question "${key}".`);
        continue;
      }
      if (!isObj(r)) {
        problems.push(`Malformed answer for "${key}".`);
        continue;
      }
      const valueOk = q.type === 'text' ? typeof r.value === 'string' && !blank(r.value) && r.value.length <= q.maxLength : q.type === 'multi' ? validMulti(r.value, q.options) : q.options.includes(String(r.value));
      if (r.questionId !== key || !valueOk || !validTime(r.answeredAt)) problems.push(`Malformed answer for "${key}".`);
      else if (r.version !== q.version) problems.push(`Question "${key}" was shown as version ${String(r.version)} but the current version is ${q.version}.`);
    }
  }
  if (sv.startedAt !== null && !validTime(sv.startedAt)) problems.push(`The ${what} record has no valid start time.`);
  if (sv.completedAt !== null && !validTime(sv.completedAt)) problems.push(`The ${what} record has no valid completion time.`);
}

/** Who decides about the screen time, worked out from the record itself: 16 or over decides alone. */
export function selfConsentOf(payload: Pick<ConsentPayload, 'identity'>, today = new Date()): boolean {
  const dob = isObj(payload.identity) && isObj(payload.identity.dateOfBirth) ? parseDate(payload.identity.dateOfBirth) : null;
  return study.selfConsentAge !== null && dob !== null && ageOn(dob, today) >= study.selfConsentAge;
}

export function validateConsentPayload(input: unknown): string[] {
  const problems: string[] = [];
  if (!isObj(input)) return ['The submission is not an object.'];
  const p = input as Partial<ConsentPayload>;

  // Since the workshop became opt-out (7 October 2026) there is no "declined" record: a young person who says no to sharing is part of the parent's record, or nothing is sent.
  if (p.kind !== 'consent') problems.push('Unknown submission kind.');
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
    const dob = isObj(id.dateOfBirth) ? parseDate(id.dateOfBirth as ConsentPayload['identity']['dateOfBirth']) : null;
    if (!dob) problems.push('The date of birth is not a valid date.');
    else {
      const age = ageOn(dob);
      if (age < study.minAge || age > study.maxAge) problems.push(`The young person must be aged ${study.minAge} to ${study.maxAge}.`);
    }
  }
  const selfConsent = isObj(id) ? selfConsentOf(p as ConsentPayload) : false;
  const alone = selfConsent && p.route === 'young';
  // A young person doing this on their own gives their home postcode (decided 8 October 2026), for matching their records; anyone else's comes from the parent.
  if (isObj(id)) {
    const postcode = id.postcode ?? '';
    if (typeof postcode !== 'string' || postcode.length > limits.postcode) problems.push('The postcode is malformed.');
    else if (alone && blank(postcode)) problems.push('The young person’s postcode is missing.');
    else if (alone && !UK_POSTCODE.test(postcode.trim())) problems.push('The young person’s postcode is not valid.');
    else if (!alone && !blank(postcode)) problems.push('Only a young person deciding alone gives their own postcode.');
  }

  // Guardian: none when a young person of 16 or over decides alone. The email address is optional; when given it must be valid. Nothing is emailed to families.
  const g = p.guardian;
  if (!isObj(g)) problems.push('Parent or carer details are missing.');
  else if (alone) {
    if (!blank(String(g.fullName ?? '')) || !blank(String(g.email ?? '')) || !blank(String(g.phone ?? '')) || !blank(String(g.postcode ?? '')) || !blank(String(g.address ?? '')) || !blank(String(g.uprn ?? ''))) problems.push('A young person deciding alone sends no parent or carer details.');
  } else {
    if (!str(g.fullName, limits.name) || blank(g.fullName as string)) problems.push('The parent or carer’s name is missing.');
    if (typeof g.relationship !== 'string' || !RELATIONSHIPS.includes(g.relationship)) problems.push('The relationship is not one of the allowed values.');
    if (g.relationship === 'other' && (!str(g.relationshipOther, limits.relationship) || blank(g.relationshipOther as string))) problems.push('The relationship description is missing.');
    if (!str(g.address, limits.address) || blank(g.address as string)) problems.push('The home address is missing.');
    if (!str(g.email, limits.email)) problems.push('The email address is malformed.');
    else if (!blank(g.email as string) && !EMAIL.test((g.email as string).trim())) problems.push('The email address is not valid.');
    if (!str(g.phone, limits.phone) || (!blank(g.phone as string) && !PHONE.test((g.phone as string).trim()))) problems.push('The phone number is not valid.');
    if (!str(g.postcode, limits.postcode) || blank(g.postcode as string)) problems.push('The postcode is missing.');
    else if (!UK_POSTCODE.test((g.postcode as string).trim())) problems.push('The postcode is not valid.');
    // Only from the address finder: the property's UPRN, up to 12 digits.
    if (g.uprn !== undefined && g.uprn !== null && g.uprn !== '' && !(typeof g.uprn === 'string' && /^\d{1,12}$/.test(g.uprn))) problems.push('The property reference is not valid.');
  }

  // The parent's permission: none when deciding alone; otherwise the statements asked at this age, signed.
  const c = p.consent;
  if (alone) {
    if (c !== null && c !== undefined) problems.push('A young person deciding alone sends no permission record.');
  } else if (!isObj(c)) problems.push('The permission record is missing.');
  else {
    if (c.formId !== parentConsentForm.id || c.formVersion !== parentConsentForm.version) problems.push(`The permission form must be ${parentConsentForm.id} ${parentConsentForm.version}.`);
    // The current information, or a recent earlier version for a family who signed before an update reached them.
    if (c.informationVersion !== informationVersion && !earlierInformationVersions.includes(String(c.informationVersion))) problems.push(`The information shown must be version ${informationVersion}.`);
    validateResponses(c.responses, parentConsentForm, problems, 'Permission');
    const responses = isObj(c.responses) ? (c.responses as Record<string, StatementRecord>) : {};
    for (const s of parentConsentForm.statements) {
      const r = responses[s.id];
      if (s.underSelfConsentAge && selfConsent) {
        if (r) problems.push(`Statement "${s.id}" is not asked when the young person is ${study.selfConsentAge} or over: they decide for themselves.`);
        continue;
      }
      if (s.kind === 'required' && r?.response !== 'agreed') problems.push(`Required statement "${s.id}" was not agreed.`);
      if (s.kind === 'optional' && !r) problems.push(`Optional statement "${s.id}" was not answered.`);
    }
    if (!str(c.typedName, limits.name) || blank(c.typedName as string)) problems.push('The signer’s name is missing.');
    validateSignature(c.signature, 'Permission', problems);
    if (typeof c.confirmedDate !== 'string' || !ISO_DATE.test(c.confirmedDate) || Date.parse(c.confirmedDate) > Date.now() + 24 * 3600 * 1000) problems.push('The confirmed date is not valid.');
    if (!validTime(c.completedAt)) problems.push('The permission record has no completion time.');
  }

  // Where the screen time comes from: 16 or over, their own phone; under 16, the parent's answer on the "where from" step (since 7 October 2026 the permission has no screenshots question), which is null until it is given: the record is saved from the moment the parent signs.
  const source: PhoneSource | null = selfConsent ? 'child' : p.phoneSource === 'parent' || p.phoneSource === 'child' || p.phoneSource === 'none' || p.phoneSource === 'no-phone' ? p.phoneSource : null;
  // The parent's own phone is offered only on the parent's route: on the young person's, it is their phone or none.
  if ((p.phoneSource ?? null) !== source || (p.route === 'young' && source === 'parent')) problems.push('Where the screen time comes from does not match the answers.');

  // The young person's agreement: asked whenever the screenshots are to come from their phone.
  const a = p.assent;
  if (!isObj(a)) problems.push('The agreement record is missing.');
  else {
    if (a.formId !== childAssentForm.id || a.formVersion !== childAssentForm.version) problems.push(`The agreement form must be ${childAssentForm.id} ${childAssentForm.version}.`);
    if (!['not-started', 'completed', 'deferred', 'declined'].includes(String(a.status))) problems.push('Unknown agreement status.');
    validateResponses(a.responses, childAssentForm, problems, 'Agreement');
    const responses = isObj(a.responses) ? (a.responses as Record<string, StatementRecord>) : {};
    // Otherwise the record is saved from the moment the parent signs, before the young person answers (or is asked).
    if (alone && a.status !== 'completed') problems.push('A young person deciding alone sends their record only once they have agreed.');
    if (a.status === 'completed') {
      for (const sid of childAssentForm.signed) {
        if (responses[sid]?.response !== 'agreed' || responses[sid]?.via !== 'signature') problems.push(`Agreement statement "${sid}" was not signed.`);
      }
      validateSignature(a.signature, 'Agreement', problems);
      if (!validTime(a.completedAt)) problems.push('The agreement has no completion time.');
    } else if (a.status === 'deferred') {
      if (a.deferredBy !== 'parent' && a.deferredBy !== 'young') problems.push('A deferred agreement must say who deferred it.');
    } else if (a.status === 'declined') {
      if (responses['take-part']?.response !== 'declined') problems.push('A declined agreement must record the young person’s no.');
    }
  }

  // The parent's questions: none when deciding alone.
  for (const [value, form, what] of [
    [p.survey, parentQuestionsForm, 'questions'],
    [p.more, parentMoreForm, 'longer questions'],
  ] as const) {
    if (value === null || value === undefined) continue;
    if (alone) problems.push(`A young person deciding alone sends no ${what}.`);
    else validateSurvey(value, form, what, problems);
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

  // The young person's agreement travels with the screenshots from their own phone; the parent's family view needs none.
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
