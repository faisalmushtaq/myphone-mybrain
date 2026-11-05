import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { ALLOWED_ORIGINS } from './enquiry.js';

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
