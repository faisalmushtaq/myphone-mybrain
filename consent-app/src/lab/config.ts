/**
 * The social media break study (the laboratory study for adults): who it is
 * for, the approved participant information and consent wording, and the
 * participant-code scheme. Plain data with no imports, because the server's
 * build reads this file too (firebase/functions/scripts/generate-forms.mjs).
 *
 * Wording is the ethics-approved version 1 ("Approved v1", SoPREC 4202).
 * Two statements and one information section describe donating data
 * "through the Smart Data Donation Service (SDDS)". Donations will go through
 * SDDS once it is ready; until then this website carries out that step. Each
 * such passage carries a `note` saying so.
 */

export interface LabStatement {
  id: string;
  version: string;
  text: string;
  /** Short label used in summaries and the PDF copy. */
  label: string;
  /** Shown under the statement when the approved wording is being updated. */
  note?: string;
}

export const labConsentForm: { id: string; version: string; title: string; statements: LabStatement[] } = {
  id: 'mpmb-lab-consent',
  version: '1.0',
  title: 'Participant consent form',
  statements: [
    { id: 'read-information', version: '1.0', label: 'Read the information', text: 'I confirm that I have read and understood the Participant Information Sheet.' },
    {
      id: 'involves',
      version: '1.0',
      label: 'What taking part involves',
      text: 'I understand that participation in this study involves: two laboratory sessions; a smartphone restriction phase lasting between two weeks and one month; completion of questionnaires and computer-based tasks; and donation of summary smartphone usage data through the Smart Data Donation Service (SDDS).',
      note: 'Donations will go through the Smart Data Donation Service (SDDS) once it is ready. Until then this website carries out that step: you download your own data, remove what you do not want to share on your own device, and send the rest here.',
    },
    { id: 'voluntary', version: '1.0', label: 'Voluntary', text: 'I understand that participation is voluntary and that I may withdraw at any time without giving a reason.' },
    {
      id: 'donation-required',
      version: '1.0',
      label: 'Data donation is part of the study',
      text: 'I understand that if I choose not to donate smartphone usage data through SDDS, I will not be able to participate in this study.',
      note: 'Donations will go through the Smart Data Donation Service (SDDS) once it is ready. Until then this website carries out that step: you download your own data, remove what you do not want to share on your own device, and send the rest here.',
    },
    { id: 'publication', version: '1.0', label: 'Publication', text: 'I understand that anonymised results from this research may be published in academic journals, conference presentations, reports, or academic theses.' },
    { id: 'data-protection', version: '1.0', label: 'Data protection', text: 'I understand that my data will be stored securely and handled in accordance with UK data protection legislation.' },
    { id: 'take-part', version: '1.0', label: 'Agree to take part', text: 'I voluntarily agree to take part in the MyPhone/MyBrain intervention study.' },
  ],
};

export interface LabInfoSection {
  id: string;
  title: string;
  summary: string;
  detail: string[];
  note?: string;
}

export const labInformationVersion = { version: '1.0', label: 'Approved version 1' };

export const labInformation: LabInfoSection[] = [
  {
    id: 'purpose',
    title: 'What is the purpose of the study?',
    summary: 'How a short break from social media relates to brain activity, attention and wellbeing.',
    detail: [
      'This study examines how short-term changes in smartphone use relate to brain activity, physiological responses, attention, and wellbeing. During laboratory sessions we will measure brain activity using electroencephalography (EEG), heart activity using electrocardiography (ECG), and eye movements using an eye-tracking system.',
      'To understand how changes in digital behaviour relate to these processes, the study also requires objective information about smartphone usage through a secure data donation system.',
    ],
  },
  {
    id: 'invited',
    title: 'Why have I been invited?',
    summary: 'You are 18 or older and regularly use a smartphone.',
    detail: ['You have been invited because you are 18 years or older and regularly use a smartphone. The study aims to better understand how everyday digital behaviour relates to brain activity and attention.'],
  },
  {
    id: 'what',
    title: 'What will I be asked to do?',
    summary: 'Two laboratory visits of about two hours, a temporary restriction period in between, and a data donation.',
    detail: [
      'If you agree to participate, you will attend two laboratory sessions (before and after the intervention period), complete a temporary smartphone restriction period using a hardware device called Brick, and donate summary smartphone usage data.',
      'Visit 1, baseline (about 2 hours): an EEG recording (measurement of brain activity); an ECG recording (measurement of heart activity using small sensors on the skin); an eye-tracking system while completing computer tasks; computer-based cognitive tasks; and questionnaires about wellbeing and digital behaviour.',
      'Visit 2, post-intervention (about 2 hours): the EEG and ECG recordings and eye-tracking are repeated, together with the cognitive tasks and follow-up questionnaires.',
    ],
  },
  {
    id: 'restriction',
    title: 'What is the smartphone restriction phase?',
    summary: 'Between the visits, a device called Brick restricts selected apps for two weeks to a month. Calls and essential apps keep working.',
    detail: [
      'Between the two laboratory visits you will complete a temporary smartphone restriction period lasting between two weeks and one month.',
      'During this period, a hardware device (Brick) will restrict access to selected applications (for example, social media apps). Essential phone functions such as calls, messages, and necessary apps will remain accessible. The specific apps to be restricted will be agreed with you in advance. If you decide you no longer wish to continue the restriction period, you may withdraw from the study at any time.',
    ],
  },
  {
    id: 'donation',
    title: 'Smartphone usage data',
    summary: 'Summary usage information, such as time spent on apps. No messages, photos, contacts or passwords.',
    detail: [
      'As part of this study, participants donate summary smartphone usage information through the Smart Data Donation Service (SDDS). This system provides aggregated usage statistics, such as time spent on applications. It does not provide access to personal content, including messages, photos, contacts, passwords, or browsing history. Because these usage summaries are necessary for the research, participation in the study includes donating this information through SDDS.',
    ],
    note: 'SDDS is not ready yet, so for now this website carries out the donation step: you download your own data from TikTok and YouTube, remove anything you do not want to share on your own device, and send the rest here. Donations will go through SDDS once it is available.',
  },
  {
    id: 'measures',
    title: 'What are EEG, ECG and eye-tracking?',
    summary: 'Safe, painless recordings of brain activity, heart activity and where your eyes look.',
    detail: [
      'EEG (electroencephalography) records natural electrical activity from the brain using small sensors placed on the scalp. EEG does not deliver electrical stimulation and is widely used in neuroscience research. You may feel mild pressure from the headset, but the procedure should not be painful.',
      'ECG (electrocardiography) measures the electrical activity of the heart using small sensors placed on the skin. The procedure is safe, painless, and commonly used in research and clinical settings.',
      'Eye-tracking measures where and how your eyes move while you look at images or complete computer tasks. A small camera positioned near the computer screen records eye movements. The system does not record personal images or identify individuals.',
    ],
  },
  {
    id: 'risks',
    title: 'Are there any risks?',
    summary: 'No known serious risks. Some inconvenience from restricted apps, and mild discomfort from the sensors.',
    detail: ['There are no known serious risks associated with these measurements. Possible risks include temporary inconvenience due to restricted access to selected smartphone applications and mild discomfort from wearing the EEG headset or ECG sensors.'],
  },
  {
    id: 'voluntary',
    title: 'Do I have to take part?',
    summary: 'No. You can withdraw at any time without giving a reason.',
    detail: ['No. Taking part is completely voluntary. You may withdraw from the study at any time without giving a reason and without any negative consequences.'],
  },
  {
    id: 'compensation',
    title: 'Compensation',
    summary: '£25 for each laboratory session, plus £25 for completing all parts of the study: £75 in total.',
    detail: [
      'You will receive £25 for each laboratory session you attend, plus £25 for completing all parts of the study, £75 in total. Compensation is provided for each completed session. No additional payment is provided for the social media restriction period. Participation in this phase is voluntary and you may discontinue at any time without penalty.',
      'If you withdraw before completing the study, you will receive compensation proportional to the sessions completed.',
    ],
  },
  {
    id: 'confidentiality',
    title: 'Confidentiality and data protection',
    summary: 'The University of Leeds is the data controller. Research data are labelled with a study code and reported only in group form.',
    detail: [
      'The University of Leeds acts as the Data Controller for this research. Identifiable information will be stored separately from research data. Data will be labelled using a study ID code rather than your name. Results will be analysed and reported anonymously at the group level. Anonymised findings may be published in academic journals, conference presentations, reports, or academic theses.',
      'You may request withdrawal of your identifiable research data within one month after your final session. After this period, data may be de-identified and may no longer be retrievable.',
      'The University Research Participant Privacy Notice is available from the University of Leeds. This study has received ethical approval from the University of Leeds School of Psychology Research Ethics Committee.',
    ],
  },
];

export const labStudy = {
  studyId: 'MPMB-LAB',
  name: 'Social media break study',
  /** Wording used in headings; the approved documents call it the intervention study. */
  formalName: 'MyPhone/MyBrain intervention study',
  minAge: 18,
  maxAge: 24,
  ethicsReference: 'SoPREC 4202',
  /** The committee's approval date, shown with the reference. */
  ethicsApproved: '11 June 2026',
  contact: {
    name: 'Miftah Faizah',
    email: 'M.Faizah@leeds.ac.uk',
    lead: 'Professor Faisal Mushtaq',
    leadEmail: 'F.Mushtaq@leeds.ac.uk',
    team: 'School of Psychology, University of Leeds',
  },
  /** Largest cleaned archive and screenshot the site will take. */
  maxArchiveBytes: 60 * 1024 * 1024,
  maxScreenshots: 12,
};

/**
 * The participant code, built exactly as the lab questionnaire builds it so
 * the two match: first two letters of your mother's first name, the first
 * digit of your house number, the month you were born (two digits), and the
 * last two letters of your postcode. For example Jane, 123, January, AB1 2CD
 * gives JA101CD. The four answers themselves are also kept, with the consent
 * record (identifying data, never in the research dataset): the team uses
 * them as research variables too.
 */
export const PARTICIPANT_CODE = /^[A-Z]{2}\d(0[1-9]|1[0-2])[A-Z]{2}$/;

export interface CodeParts {
  mother: string;
  house: string;
  month: string;
  postcode: string;
}

export function buildParticipantCode(parts: CodeParts): string {
  const letters = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '');
  const mother = letters(parts.mother).slice(0, 2);
  const house = parts.house.replace(/\D/g, '').slice(0, 1);
  const month = parts.month.replace(/\D/g, '');
  const postcode = letters(parts.postcode).slice(-2);
  const mm = month.length === 1 ? `0${month}` : month.slice(-2);
  return `${mother}${house}${mm}${postcode}`;
}

export function normaliseParticipantCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
