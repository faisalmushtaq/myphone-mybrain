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

**Ready for a visit** means, on the visit's own date: every required
document (the school's too) checked and in date, at least the set number of
training sessions (default 2) and pilots (default 1). The team sees the
reasons for anyone who is not ready.

**Training and pilots.** The team records each session (training or pilot,
date, title, who attended); each person's counts follow.

**Availability.** Research assistants tap days on a month calendar: all
day, morning (until 12:30), afternoon (from 12:00), not available, or blank;
they can also mark interest in upcoming visits.

**Staffing a visit.** A visit has a school, date, times, meeting point,
number needed, notes and a status (draft, staffing, fully staffed, done,
cancelled). Its page lists every active research assistant, ready and
available first, with their availability that day and whether they asked
for it. The team ticks people and presses **Lock in and notify**: each gets
an *offer* (notification, email, and a text if they opted in), and
confirms or declines in the portal. Confirming sends a confirmation email
with a calendar invitation (.ics) and tells the team; declining tells the
team (with an email) and frees the place. A visit is *fully staffed* once
every place is confirmed. The team can withdraw a place, and offer it to
someone else. No more places can be offered than the visit needs.

**Notifications.** An in-portal list (the bell, with the unread count),
plus email for: account requests (to the project manager), approval,
offers, confirmations, declines (to the team), and documents running out.
Every email and text is recorded in `portalMail` with whether it went.

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

## Setting it up (once)

1. **Firebase console → Authentication → Sign-in method → Email/Password →
   enable "Email link (passwordless sign-in)".**
2. **Authentication → Settings → Authorised domains**: make sure
   `myphonemybrain.com` is listed (it is for the participant pages).
3. **The first project manager**, in Cloud Shell from the repository:
   `npm --prefix consent-app/firebase/functions ci && node consent-app/firebase/scripts/set-portal-admin.mjs <project-id> <email> "Full name"`.
   They then sign in at /portal/ with the emailed link. Run it again for
   another project manager, or approve them in the portal.
4. **Deploy** as usual (push to main): the function `portalApi`, the daily
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
visit; staffing; lock-in; confirmation; the emails, notifications and audit
log; what each role must not be able to do (the team opening copies,
assistants seeing others, direct reads of records and files, anonymous
sessions); and retention. Screenshots go to `portal-shots/`.
Unit tests: `firebase/functions/src/portalCore.test.ts`.
