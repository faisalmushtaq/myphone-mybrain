# Staff portal

**myphonemybrain.com/portal/** (1 November 2026): one place for the project
manager, the research team and the research assistants. It has a section for
each study. The **school study** is built; the **lab study** links to the
existing staff page (`/staff/`, the shared staff key) until its tools move
here; the **online study** is a placeholder until it goes live.

## Signing in

Three ways, all matched to the same account by email address:

* **Email link** (Firebase Authentication, "Email link (passwordless
  sign-in)"): someone types their email, gets a one-time link, and opens it
  on the same device.
* **Google** (4 November 2026), for Google accounts.
* **A password** (4 November 2026): "Sign in with a password", with
  "Forgot your password?" (a reset email that brings them back to /portal/).
  Someone new can "Create an account with a password" (at least 10
  characters); Firebase then emails them to verify the address, and the
  portal stays closed ("Check your email to verify your address", with a
  button to send it again) until they have, because the server only accepts
  verified addresses. Anyone signed in by link or Google can set a password,
  or change it, under Your details. Firebase's errors are put in plain words
  (wrong password, too easy to guess, too many tries: wait, or use the link).

 The portal uses its own Firebase app
instance, so a portal sign-in never mixes with the anonymous sessions the
participant pages use in the same browser.

A new person signs in, then asks for an account (name, mobile, research
assistant or staff member). The account is **pending** until the project
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
| Settings (thresholds, document types, retention, status tags, jobs needed, always copy in), audit log | ✓ | | |
| Correct a checked document's details; a school's DBS page password, certificate copies for a school | ✓ | | |
| Status tags, experience, jobs, team notes, a person's name, phone and availability notes | ✓ | ✓ | only "Ready" or "On hold" |
| Mark attendance, reports, email a school, email the team | ✓ | ✓ | |
| Schools and their required forms, visits, training and pilots | ✓ | ✓ | |
| See availability, choose people, lock in and notify | ✓ | ✓ | |
| Book someone who is not ready, or for a job not theirs (with a recorded reason) | ✓ | | |
| Take someone off a confirmed place, some days or all (with a reason) | ✓ | | |
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
times, how many are needed for each job (below), travel and notes. Every day of the period is listed, weekends
switched off to start with; any day can be switched on or off and given its
own times, its own numbers for each job, and its own arrival and taxi
times. A one-day visit has the same first and last date. Visits saved
before then (one date and a meeting point) read as a period of one day.

**Jobs on the day (4 November 2026).** Each visit day needs people for two
jobs: **EEG** and **Co-production**, by default 6 and 2 a day (Settings),
changeable for a visit and for any day. A place is one person, one job, and
the days they are booked for (a person has one job on a visit). Places saved
before then read as EEG on every day the visit runs, and a visit's old
"number needed" as that many for EEG. Each person's jobs are set on their
page (by the team); a training session can be marked as training for one
job.

**Travel.** A visit can say when to be at the school, where and when the
taxi leaves (by default the School of Psychology, University of Leeds), and
a line for anyone going straight there; a day can have its own arrival and
taxi times. Travel shows in the research assistants' visits, the team's
email and the visit page.

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

**The week at a glance (5 November 2026).** The **Availability** tab (project
manager and research team) is a grid: one row per active research assistant
(the research team too, if ticked), one column per day of the week (Monday to
Friday; the weekend on request), with Previous / This week / Next week and a
"Go to the week of" date. Each cell says, in words as well as colour, what the
person said for that day (All day, Morning, Afternoon, Maybe, Can't, No
answer; answers to provisional dates count), any place they hold that day
("GSAL · EEG", "(offered)" until they confirm, with time notes such as "(until
1:00 pm)"), their own note, and a ⚠ when they could not be booked that day
(the reason on hover or tap: a document out of date, training or pilots
short). Each day's header lists the visits running (school, provisional or
draft, confirmed against needed for each job, highlighted when short on a
visit being staffed; tap one to open it) and how many research assistants are
free, how many of those can do EEG and co-production, and how many said maybe.
Filters: status tag, level, job, ready only, available only; sorted by name,
level or most available. On a phone it shows one day at a time (a toggle).
"Download this week (CSV)" saves what is shown. It comes from one call
(`availability-grid`), reading only that week's answers; team notes are never
part of it, and research assistants cannot call it.

**Staffing a visit.** The visit page shows **each day**: for EEG and for
co-production, how many are needed and how many are confirmed, with offers
still waiting shown apart, and who is on that day. It lists every active
research assistant, ready and available first and then by experience, with
their availability **day by day**, their status tags, experience and jobs.
**The strongest team is ticked for you** ("Suggest the strongest team" ticks
it again): the job fewer people can do is filled first, the most experienced
first (then those with fewer other jobs, more training and pilots, and more
days free), each on the days they are free, until each day has its numbers.
Change anyone's job or days, untick or add people, then **Lock in and
notify**: each gets an *offer* naming their job and days (notification, push,
email, and a text if they opted in), and confirms or declines it as a whole.
Someone who can only do a morning or an afternoon gets a time note ("morning
only"); the team can write its own ("until 1:00 pm"), shown in brackets after
their name. Confirming sends a confirmation email naming the job, with a
calendar invitation for their days (.ics), and tells the team; declining
tells the team (with an email) and frees the place. An offer still
unanswered after two days gets one reminder (portal, push and email). A
visit is **fully staffed** when every day has both numbers confirmed; no day
can be offered more people for a job than it needs. The project manager can
book someone not ready, or for a job not theirs, giving a reason.

**Once confirmed, research assistants can't cancel in the portal.** Their
visit shows "To withdraw, email {name} at {email}" with a ready-made email;
the contact is a setting (default Dr Sarmad Ali, S.A.Ali1@leeds.ac.uk). Only
the **project manager** can then remove them, from some of their days or all of them, giving a reason: they are
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
event per day it runs, with the place, who is confirmed that day for EEG and
for co-production (with the numbers), and the notes.

**Status tags, experience and notes (4 November 2026).** The team gives
people statuses (by default New, In training, Ready, On hold, Left; the
project manager adds, renames and retires them in Settings), an experience
level (1 New, 2 Developing, 3 Experienced, 4 Lead, with an optional reason)
and the jobs they do, and can correct their name, phone and availability
notes. People shows the tags and levels, with a filter by status. **Team
notes** are dated with who wrote them; the writer or the project manager can
delete one. None of this reaches research assistants: they see only "Ready"
or "On hold" if the team has said so, and the number of school days they
have attended. Every change is in the audit log.

**Attendance and reports.** After each visit day the team marks who
attended, was absent, was late or left early, with a note; the overview
reminds about days not yet marked. **Reports** shows, between two dates and
for one school or person if chosen, each person's days offered, confirmed,
attended and absent, hours and days by job, and each visit day's cover and
who came, with CSV downloads. A person's page shows the school days they
have attended.

**Emails to schools.** A school has a contact name, email addresses and
whether it wants DBS details. "Email the school" on a visit shows the email
before it goes: the days, times and place, and on each day the full names of
those confirmed (not their jobs), and the team's contact. The opening can be
edited, and is kept for that school. It goes to the school, copying the
sender, the withdrawal contact and the "Always copy in" addresses, with
replies to the sender; it is logged and audited, the visit shows when the
school was last told, and "Changes since the school was last told" offers an
update. **DBS details never go in an email.** With DBS details on, the email
links to the school's own DBS page instead.

**A school's DBS page** (myphonemybrain.com/schools/dbs/?school=<slug>, not
listed or indexed; the `schoolDbs` function, `schoolDbs.ts`). The project
manager makes a password for the school on Schools (shown once, given to the
school by phone; scrypt-hashed in `schoolDbsAccess/{slug}`, apart from the
class-list password), can make a new one or close access, and sees when it
was last viewed. Behind the password the school sees its visits coming up
(and those in the last 30 days) by date: each confirmed person's name, DBS
certificate number, issue date, that it is enhanced, and Update Service yes
or no, **only as the project manager checked them**; anyone not yet checked
shows as "DBS being checked". Copies of certificates only if the project
manager allows them for that school (off by default), as five-minute links.
Wrong passwords are limited (10 per browser and 25 per school an hour);
every view and every copy opened is in the audit log. The research team
cannot see DBS numbers or make passwords. When the email says DBS details
are on and the school has no password yet, the preview warns, with a link
for the project manager.

**The team's allocations email.** "Email the team" on a visit (or, on
Visits, for a school between two dates) makes the email from the portal:
subject ("{school} team allocations: 23–24 November"), opening (an update
says so when allocations changed), each day with the full names of those
confirmed and any time notes (jobs hidden unless shown), travel
arrangements, a DBS and ID check reminder for anyone whose first day at that
school falls in those dates, and a closing signed with the sender's first
name. Every part can be edited; the opening and closing can be kept as the
sender's own. It goes to those confirmed (and the research team if ticked),
as one email with everyone in blind copy or one each, with replies to the
sender, in plain text and simple HTML; each person also gets a notification
and push ("Team allocations for {school} {dates} have been sent"). Sends are
logged; the visit shows when the team was last told and flags changes since.

**Who emails come from, and who is copied in (5 November 2026).** Every
portal email comes from the study's own email account (the sender in
`mail.ts`, `MPMB_SMTP_USER`), shown as "MyPhone/MyBrain team", with replies
to the person who sent it where a person did. Every portal email to anyone
else is copied to the **Always copy in** addresses (a project manager
setting; by default brainpop@leeds.ac.uk and S.A.Ali1@leeds.ac.uk), never
twice and not on an email only to them. Emails to many people go as one email
(people in blind copy, these addresses copied once): new dates, and the team
email sent as one; the team email sent one each gets a single copy for them.
The sign-in link emails come from Firebase Authentication and are not
copied.

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

## Training and pilots logged by research assistants (4 November 2026)

Research assistants log their own training and pilots on their Training
tab: "I was there" for a session the team already recorded, or "Add a
session you attended" (training or pilot, a date that is not in the future,
what it was, optionally the job it trained for, who ran it and a note). Each
entry waits for the team (`portalTrainingClaims`) and **does not count**
towards being ready for visits until the project manager or a research team
member confirms it; the person and the team see "n waiting" beside the
confirmed counts.

The team confirms on Training and pilots ("To confirm", with a count on the
overview), one at a time or by ticking several. A new session the assistant
described is either added to a session already recorded on the same date and
of the same kind (the closest title is suggested) or recorded as a new
session. Declining needs a short reason; the person sees it in the portal,
with a push and an email. Confirming tells them in the portal. An assistant
can delete an entry while it is waiting, can only log for themselves, and
never sees anyone else's. Every log, confirmation and decline is in the audit
log.

## Research leads, sign-off, DBS status, school approvals (5 November 2026)

**Documents per school.** The documents in Settings ("Documents everyone
needs") are needed for every school; each school can add its own under
Schools ("Documents only this school asks for"). Someone can go to a
school's visits once they have both. The health form is now GSAL's own: on
the first call after this release the portal took it off everyone's list,
added it to GSAL's (keeping its id, so uploads already made still count),
filed the uploads already made under GSAL, and recorded that in the audit
log (`move-health-form`) and in `portalSettings/migrations`, so it never runs
again. Research assistants see a school's documents under "Only if you go to
{school}".

**Research leads.** A third job on the day, "Lead", taken by the research
team (project managers and researchers), two a day by default (Settings →
Jobs on the day), changeable per visit and per day like the other jobs.
Coverage shows "Leads x/2", and a visit is fully staffed only when leads are
too. On a visit page the team are listed as lead candidates; they need their
documents but not training or pilots. A lead is booked straight away (no
offer to answer): they get a notification, an email and a calendar
invitation (`book-lead` in the audit log). The team mark the days they could
lead under **My days**, and upload their documents under **My documents**.

**Training sign-off.** Not trained / Will assess in pilot / Signed off, set
by the team on a person's page (recorded with who and when). Booking needs
it only if the project manager ticks "Require training sign-off to be
booked" (off by default).

**DBS status.** Confirmed (checked and in date), Processing (uploaded and
waiting to be checked, or the person ticked "I've applied for my DBS", with
the date if they gave one), Starting process, or Expired. Shown on People,
on each person, on visit candidates, and in the sheet.

**Approved by school.** The project manager records who a school approved
(Schools → "Who this school approved", several at once; with the date and
who recorded it), or takes it off. A school can be set to "Only book people
this school has approved" (off by default); then anyone not approved shows
as not ready for its visits ("Not yet approved by …").

## The Google Sheet (5 November 2026)

The portal rewrites one Google Sheet every hour (twenty past;
`portalSheetSync`), and when the project manager presses **Sync now** in
Settings. Tabs, in order:

1. **Overview**: last synced, a link to the portal, counts, the next six
   weeks of visit days (EEG, Co-pro and Leads confirmed/needed, offers
   waiting, "Short by" in red or green), and what needs attention (days
   short, offers unanswered for over two days, people booked whose DBS is
   not confirmed, attendance not marked).
2. **{School} sessions** for each school with visit days from four weeks
   back to twelve ahead: research assistants then research leads, with
   level, jobs, DBS status, sign-off, approval, then one column per visit
   day (confirmed dark teal, offered amber, available light green, maybe
   pale yellow, can't grey), days available and booked; names in red when
   not ready (the note says why); totals per day and "Fully staffed".
3. **{School} allocations**: a block per week, Monday to Friday, names by
   job (offered in italics, red when their DBS is not confirmed, "needed"
   for an empty place), a status line per day, and who the school approved.
4. Tables: People, Documents, Availability (four weeks back, twelve ahead),
   Visits, Staffing, Coverage, Attendance, Training and pilots, Report — per
   person, Emails sent, Audit log (the latest 5,000), and Notes only when
   "Include team notes" is ticked.

The portal's tabs are cleared and rewritten (with their formatting) each
time; any other tab in the spreadsheet is left alone. **Never in the sheet:**
DBS certificate numbers, copies of any document, the text of emails and
texts, passwords; the team's notes only when the project manager turns them
on. A failed sync never affects the portal: Settings shows the last sync and
the last error in words (not shared, Sheets API off, wrong address).

**Setting it up (once):**

1. Make a Google Sheet.
2. Share it, as **Editor**, with the functions' service account,
   `<project number>-compute@developer.gserviceaccount.com` (Settings shows
   the exact address, with a Copy button).
3. Turn on the Google Sheets API:
   https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=myphone-mybrain
4. Paste the sheet's address in Settings → Google Sheet, Save, Sync now.

**DPIA note (5 November 2026):** the sheet holds staff personal data (names,
emails, phones, availability, DBS *status*, training, attendance, the audit
log) in Google Workspace, shared with whoever the project manager shares
the spreadsheet with. It holds no certificate numbers and no copies. Anyone
it is shared with sees all of it, so share it only with the research team.
The same tables are written to the export bucket (below).

## In the export (5 November 2026)

The hourly export writes `staff-portal/` beside the studies:
`tables/` (the sheet's tables as CSV and TSV, `data_dictionary.md`, with the
same exclusions) and `documents/<person>/<document>_<date>.<ext>` (a copy of
each document the portal still holds, DBS certificates included; deleted
there when the portal deletes them). On the Mac, a destination with scope
`all` (the University's OneDrive) gets all of it; scope `no-documents` (for
Google Drive) gets the tables without `documents/`; `bids` gets none of it.
See docs/firebase.md.

## Data kept, and for how long

| Collection | What |
| --- | --- |
| `portalUsers` | name, email, mobile, role, status, text-message preference, training sign-off (who, when), "I've applied for my DBS" (and the date), schools that approved them (when, who recorded it) |
| `portalDocs` | each upload: whose, which document, the file's place in Storage, its check and details |
| `portal/docs/{uid}/…` (Storage) | the document copies |
| `portalSessions`, `portalAvailability`, `portalInterest` | training and pilots, availability, interest in visits |
| `portalSchools`, `portalVisits`, `portalAssignments` | schools and their forms, visits, offers and answers |
| `portalNotifications`, `portalMail`, `portalAudit`, `portalWarnings` | notifications, emails and texts sent, the audit log, expiry warnings already sent |
| `portalSettings/main` | thresholds, document types, retention, status tags, jobs needed, always copy in, whether sign-off is required |
| `portalSettings/sheet`, `portalSettings/migrations` | the Google Sheet's address, whether team notes go in it, the last sync and error; one-off changes made |
| `portalNotes` | the team's notes about people (who, when) |
| `portalAttendance` | attendance per person per visit day, with notes |
| `portalSchoolEmails`, `portalTeamEmails` | emails sent to schools and to the team: when, by whom, to whom, who was on each day |
| `schoolDbsAccess/{slug}` | each school's DBS page password (hashed), when made, last viewed |

**Copies are kept while someone works on the study.** Once they are
archived, `portalHousekeeping` (every day at 06:30, UK time) deletes their
copies after the retention period (default **183 days**, a setting); the
record that a document was checked, and its details, stay. The same job
warns people (and the project manager) when a checked document runs out
within the warning window (default 30 days). DBS certificates and health
forms are criminal-record and health data: the DPIA should list the portal
and this retention. **DPIA note (4 November 2026):** DBS details (name,
certificate number, issue date, enhanced, Update Service) are shared with a
school, on its request, only for the people coming to its visits, only as
the project manager checked them, and only through the school's
password-protected page (never by email), with every view recorded;
certificate copies only where the project manager allows it for that school.
Team notes, status tags and experience levels are personal data about staff:
they are seen only by the research team and kept while the person works on
the study.

Also kept (3 November 2026): answers to provisional dates
(`portalCanvass`, with the person's availability for those days), push
subscriptions per device (`portalPushSubs`; just the push service's address
and keys, removed when the person turns notifications off or the service
says the device is gone) and each person's notification choices.

## Setting it up (once)

1. **Firebase console → Authentication → Sign-in method → Email/Password:
   switch on both the main "Email/Password" toggle (for passwords) and
   "Email link (passwordless sign-in)".** Google sign-in is also enabled (4 November 2026): the sign-in page offers "Sign in with Google" for Google accounts; the account is matched by email, as with the link.
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
under Authentication → Templates. They can be slow, and University mail
sometimes puts them in Junk or Quarantine, which is why the sign-in page puts
the password first, Google second and the email link last, and the "check
your email" screens say where to look. **Optional fix for delivery**:
Authentication → Templates → SMTP settings → send the sign-in, verification
and password-reset emails through the study's Gmail (host smtp.gmail.com,
port 465, security SSL, the account brainpopresearch@gmail.com and its app
password).

## Testing

`node scripts/portal-e2e.mjs` runs the whole journey against the emulators:
a project manager, a researcher and a research assistant sign in by email
link; approval; upload and check; training and pilots; availability; a
visit over several days (a day off, a day with its own times); provisional
dates, the answers and the team's summary, then confirming them; staffing
with availability day by day; lock-in; confirmation; the assistant unable to
cancel and the team unable to remove; calendar files; a change of place; the
project manager removing them; notification choices; the team's tags,
experience, jobs and notes; a two-day visit with ten research assistants
(the strongest team suggested and ticked, lock-in, confirmations, each day's
cover, fully staffed, the team calendar by job); notes and tags never
reaching research assistants; the team's allocations email (time notes, one
email in blind copy, copied in once) and a change flagged afterwards; taking
someone off one day; the school email (names, no DBS numbers, the warning
with no password, who is copied); the school's DBS page (wrong password,
the details, no copies, the limit on wrong passwords, closing access, every
view audited); attendance, the reminder, the report and its CSV; the
emails, notifications and audit log; what each role must not be able to do (the team opening copies,
assistants seeing others, direct reads of records and files, anonymous
sessions); and retention. Screenshots go to `portal-shots/`.
In the emulator no push is sent: each is written to `portalPushLog`, which
the test checks. Unit tests: `firebase/functions/src/portalCore.test.ts`,
`portalRoles.test.ts` (jobs, coverage, the strongest team, migration, tags
and notes hidden, attendance, reports, school and team emails, the DBS page,
always copy in) and `push.test.ts`.
