# Lab visits: booking, confirmations and reminders

The social media break study books its two lab visits on the website, in
order: **consent, then the data from before the break, then both visits**.
Nothing can be booked until the screenshots and at least one app's cleaned
data have arrived (the team cannot use a visit without them). Then both
visits are booked **at the same sitting**, so people commit to both: the
first starts the 30-day break and the second, **28 to 35 days later**, ends
it (decided 7 October 2026, `decisions.md`).

Everything after that runs by itself: confirmations with a calendar file per
visit, reminders before each visit, the weekly check-in nudges during the
break, and the end-of-break message.

## What the participant sees

| Where | What |
| --- | --- |
| `/break/take-part/`, the summary at the end | Once the data is in: **Book your two lab visits** → choose the first visit's time; the second visit's times then show, only those 28 to 35 days after it; **Book both visits** |
| `/break/check-in/` and `/break/after/`, the summary | The visits still to come (or, if a visit was missed or cancelled, booking it again) |
| `/break/book/` (its own page; the personal link in every email) | Both visits: add to calendar (`.ics` file or Google Calendar); **Change my times** (keep either time or choose a new one; the second must still be 28 to 35 days after the first); **Cancel your visits** (cancels both; to take part they book both again) |

Booking asks for an email address (the confirmation goes there) and a UK
mobile number, which is **required**: the team needs it to contact people
about their visits (decided 7 October 2026). A **Text me reminders** tick,
on unless they untick it, decides whether the reminders and the break-time
nudges also go by text; until texts are set up, the choice is kept and texts
start once they are. The device remembers both for the next booking. Changes and cancellations online
close 24 hours before a visit; after that the page says to contact Miftah.
Times are always UK times, whatever the phone's time zone.

## What gets sent, and when

Every message is recorded against the booking or the participant with its
outcome (`sent`, `failed`, `not-configured`, `no-contact`, `not-wanted`,
`invalid-number`, or why it was skipped), visible on the staff page and in
the export.

| When | Email | Text (if wanted) |
| --- | --- | --- |
| Booked, moved or cancelled | Confirmation to the participant listing both visits and what to bring, **copied to Miftah and brainpop@leeds.ac.uk** (`labBooking.copyTo`), replies to Miftah, with a calendar file per visit attached (a cancellation removes them from calendars) | A one-line confirmation (so a mistyped number shows up at once) |
| The day before a visit | Reminder: when, where, what to bring (for the second visit, also the after-break screenshots) | Reminder |
| On the day, two hours before | | Reminder (texts go only 08:00 to 21:00 UK time; an earlier one goes at 08:00 if the visit is still at least 30 minutes away) |
| Days 7, 14, 21 and 28 | "Time for your weekly check-in" with the personal link (skipped if they checked in within three days) | Same |
| Day 30 | "Last day of your break": screenshots before unlocking, then the downloads | Same |

From a day before the second visit, the break-time messages stop: the
visit's own reminders say what to do (with a second visit 28 or 29 days on,
the day-28 check-in and the day-30 message are skipped).

What to bring, in every confirmation and reminder (`labBooking.bring`): the
phone, charged; clean, dry hair with no oils, gel, spray or conditioner (for
the EEG); glasses or contact lenses if worn; and to arrive 10 minutes early,
when the team meets them at the main entrance of the School of Psychology.

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
   [Twilio](https://www.twilio.com/sms/pricing/gb) (pay as you go, $0.056
   a text to a UK mobile in October 2026, no monthly fee with the
   **MyPhoneStdy** name as the sender). Each participant gets at most ten
   texts, all under 160 characters (one billed text each): the booking, the
   day before and the morning of each visit, four weekly check-in nudges
   and the last day of the break, plus one per change of times; for 120
   participants, about 1,200 to 1,400 texts, roughly $70 to $80:
   - create the account and note the account SID and auth token;
   - in Cloud Shell: `bash consent-app/firebase/scripts/set-sms-credentials.sh myphone-mybrain`;
   - the sender is **MyPhoneStdy** (the deploy workflow's default; to
     change it, set the repository variable **MPMB_SMS_FROM** under Settings
     → Secrets and variables → Actions → Variables): either a Twilio number
     (`+447…`) or a name of up to 11 letters and digits with no spaces or
     hyphens (UK networks show it instead of a number; people cannot reply
     to it, so the texts point to email);
   - redeploy the backend (Actions → Deploy Firebase backend → Run workflow);
   - on the staff page, **Check emails and texts arrive** → send a test to
     your own phone.

   Until the credentials are stored, the booking page does not offer texts
   at all, and nothing is texted.

   Cost: about ten texts per participant over the study (the booking
   confirmation, four visit reminders, four check-in nudges, the end of the
   break): roughly 40p a participant, about £40 for 100 participants. UK alternatives at similar prices include
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
  Mark **attended** or **missed** (a missed visit can be booked again;
  break-time messages stop), send the confirmation again (it lists the
  visits still to come), cancel one visit (with a reason for the
  participant, emailed with a calendar cancellation, or silently), and
  **Book someone in**, one visit at a time (for example a time arranged by
  email; if that visit is already booked it moves; the team is not held to
  the notice, the 28 to 35 days or the data check).
- **Participants**: everyone with consent, where they stand (files, visits,
  check-ins, stories), and one participant in detail: the messages sent,
  stopping or restarting their automatic messages, their **personal
  links** (below), and the **MyStory links for the lab computer** (before
  the break at the first visit, after it at the second).
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
| `/break/mystory/?phase=mid&code=MP…` | MyStory during the break (or the external survey, with the ID and phase passed on; see `mystory.md`) |
| `/break/mystory/?phase=pre\|post&at=lab&code=MP…` | MyStory at a lab visit, on the lab computer: nothing is kept on the computer, and **Finish** clears it for the next person |

The emails and texts use these links; the staff page lists them for each
participant with copy buttons. The page removes the ID from the address bar
as soon as it has read it, and asks the person to confirm it ("Your
participant ID: … Not mine: enter my details instead"). The participant ID is
not a password: the pages only ever let someone add to their record, see
counts of what was sent, and book; every booking change is emailed to the
participant and copied to the team, so misuse would be noticed.

## Coming back to change the visits

People can come back to `/break/book/` at any time, on any device, to change
or cancel their visits (up to 24 hours before each one). They sign in with
any of:

- the **personal link** in any email (one press to confirm the ID);
- their **participant ID**, typed ("Use my participant ID instead"). It is in
  every email. Case, spaces and dashes don't matter, the letters O,
  I and L are read as 0 and 1 (an ID never contains them), and a missing "MP"
  is added;
- the **four details** (first name, last name, date of birth, postcode),
  which make the same ID.

The change keeps the email address on file, so nothing needs typing again:
the page shows it masked ("We will email the new times to j•••@example.com,
the address you gave before", and the last three digits of the mobile
number for texts). "Use a different email address" asks for a new one; then
the confirmation goes to the new address, and the old address gets a short
email saying the address changed (without showing the new one), with the
visits as they stand and who to contact if it was not them. The team inbox is
copied on every confirmation as before.

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

In `src/lab/booking.ts`: the building and room (people are met at the main
entrance of the School of Psychology), the notice (24 hours) and the
cut-off for online changes (24 hours). The second visit's 28 to 35 days
may change later (`visit2AfterDays`). See `content-placeholders.md`.
