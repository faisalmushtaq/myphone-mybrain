import { labCheckInDay, labJourneyHour } from './forms.js';
import { addDays, atUkTime, ukClock, ukDate, ukShortDate } from './ukTime.js';

/**
 * The break study's daily messages (the team's wording, 20 October 2026).
 *
 * One message at 09:00 UK time every day from the day after the first lab
 * visit to the day before the second, so the run stretches to each person's
 * break (the second visit is 30 to 35 days after the first, or whatever day
 * the team booked). Then a thank-you the morning after the second visit.
 *
 *   days 1 to 14       the opening messages, in order
 *   day 15             the link to the mid-break check-in
 *   from day 16        until the check-in is complete (answers, screenshot and
 *                      MyStory), a reminder with the link each day instead
 *   in between         the middle messages, in order (weeks 3 and 4 marked on
 *                      days 21 and 28), as many as the break needs
 *   the last 4 days    the second visit coming up, a thank-you, nearly time,
 *                      and on the last day the visit tomorrow: when and where
 *   the day after      a thank-you
 *
 * Texts are plain characters (no curly quotes), so a text is billed as one
 * part up to 160 characters; the check-in ones, with their link, take two.
 */

export const DEFAULT_BREAK_DAYS = 30;

export type DailyKind = 'daily' | 'check-in' | 'check-in-reminder' | 'visit-soon' | 'visit-tomorrow' | 'thank-you';

export interface PlannedMessage {
  id: string;
  /** Days after the first visit (its UK date is day 0). */
  day: number;
  dueAt: Date;
}

const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
/** Days from one UK date (YYYY-MM-DD) to another. */
export const daysBetween = (from: string, to: string) => Math.round((ms(to) - ms(from)) / 86_400_000);

/** How many days the break runs: from the first visit's UK date to the second's (the default while no second visit stands). */
export function breakLength(visit1Start: Date, visit2Start: Date | null): number {
  return visit2Start ? Math.max(2, daysBetween(ukDate(visit1Start), ukDate(visit2Start))) : DEFAULT_BREAK_DAYS;
}

/** Every message this person is due: one a day from day 1 to the day before the second visit, then the thank-you after it. */
export function dailyPlan(visit1Start: Date, visit2Start: Date | null): PlannedMessage[] {
  const days = breakLength(visit1Start, visit2Start);
  const start = ukDate(visit1Start);
  const plan: PlannedMessage[] = Array.from({ length: days - 1 }, (_, i) => i + 1).map((day) => ({ id: `day-${day}`, day, dueAt: atUkTime(addDays(start, day), labJourneyHour) }));
  if (visit2Start) plan.push({ id: 'thank-you', day: days + 1, dueAt: atUkTime(addDays(ukDate(visit2Start), 1), labJourneyHour) });
  return plan;
}

export const openingLines: string[] = [
  "Here we go! Thanks for joining us for this social media break. Just focus on today: you don't have to think about the whole break yet.",
  "We hope your day's going well. Getting used to a different routine can take a little time. Keep going!",
  'Picked up your phone without thinking? Habits do that sometimes. Put it down for a moment and carry on with your day.',
  'Just a little encouragement from us today. Thanks for sticking with the break!',
  'Five days in! We know this takes effort, especially when social media is part of your usual routine.',
  "Got a quiet moment today? You don't have to fill it. It's fine to just take a breather.",
  'One week in! Well done for giving this a go. We really appreciate your time.',
  "Here's to another week. Take it day by day, just as you've been doing.",
  "If today feels a bit harder, take it a little at a time. You don't have to find every day easy.",
  "A quick hello from the team. We're cheering you on!",
  'Tempted to have a scroll? Give yourself a moment before deciding what to do next.',
  "There's no need to do anything impressive with your time away from social media. Enjoy your day in whatever way suits you.",
  "Thanks for keeping at it. We know you're fitting this around everything else in your life.",
  "Two weeks in! Tomorrow we'll send you a link to tell us how it's been going.",
];

/** Between the check-in and the last few days, in order; as many as the break needs (it starts again if a break runs very long). */
export const middleLines: string[] = [
  'Hello again! Thanks for carrying on with us. No task from us today, just a little encouragement.',
  "One day at a time. Thanks for the effort you're putting into this.",
  'Missing a catch-up? Perhaps give someone a call or make time to see them, if you fancy it.',
  "However the break feels today, you don't need to put a positive spin on it. Your honest experience is what matters to us.",
  "We know taking a break isn't always convenient. Thank you for making the effort.",
  "Hope today's treating you kindly. Keep taking the break at your own pace, one day at a time.",
  'Having a tricky day? Be kind to yourself. Questions about the study? Email us at {email}.',
  'Just stopping by to say we appreciate you taking part. No need to reply!',
  "You're well into the break now. Keep going at your own pace.",
  'Spent time on something new lately, or something you had missed? Either way, we hope you enjoyed it.',
  'Thanks for being part of MyPhone/MyBrain. Your time really does make a difference to the research.',
  "A quick hello from the team. We hope today's a good one.",
  'Every day of the break helps the study. Thank you for keeping going.',
  'Fancy some fresh air today? A short walk can be a nice break from screens.',
  "Nice work. You've come a long way since day one.",
];

const milestones: Record<number, string> = {
  21: 'Three weeks in! Sending a big thank-you from the study team.',
  28: "Four weeks in! Thank you for everything you've put into the break so far.",
};

const reminderLines = [
  "Just a reminder: your mid-break check-in is still open, and we'd love to hear how it's going. About 20 minutes: {link}",
  'Got 20 minutes today? Your mid-break check-in is still waiting for you: a screenshot and your story. {link}',
  "Your mid-break check-in helps us understand how the break is really going. Please do it when you can: {link}",
];

export interface DailyContext {
  /** Days from the first visit to the second (breakLength). */
  days: number;
  visit2: { start: Date; place: string } | null;
  /** The check-in is in: its answers, a screenshot and the mid-break MyStory. */
  checkInDone: boolean;
  checkInLink: string;
  contactEmail: string;
}

/** What a day's message is and says (without the "MyPhone/MyBrain:" at the start of a text). */
export function dailyMessage(day: number, ctx: DailyContext): { kind: DailyKind; line: string } {
  const fill = (s: string) => s.replace('{link}', ctx.checkInLink).replace('{email}', ctx.contactEmail);
  const { days } = ctx;
  if (day > days) return { kind: 'thank-you', line: "A big thank-you from all of us! We're grateful for your time and for sharing your experience with us." };
  if (day === days - 1)
    return {
      kind: 'visit-tomorrow',
      line: ctx.visit2 ? `Not long now! Your second lab visit is tomorrow, ${ukShortDate(ctx.visit2.start)} at ${ukClock(ctx.visit2.start)}, ${ctx.visit2.place}. We look forward to seeing you.` : "Not long now! Your second lab visit is coming up: the details are in your email. We look forward to seeing you.",
    };
  if (day === labCheckInDay) {
    return ctx.checkInDone
      ? { kind: 'daily', line: 'Thanks for your mid-break check-in! It really helps to hear how the break is going.' }
      : { kind: 'check-in', line: fill("You've reached the mid-break check-in! Please share your screen-time screenshot and your story here: {link} Easy, hard or a bit of both, we'd like to hear how it's really been.") };
  }
  if (day > labCheckInDay && !ctx.checkInDone) return { kind: 'check-in-reminder', line: fill(reminderLines[(day - labCheckInDay - 1) % reminderLines.length]) };
  if (day === days - 4) return { kind: 'visit-soon', line: ctx.visit2 ? `Your second lab visit is coming up on ${ukShortDate(ctx.visit2.start)}. Have a quick look at your booking so you know when we'll see you!` : 'Your second lab visit is coming up. Have a quick look at your booking so you know when we will see you!' };
  if (day === days - 3) return { kind: 'daily', line: "Thanks for sharing your time with us. When we next see you, we'd love to hear what the experience has been like." };
  if (day === days - 2) return { kind: 'daily', line: "Nearly time to see you again! Please follow the team's instructions about when to finish your social media break." };
  if (day <= openingLines.length) return { kind: 'daily', line: openingLines[day - 1] };
  if (milestones[day]) return { kind: 'daily', line: milestones[day] };
  let index = 0;
  for (let d = labCheckInDay + 1; d < day; d += 1) if (!milestones[d]) index += 1;
  return { kind: 'daily', line: fill(middleLines[index % middleLines.length]) };
}

/** Whether a message asks the person to do something, so it goes by email as well as by text. */
export const asksSomething = (kind: DailyKind) => kind === 'check-in' || kind === 'check-in-reminder';
