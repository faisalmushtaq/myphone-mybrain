/**
 * The social media break study (the laboratory study for adults): who it is
 * for, the approved participant information and consent wording, and the
 * participant ID recipe. Plain data with no imports, because the server's
 * build reads this file too (firebase/functions/scripts/generate-forms.mjs).
 *
 * The information and consent follow the amended participant information sheet
 * (version 2.3, October 2026) and consent form (2.2; control group 1.2) of the
 * ethics amendment to SoPREC - 2026 4202-7027, put live on 27 October 2026 with
 * the MyStory and AI statements. The earlier versions are still accepted from
 * pages loaded before the change (labEarlierConsentForms,
 * labEarlierInformationVersions).
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

/** Version 2.1-draft (8 October 2026), kept so that a page loaded before 27 October 2026 can still be sent. */
const labConsentFormV2_1: { id: string; version: string; title: string; statements: LabStatement[] } = {
  id: 'mpmb-lab-consent',
  // 2.1: "data-kept" covers machine learning, "link-records" names the Department for Education (8 October 2026).
  version: '2.1-draft',
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
      version: '0.2-draft',
      kind: 'required',
      label: 'What I send is kept unless I withdraw',
      text: 'I understand that everything I send, including screen-time screenshots, cleaned data files and questionnaire answers, is kept and may be used in the research, including analysis using machine learning (computers finding patterns in data), even if I do not finish the study. Stopping, or not coming back, does not remove it. To have it removed, I must contact the research team and ask to withdraw, within one month of my final session.',
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
      version: '0.2-draft',
      kind: 'optional',
      label: 'Linking with records already held',
      text: 'My study information may be linked, through Connected West Yorkshire, with records already held about me: NHS health records, education records (including those held by the Department for Education), and other routinely collected records.',
      note: 'Optional: you can take part without this. Linking means adding information from records that already exist, so the study can look at longer-term patterns in health, learning and wellbeing. It happens only with the approvals in place (the study’s ethics approval, NHS Research Ethics Committee approval for NHS records, permission from each record holder, and Connected West Yorkshire’s own data access process). Linked information is labelled with your participant ID, not your name.',
      draft: 'Draft wording, to be confirmed with the governance team, matching the approval held for the schools study.',
    },
    { id: 'take-part', version: '1.0', kind: 'required', label: 'Agree to take part', text: 'I voluntarily agree to take part in the MyPhone/MyBrain intervention study.' },
  ],
};

export const labConsentForm: { id: string; version: string; title: string; statements: LabStatement[] } = {
  id: 'mpmb-lab-consent',
  // 2.2 (27 October 2026): the amended wording for the ethics amendment: weekly check-ins, MyStory and the AI interviewer,
  // daily texts, open EEG sharing. 2.1-draft is still accepted from pages loaded before the change (labEarlierConsentForms).
  version: '2.2',
  title: 'Participant consent form',
  statements: [
    { id: 'read-information', version: '1.0', kind: 'required', label: 'Read the information', text: 'I confirm that I have read and understood the Participant Information Sheet.' },
    {
      id: 'involves',
      version: '2.2',
      kind: 'required',
      label: 'What taking part involves',
      text: 'I understand that participation in this study involves: two laboratory sessions; a 30-day social media break using Brick to restrict agreed apps; completion of questionnaires and computer-based tasks, and short weekly check-ins during the break (on days 8, 15, 22 and 29), each with a screen-time screenshot; sharing my smartphone and social media usage data, which I download, review and clean myself, together with screen-time screenshots; taking part in MyStory, a short conversation with an AI chatbot, before, during and after the break; and receiving a short text message each day during the break.',
    },
    { id: 'voluntary', version: '1.0', kind: 'required', label: 'Voluntary', text: 'I understand that participation is voluntary and that I may withdraw at any time without giving a reason.' },
    {
      id: 'data-kept',
      version: '1.0',
      kind: 'required',
      label: 'What I send is kept unless I withdraw',
      text: 'I understand that everything I send, including screen-time screenshots, cleaned data files and questionnaire answers, is kept and may be used in the research, including analysis using machine learning (computers finding patterns in data), if I stop before the end of the study. To have it removed, I can ask the research team to withdraw it within one month of my final session.',
    },
    {
      id: 'donation-required',
      version: '2.0',
      kind: 'required',
      label: 'Sharing usage data is part of the study',
      text: 'I understand that sharing the required usage information is a necessary part of taking part in this study.',
    },
    {
      id: 'mystory-ai',
      version: '1.0',
      kind: 'required',
      label: 'MyStory and the AI chatbot',
      text: 'I understand that MyStory, which forms part of the study at each stage, is a conversation with Remi, an AI chatbot, and that the words I type or say are sent to the AI service OpenAI, which processes them within the European Economic Area and acts for the University under its data processing terms, to produce Remi’s replies. My name and participant ID stay within the study, OpenAI is asked not to store the conversation and may hold it for up to 30 days, and if I mention that I am struggling, Remi will give me support contacts and the research team will review the conversation.',
    },
    {
      id: 'mystory-kept',
      version: '1.0',
      kind: 'required',
      label: 'My MyStory conversations are kept',
      text: 'I understand that my MyStory conversations, including recordings if I choose to speak my answers, are stored securely and may be analysed, including with machine learning (computers finding patterns in data).',
    },
    { id: 'publication', version: '1.0', kind: 'required', label: 'Publication', text: 'I understand that anonymised results from this research may be published in academic journals, conference presentations, reports, or academic theses.' },
    {
      id: 'open-data',
      version: '1.0',
      kind: 'required',
      label: 'Open EEG data and approved access',
      text: 'I understand that fully anonymised EEG data will be shared openly through research platforms such as G-Node, EEGNet and OpenNeuro, and that study data will be available to approved researchers through the Born in Bradford Executive.',
    },
    { id: 'data-protection', version: '1.0', kind: 'required', label: 'Data protection', text: 'I understand that my data will be stored securely and handled in accordance with UK data protection legislation.' },
    {
      id: 'link-records',
      version: '1.0',
      kind: 'optional',
      label: 'Linking with records already held',
      text: 'My study information may be linked, through Connected West Yorkshire, with records already held about me, including NHS health records, education records (including those held by the Department for Education) and other routinely collected records.',
      note: 'Optional: you can take part without this. Linking means adding information from records that already exist, so the study can look at longer-term patterns in health, learning and wellbeing. It happens only with the approvals in place (the study’s ethics approval, NHS Research Ethics Committee approval for NHS records, permission from each record holder, and Connected West Yorkshire’s own data access process). Linked information is labelled with your participant ID, not your name.',
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

/**
 * 2.3 (27 October 2026): the amended sheet for the ethics amendment (weekly check-ins, MyStory and the AI interviewer, daily
 * texts, visits, storage, linkage and open data). 2.2 (the sheet of 21 February 2026, ages 18 to 24) is still accepted from
 * pages loaded before the change. Consents record the version they were shown.
 */
export const labInformationVersion = { version: '2.3', label: 'Participant information sheet, version 2.3 (October 2026)' };
/** Earlier versions the server still accepts with a consent, for anyone who loaded the page before an update. */
export const labEarlierInformationVersions = { break: ['2.2'], control: ['2.2-control'] };

export const labInformation: LabInfoSection[] = [
  {
    id: 'purpose',
    title: 'What is the purpose of the study?',
    summary: 'How short-term changes in smartphone use relate to brain activity, attention and wellbeing.',
    detail: [
      'This study examines how short-term changes in smartphone use relate to brain activity, physiological responses, attention, and wellbeing. During laboratory sessions we will measure brain activity using electroencephalography (EEG), heart activity using electrocardiography (ECG), and eye movements using an eye-tracking system.',
      'To understand how changes in digital behaviour relate to these processes, the study also requires objective information about smartphone and social media use.',
    ],
  },
  {
    id: 'invited',
    title: 'Why have I been invited?',
    summary: 'You are 18 to 24 years old and regularly use social media.',
    detail: [
      'You have been invited because you are 18 to 24 years old and regularly use social media. The study aims to better understand how everyday digital behaviour relates to brain activity.',
      'People with a known history of epilepsy or seizures are unable to take part, as in extremely rare cases EEG recordings may trigger a seizure.',
    ],
  },
  {
    id: 'what',
    title: 'What will I be asked to do?',
    summary: 'Two lab visits of about two hours, a 30-day social media break in between, your usage data, short weekly check-ins and MyStory.',
    detail: [
      'If you agree to participate, you will: attend two laboratory sessions, approximately two hours each; take a 30-day social media break using Brick to restrict agreed apps; follow our guide to download, review and clean your social media usage data, then upload it with your screen-time screenshots on this website, before your first visit and again at the end of the break; complete short weekly check-ins on days 8, 15, 22 and 29 of the break, each with a few short questions and a screen-time screenshot (the day-15 check-in, halfway through the break, also includes MyStory); take part in MyStory, a short conversation with an AI chatbot, after you first share your data, at the day-15 check-in and after the break; book both laboratory visits on this website, with the second visit 30 to 35 days after the first; and receive a short text message each morning during the break, or an email if a text cannot be sent.',
      'Visit 1, baseline (about 2 hours): an EEG recording (measurement of brain activity); an ECG recording (measurement of heart activity using small sensors on the skin); an eye-tracking system while completing computer tasks; computer-based cognitive tasks; and questionnaires about wellbeing and digital behaviour using MySelf, the research team’s own survey app.',
      'Visit 2, post-intervention (about 2 hours): the EEG and ECG recordings are repeated, with eye-tracking during tasks, the cognitive tasks again, and follow-up questionnaires using MySelf.',
    ],
  },
  {
    id: 'visits',
    title: 'Where and when are the visits?',
    summary: 'In the EEG Lab (LG25), School of Psychology, University of Leeds, between 09:00 and 17:00.',
    detail: [
      'Both visits take place in LG25 (EEG Lab), School of Psychology, University of Leeds, between 09:00 and 17:00, and a researcher will meet you at the main entrance of the School of Psychology. Please bring your phone fully charged, come with clean, dry hair without hair products, bring your glasses or contact lenses if you wear them, and arrive 10 minutes early. You book both visits on this website at the same time and can change them online up to 24 hours beforehand.',
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
    id: 'messages',
    title: 'Messages and the weekly check-ins',
    summary: 'A short text each morning during the break, and a weekly check-in on days 8, 15, 22 and 29.',
    detail: [
      'During the break we will send you a short text message each morning at 9am, from the day after your first visit until the day before your second, to encourage you. If a text cannot be sent, the message comes by email. On days 8, 15, 22 and 29 the message includes the link to that week’s check-in, and later messages remind you until it is complete. The final message gives the date, time and place of your second visit. Texts come from “MyPhoneStdy”, and any replies should be sent to the research team by email.',
      'Each weekly check-in takes a few minutes and includes a few questions about how the break is going and one screenshot of your screen-time summary. The day-15 check-in also includes MyStory and takes about 20 minutes in all.',
      'We will also email you to confirm your bookings, with calendar entries, and send reminders the day before and on the day of each visit.',
    ],
  },
  {
    id: 'donation',
    title: 'Smartphone and social media usage data',
    summary: 'Screenshots of your screen-time summary, and your own TikTok, YouTube or Instagram data, reviewed and cleaned by you before you share it.',
    detail: [
      'As part of this study, you will be asked to share information about your smartphone and social media use. We will provide a step-by-step guide explaining how to take screenshots of your phone’s Screen Time (iPhone) or Digital Wellbeing (Android) summary and how to download your TikTok, YouTube and/or Instagram usage data.',
      'This website includes a data-cleaning tool that you can use to review and remove information from your downloaded data before uploading the cleaned files. The guide explains which usage information is needed for the study and how to prepare your files. The cleaning takes place on your own device before anything is uploaded. Messages, comments, contacts, location, device details, profile details and your own photos and videos are always removed, and you choose which of the remaining categories to share, such as watch history, searches and likes. Any part of a screenshot can also be hidden before you send it.',
      'Sharing the required usage information is a necessary part of taking part in this study. If you have any questions or need help preparing your data, please contact the research team before uploading your files.',
      'At present, everything you share is sent through this website. Once the Smart Data Donation Service at the University of York has completed its secure connections (APIs), the data you donate may be passed to its secure research environment using your study ID only, and we will tell you before this happens.',
    ],
  },
  {
    id: 'mystory',
    title: 'What is MyStory?',
    summary: 'A short conversation with Remi, an AI chatbot, about your experience: after you first share your data, at the day-15 check-in and after the break.',
    detail: [
      'MyStory is a short online conversation about your experience of the break. It is led by Remi (short for “Reflecting on Everyday Media Interactions”), an AI chatbot that the research team set up for this study using a published research method. The method was developed by researchers at King’s College London (Skeggs et al., 2025), and Professor Petr Slovak is working with the team on it. You will complete MyStory three times: after you first share your data, at the day-15 check-in halfway through the break, and after the break. Each conversation takes about 15 minutes.',
      'Remi asks five or six questions written by the research team, one at a time, and may ask a short follow-up question. It then writes three short versions of your story using your own words. You choose the version that fits best, rate it, and can edit it or ask Remi to change it before saving it. You can download a copy as a PDF, print it or email it to yourself.',
      'Remi’s role is to ask the research team’s questions and summarise your answers, and it works only with what you say in the conversation. If you would like advice or support, please use the contacts listed under “Where can I get support?”.',
      'Remi runs on the study’s secure server in London. To produce Remi’s replies, the words you type or say are sent, together with the research team’s instructions, to the AI service OpenAI, which processes them within the European Economic Area and acts for the University under its data processing terms. Your name, participant ID and contact details stay within the study. OpenAI is asked not to store the conversation, excludes it from training its AI, and may hold it for up to 30 days to check for misuse. Please leave out names and other details that could identify you or anyone else.',
      'You may type your answers or, if you prefer, speak them by holding a button. Spoken answers appear as text for you to check and correct before sending. Any recordings are stored securely in the study’s storage, separately from your answers, and can be accessed only by the study coordinators.',
      'MyStory conversations are stored under your participant ID, without your name. The research team reads them only for research, does not use them to identify you, and will not contact you about anything you write. If you need support, please use the numbers under the Help button.',
      'If you mention that you are struggling, for example feeling very low or having thoughts of suicide or self-harm, Remi will pause the questions, respond with care, give you support contacts and ask whether you would like to take a break, stop or carry on. If the conversation ends early, your own words are kept as your story.',
      'MyStory is part of the study at each stage. You can stop at any time, share as much or as little as you wish, or withdraw from the study.',
      'Your conversation, Remi’s versions and the one you choose are analysed by the research team on University of Leeds systems, which may include machine learning (computers finding patterns in data). Information that could identify you is kept out of public AI tools.',
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
    detail: ['There are no known serious risks associated with these measurements. Possible risks include temporary inconvenience due to restricted access to selected smartphone applications and mild discomfort from wearing the EEG headset or ECG sensors. Talking about your experience in MyStory may bring up feelings about your social media use, and you can pause or stop at any time.'],
  },
  {
    // Added on the website (19 October 2026): MyStory's chat sends people "to the numbers on the participant information
    // sheet", so the sheet lists them, the same as the chat's Help (src/lab/story/chatProtocol.ts, chatSupport).
    id: 'support',
    title: 'Where can I get support?',
    summary: 'If you need to talk to someone about how you are feeling: 999 in an emergency, Samaritans 116 123 any time, or the University’s Student Counselling and Wellbeing Service.',
    detail: [
      'The research team does not read what you send straight away, so we cannot give support in the moment. If you need to talk to someone about how you are feeling, please reach out to one of these, or to someone you trust, like a friend or a family member.',
      'In an emergency, or if you don’t feel safe: call 999 or go to A&E.',
      'To talk to someone now: Leeds Crisis Assessment Centre 0800 183 1485, Samaritans 116 123, or text SHOUT to 85258 (all 24 hours).',
      'For support that isn’t urgent: the University Student Counselling and Wellbeing Service, 0113 343 4107 or scw@leeds.ac.uk.',
    ],
  },
  {
    id: 'voluntary',
    title: 'Do I have to take part?',
    summary: 'No. You can withdraw at any time without giving a reason. What you have already sent is kept unless you contact us to withdraw it.',
    detail: [
      'No. Taking part is completely voluntary. You may withdraw from the study at any time without giving a reason and without any negative consequences.',
      'Anything you have already sent, such as screen-time screenshots, cleaned data files and questionnaire answers, is kept and may be used in the research if you stop early. If you would like it removed, please contact the research team within one month of your final session.',
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
    summary: 'The University of Leeds is the data controller. Research data are labelled with your participant ID and reported only in group form.',
    detail: [
      'The University of Leeds acts as the Data Controller for this research. Identifiable information will be stored separately from research data. Data will be labelled using a study ID code rather than your name. Results will be analysed, including with machine learning (computers finding patterns in data), and reported anonymously at the group level. Anonymised findings may be published in academic journals, conference presentations, reports, or academic theses.',
      'We keep your first name, last name, date of birth and postcode, from which your participant ID is made so that you can return on any device, together with your mobile number, email address and consent, separately from the research data. Your screenshots, cleaned data files, answers, MyStory conversations and laboratory recordings are labelled with your participant ID. Information given online is stored on the study’s secure system (Google Firebase, London) and copied every hour to restricted University of Leeds storage in the lead researcher’s University OneDrive. Text messages are sent through Twilio and emails from a University of Leeds mailbox. Questionnaires at the laboratory visits are completed using MySelf, the research team’s own survey app: answers are encrypted on the device as they are given and stored on secure servers in London, with names kept separately from answers. Data are kept for up to 10 years after the project ends.',
      'If you agree, your study information may also be linked through Connected West Yorkshire with records already held about you, including NHS health records, education records (including those held by the Department for Education) and other routinely collected records. This part is optional. Linking takes place once the necessary approvals are in place, including the study’s ethics approval, NHS Research Ethics Committee approval for NHS records, permission from each record holder and Connected West Yorkshire’s data access process. It is carried out within a secure research environment, and linked information is labelled with your participant ID.',
      'Fully anonymised EEG data will be shared openly through research platforms such as G-Node, EEGNet and OpenNeuro so that other researchers can use them. Study data will also be available to approved researchers through the Born in Bradford Executive and listed in the Born in Bradford data dictionary. Linked education and health data stay within Connected West Yorkshire’s secure research environment.',
      'You may request removal of your identifiable research data within one month after your final session. Your identifiers are kept separately from the research data, as they are needed for linkage. After this period, or once data have been anonymised or used in analyses, withdrawal may no longer be complete, and we will remove everything we still can.',
      'The University Research Participant Privacy Notice is available from the University of Leeds. This study has received ethical approval from the University of Leeds School of Psychology Research Ethics Committee (ethics reference SoPREC - 2026 4202-7027).',
    ],
  },
];

export const labStudy = {
  studyId: 'MPMB-LAB',
  name: 'Social media break study',
  /** Wording used in headings; the approved documents call it the intervention study. */
  formalName: 'MyPhone/MyBrain intervention study',
  minAge: 18,
  /** 24 again since 14 October 2026 (21 from 7 October). New sign-ups older than this are refused; someone who turns 25 during the study carries on. */
  maxAge: 24,
  ethicsReference: 'SoPREC - 2026 4202-7027',
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
 * The pages of the study, each its own short flow on the website, all
 * keyed by the participant ID:
 *   baseline  /break/take-part/  consent, then screenshots and app data before the break
 *   checkin   /break/check-in/   during the break: weekly questions and a screenshot (days 8, 15, 22, 29), MyStory on day 15
 *   after     /break/after/      after the break: a reminder (no new consent), screenshots and app data
 *   book      /break/book/       booking the two lab visits, once the data from before the break is in
 *   story     /break/mystory/    MyStory on its own, for the phase in the link (?phase=pre, mid or post)
 * Each send is filed under the phase of the page it came from (pre, mid,
 * post), so nobody is asked whether their files are from before or after.
 */
export const labPages = {
  baseline: { path: '/break/take-part/', phase: 'pre', label: 'Before your break' },
  checkin: { path: '/break/check-in/', phase: 'mid', label: 'Weekly check-in' },
  after: { path: '/break/after/', phase: 'post', label: 'Before your second visit' },
  /** Booking and changing the two lab visits (see booking.ts). */
  book: { path: '/break/book/', phase: 'pre', label: 'Your lab visits' },
  /** MyStory on its own, for any phase: /break/mystory/?phase=pre (see mystory.ts). */
  story: { path: '/break/mystory/', phase: 'mid', label: 'MyStory' },
} as const;

export type LabCheckInQuestion =
  | { id: string; version: string; type: 'choice'; label: string; text: string; hint?: string; required: boolean; options: { value: string; label: string }[] }
  | { id: string; version: string; type: 'text'; label: string; text: string; hint?: string; required: boolean; maxLength: number };

/**
 * The weekly check-in (26 October 2026: weekly, on days 8, 15, 22 and 29 of
 * the break, with MyStory only in the halfway one): a few quick questions
 * about the week just gone. The week is filled in from the check-in, and the
 * participant can change it. Draft wording, to be replaced by the team's
 * agreed items; ids and versions are what the server accepts and the export's
 * data dictionary describes.
 */
export const labCheckInForm: { id: string; version: string; title: string; questions: LabCheckInQuestion[] } = {
  id: 'mpmb-lab-checkin',
  version: '0.2-draft',
  title: 'Weekly check-in',
  questions: [
    {
      id: 'week',
      version: '0.2-draft',
      type: 'choice',
      label: 'Week of the break',
      text: 'Which week of your social media break are you telling us about?',
      hint: 'We have filled this in from today’s date. Change it if it is not right.',
      required: true,
      options: [
        { value: '1', label: 'Week 1 (days 1 to 7)' },
        { value: '2', label: 'Week 2 (days 8 to 14)' },
        { value: '3', label: 'Week 3 (days 15 to 21)' },
        { value: '4', label: 'Week 4 (day 22 to the end of the break)' },
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
/* ── The control group (21 October 2026) ─────────────────────────────────
 * The same two visits and data, the day-15 check-in and MyStory, but no
 * social media break: controls carry on using social media as usual between
 * the visits. They sign up on their own page (/break/control/); the group is
 * kept with their consent, and every later page takes it from their record.
 * The wording was finalised by the team on 22 October 2026, when the check-in
 * and the daily messages were taken out for controls: they get a reminder a
 * week before the follow-up visit instead.
 */
export type LabGroup = 'break' | 'control';

/** Control version 1.1 (22 October 2026), built on the break group's 2.1-draft; still accepted from pages loaded before 27 October 2026. */
const labConsentFormControlV1_1: typeof labConsentForm = {
  id: 'mpmb-lab-consent-control',
  version: '1.1',
  title: labConsentFormV2_1.title,
  statements: labConsentFormV2_1.statements.map((s) =>
    s.id === 'involves'
      ? {
          ...s,
          version: '1.1-control',
          text: 'I understand that participation in this study involves: two laboratory sessions about 30 days apart, between which I use my phone and social media as I normally would; completion of questionnaires and computer-based tasks; and sharing my smartphone and social media usage data, which I download, review and clean myself, together with screen-time screenshots.',
        }
      : s,
  ),
};

/** 1.2 (27 October 2026): the break group's 2.2 statements, with the control group's own description of taking part. */
export const labConsentFormControl: typeof labConsentForm = {
  id: 'mpmb-lab-consent-control',
  version: '1.2',
  title: labConsentForm.title,
  statements: labConsentForm.statements.map((s) =>
    s.id === 'involves'
      ? {
          ...s,
          version: '1.2-control',
          text: 'I understand that participation in this study involves: two laboratory sessions about 30 days apart, between which I use my phone and social media as I normally would; completion of questionnaires and computer-based tasks; sharing my smartphone and social media usage data, which I download, review and clean myself, together with screen-time screenshots; and the MyStory interview, before the first visit and at the end of the 30 days.',
        }
      : s,
  ),
};

/** Earlier consent forms the server still accepts, for anyone who loaded the page before an update. */
export const labEarlierConsentForms = { break: [labConsentFormV2_1], control: [labConsentFormControlV1_1] };

export const labInformationVersionControl = { version: '2.3-control', label: 'Participant information sheet, version 2.3 (October 2026), for the control group' };

const controlSections: Record<string, Partial<LabInfoSection>> = {
  purpose: {
    detail: [
      'This study examines how short-term changes in smartphone use relate to brain activity, physiological responses, attention, and wellbeing. During laboratory sessions we will measure brain activity using electroencephalography (EEG), heart activity using electrocardiography (ECG), and eye movements using an eye-tracking system.',
      'To understand how changes in digital behaviour relate to these processes, the study also needs objective information about your smartphone and social media use. You have been invited to join the control group, whose members continue to use social media as usual, so that we can compare them with people who take a break.',
    ],
  },
  what: {
    summary: 'Two lab visits of about two hours, about 30 days apart, your usage data and MyStory before each. No social media break.',
    detail: [
      'If you agree to take part, you will attend two laboratory sessions of about two hours each, about 30 days apart, and use your phone and social media as you normally would in between. Before each visit, you will follow our guide to download, review and clean your social media usage data and upload it, with your screen-time screenshots, on this website. Each time you send your data, you will also take part in MyStory, a short conversation with an AI chatbot about your social media use.',
      'At Visit 1 (about 2 hours) we will record your brain activity with EEG and your heart activity with ECG, use an eye-tracking system while you complete computer-based tasks, and ask you to complete questionnaires about wellbeing and digital behaviour using MySelf, the research team’s own survey app.',
      'At Visit 2, about 30 days later (about 2 hours), we will repeat the EEG and ECG recordings, the eye-tracking, the tasks and the questionnaires.',
    ],
  },
  visits: {
    detail: ['Both visits take place in LG25 (EEG Lab), School of Psychology, University of Leeds, between 09:00 and 17:00. You book both visits on this website at the same time and can change them online up to 24 hours beforehand.'],
  },
  restriction: {
    title: 'What happens between the visits?',
    summary: 'You carry on using your phone and social media as usual. You are not asked to take a break or change anything.',
    detail: [
      'Between the two laboratory visits, please carry on using your phone and social media as you normally would.',
      'About a week before your second visit, we will send you a reminder with a link for sending your screen-time screenshots and usage data again. We will also email you to confirm your bookings and send reminders the day before and on the day of each visit.',
    ],
  },
  mystory: {
    summary: 'A short conversation with Remi, an AI chatbot, about your social media use, each time you send your data before a visit.',
    detail: [
      'MyStory is a short online conversation about your social media use. It is led by Remi (short for “Reflecting on Everyday Media Interactions”), an AI chatbot that the research team set up for this study using a published research method. The method was developed by researchers at King’s College London (Skeggs et al., 2025), and Professor Petr Slovak is working with the team on it. You will complete MyStory twice, each time you send your data before a visit. Each conversation takes about 15 minutes.',
      'Remi asks five or six questions written by the research team, one at a time, and may ask a short follow-up question. It then writes three short versions of your story using your own words. You choose the version that fits best, rate it, and can edit it or ask Remi to change it before saving it. You can download a copy as a PDF, print it or email it to yourself.',
      'Remi’s role is to ask the research team’s questions and summarise your answers, and it works only with what you say in the conversation. If you would like advice or support, please use the contacts listed under “Where can I get support?”.',
      'Remi runs on the study’s secure server in London. To produce Remi’s replies, the words you type or say are sent, together with the research team’s instructions, to the AI service OpenAI, which processes them within the European Economic Area and acts for the University under its data processing terms. Your name, participant ID and contact details stay within the study. OpenAI is asked not to store the conversation, excludes it from training its AI, and may hold it for up to 30 days to check for misuse. Please leave out names and other details that could identify you or anyone else.',
      'You may type your answers or, if you prefer, speak them by holding a button. Spoken answers appear as text for you to check and correct before sending. Any recordings are stored securely in the study’s storage, separately from your answers, and can be accessed only by the study coordinators.',
      'MyStory conversations are stored under your participant ID, without your name. The research team reads them only for research, does not use them to identify you, and will not contact you about anything you write. If you need support, please use the numbers under the Help button.',
      'If you mention that you are struggling, for example feeling very low or having thoughts of suicide or self-harm, Remi will pause the questions, respond with care, give you support contacts and ask whether you would like to take a break, stop or carry on. If the conversation ends early, your own words are kept as your story.',
      'MyStory is part of the study at each stage. You can stop at any time, share as much or as little as you wish, or withdraw from the study.',
      'Your conversation, Remi’s versions and the one you choose are analysed by the research team on University of Leeds systems, which may include machine learning (computers finding patterns in data). Information that could identify you is kept out of public AI tools.',
    ],
  },
  risks: {
    summary: 'No known serious risks. Mild discomfort from the sensors.',
    detail: ['There are no known serious risks associated with these measurements. You may feel mild discomfort from wearing the EEG headset or ECG sensors. Talking about your experience in MyStory may bring up feelings about your social media use, and you can pause or stop at any time.'],
  },
  compensation: {
    detail: ['You will receive £25 for each completed laboratory visit, plus an additional £25 for completing all parts of the study, up to £75 in total. If you withdraw early, you will still receive £25 for each laboratory visit you have completed.'],
  },
};

/** Sections the control group does not see: there is no break, so no daily texts or check-ins. */
const controlOmitted = new Set(['messages']);

export const labInformationControl: LabInfoSection[] = labInformation
  .filter((section) => !controlOmitted.has(section.id))
  .map((section) => ({ ...section, ...(controlSections[section.id] ?? {}), id: section.id }));

export const labCheckInFormControl: typeof labCheckInForm = {
  id: 'mpmb-lab-checkin-control',
  version: '0.1-draft',
  title: 'Midway check-in',
  questions: [
    {
      id: 'use-change',
      version: '0.1-draft',
      type: 'choice',
      label: 'Social media use compared with usual',
      text: 'In the past week, how has your social media use compared with usual?',
      hint: 'There is no wrong answer; an honest one helps the study most.',
      required: true,
      options: [
        { value: 'much-less', label: 'Much less than usual' },
        { value: 'less', label: 'A bit less than usual' },
        { value: 'same', label: 'About the same' },
        { value: 'more', label: 'A bit more than usual' },
        { value: 'much-more', label: 'Much more than usual' },
      ],
    },
    ...labCheckInForm.questions.filter((q) => q.id === 'mood'),
    ...labCheckInForm.questions.filter((q) => q.id === 'notes').map((q) => ({ ...q, hint: 'For example, anything that has changed how you use your phone or social media lately.' })),
  ],
};

/** Each group's forms and information, by group. */
export const labForms = {
  break: { consent: labConsentForm, information: labInformation, informationVersion: labInformationVersion, checkIn: labCheckInForm },
  control: { consent: labConsentFormControl, information: labInformationControl, informationVersion: labInformationVersionControl, checkIn: labCheckInFormControl },
} as const;

/** The words that differ between the groups. */
export const groupWords = {
  break: {
    study: 'Social media break study',
    the: 'the break',
    your: 'your break',
    during: 'During your break',
    before: 'before your break',
    after: 'after your break',
    After: 'After your break',
    afterPage: 'after-break page',
    midName: 'Weekly check-in',
    mid: 'weekly check-in',
    checkInTitle: 'How is your break going?',
    firstStarts: 'the first starts your 30-day break, and the second is once the break is over',
    secondWhen: 'once your 30-day break is over',
    problems: 'Problems with Brick or the break?',
    carryOn: 'Carry on with your break.',
    lastDay: 'On the last day of your break, before you unlock your apps',
  },
  control: {
    study: 'MyPhone/MyBrain lab study',
    the: 'the 30 days',
    your: 'the 30 days between your visits',
    during: 'Between your visits',
    before: 'before the 30 days',
    after: 'after the 30 days',
    After: 'After the 30 days',
    afterPage: 'second data page',
    midName: 'Midway check-in',
    mid: 'midway check-in',
    checkInTitle: 'How have things been going?',
    firstStarts: 'the second is about 30 days after the first',
    secondWhen: 'about 30 days after the first',
    problems: 'Questions about the study?',
    carryOn: 'Carry on as usual.',
    lastDay: 'The day before your second visit',
  },
} as const;

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

/**
 * A participant ID as typed or carried by a link: upper case, letters and
 * digits only. After the "MP", the letters O, I and L (never in an ID) are
 * read as the digits 0 and 1 they are usually mistaken for, and twelve digits
 * typed without the "MP" get it added.
 */
export function normaliseParticipantCode(code: string): string {
  const compact = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const prefixed = compact.startsWith('MP');
  const body = (prefixed ? compact.slice(2) : compact).replace(/O/g, '0').replace(/[IL]/g, '1');
  return prefixed || /^[0-9A-F]{12}$/.test(body) ? `MP${body}` : compact;
}
