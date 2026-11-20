import { createHash } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

/**
 * Staff portal sign-up. Accounts are made here, not by the browser, so that
 * people cannot be spammed with verification emails or the team with account
 * requests. Every sign-up must:
 *  - leave the hidden "website" field empty (bots fill it in);
 *  - carry a proof of work: a nonce the browser found so that
 *    sha256(email|ts|nonce) starts with POW_BITS zero bits (a second or two of
 *    work in a browser, nothing for one person, costly in bulk), made in the
 *    last 10 minutes and never used before;
 *  - be within the limits: a few per connection an hour, a few per address a
 *    day, and a cap on all sign-ups a day.
 * Direct sign-up from the browser is switched off in Firebase Authentication
 * (the deploy does this), so this is the only way in.
 */
const REGION = 'europe-west2';
export const POW_BITS = 18;
const POW_WINDOW_MS = 10 * 60_000;
export const PER_IP_HOUR = 5;
export const PER_EMAIL_DAY = 3;
export const ALL_DAY = 40;
const MIN_PASSWORD = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);

/** The number of leading zero bits in a sha256 digest. */
export function leadingZeroBits(digest: Buffer): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

export function proofOk(email: string, ts: number, nonce: string, now: number, bits = POW_BITS): boolean {
  if (!Number.isFinite(ts) || Math.abs(now - ts) > POW_WINDOW_MS) return false;
  if (!/^[0-9a-z]{1,16}$/.test(nonce)) return false;
  return leadingZeroBits(createHash('sha256').update(`${email}|${ts}|${nonce}`).digest()) >= bits;
}

export interface SignUpInput {
  email: string;
  password: string;
  ts: number;
  nonce: string;
  bot: boolean;
}

/** Checks the shape of a sign-up; a string is the message to show. */
export function signUpInput(data: unknown): SignUpInput | string {
  const d = (data ?? {}) as Record<string, unknown>;
  const email = typeof d.email === 'string' ? d.email.trim().toLowerCase() : '';
  const password = typeof d.password === 'string' ? d.password : '';
  if (!EMAIL.test(email) || email.length > 200) return 'Please give a valid email address.';
  if (password.length < MIN_PASSWORD || password.length > 200) return `Please choose a password of at least ${MIN_PASSWORD} characters.`;
  return {
    email,
    password,
    ts: typeof d.ts === 'number' ? d.ts : NaN,
    nonce: typeof d.nonce === 'string' ? d.nonce : '',
    bot: typeof d.website === 'string' && d.website.trim() !== '',
  };
}

/** Counts one more use of a windowed limit; true when it is over. */
async function over(db: Firestore, key: string, windowMs: number, limit: number): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = db.collection('ratelimits').doc(key);
    const cur = (await tx.get(ref)).data() as { windowStart?: number; count?: number } | undefined;
    const now = Date.now();
    const same = cur?.windowStart !== undefined && now - cur.windowStart < windowMs;
    const count = same ? (cur?.count ?? 0) + 1 : 1;
    tx.set(ref, { windowStart: same ? cur?.windowStart : now, count, updatedAt: FieldValue.serverTimestamp() });
    return count > limit;
  });
}

/** True the first time a proof is seen; it is kept for the window, so it cannot be used twice. */
async function freshProof(db: Firestore, key: string): Promise<boolean> {
  try {
    await db.collection('ratelimits').doc(key).create({ usedAt: FieldValue.serverTimestamp() });
    return true;
  } catch {
    return false;
  }
}

/** Limits on anything that emails the team from an unapproved account (account requests). */
export async function requestLimited(db: Firestore, _uid: string, ip: string): Promise<boolean> {
  return (await over(db, `portal-request-ip-${hash(ip)}`, HOUR, PER_IP_HOUR)) || (await over(db, `portal-request-day`, DAY, ALL_DAY));
}

export const ipOf = (raw: { headers: Record<string, string | string[] | undefined>; ip?: string } | undefined): string =>
  String(raw?.headers?.['x-forwarded-for'] ?? '').split(',')[0]?.trim() || raw?.ip || 'unknown';

const tooMany = () => new HttpsError('resource-exhausted', 'Too many sign-ups just now. Please try again later, or ask the study team to help.');

export const portalSignUp = onCall({ region: REGION, memory: '256MiB', timeoutSeconds: 30, maxInstances: 5 }, async (request) => {
  const input = signUpInput(request.data);
  if (typeof input === 'string') throw new HttpsError('invalid-argument', input);
  // A bot: say yes and do nothing.
  if (input.bot) return { ok: true };
  if (!proofOk(input.email, input.ts, input.nonce, Date.now())) throw new HttpsError('failed-precondition', 'The security check did not pass. Please reload the page and try again.');
  const db = getFirestore();
  if (!(await freshProof(db, `portal-signup-proof-${hash(`${input.email}|${input.ts}|${input.nonce}`)}`))) throw new HttpsError('failed-precondition', 'The security check did not pass. Please reload the page and try again.');
  const ip = ipOf(request.rawRequest as never);
  if (await over(db, `portal-signup-ip-${hash(ip)}`, HOUR, PER_IP_HOUR)) throw tooMany();
  if (await over(db, `portal-signup-email-${hash(input.email)}`, DAY, PER_EMAIL_DAY)) throw tooMany();
  if (await over(db, 'portal-signup-day', DAY, ALL_DAY)) {
    logger.warn('Portal sign-ups hit the daily cap');
    throw tooMany();
  }
  try {
    await getAuth().createUser({ email: input.email, password: input.password, emailVerified: false });
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'There is already an account for this email. Sign in, or reset your password.');
    if (code === 'auth/invalid-password') throw new HttpsError('invalid-argument', `Please choose a password of at least ${MIN_PASSWORD} characters.`);
    if (code === 'auth/invalid-email') throw new HttpsError('invalid-argument', 'Please give a valid email address.');
    throw error;
  }
  logger.info('Portal account created');
  return { ok: true };
});
