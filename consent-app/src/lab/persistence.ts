import { labFlowPhase, type LabFlow, type LabState } from './model';
import { initialLabState } from './reducer';

/**
 * Progress is kept in localStorage, not sessionStorage, because this process
 * spans days: a TikTok, YouTube or Instagram export can take a while to arrive, and
 * people come back to send it. Nothing but the person's own code, their
 * consent record and the list of files already sent is kept; file bytes are
 * never stored. Cleared by "Finish and clear this device", or after 60 days.
 *
 * Each of the study's pages keeps its own progress (the key for the first
 * page is unchanged, so nobody loses theirs), and the confirmed participant
 * code is also remembered on its own, so the check-in and after-break pages
 * can recognise the person without asking for the four answers again.
 */
const KEYS: Record<LabFlow, string> = { baseline: 'mpmb-lab:v1', checkin: 'mpmb-lab-checkin:v1', after: 'mpmb-lab-after:v1' };
const CODE_KEY = 'mpmb-lab-code:v1';
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

/** The participant code last confirmed on this device, on any of the study's pages. */
export function rememberedCode(): string | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(CODE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { code?: unknown; savedAt?: string }) : null;
    if (parsed && typeof parsed.code === 'string' && fresh(parsed.savedAt)) return parsed.code;
    // Someone who used the first page before the code was remembered on its own.
    const first = store.getItem(KEYS.baseline);
    const state = first ? (JSON.parse(first) as Partial<LabState> & { savedAt?: string }) : null;
    return state && state.codeConfirmed && typeof state.code === 'string' && fresh(state.savedAt) ? state.code : null;
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

/** A new page's starting point: the remembered code filled in, ready to confirm with one press. */
export function startingLabState(flow: LabFlow): LabState {
  const base = initialLabState(flow);
  const code = flow === 'baseline' ? null : rememberedCode();
  return code ? { ...base, code, returning: true } : base;
}

export function loadLabState(flow: LabFlow): LabState | null {
  const store = storage();
  if (!store) return null;
  const key = KEYS[flow];
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LabState> & { savedAt?: string };
    if (!parsed || typeof parsed !== 'object' || !parsed.stepId) return null;
    if (!fresh(parsed.savedAt)) {
      store.removeItem(key);
      return null;
    }
    const base = initialLabState(flow);
    const { savedAt: _ignored, ...rest } = parsed;
    // A check-in sent a while ago is done: open ready for the next one, keeping only the code.
    if (flow === 'checkin' && parsed.checkIn?.sentAt && Date.now() - Date.parse(parsed.checkIn.sentAt) > CHECKIN_FRESH_MS) {
      return { ...base, session: parsed.session ?? null, code: parsed.code ?? '', returning: Boolean(parsed.code), checkIn: { ...base.checkIn, count: parsed.checkIn.count ?? 0 }, restored: true };
    }
    return {
      ...base,
      ...rest,
      // The page decides the flow and the phase; saved progress from before they existed is read in as the first page's.
      flow,
      phase: labFlowPhase[flow],
      // Only the answers the code is built from now; anything else saved under an older scheme is dropped.
      codeParts: { firstName: parsed.codeParts?.firstName ?? '', house: parsed.codeParts?.house ?? '', month: parsed.codeParts?.month ?? '', postcode: parsed.codeParts?.postcode ?? '' },
      consent: { ...base.consent, ...(parsed.consent ?? {}) },
      submission: { ...base.submission, ...(parsed.submission ?? {}) },
      checkIn: { ...base.checkIn, ...(parsed.checkIn ?? {}) },
      progress: parsed.progress ?? null,
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
      store.setItem(KEYS[state.flow], JSON.stringify({ ...rest, savedAt: new Date().toISOString() }));
      if (state.codeConfirmed && state.code) rememberCode(state.code);
    } catch {
      /* storage full or blocked: carry on without saving */
    }
  }, 200);
}

/** "Finish and clear this device": every page's progress and the remembered code. */
export function clearLabState(): void {
  const store = storage();
  if (!store) return;
  for (const key of [...Object.values(KEYS), CODE_KEY]) store.removeItem(key);
}
