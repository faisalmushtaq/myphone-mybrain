import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import webpush from 'web-push';
import { readSecret } from './secrets.js';

/**
 * Web Push for the staff portal (3 November 2026): notifications on the
 * phones and computers of people who turned them on, from the portal saved
 * to their Home Screen (iPhone, iOS 16.4 and later) or in their browser
 * (Android, desktop). Standard Web Push with VAPID keys: the public key is
 * MPMB_PUSH_PUBLIC_KEY (a repository variable), the private key is the
 * secret mpmb-push-private-key, both made by firebase/scripts/set-push-keys.sh.
 * Without them push is simply off; emails and in-portal notifications carry on.
 *
 * Subscriptions are kept per person and device in
 * portalPushSubs/{uid}/subs/{id}; one the push service says is gone
 * (404 or 410) is deleted.
 *
 * In the emulator nothing is sent (unless MPMB_PUSH_MOCK=0): each push is
 * written to portalPushLog instead, for the end-to-end test.
 */

export const PUSH_SECRET = 'mpmb-push-private-key';
export const PUSH_SUBJECT = 'mailto:S.A.Ali1@leeds.ac.uk';

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  /** Where the notification opens, inside /portal/ (for example "#offers"). */
  link: string;
  /** Groups notifications of the same kind, so a newer one replaces an older one. */
  tag?: string;
}

/** Sends one push; throws an error with statusCode when the push service refuses it. */
export type PushSend = (subscription: PushSubscriptionJson, payload: string) => Promise<void>;

let override: PushSend | null = null;
/** For the tests: replace the sender. */
export function setPushSender(fn: PushSend | null) {
  override = fn;
}

export const pushPublicKey = () => (process.env.MPMB_PUSH_PUBLIC_KEY ?? '').trim() || null;
const mocked = () => process.env.FUNCTIONS_EMULATOR === 'true' && process.env.MPMB_PUSH_MOCK !== '0';

/** Whether push can be sent at all here. */
export async function pushConfigured(): Promise<boolean> {
  if (override || mocked()) return true;
  return Boolean(pushPublicKey() && (await readSecret(PUSH_SECRET)));
}

async function sender(): Promise<PushSend | null> {
  if (override) return override;
  const publicKey = pushPublicKey();
  const privateKey = publicKey ? await readSecret(PUSH_SECRET) : null;
  if (!publicKey || !privateKey) return null;
  return async (subscription, payload) => {
    await webpush.sendNotification(subscription, payload, { vapidDetails: { subject: PUSH_SUBJECT, publicKey, privateKey }, TTL: 24 * 3600, urgency: 'normal' });
  };
}

/** A subscription as the browser gives it, checked; null when it is not one. */
export function subscriptionOf(v: unknown): PushSubscriptionJson | null {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const keys = (o.keys && typeof o.keys === 'object' ? o.keys : {}) as Record<string, unknown>;
  if (typeof o.endpoint !== 'string' || !/^https:\/\/[^\s]{8,800}$/.test(o.endpoint)) return null;
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || keys.p256dh.length > 200 || keys.auth.length > 100) return null;
  return { endpoint: o.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/** A stable id for a subscription (its endpoint), safe as a document id. */
export function subscriptionId(endpoint: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < endpoint.length; i += 1) {
    h ^= endpoint.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `s${h.toString(16)}${endpoint.length.toString(16)}`;
}

/**
 * Sends a payload to each subscription; returns how many went and the ids of
 * those the push service says no longer exist (404 or 410), to delete.
 * Other failures are logged and the subscription kept.
 */
export async function deliver(subs: { id: string; subscription: PushSubscriptionJson }[], payload: PushPayload, send: PushSend): Promise<{ sent: number; gone: string[]; failed: number }> {
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const gone: string[] = [];
  await Promise.all(
    subs.map(async ({ id, subscription }) => {
      try {
        await send(subscription, body);
        sent += 1;
      } catch (error) {
        const status = Number((error as { statusCode?: number })?.statusCode ?? 0);
        if (status === 404 || status === 410) gone.push(id);
        else {
          failed += 1;
          logger.warn('Portal push failed', { status, error: String((error as Error)?.message ?? error).slice(0, 200) });
        }
      }
    }),
  );
  return { sent, gone, failed };
}

/** Pushes to every device a person has turned notifications on for. Never throws. */
export async function pushTo(db: Firestore, uids: string[], payload: PushPayload): Promise<number> {
  try {
    if (mocked() && !override) {
      const batch = db.batch();
      for (const uid of new Set(uids)) batch.set(db.collection('portalPushLog').doc(), { uid, ...payload, at: FieldValue.serverTimestamp() });
      await batch.commit();
      return new Set(uids).size;
    }
    const send = await sender();
    if (!send) return 0;
    let total = 0;
    for (const uid of new Set(uids)) {
      const snap = await db.collection('portalPushSubs').doc(uid).collection('subs').get();
      if (snap.empty) continue;
      const subs = snap.docs.map((d) => ({ id: d.id, subscription: d.data().subscription as PushSubscriptionJson }));
      const r = await deliver(subs, payload, send);
      total += r.sent;
      for (const id of r.gone) await db.collection('portalPushSubs').doc(uid).collection('subs').doc(id).delete();
    }
    return total;
  } catch (error) {
    logger.error('Portal push could not be sent', { error: String((error as Error)?.message ?? error) });
    return 0;
  }
}
