# Lab visits: booking, confirmations and reminders

The social media break study books its two lab visits on the website, in
order: **consent, then the data from before the break, then the first
visit**. The first visit cannot be booked until the screenshots and at least
one app's cleaned data have arrived (the team cannot use a visit without
them). The second visit ends the 30-day break, so it is offered only once
the first is booked, in the days after it that end the break.

Everything after that runs by itself: confirmations with a calendar file,
reminders before each visit, the weekly check-in nudges during the break, a
nudge to book the second visit, and the end-of-break message.

## What the participant sees

| Where | What |
| --- | --- |
| `/break/take-part/`, the summary at the end | Once the data is in: **Book your first lab visit** → the times open now, by day |
| `/break/check-in/` and `/break/after/`, the summary | **Book your second lab visit** while it is not booked; the booked visit once it is |
| `/break/book/` (its own page; the personal link in every email) | Both visits: add to calendar (`.ics` file or Google Calendar), change the time, cancel, book what is next |

Booking asks for an email address (the confirmation goes there) and, once
texts are set up, a UK mobile number with a **Text me reminders** tick. The
device remembers both for the next booking. Changes and cancellations online
close 24 hours before a visit; after that the page says to contact Miftah.
Times are always UK times, whatever the phone's time zone.

## What gets sent, and when

Every message is recorded against the booking or the participant with its
outcome (`sent`, `failed`, `not-configured`, `no-contact`, `not-wanted`,
`invalid-number`, or why it was skipped), visible on the staff page and in
the export.

| When | Email | Text (if wanted) |
| --- | --- | --- |
| Booked, moved or cancelled | Confirmation to the participant, **copied to Miftah** (`labStudy.contact.email`), with the calendar file attached (a cancellation removes it from calendars) | A one-line confirmation (so a mistyped number shows up at once) |
| The day before a visit | Reminder: when, where, what to bring | Reminder |
| On the day, two hours before | | Reminder (texts go only 08:00 to 21:00 UK time; an earlier one goes at 08:00 if the visit is still at least 30 minutes away) |
| Day 1 after the first visit, and day 22 | "Book your second visit" (skipped once it is booked) | Same, with the link |
| Days 7, 14, 21 and 28 | "Time for your weekly check-in" with the personal link (skipped if they checked in within three days) | Same |
| Day 30 | "Last day of your break": screenshots before unlocking, then the downloads | Same |

Break-time messages go at 09:00 UK time on their day, counted from the first
visit's date. A message more than a day overdue (for example when a first
visit is booked late) is skipped, never sent late. A reminder that falls due
before the booking was made is skipped (the confirmation has just gone).
Nothing goes after a visit is marked **missed**, or once the team presses
**Stop the automatic reminders and messages** for someone on the staff page.
The schedule is in `src/lab/booking.ts` (`labBooking.reminders`,
`labJourneyMessages`); the wording is in `firebase/functions/src/booking.ts`.

The scheduled function `labMessages` runs every 15 minutes. Two runs can never
send the same message twice: each is claimed in a transaction first.

## Setting it up (once, about ten minutes)

1. **Email.** Already done if website enquiries reach the team: the same
   Gmail account sends confirmations and reminders
   (`scripts/set-mail-password.sh`, `MPMB_SMTP_USER`). Gmail allows about
   500 messages a day, plenty for this study.
2. **The staff key.** In Cloud Shell:
   `bash consent-app/firebase/scripts/set-staff-key.sh myphone-mybrain`.
   It prints a long key once: put it in the team's password manager. Sign in
   at <https://myphonemybrain.com/break/staff/>.
3. **Lab times.** On the staff page, **Lab times → Add lab times**: a first
   and last date, the weekdays, the start times (for example `10:00, 14:00`),
   the length (120 minutes), places at once (1), and whether the times are
   for first visits, second visits or either. Participants can book as soon
   as times exist, from 24 hours ahead. Close a time to stop new bookings;
   remove one nobody has booked.
4. **Texts (optional).** Texts need an SMS provider account. The code uses
   [Twilio](https://www.twilio.com/sms/pricing/gb) (pay as you go, about
   $0.046 (roughly 3.5p) a text to a UK mobile, no monthly fee beyond a
   number if one is used):
   - create the account and note the account SID and auth token;
   - in Cloud Shell: `bash consent-app/firebase/scripts/set-sms-credentials.sh myphone-mybrain`;
   - set the repository variable **MPMB_SMS_FROM** (Settings → Secrets and
     variables → Actions → Variables): either a Twilio number (`+447…`) or
     a sender name of up to 11 letters and digits, such as `MyPhoneMB` (UK
     networks show it instead of a number; people cannot reply to it);
   - redeploy the backend (Actions → Deploy Firebase backend → Run workflow);
   - on the staff page, **Check emails and texts arrive** → send a test to
     your own phone.

   Until both the credentials and the sender exist, the booking page does not
   offer texts at all, and nothing is texted.

   Cost: about a dozen texts per participant over the study (two booking
   confirmations, four visit reminders, four check-in nudges, the end of the
   break, perhaps one booking nudge): roughly 50p a participant, about £50
   for 100 participants. UK alternatives at similar prices include
   [The SMS Works](https://www.thesmsworks.co.uk/pricing) (from 3.95p + VAT)
   and [Firetext](https://firetext.co.uk/pricing) (5p); switching provider
   means changing `firebase/functions/src/sms.ts` only. The University may
   also have an institutional SMS service.

## The staff page

<https://myphonemybrain.com/break/staff/> (not linked from anywhere, not
indexed), behind the staff key, which stays in that browser tab until it is
closed:

- **Lab times**: add, close, reopen, remove; send a test email and text.
- **Bookings**: from a fortnight ago onwards, with each participant's
  contact details, the confirmation and every reminder with its outcome.
  Mark **attended** or **missed** (a missed first visit can be booked again;
  break-time messages stop), send the confirmation again, cancel (with a
  reason for the participant, emailed with a calendar cancellation, or
  silently), and **Book someone in** (for example the second visit at the
  end of the first: the team is not held to the notice, the window or the
  data check).
- **Participants**: everyone with consent, where they stand (files, visits,
  check-ins, stories), and one participant in detail: the messages sent,
  stopping or restarting their automatic messages, and their **personal
  links** (below).
- **School uploads**: the schools' UPN pages (see `school-uploads.md`).

## Personal links

Every page of the study opens ready for one participant when the link
carries their participant ID, on any device, so nobody types their details
again:

| Link | Opens |
| --- | --- |
| `/break/take-part/?code=MP…` | Before the break: consent, screenshots, app data |
| `/break/book/?code=MP…` | Their lab visits |
| `/break/check-in/?code=MP…` | The weekly check-in (with MyStory at the end) |
| `/break/after/?code=MP…` | After the break: screenshots and app data again |
| `/break/mystory/?phase=pre\|mid\|post&code=MP…` | MyStory for that phase (or the external survey, with the ID and phase passed on; see `mystory.md`) |

The emails and texts use these links; the staff page lists them for each
participant with copy buttons. The page removes the ID from the address bar
as soon as it has read it, and asks the person to confirm it ("Your
participant ID: … Not mine: enter my details instead"). The participant ID is
not a password: the pages only ever let someone add to their record, see
counts of what was sent, and book; every booking change is emailed to the
participant and copied to Miftah, so misuse would be noticed.

## Records and the export

| Firestore | |
| --- | --- |
| `labSlots/` | the times: start, end, places, booked, open or closed, visit, place |
| `labBookings/` | one per booking: participant ID, visit, time, place, status (`booked`, `attended`, `missed`, `cancelled`), who booked or cancelled and why, the booking it replaces or was replaced by, the calendar sequence, the confirmation, and each reminder with its outcome |
| `labContacts/{code}` | email address, UK mobile (international form) and whether texts are wanted (identifying) |
| `labParticipants/{code}` | gains `visit1At`, `visit2At`, `messages` (each break-time message and its outcome) and `messagesPaused` |

The hourly export adds `social-media-break/identifying/visits.tsv` (every
booking, move and cancellation, with the outcomes) and `contacts.tsv`, and
the research table `participants.tsv` gains `visit1_on`, `visit1_status`,
`visit2_on`, `visit2_status` (dates only, no contact details).

## Placeholders to confirm

In `src/lab/booking.ts`: the place (building, room, where people are met:
shown with a draft marker in preview builds), what to bring, the visit-2
window (30 to 35 days after visit 1), the notice (24 hours) and the cut-off
for online changes (24 hours). See `content-placeholders.md`.
