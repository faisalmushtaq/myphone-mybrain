import type { DocumentData } from 'firebase-admin/firestore';
import type { Collections, Doc, OutFile } from './export.js';
import { jsonFile, textFile } from './export.js';

/**
 * The data health check (17 October 2026): every hour, with the export, the
 * records are checked against each other and against the files in storage,
 * so that anything missing, doubled or out of step is seen the same day, not
 * at analysis. The result is written into the export (DATA HEALTH.txt and
 * data-health.json, so it is in OneDrive with the data) and kept for the staff
 * page. It changes nothing: it only reports.
 *
 * Uploads that were never saved (in quarantine an hour or more) are counted,
 * not rescued: such a file may be a screenshot the person removed, or the
 * original of one they edited to hide something, so keeping it would break
 * that promise. They are deleted after 24 hours (purgeQuarantine).
 */

export interface HealthProblem {
  /** Which part of the data: the schools study, the break study, uploads. */
  area: 'schools' | 'break' | 'uploads';
  /** What is wrong, in plain words. */
  what: string;
  /** What to do about it. */
  action: string;
  count: number;
  /** Up to ten references, codes or file names, to look into. */
  examples: string[];
}

export interface HealthReport {
  checkedAt: string;
  ok: boolean;
  /** What was checked, and how many of each. */
  checked: Record<string, number>;
  problems: HealthProblem[];
  /** Not problems, for information: uploads never saved, waiting to be deleted. */
  notes: string[];
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v ?? 0) || 0);

/** The checks, from the records, the stored file names and the quarantine listing (a pure function, so it can be tested). */
export function healthOf(c: Pick<Collections, 'submissions' | 'donations' | 'participants' | 'consents' | 'assents' | 'labParticipants' | 'labConsents' | 'labDonations' | 'labStories' | 'labStoryChats' | 'labBookings' | 'labSlots'>, stored: ReadonlySet<string>, quarantine: { name: string; created: string | null }[], now = new Date()): HealthReport {
  const problems: HealthProblem[] = [];
  const add = (area: HealthProblem['area'], what: string, action: string, examples: string[]) => {
    if (examples.length) problems.push({ area, what, action, count: examples.length, examples: examples.slice(0, 10) });
  };
  const byId = (docs: Doc[]) => new Map(docs.map((d) => [d.id, d.data]));

  // ---- Schools study --------------------------------------------------------------------------------------------------
  const donations = byId(c.donations);
  const participants = byId(c.participants);
  const consents = byId(c.consents);
  const assents = byId(c.assents);
  const subs = c.submissions.filter((s) => s.data.kind === 'consent');
  const countOff: string[] = [];
  const missingDonation: string[] = [];
  const otherParticipant: string[] = [];
  const noParticipant: string[] = [];
  const noConsent: string[] = [];
  const noAssent: string[] = [];
  const claimed = new Map<string, string>();
  const doubleClaimed: string[] = [];
  for (const s of subs) {
    const ids = arr(s.data.donationIds).map(String);
    let images = 0;
    for (const id of ids) {
      const d = donations.get(id);
      if (!d) {
        missingDonation.push(`${s.id} → ${id}`);
        continue;
      }
      images += arr(d.images).length;
      if (String(d.participantId) !== String(s.data.participantId)) otherParticipant.push(`${s.id} → ${id}`);
      const before = claimed.get(id);
      if (before && before !== s.id) doubleClaimed.push(`${id}: ${before} and ${s.id}`);
      claimed.set(id, s.id);
    }
    if (num(s.data.imageCount) !== images) countOff.push(`${s.id}: says ${num(s.data.imageCount)}, holds ${images}`);
    if (!participants.has(String(s.data.participantId))) noParticipant.push(s.id);
    if (s.data.consentId && !consents.has(String(s.data.consentId))) noConsent.push(s.id);
    if (s.data.assentId && !assents.has(String(s.data.assentId))) noAssent.push(s.id);
  }
  const uploads = new Map<string, string>();
  const twice: string[] = [];
  const missingImage: string[] = [];
  let imageCount = 0;
  for (const d of c.donations) {
    for (const image of arr(d.data.images) as DocumentData[]) {
      imageCount += 1;
      const uploadId = String(image.uploadId ?? '');
      if (uploadId && uploads.has(uploadId)) twice.push(`${uploadId} in ${uploads.get(uploadId)} and ${d.id}`);
      else if (uploadId) uploads.set(uploadId, d.id);
      if (image.path && !stored.has(String(image.path))) missingImage.push(String(image.path));
    }
  }
  const unclaimed = c.donations.filter((d) => !claimed.has(d.id) && arr(d.data.images).length).map((d) => d.id);
  add('schools', 'A screenshot on a record is not in storage', 'Look up the record; ask the family to send the screenshot again.', missingImage);
  add('schools', 'A record’s screenshot count does not match the screenshots it holds', 'Tell the developer: the count on the record is wrong.', countOff);
  add('schools', 'A record points at a screenshot send that does not exist', 'Tell the developer.', missingDonation);
  add('schools', 'A screenshot send belongs to another participant than its record', 'Tell the developer.', otherParticipant);
  add('schools', 'Two records claim the same screenshot send', 'Tell the developer.', doubleClaimed);
  add('schools', 'A screenshot send is on no record', 'Tell the developer: the screenshots are stored but not counted.', unclaimed);
  add('schools', 'The same screenshot is stored twice', 'Tell the developer; count it once in the analysis.', twice);
  add('schools', 'A record’s family details are missing', 'Tell the developer.', noParticipant);
  add('schools', 'A record’s permission is missing', 'Tell the developer.', noConsent);
  add('schools', 'A record’s young person’s agreement is missing', 'Tell the developer.', noAssent);

  // ---- Break study ----------------------------------------------------------------------------------------------------
  const labConsents = byId(c.labConsents);
  const filesOf = new Map<string, DocumentData[]>();
  const labUploads = new Map<string, string>();
  const labTwice: string[] = [];
  const labMissing: string[] = [];
  let labFileCount = 0;
  for (const d of c.labDonations) {
    const code = String(d.data.participantCode);
    for (const f of arr(d.data.files) as DocumentData[]) {
      labFileCount += 1;
      filesOf.set(code, [...(filesOf.get(code) ?? []), f]);
      const uploadId = String(f.uploadId ?? '');
      if (uploadId && labUploads.has(uploadId)) labTwice.push(`${uploadId} in ${labUploads.get(uploadId)} and ${d.id}`);
      else if (uploadId) labUploads.set(uploadId, d.id);
      if (f.path && !stored.has(String(f.path))) labMissing.push(String(f.path));
    }
  }
  const storiesOf = new Map<string, Doc[]>();
  for (const s of c.labStories) storiesOf.set(String(s.data.participantCode), [...(storiesOf.get(String(s.data.participantCode)) ?? []), s]);
  const labCountOff: string[] = [];
  const labNoConsent: string[] = [];
  const storyOff: string[] = [];
  for (const p of c.labParticipants) {
    if (p.data.consentId && !labConsents.has(String(p.data.consentId))) labNoConsent.push(p.id);
    const files = filesOf.get(p.id) ?? [];
    const archives = files.filter((f) => f.kind === 'archive').length;
    const screenshots = files.length - archives;
    if (num(p.data.archiveCount) !== archives || num(p.data.screenshotCount) !== screenshots) labCountOff.push(`${p.id}: says ${num(p.data.archiveCount)} archives and ${num(p.data.screenshotCount)} screenshots, holds ${archives} and ${screenshots}`);
    const stories = storiesOf.get(p.id) ?? [];
    const listed = arr(p.data.storyIds).map(String);
    const counted = ['pre', 'mid', 'post'].reduce((n, phase) => n + num(p.data.storyCounts?.[phase]), 0);
    if (listed.length !== stories.length || counted !== stories.length || stories.some((s) => !listed.includes(s.id))) storyOff.push(`${p.id}: ${stories.length} stories, ${listed.length} listed, ${counted} counted`);
  }
  const active = c.labBookings.filter((b) => b.data.status === 'booked' || b.data.status === 'attended');
  const slotOff: string[] = [];
  for (const s of c.labSlots) {
    const inIt = active.filter((b) => String(b.data.slotId) === s.id).length;
    if (num(s.data.booked) !== inIt) slotOff.push(`${s.id}: says ${num(s.data.booked)} booked, holds ${inIt}`);
    else if (inIt > num(s.data.capacity ?? 1)) slotOff.push(`${s.id}: ${inIt} booked for ${num(s.data.capacity ?? 1)} spaces`);
  }
  const visitTwice: string[] = [];
  const seenVisit = new Set<string>();
  for (const b of active) {
    const key = `${b.data.participantCode} visit ${b.data.visit}`;
    if (seenVisit.has(key)) visitTwice.push(key);
    seenVisit.add(key);
  }
  add('break', 'A file on a participant’s record is not in storage', 'Look up the participant; ask them to send the file again.', labMissing);
  add('break', 'A participant’s file counts do not match the files they sent', 'Tell the developer: the counts on the record are wrong.', labCountOff);
  add('break', 'The same file is stored twice', 'Tell the developer; count it once in the analysis.', labTwice);
  add('break', 'A participant’s consent record is missing', 'Tell the developer.', labNoConsent);
  add('break', 'A participant’s MyStory stories and their record disagree', 'Tell the developer.', storyOff);
  add('break', 'A lab time’s bookings do not match its count, or it is booked past its spaces', 'Check the times on the staff page; tell the developer.', slotOff);
  add('break', 'A participant has the same visit booked twice', 'Cancel one of the two on the staff page.', visitTwice);

  // ---- Uploads never saved ------------------------------------------------------------------------------------------
  const hour = 3600_000;
  const waiting = quarantine.filter((q) => q.created && now.getTime() - Date.parse(q.created) > hour);
  const notes: string[] = [];
  if (waiting.length) notes.push(`${waiting.length} upload${waiting.length === 1 ? ' was' : 's were'} added on a phone but never saved (the page was closed before it could save, or the person removed or changed it). They are not kept: each is deleted 24 hours after it was added.`);

  return {
    checkedAt: now.toISOString(),
    ok: problems.length === 0,
    checked: { familyRecords: subs.length, screenshotSends: c.donations.length, screenshots: imageCount, breakParticipants: c.labParticipants.length, breakFiles: labFileCount, stories: c.labStories.length, chats: c.labStoryChats.length, labTimes: c.labSlots.length, bookings: active.length },
    problems,
    notes,
  };
}

/** The report as plain text for OneDrive, read by people, not programs. */
export function healthText(r: HealthReport): string {
  const when = new Date(r.checkedAt).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'long', timeStyle: 'short' });
  const lines = [
    'DATA HEALTH',
    '',
    `Checked ${when} (UK time), with the hourly export.`,
    '',
    r.ok ? 'Everything checks out: every record holds what it says, every file it points at is stored, and nothing is stored twice.' : `${r.problems.length} problem${r.problems.length === 1 ? '' : 's'} found. Each is listed below with what to do.`,
    '',
    `Checked: ${r.checked.familyRecords} family records, ${r.checked.screenshots} screenshots, ${r.checked.breakParticipants} break-study participants, ${r.checked.breakFiles} break-study files, ${r.checked.stories} MyStory stories, ${r.checked.bookings} lab bookings.`,
  ];
  for (const p of r.problems) lines.push('', `PROBLEM (${p.area === 'schools' ? 'schools study' : p.area === 'break' ? 'break study' : 'uploads'}): ${p.what}: ${p.count}.`, `What to do: ${p.action}`, ...p.examples.map((e) => `  ${e}`), ...(p.count > p.examples.length ? [`  … and ${p.count - p.examples.length} more (data-health.json lists the first ten)`] : []));
  for (const n of r.notes) lines.push('', `Note: ${n}`);
  lines.push('', 'data-health.json has the same, for programs. Nothing here changes the data: it only reports.', '');
  return lines.join('\n');
}

/** The two files the export writes at the top of its folder. */
export function healthFiles(r: HealthReport): OutFile[] {
  return [textFile('DATA HEALTH.txt', healthText(r)), jsonFile('data-health.json', r)];
}
