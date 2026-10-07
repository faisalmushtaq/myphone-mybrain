# Architecture

## What is built now

A front end (React + TypeScript, built with Vite) that mounts inside the
existing Jekyll site at `/take-part/consent/`, with the complete user
journey, validation, consent data model and an **API abstraction** with two
implementations: an in-memory mock (preview builds only; nothing leaves the
page, latency and failures are simulated) and Firebase (`docs/firebase.md`,
what the live site uses). Since 7 October 2026 the form is the **opt-in for
screen time** (the workshop at school is opt-out, by email: `docs/journey.md`,
`docs/opt-outs.md`). Two things are sent, at different moments: the record
(the parent's permission and answers, and the young person's agreement when
they are asked) as soon as it is complete (and again as an amendment when
something is changed), and the screenshots when their send button is
pressed.

```
consent-app/
├── src/
│   ├── config/        wording, statements, fields, schools, walkthroughs (edit these, not the components)
│   ├── model/         TypeScript types for the data model and the journey engine
│   ├── state/         reducer, React context, session persistence
│   ├── lib/           validation, dates, image processing (redaction/crop), ids
│   ├── api/           ConsentApi interface + MockConsentApi
│   ├── components/    reusable UI (progress nav, signature pad, image capture…)
│   └── steps/         one component per journey step
│   ├── lab/           the social media break study (adults): config, cleaner, state, steps (see below)
│   └── lab.tsx        its entry point, mounted at /break/take-part/ (lab.html in development)
├── docs/              this folder
└── scripts/           build helpers
```

### The social media break study

A second, separate flow for adults in the laboratory study shares the UI
components, the API client and the stylesheet but has its own state, steps
and backend functions (`src/lab/`, `firebase/functions/src/lab.ts`). There is
no handover and no reference code: the participant is known by a participant
ID built from their first name, last name, date of birth and postcode (a hash,
such as `MP2670FF90A5F2`; the recipe is in `docs/participant-id.md` and
`src/lab/config.ts`, and the postcode must be a full UK postcode). The survey
platform builds the same ID from the same four details, so the questionnaires,
the laboratory data and the donations meet without a name.

The study has three pages for its data, plus a booking page and MyStory's own page (below), each its own short flow in the same bundle,
chosen by the mount's `data-flow` (or `?flow=` on the plain test page), and
every send is filed under the phase of the page it came from, so nobody is
asked whether their files are from before or after the break:

* **`/break/take-part/`** (`baseline`, phase `pre`): welcome → participant
  code → information (the approved sheet, section by section) → consent
  (eight required statements, an optional record-linkage choice, name,
  signature, sent at once) → screenshots (the phone's own steps, then the
  screenshots are sent straight away, so the first donation is done in
  minutes) → guide (request TikTok, YouTube or Instagram data, which takes
  days; linkable with `?step=guide`; "I'll come back later" can email the
  person their progress and book one follow-up) → clean → send → done.
* **`/break/check-in/`** (`checkin`, phase `mid`), during the break: the
  code → a few questions (`labCheckInForm`) with an optional screenshot of
  the week's screen time → MyStory (optional, "Skip this time") → thanks.
  Repeatable each week.
* **`/break/book/`** (`book`): the two lab visits. The first opens once the
  screenshots and one app's cleaned data from before the break have arrived;
  the second once the first is booked, in the days that end the break.
  Times by day, an email address (and a UK mobile for texts), then a
  confirmation with a calendar file; change or cancel up to 24 hours before.
  The same step opens from the other pages' summaries. See `docs/booking.md`.
* **`/break/mystory/?phase=pre|mid|post`** (`story`): MyStory on its own,
  for a personal link. Each phase has its own prompts and signifiers
  (`src/lab/mystory.ts`); any phase can use another survey (MySelf) instead,
  linked or embedded with the participant ID. See `docs/mystory.md`.
* **`/break/after/`** (`after`, phase `post`), when the break ends: the code
  → a reminder of what was agreed and how to withdraw (consent is not taken
  again) → screenshots → guide → clean → send → done.

App data is tracked app by app: the guide, the clean and send steps and
the thank-you page show TikTok, YouTube and Instagram as a checklist. An app
is ticked off once its cleaned data has been sent in this phase, shows as
ready when a file is prepared on the device, and otherwise stays
outstanding until the person sends it or presses "I don't use it", which
greys it out (and can be undone). That answer is kept on the server
(`updateLabPlatforms`, `platformsNotUsed` on the participant row) and
carries over to the after-break page; a page counts as finished only when
every app is sent or set aside.

People carry on where they left off. Each page keeps its progress in
`localStorage` for 60 days (`mpmb-lab:v1`, `mpmb-lab-checkin:v1`,
`mpmb-lab-after:v1`), and the confirmed code is remembered separately
(`mpmb-lab-code:v1`) so the later pages fill it in. On any other device the
person enters the same four details, which give the same ID, and
`lookupLabParticipant` returns what has arrived for each phase, so the page
opens at the next thing still to do. Progress emails link to
`…?code=MP2670FF90A5F2`, which fills the ID in and removes it from the address
bar. Progress saved on a device belongs to the ID it was confirmed for:
confirming a different ID there starts afresh, and progress saved under the
old code scheme is dropped.

Everything after the first visit runs by itself: confirmations, reminders
the day before and on the day, weekly check-in nudges, a nudge to book the
second visit and the end-of-break message go by email and, for people who
asked, by text (`labMessages`, every 15 minutes; `docs/booking.md`). Every
page opens ready for one participant from a personal link
(`?code=MP…`), which the emails, the texts and the staff page use.

A third bundle, `tools-app.js`, serves two pages that are not for
participants: the research team's staff page (`/break/staff/`, behind a staff
key: lab times, bookings, participants and their links, the schools' upload
passwords) and each school's upload page for its UPN lists
(`/schools/upload/?school=<slug>`, behind a password per school; see
`docs/school-uploads.md`). Their code is in `src/tools/` and
`firebase/functions/src/staff.ts`, `schoolUpload.ts`.

Cleaning happens entirely on the device (`src/lab/cleaner.ts`, ported from
the lab team's single-file tool and unit-tested with Vitest): the ZIP is read
with JSZip, TikTok JSON, Google Takeout JSON or HTML and Instagram JSON are
reduced to dates, links and search words, the participant unticks categories, a preview shows
what would leave, and a new ZIP holding only `manifest.json`,
`tiktok_cleaned.json`, the three YouTube files and the four Instagram files is built. The server
(`submitLabDonation`) opens every archive and refuses anything that is not
exactly that set of file names with the cleaner's manifest, so a raw
download can never be stored by mistake.

## Data model (see `src/model/types.ts`)

The model deliberately separates three kinds of information:

| Object | Contains | Purpose |
|---|---|---|
| `ParticipantIdentity` | child's names, date of birth, school, year group, postcode | Matching the participant within the study and (with consent) with external records. **Identifying.** |
| `GuardianIdentity` | parent's name, relationship, parental-responsibility declaration, email, phone | Establishing who gave consent and how to reach them. **Identifying.** |
| `ConsentRecord` / `AssentRecord` | form id + version, every statement with its version and response, typed name, signature (PNG + stroke metadata + method), confirmed date, device timestamp, study/site/school identifiers | The audit record of what was agreed, by whom, and when. |
| `SurveyRecord` | the parent's answers to five one-tap questions about the young person's phone use, each with the question version and time; status completed, skipped or in progress | **Research data**, optional and separate from consent; stored with the participant id only. |
| `PhoneUseDonation` | platform, list of uploaded image references (server upload ids, dimensions, whether redacted), status | **Research data.** Never stored alongside identity in the browser; linked server-side by participant id. |

The submission payload sends these as separate top-level objects so the server
can store identity in a restricted table and research data in the research
store, joined only by a study identifier.

## API contract (see `src/api/types.ts`)

```
startSession()                              → { sessionId, csrfToken, expiresAt }
submitConsent(session, payload)             → { referenceCode, participantId, receivedAt, version }
                                              payload.referenceCode set → an amendment (version 2, 3…)
requestUploadSlot(sessionId, {type, size})  → { uploadId, url, method, headers, expiresAt }
uploadImage(slot, blob, onProgress)         → void            (direct-to-storage)
deleteUpload(sessionId, uploadId)           → void
submitDonation(session, payload)            → { donationId, receivedAt, accepted[], rejected[{uploadId, reason}] }
```

`MockConsentApi` implements the same interface in memory with a 400–1200 ms
delay and two failure toggles (upload, submit) exposed in the on-screen
"Prototype controls" panel.

## The backend that is built: Firebase

`docs/firebase.md` describes the implemented backend: anonymous Firebase
Authentication for the session, Cloud Storage for uploads (browser writes
into its own quarantine folder only), two callable Cloud Functions that
validate everything again, check and clean the images, and write separated
Firestore collections, and security rules that give browsers no read access
at all. The section
below is the general architecture it implements; where the two differ, the
Firebase document is current.

## Proposed production architecture

This is a proposal to be agreed with University of Leeds IT, the data
protection team and the ethics committee. It describes mechanisms, not
compliance claims.

### Hosting
* With Firebase, sessions are bearer tokens rather than cookies, so the
  consent page can stay on GitHub Pages with the marketing site. (A
  cookie-based API would need the page and the API on the same registrable
  domain, because GitHub Pages cannot set security headers and browsers block
  cross-site cookies.)
* HTTPS only with HSTS; `Referrer-Policy: no-referrer`; `X-Frame-Options`
  / `frame-ancestors 'none'`.
* Content-Security-Policy: `default-src 'self'; img-src 'self' blob: data:;
  connect-src 'self' <upload bucket>; style-src 'self'; font-src 'self'` —
  blob/data are needed for previews and the signature. Self-host the three
  font families so the consent page makes no request to Google.
* No analytics or third-party scripts.

### Sessions and CSRF
* `POST /api/sessions` creates a short-lived session (2 hours) and returns a
  CSRF token bound to it. Because front end and API share a domain, the
  session id is an `HttpOnly; Secure; SameSite=Strict` cookie; the CSRF token
  is returned in the body and sent back in an `X-CSRF-Token` header on every
  state-changing request (double-submit). The client renews an expired session
  once, transparently, and retries.
* Rate limiting per IP and per session on all endpoints.

### Uploads
* `POST /uploads/sign` validates declared content type (`image/png`,
  `image/jpeg`, `image/webp`) and size (≤ 10 MB) and returns a **pre-signed
  PUT URL** to a quarantine bucket, keyed by session id and a random upload id.
  Direct-to-storage keeps image bytes off the API server.
* Server-side after upload: re-check magic bytes, strip EXIF metadata (GPS,
  device identifiers), re-encode, run the safety and relevance checks
  (SafeSearch and text detection; `docs/firebase.md`), then move to the
  research store. Anything refused is deleted and the reason returned.
* Nothing is uploaded until the family presses "Send", after checking and
  (if they wish) hiding parts of each image, and after an on-device check
  has warned about anything that looks like a photograph rather than a
  screenshot. The client re-encodes
  every image through a canvas before upload, which removes camera metadata
  (device model, GPS) and bounds the dimensions; the server strips metadata
  again regardless.
* The pre-signed PUT binds the declared size and content type. Upload objects
  are only associated with a participant on successful `submit`; superseded
  objects (an image replaced after editing) are deleted synchronously, and
  orphaned quarantine objects are deleted after 24 hours. Only the session that
  created an upload may delete it, and `submit` rejects upload ids that belong
  to another session.
* Encryption at rest (provider-managed keys or University KMS) and in transit.

### Submit
* `submitConsent` validates every field again server-side (the same rules as
  `src/lib/validation.ts`, re-implemented on the server — never trust the
  client): maximum lengths, enumerations, the age range, all required
  statements agreed, statement and information versions equal to the ones the
  server currently serves, and a signature that is a valid PNG under 200 KB
  (or a typed name where allowed). Then, in one transaction:
  1. creates or updates the participant in the **identity store** (restricted
     access; names, DOB, postcode, guardian contact details),
  2. writes the **consent record** with the form version, statement versions,
     responses, signature PNG, server timestamp, client-declared date and
     user-agent — append-only, never edited; an amendment is a new record
     pointing at the one it supersedes,
  3. writes the **assent record** in the same way,
  4. issues (or keeps) the family's reference code.
  It is called as soon as the young person has signed, so participation is on
  record before the screenshots.
* `submitDonation` links accepted uploads to the participant's study id in
  the research store, together with the young person's agreement to share
  (recorded by the act of sending) and the quality result for each image.
  Both agreements are checked against the server's own copy of the records,
  never the client's claim.
* Nothing is emailed to families. The thank-you page builds a PDF copy of
  the record on the device (`src/lib/consentPdf.ts`) for the family to
  download and keep; the server is not involved.
* **Parent identity.** Nothing in a browser form can prove who pressed the
  buttons. Recommended: treat the consent as provisional until the school
  confirms it, or until the parent confirms through a one-time code sent to
  an address or number they give for that purpose. The record stores which
  of these happened.
* Records also keep the time the device was handed to the young person and
  the time their agreement screen opened, so an agreement completed within
  seconds of the parent's consent can be flagged for follow-up.

### Consent versioning and withdrawal
* Statement wording, the form version and the participant-information version
  live in configuration and are stamped on every record. The server keeps a
  snapshot (id, version, SHA-256 of the rendered text) of every version it has
  ever served, so a record can always be shown against the exact wording that
  was agreed. Changing wording creates a new version; old records keep the
  version they were signed against.
* If a statement is changed after signing, the client clears the signature and
  requires it again; the record carries `revisedAt`.
* Withdrawal is a separate process (contact the team). The consent record is
  never deleted; a withdrawal record is appended and downstream systems act on
  it, following the retention schedule agreed with the University.

### In the browser
* Progress (text answers, choices, the drawn signature as a PNG data URL) is
  kept in `sessionStorage` while the tab is open, so a refresh does not lose
  it. It is discarded if more than two hours old, cleared after 30 minutes
  without interaction (10 on the thank-you screen), on "Clear and start
  again", on "Finish and clear this device", and when the thank-you screen is
  reached. Image bytes
  are never written to storage. Whether the signature may be held in
  `sessionStorage` at all should be recorded in the DPIA; the alternative is
  to require signing again after any refresh.
* The prototype controls, the mock API and the `window.__mpmbMockApi` hook are
  compiled out when the app is built with `MPMB_PROTOTYPE=false`; the build
  then fails fast unless a real API client is provided in `src/api/index.ts`.

### What must be decided by the University, not by this code
* Lawful basis, privacy notice, retention periods and the data protection
  impact assessment.
* Ethics-approved wording for every statement and information section (all
  current wording is marked *draft* in the interface).
* 16–17-year-olds deciding about their screen time for themselves
  (`study.selfConsentAge`, 16 since 7 October 2026; to confirm with ethics).
* A deferred agreement is resumed with the reference and the young person's
  date of birth (`src/steps/Resume.tsx`, `resumeRecord`; see `journey.md`,
  "Carrying on later").
* Whether a typed signature is acceptable as an accessibility alternative to
  a drawn one (`study.allowTypedSignature`).
