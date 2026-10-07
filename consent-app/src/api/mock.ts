import { study } from '../config/study';
import { referenceCode } from '../lib/ids';
import type { SessionInfo } from '../model/types';
import { labBooking } from '../lab/booking';
import { addDays, atUkTime, daysBetween, previewIcs, ukIsoDay } from '../lab/calendar';
import { ApiError, type ConsentApi, type ConsentPayload, type ConsentResult, type DeliveryOutcome, type DonationPayload, type DonationResult, type LabBooking, type LabBookingOptions, type LabBookPayload, type LabBookResult, type LabCancelResult, type LabCheckInPayload, type LabCheckInResult, type LabConsentPayload, type LabConsentResult, type LabDonationPayload, type LabDonationResult, type LabLookupResult, type LabPhase, type LabPlatform, type LabReminderResult, type LabSlot, type LabStoryPayload, type LabStoryResult, type LabVisit, type UploadMeta, type UploadSlot } from './types';

export interface MockFlags {
  failUploads: boolean;
  failSubmit: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (min: number, max: number) => min + Math.random() * (max - min);

interface MockBooking {
  bookingId: string;
  visit: LabVisit;
  slotId: string;
  start: string;
  end: string;
  status: LabBooking['status'];
  sequence: number;
}

interface MockLab {
  sessionId: string;
  consents: LabConsentPayload[];
  donations: LabDonationPayload[];
  checkIns: (LabCheckInPayload & { receivedAt: string })[];
  notUsed: LabPlatform[];
  bookings: MockBooking[];
  stories: Pick<LabStoryPayload, 'phase' | 'promptId' | 'title'>[];
}

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
  private lab = new Map<string, MockLab>();
  private submissions = new Map<string, MockSubmission>();
  private static STORE_KEY = 'mpmb-mock-server:v2';
  /** The lab study's records, in localStorage so the study's three pages see the same participants, as they would the real server. */
  private static LAB_KEY = 'mpmb-mock-lab:v1';

  constructor(private flags: MockFlags) {
    try {
      const lab = window.localStorage.getItem(MockConsentApi.LAB_KEY);
      if (lab) {
        const entries = JSON.parse(lab) as [string, Partial<MockLab>][];
        this.lab = new Map(entries.map(([code, e]) => [code, { sessionId: e.sessionId ?? '', consents: e.consents ?? [], donations: e.donations ?? [], checkIns: e.checkIns ?? [], notUsed: e.notUsed ?? [], bookings: e.bookings ?? [], stories: e.stories ?? [] }]));
      }
    } catch {
      /* start empty */
    }
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

  /** Keeps what the lab pages need to recognise a code: when consent was given, what was sent in which phase, the check-ins. No names, signatures or file contents. */
  private persistLab(): void {
    try {
      const slim = Array.from(this.lab.entries()).map(([code, p]) => [
        code,
        {
          sessionId: p.sessionId,
          consents: p.consents.map((c) => ({ consent: { completedAt: c.consent.completedAt } })),
          donations: p.donations.map((d) => ({ phase: d.phase, uploads: d.uploads.map((u) => ({ uploadId: u.uploadId, kind: u.kind, platforms: u.platforms })) })),
          checkIns: p.checkIns.map((c) => ({ receivedAt: c.receivedAt, answers: c.answers })),
          notUsed: p.notUsed,
          bookings: p.bookings,
          stories: p.stories.map((x) => ({ phase: x.phase, promptId: x.promptId, title: x.title })),
        },
      ]);
      window.localStorage.setItem(MockConsentApi.LAB_KEY, JSON.stringify(slim));
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
    const existing = this.lab.get(payload.participantCode) ?? { sessionId: session.sessionId, consents: [], donations: [], checkIns: [], notUsed: [], bookings: [], stories: [] };
    existing.consents.push(payload);
    this.lab.set(payload.participantCode, existing);
    this.persistLab();
    return { participantCode: payload.participantCode, consentId: `labc_${existing.consents.length}_${payload.participantCode}`, receivedAt: new Date().toISOString(), version: existing.consents.length };
  }

  async lookupLabParticipant(session: SessionInfo, participantCode: string): Promise<LabLookupResult> {
    await sleep(jitter(200, 500));
    this.checkSession(session);
    const found = this.lab.get(participantCode);
    const uploads = found?.donations.flatMap((d) => d.uploads) ?? [];
    const counts = (phase: LabPhase) => {
      const mine = found?.donations.filter((d) => d.phase === phase).flatMap((d) => d.uploads) ?? [];
      return { archives: mine.filter((u) => u.kind === 'archive').length, screenshots: mine.filter((u) => u.kind === 'screenshot').length, platforms: Array.from(new Set(mine.flatMap((u) => u.platforms ?? []))).sort() };
    };
    return {
      exists: Boolean(found?.consents.length),
      consentedAt: found?.consents.at(-1)?.consent.completedAt ?? null,
      archives: uploads.filter((u) => u.kind === 'archive').length,
      screenshots: uploads.filter((u) => u.kind === 'screenshot').length,
      phases: { pre: counts('pre'), mid: counts('mid'), post: counts('post') },
      checkIns: found?.checkIns.length ?? 0,
      lastCheckInAt: found?.checkIns.at(-1)?.receivedAt ?? null,
      platformsNotUsed: found?.notUsed ?? [],
      visits: (found?.bookings ?? []).filter((b) => b.status === 'booked' || b.status === 'attended').map((b) => ({ visit: b.visit, start: b.start, status: b.status })),
      stories: { pre: found?.stories.filter((x) => x.phase === 'pre').length ?? 0, mid: found?.stories.filter((x) => x.phase === 'mid').length ?? 0, post: found?.stories.filter((x) => x.phase === 'post').length ?? 0 },
    };
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
    const sentPlatforms = payload.uploads.filter((u) => accepted.includes(u.uploadId)).flatMap((u) => u.platforms ?? []);
    participant.notUsed = participant.notUsed.filter((p) => !sentPlatforms.includes(p));
    this.persistLab();
    return { donationId: accepted.length ? `labd_${participant.donations.length}_${payload.participantCode}` : null, receivedAt: new Date().toISOString(), accepted, rejected };
  }

  async submitLabCheckIn(session: SessionInfo, payload: LabCheckInPayload): Promise<LabCheckInResult> {
    await sleep(jitter(300, 700));
    if (this.flags.failSubmit) throw new ApiError('server', 'The server did not respond.');
    this.checkSession(session);
    const participant = this.lab.get(payload.participantCode);
    if (!participant?.consents.length) throw new ApiError('validation', 'We have no consent on file for this participant code.');
    const receivedAt = new Date().toISOString();
    participant.checkIns.push({ ...payload, receivedAt });
    this.persistLab();
    return { checkInId: `labk_${participant.checkIns.length}_${payload.participantCode}`, receivedAt, count: participant.checkIns.length };
  }

  async updateLabPlatforms(session: SessionInfo, payload: { participantCode: string; notUsed: LabPlatform[] }): Promise<{ notUsed: LabPlatform[] }> {
    await sleep(jitter(200, 500));
    if (this.flags.failSubmit) throw new ApiError('server', 'The server did not respond.');
    this.checkSession(session);
    const participant = this.lab.get(payload.participantCode);
    if (!participant?.consents.length) throw new ApiError('validation', 'We have no consent on file for this participant code.');
    participant.notUsed = Array.from(new Set(payload.notUsed)).sort();
    this.persistLab();
    return { notUsed: participant.notUsed };
  }

  async requestLabReminder(session: SessionInfo, payload: { participantCode: string; email: string; phase: LabPhase }): Promise<LabReminderResult> {
    await sleep(jitter(300, 700));
    this.checkSession(session);
    if (!this.lab.has(payload.participantCode)) throw new ApiError('validation', 'We have no consent on file for this participant code. Please give your consent first.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(payload.email)) throw new ApiError('validation', 'Enter an email address in the format name@example.com.');
    return { outcome: 'sent', followUpAt: new Date(Date.now() + 48 * 3600_000).toISOString() };
  }

  /* ── Lab visits: weekday mornings and afternoons, made up in the browser ── */

  private place() {
    return { ...labBooking.location };
  }

  private mockSlots(): LabSlot[] {
    const taken = new Map<string, number>();
    for (const p of this.lab.values()) for (const b of p.bookings) if (b.status === 'booked' || b.status === 'attended') taken.set(b.slotId, (taken.get(b.slotId) ?? 0) + 1);
    const today = ukIsoDay(new Date().toISOString());
    const out: LabSlot[] = [];
    for (let d = 1; d <= labBooking.horizonDays + labBooking.visit2AfterDays.max; d += 1) {
      const day = addDays(today, d);
      const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      for (const hour of [10, 14]) {
        const start = atUkTime(day, hour);
        const slotId = `mock${day.replace(/-/g, '')}${hour}`;
        if (start.getTime() < Date.now() + labBooking.minNoticeHours * 3600_000 || taken.get(slotId)) continue;
        out.push({ slotId, start: start.toISOString(), end: new Date(start.getTime() + labBooking.minutes * 60_000).toISOString(), visit: null, place: this.place(), spaces: 1 });
      }
    }
    return out;
  }

  private bookingView(code: string, b: MockBooking): LabBooking {
    return { bookingId: b.bookingId, visit: b.visit, start: b.start, end: b.end, place: this.place(), status: b.status, canChange: b.status === 'booked' && Date.parse(b.start) - Date.now() >= labBooking.changeUntilHours * 3600_000, ics: previewIcs({ code, visit: b.visit, start: b.start, end: b.end, place: this.place(), sequence: b.sequence }) };
  }

  private standing(p: MockLab, visit: LabVisit): MockBooking | undefined {
    return p.bookings.filter((b) => b.visit === visit && (b.status === 'booked' || b.status === 'attended')).at(-1);
  }

  /** As the server: nothing until the data is in, then both visits together; a missed or cancelled one leaves that visit to book. */
  private bookingStateOf(p: MockLab | undefined): { missing: string[]; active: Record<LabVisit, MockBooking | undefined>; toBook: LabVisit[] } {
    const pre = p?.donations.filter((d) => d.phase === 'pre').flatMap((d) => d.uploads) ?? [];
    const missing = [!p?.consents.length ? 'your consent' : '', pre.some((u) => u.kind === 'screenshot') ? '' : 'your screen-time screenshots', pre.some((u) => u.kind === 'archive') ? '' : 'the cleaned data from at least one of your apps'].filter(Boolean);
    const active = { 1: p ? this.standing(p, 1) : undefined, 2: p ? this.standing(p, 2) : undefined };
    return { missing, active, toBook: missing.length ? [] : ([1, 2] as LabVisit[]).filter((v) => !active[v]) };
  }

  async labBookingOptions(session: SessionInfo, participantCode: string): Promise<LabBookingOptions> {
    await sleep(jitter(250, 600));
    this.checkSession(session);
    const p = this.lab.get(participantCode);
    const { missing, toBook } = this.bookingStateOf(p);
    const all = missing.length ? [] : this.mockSlots();
    const last1 = addDays(ukIsoDay(new Date().toISOString()), labBooking.horizonDays);
    return {
      consent: Boolean(p?.consents.length),
      missing,
      bookings: (p?.bookings ?? []).filter((b) => b.status !== 'cancelled').map((b) => this.bookingView(participantCode, b)),
      toBook,
      slots: { 1: all.filter((s) => ukIsoDay(s.start) <= last1), 2: all },
      gap: { ...labBooking.visit2AfterDays },
      smsAvailable: true,
      rules: { minNoticeHours: labBooking.minNoticeHours, changeUntilHours: labBooking.changeUntilHours },
    };
  }

  async bookLabSlot(session: SessionInfo, payload: LabBookPayload): Promise<LabBookResult> {
    await sleep(jitter(400, 900));
    if (this.flags.failSubmit) throw new ApiError('server', 'The server did not respond.');
    this.checkSession(session);
    const p = this.lab.get(payload.participantCode);
    if (!p?.consents.length) throw new ApiError('validation', 'We have no consent on file for this participant ID.');
    const { missing, active } = this.bookingStateOf(p);
    if (missing.length) throw new ApiError('validation', `Your lab visits can be booked once ${missing.join(' and ')} ${missing.length === 1 ? 'has' : 'have'} arrived.`);
    const all = this.mockSlots();
    const plan: Record<LabVisit, { start: string } | undefined> = { 1: active[1], 2: active[2] };
    const chosen = payload.visits.map((c) => {
      const slot = all.find((s) => s.slotId === c.slotId);
      if (!slot) throw new ApiError('validation', 'That time has just been taken. Please choose another.');
      const previous = active[c.visit];
      if (previous && previous.status !== 'booked') throw new ApiError('validation', 'That visit has already happened.');
      plan[c.visit] = slot;
      return { ...c, slot, previous };
    });
    if (!plan[1] || !plan[2]) throw new ApiError('validation', 'Please choose a time for both visits: they are booked together.');
    const gap = daysBetween(ukIsoDay(plan[1].start), ukIsoDay(plan[2].start));
    const { min, max } = labBooking.visit2AfterDays;
    if (gap < min || gap > max) throw new ApiError('validation', `Your second visit needs to be ${min} to ${max} days after your first.`);
    const booked = chosen.map(({ visit, slot, previous }) => {
      if (previous) previous.status = 'cancelled';
      const sequence = Math.max(-1, ...p.bookings.filter((b) => b.visit === visit).map((b) => b.sequence)) + 1;
      const booking: MockBooking = { bookingId: `labb_${crypto.randomUUID().slice(0, 8)}`, visit, slotId: slot.slotId, start: slot.start, end: slot.end, status: 'booked', sequence };
      p.bookings.push(booking);
      return this.bookingView(payload.participantCode, booking);
    });
    this.persistLab();
    return { booked, kind: chosen.some((c) => c.previous) ? 'moved' : 'booked', email: 'sent' as DeliveryOutcome, sms: payload.smsReminders ? 'sent' : 'not-wanted' };
  }

  async cancelLabBooking(session: SessionInfo, payload: { participantCode: string; bookingIds?: string[] | null }): Promise<LabCancelResult> {
    await sleep(jitter(300, 700));
    this.checkSession(session);
    const mine = this.lab.get(payload.participantCode)?.bookings ?? [];
    const targets = payload.bookingIds?.length ? mine.filter((b) => payload.bookingIds!.includes(b.bookingId) && b.status === 'booked') : mine.filter((b) => b.status === 'booked' && Date.parse(b.start) > Date.now());
    if (!targets.length) throw new ApiError('validation', 'There are no visits to cancel.');
    for (const b of targets) b.status = 'cancelled';
    this.persistLab();
    return { bookingIds: targets.map((b) => b.bookingId), email: 'sent' };
  }

  async submitLabStory(session: SessionInfo, payload: LabStoryPayload): Promise<LabStoryResult> {
    await sleep(jitter(300, 700));
    if (this.flags.failSubmit) throw new ApiError('server', 'The server did not respond.');
    this.checkSession(session);
    const p = this.lab.get(payload.participantCode);
    if (!p?.consents.length) throw new ApiError('validation', 'We have no consent on file for this participant ID.');
    p.stories.push({ phase: payload.phase, promptId: payload.promptId, title: payload.title });
    this.persistLab();
    return { storyId: `labs_${p.stories.length}`, receivedAt: new Date().toISOString() };
  }

  async callTool<Res>(): Promise<Res> {
    await sleep(200);
    throw new ApiError('server', 'This page needs the live study database; it does not work in the preview.');
  }

  inspectLab() {
    return Array.from(this.lab.entries()).map(([code, p]) => ({ code, consents: p.consents, donations: p.donations, checkIns: p.checkIns }));
  }

  inspect() {
    return { uploads: Array.from(this.uploads.entries()), submissions: Array.from(this.submissions.entries()) };
  }
}
