import { FieldValue, getFirestore, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { optOutFor, optOutsOf } from './exportUpn.js';
import { SITE } from './links.js';
import { sendMail, settingsFromEnv, type MailOutcome } from './mail.js';
import { sendSms, ukMobile, type SmsOutcome } from './sms.js';

/**
 * Reminders for families who started the form but have not finished
 * (decided 16 October 2026; before then nothing was ever sent to families).
 * Only to a parent or carer who gave a mobile number or email (required
 * since 16 October 2026):
 *   - 48 hours after the record was first saved, if the screen time could
 *     still come and has not: where it comes from (a parent who stopped
 *     before saying), the parent's own screenshots, or the young person's
 *     part (their agreement and screenshots); then again 5 days later, and
 *     a last time a week after that (16 October 2026: three in all);
 *   - a week after they said the phone was not keeping track of screen time,
 *     so a week's summary now exists.
 * A text when there is a UK mobile number, otherwise an email. Never after
 * a no (the parent's or the young person's), never to a family that has
 * opted out, never to a young person deciding alone (no contact details).
 * Each record keeps when the next one is due (reminderDueAt) and what was
 * sent (reminders), so the team can see it.
 */

export const FIRST_REMINDER_HOURS = 48;
export const SCREEN_TIME_WAIT_DAYS = 7;
const FORM = `${SITE}/take-part/consent/`;

export type ReminderKind = 'choose' | 'screenshots' | 'young-part' | 'screen-time-on';

/** Reminders to finish, in all (the one after "screen time isn't turned on" is extra), and the days between them. */
export const MAX_REMINDERS = 3;
export const FOLLOW_UP_DAYS = [5, 7];

export interface ReminderPlan {
  kind: ReminderKind;
  link: string;
}

/** Whether a reminder is still worth sending for this record, and which. Null when the screen time has come, or never will. */
export function reminderPlan(submission: DocumentData, assentStatus: string | null, now = Date.now(), screenTimeOnSent = false): ReminderPlan | null {
  const code = String(submission.referenceCode ?? '');
  const source = (submission.phoneSource ?? null) as string | null;
  if (!code || submission.kind !== 'consent' || submission.selfConsent) return null;
  const youngLink = `${FORM}?finish=${encodeURIComponent(code)}&for=young`;
  const parentLink = `${FORM}?finish=${encodeURIComponent(code)}`;
  // Stopped after signing but before saying where the screen time comes from: the carry-on page asks it (resume.ts, action source).
  if (source === null && typeof submission.consentId === 'string') return { kind: 'choose', link: parentLink };
  if (source !== 'parent' && source !== 'child') return null;
  if (assentStatus === 'declined') return null;
  const images = Number(submission.imageCount ?? 0);
  const offAt = submission.screenTimeOffAt instanceof Timestamp ? submission.screenTimeOffAt.toMillis() : null;
  if (offAt !== null && !screenTimeOnSent && images === 0 && now - offAt >= SCREEN_TIME_WAIT_DAYS * 86_400_000) return { kind: 'screen-time-on', link: source === 'child' ? youngLink : parentLink };
  if (images > 0) return null;
  if (source === 'parent') return { kind: 'screenshots', link: parentLink };
  return { kind: 'young-part', link: youngLink };
}

/** The words of a reminder: plain, short, one link. */
export function reminderMessage(plan: ReminderPlan, childName: string, linkOpened: boolean, last = false): { sms: string; subject: string; text: string } {
  const name = childName.trim() || 'your child';
  const why = 'The screen time is the most useful part of MyPhone/MyBrain: guesses are often wrong by hours, and only the phone’s own record shows how phones really affect young people.';
  const stop = last ? 'This is our last reminder. If you’d rather not, just ignore it.' : 'If you’d rather not, just ignore this message.';
  let lead: string;
  if (plan.kind === 'choose') lead = `Thank you for starting MyPhone/MyBrain: your answers are saved. One thing is left: whether you can share ${name}’s screen time. It takes a minute.`;
  else if (plan.kind === 'screen-time-on') lead = `A week ago you turned on screen time on ${name === 'your child' ? 'the' : `${name}’s`} phone for MyPhone/MyBrain. It now has a week to share: it takes a minute.`;
  else if (plan.kind === 'screenshots') lead = `Thank you for filling in MyPhone/MyBrain. ${name}’s screen time hasn’t come through yet: you can add the screenshots from your phone in a minute.`;
  else lead = linkOpened ? `Thank you for filling in MyPhone/MyBrain. ${name} opened their link but hasn’t sent their screen time yet.` : `Thank you for filling in MyPhone/MyBrain. ${name} hasn’t done their part yet: please send them this link, or pass them your phone.`;
  const birthday = plan.kind === 'screenshots' || plan.kind === 'choose' || plan.link.includes('for=young') ? ` It asks for ${name}’s date of birth.` : '';
  return {
    sms: `MyPhone/MyBrain (University of Leeds): ${lead} ${plan.link}${birthday ? ` (asks for ${name}’s date of birth)` : ''}${last ? ' Our last reminder.' : ''}`,
    subject: plan.kind === 'screen-time-on' ? `${name}’s screen time is ready to share` : `Finish ${name}’s screen time for MyPhone/MyBrain`,
    text: `${lead}\n\n${plan.link}\n${birthday ? `\n${birthday.trim()}\n` : ''}\n${why}\n\n${stop}\n\nThe MyPhone/MyBrain team, University of Leeds`,
  };
}

/** When the next reminder is due after a record is first saved. */
export function firstReminderDue(from: Date): Timestamp {
  return Timestamp.fromMillis(from.getTime() + FIRST_REMINDER_HOURS * 3_600_000);
}

/** When the reminder after "screen time isn't turned on" is due. */
export function screenTimeReminderDue(from: Date): Timestamp {
  return Timestamp.fromMillis(from.getTime() + SCREEN_TIME_WAIT_DAYS * 86_400_000);
}

export const familyReminders = onSchedule({ region: 'europe-west2', schedule: 'every 1 hours', timeZone: 'Europe/London', timeoutSeconds: 300 }, async () => {
  const db = getFirestore();
  const now = Date.now();
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }).format(new Date(now)));
  // Not in the night: texts and emails go between 9am and 8pm UK time.
  if (hour < 9 || hour >= 20) return;
  const due = await db.collection('submissions').where('reminderDueAt', '<=', Timestamp.fromMillis(now)).limit(200).get();
  if (due.empty) return;
  const optOuts = optOutsOf((await db.collection('optOuts').get()).docs.map((d) => ({ id: d.id, data: d.data() })));
  const mail = settingsFromEnv();
  let sent = 0;
  for (const doc of due.docs) {
    const submission = doc.data();
    const done = (outcome: string, extra: Record<string, unknown> = {}) => doc.ref.update({ reminderDueAt: FieldValue.delete(), reminders: FieldValue.arrayUnion({ at: Timestamp.fromMillis(now), outcome, ...extra }) });
    try {
      const participant = (await db.collection('participants').doc(String(submission.participantId)).get()).data();
      const assent = submission.assentId ? (await db.collection('assents').doc(String(submission.assentId)).get()).data() : undefined;
      // Three reminders to finish in all; the one a week after "screen time isn't turned on" goes once, on top.
      const earlier = ((submission.reminders ?? []) as { kind?: string; channel?: string }[]).filter((r) => r.kind && r.channel);
      const toFinish = earlier.filter((r) => r.kind !== 'screen-time-on').length;
      const plan = reminderPlan(submission, typeof assent?.status === 'string' ? assent.status : null, now, earlier.some((r) => r.kind === 'screen-time-on'));
      if (!plan) {
        await done('not-needed');
        continue;
      }
      if (plan.kind !== 'screen-time-on' && toFinish >= MAX_REMINDERS) {
        await done('limit', { kind: plan.kind });
        continue;
      }
      if (participant && optOutFor(participant, optOuts)) {
        await done('opted-out', { kind: plan.kind });
        continue;
      }
      const guardian = (participant?.guardian ?? null) as { phone?: string | null; email?: string | null } | null;
      const mobile = guardian?.phone ? ukMobile(guardian.phone) : null;
      const email = guardian?.email ?? null;
      if (!mobile && !email) {
        await done('no-contact', { kind: plan.kind });
        continue;
      }
      const last = plan.kind !== 'screen-time-on' && toFinish === MAX_REMINDERS - 1;
      const words = reminderMessage(plan, String(participant?.firstName ?? ''), Boolean(submission.youngLinkFirstOpenedAt), last);
      let outcome: SmsOutcome | MailOutcome;
      let channel: 'sms' | 'email';
      if (mobile) {
        channel = 'sms';
        outcome = await sendSms(mobile, words.sms);
      } else {
        channel = 'email';
        outcome = await sendMail({ to: email!, subject: words.subject, text: words.text }, mail);
      }
      await done(outcome, { kind: plan.kind, channel });
      // The next one, if the record is still not finished then (checked again when it is due).
      const nextIn = plan.kind === 'screen-time-on' ? FOLLOW_UP_DAYS[0] : FOLLOW_UP_DAYS[toFinish];
      if (nextIn !== undefined && toFinish < MAX_REMINDERS) await doc.ref.update({ reminderDueAt: Timestamp.fromMillis(now + nextIn * 86_400_000) });
      if (outcome === 'sent') sent += 1;
    } catch (error) {
      logger.error('Family reminder failed', { referenceCode: doc.id, error: String(error) });
      await done('failed').catch(() => undefined);
    }
  }
  logger.info('Family reminders', { due: due.size, sent });
});
