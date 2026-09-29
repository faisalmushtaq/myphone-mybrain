# Storage on Firebase

Yes, the app runs on Firebase, and this is the backend that is built. The
static site can stay on GitHub Pages; the data lives in a Firebase project
in Google Cloud's London region.

```
Browser (GitHub Pages)                    Firebase project (europe-west2)
──────────────────────                    ────────────────────────────────
signInAnonymously ───────────────────────▶ Authentication (anonymous uid = session)

httpsCallable('submitConsent') ──────────▶ Cloud Function submitConsent
  as soon as the young person has            validates everything again
  signed, declined or deferred;              new record → reference code, participant id
  again with the reference code              amendment → new consent/assent records that
  when something is changed                    point at the ones they supersede
                                             writes participants · consents · assents ·
                                               surveys · submissions (· mail) in one batch

uploadBytesResumable ────────────────────▶ Cloud Storage  quarantine/{uid}/{uploadId}
  when "Send" is pressed on the              rules: own path only, image/*, < 10 MB,
  screen-time page                           create + delete, never read

httpsCallable('submitDonation') ─────────▶ Cloud Function submitDonation
  straight after the uploads                 checks the record on the server's own copy
                                             re-encodes each image (strips metadata)
                                             quality and safety checks (see below)
                                             moves accepted images to donations/{participantId}/
                                             writes donations, updates assents · submissions
                                             returns { accepted, rejected: [{uploadId, reason}] }

                                          Firestore: participants · consents · assents
                                                     surveys · donations · submissions · mail
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
| `firebase/functions/src/index.ts` | `submitConsent` and `submitDonation` callables, `purgeQuarantine` schedule |
| `firebase/functions/src/validate.ts` | Server-side validation of both payloads (mirrors `src/lib/validation.ts`) |
| `firebase/functions/src/quality.ts` | Image quality and safety checks: flatness, Cloud Vision SafeSearch and text detection, the verdict rules |
| `firebase/functions/src/forms.ts` | The statement ids and versions the server accepts; keep in step with `src/config/statements.ts` |
| `firebase/functions/src/validate.test.ts`, `quality.test.ts` | Unit tests (`npm test` in `firebase/functions`) |
| `scripts/emulator-e2e.mjs` | Drives the real app against the emulator suite and checks what was stored |
| `.env.example` | The environment variables the app build reads |
| `firebase/functions/.env.example` | The environment variables the functions read |

## Data model

| Collection | Holds | Who may read (custom claim `roles`) |
|---|---|---|
| `participants/{participantId}` | names, date of birth, school, year group, parent/guardian name, relationship, whether a copy was asked for, email, phone, postcode. Updated in place by an amendment (`version`, `updatedAt`). | `coordinator` |
| `consents/{consentId}` | form id and version, information version, every statement with its version, response, time and how it was given (`individual`, `group`, `signature`, `action`), typed name, signature (method, strokes, and a reference to the PNG in Storage), confirmed date, completion time, `revisedAt`, route, client info, `version` and `supersedes` (the previous consent record, or null). Never edited. | `coordinator`, `auditor` |
| `assents/{assentId}` | the same shape for the young person, plus `deferredBy`, handover and start times, `quickAgreementFlag` (agreement completed within 15 seconds of the handover), `version`, `supersedes`. The screenshot agreement (`responses.phone-use`, given by the act of sending) is added when screenshots are first sent. | `coordinator`, `auditor` |
| `surveys/{surveyId}` | one document per send: `participantId`, the questions form id and version, status (completed, skipped or in progress), each answer with the question version and time, `version` and `supersedes`. **No names.** | `researcher`, `coordinator` |
| `donations/{donationId}` | one document per send: `participantId`, platform, the young person's `agreement` record, `needsReview`, and for each image its Storage path, dimensions, size, SHA-256, whether it was redacted or cropped, and its `quality` result (verdict, reasons, terms found, SafeSearch likelihoods, flatness, whether Vision ran, whether the family confirmed a warning). **No names.** | `researcher`, `coordinator` |
| `submissions/{referenceCode}` | one row per family: kind, route, the *current* `consentId` and `assentId`, `version`, `versions[]` (one entry per send with the record ids and time), `donationIds[]`, `imageCount`, `copyEmailedTo`, session uid, user agent | `coordinator` |
| `mail/{id}` | the confirmation email for the Trigger Email extension, queued only when a copy was asked for, once per address | nobody |

Storage:

| Path | Holds | Access |
|---|---|---|
| `quarantine/{uid}/{uploadId}` | images while the form is open | the session that created them: create and delete only |
| `donations/{participantId}/{uploadId}.png|jpg` | accepted images, re-encoded with all metadata removed | `researcher`, `coordinator` |
| `signatures/{participantId}/{recordId}.png` | drawn signatures, one per consent or assent record | `coordinator`, `auditor` |

Identifying details and research data are in different collections and
different Storage folders, joined only by `participantId`, so a researcher
role can be given access to `donations/` without ever seeing a name.

## What the functions check before writing anything

**`submitConsent`** re-validates the whole payload (`validate.ts`): field
lengths and formats, the allowed relationships, the 11–17 age range, at least
three letters for a typed-in school, an email address only when a copy was
asked for, that every statement id exists and carries the **current**
version, that all required statements are agreed and every optional one
answered, that a completed agreement carries a signature and the three signed
statements, that the parent's quick questions (if present) use known question
ids, current versions and listed answers, that a declined submission carries
no permission record and no questions, and that the signature is a real PNG
under 200 KB. A payload with a reference code is
an amendment: the reference must exist and belong to the same anonymous
session, the participant document is updated, new consent and assent records
are written pointing at the ones they supersede, and the submission's version
goes up. Any failure means nothing is recorded.

**`submitDonation`** checks the reference belongs to the caller's session,
then reads the server's own copy of the records: the parent's current
permission record must say yes to screenshots and the young person's
agreement must be completed. At most six images per family in total. Each
upload must exist under the caller's own quarantine folder and decode as a
PNG, JPEG or WebP; it is re-encoded (which removes EXIF, GPS, ICC and XMP
metadata) and only the clean copy is checked and stored. Images the checks
refuse are deleted from quarantine and reported back with a reason; the rest
are stored and recorded, so one bad image never loses the others.

### Photo checks

Two layers, because families add the wrong image by mistake and nothing
harmful should be stored.

1. **On the device** (`src/lib/imageQuality.ts`), before anything is sent: a
   content-blind check of shape and colour. Phone screenshots are portrait and
   made of a handful of flat colours; photographs are not. A photo-like image
   gets a warning under it, and pressing send asks "It's right — send anyway"
   or "Let me check". Nothing is refused on the device.
2. **On the server** (`quality.ts`), on the metadata-stripped copy:

   | Signal | How | Effect |
   |---|---|---|
   | Flatness | share of pixels covered by the eight most common colours, computed with `sharp` | backs up the other signals; never rejects on its own |
   | SafeSearch | Cloud Vision `SAFE_SEARCH_DETECTION` | adult, violence or racy at *likely* or above → **rejected**, not stored; *possible* → kept, flagged for review |
   | Text | Cloud Vision `TEXT_DETECTION`, matched against the words on iOS Screen Time and Android Digital Wellbeing pages ("Screen Time", "Digital Wellbeing", "Most used", "Daily average", durations…) | words found → **accepted**; none found and the image is photo-like → **rejected** with "This doesn't look like a screenshot of the screen-time page"; none found but flat → kept, flagged for review |
   | App list | several durations, or the words that head an app list ("Most used", "See all app & website activity", "Show more") | recorded as `appsVisible`; screen-time words without an app list → kept, flagged for review as "may be the summary only", so the team can ask for the app list |

   Without Vision (the default until it is switched on) the server never
   rejects on relevance: a flat portrait image is accepted, anything else is
   kept and flagged `review`. The family sees only the plain reason for a
   rejection; the detailed reasons are stored on the donation record for the
   team. A Vision outage keeps the image and flags it rather than losing it.

   Vision is switched on with `MPMB_VISION=true` in the functions'
   environment. The client uses the `eu-vision.googleapis.com` endpoint so
   images are processed in the EU. Cost: after the first 1,000 images a
   month, about $1.50 per 1,000 images per feature, so roughly £2.50 per
   1,000 screenshots for both features.

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
   cp functions/.env.example functions/.env  # MPMB_VISION, MPMB_ENFORCE_APP_CHECK
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
   site key in `FIREBASE_APPCHECK_SITE_KEY`, then set
   `MPMB_ENFORCE_APP_CHECK=true` in `functions/.env` and redeploy. This stops
   scripts outside the website from calling the functions or uploading.
9. **Photo checks** (recommended, once the DPIA covers it). Google Cloud
   console → APIs & Services → enable **Cloud Vision API** on the project,
   set `MPMB_VISION=true` in `functions/.env`, redeploy.
10. **Confirmation email.** Install the *Trigger Email from Firestore*
    extension pointed at the `mail` collection, with the University's SMTP
    relay. Until then the `mail` documents simply accumulate.
11. **Staff access.** Give team members roles with the Admin SDK, for example
    `admin.auth().setCustomUserClaims(uid, { roles: ['coordinator'] })`, after
    they sign in to an admin tool with a University account (Google Workspace
    or Microsoft via Identity Platform). Nobody reads data as a plain console
    user in day-to-day use; the console is for the project owner only.
12. **Retention.** Add a bucket lifecycle rule deleting `quarantine/` objects
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
against the emulators, drives the whole journey in headless Chromium (sign,
send two screenshots, amend a detail, finish), then checks the Firestore
documents and Storage objects that resulted and that the rules and the
functions refuse what they should. `npm test` in `firebase/functions` runs
the validation and quality-rule unit tests.

## Points for the data-protection assessment

* **Where data is.** Firestore and Storage are in London. Firebase
  Authentication stores its user records (for anonymous sign-in: a random uid
  and timestamps, no personal data) in Google's global Auth infrastructure;
  if a UK-only location is required for those records too, Identity Platform
  with a regional configuration is the option to discuss with Google.
* **Photo checks.** When `MPMB_VISION` is on, the metadata-stripped copy of
  each screenshot is sent to the Cloud Vision API (EU endpoint) for SafeSearch
  and text detection. Google states that the Vision API does not store the
  images or use them to improve its models; confirm this against the Cloud
  Data Processing Addendum in the DPIA. Nothing about the image content is
  logged by the function.
* **Processor.** Google Cloud under the Google Cloud Data Processing Addendum;
  the University must have it in place for this project.
* **Access.** No client can read data. Staff access is by role claim, and the
  console should be restricted to the project owner with 2-step verification.
* **Audit trail.** Every record carries server `receivedAt`, the session uid,
  the form and information versions, and per-statement versions, times and
  the method of agreement. Consent and assent records are never updated in
  place: an amendment is a new record pointing at the one it supersedes, and
  the submission lists every version. Withdrawals should be appended in the
  same way.
* **Backups.** Enable Firestore scheduled backups (daily, 7-day retention is a
  reasonable start) and Storage object versioning.
* **What the emailed summary contains** and the email provider are ethics
  decisions; the `mail` document is a placeholder, and it is only queued when
  the parent asked for a copy.

## Cost

At the scale of a school-based study (thousands of families, a few
screenshots each) this sits inside or just above the free tier: Firestore
writes are a few per family, Storage is a few hundred KB per family, and the
functions run for a couple of seconds per send. Expect a few pounds a month
once traffic is real, dominated by Storage, plus a few pounds per thousand
screenshots for the Vision checks.
