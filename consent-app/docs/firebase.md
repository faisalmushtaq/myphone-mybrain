# Storage on Firebase

Yes, the app runs on Firebase, and this is the backend that is built. The
static site can stay on GitHub Pages; the data lives in a Firebase project
in Google Cloud's London region.

```
Browser (GitHub Pages)                    Firebase project (europe-west2)
──────────────────────                    ────────────────────────────────
signInAnonymously ───────────────────────▶ Authentication (anonymous uid = session)
uploadBytesResumable ────────────────────▶ Cloud Storage  quarantine/{uid}/{uploadId}
                                             rules: own path only, image/*, < 10 MB,
                                             create + delete, never read
httpsCallable('submitConsent') ──────────▶ Cloud Function submitConsent
                                             validates everything again
                                             re-encodes images (strips metadata)
                                             moves them to donations/{participantId}/
                                             writes 5 Firestore collections in one batch
                                             returns { referenceCode, receivedAt }
                                          Firestore: participants · consents · assents
                                                     donations · submissions · mail
                                             rules: no browser access at all
```

Nothing in the browser can read anything back. The research team reads
through the Firebase console, an export, or a separate admin tool signed in
with a role claim.

## Files

| Path | Purpose |
|---|---|
| `src/api/firebase.ts` | `FirebaseConsentApi`: the same `ConsentApi` interface as the mock, implemented with the Firebase web SDK |
| `src/api/index.ts` | Picks Firebase or the mock from `VITE_MPMB_BACKEND` |
| `firebase/firebase.json` | Project layout and emulator ports |
| `firebase/firestore.rules`, `firebase/storage.rules` | Security rules (see below) |
| `firebase/functions/src/index.ts` | `submitConsent` callable and `purgeQuarantine` schedule |
| `firebase/functions/src/validate.ts` | Server-side validation (mirrors `src/lib/validation.ts`) |
| `firebase/functions/src/forms.ts` | The statement ids and versions the server accepts; keep in step with `src/config/statements.ts` |
| `firebase/functions/src/validate.test.ts` | Unit tests for the validator (`npm test` in `firebase/functions`) |
| `scripts/emulator-e2e.mjs` | Drives the real app against the emulator suite and checks what was stored |
| `.env.example` | The environment variables the build reads |

## Data model

Five collections, written together in one batch so a submission is all-or-nothing:

| Collection | Holds | Who may read (custom claim `roles`) |
|---|---|---|
| `participants/{participantId}` | names, date of birth, school, year group, parent/guardian name, relationship, email, phone, postcode | `coordinator` |
| `consents/{consentId}` | form id and version, information version, every statement with its version, response, time and how it was given (`individual`, `group`, `signature`, `action`), typed name, signature (method, strokes, and a reference to the PNG in Storage), confirmed date, completion time, `revisedAt`, route, client info | `coordinator`, `auditor` |
| `assents/{assentId}` | the same shape for the young person, plus `deferredBy`, handover and start times, and `quickAgreementFlag` (agreement completed within 15 seconds of the handover) | `coordinator`, `auditor` |
| `donations/{donationId}` | `participantId`, platform, and for each image its Storage path, dimensions, size, SHA-256, and whether it was redacted or cropped. **No names.** | `researcher`, `coordinator` |
| `submissions/{referenceCode}` | one row per send: kind, links to the records above, image count, user agent | `coordinator` |
| `mail/{id}` | the confirmation email for the Trigger Email extension | nobody |

Storage:

| Path | Holds | Access |
|---|---|---|
| `quarantine/{uid}/{uploadId}` | images while the form is open | the session that created them: create and delete only |
| `donations/{participantId}/{uploadId}.png|jpg` | accepted images, re-encoded with all metadata removed | `researcher`, `coordinator` |
| `signatures/{participantId}/consent.png`, `assent.png` | drawn signatures | `coordinator`, `auditor` |

Identifying details and research data are in different collections and
different Storage folders, joined only by `participantId`, so a researcher
role can be given access to `donations/` without ever seeing a name.

## What the function checks before writing anything

`submitConsent` re-validates the whole payload (`validate.ts`): field
lengths and formats, the allowed relationships and platforms, the 11–17 age
range, that every statement id exists and carries the **current** version,
that all required statements are agreed and every optional one answered,
that a completed agreement carries a signature and the three signed
statements, that images are only present when both the parent and the young
person said yes to screenshots, that a declined submission carries no
permission record, and that the signature is a real PNG under 200 KB. It then
confirms each upload exists under the caller's own quarantine folder, decodes
it with `sharp` (a file that is not a PNG/JPEG/WebP is rejected), re-encodes
it — which removes EXIF, GPS, ICC and XMP metadata — and only then writes the
records. Any failure means nothing is recorded.

## Setting it up

1. **Create the project.** Firebase console → Add project. Choose a name
   such as `myphone-mybrain`. Disable Google Analytics.
2. **Location.** Firestore → Create database → location **europe-west2
   (London)**, production mode. Storage → Get started → same location. The
   location cannot be changed later.
3. **Authentication** → Sign-in method → enable **Anonymous**.
4. **Blaze plan.** Cloud Functions (2nd gen) and scheduled functions need the
   pay-as-you-go plan. Set a budget alert (£10/month is plenty for this).
5. **Deploy rules and functions** from `consent-app/firebase/`:
   ```bash
   cd consent-app/firebase
   cp .firebaserc.example .firebaserc      # put the real project id in it
   npm --prefix functions install
   firebase login
   firebase deploy --only firestore:rules,storage,functions
   ```
6. **Web app settings.** Project settings → Your apps → Add web app. Copy
   `apiKey`, `projectId`, `appId`, `authDomain`, `storageBucket` into
   GitHub → repository → Settings → Variables (`FIREBASE_API_KEY` and so on;
   see `.github/workflows/deploy.yml`) and set `MPMB_BACKEND=firebase`. These
   values identify the project and are safe to publish; access is governed by
   the rules. Set `MPMB_PROTOTYPE=false` to remove the prototype controls.
7. **Authorised domains.** Authentication → Settings → Authorized domains →
   add `myphonemybrain.com`.
8. **App Check** (recommended). Register the site with reCAPTCHA v3, put the
   site key in `FIREBASE_APPCHECK_SITE_KEY`, then set the function's
   `MPMB_ENFORCE_APP_CHECK=true` environment variable and redeploy. This
   stops scripts outside the website from calling the function or uploading.
9. **Confirmation email.** Install the *Trigger Email from Firestore*
   extension pointed at the `mail` collection, with the University's SMTP
   relay. Until then the `mail` documents simply accumulate.
10. **Staff access.** Give team members roles with the Admin SDK, for example
    `admin.auth().setCustomUserClaims(uid, { roles: ['coordinator'] })`, after
    they sign in to an admin tool with a University account (Google Workspace
    or Microsoft via Identity Platform). Nobody reads data as a plain console
    user in day-to-day use; the console is for the project owner only.
11. **Retention.** Add a bucket lifecycle rule deleting `quarantine/` objects
    after 1 day (the scheduled function also does this), and apply the study's
    retention schedule to the other paths when it is agreed.

### Running it locally

```bash
cd consent-app/firebase && npm --prefix functions install && npm --prefix functions run build
firebase emulators:start --project demo-mpmb        # Auth, Functions, Firestore, Storage, UI on :4000
# in another terminal
cd consent-app && VITE_MPMB_BACKEND=firebase VITE_FIREBASE_EMULATOR_HOST=127.0.0.1:4000 \
  VITE_FIREBASE_API_KEY=demo VITE_FIREBASE_PROJECT_ID=demo-mpmb VITE_FIREBASE_APP_ID=demo npm run dev
```

`node scripts/emulator-e2e.mjs` does the same automatically: builds the app
against the emulators, drives the whole journey in headless Chromium, and
checks the Firestore documents and Storage objects that resulted.

## Points for the data-protection assessment

* **Where data is.** Firestore and Storage are in London. Firebase
  Authentication stores its user records (for anonymous sign-in: a random uid
  and timestamps, no personal data) in Google's global Auth infrastructure;
  if a UK-only location is required for those records too, Identity Platform
  with a regional configuration is the option to discuss with Google.
* **Processor.** Google Cloud under the Google Cloud Data Processing Addendum;
  the University must have it in place for this project.
* **Access.** No client can read data. Staff access is by role claim, and the
  console should be restricted to the project owner with 2-step verification.
* **Audit trail.** Every record carries server `receivedAt`, the session uid,
  the form and information versions, and per-statement versions, times and
  the method of agreement. Records are never updated in place; withdrawals
  should be appended as separate documents.
* **Backups.** Enable Firestore scheduled backups (daily, 7-day retention is a
  reasonable start) and Storage object versioning.
* **What the emailed summary contains** and the email provider are ethics
  decisions; the `mail` document is a placeholder.

## Cost

At the scale of a school-based study (thousands of submissions, a few
screenshots each) this sits inside or just above the free tier: Firestore
writes are a few per submission, Storage is a few hundred KB per family, and
the function runs for a couple of seconds per send. Expect a few pounds a
month once traffic is real, dominated by Storage.
