/**
 * The social media break study (the laboratory study for adults): who it is
 * for, the approved participant information and consent wording, and the
 * participant ID recipe. Plain data with no imports, because the server's
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
  /** Shown under the statement, for the participant. */
  note?: string;
  /** An internal remark about the wording's approval: shown only in preview (prototype) builds. */
  draft?: string;
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
      draft: 'Draft wording, to be confirmed with the ethics committee. It matches the information sheet: removal of identifiable data can be requested within one month of the final session.',
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
      note: 'Optional: you can take part without this. Linking means adding information from records that already exist, so the study can look at longer-term patterns in health, learning and wellbeing. It happens only with the approvals in place (the study’s ethics approval, NHS Research Ethics Committee approval for NHS records, permission from each record holder, and Connected West Yorkshire’s own data access process). Linked information is labelled with your participant ID, not your name.',
      draft: 'Draft wording, to be confirmed with the governance team, matching the approval held for the schools study.',
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
 * keyed by the participant ID:
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
 * it in a new tab with the participant ID added as the codeParam query
 * parameter, so the conversation is filed under the same code, never a name.
 */
export const labMyStory: { name: string; url: string | null; codeParam: string } = {
  name: 'MyStory',
  url: null,
  codeParam: 'code',
};

/**
 * The participant ID: built from four details the person knows, the same
 * way on this website and in the study's survey platform, so the two match
 * without anyone remembering a code and without a name on the research data.
 * The recipe (docs/participant-id.md has it with worked examples, and code
 * for other platforms):
 *   1. First name and last name: Unicode NFKD, upper case, then letters only
 *      (accents, spaces, hyphens and apostrophes go: "Élodie" gives ELODIE,
 *      "O'Brien-Smith" gives OBRIENSMITH).
 *   2. Date of birth as eight digits, YYYYMMDD.
 *   3. Postcode in upper case, letters and digits only ("ls2 9jt" gives LS29JT).
 *   4. Joined with "|": JANE|SMITH|20050314|LS29JT.
 *   5. SHA-256 of that text (UTF-8), in hexadecimal.
 *   6. "MP" and the first 12 hexadecimal digits, in capitals: MP2670FF90A5F2.
 * Twins get different IDs because their first names differ. The ID is not
 * anonymous (anyone who knows the four details can rebuild it), so it is
 * handled as personal data; the four details are kept with the consent
 * record (identifying data, never in the research dataset).
 */
export const PARTICIPANT_CODE = /^MP[0-9A-F]{12}$/;

export interface CodeParts {
  firstName: string;
  lastName: string;
  /** As typed or picked; the ID uses it as YYYYMMDD. */
  dateOfBirth: { day: string; month: string; year: string };
  /** The postcode where the person lived when they signed up. */
  postcode: string;
}

/** A name as the ID uses it: NFKD, upper case, letters only. "Mary-Jane" gives MARYJANE, "Zoë" gives ZOE. */
export function idName(s: string): string {
  return Array.from(s.normalize('NFKD').toUpperCase())
    .filter((c) => /\p{L}/u.test(c))
    .join('');
}

/** A postcode as the ID uses it: upper case, letters and digits only. */
export function idPostcode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** YYYY-MM-DD when the parts make a real date, else null. */
export function isoDateOf(dob: { day: string; month: string; year: string }): string | null {
  const [d, m, y] = [dob.day, dob.month, dob.year].map((v) => (/^\d{1,4}$/.test(v.trim()) ? Number.parseInt(v, 10) : Number.NaN));
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Whole years from a date of birth (YYYY-MM-DD) to a day (default today). */
export function ageFrom(isoDob: string, today = new Date()): number {
  const [y, m, d] = isoDob.split('-').map((n) => Number.parseInt(n, 10));
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
  return age;
}

/** The text the ID is the hash of, for example JANE|SMITH|20050314|LS29JT; null until every detail is usable. */
export function participantIdKey(parts: CodeParts): string | null {
  const first = idName(parts.firstName);
  const last = idName(parts.lastName);
  const dob = isoDateOf(parts.dateOfBirth);
  const postcode = idPostcode(parts.postcode);
  if (!first || !last || !dob || !postcode) return null;
  return `${first}|${last}|${dob.replace(/-/g, '')}|${postcode}`;
}

/** The four details as sent with the consent and kept with it: names trimmed, the date YYYY-MM-DD, the postcode in its standard form. */
export function idDetails(parts: CodeParts): { firstName: string; lastName: string; dateOfBirth: string; postcode: string } | null {
  const dateOfBirth = isoDateOf(parts.dateOfBirth);
  if (!dateOfBirth || !participantIdKey(parts)) return null;
  return { firstName: parts.firstName.trim(), lastName: parts.lastName.trim(), dateOfBirth, postcode: formatPostcode(parts.postcode) };
}

/** The participant ID for the four details (see PARTICIPANT_CODE), or null until they are complete. */
export async function buildParticipantId(parts: CodeParts): Promise<string | null> {
  const key = participantIdKey(parts);
  if (!key) return null;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `MP${hex.slice(0, 12).toUpperCase()}`;
}

/**
 * The shape of a full UK postcode, in its standard form with one space:
 * outward code (one or two letters, a digit, then optionally a letter or
 * digit) and inward code (a digit and two letters), plus the special GIR 0AA.
 * Only the shape is checked, so no real postcode is refused.
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
