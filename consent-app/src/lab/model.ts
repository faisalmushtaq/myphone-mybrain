import type { DeliveryOutcome, LabBooking, LabBookingOptions, LabConsentRecord, LabLookupResult, LabPhase, LabPhone, LabPlatform, StoryAnswer } from '../api/types';
import type { SendStage, SessionInfo, SignatureRecord, StatementRecord } from '../model/types';
import type { CategoryId } from './cleaner';
import type { CodeParts } from './config';

/**
 * State of the social media break study's flow. Kept deliberately separate
 * from the family consent app: adults consent for themselves, there is no
 * handover, and the process spans days (a data export can take a while to
 * arrive), so progress lives in localStorage keyed by the participant ID.
 */

export type LabStepId = 'welcome' | 'participant-id' | 'information' | 'consent' | 'reminder' | 'checkin' | 'guide' | 'screenshots' | 'clean' | 'send' | 'done' | 'book' | 'mystory';

/**
 * Which of the study's three pages this is (see labPages in config.ts). Each
 * page is its own short flow, keeps its own progress on the device, and
 * files what it sends under its own phase.
 */
export type LabFlow = 'baseline' | 'checkin' | 'after' | 'book' | 'story';

/**
 * The steps of each page. Before the break: the screenshots go first, sent
 * straight away; the app data download takes days, so its guide comes next
 * and the person returns to clean and send the file. During the break: the
 * code, then the check-in. After the break: the code, a reminder of what
 * they agreed to (no new consent), then the same screenshots and app data.
 */
export const labFlowSteps: Record<LabFlow, LabStepId[]> = {
  baseline: ['welcome', 'participant-id', 'information', 'consent', 'screenshots', 'guide', 'clean', 'send', 'done'],
  checkin: ['participant-id', 'checkin', 'mystory', 'done'],
  after: ['participant-id', 'reminder', 'screenshots', 'guide', 'clean', 'send', 'done'],
  book: ['participant-id', 'book'],
  story: ['participant-id', 'mystory'],
};

/** The phase each page files under; MyStory's own page takes it from its link (?phase=). */
export const labFlowPhase: Record<LabFlow, LabPhase> = { baseline: 'pre', checkin: 'mid', after: 'post', book: 'pre', story: 'mid' };

export const labStepTitles: Record<LabStepId, string> = {
  welcome: 'Social media break study',
  'participant-id': 'About you',
  information: 'About the study',
  consent: 'Your consent',
  reminder: 'Before you start',
  checkin: 'Your check-in',
  guide: 'Get your app data',
  screenshots: 'Your screenshots',
  clean: 'Choose what to share',
  send: 'Send your data',
  done: 'Thank you',
  book: 'Your lab visits',
  mystory: 'MyStory',
};

export type FileStatus = 'ready' | 'uploading' | 'uploaded' | 'sent' | 'failed';

/** A cleaned export, prepared on the device and waiting to be sent (its bytes live in fileStore). */
export interface LabArchive {
  id: string;
  name: string;
  size: number;
  platforms: LabPlatform[];
  categories: CategoryId[];
  kept: Partial<Record<CategoryId, number>>;
  status: FileStatus;
  progress: number;
  uploadId: string | null;
  error: string | null;
}

export interface LabScreenshot {
  id: string;
  name: string;
  type: string;
  size: number;
  width: number;
  height: number;
  status: FileStatus;
  progress: number;
  uploadId: string | null;
  error: string | null;
}

export interface LabSubmission {
  consentId: string | null;
  consentVersion: number;
  consentSentAt: string | null;
  consentStage: SendStage;
  consentError: string | null;
  /** True when the server already held consent for this code (given on another device or earlier). */
  consentOnFile: boolean;
  donationStage: SendStage;
  donationError: string | null;
  donationIds: string[];
  lastDonationAt: string | null;
  archivesSent: number;
  screenshotsSent: number;
}

/** One check-in being filled in, and once sent, its receipt. */
export interface LabCheckInState {
  answers: Record<string, string>;
  checkInId: string | null;
  sentAt: string | null;
  /** How many check-ins this code has sent, from the server. */
  count: number;
}

/** Booking the lab visits: what the server said, and the contact details for the confirmation and reminders. */
export interface LabBookingState {
  options: LabBookingOptions | null;
  /** Remembered on this device for next time (persistence.ts). */
  email: string;
  mobile: string;
  smsReminders: boolean;
  /** The visits just booked or moved on this page, to confirm them. */
  confirmed: { booked: LabBooking[]; kind: 'booked' | 'moved'; email: DeliveryOutcome; sms: DeliveryOutcome } | null;
}

/** A MyStory being written, and the ones sent from this page. */
export interface LabStoryState {
  promptId: string;
  title: string;
  story: string;
  /** Each signifier's answer; 'na' for "not sure". */
  answers: Record<string, StoryAnswer>;
  sent: { storyId: string; title: string; receivedAt: string }[];
}

export interface LabState {
  /** The page this state belongs to; fixed when the page loads. */
  flow: LabFlow;
  stepId: LabStepId;
  codeParts: CodeParts;
  code: string;
  codeConfirmed: boolean;
  /** The code everything below belongs to (consent, files, progress), once confirmed. Confirming a different code starts afresh. */
  confirmedCode: string | null;
  /** Whether the ID came from a link or this device (confirmed with one press), rather than from the four details. */
  returning: boolean;
  /** First page: the person chose "Already started?", so their details (or ID) find their record and no mobile number is asked again. */
  carryOn: boolean;
  consent: LabConsentRecord;
  /** iPhone or Android, chosen on the screenshots step so the right steps show and the screenshots are labelled. */
  phone: LabPhone | null;
  /** The phase every send from this page is filed under: set by the page, never asked. */
  phase: LabPhase;
  /** What the server holds for this code, from the last lookup: lets any device carry on where the person left off. */
  progress: LabLookupResult | null;
  checkIn: LabCheckInState;
  /** The app whose download steps are open in the guide. */
  app: LabPlatform | null;
  /** Apps the person has said they do not use: greyed out in the checklist, kept on the server. */
  notUsed: LabPlatform[];
  submission: LabSubmission;
  archives: LabArchive[];
  screenshots: LabScreenshot[];
  booking: LabBookingState;
  story: LabStoryState;
  session: SessionInfo | null;
  restored: boolean;
}

export type { CodeParts, SignatureRecord, StatementRecord };
