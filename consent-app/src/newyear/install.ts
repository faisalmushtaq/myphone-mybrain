/**
 * Saving the online study as an app on the phone, and its notifications
 * (the PI, 20 November 2026: people are told to do this so they get
 * reminders; on an iPhone, web notifications only work from a Home Screen
 * app). The same approach as the staff portal (src/portal/push.ts), with its
 * own manifest and service worker (/new-year/manifest.webmanifest, sw.js),
 * kept separate so this bundle never loads Firebase.
 *
 * In the preview, "Turn on reminders" asks for permission and shows a test
 * notification from this device; nothing is sent from a server.
 */
export const WORKER_URL = '/new-year/sw.js';

export function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}
export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/i.test(navigator.userAgent);
export const isMacSafari = () => /Macintosh/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg\//.test(navigator.userAgent) && !isIos();

type InstallOffer = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let offer: InstallOffer | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((f) => f());
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    offer = e as InstallOffer;
    tell();
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    tell();
  });
}
export const canInstall = () => offer !== null;
export function onInstallOffer(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
/** Shows the browser's own install question (Chrome and Edge); true if they installed it. */
export async function installApp(): Promise<boolean> {
  if (!offer) return false;
  const o = offer;
  await o.prompt();
  const { outcome } = await o.userChoice;
  offer = null;
  tell();
  return outcome === 'accepted';
}

export type NotifyState = 'unsupported' | 'needs-home-screen' | 'default' | 'denied' | 'granted';

export function notifyState(): NotifyState {
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return isIos() && !isStandalone() ? 'needs-home-screen' : 'unsupported';
  if (isIos() && !isStandalone()) return 'needs-home-screen';
  return Notification.permission;
}

async function worker(): Promise<ServiceWorkerRegistration | null> {
  try {
    return await navigator.serviceWorker.register(WORKER_URL, { scope: '/new-year/' });
  } catch {
    return null;
  }
}

/** Registers the worker early, so a tapped notification can open the study. */
export function registerWorker(): void {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) void worker();
}

/** Asks for permission, then shows a test notification. */
export async function turnOnNotifications(): Promise<NotifyState> {
  const now = notifyState();
  if (now === 'unsupported' || now === 'needs-home-screen' || now === 'denied') return now;
  const answer = now === 'granted' ? 'granted' : await Notification.requestPermission();
  if (answer !== 'granted') return answer;
  const reg = await worker();
  try {
    const body = 'Reminders are on. We’ll ask how you’re getting on: still going strong?';
    if (reg) await reg.showNotification('MyPhone/MyBrain online study', { body, icon: '/assets/images/logo/icon-192.png', tag: 'mpmb-online-test' });
    else new Notification('MyPhone/MyBrain online study', { body });
  } catch {
    /* permission given; the test could not be shown */
  }
  return 'granted';
}
