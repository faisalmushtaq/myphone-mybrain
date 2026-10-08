import { describe, expect, it } from 'vitest';
import { parentConsentForm } from '../config/statements';
import { study } from '../config/study';
import { initialState, reducer, type Action } from '../state/reducer';
import { buildConsentPayload, firstIncomplete } from '../state/useSync';
import { buildJourney, decidesAlone, lastCall, parentMoreApplies, phoneSourceOf, youngFinishes } from './journey';
import type { AppState } from './types';

/** A date of birth that makes someone `age` today. */
const dobFor = (age: number) => ({ day: '1', month: '1', year: String(new Date().getFullYear() - age) });

const signature = { method: 'typed' as const, imageDataUrl: null, typedName: 'Sam Smith', strokeCount: 0, pointerType: null, capturedAt: new Date().toISOString() };

/** A family part-way through: details in, for a young person of this age, on this route. */
function family(route: 'parent' | 'young', age: number): AppState {
  let s = reducer(initialState(), { type: 'set-route', route });
  s = reducer(s, { type: 'update-identity', patch: { firstName: 'Kai', lastName: 'Patel', dateOfBirth: dobFor(age), schoolId: 'DUA', yearGroup: 'Year 9', ...(route === 'young' && age >= 16 ? { postcode: 'LS6 1AB' } : {}) } });
  s = reducer(s, { type: 'update-guardian', patch: { fullName: 'Sam Patel', relationship: 'mother', address: '1 Long Lane, Leeds', postcode: 'LS6 1AB' } });
  return s;
}

const apply = (s: AppState, ...actions: Action[]) => actions.reduce(reducer, s);

/** The parent's permission, signed. Since 7 October 2026 it has no screenshots question: the parent's yes or no is their answer to where the screen time comes from. */
function permission(s: AppState): AppState {
  return apply(s, { type: 'consent-required-group', agreed: true }, { type: 'consent-typed-name', name: 'Sam Patel' }, { type: 'consent-signature', signature }, { type: 'consent-complete', informationVersion: '0.4-draft' });
}

describe('the family form after 7 October 2026: who decides, and where the screen time comes from', () => {
  it('16 or over decides alone; under 16 needs a parent first', () => {
    expect(study.selfConsentAge).toBe(16);
    expect(decidesAlone(family('young', 16))).toBe(true);
    expect(decidesAlone(family('young', 15))).toBe(false);
    // The permission asks nothing about the workshop, record linkage, the screenshots or future contact.
    for (const gone of ['take-part', 'link-records', 'phone-use', 'recontact']) expect(parentConsentForm.statements.map((s) => s.id)).not.toContain(gone);
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

  it('the record can be saved from the moment the parent signs, before anything else is answered', () => {
    const s = family('parent', 13);
    expect(firstIncomplete(s)).toBe('parent-consent');
    const signed = permission(s);
    expect(firstIncomplete(signed)).toBeNull();
    const payload = buildConsentPayload(signed);
    expect(payload.phoneSource).toBeNull();
    expect(payload.assent.status).toBe('not-started');
    expect(payload.survey?.status).toBe('not-started');
    // Part-way through the questions, the answers so far go with it.
    const partWay = reducer(signed, { type: 'answer-question', questionId: 'concern', version: '0.1-draft', value: 'somewhat', form: 'quick' });
    expect(buildConsentPayload(partWay).survey).toMatchObject({ status: 'in-progress', responses: { concern: { value: 'somewhat' } } });
  });

  it('a parent who says no to sharing the screen time answers the longer questions instead', () => {
    const s = reducer(permission(family('parent', 13)), { type: 'set-phone-source', source: 'none' });
    expect(phoneSourceOf(s)).toBe('none');
    expect(buildJourney(s)).toEqual(['welcome', 'child-details', 'parent-consent', 'parent-questions', 'phone-source', 'parent-more', 'check', 'done']);
    expect(firstIncomplete(s)).toBeNull();
    expect(buildConsentPayload(s).more).not.toBeNull();
  });

  it('a parent who says yes chooses where the screen time comes from', () => {
    const s = permission(family('parent', 13));
    expect(buildJourney(s)).toEqual(['welcome', 'child-details', 'parent-consent', 'parent-questions', 'phone-source', 'check', 'done']);
    // From the parent's own phone: no agreement asked of the young person; the longer questions only if the screenshots are skipped.
    const fromParent = reducer(s, { type: 'set-phone-source', source: 'parent' });
    expect(buildJourney(fromParent)).toEqual(['welcome', 'child-details', 'parent-consent', 'parent-questions', 'phone-source', 'phone-use', 'check', 'done']);
    expect(firstIncomplete(fromParent)).toBeNull();
    expect(buildJourney(reducer(fromParent, { type: 'donation-status', status: 'skipped' }))).toContain('parent-more');
    // From the young person's phone: their agreement, then the young person finishes; the phone never goes back to the parent.
    const fromChild = reducer(s, { type: 'set-phone-source', source: 'child' });
    expect(buildJourney(fromChild)).toEqual(['welcome', 'child-details', 'parent-consent', 'parent-questions', 'phone-source', 'child-assent', 'check', 'done']);
    expect(firstIncomplete(fromChild)).toBeNull();
    // A signature drawn but not confirmed stays on the device: nothing of the young person's is sent before they answer.
    const drawing = reducer(fromChild, { type: 'assent-signature', signature });
    expect(buildConsentPayload(drawing).assent).toMatchObject({ status: 'not-started', signature: null, responses: {} });
    const declined = reducer(fromChild, { type: 'assent-decline' });
    expect(buildJourney(declined)).toEqual(['welcome', 'child-details', 'parent-consent', 'parent-questions', 'phone-source', 'child-assent', 'assent-declined', 'check', 'done']);
    expect(youngFinishes(declined)).toBe(true);
    // Not there: the parent sends them a link and finishes; no longer questions instead.
    const away = reducer(fromChild, { type: 'set-child-present', present: false });
    expect(parentMoreApplies(away)).toBe(false);
    expect(youngFinishes(away)).toBe(false);
    expect(buildJourney(away)).toEqual(['welcome', 'child-details', 'parent-consent', 'parent-questions', 'phone-source', 'check', 'done']);
    expect(firstIncomplete(away)).toBeNull();
    // Neither: straight to the longer questions.
    expect(buildJourney(reducer(s, { type: 'set-phone-source', source: 'none' }))).toEqual(['welcome', 'child-details', 'parent-consent', 'parent-questions', 'phone-source', 'parent-more', 'check', 'done']);
  });

  it('a young person under 16 hands over to their parent first, who says whether it comes from the young person’s phone', () => {
    const s = family('young', 14);
    expect(buildJourney(s)).toEqual(['welcome', 'child-details', 'parent-details', 'parent-consent', 'parent-questions', 'phone-source', 'check', 'done']);
    const yes = reducer(permission(s), { type: 'set-phone-source', source: 'child' });
    expect(phoneSourceOf(yes)).toBe('child');
    expect(buildJourney(yes)).toEqual(['welcome', 'child-details', 'parent-details', 'parent-consent', 'parent-questions', 'phone-source', 'child-assent', 'check', 'done']);
  });

  it('a parent of a young person of 16 or over: their answers, then the young person decides for themselves', () => {
    const s = permission(family('parent', 17));
    expect(phoneSourceOf(s)).toBe('child');
    expect(buildJourney(s)).toEqual(['welcome', 'child-details', 'parent-consent', 'parent-questions', 'child-assent', 'check', 'done']);
    expect(firstIncomplete(s)).toBeNull();
    expect(buildConsentPayload(s).phoneSource).toBe('child');
  });

  it('one last prompt to share the screen time before finishing, only when it could still come', () => {
    const signed = permission(family('parent', 13));
    // Screenshots that can be added now (here from the parent's own phone, skipped).
    const skipped = apply(signed, { type: 'set-phone-source', source: 'parent' }, { type: 'donation-status', status: 'skipped' });
    expect(lastCall(skipped)).toBe('add');
    expect(lastCall(reducer(skipped, { type: 'share-prompted' }))).toBeNull();
    // The young person was not there: they have been sent the link, so the parent is not asked again.
    const away = apply(signed, { type: 'set-phone-source', source: 'child' }, { type: 'set-child-present', present: false });
    expect(lastCall(away)).toBeNull();
    // The parent said no: perhaps after all.
    expect(lastCall(reducer(signed, { type: 'set-phone-source', source: 'none' }))).toBe('after-all');
    // Never after the young person's own no, or when they chose to decide later.
    const fromChild = reducer(signed, { type: 'set-phone-source', source: 'child' });
    expect(lastCall(reducer(fromChild, { type: 'assent-decline' }))).toBeNull();
    expect(lastCall(reducer(fromChild, { type: 'assent-status', status: 'deferred', deferredBy: 'young' }))).toBeNull();
    // A 16-year-old on their own who agreed but added nothing yet.
    expect(lastCall(apply(family('young', 16), { type: 'assent-signature', signature }, { type: 'assent-sign' }))).toBe('add');
  });

  it('the longer questions are their own record, answered and skipped like the quick ones', () => {
    let s = reducer(permission(family('parent', 12)), { type: 'set-phone-source', source: 'none' });
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
