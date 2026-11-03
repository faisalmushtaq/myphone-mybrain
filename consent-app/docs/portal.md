# Staff portal

**myphonemybrain.com/portal/** (1 November 2026): one place for the project
manager, the research team and the research assistants. It has a section for
each study. The **school study** is built; the **lab study** links to the
existing staff page (`/staff/`, the shared staff key) until its tools move
here; the **online study** is a placeholder until it goes live.

## Signing in

Email link, no passwords (Firebase Authentication, "Email link
(passwordless sign-in)"). Someone types their email, gets a one-time link,
and opens it on the same device. The portal uses its own Firebase app
instance, so a portal sign-in never mixes with the anonymous sessions the
participant pages use in the same browser.

A new person signs in, then asks for an account (name, mobile, research
assistant or research team). The account is **pending** until the project
manager approves it and sets the role; the project manager gets a
notification and an email for each request, and the person an email when
approved. Accounts can later be **archived** (no sign-in; copies deleted
after the retention period) and restored.

## Roles

| | Project manager (`pm`) | Research team (`researcher`) | Research assistant (`ra`) |
| --- | --- | --- | --- |
| Approve accounts, change roles, archive | ✓ | | |
| Open document copies, check (accept or reject) documents | ✓ | | own copies only |
| See where each person's documents stand | ✓ (with certificate details) | ✓ (status only) | own |
| Settings (thresholds, document types, retention), audit log | ✓ | | |
| Schools and their required forms, visits, training and pilots | ✓ | ✓ | |
| See availability, choose people, lock in and notify | ✓ | ✓ | |
| Book someone who is not ready (with a recorded reason) | ✓ | | |
| Own details, documents, availability, interest in visits | ✓ | ✓ | ✓ |
| Answer offers (confirm or decline), see own visits | | | ✓ |

Roles are stored in `portalUsers/{uid}` (the source of truth, read on every
call) and mirrored to the sign-in token as the `portalRole` custom claim
(Storage rules use it to let people upload). Study roles that already exist
(`roles`: coordinator, researcher, auditor) are kept as they are.

## How it works

Everything goes through one callable function, **`portalApi`**
(`firebase/functions/src/portal.ts`), which checks the caller's account and
role on every call; the rules in `portalCore.ts` (`mayDo`) say which role may
do what. Firestore rules give browsers no access to any `portal*`
collection, and Storage rules let a person only *upload* into their own
folder (`portal/docs/{uid}/`, PDF/JPG/PNG up to 15 MB); nobody reads a copy
directly: `document-url` returns a five-minute link, to the owner or the
project manager only, and each opening is recorded in the audit log.

**Documents.** Everyone needs the types in Settings (by default: enhanced
DBS certificate, health form, safeguarding training certificate). A school
can add its own forms (Schools tab). Each upload is *waiting to be checked*
until the project manager opens it and accepts it (recording, for a DBS,
the certificate number, issue date, Update Service and any recheck date;
for an expiring document, its expiry date) or rejects it with a note saying
what to send instead. States: not uploaded, waiting to be checked, checked,
not accepted, runs out soon, out of date. A DBS without the Update Service
counts for three years from issue unless a recheck date is recorded (a
setting).

**Ready for a visit** means, on every day the visit runs (so in date on its last day): every required
document (the school's too) checked and in date, at least the set number of
training sessions (default 2) and pilots (default 1). The team sees the
reasons for anyone who is not ready.

**Training and pilots.** The team records each session (training or pilot,
date, title, who attended); each person's counts follow.

**Availability.** Research assistants tap days on a month calendar: all
day, morning (until 12:30), afternoon (from 12:00), not available, or blank;
they can also mark interest in upcoming visits.

**Visits over several days (3 November 2026).** The team enters a visit as a
period: school, **where** (required: the address, room or meeting point; the
school's name is put in front), first and last date, usual start and end
times, number needed and notes. Every day of the period is listed, weekends
switched off to start with; any day can be switched on or off and given its
own times. A one-day visit has the same first and last date. Visits saved
before then (one date and a meeting point) read as a period of one day.
Selection is for the whole visit: a confirmed research assistant is booked
for every day it runs.

**Statuses.** Draft (the team's own), **Provisional** (dates not yet agreed
with the school, put out to ask who could do them), Staffing, Fully staffed,
Done, Cancelled.

**Provisional dates.** Setting a visit to Provisional tells every active
research assistant (in the portal, and by push and email as they choose):
"Possible school dates (not yet confirmed): {school}, {dates}. Tell us if
you could do them." They see it on the Offers tab, marked *Provisional — not
confirmed*, and answer day by day: can do, maybe or can't do. Each answer
is also kept as their availability for that day (all day, maybe, not
available), linked to the visit. The visit page shows the team, per day, how
many and who can, might, can't, and haven't answered. No places can be
offered while dates are provisional. Changing the days or times while
provisional tells everyone who answered and clears their answers for days
that changed. Moving it on to **Staffing** tells those who said they could
(or might) do it that the dates are confirmed (always by push and email),
and everyone else that there are new dates; their answers stay as
availability for staffing. Cancelling it tells everyone who answered that
the dates won't go ahead.

**Staffing a visit.** The visit page lists every active research assistant,
ready and available first, with their availability **day by day** across the
visit (available every day, some days, not available, or not given) and
whether they asked for it. The team ticks people and presses **Lock in and
notify**: each gets an *offer* (notification, push, email, and a text if they
opted in) for every day, and confirms or declines in the portal. Confirming
sends a confirmation email with a calendar invitation holding every day
(.ics) and tells the team; declining tells the team (with an email) and frees
the place. An offer still unanswered after two days gets one reminder
(portal, push and email). A visit is *fully staffed* once every place is
confirmed; no more places can be offered than it needs.

**Once confirmed, research assistants can't cancel in the portal.** Their
visit shows "To withdraw, email {name} at {email}" with a ready-made email;
the contact is a setting (default Dr Sarmad Ali, S.A.Ali1@leeds.ac.uk). Only
the **project manager** can then remove them, giving a reason: they are
notified, pushed (without the reason) and emailed (with it, and a calendar
cancellation), the team is told, the place opens again, and it is in the
audit log. The research team can still withdraw an offer that hasn't been
answered.

**Changes after confirming.** If the days, times or place of a visit change,
everyone confirmed is notified, pushed and emailed the new details with an
updated calendar invitation (and a cancellation for days no longer needed).
Days added to a visit that is already open are announced to every research
assistant as new dates.

**Calendars.** The team can download a calendar file (.ics) for one visit
(Add to my calendar) or for every visit coming up (on the Visits tab): one
event per day it runs, with the place, who is confirmed, and the notes.

**Notifications.** An in-portal list (the bell, with the unread count),
plus email for: account requests (to the project manager), approval,
offers, reminders, confirmations, declines (to the team), changes, removals,
new and provisional dates, and documents running out. Every email and text
is recorded in `portalMail` with whether it went.

**Push notifications (3 November 2026).** The portal can be saved to the
Home Screen (it has a web app manifest, `/portal/manifest.webmanifest`, and a
service worker, `/portal/sw.js`, which only shows notifications and opens
the portal at the right screen; it caches nothing). Research assistants see
how to do this on their checklist and in Your details:

- **iPhone/iPad**: Safari → Share → Add to Home Screen. Notifications only
  work from the Home Screen icon, on iOS 16.4 or later.
- **Android**: Chrome → menu → Add to Home screen / Install app.
  Notifications also work in the browser.
- **Computers**: notifications work in the browser.

Each person turns notifications on per device in Your details (the browser
asks permission only then), and can send themselves a test. They are sent
for new and provisional dates (and those dates confirmed, changed or
cancelled), offers and reminders, changes to a confirmed visit, removal,
documents checked or not accepted, and the account being approved. A push
carries only the school and the dates, never anything personal. Each
person can switch push and email off for *new dates* in Your details;
offers, changes, removals and dates they have answered about always come.
Subscriptions are kept in `portalPushSubs/{uid}/subs/{id}` and deleted when
the push service says they are gone (404 or 410).

**Audit log.** Every request, approval, role change, archive, upload,
check, opening of a copy, session, visit, offer, override, answer and
automatic deletion is in `portalAudit` (who, when, what), and on the Audit
log tab for the project manager.

## Data kept, and for how long

| Collection | What |
| --- | --- |
| `portalUsers` | name, email, mobile, role, status, text-message preference |
| `portalDocs` | each upload: whose, which document, the file's place in Storage, its check and details |
| `portal/docs/{uid}/…` (Storage) | the document copies |
| `portalSessions`, `portalAvailability`, `portalInterest` | training and pilots, availability, interest in visits |
| `portalSchools`, `portalVisits`, `portalAssignments` | schools and their forms, visits, offers and answers |
| `portalNotifications`, `portalMail`, `portalAudit`, `portalWarnings` | notifications, emails and texts sent, the audit log, expiry warnings already sent |
| `portalSettings/main` | thresholds, document types, retention |

**Copies are kept while someone works on the study.** Once they are
archived, `portalHousekeeping` (every day at 06:30, UK time) deletes their
copies after the retention period (default **183 days**, a setting); the
record that a document was checked, and its details, stay. The same job
warns people (and the project manager) when a checked document runs out
within the warning window (default 30 days). DBS certificates and health
forms are criminal-record and health data: the DPIA should list the portal
and this retention.

Also kept (3 November 2026): answers to provisional dates
(`portalCanvass`, with the person's availability for those days), push
subscriptions per device (`portalPushSubs`; just the push service's address
and keys, removed when the person turns notifications off or the service
says the device is gone) and each person's notification choices.

## Setting it up (once)

1. **Firebase console → Authentication → Sign-in method → Email/Password →
   enable "Email link (passwordless sign-in)".**
2. **Authentication → Settings → Authorised domains**: make sure
   `myphonemybrain.com` is listed (it is for the participant pages).
3. **The first project manager**, in Cloud Shell from the repository:
   `npm --prefix consent-app/firebase/functions ci && node consent-app/firebase/scripts/set-portal-admin.mjs <project-id> <email> "Full name"`. The first two (Sarmad Ali and Faisal Mushtaq), and the service account permission for document links, are set by `consent-app/firebase/scripts/portal-first-admins.sh`, pasted into Cloud Shell (https://shell.cloud.google.com/?project=myphone-mybrain); it needs nothing from this repository.
   They then sign in at /portal/ with the emailed link. Run it again for
   another project manager, or approve them in the portal.
4. **Push notifications** (optional; without them emails still go):
   in Cloud Shell, `bash consent-app/firebase/scripts/set-push-keys.sh myphone-mybrain`.
   It makes the VAPID keys, stores the private one in Secret Manager
   (`mpmb-push-private-key`) and prints the public one: set it as the GitHub
   repository variable **`MPMB_PUSH_PUBLIC_KEY`** (Settings → Secrets and
   variables → Actions → Variables). The next deploy switches push on.
5. **Deploy** as usual (push to main): the function `portalApi`, the daily
   `portalHousekeeping`, the new Firestore indexes and the rules go with it.
   Emails use the study's mailbox settings (docs/firebase.md); texts are
   only sent to people who ask for them.

The sign-in emails themselves come from Firebase Authentication
(noreply@*project*.firebaseapp.com); their wording and sender can be changed
under Authentication → Templates.

## Testing

`node scripts/portal-e2e.mjs` runs the whole journey against the emulators:
a project manager, a researcher and a research assistant sign in by email
link; approval; upload and check; training and pilots; availability; a
visit over several days (a day off, a day with its own times); provisional
dates, the answers and the team's summary, then confirming them; staffing
with availability day by day; lock-in; confirmation; the assistant unable to
cancel and the team unable to remove; calendar files; a change of place; the
project manager removing them; notification choices; the emails, notifications and audit
log; what each role must not be able to do (the team opening copies,
assistants seeing others, direct reads of records and files, anonymous
sessions); and retention. Screenshots go to `portal-shots/`.
In the emulator no push is sent: each is written to `portalPushLog`, which
the test checks. Unit tests: `firebase/functions/src/portalCore.test.ts` and
`push.test.ts`.
