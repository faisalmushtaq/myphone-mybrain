import { PARTICIPANT_CODE } from './config';
import type { LabPhase } from '../api/types';
import { labFlowPhase, type LabFlow, type LabState } from './model';
import { emptyStory, initialLabState } from './reducer';

/**
 * Progress is kept in localStorage, not sessionStorage, because this process
 * spans days: a TikTok, YouTube or Instagram export can take a while to arrive, and
 * people come back to send it. Nothing but the person's own code, their
 * consent record and the list of files already sent is kept; file bytes are
 * never stored. Cleared by "Finish and clear this device", or after 60 days.
 *
 * Each of the study's pages keeps its own progress, and the confirmed
 * participant ID is also remembered on its own, so the check-in and
 * after-break pages can recognise the person without asking for the four
 * details again; so are the email address and mobile number given when
 * booking a lab visit, for the next booking. Progress saved under the old participant-code scheme (codes
 * such as JA101CD) is dropped: those codes are no longer used.
 */
const KEYS: Record<LabFlow, string> = { baseline: 'mpmb-lab:v1', checkin: 'mpmb-lab-checkin:v1', after: 'mpmb-lab-after:v1', book: 'mpmb-lab-book:v1', story: 'mpmb-lab-story:v1' };
const CODE_KEY = 'mpmb-lab-code:v1';
/** The email address and mobile number given when booking, so the next booking on this device is filled in. */
const CONTACT_KEY = 'mpmb-lab-contact:v1';
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
/** A check-in sent more than this long ago is finished: the page opens ready for the next one. */
const CHECKIN_FRESH_MS = 6 * 60 * 60 * 1000;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function fresh(savedAt: string | undefined): boolean {
  const t = savedAt ? Date.parse(savedAt) : Number.NaN;
  return !Number.isNaN(t) && Date.now() - t <= MAX_AGE_MS;
}

/** The participant ID last confirmed on this device, on any of the study's pages. */
export function rememberedCode(): string | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(CODE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { code?: unknown; savedAt?: string }) : null;
    if (parsed && typeof parsed.code === 'string' && PARTICIPANT_CODE.test(parsed.code) && fresh(parsed.savedAt)) return parsed.code;
    // Someone who used the first page before the code was remembered on its own.
    const first = store.getItem(KEYS.baseline);
    const state = first ? (JSON.parse(first) as Partial<LabState> & { savedAt?: string }) : null;
    return state && state.codeConfirmed && typeof state.code === 'string' && PARTICIPANT_CODE.test(state.code) && fresh(state.savedAt) ? state.code : null;
  } catch {
    return null;
  }
}

function rememberCode(code: string): void {
  try {
    storage()?.setItem(CODE_KEY, JSON.stringify({ code, savedAt: new Date().toISOString() }));
  } catch {
    /* storage full or blocked */
  }
}

function rememberedContact(): { email: string; mobile: string; smsReminders: boolean } | null {
  try {
    const raw = storage()?.getItem(CONTACT_KEY);
    const parsed = raw ? (JSON.parse(raw) as { email?: unknown; mobile?: unknown; smsReminders?: unknown; savedAt?: string }) : null;
    if (!parsed || !fresh(parsed.savedAt)) return null;
    return { email: typeof parsed.email === 'string' ? parsed.email : '', mobile: typeof parsed.mobile === 'string' ? parsed.mobile : '', smsReminders: parsed.smsReminders === true };
  } catch {
    return null;
  }
}

function rememberContact(c: { email: string; mobile: string; smsReminders: boolean }): void {
  try {
    storage()?.setItem(CONTACT_KEY, JSON.stringify({ ...c, savedAt: new Date().toISOString() }));
  } catch {
    /* storage full or blocked */
  }
}

/** A new page's starting point: the remembered code filled in, ready to confirm with one press, and the contact details from the last booking. */
export function startingLabState(flow: LabFlow, phase?: LabPhase): LabState {
  const base = initialLabState(flow, phase);
  const code = flow === 'baseline' ? null : rememberedCode();
  const contact = rememberedContact();
  const withContact = contact ? { ...base, booking: { ...base.booking, ...contact } } : base;
  return code ? { ...withContact, code, returning: true } : withContact;
}

export function loadLabState(flow: LabFlow, phase: LabPhase = labFlowPhase[flow]): LabState | null {
  const store = storage();
  if (!store) return null;
  const key = KEYS[flow];
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LabState> & { savedAt?: string };
    if (!parsed || typeof parsed !== 'object' || !parsed.stepId) return null;
    // Too old, or from the old participant-code scheme: start afresh.
    const oldScheme = (typeof parsed.code === 'string' && parsed.code !== '' && !PARTICIPANT_CODE.test(parsed.code)) || (typeof parsed.confirmedCode === 'string' && !PARTICIPANT_CODE.test(parsed.confirmedCode));
    if (!fresh(parsed.savedAt) || oldScheme) {
      store.removeItem(key);
      return null;
    }
    const base = initialLabState(flow, phase);
    const { savedAt: _ignored, ...rest } = parsed;
    const contact = rememberedContact();
    // A check-in sent a while ago is done: open ready for the next one, keeping only the code.
    if (flow === 'checkin' && parsed.checkIn?.sentAt && Date.now() - Date.parse(parsed.checkIn.sentAt) > CHECKIN_FRESH_MS) {
      return { ...base, session: parsed.session ?? null, code: parsed.code ?? '', returning: Boolean(parsed.code), checkIn: { ...base.checkIn, count: parsed.checkIn.count ?? 0 }, restored: true };
    }
    return {
      ...base,
      ...rest,
      // The page decides the flow and the phase; saved progress from before they existed is read in as the first page's.
      flow,
      phase,
      // What the server said about bookings is asked again on every visit; the contact details are kept.
      booking: { ...base.booking, email: parsed.booking?.email ?? contact?.email ?? '', mobile: parsed.booking?.mobile ?? contact?.mobile ?? '', smsReminders: parsed.booking?.smsReminders ?? contact?.smsReminders ?? false },
      // A story half-written for another phase's questions is not this page's.
      story: parsed.story && parsed.phase === phase ? { ...emptyStory(), ...parsed.story } : emptyStory(),
      // Only the four details the ID is built from.
      codeParts: {
        firstName: parsed.codeParts?.firstName ?? '',
        lastName: parsed.codeParts?.lastName ?? '',
        dateOfBirth: { day: parsed.codeParts?.dateOfBirth?.day ?? '', month: parsed.codeParts?.dateOfBirth?.month ?? '', year: parsed.codeParts?.dateOfBirth?.year ?? '' },
        postcode: parsed.codeParts?.postcode ?? '',
      },
      consent: { ...base.consent, ...(parsed.consent ?? {}) },
      submission: { ...base.submission, ...(parsed.submission ?? {}) },
      checkIn: { ...base.checkIn, ...(parsed.checkIn ?? {}) },
      progress: parsed.progress ?? null,
      notUsed: Array.isArray(parsed.notUsed) ? parsed.notUsed.filter((x) => x === 'tiktok' || x === 'youtube' || x === 'instagram') : [],
      confirmedCode: parsed.confirmedCode ?? (parsed.codeConfirmed && parsed.code ? parsed.code : null),
      // File bytes are gone after a reload; only what reached the server is kept.
      archives: (parsed.archives ?? []).filter((a) => a.status === 'sent' || a.status === 'uploaded'),
      screenshots: (parsed.screenshots ?? []).filter((s) => s.status === 'sent' || s.status === 'uploaded'),
      // A send that was in flight when the page closed is shown as needing another go.
      ...(parsed.submission?.consentStage === 'sending' ? { submission: { ...base.submission, ...(parsed.submission ?? {}), consentStage: 'idle' as const } } : {}),
      restored: true,
    };
  } catch {
    return null;
  }
}

let timer: number | null = null;
export function saveLabState(state: LabState): void {
  const store = storage();
  if (!store) return;
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    try {
      const { restored: _r, ...rest } = state;
      store.setItem(KEYS[state.flow], JSON.stringify({ ...rest, booking: { ...rest.booking, options: null }, savedAt: new Date().toISOString() }));
      if (state.codeConfirmed && state.code) rememberCode(state.code);
      if (state.booking.confirmed) rememberContact({ email: state.booking.email, mobile: state.booking.mobile, smsReminders: state.booking.smsReminders });
    } catch {
      /* storage full or blocked: carry on without saving */
    }
  }, 200);
}

/** "Finish and clear this device": every page's progress and the remembered code. */
export function clearLabState(): void {
  const store = storage();
  if (!store) return;
  for (const key of [...Object.values(KEYS), CODE_KEY, CONTACT_KEY]) store.removeItem(key);
}
