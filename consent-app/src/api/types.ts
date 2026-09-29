import type { AssentRecord, ConsentRecord, GuardianIdentity, ParticipantIdentity, SessionInfo, StatementRecord, SurveyRecord } from '../model/types';
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
  /** The young person's agreement to share, recorded by the act of sending. */
  agreement: StatementRecord;
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

export interface ConsentApi {
  startSession(): Promise<SessionInfo>;
  submitConsent(session: SessionInfo, payload: ConsentPayload): Promise<ConsentResult>;
  requestUploadSlot(sessionId: string, meta: UploadMeta): Promise<UploadSlot>;
  uploadImage(slot: UploadSlot, blob: Blob, onProgress?: (fraction: number) => void): Promise<void>;
  deleteUpload(sessionId: string, uploadId: string): Promise<void>;
  submitDonation(session: SessionInfo, payload: DonationPayload): Promise<DonationResult>;
}
