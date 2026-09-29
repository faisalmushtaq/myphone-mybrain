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
  version: '0.3-draft', // PLACEHOLDER — ethics-approved version identifier
  title: 'Parent or guardian permission',
  statements: [
    {
      id: 'read-information',
      version: '0.3-draft',
      kind: 'required',
      label: 'Reading the information',
      text: 'I have read and understood the information above, and I have been able to ask questions.',
      draft: true,
    },
    {
      id: 'take-part',
      version: '0.3-draft',
      kind: 'required',
      label: 'Taking part in the study',
      text: 'I agree to my child taking part in MyPhone/MyBrain, including the surveys and, if my child chooses, the session at school.',
      draft: true,
    },
    {
      id: 'understand-withdraw',
      version: '0.3-draft',
      kind: 'required',
      label: 'Stopping at any time',
      text: 'I understand that my child can stop at any time, and that I can withdraw my permission at any time, without giving a reason.',
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
      version: '0.3-draft',
      kind: 'optional',
      label: 'Screen-time screenshots',
      text: 'The research team may collect and analyse screenshots of my child’s screen-time summary (the apps used and the time spent on each).',
      more:
        'This is a screenshot of the phone’s Screen Time or Digital Wellbeing screen. It does not show messages, photos or what was posted. Your child can hide parts of an image before sharing it, and images are stored with a code rather than a name.',
      affects: 'phone-use',
      draft: true,
    },
    {
      id: 'link-health',
      version: '0.3-draft',
      kind: 'optional',
      label: 'Linking with NHS health records',
      text: 'My child’s study information may be linked with their NHS health records through Connected West Yorkshire.',
      more:
        'Linking means adding information from records that already exist, so the study can look at longer-term patterns without asking families to fill in more forms. Linked information is labelled with a code, not your child’s name. It is not anonymous, because the study keeps a secure key that links the code back to your child, but researchers analysing the information do not see names or contact details. The exact records to be linked are listed in the participant information.',
      draft: true,
    },
    {
      id: 'link-education',
      version: '0.3-draft',
      kind: 'optional',
      label: 'Linking with school records',
      text: 'My child’s study information may be linked with their education records: attendance, results and special educational needs records held by the school and the Department for Education.',
      more: 'As with health records, linked education information is handled using a code, in secure systems with controlled access, and results are only reported for groups of young people.',
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
  version: '0.3-draft', // PLACEHOLDER — ethics-approved version identifier
  title: 'Young person’s agreement',
  statements: [
    {
      id: 'understand',
      version: '0.3-draft',
      kind: 'required',
      label: 'Understanding the study',
      text: 'I know what MyPhone/MyBrain is about, and I can ask questions.',
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
      version: '0.3-draft',
      kind: 'required',
      label: 'Taking part',
      text: 'I want to take part.',
      coveredBySignature: true,
      draft: true,
    },
    {
      id: 'phone-use',
      version: '0.3-draft',
      kind: 'optional',
      label: 'Sharing a screen-time screenshot',
      text: 'I am happy to share a screenshot of my phone’s screen-time summary.',
      more: 'It shows which apps you use and for how long, not what you do in them. You can hide any part before sharing, and you can skip it.',
      affects: 'phone-use',
      draft: true,
    },
  ],
};
