/**
 * The statement forms the server currently accepts. A submission must carry
 * exactly these ids and versions; anything else is rejected, so old or
 * tampered wording can never be recorded as agreed.
 *
 * KEEP IN STEP WITH src/config/statements.ts and src/config/copy.ts in the
 * app. The emulator test (scripts/emulator-e2e.mjs) fails if they drift.
 */
export interface ServedStatement {
  id: string;
  version: string;
  kind: 'required' | 'optional';
}

export const parentConsentForm = {
  id: 'mpmb-parent-consent',
  version: '0.5-draft',
  statements: [
    { id: 'read-information', version: '0.3-draft', kind: 'required' },
    { id: 'take-part', version: '0.3-draft', kind: 'required' },
    { id: 'understand-withdraw', version: '0.3-draft', kind: 'required' },
    { id: 'records-checked', version: '0.3-draft', kind: 'required' },
    { id: 'phone-use', version: '0.4-draft', kind: 'optional' },
    { id: 'link-records', version: '0.4-draft', kind: 'optional' },
    { id: 'recontact', version: '0.3-draft', kind: 'optional' },
  ] as ServedStatement[],
};

export const childAssentForm = {
  id: 'mpmb-child-assent',
  version: '0.4-draft',
  /** Agreed to by the young person's signature. */
  signed: ['understand', 'can-stop', 'take-part'],
  /** Agreed to by sending screenshots. */
  byAction: ['phone-use'],
  statements: [
    { id: 'understand', version: '0.3-draft', kind: 'required' },
    { id: 'can-stop', version: '0.3-draft', kind: 'required' },
    { id: 'take-part', version: '0.3-draft', kind: 'required' },
    { id: 'phone-use', version: '0.4-draft', kind: 'optional' },
  ] as ServedStatement[],
};

export const informationVersion = '0.3-draft';

/** The parent's quick questions (src/config/questions.ts in the app). */
export type ServedQuestion = { id: string; version: string; type: 'choice'; options: string[] } | { id: string; version: string; type: 'text'; maxLength: number };

export const parentQuestionsForm = {
  id: 'mpmb-parent-perceptions',
  version: '0.2-draft',
  questions: [
    { id: 'concern', version: '0.1-draft', type: 'choice', options: ['not-at-all', 'a-little', 'somewhat', 'very', 'extremely'] },
    { id: 'compared-peers', version: '0.1-draft', type: 'choice', options: ['much-less', 'a-bit-less', 'about-the-same', 'a-bit-more', 'much-more', 'unsure'] },
    { id: 'gets-in-the-way', version: '0.1-draft', type: 'choice', options: ['never', 'rarely', 'sometimes', 'often', 'almost-always'] },
    { id: 'anything-else', version: '0.1-draft', type: 'text', maxLength: 500 },
  ] as ServedQuestion[],
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
