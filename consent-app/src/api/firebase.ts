import { FirebaseError, initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth, signInAnonymously, type Auth, type User } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { connectStorageEmulator, deleteObject, getStorage, ref, uploadBytesResumable, type FirebaseStorage } from 'firebase/storage';
import type { SessionInfo } from '../model/types';
import { ApiError, type AddressLookup, type AddressSuggestions, type ConsentApi, type ConsentPayload, type ConsentResult, type DonationPayload, type DonationResult, type LabBookingOptions, type LabBookPayload, type LabBookResult, type LabCancelResult, type LabCheckInPayload, type LabCheckInResult, type LabConsentPayload, type LabConsentResult, type LabDonationPayload, type LabDonationResult, type LabLookupResult, type LabPhase, type LabPlatform, type LabReminderResult, type LabStoryChatRequest, type LabStoryChatResponse, type LabStoryVoiceRequest, type LabStoryVoiceResponse, type LabStoryPayload, type LabStoryResult, type LateAgreementPayload, type LateAgreementResult, type PickedAddress, type ResumeLookupPayload, type ResumeSummary, type UploadMeta, type UploadSlot } from './types';

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
 * - Submit: two callable Cloud Functions (firebase/functions). submitConsent
 *   validates the permission and agreement and writes the separated records;
 *   submitDonation checks the images, strips their metadata, runs the quality
 *   checks and links them to the record. Browsers have no direct read or
 *   write access to Firestore at all.
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
/** The lab study's uploads: cleaned archives as well as screenshots, under their own rules. */
const LAB_UPLOAD_ROOT = 'labquarantine';

/** How long to wait before each quiet retry of a call that is safe to repeat. */
const RETRY_WAITS_MS = [1000, 3000, 6000];

function mapError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof FirebaseError) {
    const code = error.code.replace(/^(functions|storage|auth)\//, '');
    switch (code) {
      case 'invalid-argument':
      case 'failed-precondition':
      case 'unauthorized':
        return new ApiError('validation', error.message.replace(/^Firebase: /, ''));
      case 'permission-denied':
        // The staff page's wrong key says so; storage's refusals mean the session ran out.
        return code === 'permission-denied' && error.code.startsWith('functions/') ? new ApiError('validation', error.message.replace(/^Firebase: /, '')) : new ApiError('expired', 'Your session has expired.');
      case 'unauthenticated':
        return new ApiError('expired', 'Your session has expired.');
      case 'not-found':
        return error.code.startsWith('functions/') && error.message !== 'not-found' && error.message !== 'NOT FOUND' ? new ApiError('validation', error.message.replace(/^Firebase: /, '')) : new ApiError('server', error.message);
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

  /** The one anonymous sign-in in flight, so that callers asking at the same moment share it. */
  private signingIn: Promise<User> | null = null;

  /**
   * This browser's anonymous user. Found by a swarm test (17 October 2026): on a
   * slow connection two parts of the page asked at once and each signed in, the
   * second replacing the first, so the record belonged to a user the page no
   * longer was ("That reference does not belong to this session", or a second
   * record); and after a refresh the page signed in again before the browser
   * had restored the user it already had. So: wait for the restored user, and
   * sign in at most once at a time.
   */
  private async user(): Promise<User> {
    await this.auth.authStateReady();
    if (this.auth.currentUser) return this.auth.currentUser;
    this.signingIn ??= signInAnonymously(this.auth)
      .then((credential) => credential.user)
      .catch((error) => {
        throw mapError(error);
      })
      .finally(() => {
        this.signingIn = null;
      });
    return this.signingIn;
  }

  /** Signs in (or finds the user this browser already has), tried again quietly on a dropped connection like a safe call. */
  async startSession(): Promise<SessionInfo> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const user = await this.user();
        const token = await user.getIdTokenResult();
        return { sessionId: user.uid, csrfToken: '', expiresAt: token.expirationTime };
      } catch (error) {
        const mapped = mapError(error);
        if (attempt >= RETRY_WAITS_MS.length || (mapped.code !== 'network' && mapped.code !== 'server')) throw mapped;
        await new Promise((r) => setTimeout(r, RETRY_WAITS_MS[attempt]));
      }
    }
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

  /**
   * Calls a function. With `retry`, for calls that are safe to repeat (lookups, and saves the server recognises when they
   * come again), a dropped connection or a server error is tried again, quietly, up to three more times over about ten
   * seconds before the page is told: on a poor mobile signal one failed request is common (the swarm test, 17 October 2026).
   */
  private async call<Req, Res>(session: SessionInfo, name: string, payload: Req, retry = false): Promise<Res> {
    const fn = httpsCallable<Req, Res>(this.functions, name, { timeout: 120_000 });
    const waits = retry ? RETRY_WAITS_MS : [];
    for (let attempt = 0; ; attempt += 1) {
      try {
        // Signing in is part of the try: on a new device it is the first request, and can fail like any other.
        const user = await this.user();
        if (user.uid !== session.sessionId) throw new ApiError('expired', 'Your session has changed. Please try again.');
        const result = await fn(payload);
        return result.data;
      } catch (error) {
        const mapped = mapError(error);
        if (attempt >= waits.length || (mapped.code !== 'network' && mapped.code !== 'server')) throw mapped;
        await new Promise((r) => setTimeout(r, waits[attempt]));
      }
    }
  }

  submitConsent(session: SessionInfo, payload: ConsentPayload): Promise<ConsentResult> {
    return this.call<ConsentPayload, ConsentResult>(session, 'submitConsent', payload);
  }

  findAddresses(session: SessionInfo, postcode: string): Promise<AddressLookup> {
    return this.call<{ postcode: string }, AddressLookup>(session, 'findAddresses', { postcode });
  }

  suggestAddresses(session: SessionInfo, search: string, near: string): Promise<AddressSuggestions> {
    return this.call<{ search: string; near: string }, AddressSuggestions>(session, 'findAddresses', { search, near });
  }

  pickAddress(session: SessionInfo, pick: string): Promise<PickedAddress> {
    return this.call<{ pick: string }, PickedAddress>(session, 'findAddresses', { pick });
  }

  submitDonation(session: SessionInfo, payload: DonationPayload): Promise<DonationResult> {
    return this.call<DonationPayload, DonationResult>(session, 'submitDonation', payload);
  }

  resumeLookup(session: SessionInfo, payload: ResumeLookupPayload): Promise<ResumeSummary> {
    return this.call<ResumeLookupPayload & { action: 'lookup' }, ResumeSummary>(session, 'resumeRecord', { action: 'lookup', ...payload }, true);
  }

  youngLink(session: SessionInfo, referenceCode: string): Promise<{ referenceCode: string; key: string }> {
    return this.call<{ action: 'young-link'; referenceCode: string }, { referenceCode: string; key: string }>(session, 'resumeRecord', { action: 'young-link', referenceCode }, true);
  }

  resumeSource(session: SessionInfo, referenceCode: string, phoneSource: 'parent' | 'child' | 'none'): Promise<ResumeSummary> {
    return this.call<{ action: 'source'; referenceCode: string; phoneSource: string }, ResumeSummary>(session, 'resumeRecord', { action: 'source', referenceCode, phoneSource }, true);
  }

  resumeAgree(session: SessionInfo, payload: LateAgreementPayload): Promise<LateAgreementResult> {
    return this.call<LateAgreementPayload & { action: 'agree' }, LateAgreementResult>(session, 'resumeRecord', { action: 'agree', ...payload }, true);
  }

  submitLabConsent(session: SessionInfo, payload: LabConsentPayload): Promise<LabConsentResult> {
    return this.call<LabConsentPayload, LabConsentResult>(session, 'submitLabConsent', payload, true);
  }

  lookupLabParticipant(session: SessionInfo, participantCode: string): Promise<LabLookupResult> {
    return this.call<{ participantCode: string }, LabLookupResult>(session, 'lookupLabParticipant', { participantCode }, true);
  }

  async requestLabUploadSlot(sessionId: string, meta: { contentType: string; size: number }): Promise<UploadSlot> {
    const user = await this.user();
    if (user.uid !== sessionId) throw new ApiError('expired', 'Your session has changed. Please try again.');
    const uploadId = crypto.randomUUID();
    return { uploadId, url: `${LAB_UPLOAD_ROOT}/${user.uid}/${uploadId}`, method: 'PUT', headers: { 'Content-Type': meta.contentType }, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() };
  }

  async deleteLabUpload(sessionId: string, uploadId: string): Promise<void> {
    try {
      await deleteObject(ref(this.storage, `${LAB_UPLOAD_ROOT}/${sessionId}/${uploadId}`));
    } catch (error) {
      if (error instanceof FirebaseError && error.code === 'storage/object-not-found') return;
      throw mapError(error);
    }
  }

  submitLabDonation(session: SessionInfo, payload: LabDonationPayload): Promise<LabDonationResult> {
    return this.call<LabDonationPayload, LabDonationResult>(session, 'submitLabDonation', payload, true);
  }

  requestLabReminder(session: SessionInfo, payload: { participantCode: string; email: string; phase: LabPhase }): Promise<LabReminderResult> {
    return this.call<{ participantCode: string; email: string; phase: LabPhase }, LabReminderResult>(session, 'requestLabReminder', payload);
  }

  submitLabCheckIn(session: SessionInfo, payload: LabCheckInPayload): Promise<LabCheckInResult> {
    return this.call<LabCheckInPayload, LabCheckInResult>(session, 'submitLabCheckIn', payload, true);
  }

  updateLabPlatforms(session: SessionInfo, payload: { participantCode: string; notUsed: LabPlatform[] }): Promise<{ notUsed: LabPlatform[] }> {
    return this.call<{ participantCode: string; notUsed: LabPlatform[] }, { notUsed: LabPlatform[] }>(session, 'updateLabPlatforms', payload, true);
  }

  labBookingOptions(session: SessionInfo, participantCode: string): Promise<LabBookingOptions> {
    return this.call<{ participantCode: string }, LabBookingOptions>(session, 'labBookingOptions', { participantCode }, true);
  }

  bookLabSlot(session: SessionInfo, payload: LabBookPayload): Promise<LabBookResult> {
    return this.call<LabBookPayload, LabBookResult>(session, 'bookLabSlot', payload, true);
  }

  cancelLabBooking(session: SessionInfo, payload: { participantCode: string; bookingIds?: string[] | null }): Promise<LabCancelResult> {
    return this.call<{ participantCode: string; bookingIds?: string[] | null }, LabCancelResult>(session, 'cancelLabBooking', payload);
  }

  submitLabStory(session: SessionInfo, payload: LabStoryPayload): Promise<LabStoryResult> {
    return this.call<LabStoryPayload, LabStoryResult>(session, 'submitLabStory', payload, true);
  }

  labStoryChat(session: SessionInfo, request: LabStoryChatRequest): Promise<LabStoryChatResponse> {
    return this.call<LabStoryChatRequest, LabStoryChatResponse>(session, 'labStoryChat', request, request.action !== 'adapt');
  }

  labStoryVoice(session: SessionInfo, request: LabStoryVoiceRequest): Promise<LabStoryVoiceResponse> {
    return this.call<LabStoryVoiceRequest, LabStoryVoiceResponse>(session, 'labStoryVoice', request);
  }

  callTool<Res>(session: SessionInfo, name: 'staffApi' | 'schoolUpload', payload: Record<string, unknown>): Promise<Res> {
    return this.call<Record<string, unknown>, Res>(session, name, payload);
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
