import { generated } from './generated/forms.js';

/**
 * The statement forms the server currently accepts. A submission must carry
 * exactly these ids and versions; anything else is rejected, so old or
 * tampered wording can never be recorded as agreed.
 *
 * Everything here is derived at build time from the app's own configuration
 * (consent-app/src/config/statements.ts, questions.ts and copy.ts) by
 * scripts/generate-forms.mjs, so wording and versions are edited in one
 * place and the app, the server and the export's data dictionaries agree.
 */
export interface ServedStatement {
  id: string;
  version: string;
  kind: 'required' | 'optional';
  /** Asked only while the young person is under study.selfConsentAge. */
  underSelfConsentAge: boolean;
}

const served = (s: { id: string; version: string; kind: string; underSelfConsentAge?: boolean }): ServedStatement => ({ id: s.id, version: s.version, kind: s.kind as ServedStatement['kind'], underSelfConsentAge: Boolean(s.underSelfConsentAge) });

export const parentConsentForm = {
  id: generated.parentConsentForm.id,
  version: generated.parentConsentForm.version,
  statements: generated.parentConsentForm.statements.map(served),
};

export const childAssentForm = {
  id: generated.childAssentForm.id,
  version: generated.childAssentForm.version,
  /** Agreed to by the young person's signature. */
  signed: generated.childAssentForm.statements.filter((s) => s.coveredBySignature).map((s) => s.id as string),
  /** Agreed to by sending screenshots. */
  byAction: generated.childAssentForm.statements.filter((s) => !s.coveredBySignature).map((s) => s.id as string),
  statements: generated.childAssentForm.statements.map(served),
};

export const informationVersion: string = generated.informationVersion;

/** The parent's question forms (src/config/questions.ts in the app). */
export type ServedQuestion = { id: string; version: string; type: 'choice'; options: string[] } | { id: string; version: string; type: 'text'; maxLength: number };
export interface ServedQuestionForm {
  id: string;
  version: string;
  questions: ServedQuestion[];
}

type GeneratedQuestion = { id: string; version: string; type: string; text: string; options?: readonly { value: string; label: string }[]; maxLength?: number };
const questionForm = (f: { id: string; version: string; questions: readonly GeneratedQuestion[] }): ServedQuestionForm => ({
  id: f.id,
  version: f.version,
  questions: f.questions.map((q): ServedQuestion => (q.type === 'choice' ? { id: q.id, version: q.version, type: 'choice', options: (q.options ?? []).map((o) => o.value) } : { id: q.id, version: q.version, type: 'text', maxLength: Number(q.maxLength) })),
});
const wordingOf = (f: { questions: readonly GeneratedQuestion[] }): Record<string, { text: string; labels?: Record<string, string> }> =>
  Object.fromEntries(f.questions.map((q) => [q.id, { text: q.text, labels: q.type === 'choice' ? Object.fromEntries((q.options ?? []).map((o) => [o.value, o.label])) : undefined }]));

/** The quick questions every parent or carer is asked. */
export const parentQuestionsForm = questionForm(generated.parentQuestionsForm as unknown as { id: string; version: string; questions: GeneratedQuestion[] });
/** The longer questions, when the young person's screen time is not coming through the form. */
export const parentMoreForm = questionForm(generated.parentMoreForm as unknown as { id: string; version: string; questions: GeneratedQuestion[] });

/** The questions' wording and answer labels, for the exported data dictionaries. {child} stands for the young person's name. */
export const questionWording = wordingOf(generated.parentQuestionsForm as unknown as { questions: GeneratedQuestion[] });
export const moreQuestionWording = wordingOf(generated.parentMoreForm as unknown as { questions: GeneratedQuestion[] });
/** The topic of each longer question (time and apps, night-time and sleep, effects). */
export const moreQuestionTopics: Record<string, string> = Object.fromEntries((generated.parentMoreForm.questions as readonly { id: string; topic: string | null }[]).map((q) => [q.id, q.topic ?? '']));

/** The statements' wording by form and id, for the exported consent tables. */
export const statementWording: Record<string, Record<string, { label: string; text: string }>> = {
  [generated.parentConsentForm.id]: Object.fromEntries(generated.parentConsentForm.statements.map((s) => [s.id, { label: s.label as string, text: s.text as string }])),
  [generated.childAssentForm.id]: Object.fromEntries(generated.childAssentForm.statements.map((s) => [s.id, { label: s.label as string, text: s.text as string }])),
  [generated.labConsentForm.id]: Object.fromEntries(generated.labConsentForm.statements.map((s) => [s.id, { label: s.label as string, text: s.text as string }])),
};

export const study = {
  studyId: 'MPMB',
  siteIds: ['LEEDS-BRADFORD'],
  minAge: 11,
  maxAge: 17,
  /** From this age the young person decides about sharing their own screen time, without a parent (src/config/study.ts, decided 7 October 2026); null: never alone. */
  selfConsentAge: generated.selfConsentAge as number | null,
  maxImages: 6,
  maxSignatureBytes: 200 * 1024,
  /** Shortest school name accepted when "another school" is typed in. */
  schoolMin: 3,
};

/** Shape of the reference codes issued by submitConsent. */
export const REFERENCE_CODE = /^MPMB-[A-Z2-9]{4}-[A-Z2-9]{3}$/;

/* ── The social media break study (adults, the laboratory study) ─────────── */

/** The adult participant's own consent form (src/lab/config.ts in the app): required statements and an optional record-linkage choice. */
export const labConsentForm = {
  id: generated.labConsentForm.id,
  version: generated.labConsentForm.version,
  title: generated.labConsentForm.title,
  statements: generated.labConsentForm.statements.map(served),
};

export const labInformationVersion: string = generated.labInformationVersion;

export const labStudy = {
  studyId: generated.labStudy.studyId,
  minAge: generated.labStudy.minAge,
  maxAge: generated.labStudy.maxAge,
  /** Largest cleaned archive accepted, in bytes (the storage rules allow a little more). */
  maxArchiveBytes: generated.labStudy.maxArchiveBytes,
  /** Screenshots accepted per participant before the break, and again after it. */
  maxScreenshots: generated.labStudy.maxScreenshots,
  /** Screenshots accepted per participant across all the mid-break check-ins. */
  maxCheckInScreenshots: generated.labStudy.maxCheckInScreenshots,
  /** Cleaned archives accepted per participant before the break, and again after it. */
  maxArchives: 10,
  maxSignatureBytes: study.maxSignatureBytes,
  name: generated.labStudy.name,
  contactName: generated.labStudy.contactName,
  contactEmail: generated.labStudy.contactEmail,
};

/** The mid-break check-in's questions (labCheckInForm in src/lab/config.ts): what the server accepts and the export describes. */
export type ServedCheckInQuestion = { id: string; version: string; type: 'choice'; required: boolean; label: string; text: string; options: { value: string; label: string }[] } | { id: string; version: string; type: 'text'; required: boolean; label: string; text: string; maxLength: number };

export const labCheckInForm = {
  id: generated.labCheckInForm.id as string,
  version: generated.labCheckInForm.version as string,
  questions: generated.labCheckInForm.questions.map((q): ServedCheckInQuestion =>
    q.type === 'choice'
      ? { id: q.id, version: q.version, type: 'choice', required: q.required, label: q.label, text: q.text, options: q.options.map((o) => ({ value: o.value as string, label: o.label as string })) }
      : { id: q.id, version: q.version, type: 'text', required: q.required, label: q.label, text: q.text, maxLength: q.maxLength },
  ),
};

/** The participant ID, for example MP2670FF90A5F2: "MP" and 12 hexadecimal digits of a hash of the person's details; see src/lab/config.ts. */
export const PARTICIPANT_CODE = new RegExp(generated.labStudy.participantCodePattern);

/** A full UK postcode, with one space before the inward code; see src/lab/config.ts. */
export const UK_POSTCODE = new RegExp(generated.labStudy.ukPostcodePattern);

/** What the in-browser cleaner produces: the only file names a donated archive may contain, and the category ids it reports. */
export const cleaner = {
  version: generated.cleaner.version,
  allowedFiles: generated.cleaner.allowedFiles as readonly string[],
  categoryIds: generated.cleaner.categories.map((c) => c.id as string),
  platformOf: Object.fromEntries(generated.cleaner.categories.map((c) => [c.id, c.platform as string])) as Record<string, string>,
  titleOf: Object.fromEntries(generated.cleaner.categories.map((c) => [c.id, c.title as string])) as Record<string, string>,
};

/* ── Lab visits, MyStory and the schools (src/lab/booking.ts, src/lab/mystory.ts, _data/schools.json) ── */

/** The study's pages, by flow: for the personal links in emails, texts and the staff page. */
export const labPagePaths: Record<string, string> = generated.labPages;

export interface BookingReminder {
  id: string;
  hoursBefore: number;
  email: boolean;
  sms: boolean;
}

/** Booking the two lab visits: what must have arrived first, the windows, the reminders. */
export const labBooking = {
  requires: { screenshots: generated.labBooking.requires.screenshots as number, archives: generated.labBooking.requires.archives as number },
  visits: generated.labBooking.visits.map((v) => ({ visit: v.visit as 1 | 2, title: v.title as string, summary: v.summary as string, what: v.what as string })),
  minutes: generated.labBooking.minutes as number,
  visit2AfterDays: { min: generated.labBooking.visit2AfterDays.min as number, max: generated.labBooking.visit2AfterDays.max as number },
  minNoticeHours: generated.labBooking.minNoticeHours as number,
  changeUntilHours: generated.labBooking.changeUntilHours as number,
  horizonDays: generated.labBooking.horizonDays as number,
  timeZone: generated.labBooking.timeZone as string,
  location: { name: generated.labBooking.location.name as string, address: generated.labBooking.location.address as string, directions: generated.labBooking.location.directions as string },
  bring: generated.labBooking.bring as readonly string[],
  reminders: generated.labBooking.reminders.map((r): BookingReminder => ({ id: r.id, hoursBefore: r.hoursBefore, email: r.email, sms: r.sms })),
  textHours: { from: generated.labBooking.textHours.from as number, to: generated.labBooking.textHours.to as number },
  textOnBooking: generated.labBooking.textOnBooking as boolean,
  /** Copied on every booking, change and cancellation email. */
  copyTo: generated.labBooking.copyTo as readonly string[],
};

export interface JourneyMessage {
  id: string;
  day: number;
  unless?: 'checked-in';
}

/** The messages during the break, by day after the first visit. */
export const labJourneyMessages: JourneyMessage[] = generated.labJourneyMessages.map((m) => ({ id: m.id, day: m.day, ...('unless' in m ? { unless: m.unless as JourneyMessage['unless'] } : {}) }));
export const labJourneyHour: number = generated.labJourneyHour;

export type StoryPhase = 'pre' | 'mid' | 'post';
export type StorySignifier =
  | { id: string; type: 'triad'; question: string; corners: string[] }
  | { id: string; type: 'dyad'; question: string; left: string; right: string }
  | { id: string; type: 'choice'; question: string; options: { value: string; label: string }[]; multiple?: boolean };

export interface StoryStructure {
  id: string;
  version: string;
  phase: StoryPhase;
  title: string;
  prompts: { id: string; text: string }[];
  signifiers: StorySignifier[];
}

/** MyStory's structure for each phase of the break study: what the server accepts and the export describes. */
export const storyStructures = generated.storyStructures as unknown as Record<StoryPhase, StoryStructure>;
export const storyLimits = { titleMax: generated.storyLimits.titleMax as number, storyMin: generated.storyLimits.storyMin as number, storyMax: generated.storyLimits.storyMax as number };

export type StoryMode = { mode: 'native' } | { mode: 'link' | 'embed'; name: string; url: string; idParam: string; phaseParam: string | null };
/** How each phase's MyStory is collected: on this site, or by another survey given the participant ID. */
export const storyModes = generated.storyModes as unknown as Record<StoryPhase, StoryMode>;

export interface SchoolEntry {
  slug: string;
  id: string;
  name: string;
  area: string;
}

/** The participating schools (_data/schools.json): the school upload page and the UPN matching use these. */
export const schools: SchoolEntry[] = generated.schools.map((x) => ({ slug: x.slug, id: x.id, name: x.name, area: x.area }));
