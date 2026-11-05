import { createHash } from 'node:crypto';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { ALLOWED_ORIGINS } from './enquiry.js';
import { labBooking, labStudy } from './forms.js';
import { SITE } from './links.js';
import { sendMail, type MailOutcome } from './mail.js';

/**
 * Pausing recruitment to the lab study (5 November 2026). The team turns new sign-ups off on the staff page when the
 * lab times are full, so nobody gives consent and sends their data only to find there is no visit to book. People who
 * have already given consent carry on as normal: their check-ins, data, MyStory and bookings are not affected.
 * The break group and the control group are paused separately. Stored in meta/labRecruitment.
 */
export type RecruitGroup = 'break' | 'control';
export interface GroupRecruitment {
  paused: boolean;
  message: string;
  changedAt: string | null;
}
export type Recruitment = Record<RecruitGroup, GroupRecruitment>;

export const DEFAULT_PAUSED_MESSAGE = 'We are not taking on new participants at the moment because all our lab visits are full. Recruitment will reopen after the New Year.';
const MAX_MESSAGE = 400;

const docOf = (db: Firestore) => db.collection('meta').doc('labRecruitment');

function groupFrom(raw: unknown): GroupRecruitment {
  const g = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const at = g.changedAt as { toDate?: () => Date } | string | undefined;
  return {
    paused: g.paused === true,
    message: typeof g.message === 'string' && g.message.trim() ? g.message.trim().slice(0, MAX_MESSAGE) : DEFAULT_PAUSED_MESSAGE,
    changedAt: typeof at === 'string' ? at : (at?.toDate?.().toISOString() ?? null),
  };
}

export function recruitmentFrom(data: Record<string, unknown> | undefined): Recruitment {
  return { break: groupFrom(data?.break), control: groupFrom(data?.control) };
}

export async function readRecruitment(db: Firestore): Promise<Recruitment> {
  return recruitmentFrom((await docOf(db).get()).data());
}

/** The staff page's switch: one group at a time, with the message shown on the website while it is paused. */
export async function setRecruitment(db: Firestore, group: unknown, paused: unknown, message: unknown, by: string): Promise<Recruitment> {
  if (group !== 'break' && group !== 'control') throw new Error('Unknown group.');
  const text = typeof message === 'string' ? message.trim().slice(0, MAX_MESSAGE) : '';
  await docOf(db).set({ [group]: { paused: paused === true, message: text || DEFAULT_PAUSED_MESSAGE, changedAt: FieldValue.serverTimestamp(), changedBy: by } }, { merge: true });
  logger.info(paused === true ? 'Lab recruitment paused' : 'Lab recruitment reopened', { group });
  return readRecruitment(db);
}

/** What the website shows: open or paused, and the message, per group. Public and read-only; nothing about anyone. */
export const labRecruitment = onRequest({ region: 'europe-west2', cors: ALLOWED_ORIGINS, memory: '256MiB', timeoutSeconds: 15 }, async (_req, res) => {
  try {
    const r = await readRecruitment(getFirestore());
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ break: { open: !r.break.paused, message: r.break.paused ? r.break.message : null }, control: { open: !r.control.paused, message: r.control.paused ? r.control.message : null } });
  } catch (error) {
    logger.error('Recruitment status could not be read', { error: String(error) });
    res.status(503).json({ error: 'unavailable' });
  }
});

/**
 * The waiting list (5 November 2026): while recruitment is paused, people can leave an email address to hear when it
 * reopens. The address is kept only for that: it is not linked to any study record, and it is deleted once the
 * reopening email has gone to it. Stored in labWaitlist/ (identifying), one row per address and group.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const WAITLIST_PER_HOUR = 5;

export function waitlistEntry(body: unknown): { email: string; group: RecruitGroup; bot: boolean } | string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL.test(email)) return 'Please enter a valid email address.';
  const group = b.group === 'control' ? 'control' : 'break';
  return { email, group, bot: typeof b.website === 'string' && b.website.trim() !== '' };
}

export const waitlistId = (email: string, group: RecruitGroup) => createHash('sha256').update(`${group}|${email}`).digest('hex').slice(0, 32);

export const labWaitlist = onRequest({ region: 'europe-west2', cors: ALLOWED_ORIGINS, memory: '256MiB', timeoutSeconds: 30 }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Use POST.' });
    return;
  }
  const entry = waitlistEntry(req.body);
  if (typeof entry === 'string') {
    res.status(400).json({ ok: false, error: entry });
    return;
  }
  if (entry.bot) {
    res.json({ ok: true });
    return;
  }
  const db = getFirestore();
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || 'unknown';
  const key = `waitlist-${createHash('sha256').update(ip).digest('hex').slice(0, 32)}`;
  const overLimit = await db.runTransaction(async (tx) => {
    const ref = db.collection('ratelimits').doc(key);
    const current = (await tx.get(ref)).data() as { windowStart?: number; count?: number } | undefined;
    const now = Date.now();
    const same = current?.windowStart !== undefined && now - current.windowStart < 3_600_000;
    const count = same ? (current?.count ?? 0) + 1 : 1;
    tx.set(ref, { windowStart: same ? current?.windowStart : now, count, updatedAt: FieldValue.serverTimestamp() });
    return count > WAITLIST_PER_HOUR;
  });
  if (overLimit) {
    res.status(429).json({ ok: false, error: 'Too many tries from this connection. Please try again later.' });
    return;
  }
  await db.collection('labWaitlist').doc(waitlistId(entry.email, entry.group)).set({ email: entry.email, group: entry.group, joinedAt: FieldValue.serverTimestamp() }, { merge: true });
  logger.info('Waiting list joined', { group: entry.group });
  res.json({ ok: true });
});

export interface WaitingPerson {
  id: string;
  email: string;
  joinedAt: string | null;
  lastTry: MailOutcome | null;
}

export async function waitingList(db: Firestore): Promise<Record<RecruitGroup, WaitingPerson[]>> {
  const snap = await db.collection('labWaitlist').get();
  const out: Record<RecruitGroup, WaitingPerson[]> = { break: [], control: [] };
  for (const d of snap.docs) {
    const x = d.data();
    const group: RecruitGroup = x.group === 'control' ? 'control' : 'break';
    out[group].push({ id: d.id, email: String(x.email ?? ''), joinedAt: x.joinedAt?.toDate?.().toISOString() ?? null, lastTry: (x.lastTry as MailOutcome | undefined) ?? null });
  }
  for (const g of ['break', 'control'] as const) out[g].sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt)));
  return out;
}

export function reopenEmail(group: RecruitGroup): { subject: string; text: string } {
  const page = group === 'control' ? 'the MyPhone/MyBrain lab study' : 'the MyPhone/MyBrain social media break study';
  return {
    subject: group === 'control' ? 'MyPhone/MyBrain lab study: recruitment is open again' : 'MyPhone/MyBrain social media break study: recruitment is open again',
    text: [
      'Hello,',
      '',
      `You asked us to let you know when recruitment to ${page} reopened. It is open again now.`,
      '',
      `If you would still like to take part, you can read about the study and get in touch here: ${SITE}/break/`,
      '',
      `If you have any questions, reply to this email or contact ${labStudy.contactName} at ${labStudy.contactEmail}.`,
      '',
      'This is the only email we will send you about this. Your email address has now been deleted from our list.',
      '',
      'The MyPhone/MyBrain research team, University of Leeds',
    ].join('\n'),
  };
}

/** Emails everyone waiting for a group, one at a time (nobody sees anyone else's address), and deletes each address once sent. */
export async function notifyWaitlist(db: Firestore, group: RecruitGroup): Promise<{ sent: number; failed: number; left: number }> {
  const waiting = (await waitingList(db))[group];
  const message = reopenEmail(group);
  const started = Date.now();
  let sent = 0;
  let failed = 0;
  let left = 0;
  for (const p of waiting) {
    // The staff call has two minutes: stop in good time and say how many are left, so pressing again finishes the list.
    if (Date.now() - started > 80_000) {
      left += 1;
      continue;
    }
    const outcome = await sendMail({ to: p.email, replyTo: labStudy.contactEmail, ...message });
    if (outcome === 'sent') {
      await db.collection('labWaitlist').doc(p.id).delete();
      sent += 1;
    } else {
      await db.collection('labWaitlist').doc(p.id).set({ lastTry: outcome, lastTryAt: FieldValue.serverTimestamp() }, { merge: true });
      failed += 1;
    }
  }
  if (sent) await sendMail({ to: labBooking.copyTo.join(', '), replyTo: labStudy.contactEmail, subject: `Copy: ${message.subject}`, text: `Sent to ${sent} ${sent === 1 ? 'person' : 'people'} on the waiting list (addresses now deleted).${failed ? ` ${failed} could not be sent and are still on the list.` : ''}\n\n----\n\n${message.text}` });
  logger.info('Waiting list told recruitment reopened', { group, sent, failed, left });
  return { sent, failed, left };
}
