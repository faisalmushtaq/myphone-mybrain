import type { RelationshipId } from '../config/fields';
import type { PlatformId } from '../config/walkthroughs';

/** Which entry point the family chose. */
export type Route = 'parent' | 'young';

/** Who should be holding the device for a step. */
export type Actor = 'parent' | 'young' | 'anyone';

/**
 * Where an under-16's screen time comes from, chosen by the parent or carer
 * once they have said yes to sharing it: their own phone, where they can see
 * it with Apple Family Sharing or Google Family Link ('parent'); the young
 * person's phone, if the young person agrees ('child'); or neither, when the
 * parent answers the longer questions instead ('none').
 */
export type PhoneSource = 'parent' | 'child' | 'none';

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
  /** Optional contact details. Nothing is ever emailed to families; they download their copy of the record instead. */
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

export type UploadStatus = 'pending' | 'uploading' | 'uploaded' | 'sent' | 'failed';

/** Result of the in-browser check that an image looks like a screen-time page. */
export interface ImageQuality {
  verdict: 'likely' | 'unsure' | 'unlikely';
  reasons: string[];
  /** Fraction of pixels covered by the eight most common colours (flat UI is high, photographs low). */
  flatness: number;
  portrait: boolean;
}

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
  quality: ImageQuality | null;
  /** The person looked at a warning and chose to send anyway. */
  acknowledged: boolean;
}

export type DonationStatus = 'not-started' | 'in-progress' | 'completed' | 'skipped' | 'not-consented' | 'deferred';

/* ────────────────────────────────────────────────────────────────────────
   The parent's quick questions (research data, optional)
   ──────────────────────────────────────────────────────────────────────── */

export type SurveyStatus = 'not-started' | 'in-progress' | 'completed' | 'skipped';

export interface QuestionResponse {
  questionId: string;
  /** Version of the question wording that was shown. */
  version: string;
  value: string;
  answeredAt: string;
}

export interface SurveyRecord {
  formId: string;
  formVersion: string;
  status: SurveyStatus;
  responses: Record<string, QuestionResponse>;
  startedAt: string | null;
  completedAt: string | null;
}

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

export type SendStage = 'idle' | 'sending' | 'sent' | 'failed';

/**
 * What has reached the server. The permission and agreement are sent as soon
 * as the agreement step is finished; screenshots are sent from the
 * screen-time screen; later changes are sent as amendments.
 */
export interface SubmissionState {
  referenceCode: string | null;
  participantId: string | null;
  /** Saving the permission and agreement (first time or amendment). */
  consentStage: SendStage;
  consentError: string | null;
  consentSentAt: string | null;
  /** How many times the record has been sent (1 = original, 2+ = amendments). */
  consentVersion: number;
  /** Snapshot of what was last sent, to detect changes that need an amendment. */
  sentSnapshot: string | null;
  /** Sending screenshots. */
  donationStage: SendStage;
  donationError: string | null;
  donationsSent: number;
  /** Set when a whole record was sent as a decline ("let the team know"). */
  declinedSentAt: string | null;
}

export type StepId = 'welcome' | 'opt-out' | 'child-details' | 'parent-details' | 'parent-consent' | 'parent-questions' | 'phone-source' | 'child-assent' | 'assent-declined' | 'phone-use' | 'parent-more' | 'check' | 'done';

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
  /** The parent's quick questions about the young person's phone use. */
  survey: SurveyRecord;
  /** Parent route, under 16, after a yes to sharing: where the screen time comes from (null until chosen). */
  phoneSource: PhoneSource | null;
  /** The parent's longer questions, when the young person's screen time is not coming through this form. */
  more: SurveyRecord;
  submission: SubmissionState;
  session: SessionInfo | null;
  prototype: PrototypeFlags;
  /** True after state was restored from sessionStorage (image previews are gone). */
  restored: boolean;
}
