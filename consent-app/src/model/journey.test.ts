import { describe, expect, it } from 'vitest';
import { parentConsentForm, statementsFor } from '../config/statements';
import { study } from '../config/study';
import { initialState, reducer, type Action } from '../state/reducer';
import { buildConsentPayload, firstIncomplete } from '../state/useSync';
import { buildJourney, decidesAlone, parentMoreApplies, phoneSourceOf } from './journey';
import type { AppState } from './types';

/** A date of birth that makes someone `age` today. */
const dobFor = (age: number) => ({ day: '1', month: '1', year: String(new Date().getFullYear() - age) });

const signature = { method: 'typed' as const, imageDataUrl: null, typedName: 'Sam Smith', strokeCount: 0, pointerType: null, capturedAt: new Date().toISOString() };

/** A family part-way through: details in, for a young person of this age, on this route. */
function family(route: 'parent' | 'young', age: number): AppState {
  let s = reducer(initialState(), { type: 'set-route', route });
  s = reducer(s, { type: 'update-identity', patch: { firstName: 'Kai', lastName: 'Patel', dateOfBirth: dobFor(age), schoolId: 'DUA', yearGroup: 'Year 9' } });
  s = reducer(s, { type: 'update-guardian', patch: { fullName: 'Sam Patel', relationship: 'mother', hasParentalResponsibility: true } });
  return s;
}

const apply = (s: AppState, ...actions: Action[]) => actions.reduce(reducer, s);

/** The parent's permission, signed, with their answer about the screenshots (none from 16). */
function permission(s: AppState, phone: 'agreed' | 'declined' | null): AppState {
  let next = apply(s, { type: 'consent-required-group', agreed: true }, { type: 'consent-response', statementId: 'recontact', version: '0.3-draft', response: 'declined' });
  if (phone) next = reducer(next, { type: 'consent-response', statementId: 'phone-use', version: '0.5-draft', response: phone });
  return apply(next, { type: 'consent-typed-name', name: 'Sam Patel' }, { type: 'consent-signature', signature }, { type: 'consent-complete', informationVersion: '0.4-draft' });
}

describe('the family form after 7 October 2026: who decides, and where the screen time comes from', () => {
  it('16 or over decides alone; under 16 needs a parent first', () => {
    expect(study.selfConsentAge).toBe(16);
    expect(decidesAlone(family('young', 16))).toBe(true);
    expect(decidesAlone(family('young', 15))).toBe(false);
    // The parent is not asked about an over-16's screenshots.
    expect(statementsFor(parentConsentForm, 16, 16).map((s) => s.id)).not.toContain('phone-use');
    expect(statementsFor(parentConsentForm, 15, 16).map((s) => s.id)).toContain('phone-use');
    expect(parentConsentForm.statements.map((s) => s.id)).not.toContain('take-part');
    expect(parentConsentForm.statements.map((s) => s.id)).not.toContain('link-records');
  });

  it('a 16-year-old on their own: their agreement, their screenshots, nothing from a parent', () => {
    const s = family('young', 16);
    expect(buildJourney(s)).toEqual(['welcome', 'child-details', 'child-assent', 'check', 'done']);
    expect(firstIncomplete(s)).toBe('child-assent');
    const signed = apply(s, { type: 'assent-signature', signature }, { type: 'assent-sign' });
    expect(buildJourney(signed)).toEqual(['welcome', 'child-details', 'child-assent', 'phone-use', 'check', 'done']);
    expect(firstIncomplete(signed)).toBeNull();
    const payload = buildConsentPayload(signed);
    expect(payload.consent).toBeNull();
    expect(payload.guardian.fullName).toBe('');
    expect(payload.survey).toBeNull();
    expect(payload.phoneSource).toBe('child');
    expect(payload.more).toBeNull();
    // Saying no ends there, with nothing to send.
    const no = reducer(s, { type: 'assent-decline' });
    expect(buildJourney(no)).toEqual(['welcome', 'child-details', 'child-assent', 'assent-declined']);
    expect(firstIncomplete(no)).toBe('child-assent');
  });

  it('a parent who says no to the screenshots answers the longer questions instead', () => {
    const s = permission(family('parent', 13), 'declined');
    expect(phoneSourceOf(s)).toBe('none');
    expect(buildJourney(s)).toEqual(['welcome', 'child-details', 'parent-consent', 'parent-questions', 'parent-more', 'check', 'done']);
    expect(firstIncomplete(s)).toBeNull();
    expect(buildConsentPayload(s).more).not.toBeNull();
  });

  it('a parent who says yes chooses where the screen time comes from', () => {
    const s = permission(family('parent', 13), 'agreed');
    expect(buildJourney(s)).toEqual(['welcome', 'child-details', 'parent-consent', 'parent-questions', 'phone-source', 'check', 'done']);
    expect(firstIncomplete(s)).toBe('phone-source');
    // From the parent's own phone: no agreement asked of the young person; the longer questions only if the screenshots are skipped.
    const fromParent = reducer(s, { type: 'set-phone-source', source: 'parent' });
    expect(buildJourney(fromParent)).toEqual(['welcome', 'child-details', 'parent-consent', 'parent-questions', 'phone-source', 'phone-use', 'check', 'done']);
    expect(firstIncomplete(fromParent)).toBeNull();
    expect(buildJourney(reducer(fromParent, { type: 'donation-status', status: 'skipped' }))).toContain('parent-more');
    // From the young person's phone: their agreement first; a no, or not being there, brings the longer questions.
    const fromChild = reducer(s, { type: 'set-phone-source', source: 'child' });
    expect(buildJourney(fromChild)).toEqual(['welcome', 'child-details', 'parent-consent', 'parent-questions', 'phone-source', 'child-assent', 'check', 'done']);
    expect(firstIncomplete(fromChild)).toBe('child-assent');
    expect(buildJourney(reducer(fromChild, { type: 'assent-decline' }))).toEqual(['welcome', 'child-details', 'parent-consent', 'parent-questions', 'phone-source', 'child-assent', 'assent-declined', 'parent-more', 'check', 'done']);
    const away = reducer(fromChild, { type: 'set-child-present', present: false });
    expect(parentMoreApplies(away)).toBe(true);
    expect(buildJourney(away)).toEqual(['welcome', 'child-details', 'parent-consent', 'parent-questions', 'phone-source', 'parent-more', 'check', 'done']);
    expect(firstIncomplete(away)).toBeNull();
    // Neither: straight to the longer questions.
    expect(buildJourney(reducer(s, { type: 'set-phone-source', source: 'none' }))).toEqual(['welcome', 'child-details', 'parent-consent', 'parent-questions', 'phone-source', 'parent-more', 'check', 'done']);
  });

  it('a young person under 16 hands over to their parent first, then shares from their own phone', () => {
    const s = family('young', 14);
    expect(buildJourney(s)).toEqual(['welcome', 'child-details', 'parent-details', 'parent-consent', 'parent-questions', 'check', 'done']);
    const yes = permission(s, 'agreed');
    expect(phoneSourceOf(yes)).toBe('child');
    expect(buildJourney(yes)).toEqual(['welcome', 'child-details', 'parent-details', 'parent-consent', 'parent-questions', 'child-assent', 'check', 'done']);
  });

  it('a parent of a 16- or 17-year-old: their answers, then the young person decides for themselves', () => {
    const s = permission(family('parent', 17), null);
    expect(phoneSourceOf(s)).toBe('child');
    expect(buildJourney(s)).toEqual(['welcome', 'child-details', 'parent-consent', 'parent-questions', 'child-assent', 'check', 'done']);
    expect(firstIncomplete(s)).toBe('child-assent');
    // A phone-use answer left from an earlier date of birth is not sent.
    const stale = reducer(s, { type: 'consent-response', statementId: 'phone-use', version: '0.5-draft', response: 'agreed' });
    expect(Object.keys(buildConsentPayload(stale).consent?.responses ?? {})).not.toContain('phone-use');
  });

  it('the longer questions are their own record, answered and skipped like the quick ones', () => {
    let s = permission(family('parent', 12), 'declined');
    s = apply(s, { type: 'answer-question', questionId: 'school-day-time', version: '0.1-draft', value: '2-3', form: 'more' }, { type: 'survey-status', status: 'completed', form: 'more' });
    expect(s.more.responses['school-day-time']?.value).toBe('2-3');
    expect(s.survey.responses['school-day-time']).toBeUndefined();
    expect(buildConsentPayload(s).more?.status).toBe('completed');
  });
});

describe('finishing later with a reference', () => {
  const summary = (over: Partial<import('../api/types').ResumeSummary> = {}): import('../api/types').ResumeSummary => ({ referenceCode: 'MPMB-ABCD-EF2', firstName: 'Kai', selfConsent: false, phoneSource: 'child', assentStatus: 'deferred', imageCount: 0, maxImages: 6, canAgree: true, canAddScreenshots: false, reason: null, ...over });
  const found = (over: Partial<import('../api/types').ResumeSummary> = {}) => reducer(initialState(), { type: 'resume-found', summary: summary(over), dateOfBirth: dobFor(13) });

  it('a young person whose part was put off: their answer, then the screenshots, nothing of the parent’s', () => {
    const s = found();
    expect(s.route).toBe('young');
    expect(s.submission.referenceCode).toBe('MPMB-ABCD-EF2');
    expect(buildJourney(s)).toEqual(['welcome', 'resume', 'child-assent', 'done']);
    expect(firstIncomplete(s)).toBe('child-assent');
    const yes = apply(s, { type: 'assent-signature', signature }, { type: 'assent-sign' });
    expect(buildJourney(yes)).toEqual(['welcome', 'resume', 'child-assent', 'phone-use', 'done']);
    expect(firstIncomplete(yes)).toBeNull();
    expect(phoneSourceOf(yes)).toBe('child');
    expect(parentMoreApplies(yes)).toBe(false);
    const no = reducer(s, { type: 'assent-decline' });
    expect(buildJourney(no)).toEqual(['welcome', 'resume', 'child-assent', 'assent-declined', 'done']);
  });

  it('screenshots only, from the parent’s phone or after a yes given before; nothing at all after a no', () => {
    const parent = found({ phoneSource: 'parent', assentStatus: 'not-started', canAgree: false, canAddScreenshots: true });
    expect(parent.route).toBe('parent');
    expect(buildJourney(parent)).toEqual(['welcome', 'resume', 'phone-use', 'done']);
    expect(parent.submission.consentStage).toBe('sent');
    expect(firstIncomplete(parent)).toBeNull();
    const agreed = found({ assentStatus: 'completed', canAgree: false, canAddScreenshots: true });
    expect(agreed.assent.status).toBe('completed');
    expect(buildJourney(agreed)).toEqual(['welcome', 'resume', 'phone-use', 'done']);
    expect(buildJourney(found({ assentStatus: 'declined', canAgree: false, canAddScreenshots: false, reason: 'declined' }))).toEqual(['welcome', 'resume', 'done']);
  });

  it('before the record is found, the step stands alone; "Finish and clear" forgets the record', () => {
    const looking = reducer(initialState(), { type: 'go-to', stepId: 'resume' });
    expect(buildJourney(looking)).toEqual(['welcome', 'resume']);
    expect(reducer(found(), { type: 'reset' }).resume).toBeNull();
  });
});
