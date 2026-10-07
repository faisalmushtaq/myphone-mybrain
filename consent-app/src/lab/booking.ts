/**
 * Booking the two lab visits, and the messages that keep the study moving
 * without anyone sending them by hand. Plain data with no imports: the
 * server's build reads this file too (firebase/functions/scripts/generate-forms.mjs),
 * so the booking page, the server's checks and the emails agree.
 *
 * The order is fixed by the study: consent, then the data from before the
 * break, then the visits. Nothing can be booked until the screenshots and at
 * least one app's cleaned data have arrived, because the team cannot use a
 * visit without them. Both visits are then booked at the same sitting, so
 * people commit to both: the second ends the break, 28 to 35 days after the
 * first (docs/decisions.md, 7 October 2026).
 *
 * Times are UK times (Europe/London) everywhere: on the page, in the emails
 * and texts, and in the calendar file (written in UTC, so calendars in any
 * time zone show the right moment).
 */

export interface LabVisit {
  visit: 1 | 2;
  title: string;
  /** In calendars and email subjects. */
  summary: string;
  /** What happens, in a sentence: for the page, the email and the calendar entry. */
  what: string;
}

export const labBooking = {
  /** Files from before the break (the first page) that must have arrived before the first visit can be booked. */
  requires: { screenshots: 1, archives: 1 },
  visits: [
    { visit: 1, title: 'First lab visit', summary: 'MyPhone/MyBrain: first lab visit', what: 'About two hours: EEG, ECG and eye-tracking while you do some computer tasks, and questionnaires. Your 30-day social media break starts after this visit.' },
    { visit: 2, title: 'Second lab visit', summary: 'MyPhone/MyBrain: second lab visit', what: 'About two hours: the same recordings, tasks and questionnaires again, at the end of your 30-day break.' },
  ] as LabVisit[],
  /** Length of a visit, unless a slot says otherwise. */
  minutes: 120,
  /** The second visit ends the 30-day break: this many days after the first (inclusive, UK dates). Both are booked together. */
  visit2AfterDays: { min: 28, max: 35 },
  /** A slot must start at least this long after it is booked online. */
  minNoticeHours: 24,
  /** Online changes and cancellations close this long before a visit; after that, people contact the team. */
  changeUntilHours: 24,
  /** How far ahead open slots are shown. */
  horizonDays: 120,
  timeZone: 'Europe/London',
  /** Where visits happen, unless a slot says otherwise. */
  location: {
    name: 'School of Psychology, University of Leeds',
    address: 'Leeds LS2 9JT',
    directions: 'A member of the team will meet you at the main entrance of the School of Psychology.',
    /** Shown only in preview builds. */
    draft: 'Placeholder: confirm the building and the room.',
  },
  /** In the confirmation email and the reminders. */
  bring: ['Your phone, charged.', 'Clean, dry hair, with no oils, gel, spray or conditioner (for the EEG).', 'Your glasses or contact lenses, if you wear them.', 'Please arrive 10 minutes early: we meet you at the main entrance of the School of Psychology.'],
  /** Copied on every booking, change and cancellation email, besides the participant: the study's contact and the team inbox. */
  copyTo: ['M.Faizah@leeds.ac.uk', 'brainpop@leeds.ac.uk'],
  /**
   * Reminders before each visit. A text goes only to people who asked for
   * texts, gave a UK mobile number, and only once the text service is set up
   * (docs/booking.md). A reminder that falls due before the booking was made
   * is skipped: the confirmation has just gone.
   */
  reminders: [
    { id: 'day-before', hoursBefore: 24, email: true, sms: true },
    { id: 'same-day', hoursBefore: 2, email: false, sms: true },
  ],
  /** Texts go only between these hours, UK time; one due outside them goes at the next opening if the visit is still at least 30 minutes away. */
  textHours: { from: 8, to: 21 },
  /** Send a short text when a visit is booked, so a mistyped number shows up at once rather than on the day. */
  textOnBooking: true,
};

/**
 * Messages during the break, timed from the first visit (day 0, UK date),
 * sent at 09:00 UK time by email, and by text to people who asked for texts.
 * Each goes once. A message more than a day overdue (for example because the
 * system was paused) is skipped, never sent late. Nothing goes after a visit
 * is marked as missed, or once the team pauses messages for someone.
 *
 *   unless 'checked-in': skipped when a check-in arrived in the last three days
 *
 * Both visits are booked together, so there is no nudge to book the second.
 */
export interface LabJourneyMessage {
  id: string;
  day: number;
  unless?: 'checked-in';
}

export const labJourneyMessages: LabJourneyMessage[] = [
  { id: 'check-in-1', day: 7, unless: 'checked-in' },
  { id: 'check-in-2', day: 14, unless: 'checked-in' },
  { id: 'check-in-3', day: 21, unless: 'checked-in' },
  { id: 'check-in-4', day: 28, unless: 'checked-in' },
  { id: 'end-of-break', day: 30 },
];

/** The hour (UK time) the break-time messages go out. */
export const labJourneyHour = 9;
