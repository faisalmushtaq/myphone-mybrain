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
  // 0.10: linking spelled out as in MySelf's record-linkage statement: what is shared with Connected West Yorkshire, which records, now and in the future, only for research, and how to stop (5 November 2026).
  // 0.11: says plainly that nothing that could identify the child will ever appear in any report or publication (5 November 2026).
  // 0.12: linking names each type of record and the study information linked; an opt-in choice to be contacted if the linking needs to change (11 November 2026).
  version: '0.12-draft', // PLACEHOLDER — ethics-approved version identifier
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
      version: '0.5-draft',
      kind: 'required',
      label: 'My answers',
      text: 'My answers about my child’s phone use can be used in the study, with a code instead of a name, including research using machine learning (computers finding patterns in data). They are only ever used for research into health, wellbeing and learning, never to make decisions about my child. Nothing that could identify my child will ever appear in any report, publication or presentation.',
      draft: true,
    },
    {
      id: 'linking',
      version: '0.2-draft',
      kind: 'required',
      label: 'Linking with records',
      text: 'My child’s name, date of birth, address and pupil number can be shared securely with Connected West Yorkshire, so that the study’s information about my child (their EEG recording, computer task results and workshop survey answers, my answers and any screenshots) can be linked with my child’s GP records, hospital records, community and mental health services records (including CAMHS), and Department for Education records (attendance, attainment and special educational needs). This can happen now and at times in the future, including as my child grows up, for as long as the research goes on, and only for research. The matching is done by an independent organisation, and researchers only see the linked information with a study code, never my child’s name, date of birth or address.',
      draft: true,
    },
    {
      id: 'understand-withdraw',
      version: '0.6-draft',
      kind: 'required',
      label: 'Changing my mind',
      text: 'I can change my mind at any time, including about linking, by emailing brainpop@leeds.ac.uk. I don’t have to say why.',
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
    {
      id: 'recontact-linkage',
      version: '0.1-draft',
      kind: 'optional',
      label: 'Contact about changes to linking',
      text: 'I am happy for the MyPhone/MyBrain team to contact me if the details of record linkage need to change.',
      more: 'In future we may need to change how we link your child’s information, for example to include a different type of record or to link in a different way. If this happens, we would like to contact you to explain the change and ask whether you are happy for it to go ahead. This is up to you: saying no changes nothing else.',
      draft: true,
    },
  ],
};

export const childAssentForm: StatementForm = {
  id: 'mpmb-child-assent',
  // 0.6: "understand" also covers linking with Department for Education records and machine learning (8 October 2026).
  // 0.7: linking spelled out as on the parent's form (5 November 2026).
  // 0.8: nothing that could identify them will ever appear in any report (5 November 2026).
  // 0.9: the record types named; the statement agreed with Connected West Yorkshire; an opt-in choice to be contacted if the linking needs to change (11 November 2026).
  version: '0.9-draft', // PLACEHOLDER — ethics-approved version identifier
  title: 'Young person’s agreement',
  statements: [
    {
      id: 'understand',
      version: '0.8-draft',
      kind: 'required',
      label: 'Understanding what sharing means',
      text: 'I know what sharing my screen time means. My name, date of birth, address and pupil number can be shared securely with Connected West Yorkshire, so that the study’s information about me (my EEG recording, computer task results and survey answers, my parent’s answers and my screenshots) can be linked with my GP records, hospital records, community and mental health services records (including CAMHS), and Department for Education records (attendance, attainment and special educational needs), now and at times in the future, for as long as the research goes on. It is only used for research, including machine learning (computers finding patterns in data), never to make decisions about me. I can ask questions.',
      coveredBySignature: true,
      draft: true,
    },
    {
      id: 'identifiers-separate',
      version: '0.1-draft',
      kind: 'required',
      label: 'My details kept separately',
      text: 'I understand that my name, date of birth and address will be kept separately from my answers, used only to link my answers with my health and education records as described above, and that I will not be identified or identifiable in the report or reports that result from the research.',
      coveredBySignature: true,
      draft: true,
    },
    {
      id: 'can-stop',
      version: '0.4-draft',
      kind: 'required',
      label: 'Stopping at any time',
      text: 'I can stop at any time, including the linking, by emailing brainpop@leeds.ac.uk. I don’t have to say why.',
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
    {
      id: 'recontact-linkage',
      version: '0.1-draft',
      kind: 'optional',
      label: 'Contact about changes to linking',
      text: 'I am happy for the MyPhone/MyBrain team to contact me if the details of record linkage need to change.',
      more: 'In future we may need to change how we link your information, for example to include a different type of record. If so, we would like to tell you about the change and ask whether you are happy for it to go ahead. It’s up to you.',
      draft: true,
    },
  ],
};

/** The statements a form asks, given the young person's age (null while it is not known). */
export function statementsFor(form: StatementForm, age: number | null, selfConsentAge: number | null): Statement[] {
  const decidesAlone = selfConsentAge !== null && age !== null && age >= selfConsentAge;
  return form.statements.filter((s) => !(s.underSelfConsentAge && decidesAlone));
}

/**
 * The forms just before the current ones, still accepted from a family who opened the form before an update reached
 * them (5 November 2026). Each record keeps the version it was signed under.
 */
const parentConsentForm09: StatementForm = {
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

const childAssentForm06: StatementForm = {
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

const parentConsentForm010: StatementForm = {
  id: 'mpmb-parent-consent',
  // 0.7: no optional choices (7 October 2026). Sharing the screen time is the parent's answer on the "where from" step; recontact is gone.
  // 0.8: the same statements in very plain English, for parents with little time or reading confidence (8 October 2026).
  // 0.9: "My answers" also covers linking with Department for Education records and machine learning (8 October 2026).
  // 0.10: linking spelled out as in MySelf's record-linkage statement: what is shared with Connected West Yorkshire, which records, now and in the future, only for research, and how to stop (5 November 2026).
  version: '0.10-draft', // PLACEHOLDER — ethics-approved version identifier
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
      version: '0.4-draft',
      kind: 'required',
      label: 'My answers',
      text: 'My answers about my child’s phone use can be used in the study, with a code instead of a name, including research using machine learning (computers finding patterns in data). They are only ever used for research into health, wellbeing and learning, never to make decisions about my child.',
      draft: true,
    },
    {
      id: 'linking',
      version: '0.1-draft',
      kind: 'required',
      label: 'Linking with records',
      text: 'My child’s name, date of birth, address and pupil number can be shared securely with Connected West Yorkshire, so that my answers can be linked with my child’s health records (such as GP and hospital visits) and education records (such as attendance and exam results). This can happen now and at times in the future, including as my child grows up, for as long as the research goes on, and only for research. Researchers only see the linked information with names, dates of birth and addresses removed.',
      draft: true,
    },
    {
      id: 'understand-withdraw',
      version: '0.6-draft',
      kind: 'required',
      label: 'Changing my mind',
      text: 'I can change my mind at any time, including about linking, by emailing brainpop@leeds.ac.uk. I don’t have to say why.',
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

const childAssentForm07: StatementForm = {
  id: 'mpmb-child-assent',
  // 0.6: "understand" also covers linking with Department for Education records and machine learning (8 October 2026).
  // 0.7: linking spelled out as on the parent's form (5 November 2026).
  version: '0.7-draft', // PLACEHOLDER — ethics-approved version identifier
  title: 'Young person’s agreement',
  statements: [
    {
      id: 'understand',
      version: '0.6-draft',
      kind: 'required',
      label: 'Understanding what sharing means',
      text: 'I know what sharing my screen time means. My name, date of birth, address and pupil number can be shared securely with Connected West Yorkshire, so it can be linked with my health records (such as GP and hospital visits) and education records (such as attendance and exam results), now and at times in the future, for as long as the research goes on. It is only used for research, including machine learning (computers finding patterns in data), never to make decisions about me. Researchers only see it with my name, date of birth and address removed. I can ask questions.',
      coveredBySignature: true,
      draft: true,
    },
    {
      id: 'can-stop',
      version: '0.4-draft',
      kind: 'required',
      label: 'Stopping at any time',
      text: 'I can stop at any time, including the linking, by emailing brainpop@leeds.ac.uk. I don’t have to say why.',
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

const parentConsentForm011: StatementForm = {
  id: 'mpmb-parent-consent',
  // 0.7: no optional choices (7 October 2026). Sharing the screen time is the parent's answer on the "where from" step; recontact is gone.
  // 0.8: the same statements in very plain English, for parents with little time or reading confidence (8 October 2026).
  // 0.9: "My answers" also covers linking with Department for Education records and machine learning (8 October 2026).
  // 0.10: linking spelled out as in MySelf's record-linkage statement: what is shared with Connected West Yorkshire, which records, now and in the future, only for research, and how to stop (5 November 2026).
  // 0.11: says plainly that nothing that could identify the child will ever appear in any report or publication (5 November 2026).
  version: '0.11-draft', // PLACEHOLDER — ethics-approved version identifier
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
      version: '0.5-draft',
      kind: 'required',
      label: 'My answers',
      text: 'My answers about my child’s phone use can be used in the study, with a code instead of a name, including research using machine learning (computers finding patterns in data). They are only ever used for research into health, wellbeing and learning, never to make decisions about my child. Nothing that could identify my child will ever appear in any report, publication or presentation.',
      draft: true,
    },
    {
      id: 'linking',
      version: '0.1-draft',
      kind: 'required',
      label: 'Linking with records',
      text: 'My child’s name, date of birth, address and pupil number can be shared securely with Connected West Yorkshire, so that my answers can be linked with my child’s health records (such as GP and hospital visits) and education records (such as attendance and exam results). This can happen now and at times in the future, including as my child grows up, for as long as the research goes on, and only for research. Researchers only see the linked information with names, dates of birth and addresses removed.',
      draft: true,
    },
    {
      id: 'understand-withdraw',
      version: '0.6-draft',
      kind: 'required',
      label: 'Changing my mind',
      text: 'I can change my mind at any time, including about linking, by emailing brainpop@leeds.ac.uk. I don’t have to say why.',
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

const childAssentForm08: StatementForm = {
  id: 'mpmb-child-assent',
  // 0.6: "understand" also covers linking with Department for Education records and machine learning (8 October 2026).
  // 0.7: linking spelled out as on the parent's form (5 November 2026).
  // 0.8: nothing that could identify them will ever appear in any report (5 November 2026).
  version: '0.8-draft', // PLACEHOLDER — ethics-approved version identifier
  title: 'Young person’s agreement',
  statements: [
    {
      id: 'understand',
      version: '0.7-draft',
      kind: 'required',
      label: 'Understanding what sharing means',
      text: 'I know what sharing my screen time means. My name, date of birth, address and pupil number can be shared securely with Connected West Yorkshire, so it can be linked with my health records (such as GP and hospital visits) and education records (such as attendance and exam results), now and at times in the future, for as long as the research goes on. It is only used for research, including machine learning (computers finding patterns in data), never to make decisions about me. Researchers only see it with my name, date of birth and address removed, and nothing that could identify me will ever appear in any report. I can ask questions.',
      coveredBySignature: true,
      draft: true,
    },
    {
      id: 'can-stop',
      version: '0.4-draft',
      kind: 'required',
      label: 'Stopping at any time',
      text: 'I can stop at any time, including the linking, by emailing brainpop@leeds.ac.uk. I don’t have to say why.',
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

export const earlierParentConsentForms: StatementForm[] = [parentConsentForm011, parentConsentForm010, parentConsentForm09];
export const earlierChildAssentForms: StatementForm[] = [childAssentForm08, childAssentForm07, childAssentForm06];
