# Architecture

## What is built now

A front-end prototype (React + TypeScript, built with Vite) that mounts inside
the existing Jekyll site at `/take-part/consent/`. It contains the complete
user journey, validation, consent data model and an **API abstraction with a
mock implementation**. Nothing is sent anywhere: the mock keeps data in memory
for the life of the page and simulates latency and failures so the error states
can be exercised.

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
├── docs/              this folder
└── scripts/           build helpers
```

## Data model (see `src/model/types.ts`)

The model deliberately separates three kinds of information:

| Object | Contains | Purpose |
|---|---|---|
| `ParticipantIdentity` | child's names, date of birth, school, year group, postcode | Matching the participant within the study and (with consent) with external records. **Identifying.** |
| `GuardianIdentity` | parent's name, relationship, parental-responsibility declaration, email, phone | Establishing who gave consent and how to reach them. **Identifying.** |
| `ConsentRecord` / `AssentRecord` | form id + version, every statement with its version and response, typed name, signature (PNG + stroke metadata + method), confirmed date, device timestamp, study/site/school identifiers | The audit record of what was agreed, by whom, and when. |
| `PhoneUseDonation` | platform, list of uploaded image references (server upload ids, dimensions, whether redacted), status | **Research data.** Never stored alongside identity in the browser; linked server-side by participant id. |

The submission payload sends these as separate top-level objects so the server
can store identity in a restricted table and research data in the research
store, joined only by a study identifier.

## API contract (see `src/api/types.ts`)

```
startSession()                             → { sessionId, csrfToken, expiresAt }
requestUploadSlot(sessionId, {type, size}) → { uploadId, url, method, headers, expiresAt }
uploadImage(slot, blob, onProgress)        → void            (direct-to-storage, signed URL)
deleteUpload(sessionId, uploadId)          → void
submit(sessionId, csrfToken, payload)      → { referenceCode, receivedAt }
```

`MockConsentApi` implements the same interface in memory with a 400–900 ms
delay and two failure toggles (upload, submit) exposed in the on-screen
"Prototype controls" panel.

## Proposed production architecture

This is a proposal to be agreed with University of Leeds IT, the data
protection team and the ethics committee. It describes mechanisms, not
compliance claims.

### Hosting
* The consent page and the API must be served from the **same registrable
  domain** (University hosting, for example `consent.myphonemybrain.leeds.ac.uk`
  with the API under `/api/`). GitHub Pages cannot set security headers and a
  cross-site cookie would be blocked by browsers, so the form should not be
  served from GitHub Pages in production, even though the marketing site is.
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
  device identifiers), re-encode, virus scan, then move to the research store.
* Nothing is uploaded until the family presses "These are ready", after
  checking and (if they wish) hiding parts of each image. The client re-encodes
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
* `POST /api/submissions` validates every field again server-side (the same
  rules as `src/lib/validation.ts`, re-implemented on the server — never trust
  the client): maximum lengths, enumerations, the age range, all required
  statements agreed, statement and information versions equal to the ones the
  server currently serves, and a signature that is a valid PNG under 200 KB
  (or a typed name where allowed). Then, in one transaction:
  1. creates or matches the participant in the **identity store** (restricted
     access; names, DOB, postcode, guardian contact details),
  2. writes the **consent record** with the form version, statement versions,
     responses, signature PNG, server timestamp, client-declared date, IP hash
     and user-agent — append-only, never edited,
  3. writes the **assent record** in the same way,
  4. links uploads to the participant's study id in the research store.
* Returns a server-generated reference code; emails a copy of the consent
  summary to the guardian (without date of birth, postcode or signature image;
  content to be agreed with ethics). The email carries a "this wasn't me" link.
* **Parent identity.** Nothing in a browser form can prove who pressed the
  buttons. Recommended: treat the consent as provisional until the parent
  acknowledges the confirmation email (or, for the young-person route, enters
  a one-time code sent to their email before submission), or until the school
  confirms it. The record stores which of these happened.
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
  without interaction (10 on the confirmation screen), on "Clear and start
  again", on "Finish and clear this device", and on submission. Image bytes
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
* Whether 16–17-year-olds may consent for themselves (`study.selfConsentAge`
  is provided as a configuration point but not enabled).
* Whether assent can be deferred to school, and how a deferred journey is
  resumed (this prototype records the status; a resume link is not built).
* Whether a typed signature is acceptable as an accessibility alternative to
  a drawn one (`study.allowTypedSignature`).
