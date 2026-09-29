import { FirebaseConsentApi, settingsFromEnv } from './firebase';
import { MockConsentApi, type MockFlags } from './mock';
import type { ConsentApi } from './types';

/**
 * Chooses the backend.
 *
 *   VITE_MPMB_BACKEND=firebase   real backend (needs VITE_FIREBASE_* settings)
 *   VITE_MPMB_BACKEND=mock       in-memory mock, nothing leaves the page
 *
 * When the variable is not set, the prototype build (MPMB_PROTOTYPE != false)
 * uses the mock and a production build fails fast, so a real deployment can
 * never silently run against the mock.
 */
export const mockFlags: MockFlags = { failUploads: false, failSubmit: false };

let api: ConsentApi | null = null;

export function backendName(): 'firebase' | 'mock' {
  const chosen = import.meta.env.VITE_MPMB_BACKEND as string | undefined;
  if (chosen === 'firebase' || chosen === 'mock') return chosen;
  return __PROTOTYPE__ ? 'mock' : 'firebase';
}

export function getApi(): ConsentApi {
  if (api) return api;
  if (backendName() === 'firebase') {
    const settings = settingsFromEnv(import.meta.env as Record<string, string | undefined>);
    if (!settings) throw new Error('VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID and VITE_FIREBASE_APP_ID must be set for the Firebase backend. See docs/firebase.md.');
    api = new FirebaseConsentApi(settings);
    return api;
  }
  if (!__PROTOTYPE__) throw new Error('The mock backend is only available in prototype builds.');
  const mock = new MockConsentApi(mockFlags);
  // Expose for inspection during design review only.
  (window as unknown as { __mpmbMockApi?: MockConsentApi }).__mpmbMockApi = mock;
  api = mock;
  return api;
}
