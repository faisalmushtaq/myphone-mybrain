import { study } from '../config/study';
import { referenceCode } from '../lib/ids';
import type { SessionInfo } from '../model/types';
import { ApiError, type ConsentApi, type SubmissionPayload, type SubmissionResult, type UploadMeta, type UploadSlot } from './types';

export interface MockFlags {
  failUploads: boolean;
  failSubmit: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * In-memory stand-in for the server. Nothing leaves the page. Latency and
 * failures are simulated so that loading, progress and error states can be
 * exercised from the "Prototype controls" panel.
 */
export class MockConsentApi implements ConsentApi {
  /**
   * Stands in for the server's record of quarantined uploads. It is kept in
   * sessionStorage (ids and sizes only, never image bytes) so that, like a
   * real server, the mock still knows about uploads after the page reloads.
   */
  private uploads = new Map<string, { sessionId: string; size: number; type: string }>();
  private submissions: { payload: SubmissionPayload; result: SubmissionResult }[] = [];
  private static STORE_KEY = 'mpmb-mock-server:v1';

  constructor(private flags: MockFlags) {
    try {
      const raw = window.sessionStorage.getItem(MockConsentApi.STORE_KEY);
      if (raw) this.uploads = new Map(JSON.parse(raw) as [string, { sessionId: string; size: number; type: string }][]);
    } catch {
      /* start empty */
    }
  }

  private persist(): void {
    try {
      window.sessionStorage.setItem(MockConsentApi.STORE_KEY, JSON.stringify(Array.from(this.uploads.entries())));
    } catch {
      /* ignore */
    }
  }

  async startSession(): Promise<SessionInfo> {
    await sleep(jitter(150, 400));
    return {
      sessionId: `sess_${crypto.randomUUID()}`,
      csrfToken: crypto.randomUUID().replace(/-/g, ''),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    };
  }

  async requestUploadSlot(sessionId: string, meta: UploadMeta): Promise<UploadSlot> {
    await sleep(jitter(150, 350));
    const accepted = study.upload.acceptedTypes as readonly string[];
    if (!accepted.includes(meta.contentType)) throw new ApiError('validation', 'That type of file is not accepted.');
    if (meta.size > study.upload.maxBytesPerImage) throw new ApiError('too-large', 'The image is too large.');
    const uploadId = `upl_${crypto.randomUUID()}`;
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
    // Like the real server, only the session that created an upload may remove it.
    if (this.uploads.get(uploadId)?.sessionId === sessionId) this.uploads.delete(uploadId);
    this.persist();
  }

  async submit(session: SessionInfo, payload: SubmissionPayload): Promise<SubmissionResult> {
    await sleep(jitter(700, 1400));
    if (this.flags.failSubmit) throw new ApiError('server', 'The server did not respond.');
    if (!session.csrfToken) throw new ApiError('validation', 'Missing security token.');
    if (Date.parse(session.expiresAt) < Date.now()) throw new ApiError('expired', 'The session has expired.');
    for (const upload of payload.donation.uploads) {
      // Uploads must exist and belong to this session (the real server enforces the same ownership rule).
      if (this.uploads.get(upload.uploadId)?.sessionId !== session.sessionId) throw new ApiError('validation', 'One of the images was not uploaded correctly.');
    }
    if (payload.kind === 'consent' && !payload.consent?.signature) throw new ApiError('validation', 'The consent record has no signature.');
    const result: SubmissionResult = { referenceCode: referenceCode(), receivedAt: new Date().toISOString() };
    this.submissions.push({ payload, result });
    // Linked uploads leave quarantine; anything else for this session is discarded.
    for (const [id, entry] of Array.from(this.uploads.entries())) {
      if (entry.sessionId === session.sessionId) this.uploads.delete(id);
    }
    this.persist();
    return result;
  }

  /** For debugging in the browser console during design review. */
  inspect() {
    return { uploads: Array.from(this.uploads.entries()), submissions: this.submissions };
  }
}
