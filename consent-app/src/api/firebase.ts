import { FirebaseError, initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth, signInAnonymously, type Auth, type User } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { connectStorageEmulator, deleteObject, getStorage, ref, uploadBytesResumable, type FirebaseStorage } from 'firebase/storage';
import type { SessionInfo } from '../model/types';
import { ApiError, type ConsentApi, type SubmissionPayload, type SubmissionResult, type UploadMeta, type UploadSlot } from './types';

/**
 * Firebase implementation of the API boundary.
 *
 * - Session: anonymous Firebase Authentication. The uid is the session id.
 *   Tokens are bearer tokens, not cookies, so no CSRF token is needed and the
 *   static site can live on GitHub Pages while the data lives in Firebase.
 * - Uploads: written by the browser straight into Cloud Storage under
 *   quarantine/{uid}/{uploadId}. Storage rules let a session create and
 *   delete only its own objects, with size and type limits, and never read
 *   them back.
 * - Submit: one callable Cloud Function (firebase/functions) that validates
 *   everything server-side, strips image metadata, moves the images out of
 *   quarantine and writes the separated records with the Admin SDK. Browsers
 *   have no direct read or write access to Firestore at all.
 */
export interface FirebaseSettings {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  appId: string;
  /** Cloud Functions region; keep in step with firebase/functions. */
  region: string;
  /** reCAPTCHA v3 site key for App Check. Optional but recommended in production. */
  appCheckSiteKey?: string;
  /** "host:port" of the emulator suite, for local testing only. */
  emulatorHost?: string;
}

const UPLOAD_ROOT = 'quarantine';

function mapError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof FirebaseError) {
    const code = error.code.replace(/^(functions|storage|auth)\//, '');
    switch (code) {
      case 'invalid-argument':
      case 'failed-precondition':
      case 'unauthorized':
        return new ApiError('validation', error.message.replace(/^Firebase: /, ''));
      case 'unauthenticated':
      case 'permission-denied':
        return new ApiError('expired', 'Your session has expired.');
      case 'unavailable':
      case 'deadline-exceeded':
      case 'retry-limit-exceeded':
      case 'canceled':
      case 'network-request-failed':
        return new ApiError('network', 'The connection dropped.');
      case 'resource-exhausted':
      case 'quota-exceeded':
        return new ApiError('too-large', 'The image is too large.');
      default:
        return new ApiError('server', error.message);
    }
  }
  if (error instanceof TypeError) return new ApiError('network', 'The connection dropped.');
  return new ApiError('server', error instanceof Error ? error.message : 'Unknown error');
}

export class FirebaseConsentApi implements ConsentApi {
  private app: FirebaseApp;
  private auth: Auth;
  private functions: Functions;
  private storage: FirebaseStorage;

  constructor(settings: FirebaseSettings) {
    this.app = initializeApp({ apiKey: settings.apiKey, authDomain: settings.authDomain, projectId: settings.projectId, storageBucket: settings.storageBucket, appId: settings.appId });
    if (settings.appCheckSiteKey) {
      initializeAppCheck(this.app, { provider: new ReCaptchaV3Provider(settings.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
    }
    this.auth = getAuth(this.app);
    this.functions = getFunctions(this.app, settings.region);
    this.storage = getStorage(this.app);
    if (settings.emulatorHost) {
      const [host, port] = settings.emulatorHost.split(':');
      connectAuthEmulator(this.auth, `http://${host}:9099`, { disableWarnings: true });
      connectFunctionsEmulator(this.functions, host, 5001);
      connectStorageEmulator(this.storage, host, 9199);
      void port;
    }
  }

  private async user(): Promise<User> {
    if (this.auth.currentUser) return this.auth.currentUser;
    try {
      const credential = await signInAnonymously(this.auth);
      return credential.user;
    } catch (error) {
      throw mapError(error);
    }
  }

  async startSession(): Promise<SessionInfo> {
    const user = await this.user();
    const token = await user.getIdTokenResult();
    return { sessionId: user.uid, csrfToken: '', expiresAt: token.expirationTime };
  }

  async requestUploadSlot(sessionId: string, meta: UploadMeta): Promise<UploadSlot> {
    const user = await this.user();
    if (user.uid !== sessionId) throw new ApiError('expired', 'Your session has changed. Please try again.');
    const uploadId = crypto.randomUUID();
    return {
      uploadId,
      url: `${UPLOAD_ROOT}/${user.uid}/${uploadId}`,
      method: 'PUT',
      headers: { 'Content-Type': meta.contentType, 'x-width': String(meta.width), 'x-height': String(meta.height) },
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  uploadImage(slot: UploadSlot, blob: Blob, onProgress?: (fraction: number) => void): Promise<void> {
    const target = ref(this.storage, slot.url);
    const task = uploadBytesResumable(target, blob, { contentType: blob.type, customMetadata: { width: slot.headers['x-width'] ?? '', height: slot.headers['x-height'] ?? '' } });
    return new Promise((resolve, reject) => {
      task.on(
        'state_changed',
        (snapshot) => onProgress?.(snapshot.totalBytes ? snapshot.bytesTransferred / snapshot.totalBytes : 0),
        (error) => reject(mapError(error)),
        () => resolve(),
      );
    });
  }

  async deleteUpload(sessionId: string, uploadId: string): Promise<void> {
    try {
      await deleteObject(ref(this.storage, `${UPLOAD_ROOT}/${sessionId}/${uploadId}`));
    } catch (error) {
      // Already gone, or not ours: the quarantine bucket purges itself anyway.
      if (error instanceof FirebaseError && error.code === 'storage/object-not-found') return;
      throw mapError(error);
    }
  }

  async submit(session: SessionInfo, payload: SubmissionPayload): Promise<SubmissionResult> {
    const user = await this.user();
    if (user.uid !== session.sessionId) throw new ApiError('expired', 'Your session has changed. Please try again.');
    const call = httpsCallable<SubmissionPayload, SubmissionResult>(this.functions, 'submitConsent', { timeout: 120_000 });
    try {
      const result = await call(payload);
      return result.data;
    } catch (error) {
      throw mapError(error);
    }
  }
}

/** Reads the Firebase settings from Vite environment variables (VITE_FIREBASE_*). */
export function settingsFromEnv(env: Record<string, string | undefined>): FirebaseSettings | null {
  const apiKey = env.VITE_FIREBASE_API_KEY;
  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  const appId = env.VITE_FIREBASE_APP_ID;
  if (!apiKey || !projectId || !appId) return null;
  return {
    apiKey,
    projectId,
    appId,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? `${projectId}.firebasestorage.app`,
    region: env.VITE_FIREBASE_REGION ?? 'europe-west2',
    appCheckSiteKey: env.VITE_FIREBASE_APPCHECK_SITE_KEY || undefined,
    emulatorHost: env.VITE_FIREBASE_EMULATOR_HOST || undefined,
  };
}
