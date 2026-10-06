import type { LabConsentRecord, LabPhase, LabPhone, LabPlatform } from '../api/types';
import type { SendStage, SessionInfo, SignatureRecord, StatementRecord } from '../model/types';
import type { CategoryId } from './cleaner';
import type { CodeParts } from './config';

/**
 * State of the social media break study's flow. Kept deliberately separate
 * from the family consent app: adults consent for themselves, there is no
 * handover, and the process spans days (a data export can take a while to
 * arrive), so progress lives in localStorage keyed by the participant code.
 */

export type LabStepId = 'welcome' | 'participant-id' | 'information' | 'consent' | 'guide' | 'clean' | 'donate' | 'done';

export const labStepOrder: LabStepId[] = ['welcome', 'participant-id', 'information', 'consent', 'guide', 'clean', 'donate', 'done'];

export const labStepTitles: Record<LabStepId, string> = {
  welcome: 'Social media break study',
  'participant-id': 'Your participant code',
  information: 'About the study',
  consent: 'Your consent',
  guide: 'Get your data',
  clean: 'Choose what to share',
  donate: 'Send your data',
  done: 'Thank you',
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

export interface LabState {
  stepId: LabStepId;
  codeParts: CodeParts;
  code: string;
  codeConfirmed: boolean;
  /** Whether the person typed a code they already had, rather than building it. */
  returning: boolean;
  consent: LabConsentRecord;
  /** iPhone or Android, chosen in the guide so the right steps show and the screenshots are labelled. */
  phone: LabPhone | null;
  /** Whether the files being sent are from before or after the break. */
  phase: LabPhase | null;
  submission: LabSubmission;
  archives: LabArchive[];
  screenshots: LabScreenshot[];
  session: SessionInfo | null;
  restored: boolean;
}

export type { CodeParts, SignatureRecord, StatementRecord };
