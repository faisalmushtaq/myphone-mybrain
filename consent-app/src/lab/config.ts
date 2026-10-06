/**
 * The social media break study (the laboratory study for adults): who it is
 * for, the approved participant information and consent wording, and the
 * participant-code scheme. Plain data with no imports, because the server's
 * build reads this file too (firebase/functions/scripts/generate-forms.mjs).
 *
 * The information follows the participant information sheet of 21 February
 * 2026 (SoPREC 4202), with two adaptations: the sheet says files are uploaded
 * to Qualtrics and names TikTok and YouTube; this website does the upload and
 * Instagram is also accepted. The consent statements follow the approved form
 * except the two that described the data donation, redrafted to match the new
 * sheet (version 2.0-draft until the committee has seen them).
 */

export interface LabStatement {
  id: string;
  version: string;
  /** Required statements must be agreed to take part; an optional one is a Yes or No choice. */
  kind: 'required' | 'optional';
  text: string;
  /** Short label used in summaries and the PDF copy. */
  label: string;
  /** Shown under the statement when the approved wording is being updated. */
  note?: string;
}

export const labConsentForm: { id: string; version: string; title: string; statements: LabStatement[] } = {
  id: 'mpmb-lab-consent',
  version: '2.0-draft',
  title: 'Participant consent form',
  statements: [
    { id: 'read-information', version: '1.0', kind: 'required', label: 'Read the information', text: 'I confirm that I have read and understood the Participant Information Sheet.' },
    {
      id: 'involves',
      version: '2.0-draft',
      kind: 'required',
      label: 'What taking part involves',
      text: 'I understand that participation in this study involves: two laboratory sessions; a 30-day social media break using Brick to restrict agreed apps; completion of questionnaires, computer-based tasks and brief weekly check-ins; and sharing my smartphone and social media usage data, which I download, review and clean myself, together with screen-time screenshots.',
    },
    { id: 'voluntary', version: '1.0', kind: 'required', label: 'Voluntary', text: 'I understand that participation is voluntary and that I may withdraw at any time without giving a reason.' },
    {
      id: 'data-kept',
      version: '0.1-draft',
      kind: 'required',
      label: 'What I send is kept unless I withdraw',
      text: 'I understand that everything I send, including screen-time screenshots, cleaned data files and questionnaire answers, is kept and may be used in the research even if I do not finish the study. Stopping, or not coming back, does not remove it. To have it removed, I must contact the research team and ask to withdraw, within one month of my final session.',
      note: 'Draft wording, to be confirmed with the ethics committee. It matches the information sheet: removal of identifiable data can be requested within one month of the final session.',
    },
    {
      id: 'donation-required',
      version: '2.0-draft',
      kind: 'required',
      label: 'Sharing usage data is part of the study',
      text: 'I understand that sharing the required usage information is a necessary part of taking part in this study.',
    },
    { id: 'publication', version: '1.0', kind: 'required', label: 'Publication', text: 'I understand that anonymised results from this research may be published in academic journals, conference presentations, reports, or academic theses.' },
    { id: 'data-protection', version: '1.0', kind: 'required', label: 'Data protection', text: 'I understand that my data will be stored securely and handled in accordance with UK data protection legislation.' },
    {
      id: 'link-records',
      version: '0.1-draft',
      kind: 'optional',
      label: 'Linking with records already held',
      text: 'My study information may be linked, through Connected West Yorkshire, with records already held about me: NHS health records, education records, and other routinely collected records.',
      note: 'Optional: you can take part without this. Linking means adding information from records that already exist, so the study can look at longer-term patterns in health, learning and wellbeing. It happens only with the approvals in place (the study’s ethics approval, NHS Research Ethics Committee approval for NHS records, permission from each record holder, and Connected West Yorkshire’s own data access process). Linked information is labelled with your participant code, not your name. Draft wording, to be confirmed with the governance team, matching the approval held for the schools study.',
    },
    { id: 'take-part', version: '1.0', kind: 'required', label: 'Agree to take part', text: 'I voluntarily agree to take part in the MyPhone/MyBrain intervention study.' },
  ],
};

export interface LabInfoSection {
  id: string;
  title: string;
  summary: string;
  detail: string[];
  note?: string;
}

export const labInformationVersion = { version: '2.0', label: 'Participant information sheet of 21 February 2026' };

export const labInformation: LabInfoSection[] = [
  {
    id: 'purpose',
    title: 'What is the purpose of the study?',
    summary: 'How short-term changes in smartphone use relate to brain activity, attention and wellbeing.',
    detail: [
      'This study examines how short-term changes in smartphone use relate to brain activity, physiological responses, attention, and wellbeing. During laboratory sessions we will measure brain activity using electroencephalography (EEG), heart activity using electrocardiography (ECG), and eye movements using an eye-tracking system.',
      'To understand how changes in digital behaviour relate to these processes, the study also requires objective information about your smartphone and social media use.',
    ],
  },
  {
    id: 'invited',
    title: 'Why have I been invited?',
    summary: 'You are 18 to 24 years old and regularly use social media.',
    detail: ['You have been invited because you are 18 to 24 years old and regularly use social media. The study aims to better understand how everyday digital behaviour relates to brain activity.'],
  },
  {
    id: 'what',
    title: 'What will I be asked to do?',
    summary: 'Two lab visits of about two hours, a 30-day social media break in between, your usage data, and brief weekly check-ins.',
    detail: [
      'If you agree to participate, you will: attend two laboratory sessions, approximately two hours each; take a 30-day social media break using Brick to restrict agreed apps; follow our guide to download, review and clean your social media usage data, then upload it and your screen-time screenshots on this website; and complete brief weekly check-ins and share screen-time screenshots.',
      'Visit 1, baseline (about 2 hours): an EEG recording (measurement of brain activity); an ECG recording (measurement of heart activity using small sensors on the skin); an eye-tracking system while completing computer tasks; computer-based cognitive tasks; and questionnaires about wellbeing and digital behaviour.',
      'Visit 2, post-intervention (about 2 hours): the EEG and ECG recordings are repeated, with eye-tracking during tasks, the cognitive tasks again, and follow-up questionnaires.',
    ],
  },
  {
    id: 'restriction',
    title: 'What is the social media restriction phase?',
    summary: 'Between the visits, a 30-day break from agreed social media apps using a device called Brick. Calls, messages, WhatsApp and essential apps keep working.',
    detail: [
      'Between the two laboratory visits, you will be asked to take a 30-day break from social media.',
      'A physical device called Brick will be used to restrict agreed social media apps on your smartphone. During this period, you will also be asked not to access the restricted platforms through internet browsers, laptops, tablets, other computers, or another person’s device or account. The platforms to be restricted will be agreed with you in advance.',
      'WhatsApp may still be used for direct messages and calls. Essential phone functions, including calls, text messages, maps, banking, and email, will remain accessible.',
      'If you decide you no longer wish to continue the restriction period, you may withdraw from the study at any time.',
    ],
  },
  {
    id: 'donation',
    title: 'Smartphone and social media usage data',
    summary: 'Screenshots of your screen-time summary, and your own TikTok, YouTube or Instagram data, reviewed and cleaned by you before you share it.',
    detail: [
      'As part of this study, you will be asked to share information about your smartphone and social media use. We will provide a step-by-step guide explaining how to take screenshots of your phone’s Screen Time (iPhone) or Digital Wellbeing (Android) summary and how to download your TikTok, YouTube and/or Instagram usage data.',
      'This website includes a data-cleaning tool that you can use to review and remove information from your downloaded data before uploading the cleaned files. The guide explains which usage information is needed for the study and how to prepare your files.',
      'Sharing the required usage information is a necessary part of taking part in this study. If you have any questions or need help preparing your data, please contact the research team before uploading your files.',
    ],
  },
  {
    id: 'measures',
    title: 'What are EEG, ECG and eye-tracking?',
    summary: 'Safe, painless recordings of brain activity, heart activity and where your eyes look.',
    detail: [
      'EEG (electroencephalography) records natural electrical activity from the brain using small sensors placed on the scalp. EEG does not deliver electrical stimulation and is widely used in neuroscience research. You may feel mild pressure from the headset, but the procedure should not be painful.',
      'ECG (electrocardiography) measures the electrical activity of the heart using small sensors placed on the skin. The procedure is safe, painless, and commonly used in research and clinical settings.',
      'Eye-tracking measures where and how your eyes move while you look at images or complete computer tasks. You will wear eye-tracking glasses that record your eye movements and where you look while completing computer tasks. The system does not record personal images or identify individuals.',
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
    summary: 'No. You can withdraw at any time without giving a reason. What you have already sent is kept unless you contact us to withdraw it.',
    detail: [
      'No. Taking part is completely voluntary. You may withdraw from the study at any time without giving a reason and without any negative consequences.',
      'Anything you have already sent, such as screen-time screenshots, cleaned data files and questionnaire answers, is kept and may be used in the research even if you do not finish the study. Stopping, or simply not coming back, does not remove it. If you want it removed, contact the research team and ask to withdraw; you can do this up to one month after your final session.',
    ],
  },
  {
    id: 'compensation',
    title: 'Compensation',
    summary: '£25 for each completed laboratory visit, plus £25 for completing all parts of the study: up to £75 in total.',
    detail: ['You will receive £25 for each completed laboratory visit, plus an additional £25 for completing all parts of the study, up to £75 in total. If you withdraw early, you will still receive £25 for each laboratory visit you have completed. There is no separate payment for each day of the social media break.'],
  },
  {
    id: 'confidentiality',
    title: 'Confidentiality and data protection',
    summary: 'The University of Leeds is the data controller. Research data are labelled with a study ID code and reported only in group form.',
    detail: [
      'The University of Leeds acts as the Data Controller for this research. Identifiable information will be stored separately from research data. Data will be labelled using a study ID code rather than your name. Results will be analysed and reported anonymously at the group level. Anonymised findings may be published in academic journals, conference presentations, reports, or academic theses.',
      'You may request removal of your identifiable research data within one month after your final session. After this period, your data may have been anonymised, making it impossible to identify and remove your individual data.',
      'The University Research Participant Privacy Notice is available from the University of Leeds. This study has received ethical approval from the University of Leeds School of Psychology Research Ethics Committee (ethics reference SoPREC 4202).',
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
  /** The apps whose exports the cleaner understands; participants donate from whichever they use most. */
  platforms: ['tiktok', 'youtube', 'instagram'] as const,
  /** Largest cleaned archive the site will take. */
  maxArchiveBytes: 60 * 1024 * 1024,
  /** Screenshots accepted before the break, and again after it. */
  maxScreenshots: 12,
  /** Screenshots accepted across all the check-ins during the break. */
  maxCheckInScreenshots: 30,
};

/**
 * The three pages of the study, each its own short flow on the website, all
 * keyed by the participant code:
 *   baseline  /break/take-part/  consent, then screenshots and app data before the break
 *   checkin   /break/check-in/   during the break: a few questions, optional screenshots, MyStory
 *   after     /break/after/      after the break: a reminder (no new consent), screenshots and app data
 * Each send is filed under the phase of the page it came from (pre, mid,
 * post), so nobody is asked whether their files are from before or after.
 */
export const labPages = {
  baseline: { path: '/break/take-part/', phase: 'pre', label: 'Before your break' },
  checkin: { path: '/break/check-in/', phase: 'mid', label: 'Mid-break check-in' },
  after: { path: '/break/after/', phase: 'post', label: 'After your break' },
} as const;

export type LabCheckInQuestion =
  | { id: string; version: string; type: 'choice'; label: string; text: string; hint?: string; required: boolean; options: { value: string; label: string }[] }
  | { id: string; version: string; type: 'text'; label: string; text: string; hint?: string; required: boolean; maxLength: number };

/**
 * The mid-break check-in: a few quick questions, asked each time someone
 * checks in (the information sheet promises brief weekly check-ins). Draft
 * wording, to be replaced by the team's agreed items; ids and versions are
 * what the server accepts and the export's data dictionary describes.
 */
export const labCheckInForm: { id: string; version: string; title: string; questions: LabCheckInQuestion[] } = {
  id: 'mpmb-lab-checkin',
  version: '0.1-draft',
  title: 'Mid-break check-in',
  questions: [
    {
      id: 'week',
      version: '0.1-draft',
      type: 'choice',
      label: 'Week of the break',
      text: 'Which week of your social media break are you in?',
      required: true,
      options: [
        { value: '1', label: 'Week 1 (days 1 to 7)' },
        { value: '2', label: 'Week 2 (days 8 to 14)' },
        { value: '3', label: 'Week 3 (days 15 to 21)' },
        { value: '4', label: 'Week 4 (days 22 to 30)' },
      ],
    },
    {
      id: 'apps-used',
      version: '0.1-draft',
      type: 'choice',
      label: 'Use of the restricted apps',
      text: 'In the past week, how often have you used any of the apps you agreed to take a break from, on any device?',
      hint: 'There is no wrong answer; an honest one helps the study most.',
      required: true,
      options: [
        { value: 'never', label: 'Not at all' },
        { value: 'once-or-twice', label: 'Once or twice' },
        { value: 'few-times', label: 'A few times' },
        { value: 'most-days', label: 'Most days' },
        { value: 'every-day', label: 'Every day' },
      ],
    },
    {
      id: 'mood',
      version: '0.1-draft',
      type: 'choice',
      label: 'Mood this week',
      text: 'Overall, how have you been feeling in the past week?',
      required: true,
      options: [
        { value: '1', label: 'Very low' },
        { value: '2', label: 'Low' },
        { value: '3', label: 'Okay' },
        { value: '4', label: 'Good' },
        { value: '5', label: 'Very good' },
      ],
    },
    {
      id: 'difficulty',
      version: '0.1-draft',
      type: 'choice',
      label: 'How hard the break has been',
      text: 'How hard has the break been in the past week?',
      required: true,
      options: [
        { value: '1', label: 'Very easy' },
        { value: '2', label: 'Easy' },
        { value: '3', label: 'Neither easy nor hard' },
        { value: '4', label: 'Hard' },
        { value: '5', label: 'Very hard' },
      ],
    },
    {
      id: 'missed',
      version: '0.1-draft',
      type: 'choice',
      label: 'Missing social media',
      text: 'How much have you missed social media in the past week?',
      required: true,
      options: [
        { value: '1', label: 'Not at all' },
        { value: '2', label: 'A little' },
        { value: '3', label: 'Quite a lot' },
        { value: '4', label: 'A great deal' },
      ],
    },
    {
      id: 'notes',
      version: '0.1-draft',
      type: 'text',
      label: 'Anything else',
      text: 'Anything else you would like to tell us about this week? (optional)',
      hint: 'For example, problems with Brick, or something that made the break easier or harder.',
      required: false,
      maxLength: 1000,
    },
  ],
};

/**
 * MyStory, the study's conversation tool: after a check-in, participants can
 * talk it through in their own words. Not live yet, so url is null and the
 * check-in page says it is coming. When it is, set url; the page then opens
 * it in a new tab with the participant code added as the codeParam query
 * parameter, so the conversation is filed under the same code, never a name.
 */
export const labMyStory: { name: string; url: string | null; codeParam: string } = {
  name: 'MyStory',
  url: null,
  codeParam: 'code',
};

/**
 * The participant code, built exactly as the lab questionnaire builds it so
 * the two match: the first two letters of your own first name, the first
 * digit of your house number, the month you were born (two digits), and the
 * last two letters of your postcode. For example Jane, 123, January, AB1 2CD
 * gives JA101CD. The person's own name (not a parent's) keeps twins apart,
 * who share everything else; twins whose names start with the same two
 * letters still share a code, and the code step tells the second of them to
 * contact the team. Accents are dropped (Élodie gives EL), as a person
 * writing the letters would. The four answers themselves are also kept, with
 * the consent record (identifying data, never in the research dataset): the
 * team uses them as research variables too.
 */
export const PARTICIPANT_CODE = /^[A-Z]{2}\d(0[1-9]|1[0-2])[A-Z]{2}$/;

export interface CodeParts {
  firstName: string;
  house: string;
  month: string;
  postcode: string;
}

/** Plain capital letters only, accents dropped first: "Élodie" gives "ELODIE". */
function plainLetters(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
}

export function buildParticipantCode(parts: CodeParts): string {
  const letters = plainLetters;
  const name = letters(parts.firstName).slice(0, 2);
  const house = parts.house.replace(/\D/g, '').slice(0, 1);
  const month = parts.month.replace(/\D/g, '');
  const postcode = letters(parts.postcode).slice(-2);
  const mm = month.length === 1 ? `0${month}` : month.slice(-2);
  return `${name}${house}${mm}${postcode}`;
}

/** Whether a first name gives the code its two letters. */
export function nameHasTwoLetters(firstName: string): boolean {
  return plainLetters(firstName).length >= 2;
}

/**
 * The shape of a full UK postcode, in its standard form with one space:
 * outward code (one or two letters, a digit, then optionally a letter or
 * digit) and inward code (a digit and two letters), plus the special GIR 0AA.
 * Only the shape is checked, so no real postcode is refused. The inward code
 * always ends in two letters, so a valid postcode always gives the
 * participant code its last two letters.
 */
export const UK_POSTCODE = /^(GIR 0AA|[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2})$/;

/** Upper-cased with one space before the inward code ("ls29jt" → "LS2 9JT"); returned unchanged when it is not a UK postcode. */
export function formatPostcode(input: string): string {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const spaced = compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
  return UK_POSTCODE.test(spaced) ? spaced : input.trim().toUpperCase();
}

export function isUkPostcode(input: string): boolean {
  return UK_POSTCODE.test(formatPostcode(input));
}

export function normaliseParticipantCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
