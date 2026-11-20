import type { DeviceInfo } from './model';

/**
 * The device in use, recorded with each opening of the study and each visit
 * (the PI, 20 November 2026): it matters for the brain checks, whose timing
 * differs between devices. Worked out from what the browser says about
 * itself; nothing identifying. In the real study the server adds the country
 * the connection came from (not the IP address).
 */
export function deviceInfo(): DeviceInfo {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const touchMac = typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const tablet = /iPad|Tablet/i.test(ua) || touchMac || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const phone = !tablet && /Mobi|iPhone|iPod|Android/i.test(ua);
  const os = /iPhone|iPad|iPod/.test(ua) || touchMac
    ? `iOS ${(/OS (\d+)[._](\d+)/.exec(ua) ?? []).slice(1, 3).join('.') || ''}`.trim()
    : /Android ([\d.]+)/.test(ua)
      ? `Android ${/Android ([\d.]+)/.exec(ua)?.[1] ?? ''}`
      : /Windows NT/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Other';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung Internet'
      : /Firefox\/|FxiOS/.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS/.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Other';
  let standalone = false;
  try {
    standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    /* not known */
  }
  let timeZone = '';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    /* not known */
  }
  const screen = typeof window === 'undefined' ? '' : `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio || 1}`;
  return { deviceType: tablet ? 'tablet' : phone ? 'phone' : 'computer', os, browser, screen, standalone, timeZone };
}

/** A short random id for check-ins and visits. */
export function newId(): string {
  const bytes = new Uint8Array(8);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
