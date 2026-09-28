import type {
  AssentRecord,
  ConsentRecord,
  DonationStatus,
  GuardianIdentity,
  ParticipantIdentity,
  SessionInfo,
} from '../model/types';
import type { PlatformId } from '../config/walkthroughs';

/**
 * The boundary between the interface and the server.
 *
 * The interface only ever talks to this interface. The production
 * implementation (see docs/architecture.md) sends requests to a University
 * API over HTTPS with a session cookie and CSRF token, and uploads image bytes
 * directly to encrypted storage using pre-signed URLs. The mock in mock.ts
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
 * The submission keeps identifying information and research data as separate
 * top-level objects so the server can store them apart.
 *
 * kind: 'consent' is the normal case. 'declined' is sent when the young
 * person does not want to take part: it carries only what the team needs to
 * avoid asking again (names, school, the parent's name and email) and no
 * consent record, date of birth, postcode or phone-use information.
 */
export interface SubmissionPayload {
  kind: 'consent' | 'declined';
  studyId: string;
  siteId: string;
  route: 'parent' | 'young';
  identity: ParticipantIdentity;
  guardian: GuardianIdentity;
  consent: ConsentRecord | null;
  assent: AssentRecord;
  donation: {
    status: DonationStatus;
    platform: PlatformId | null;
    uploads: { uploadId: string; redacted: boolean; cropped: boolean }[];
  };
  client: {
    userAgent: string;
    submittedAt: string;
    /** Time zone offset in minutes, so the confirmed date can be interpreted. */
    timezoneOffset: number;
  };
}

export interface SubmissionResult {
  referenceCode: string;
  receivedAt: string;
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
  requestUploadSlot(sessionId: string, meta: UploadMeta): Promise<UploadSlot>;
  uploadImage(slot: UploadSlot, blob: Blob, onProgress?: (fraction: number) => void): Promise<void>;
  deleteUpload(sessionId: string, uploadId: string): Promise<void>;
  submit(session: SessionInfo, payload: SubmissionPayload): Promise<SubmissionResult>;
}
