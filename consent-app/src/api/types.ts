import type { AssentRecord, ConsentRecord, DateParts, GuardianIdentity, ParticipantIdentity, PhoneSource, SessionInfo, SignatureRecord, StatementRecord, SurveyRecord } from '../model/types';
import type { PlatformId } from '../config/walkthroughs';

/**
 * The boundary between the interface and the server.
 *
 * Two things are sent, at different moments:
 *   1. the record (`submitConsent`): the parent's permission and answers,
 *      and the young person's agreement when they are asked for it, sent as
 *      soon as it is complete and the family reaches the screenshots, the
 *      longer questions or the check page — so it is on record even if the
 *      family stops there. Sending it again with the reference code records
 *      an amendment; nothing is overwritten.
 *   2. screenshots (`submitDonation`), from the screen-time screen, linked
 *      by the reference code. Each send is a separate donation record.
 *
 * The production implementation is src/api/firebase.ts; the mock in mock.ts
 * keeps everything in memory.
 */
export interface UploadSlot {
  uploadId: string;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface UploadMeta {
  contentType: string;
  size: number;
  width: number;
  height: number;
}

/**
 * kind: 'consent' is the normal case. 'declined' is sent when the young
 * person does not want to take part: it carries only what the team needs to
 * avoid asking again (names, school, the parent's name) and no permission
 * record, date of birth, postcode or contact details beyond an email given
 * for a copy.
 */
export interface ConsentPayload {
  /** Always 'consent' now: since the workshop became opt-out (7 October 2026) there is no "declined" record to send. */
  kind: 'consent';
  /** Present when amending a record that was already sent. */
  referenceCode: string | null;
  studyId: string;
  siteId: string;
  route: 'parent' | 'young';
  identity: ParticipantIdentity;
  /** Blank when a 16- or 17-year-old does this on their own. */
  guardian: GuardianIdentity;
  /** The parent's permission; null when a 16- or 17-year-old does this on their own. */
  consent: ConsentRecord | null;
  assent: AssentRecord;
  /** The parent's quick questions; null when there is no parent. */
  survey: SurveyRecord | null;
  /** Where the young person's screen time comes from: their own phone ('child'), the parent's family view ('parent'), or nowhere ('none'). */
  phoneSource: PhoneSource | null;
  /** The parent's longer questions, when the screen time is not coming through the form. */
  more: SurveyRecord | null;
  client: ClientInfo;
}

export interface ClientInfo {
  userAgent: string;
  submittedAt: string;
  /** Time zone offset in minutes, so the confirmed date can be interpreted. */
  timezoneOffset: number;
}

export interface ConsentResult {
  referenceCode: string;
  participantId: string;
  receivedAt: string;
  /** 1 for the original record, then 2, 3… for amendments. */
  version: number;
}

export interface DonationPayload {
  referenceCode: string;
  platform: PlatformId | null;
  uploads: { uploadId: string; redacted: boolean; cropped: boolean; acknowledgedWarning: boolean }[];
  /**
   * The young person's agreement to share, recorded by the act of sending
   * when the screenshots come from their phone; null when the parent sends
   * them from their own phone (Family Sharing, Family Link).
   */
  agreement: StatementRecord | null;
  client: ClientInfo;
}

export interface DonationResult {
  donationId: string | null;
  receivedAt: string;
  accepted: string[];
  /** Uploads the server would not keep, with a family-facing reason. */
  rejected: { uploadId: string; reason: string }[];
}

export type ApiErrorCode = 'network' | 'validation' | 'server' | 'expired' | 'too-large';

export class ApiError extends Error {
  code: ApiErrorCode;
  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

/* ── The social media break study (adults, the laboratory study) ─────────── */

export type LabPlatform = 'tiktok' | 'youtube' | 'instagram';

export interface LabConsentRecord {
  formId: string;
  formVersion: string;
  informationVersion: string;
  responses: Record<string, StatementRecord>;
  typedName: string;
  signature: SignatureRecord | null;
  confirmedDate: string;
  completedAt: string | null;
}

export interface LabConsentPayload {
  participantCode: string;
  consent: LabConsentRecord;
  /** The four details the participant ID is built from (identifying: kept with the consent only). */
  codeParts: { firstName: string; lastName: string; dateOfBirth: string; postcode: string };
  /** Their UK mobile number, asked with the four details (not part of the ID), so the team can contact them; kept with the contact details. */
  mobile: string;
  client: ClientInfo;
}

export type LabPhone = 'iphone' | 'android';
/** Where in the study a send belongs, set by the page it came from: before the break (pre), a check-in during it (mid), or after it (post). */
export type LabPhase = 'pre' | 'mid' | 'post';

export interface LabConsentResult {
  participantCode: string;
  consentId: string;
  receivedAt: string;
  version: number;
}

/** Files received for one phase of the study. */
export interface LabPhaseCounts {
  archives: number;
  screenshots: number;
  /** The apps whose cleaned data has arrived in this phase. */
  platforms?: LabPlatform[];
}

/** What the server will say about a participant code, so someone can carry on where they left off, on any device. */
export interface LabLookupResult {
  exists: boolean;
  consentedAt: string | null;
  archives: number;
  screenshots: number;
  /** The same counts by phase, so each page knows what is still to do. */
  phases: Record<LabPhase, LabPhaseCounts>;
  checkIns: number;
  lastCheckInAt: string | null;
  /** Apps the participant has said they do not use, so no data is expected from them. */
  platformsNotUsed?: LabPlatform[];
  /** The lab visits standing (booked or done). */
  visits?: { visit: LabVisit; start: string; status: string }[];
  /** MyStory stories sent, by phase. */
  stories?: Record<LabPhase, number>;
}

/* ── Lab visits (src/lab/booking.ts) ───────────────────────────────────── */

export type LabVisit = 1 | 2;

export interface LabPlace {
  name: string;
  address: string;
  directions: string;
}

export interface LabSlot {
  slotId: string;
  start: string;
  end: string;
  /** The visit this time is for, or null for either. */
  visit: LabVisit | null;
  place: LabPlace;
  spaces: number;
}

export interface LabBooking {
  bookingId: string;
  visit: LabVisit;
  start: string;
  end: string;
  place: LabPlace;
  status: 'booked' | 'attended' | 'missed' | 'cancelled';
  /** Whether it can still be changed or cancelled online. */
  canChange: boolean;
  /** The calendar file for it. */
  ics: string;
}

export interface LabBookingOptions {
  consent: boolean;
  /** What has still to arrive before the visits can be booked, in plain words. */
  missing: string[];
  /** Visits booked, attended or missed (not cancelled), soonest first. */
  bookings: LabBooking[];
  /** The visits still to book: both at first, as they are booked together; afterwards the one a missed or cancelled visit left. */
  toBook: LabVisit[];
  /** Open times for each visit, widely: the page narrows the second to `gap` days after the first (chosen or kept). */
  slots: Record<LabVisit, LabSlot[]>;
  /** The second visit is this many days after the first (inclusive, UK dates). */
  gap: { min: number; max: number };
  /** Whether text reminders are set up. */
  smsAvailable: boolean;
  rules: { minNoticeHours: number; changeUntilHours: number };
  /** The contact details on file, masked (j•••@example.com, the mobile's last three digits): the mobile from sign-up, the email from the first booking; null when there are none. */
  contact: { email: string | null; mobileEnding: string | null; smsReminders: boolean } | null;
}

export interface LabVisitChoice {
  visit: LabVisit;
  slotId: string;
}

export interface LabBookPayload {
  participantCode: string;
  /** One time for each visit being booked or moved: both at the first booking. */
  visits: LabVisitChoice[];
  /** null: keep the email address on file (changing visits without typing it again). */
  email: string | null;
  /** null: keep the mobile number on file (given at sign-up). */
  mobile: string | null;
  smsReminders: boolean;
  client: ClientInfo;
}

export type DeliveryOutcome = 'sent' | 'failed' | 'not-configured' | 'no-contact' | 'not-wanted' | 'invalid-number' | string;

export interface LabBookResult {
  /** The new bookings (a moved visit gets a new one). */
  booked: LabBooking[];
  kind: 'booked' | 'moved';
  email: DeliveryOutcome;
  sms: DeliveryOutcome;
}

export interface LabCancelResult {
  bookingIds: string[];
  email: DeliveryOutcome;
}

/* ── MyStory (src/lab/mystory.ts) ──────────────────────────────────────── */

export type StoryAnswer = { a: number; b: number; c: number } | number | string | string[];

export interface LabStoryPayload {
  participantCode: string;
  phase: LabPhase;
  structureId: string;
  structureVersion: string;
  promptId: string;
  title: string;
  story: string;
  /** Each signifier's answer: a triangle's three shares, a slider's 0 to 100, a choice; 'na' for not sure. */
  answers: Record<string, StoryAnswer>;
  /** The page the story was told on. */
  source: 'baseline' | 'checkin' | 'after' | 'story' | 'book';
  checkInId: string | null;
  client: ClientInfo;
}

export interface LabStoryResult {
  storyId: string;
  receivedAt: string;
}

export interface LabUploadMeta {
  kind: 'archive' | 'screenshot';
  name: string;
  contentType: string;
  size: number;
  /** For archives: what the cleaner found and what the participant chose to keep. */
  platforms?: LabPlatform[];
  categories?: string[];
  kept?: Record<string, number>;
}

export interface LabDonationPayload {
  participantCode: string;
  uploads: ({ uploadId: string } & LabUploadMeta)[];
  /** The phase of the page the files were sent from. */
  phase: LabPhase;
  /** For screenshots sent with a check-in: the check-in they belong to. */
  checkInId?: string | null;
  /** The phone the screenshots come from, as chosen in the guide; null if not chosen. */
  phone: LabPhone | null;
  client: ClientInfo;
}

export interface LabDonationResult {
  donationId: string | null;
  receivedAt: string;
  accepted: string[];
  rejected: { uploadId: string; reason: string }[];
}

/** The answers to one mid-break check-in (labCheckInForm in src/lab/config.ts). */
export interface LabCheckInPayload {
  participantCode: string;
  formId: string;
  formVersion: string;
  answers: Record<string, string>;
  client: ClientInfo;
}

export interface LabCheckInResult {
  checkInId: string;
  receivedAt: string;
  /** How many check-ins this code has sent, this one included. */
  count: number;
}

/** "I'll come back later": a progress email now, one follow-up in two days unless files arrive. */
export interface LabReminderResult {
  outcome: 'sent' | 'failed' | 'not-configured';
  followUpAt: string;
}

/**
 * Carrying on later (firebase/functions/src/resume.ts): the reference and the
 * young person's date of birth find a record sent earlier, and say what can
 * still be added to it.
 */
export interface ResumeSummary {
  referenceCode: string;
  /** The young person's first name, for the wording. */
  firstName: string;
  /** 16 or 17 when the record was made: they decided for themselves. */
  selfConsent: boolean;
  phoneSource: PhoneSource | null;
  assentStatus: AssentRecord['status'];
  imageCount: number;
  maxImages: number;
  /** The young person's agreement can be added (it was put off), then their screenshots. */
  canAgree: boolean;
  /** Screenshots can be added: from the parent's phone, or from the young person's once they have agreed. */
  canAddScreenshots: boolean;
  /** Why nothing can be added, when nothing can. */
  reason: 'declined' | 'no-screen-time' | 'full' | null;
}

export interface ResumeLookupPayload {
  referenceCode: string;
  dateOfBirth: DateParts;
}

/** The young person's answer, given later: a signed yes or a no. */
export interface LateAgreementPayload {
  referenceCode: string;
  assent: Pick<AssentRecord, 'formId' | 'formVersion' | 'responses' | 'signature' | 'startedAt' | 'completedAt'> & { status: 'completed' | 'declined' };
  client: ClientInfo;
}

export interface LateAgreementResult {
  referenceCode: string;
  receivedAt: string;
  version: number;
  status: 'completed' | 'declined';
}

export interface ConsentApi {
  startSession(): Promise<SessionInfo>;
  submitConsent(session: SessionInfo, payload: ConsentPayload): Promise<ConsentResult>;
  /** Carrying on later: find a record by its reference and the young person's date of birth; this session may then add to it. */
  resumeLookup(session: SessionInfo, payload: ResumeLookupPayload): Promise<ResumeSummary>;
  /** Carrying on later: the young person's answer, given now. */
  resumeAgree(session: SessionInfo, payload: LateAgreementPayload): Promise<LateAgreementResult>;
  requestUploadSlot(sessionId: string, meta: UploadMeta): Promise<UploadSlot>;
  uploadImage(slot: UploadSlot, blob: Blob, onProgress?: (fraction: number) => void): Promise<void>;
  deleteUpload(sessionId: string, uploadId: string): Promise<void>;
  submitDonation(session: SessionInfo, payload: DonationPayload): Promise<DonationResult>;
  // The social media break study.
  submitLabConsent(session: SessionInfo, payload: LabConsentPayload): Promise<LabConsentResult>;
  lookupLabParticipant(session: SessionInfo, participantCode: string): Promise<LabLookupResult>;
  /** A slot under the lab quarantine path, which also accepts zip archives. */
  requestLabUploadSlot(sessionId: string, meta: { contentType: string; size: number }): Promise<UploadSlot>;
  deleteLabUpload(sessionId: string, uploadId: string): Promise<void>;
  submitLabDonation(session: SessionInfo, payload: LabDonationPayload): Promise<LabDonationResult>;
  requestLabReminder(session: SessionInfo, payload: { participantCode: string; email: string; phase: LabPhase }): Promise<LabReminderResult>;
  submitLabCheckIn(session: SessionInfo, payload: LabCheckInPayload): Promise<LabCheckInResult>;
  /** Records which apps the participant does not use (the whole list each time). */
  updateLabPlatforms(session: SessionInfo, payload: { participantCode: string; notUsed: LabPlatform[] }): Promise<{ notUsed: LabPlatform[] }>;
  /** The lab visits: where someone stands, their bookings, and the open times. */
  labBookingOptions(session: SessionInfo, participantCode: string): Promise<LabBookingOptions>;
  bookLabSlot(session: SessionInfo, payload: LabBookPayload): Promise<LabBookResult>;
  /** Cancels the visits named, or, with none named, every visit still to come. */
  cancelLabBooking(session: SessionInfo, payload: { participantCode: string; bookingIds?: string[] | null }): Promise<LabCancelResult>;
  submitLabStory(session: SessionInfo, payload: LabStoryPayload): Promise<LabStoryResult>;
  /** The staff page and the schools' upload page: one callable each, with an action (firebase/functions/src/staff.ts, schoolUpload.ts). */
  callTool<Res>(session: SessionInfo, name: 'staffApi' | 'schoolUpload', payload: Record<string, unknown>): Promise<Res>;
}
