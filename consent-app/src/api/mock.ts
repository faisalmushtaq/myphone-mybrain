import { study } from '../config/study';
import { referenceCode } from '../lib/ids';
import type { SessionInfo } from '../model/types';
import { ApiError, type ConsentApi, type ConsentPayload, type ConsentResult, type DonationPayload, type DonationResult, type LabConsentPayload, type LabConsentResult, type LabDonationPayload, type LabDonationResult, type LabLookupResult, type LabReminderResult, type UploadMeta, type UploadSlot } from './types';

export interface MockFlags {
  failUploads: boolean;
  failSubmit: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (min: number, max: number) => min + Math.random() * (max - min);

interface MockSubmission {
  sessionId: string;
  participantId: string;
  version: number;
  consents: ConsentPayload[];
  donations: DonationPayload[];
}

/**
 * In-memory stand-in for the server. Nothing leaves the page. Latency and
 * failures are simulated so that loading, progress and error states can be
 * exercised from the "Prototype controls" panel.
 *
 * Like a real server, it remembers uploads and reference codes across a page
 * refresh (ids only, in sessionStorage); the record contents stay in memory.
 */
export class MockConsentApi implements ConsentApi {
  private uploads = new Map<string, { sessionId: string; size: number; type: string }>();
  private lab = new Map<string, { sessionId: string; consents: LabConsentPayload[]; donations: LabDonationPayload[] }>();
  private submissions = new Map<string, MockSubmission>();
  private static STORE_KEY = 'mpmb-mock-server:v2';

  constructor(private flags: MockFlags) {
    try {
      const raw = window.sessionStorage.getItem(MockConsentApi.STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { uploads: [string, { sessionId: string; size: number; type: string }][]; submissions: [string, { sessionId: string; participantId: string; version: number }][] };
        this.uploads = new Map(parsed.uploads);
        this.submissions = new Map(parsed.submissions.map(([code, s]) => [code, { ...s, consents: [], donations: [] }]));
      }
    } catch {
      /* start empty */
    }
  }

  private persist(): void {
    try {
      const submissions = Array.from(this.submissions.entries()).map(([code, s]) => [code, { sessionId: s.sessionId, participantId: s.participantId, version: s.version }]);
      window.sessionStorage.setItem(MockConsentApi.STORE_KEY, JSON.stringify({ uploads: Array.from(this.uploads.entries()), submissions }));
    } catch {
      /* ignore */
    }
  }

  private checkSession(session: SessionInfo): void {
    if (!session.sessionId) throw new ApiError('expired', 'No session.');
    if (Date.parse(session.expiresAt) < Date.now()) throw new ApiError('expired', 'The session has expired.');
  }

  async startSession(): Promise<SessionInfo> {
    await sleep(jitter(150, 400));
    return {
      sessionId: `sess_${crypto.randomUUID()}`,
      csrfToken: crypto.randomUUID().replace(/-/g, ''),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    };
  }

  async submitConsent(session: SessionInfo, payload: ConsentPayload): Promise<ConsentResult> {
    await sleep(jitter(600, 1200));
    if (this.flags.failSubmit) throw new ApiError('server', 'The server did not respond.');
    this.checkSession(session);
    if (payload.kind === 'consent' && !payload.consent?.signature) throw new ApiError('validation', 'The permission record has no signature.');
    const receivedAt = new Date().toISOString();
    if (payload.referenceCode) {
      const existing = this.submissions.get(payload.referenceCode);
      if (!existing || existing.sessionId !== session.sessionId) throw new ApiError('validation', 'That reference does not belong to this session.');
      existing.version += 1;
      existing.consents.push(payload);
      this.persist();
      return { referenceCode: payload.referenceCode, participantId: existing.participantId, receivedAt, version: existing.version };
    }
    const code = referenceCode();
    const participantId = `part_${crypto.randomUUID()}`;
    this.submissions.set(code, { sessionId: session.sessionId, participantId, version: 1, consents: [payload], donations: [] });
    this.persist();
    return { referenceCode: code, participantId, receivedAt, version: 1 };
  }

  async requestUploadSlot(sessionId: string, meta: UploadMeta): Promise<UploadSlot> {
    await sleep(jitter(150, 350));
    const accepted = study.upload.acceptedTypes as readonly string[];
    if (!accepted.includes(meta.contentType)) throw new ApiError('validation', 'That type of file is not accepted.');
    if (meta.size > study.upload.maxBytesPerImage) throw new ApiError('too-large', 'The image is too large.');
    const uploadId = crypto.randomUUID();
    this.uploads.set(uploadId, { sessionId, size: meta.size, type: meta.contentType });
    this.persist();
    return {
      uploadId,
      url: `mock://quarantine/${sessionId}/${uploadId}`,
      method: 'PUT',
      headers: { 'Content-Type': meta.contentType },
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  async uploadImage(slot: UploadSlot, blob: Blob, onProgress?: (fraction: number) => void): Promise<void> {
    const steps = 8;
    const total = jitter(700, 1300);
    for (let i = 1; i <= steps; i += 1) {
      await sleep(total / steps);
      if (this.flags.failUploads && i === Math.ceil(steps / 2)) {
        throw new ApiError('network', 'The connection dropped while uploading.');
      }
      onProgress?.(i / steps);
    }
    const entry = this.uploads.get(slot.uploadId);
    if (!entry) throw new ApiError('expired', 'The upload link has expired.');
    entry.size = blob.size;
    this.persist();
  }

  async deleteUpload(sessionId: string, uploadId: string): Promise<void> {
    await sleep(jitter(100, 250));
    if (this.uploads.get(uploadId)?.sessionId === sessionId) this.uploads.delete(uploadId);
    this.persist();
  }

  async submitDonation(session: SessionInfo, payload: DonationPayload): Promise<DonationResult> {
    await sleep(jitter(500, 1000));
    if (this.flags.failSubmit) throw new ApiError('server', 'The server did not respond.');
    this.checkSession(session);
    const submission = this.submissions.get(payload.referenceCode);
    if (!submission || submission.sessionId !== session.sessionId) throw new ApiError('validation', 'That reference does not belong to this session.');
    const accepted: string[] = [];
    for (const upload of payload.uploads) {
      if (this.uploads.get(upload.uploadId)?.sessionId !== session.sessionId) throw new ApiError('validation', 'One of the images was not uploaded correctly.');
      accepted.push(upload.uploadId);
      this.uploads.delete(upload.uploadId);
    }
    submission.donations.push(payload);
    this.persist();
    return { donationId: `don_${crypto.randomUUID()}`, receivedAt: new Date().toISOString(), accepted, rejected: [] };
  }

  /** For debugging in the browser console during design review. */
  async submitLabConsent(session: SessionInfo, payload: LabConsentPayload): Promise<LabConsentResult> {
    await sleep(jitter(400, 900));
    if (this.flags.failSubmit) throw new ApiError('server', 'The server did not respond.');
    this.checkSession(session);
    if (!payload.consent.signature) throw new ApiError('validation', 'The consent record has no signature.');
    const existing = this.lab.get(payload.participantCode) ?? { sessionId: session.sessionId, consents: [], donations: [] };
    existing.consents.push(payload);
    this.lab.set(payload.participantCode, existing);
    return { participantCode: payload.participantCode, consentId: `labc_${existing.consents.length}_${payload.participantCode}`, receivedAt: new Date().toISOString(), version: existing.consents.length };
  }

  async lookupLabParticipant(session: SessionInfo, participantCode: string): Promise<LabLookupResult> {
    await sleep(jitter(200, 500));
    this.checkSession(session);
    const found = this.lab.get(participantCode);
    const uploads = found?.donations.flatMap((d) => d.uploads) ?? [];
    return { exists: Boolean(found?.consents.length), consentedAt: found?.consents.at(-1)?.consent.completedAt ?? null, archives: uploads.filter((u) => u.kind === 'archive').length, screenshots: uploads.filter((u) => u.kind === 'screenshot').length };
  }

  async requestLabUploadSlot(sessionId: string, meta: { contentType: string; size: number }): Promise<UploadSlot> {
    await sleep(jitter(80, 200));
    if (meta.size > 60 * 1024 * 1024) throw new ApiError('too-large', 'The file is too large.');
    const uploadId = crypto.randomUUID();
    this.uploads.set(uploadId, { sessionId, size: meta.size, type: meta.contentType });
    this.persist();
    return { uploadId, url: `mock://labquarantine/${uploadId}`, method: 'PUT', headers: { 'Content-Type': meta.contentType }, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() };
  }

  async deleteLabUpload(_sessionId: string, uploadId: string): Promise<void> {
    this.uploads.delete(uploadId);
    this.persist();
  }

  async submitLabDonation(session: SessionInfo, payload: LabDonationPayload): Promise<LabDonationResult> {
    await sleep(jitter(500, 1000));
    if (this.flags.failSubmit) throw new ApiError('server', 'The server did not respond.');
    this.checkSession(session);
    const participant = this.lab.get(payload.participantCode);
    if (!participant?.consents.length) throw new ApiError('validation', 'We have no consent for that participant code yet.');
    const accepted: string[] = [];
    const rejected: { uploadId: string; reason: string }[] = [];
    for (const u of payload.uploads) {
      if (this.uploads.has(u.uploadId)) accepted.push(u.uploadId);
      else rejected.push({ uploadId: u.uploadId, reason: 'This file was not uploaded correctly. Please add it again.' });
    }
    participant.donations.push({ ...payload, uploads: payload.uploads.filter((u) => accepted.includes(u.uploadId)) });
    return { donationId: accepted.length ? `labd_${participant.donations.length}_${payload.participantCode}` : null, receivedAt: new Date().toISOString(), accepted, rejected };
  }

  async requestLabReminder(session: SessionInfo, payload: { participantCode: string; email: string }): Promise<LabReminderResult> {
    await sleep(jitter(300, 700));
    this.checkSession(session);
    if (!this.lab.has(payload.participantCode)) throw new ApiError('validation', 'We have no consent on file for this participant code. Please give your consent first.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(payload.email)) throw new ApiError('validation', 'Enter an email address in the format name@example.com.');
    return { outcome: 'sent', followUpAt: new Date(Date.now() + 48 * 3600_000).toISOString() };
  }

  inspectLab() {
    return Array.from(this.lab.entries()).map(([code, p]) => ({ code, consents: p.consents, donations: p.donations }));
  }

  inspect() {
    return { uploads: Array.from(this.uploads.entries()), submissions: Array.from(this.submissions.entries()) };
  }
}
