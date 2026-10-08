/**
 * Consent and assent statements.
 *
 * EVERY statement below is DRAFT wording for the prototype and must be replaced
 * with the ethics-approved text. The interface renders whatever is here; the
 * ids and versions are stamped on every record so wording can change over
 * time without breaking the audit trail.
 *
 * kind:
 *   'required' — needed to take part. Shown as a list under one confirmation
 *                tick (config/study.ts `groupRequiredStatements`) or as
 *                individual checkboxes.
 *   'optional' — a separate permission, rendered as an explicit Yes / No that
 *                must be answered.
 *
 * `affects` links a statement to a part of the journey that is removed if the
 * statement is declined (for example the phone-use step).
 *
 * `underSelfConsentAge` marks a statement asked of the parent only while the
 * young person is under study.selfConsentAge (16): from then on the young
 * person decides for themselves.
 *
 * Since 7 October 2026 the workshop at school, and linking with records, are
 * opt-out (by email, see docs/decisions.md), so these forms no longer ask
 * permission for either: they are about sharing screen time and answering
 * questions about phone use, which are opt-in.
 *
 * For the young person's form, `coveredBySignature` marks the statements that
 * their single signature agrees to; the phone-use statement is instead
 * recorded by the act of sending (or not sending) a screenshot.
 */
export interface Statement {
  id: string;
  version: string;
  kind: 'required' | 'optional';
  /** Short label used in summaries. */
  label: string;
  /** The statement the person agrees to. */
  text: string;
  /** Optional plain-English explanation behind "Find out more". */
  more?: string;
  affects?: 'phone-use';
  /** Asked only while the young person is under study.selfConsentAge. */
  underSelfConsentAge?: boolean;
  coveredBySignature?: boolean;
  /** True while the wording is draft. Shown as a marker in the interface. */
  draft: boolean;
}

export interface StatementForm {
  id: string;
  version: string;
  title: string;
  statements: Statement[];
}

export const parentConsentForm: StatementForm = {
  id: 'mpmb-parent-consent',
  // 0.7: no optional choices (7 October 2026). Sharing the screen time is the parent's answer on the "where from" step; recontact is gone.
  // 0.8: the same statements in very plain English, for parents with little time or reading confidence (8 October 2026).
  // 0.9: "My answers" also covers linking with Department for Education records and machine learning (8 October 2026).
  version: '0.9-draft', // PLACEHOLDER — ethics-approved version identifier
  title: 'Parent or carer permission',
  statements: [
    {
      id: 'read-information',
      version: '0.5-draft',
      kind: 'required',
      label: 'Reading the information',
      text: 'I know what this is about, and I could ask questions if I wanted to.',
      draft: true,
    },
    {
      id: 'answers',
      version: '0.3-draft',
      kind: 'required',
      label: 'My answers',
      text: 'My answers about my child’s phone use can be used in the study, with a code instead of a name. This includes linking them with my child’s education records from the Department for Education, and research using machine learning (computers finding patterns in data).',
      draft: true,
    },
    {
      id: 'understand-withdraw',
      version: '0.5-draft',
      kind: 'required',
      label: 'Changing my mind',
      text: 'I can change my mind at any time by contacting the team. I don’t have to say why.',
      draft: true,
    },
    {
      id: 'records-checked',
      version: '0.4-draft',
      kind: 'required',
      label: 'Checks on the study',
      text: 'People who check that research is done properly may look at the study’s records.',
      draft: true,
    },
  ],
};

export const childAssentForm: StatementForm = {
  id: 'mpmb-child-assent',
  // 0.6: "understand" also covers linking with Department for Education records and machine learning (8 October 2026).
  version: '0.6-draft', // PLACEHOLDER — ethics-approved version identifier
  title: 'Young person’s agreement',
  statements: [
    {
      id: 'understand',
      version: '0.5-draft',
      kind: 'required',
      label: 'Understanding what sharing means',
      text: 'I know what sharing my screen time means: it can be linked with my school records from the Department for Education, and studied using machine learning (computers finding patterns in data). I can ask questions.',
      coveredBySignature: true,
      draft: true,
    },
    {
      id: 'can-stop',
      version: '0.3-draft',
      kind: 'required',
      label: 'Stopping at any time',
      text: 'I can stop at any time, and I don’t have to say why.',
      coveredBySignature: true,
      draft: true,
    },
    {
      id: 'take-part',
      version: '0.4-draft',
      kind: 'required',
      label: 'Sharing my screen time',
      text: 'I want to share my screen time with MyPhone/MyBrain.',
      coveredBySignature: true,
      draft: true,
    },
    {
      id: 'phone-use',
      version: '0.5-draft',
      kind: 'optional',
      label: 'Sending screenshots of your screen time and apps',
      text: 'I am happy to share screenshots of my phone’s screen-time summary, including which apps I use and for how long.',
      more: 'It shows which apps you use and for how long — not what you do in them. Both matter: how you use your phone, not just how much. You can hide any part before sharing, and you can skip it.',
      affects: 'phone-use',
      draft: true,
    },
  ],
};

/** The statements a form asks, given the young person's age (null while it is not known). */
export function statementsFor(form: StatementForm, age: number | null, selfConsentAge: number | null): Statement[] {
  const decidesAlone = selfConsentAge !== null && age !== null && age >= selfConsentAge;
  return form.statements.filter((s) => !(s.underSelfConsentAge && decidesAlone));
}
