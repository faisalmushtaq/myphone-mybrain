import { generated } from './generated/forms.js';

/**
 * The statement forms the server currently accepts. A submission must carry
 * exactly these ids and versions; anything else is rejected, so old or
 * tampered wording can never be recorded as agreed.
 *
 * Everything here is derived at build time from the app's own configuration
 * (consent-app/src/config/statements.ts, questions.ts and copy.ts) by
 * scripts/generate-forms.mjs, so wording and versions are edited in one
 * place and the app, the server and the export's data dictionaries agree.
 */
export interface ServedStatement {
  id: string;
  version: string;
  kind: 'required' | 'optional';
}

const served = (s: { id: string; version: string; kind: string }): ServedStatement => ({ id: s.id, version: s.version, kind: s.kind as ServedStatement['kind'] });

export const parentConsentForm = {
  id: generated.parentConsentForm.id,
  version: generated.parentConsentForm.version,
  statements: generated.parentConsentForm.statements.map(served),
};

export const childAssentForm = {
  id: generated.childAssentForm.id,
  version: generated.childAssentForm.version,
  /** Agreed to by the young person's signature. */
  signed: generated.childAssentForm.statements.filter((s) => s.coveredBySignature).map((s) => s.id as string),
  /** Agreed to by sending screenshots. */
  byAction: generated.childAssentForm.statements.filter((s) => !s.coveredBySignature).map((s) => s.id as string),
  statements: generated.childAssentForm.statements.map(served),
};

export const informationVersion: string = generated.informationVersion;

/** The parent's quick questions (src/config/questions.ts in the app). */
export type ServedQuestion = { id: string; version: string; type: 'choice'; options: string[] } | { id: string; version: string; type: 'text'; maxLength: number };

export const parentQuestionsForm = {
  id: generated.parentQuestionsForm.id,
  version: generated.parentQuestionsForm.version,
  questions: generated.parentQuestionsForm.questions.map((q): ServedQuestion => (q.type === 'choice' ? { id: q.id, version: q.version, type: 'choice', options: q.options.map((o) => o.value as string) } : { id: q.id, version: q.version, type: 'text', maxLength: q.maxLength })),
};

/** The questions' wording and answer labels, for the exported data dictionary. {child} stands for the young person's name. */
export const questionWording: Record<string, { text: string; labels?: Record<string, string> }> = Object.fromEntries(
  generated.parentQuestionsForm.questions.map((q) => [q.id, { text: q.text as string, labels: q.type === 'choice' ? Object.fromEntries(q.options.map((o) => [o.value, o.label as string])) : undefined }]),
);

/** The statements' wording by form and id, for the exported consent tables. */
export const statementWording: Record<string, Record<string, { label: string; text: string }>> = {
  [generated.parentConsentForm.id]: Object.fromEntries(generated.parentConsentForm.statements.map((s) => [s.id, { label: s.label as string, text: s.text as string }])),
  [generated.childAssentForm.id]: Object.fromEntries(generated.childAssentForm.statements.map((s) => [s.id, { label: s.label as string, text: s.text as string }])),
};

export const study = {
  studyId: 'MPMB',
  siteIds: ['LEEDS-BRADFORD'],
  minAge: 11,
  maxAge: 17,
  maxImages: 6,
  maxSignatureBytes: 200 * 1024,
  /** Shortest school name accepted when "another school" is typed in. */
  schoolMin: 3,
};

/** Shape of the reference codes issued by submitConsent. */
export const REFERENCE_CODE = /^MPMB-[A-Z2-9]{4}-[A-Z2-9]{3}$/;
