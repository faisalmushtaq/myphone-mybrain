import { ask } from './api';

/**
 * Push notifications in the staff portal (3 November 2026): this device's
 * subscription, turned on only when the person presses the button. On an
 * iPhone or iPad they only work from the portal saved to the Home Screen
 * (iOS 16.4 and later); on Android and computers, in the browser too. The
 * service worker is /portal/sw.js, which only shows notifications and opens
 * the portal when one is tapped.
 */

const SW_URL = '/portal/sw.js';

/** Running as the app saved to the Home Screen (or installed), not in a browser tab. */
export function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/i.test(navigator.userAgent);

/** Whether this browser can do push here and now. */
export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export type PushState = 'unsupported' | 'needs-home-screen' | 'not-set-up' | 'denied' | 'off' | 'on';

const keyBytes = (base64url: string) => {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return (await navigator.serviceWorker.getRegistration('/portal/')) ?? (await navigator.serviceWorker.register(SW_URL, { scope: '/portal/' }));
  } catch {
    return null;
  }
}

/** Where push stands on this device. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return isIos() && !isStandalone() ? 'needs-home-screen' : 'unsupported';
  const { configured } = await ask<{ publicKey: string | null; configured: boolean }>('push-key');
  if (!configured) return 'not-set-up';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/** Asks permission (only ever from a button press) and subscribes this device. */
export async function enablePush(): Promise<PushState> {
  const { publicKey, configured } = await ask<{ publicKey: string | null; configured: boolean }>('push-key');
  if (!configured || !publicKey) return 'not-set-up';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await registration();
  if (!reg) return 'unsupported';
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await ask('push-subscribe', { subscription: sub.toJSON(), label: `${isIos() ? 'iPhone/iPad' : isAndroid() ? 'Android' : 'Computer'} · ${new Date().toLocaleDateString('en-GB')}` });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await ask('push-unsubscribe', { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
  return 'off';
}

/** Registers the service worker early, so a tapped notification can open the portal. */
export function registerPortalWorker() {
  void registration();
}
