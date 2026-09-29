import type { RelationshipId } from '../config/fields';
import type { PlatformId } from '../config/walkthroughs';

/** Which entry point the family chose. */
export type Route = 'parent' | 'young';

/** Who should be holding the device for a step. */
export type Actor = 'parent' | 'young' | 'anyone';

export interface DateParts {
  day: string;
  month: string;
  year: string;
}

/* ────────────────────────────────────────────────────────────────────────
   Identifying information (kept separate from research data)
   ──────────────────────────────────────────────────────────────────────── */

export interface ParticipantIdentity {
  firstName: string;
  lastName: string;
  dateOfBirth: DateParts;
  schoolId: string;
  /** Free-text school name when schoolId is "other". */
  schoolOther: string;
  yearGroup: string;
}

export interface GuardianIdentity {
  fullName: string;
  relationship: RelationshipId | '';
  relationshipOther: string;
  hasParentalResponsibility: boolean;
  email: string;
  phone: string;
  postcode: string;
}

/* ────────────────────────────────────────────────────────────────────────
   Consent and assent records (audit trail)
   ──────────────────────────────────────────────────────────────────────── */

export type StatementResponse = 'agreed' | 'declined';

export interface StatementRecord {
  statementId: string;
  /** Version of the wording that was shown when the response was given. */
  version: string;
  response: StatementResponse;
  /** ISO timestamp from the device clock. The server adds its own on receipt. */
  respondedAt: string;
  /** How the response was given: its own control, one tick covering a group, or a signature. */
  via: 'individual' | 'group' | 'signature' | 'action';
}

export interface SignatureRecord {
  method: 'drawn' | 'typed';
  /** PNG data URL when drawn. */
  imageDataUrl: string | null;
  /** The typed name when the typed alternative was used. */
  typedName: string | null;
  strokeCount: number;
  pointerType: string | null;
  capturedAt: string;
}

export interface ConsentRecord {
  formId: string;
  formVersion: string;
  /** Version of the participant information that was shown before signing. */
  informationVersion: string | null;
  responses: Record<string, StatementRecord>;
  /** Name typed by the parent/guardian on the consent screen. */
  typedName: string;
  signature: SignatureRecord | null;
  /** Date the parent confirmed (YYYY-MM-DD). Defaults to the device date. */
  confirmedDate: string;
  completedAt: string | null;
  /** Set when a statement was changed after signing; the signature is cleared and must be given again. */
  revisedAt: string | null;
}

export type AssentStatus = 'not-started' | 'completed' | 'deferred' | 'declined';

export interface AssentRecord {
  formId: string;
  formVersion: string;
  status: AssentStatus;
  /** Who chose to defer: the parent (child not present) or the young person ("decide later"). */
  deferredBy: 'parent' | 'young' | null;
  responses: Record<string, StatementRecord>;
  /** The young person's signature (drawn, or their typed first name). */
  signature: SignatureRecord | null;
  /** When the device was handed to the young person (parent pressed "continue" on the handover screen). */
  handoverConfirmedAt: string | null;
  /** When the agreement screen was first shown to the young person. */
  startedAt: string | null;
  completedAt: string | null;
}

/* ────────────────────────────────────────────────────────────────────────
   Research data: phone-use donation
   ──────────────────────────────────────────────────────────────────────── */

export type UploadStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

/**
 * Metadata about an image. The image bytes themselves live in
 * lib/imageStore.ts (memory only) and, once uploaded, on the server under
 * `uploadId`. Nothing about the image content is persisted in the browser.
 */
export interface DonationImage {
  id: string;
  name: string;
  type: string;
  size: number;
  width: number;
  height: number;
  redacted: boolean;
  cropped: boolean;
  status: UploadStatus;
  /** 0–1 */
  progress: number;
  uploadId: string | null;
  error: string | null;
}

export type DonationStatus = 'not-started' | 'in-progress' | 'completed' | 'skipped' | 'not-consented' | 'deferred';

export interface PhoneUseDonation {
  platform: PlatformId | null;
  images: DonationImage[];
  status: DonationStatus;
}

/* ────────────────────────────────────────────────────────────────────────
   Session, submission and app state
   ──────────────────────────────────────────────────────────────────────── */

export interface SessionInfo {
  sessionId: string;
  /** Anti-forgery token for cookie-based backends; empty for token-based ones such as Firebase. */
  csrfToken: string;
  expiresAt: string;
}

export type SubmissionStage = 'idle' | 'submitting' | 'done' | 'failed';

export interface SubmissionState {
  stage: SubmissionStage;
  /** Human-readable description of the current stage, for the status region. */
  stageLabel: string;
  error: string | null;
  referenceCode: string | null;
  receivedAt: string | null;
}

export type StepId = 'welcome' | 'child-details' | 'parent-details' | 'parent-consent' | 'child-assent' | 'assent-declined' | 'phone-use' | 'send' | 'done';

export interface Handover {
  from: Actor;
  to: Actor;
  nextStep: StepId;
}

export interface PrototypeFlags {
  failUploads: boolean;
  failSubmit: boolean;
  showDraftMarkers: boolean;
}

export interface AppState {
  route: Route | null;
  stepId: StepId;
  /** A pending device handover to show before `handover.nextStep`. */
  handover: Handover | null;
  /** Why the form was cleared, shown once on the welcome screen. */
  clearedReason: 'inactivity' | 'expired' | null;
  /** Parent route: whether the young person is present to give their agreement. */
  childPresent: boolean | null;
  /** When set, "Continue" returns to this step once later steps are complete. */
  returnTo: StepId | null;
  identity: ParticipantIdentity;
  guardian: GuardianIdentity;
  consent: ConsentRecord;
  assent: AssentRecord;
  donation: PhoneUseDonation;
  submission: SubmissionState;
  session: SessionInfo | null;
  prototype: PrototypeFlags;
  /** True after state was restored from sessionStorage (image previews are gone). */
  restored: boolean;
}
