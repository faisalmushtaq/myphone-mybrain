import { MockConsentApi, type MockFlags } from './mock';
import type { ConsentApi } from './types';

/**
 * Single place to swap the mock for a real client.
 *
 * `__PROTOTYPE__` is set at build time (vite.config.ts). While it is true the
 * app uses the in-memory mock and shows the prototype controls. A production
 * build must set MPMB_PROTOTYPE=false and provide a real ConsentApi here.
 */
export const mockFlags: MockFlags = { failUploads: false, failSubmit: false };

let api: ConsentApi | null = null;

export function getApi(): ConsentApi {
  if (api) return api;
  if (!__PROTOTYPE__) {
    throw new Error('No production API client is configured. See docs/architecture.md.');
  }
  const mock = new MockConsentApi(mockFlags);
  // Expose for inspection during design review only.
  (window as unknown as { __mpmbMockApi?: MockConsentApi }).__mpmbMockApi = mock;
  api = mock;
  return api;
}
