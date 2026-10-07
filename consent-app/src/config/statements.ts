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
  version: '0.6-draft', // PLACEHOLDER — ethics-approved version identifier
  title: 'Parent or carer permission',
  statements: [
    {
      id: 'read-information',
      version: '0.4-draft',
      kind: 'required',
      label: 'Reading the information',
      text: 'I have read and understood the information above about sharing my child’s screen time and answering questions about their phone use, and I have been able to ask questions.',
      draft: true,
    },
    {
      id: 'answers',
      version: '0.1-draft',
      kind: 'required',
      label: 'My answers',
      text: 'My answers to the questions about my child’s phone use may be used in the study, labelled with a code rather than a name.',
      draft: true,
    },
    {
      id: 'understand-withdraw',
      version: '0.4-draft',
      kind: 'required',
      label: 'Changing my mind',
      text: 'I understand that I can change my mind at any time, without giving a reason, by contacting the research team.',
      draft: true,
    },
    {
      id: 'records-checked',
      version: '0.3-draft',
      kind: 'required',
      label: 'Checks on the study',
      text: 'I understand that authorised people from the University of Leeds, or from bodies that regulate research, may look at study records to check the study is being run properly.',
      draft: true,
    },
    {
      id: 'phone-use',
      version: '0.5-draft',
      kind: 'optional',
      label: 'Screen-time and app-use screenshots',
      text: 'The research team may collect and analyse screenshots of my child’s screen-time summary showing which apps they use and how long they spend on each.',
      more:
        'This is a screenshot of the phone’s Screen Time or Digital Wellbeing screen, including the list of apps. We ask for the apps as well as the total because how a phone is used matters as much as how long. It does not show messages, photos or what was posted. If you can see your child’s screen time on your own phone (Apple Family Sharing or Google Family Link), you can send it from there; otherwise your child can send it from their phone, if they want to. Parts of an image can be hidden before it is shared, and images are stored with a code rather than a name. If you say no, we ask you a few more questions about your child’s phone use instead.',
      affects: 'phone-use',
      underSelfConsentAge: true,
      draft: true,
    },
    {
      id: 'recontact',
      version: '0.3-draft',
      kind: 'optional',
      label: 'Contact about future research',
      text: 'The team may contact us about future research connected to MyPhone/MyBrain.',
      more: 'Saying yes does not commit you to anything. You would receive information and could decide at the time.',
      draft: true,
    },
  ],
};

export const childAssentForm: StatementForm = {
  id: 'mpmb-child-assent',
  version: '0.5-draft', // PLACEHOLDER — ethics-approved version identifier
  title: 'Young person’s agreement',
  statements: [
    {
      id: 'understand',
      version: '0.4-draft',
      kind: 'required',
      label: 'Understanding what sharing means',
      text: 'I know what sharing my screen time means, and I can ask questions.',
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
