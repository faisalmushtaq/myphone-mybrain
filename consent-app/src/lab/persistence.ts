import type { LabState } from './model';
import { initialLabState } from './reducer';

/**
 * Progress is kept in localStorage, not sessionStorage, because this process
 * spans days: a TikTok, YouTube or Instagram export can take a while to arrive, and
 * people come back to send it. Nothing but the person's own code, their
 * consent record and the list of files already sent is kept; file bytes are
 * never stored. Cleared by "Finish and clear this device", or after 60 days.
 */
const KEY = 'mpmb-lab:v1';
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadLabState(): LabState | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LabState> & { savedAt?: string };
    if (!parsed || typeof parsed !== 'object' || !parsed.stepId) return null;
    const savedAt = parsed.savedAt ? Date.parse(parsed.savedAt) : Number.NaN;
    if (Number.isNaN(savedAt) || Date.now() - savedAt > MAX_AGE_MS) {
      store.removeItem(KEY);
      return null;
    }
    const base = initialLabState();
    const { savedAt: _ignored, ...rest } = parsed;
    return {
      ...base,
      ...rest,
      codeParts: { ...base.codeParts, ...(parsed.codeParts ?? {}) },
      consent: { ...base.consent, ...(parsed.consent ?? {}) },
      submission: { ...base.submission, ...(parsed.submission ?? {}) },
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
      store.setItem(KEY, JSON.stringify({ ...rest, savedAt: new Date().toISOString() }));
    } catch {
      /* storage full or blocked: carry on without saving */
    }
  }, 200);
}

export function clearLabState(): void {
  storage()?.removeItem(KEY);
}
