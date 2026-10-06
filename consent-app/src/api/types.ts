import type { AssentRecord, ConsentRecord, GuardianIdentity, ParticipantIdentity, SessionInfo, SignatureRecord, StatementRecord, SurveyRecord } from '../model/types';
import type { PlatformId } from '../config/walkthroughs';

/**
 * The boundary between the interface and the server.
 *
 * Two things are sent, at different moments:
 *   1. the permission and agreement (`submitConsent`), as soon as the young
 *      person has signed, declined or deferred — so participation is on
 *      record even if the family stops there. Sending it again with the
 *      reference code records an amendment; nothing is overwritten.
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
  kind: 'consent' | 'declined';
  /** Present when amending a record that was already sent. */
  referenceCode: string | null;
  studyId: string;
  siteId: string;
  route: 'parent' | 'young';
  identity: ParticipantIdentity;
  guardian: GuardianIdentity;
  consent: ConsentRecord | null;
  assent: AssentRecord;
  /** The parent's quick questions; never sent with a declined record. */
  survey: SurveyRecord | null;
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
   * when they have signed in the app; null otherwise (their agreement may be
   * collected separately, for example on paper at school).
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
  /** The four answers the code was built from (kept as identifying data with the consent); null when an existing code was typed. */
  codeParts: { firstName: string; house: string; month: string; postcode: string } | null;
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

export interface ConsentApi {
  startSession(): Promise<SessionInfo>;
  submitConsent(session: SessionInfo, payload: ConsentPayload): Promise<ConsentResult>;
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
}
