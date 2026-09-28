/**
 * Consent and assent statements.
 *
 * EVERY statement below is DRAFT wording for the prototype and must be replaced
 * with the ethics-approved text. The interface renders whatever is here; the
 * ids and versions are stamped on every record so wording can change over
 * time without breaking the audit trail.
 *
 * kind:
 *   'required' — rendered as a checkbox that must be ticked to continue.
 *   'optional' — rendered as an explicit Yes / No choice that must be answered.
 *
 * `affects` links a statement to a part of the journey that is removed if the
 * statement is declined (for example the phone-use steps).
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
  version: '0.2-draft', // PLACEHOLDER — ethics-approved version identifier
  title: 'Parent or guardian consent',
  statements: [
    {
      id: 'read-information',
      version: '0.2-draft',
      kind: 'required',
      label: 'Reading the information',
      text: 'I confirm that I have read and understood the information for parents and guardians, and that I have been able to ask questions.',
      more: 'The information is on the previous screen and in the full participant information sheet. You can go back to it at any time before you sign.',
      draft: true,
    },
    {
      id: 'take-part',
      version: '0.2-draft',
      kind: 'required',
      label: 'Taking part in the study',
      text: 'I agree to my child taking part in MyPhone/MyBrain. This includes the surveys and, if my child chooses, the session at school.',
      more:
        'Taking part is voluntary. You can change your mind at any time without giving a reason, and this will not affect your child at school. Each activity is explained in the participant information.',
      draft: true,
    },
    {
      id: 'understand-withdraw',
      version: '0.2-draft',
      kind: 'required',
      label: 'Stopping at any time',
      text: 'I understand that my child can stop taking part at any time, and that I can withdraw my consent at any time, without giving a reason.',
      more:
        'To withdraw, contact the team using the details at the end. Information already used in analysis may not be removable, and the team will explain what can and cannot be undone.',
      draft: true,
    },
    {
      id: 'records-checked',
      version: '0.2-draft',
      kind: 'required',
      label: 'Checks on the study',
      text: 'I understand that authorised people from the University of Leeds, or from bodies that regulate research, may look at study records to check that the study is being carried out properly.',
      more: 'These checks are about how the study is run. The people carrying them out are bound by the same confidentiality rules as the research team.',
      draft: true,
    },
    {
      id: 'phone-use',
      version: '0.2-draft',
      kind: 'optional',
      label: 'Phone-use information',
      text: 'I agree to the research team collecting and analysing screenshots of my child’s screen-time summary, which show the apps used and the time spent on each.',
      more:
        'This is a screenshot of the phone’s Screen Time or Digital Wellbeing screen. It does not show messages, photos or what was posted. Your child can hide parts of an image before sharing it, and the images are stored with a study code rather than a name.',
      affects: 'phone-use',
      draft: true,
    },
    {
      id: 'link-health',
      version: '0.2-draft',
      kind: 'optional',
      label: 'Linking with health records',
      text: 'I agree to my child’s study information being linked with their NHS health records through Connected West Yorkshire.',
      more:
        'Linking means adding information from records that already exist, so the study can look at longer-term patterns without asking families to fill in more forms. Linked information is labelled with a code, not your child’s name. It is not anonymous, because the study keeps a secure key that links the code back to your child, but researchers analysing the information do not see names or contact details. The exact records to be linked are listed in the participant information.',
      draft: true,
    },
    {
      id: 'link-education',
      version: '0.2-draft',
      kind: 'optional',
      label: 'Linking with education records',
      text: 'I agree to my child’s study information being linked with their education records: attendance, results and special educational needs records held by the school and the Department for Education.',
      more:
        'As with health records, linked education information is handled using a study code, in secure systems with controlled access, and results are only reported for groups of young people.',
      draft: true,
    },
    {
      id: 'recontact',
      version: '0.2-draft',
      kind: 'optional',
      label: 'Being contacted about future research',
      text: 'I am happy for the team to contact us about future research connected to MyPhone/MyBrain.',
      more: 'Saying yes does not commit you to anything. You would receive information and could decide at the time.',
      draft: true,
    },
  ],
};

export const childAssentForm: StatementForm = {
  id: 'mpmb-child-assent',
  version: '0.2-draft', // PLACEHOLDER — ethics-approved version identifier
  title: 'Young person’s agreement',
  statements: [
    {
      id: 'understand',
      version: '0.2-draft',
      kind: 'required',
      label: 'Understanding the study',
      text: 'I know what MyPhone/MyBrain is about, and I have been able to ask questions.',
      more: 'If anything is not clear, you can ask your parent or guardian, a teacher, or the research team before you decide.',
      draft: true,
    },
    {
      id: 'can-stop',
      version: '0.2-draft',
      kind: 'required',
      label: 'Stopping at any time',
      text: 'I know I can stop at any time, and I do not have to say why.',
      draft: true,
    },
    {
      id: 'take-part',
      version: '0.2-draft',
      kind: 'optional',
      label: 'Taking part',
      text: 'I want to take part in MyPhone/MyBrain.',
      more: 'This is your choice. Saying no is completely fine, and nobody will mind.',
      draft: true,
    },
    {
      id: 'phone-use',
      version: '0.2-draft',
      kind: 'optional',
      label: 'Sharing phone-use information',
      text: 'I am happy to share a screenshot of my phone’s screen-time summary.',
      more:
        'Most of what adults say about phones is guesswork. Real screen-time from people your age lets us check what is actually true, including where the worries are wrong. The screenshot shows which apps you use and for how long, not what you do in them, and you can hide any part of it before sharing.',
      affects: 'phone-use',
      draft: true,
    },
  ],
};
