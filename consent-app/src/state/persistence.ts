import type { AppState } from '../model/types';
import { initialState } from './reducer';

/**
 * Progress is saved to sessionStorage so that a refresh or an accidental
 * back-swipe does not lose everything. sessionStorage is per-tab and is
 * cleared when the tab closes. It is also cleared explicitly when the form is
 * submitted, when the person chooses "start again", after a period of
 * inactivity, and it is ignored if it is more than MAX_AGE_MS old.
 *
 * Image bytes are never written here (see lib/imageStore.ts); only their
 * metadata and server upload ids are kept so the list can be shown again.
 * The drawn signature is kept so that a refresh while the device is with the
 * young person does not force the parent to sign again; it is removed with
 * everything else when the form is cleared.
 */
const KEY = 'mpmb-consent:v4';
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

type Persisted = Omit<AppState, 'handover' | 'restored' | 'prototype' | 'clearedReason'> & { savedAt: string };

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadState(): { state: AppState; expired: boolean } | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    if (!parsed || typeof parsed !== 'object' || !parsed.stepId) return null;
    const base = initialState();
    const savedAt = parsed.savedAt ? Date.parse(parsed.savedAt) : Number.NaN;
    if (Number.isNaN(savedAt) || Date.now() - savedAt > MAX_AGE_MS) {
      store.removeItem(KEY);
      return { state: { ...base, clearedReason: 'expired' }, expired: true };
    }
    return {
      expired: false,
      state: {
        ...base,
        ...parsed,
        identity: { ...base.identity, ...(parsed.identity ?? {}) },
        guardian: { ...base.guardian, ...(parsed.guardian ?? {}) },
        consent: { ...base.consent, ...(parsed.consent ?? {}) },
        assent: { ...base.assent, ...(parsed.assent ?? {}) },
        donation: {
          ...base.donation,
          ...(parsed.donation ?? {}),
          // Image bytes are not kept across a refresh: anything not yet uploaded must be added again.
          // Uploaded and sent images live on the server; anything still on the device is gone after a refresh.
          images: (parsed.donation?.images ?? []).map((img) => (img.status === 'uploaded' || img.status === 'sent' ? img : { ...img, status: 'failed', progress: 0, error: 'This image was lost when the page was refreshed. Please add it again.' })),
        },
        submission: { ...base.submission, ...(parsed.submission ?? {}) },
        prototype: base.prototype,
        handover: null,
        clearedReason: null,
        restored: true,
      },
    };
  } catch {
    return null;
  }
}

let timer: number | null = null;
let pending: AppState | null = null;

function write(state: AppState): void {
  const store = storage();
  if (!store) return;
  try {
    if (state.stepId === 'done') {
      store.removeItem(KEY);
      return;
    }
    const { handover: _h, restored: _r, prototype: _p, clearedReason: _c, ...rest } = state;
    const record: Persisted = { ...rest, savedAt: new Date().toISOString() };
    store.setItem(KEY, JSON.stringify(record));
  } catch {
    /* Storage may be full or unavailable; the form still works without it. */
  }
}

/** Write whatever is waiting, for example when the tab is closed or refreshed. */
export function flushState(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  if (pending) write(pending);
  pending = null;
}

export function saveState(state: AppState): void {
  pending = state;
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(flushState, 150);
}

export function clearState(): void {
  pending = null;
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushState);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushState();
  });
}
