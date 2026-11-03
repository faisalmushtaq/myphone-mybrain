import { FirebaseError, getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, EmailAuthProvider, getAuth, getRedirectResult, GoogleAuthProvider, isSignInWithEmailLink, linkWithCredential, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, sendSignInLinkToEmail, signInWithEmailAndPassword, signInWithEmailLink, signInWithPopup, signInWithRedirect, signOut, updatePassword, type Auth, type User } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { connectStorageEmulator, getStorage, ref, uploadBytesResumable, type FirebaseStorage } from 'firebase/storage';
import { backendName } from '../api';
import { settingsFromEnv } from '../api/firebase';

/**
 * The staff portal's connection to Firebase: its own app instance ("portal"),
 * so a portal sign-in (an email link) is kept apart from the anonymous
 * sessions the participant pages use in the same browser. Every call goes to
 * one callable, portalApi, with an action; documents are uploaded straight
 * into Storage under portal/docs/{uid}/, then registered with a call.
 */
const EMAIL_STORE = 'mpmb-portal-email';

export class PortalError extends Error {
  constructor(
    message: string,
    public code: 'signed-out' | 'refused' | 'invalid' | 'network' | 'server',
  ) {
    super(message);
  }
}

interface Conn {
  app: FirebaseApp;
  auth: Auth;
  functions: Functions;
  storage: FirebaseStorage;
}

let conn: Conn | null = null;

/** Null when this build has no Firebase backend (the design prototype). */
export function connection(): Conn | null {
  if (conn) return conn;
  if (backendName() !== 'firebase') return null;
  const settings = settingsFromEnv(import.meta.env as Record<string, string | undefined>);
  if (!settings) return null;
  const app = getApps().find((a) => a.name === 'portal') ? getApp('portal') : initializeApp({ apiKey: settings.apiKey, authDomain: settings.authDomain, projectId: settings.projectId, storageBucket: settings.storageBucket, appId: settings.appId }, 'portal');
  const auth = getAuth(app);
  const functions = getFunctions(app, settings.region);
  const storage = getStorage(app);
  if (settings.emulatorHost) {
    const [host] = settings.emulatorHost.split(':');
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFunctionsEmulator(functions, host, 5001);
    connectStorageEmulator(storage, host, 9199);
  }
  conn = { app, auth, functions, storage };
  return conn;
}

function mapError(error: unknown): PortalError {
  if (error instanceof PortalError) return error;
  if (error instanceof FirebaseError) {
    const code = error.code.replace(/^(functions|storage|auth)\//, '');
    const message = error.message.replace(/^Firebase: /, '').replace(/ \(auth\/[a-z-]+\)\.?$/, '');
    if (code === 'unauthenticated') return new PortalError('Please sign in again.', 'signed-out');
    if (code === 'permission-denied' || code === 'unauthorized') return new PortalError(message, 'refused');
    if (code === 'invalid-argument' || code === 'failed-precondition' || code === 'not-found') return new PortalError(message, 'invalid');
    if (code === 'invalid-email') return new PortalError('That email address does not look right.', 'invalid');
    // Passwords (4 November 2026), in plain words.
    if (code === 'weak-password') return new PortalError(`That password is too easy to guess. Use at least ${MIN_PASSWORD} characters.`, 'invalid');
    if (code === 'wrong-password' || code === 'invalid-credential' || code === 'invalid-login-credentials' || code === 'user-not-found') return new PortalError('That email and password do not match. Check them, or use “Forgot your password?”.', 'invalid');
    if (code === 'too-many-requests') return new PortalError('Too many tries. Wait a few minutes, or sign in with the email link instead.', 'invalid');
    if (code === 'email-already-in-use' || code === 'credential-already-in-use' || code === 'provider-already-linked') return new PortalError('There is already an account with that email. Sign in with the email link or your password, or use “Forgot your password?”.', 'invalid');
    if (code === 'requires-recent-login') return new PortalError('For your security, sign out, sign in again, then set your password.', 'invalid');
    if (code === 'operation-not-allowed') return new PortalError('Password sign-in is not switched on yet. Use the email link for now.', 'server');
    if (code === 'invalid-action-code' || code === 'expired-action-code') return new PortalError('That sign-in link has expired or was already used. Ask for a new one.', 'invalid');
    if (['unavailable', 'deadline-exceeded', 'network-request-failed', 'retry-limit-exceeded'].includes(code)) return new PortalError('Could not reach the server. Check the connection and try again.', 'network');
    return new PortalError(message || 'Something went wrong. Please try again.', 'server');
  }
  return new PortalError(error instanceof Error ? error.message : 'Something went wrong. Please try again.', 'server');
}

export function messageOf(error: unknown): string {
  return mapError(error).message;
}

/** Calls back with the signed-in user (or null) now and whenever it changes. */
export function watchUser(callback: (user: User | null) => void): () => void {
  const c = connection();
  if (!c) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(c.auth, callback);
}

/** Signs in with a Google account (enabled 4 November 2026). A popup in a browser; a redirect in the Home Screen app, where popups are blocked. */
export async function signInWithGoogle(): Promise<void> {
  const c = connection();
  if (!c) throw new PortalError('The portal is not connected in this build.', 'server');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  try {
    if (standalone) await signInWithRedirect(c.auth, provider);
    else await signInWithPopup(c.auth, provider);
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(c.auth, provider);
      return;
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
    throw mapError(error);
  }
}

/** Finishes a Google sign-in that came back by redirect; nothing to do otherwise. */
export async function finishGoogleRedirect(): Promise<void> {
  const c = connection();
  if (!c) return;
  try {
    await getRedirectResult(c.auth);
  } catch (error) {
    throw mapError(error);
  }
}

/** Passwords need at least this many characters (4 November 2026). */
export const MIN_PASSWORD = 10;

const backHere = () => ({ url: `${window.location.origin}${window.location.pathname}${cleanSearch()}` });

function checkPassword(password: string) {
  if (password.length < MIN_PASSWORD) throw new PortalError(`Use at least ${MIN_PASSWORD} characters.`, 'invalid');
}

/** Signs in with an email and password. */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const c = connection();
  if (!c) throw new PortalError('The portal is not connected in this build.', 'server');
  try {
    await signInWithEmailAndPassword(c.auth, email.trim(), password);
  } catch (error) {
    throw mapError(error);
  }
}

/** A new account with a password; the address must then be verified from the email sent, before the portal opens. */
export async function createPasswordAccount(email: string, password: string): Promise<void> {
  const c = connection();
  if (!c) throw new PortalError('The portal is not connected in this build.', 'server');
  checkPassword(password);
  try {
    const { user } = await createUserWithEmailAndPassword(c.auth, email.trim(), password);
    await sendEmailVerification(user, backHere());
  } catch (error) {
    throw mapError(error);
  }
}

/** Sends the verification email again. */
export async function resendVerification(): Promise<void> {
  const c = connection();
  if (!c?.auth.currentUser) return;
  try {
    await sendEmailVerification(c.auth.currentUser, backHere());
  } catch (error) {
    throw mapError(error);
  }
}

/** Reloads the user, true once their address is verified (and the token says so). */
export async function checkVerified(): Promise<boolean> {
  const c = connection();
  const user = c?.auth.currentUser;
  if (!user) return false;
  await user.reload();
  if (user.emailVerified) await user.getIdToken(true);
  return user.emailVerified;
}

/** Whether this user signed up with a password and has not verified the address yet. */
export const needsVerifying = (user: User | null) => Boolean(user && !user.emailVerified && user.providerData.some((p) => p.providerId === 'password'));

/** Emails a link to choose a new password. */
export async function sendPasswordReset(email: string): Promise<void> {
  const c = connection();
  if (!c) throw new PortalError('The portal is not connected in this build.', 'server');
  try {
    await sendPasswordResetEmail(c.auth, email.trim(), backHere());
  } catch (error) {
    // Say the same whether or not there is an account, so the page gives nothing away.
    const code = error instanceof FirebaseError ? error.code : '';
    if (code === 'auth/user-not-found') return;
    throw mapError(error);
  }
}

/** Sets a password for whoever is signed in (by link or Google), or changes it. */
export async function setOwnPassword(password: string): Promise<'set' | 'changed'> {
  const c = connection();
  const user = c?.auth.currentUser;
  if (!user || !user.email) throw new PortalError('Please sign in again.', 'signed-out');
  checkPassword(password);
  try {
    if (user.providerData.some((p) => p.providerId === 'password')) {
      await updatePassword(user, password);
      return 'changed';
    }
    await linkWithCredential(user, EmailAuthProvider.credential(user.email, password));
    return 'set';
  } catch (error) {
    throw mapError(error);
  }
}

/** Whether the signed-in user already has a password. */
export const hasPassword = (user: User | null) => Boolean(user?.providerData.some((p) => p.providerId === 'password'));

/** Emails a one-time sign-in link that brings them back to this page. */
export async function sendLink(email: string): Promise<void> {
  const c = connection();
  if (!c) throw new PortalError('The portal is not connected in this build.', 'server');
  const url = `${window.location.origin}${window.location.pathname}${cleanSearch()}`;
  try {
    await sendSignInLinkToEmail(c.auth, email.trim(), { url, handleCodeInApp: true });
    try {
      window.localStorage.setItem(EMAIL_STORE, email.trim());
    } catch {
      /* They will be asked for it again when they open the link. */
    }
  } catch (error) {
    throw mapError(error);
  }
}

/** Whether this page was opened from a sign-in link, and the email it was sent to if this browser remembers it. */
export function pendingLink(): { email: string | null } | null {
  const c = connection();
  if (!c || !isSignInWithEmailLink(c.auth, window.location.href)) return null;
  try {
    return { email: window.localStorage.getItem(EMAIL_STORE) };
  } catch {
    return { email: null };
  }
}

/** Completes sign-in from the link, then tidies the address so a refresh does not try again. */
export async function completeLink(email: string): Promise<void> {
  const c = connection();
  if (!c) return;
  try {
    await signInWithEmailLink(c.auth, email.trim(), window.location.href);
    try {
      window.localStorage.removeItem(EMAIL_STORE);
    } catch {
      /* nothing to tidy */
    }
    window.history.replaceState(null, '', `${window.location.pathname}${cleanSearch()}${window.location.hash}`);
  } catch (error) {
    throw mapError(error);
  }
}

/** The page's query without the sign-in link's own parameters (the test page keeps ?tool=portal). */
function cleanSearch(): string {
  const params = new URLSearchParams(window.location.search);
  for (const k of ['mode', 'oobCode', 'apiKey', 'lang', 'continueUrl', 'tenantId']) params.delete(k);
  const q = params.toString();
  return q ? `?${q}` : '';
}

export async function leave(): Promise<void> {
  const c = connection();
  if (c) await signOut(c.auth);
}

/** One portal call. The token is refreshed first, so a role the project manager has just given shows straight away. */
export async function ask<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const c = connection();
  if (!c) throw new PortalError('The portal is not connected in this build.', 'server');
  try {
    const fn = httpsCallable<Record<string, unknown>, T>(c.functions, 'portalApi');
    return (await fn({ ...data, action })).data;
  } catch (error) {
    throw mapError(error);
  }
}

export async function refreshToken(): Promise<void> {
  await connection()?.auth.currentUser?.getIdToken(true);
}

export const ACCEPT = 'application/pdf,image/jpeg,image/png';
export const MAX_BYTES = 15 * 1024 * 1024;

/** Uploads a document copy; returns the id to register it with. */
export async function uploadDocument(file: File, onProgress?: (fraction: number) => void): Promise<string> {
  const c = connection();
  const user = c?.auth.currentUser;
  if (!c || !user) throw new PortalError('Please sign in again.', 'signed-out');
  if (!ACCEPT.split(',').includes(file.type)) throw new PortalError('Please choose a PDF, JPG or PNG.', 'invalid');
  if (file.size > MAX_BYTES) throw new PortalError('That file is over 15 MB. Please choose a smaller one.', 'invalid');
  // A role given since sign-in has to be in the token before Storage lets the upload in.
  await user.getIdToken(true);
  const uploadId = crypto.randomUUID();
  const task = uploadBytesResumable(ref(c.storage, `portal/docs/${user.uid}/${uploadId}`), file, { contentType: file.type });
  await new Promise<void>((resolve, reject) => {
    task.on(
      'state_changed',
      (s) => onProgress?.(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0),
      (error) => reject(mapError(error)),
      () => resolve(),
    );
  });
  return uploadId;
}
