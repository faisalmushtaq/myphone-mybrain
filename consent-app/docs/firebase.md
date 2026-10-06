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
                                               surveys · submissions in one batch

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
                                                     surveys · donations · submissions
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
| `firebase/firebase.json`, `firestore.indexes.json` | Project layout and emulator ports; the composite indexes the follow-up queries need (deployed with the rules) |
| `firebase/firestore.rules`, `firebase/storage.rules` | Security rules (see below) |
| `firebase/functions/src/index.ts` | `submitConsent` and `submitDonation` callables, `purgeQuarantine` schedule |
| `firebase/functions/src/lab.ts` | The social media break study: `submitLabConsent`, `lookupLabParticipant`, `submitLabDonation`, `submitLabCheckIn` and `requestLabReminder` callables, the hourly `labFollowUps` schedule, and the check that a donated archive is the cleaner's |
| `firebase/functions/src/validate.ts` | Server-side validation of the family payloads (mirrors `src/lib/validation.ts`); its helpers are shared with `lab.ts` |
| `firebase/functions/src/images.ts`, `signatures.ts` | The image pipeline (prove it is an image, re-encode without metadata, quality checks) and signature storage, shared by both studies |
| `firebase/functions/src/quality.ts` | Image quality and safety checks: flatness, Cloud Vision SafeSearch and text detection, the verdict rules |
| `firebase/functions/src/forms.ts` | The statement ids, versions and wording the server accepts, for both studies, derived at build time from the app's `src/config` and `src/lab` by `scripts/generate-forms.mjs`, so they cannot drift; also the cleaner's file allow-list |
| `firebase/functions/src/enquiry.ts`, `mail.ts` | The website's contact and school forms: validation, storage in `enquiries/`, and the email to the team sent over SMTP |
| `firebase/functions/src/export.ts`, `exportLab.ts` | The hourly export: one folder per study in the private exports bucket (`schools/`, `social-media-break/`), each with the website's dataset `donations/` in BIDS layout (the lab study's archives unpacked into per-task tables) and a separate `identifying/` folder (see "Getting the data out") |
| `firebase/scripts/setup-exports.sh`, `mac-sync-install.sh` | One-off set-up of the export bucket and read-only key, and the Mac job that mirrors it into OneDrive |
| `firebase/functions/src/*.test.ts` | Unit tests (`npm test` in `firebase/functions`) |
| `scripts/emulator-e2e.mjs` | Drives the real app, both studies, against the emulator suite and checks what was stored |
| `.env.example` | The environment variables the app build reads |
| `firebase/functions/.env.example` | The environment variables the functions read |

## Data model

| Collection | Holds | Who may read (custom claim `roles`) |
|---|---|---|
| `participants/{participantId}` | names, date of birth, school, year group, parent/guardian name, relationship, email, phone, postcode. Updated in place by an amendment (`version`, `updatedAt`). | `coordinator` |
| `consents/{consentId}` | form id and version, information version, every statement with its version, response, time and how it was given (`individual`, `group`, `signature`, `action`), typed name, signature (method, strokes, and a reference to the PNG in Storage), confirmed date, completion time, `revisedAt`, route, client info, `version` and `supersedes` (the previous consent record, or null). Never edited. | `coordinator`, `auditor` |
| `assents/{assentId}` | the same shape for the young person, plus `deferredBy`, handover and start times, `quickAgreementFlag` (agreement completed within 15 seconds of the handover), `version`, `supersedes`. The screenshot agreement (`responses.phone-use`, given by the act of sending) is added when screenshots are first sent. | `coordinator`, `auditor` |
| `surveys/{surveyId}` | one document per send: `participantId`, the questions form id and version, status (completed, skipped or in progress), each answer with the question version and time, `version` and `supersedes`. **No names.** | `researcher`, `coordinator` |
| `donations/{donationId}` | one document per send: `participantId`, platform, the young person's `agreement` record when they signed in the app (null otherwise), `youngPersonAgreedInApp`, `assentStatusAtSend` (their agreement may instead be on paper), `needsReview`, and for each image its Storage path, dimensions, size, SHA-256, whether it was redacted or cropped, and its `quality` result (verdict, reasons, terms found, SafeSearch likelihoods, flatness, whether Vision ran, whether the family confirmed a warning). **No names.** | `researcher`, `coordinator` |
| `submissions/{referenceCode}` | one row per family: kind, route, the *current* `consentId` and `assentId`, `version`, `versions[]` (one entry per send with the record ids and time), `donationIds[]`, `imageCount`, session uid, user agent | `coordinator` |
| `enquiries/{id}` | messages from the website's contact and school forms, with whether the team was emailed (`notified`: sent, failed or not-configured). Families are never emailed; they download their copy of the record instead | `coordinator` |

The social media break study (adults; `src/lab/` in the app, `lab.ts` in the functions) keeps its own collections, keyed by the participant code the lab questionnaire builds (for example `JA101CD`: the first two letters of the participant's own first name, first digit of the house number, two-digit birth month, last two letters of the postcode; the person's own name keeps twins apart), so the donated data and the laboratory data meet without a name:

| Collection | Holds | Who may read |
|---|---|---|
| `labParticipants/{code}` | one row per code: the current `consentId` and `consentVersion`, `consentedAt`, `archiveCount`, `screenshotCount`, the same counts by phase in `phaseCounts.{pre,mid,post}`, `donationIds[]`, `checkInIds[]` and `checkInCount`, the session uids seen. **No names.** | `researcher`, `coordinator` |
| `labConsents/{id}` | the consent record: form and information versions, the eight required statements (including that what is sent is kept unless the person formally withdraws) and the optional record-linkage answer, typed name, signature (method and a reference to the PNG), confirmed date, completion time, client info, `version` and `supersedes`, and `codeParts`: the four answers the code was built from (`firstName`, house number, birth month, postcode), which the team also uses as research variables. Never edited. | `coordinator`, `auditor` |
| `labDonations/{id}` | one document per send: the phone type chosen on the screenshots step, the phase of the page it came from (`pre` the first page, `mid` a check-in, with its `checkInId`, `post` the after-break page), and for each file its kind (`archive` or `screenshot`), Storage path, size, SHA-256; for archives the platforms, categories and row counts from the cleaner's manifest and the file names inside; for screenshots the dimensions and the same `quality` result as the family app's images. **No names.** | `researcher`, `coordinator` |
| `labCheckIns/{id}` | one document per mid-break check-in: the code, which check-in it was for them (`number`), the form version and the answers by question id. **No names.** | `researcher`, `coordinator` |
| `labReminders/{code}` | when a participant presses "I'll come back later" and asks for an email: the address, which page it is about (`phase`: `pre` or `post`), when the progress email went and whether it was sent, when the one follow-up is due and whether it went, and `completedAt` once files for that page arrive (which cancels the follow-up). Identifying. | `coordinator` |

Storage:

| Path | Holds | Access |
|---|---|---|
| `quarantine/{uid}/{uploadId}` | images while the form is open | the session that created them: create and delete only |
| `donations/{participantId}/{uploadId}.png|jpg` | accepted images, re-encoded with all metadata removed | `researcher`, `coordinator` |
| `signatures/{participantId}/{recordId}.png` | drawn signatures, one per consent or assent record | `coordinator`, `auditor` |
| `labquarantine/{uid}/{uploadId}` | the lab study's uploads (images up to 10 MB, ZIP archives up to 64 MB) while the page is open | the session that created them: create and delete only |
| `lab/{code}/{uploadId}.zip|png|jpg` | accepted cleaned archives (kept exactly as sent) and screenshots (re-encoded without metadata) | `researcher`, `coordinator` |
| `signatures/lab/{code}/{consentId}.png` | the lab study's drawn signatures | `coordinator`, `auditor` |

Identifying details and research data are in different collections and
different Storage folders, joined only by `participantId`, so a researcher
role can be given access to `donations/` without ever seeing a name.

## What the functions check before writing anything

The lab study's functions check, in the same spirit: the code has the questionnaire's shape; the four code answers rebuild the code and the postcode has the shape of a full UK postcode; the consent form and information versions are the current ones, the eight required statements are agreed and the optional record-linkage question is answered; a signature is present; a donation needs consent on file for that code (not necessarily from the same session, because people come back from another device); the phase is `pre`, `mid` or `post`, a check-in sends screenshots only, and a `checkInId` must be that code's; at most 10 archives and 12 screenshots per code before the break and again after it, and 30 screenshots across the check-ins; and every archive is opened on the server and must contain only the file names the in-browser cleaner writes (`manifest.json`, `tiktok_cleaned.json`, the three `youtube/` files and the four `instagram/` files), each JSON file must parse, the manifest must be the cleaner's, and the unpacked size is capped, so a participant's raw TikTok download, a photo or anything else is refused with a plain reason and never stored. `lookupLabParticipant` says only whether a code has consent on file, how many files it has for each phase and how many check-ins, and is limited to 30 calls an hour per session. `submitLabCheckIn` (10 an hour per session) needs consent on file and the current check-in questions answered: every required one with one of its options, the free text within its limit, nothing else. `requestLabReminder` (5 an hour per session) emails the participant where they stand for that page and a link that opens it with their code filled in, from the same SMTP account as the team's enquiry emails, and books one follow-up; `labFollowUps` runs hourly and sends it two days later unless a send has arrived since, after which nothing more is sent.

**`submitConsent`** re-validates the whole payload (`validate.ts`): field
lengths and formats, the allowed relationships, the 11–17 age range, at least
three letters for a typed-in school, a valid email address when one is
given, that every statement id exists and carries the **current**
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
permission record must say yes to screenshots, and the young person must not
have said no. The young person's own agreement is not a gate (it may be
collected on paper at school); when they signed in the app it travels with
the images, and either way the donation records what was known at the time. At most six images per family in total. Each
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

### The fast route: one script in Cloud Shell

Nearly every console step below can be done from the command line. Google
Cloud Shell (https://shell.cloud.google.com) is a terminal in the browser,
already signed in as you, with `gcloud`, Node and the Firebase CLI installed.
Paste this into it, with your own project id (lower-case letters, digits and
hyphens, globally unique):

```bash
git clone https://github.com/faisalmushtaq/myphone-mybrain.git && cd myphone-mybrain
bash consent-app/firebase/scripts/setup-project.sh myphone-mybrain-leeds
```

The script creates the project if needed, links billing when you give it a
billing-account id as a second argument (that *is* the Blaze plan), enables
the APIs, creates Firestore and the Storage bucket in London, turns on
anonymous sign-in and authorises `myphonemybrain.com`, registers the web
app, deploys the rules and functions, and writes `consent-app/.env.production`
with the settings the site build needs (commit it, or paste it to Claude). It stops and gives you
the exact link for the two things only a person can do: a billing account
with a card, and, if the Auth API refuses, the one-off "Get started" click.
Run it again any time; it skips what is already done.

### Step by step in the console

1. **Create the project.** Firebase console → Add project. Choose a name
   such as `myphone-mybrain`. Disable Google Analytics.
2. **Location.** Firestore → Create database → location **europe-west2
   (London)**, production mode. Storage → Get started → same location. The
   location cannot be changed later.
3. **Authentication** → Sign-in method → enable **Anonymous**.
4. **Blaze plan.** Cloud Functions (2nd gen) and scheduled functions need the
   pay-as-you-go plan. Set a budget alert (£10/month is plenty for this).
5. **Deploy rules and functions.** Either from a laptop with Node 20+:
   ```bash
   npm install -g firebase-tools
   cd consent-app/firebase
   cp .firebaserc.example .firebaserc      # put the real project id in it
   cp functions/.env.example functions/.env  # MPMB_VISION, MPMB_ENFORCE_APP_CHECK
   npm --prefix functions install
   firebase login
   firebase deploy --only firestore:rules,storage,functions
   ```
   or, after the one-off `scripts/setup-github-deploys.sh` in Cloud Shell,
   automatically: the **Deploy Firebase backend** workflow
   (`.github/workflows/firebase-deploy.yml`) runs the function tests and
   deploys on every push to main that touches `consent-app/firebase/`, and
   can be started by hand from the Actions tab. It authenticates without
   keys (Workload Identity Federation), so nothing secret is stored in
   GitHub.
6. **Web app settings.** Project settings → Your apps → Add web app. Put
   `apiKey`, `projectId`, `appId`, `authDomain`, `storageBucket` into
   `consent-app/.env.production` as `VITE_FIREBASE_API_KEY` and so on, with
   `VITE_MPMB_BACKEND=firebase` (see `.env.example`), and commit it. The
   setup script writes this file for you. These values identify the project
   and are safe to publish; access is governed by the rules. The repository
   variable `MPMB_PROTOTYPE=false` removes the prototype controls.
7. **Authorised domains.** Authentication → Settings → Authorized domains →
   add `myphonemybrain.com`.
8. **App Check** (recommended). Register the site with reCAPTCHA v3, put the
   site key in `FIREBASE_APPCHECK_SITE_KEY`, then set
   `MPMB_ENFORCE_APP_CHECK=true` in `functions/.env` and redeploy. This stops
   scripts outside the website from calling the functions or uploading.
9. **Photo checks** (recommended, once the DPIA covers it). Google Cloud
   console → APIs & Services → enable **Cloud Vision API** on the project,
   set `MPMB_VISION=true` in `functions/.env`, redeploy.
10. **Team notifications.** The `enquiry` function emails the team itself
    over SMTP (Gmail with an app password by default; no Firebase extension,
    as Extensions are being retired). Store the password once, in Cloud
    Shell: `bash consent-app/firebase/scripts/set-mail-password.sh <project-id>`.
    The sending account and recipient are the repository variables
    `MPMB_SMTP_USER` and `MPMB_MAIL_TO`, with defaults in the deploy
    workflow. Until the password is stored, messages are kept in
    `enquiries/` with `notified: not-configured`. Nothing is ever emailed
    to families.
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

## Getting the data out: the hourly export and the OneDrive mirror

Nobody reads the live database by hand. Every hour the `exportData`
function (`firebase/functions/src/export.ts`) rewrites a private bucket of
its own, `<project-id>-exports`, as a mirror of the current records, with one
folder per study and the same two website-written subfolders in each. The
export names its dataset `donations/` because it is one source among several:
each team keeps its other datasets (workshop EEG, laboratory visits, tracking)
beside it in the study folder, never inside it, and the Mac mirror copies each
written folder on its own so those siblings are left alone:

```
README.md, manifest.json                  what is here, when it ran, how many of each thing
schools/                                  the young people's study
  README.md
  donations/                              the research dataset, BIDS layout, no names
    dataset_description.json, README, CHANGES
    participants.tsv + .json              one row per consenting young person: age at consent,
                                          year group, site, consent and agreement status, counts
    phenotype/parent_perceptions.tsv + .json  the parent's quick questions, latest answers, with
                                          the question wording and answer levels as the dictionary
    sub-00001/sub-00001_sessions.tsv      one session per screenshot send
    sub-00001/ses-01/beh/
      sub-00001_ses-01_task-screentime_beh.tsv + .json   the images of that send with their checks
    sourcedata/sub-00001/ses-01/
      sub-00001_ses-01_task-screentime_run-01_screenshot.png   the images themselves
    sourcedata/raw/*.jsonl                every research document as JSON Lines
  identifying/                            coordinators only
    participants_key.tsv                  the key from sub-labels to names, dates of birth,
                                          school, parent or guardian and contact details
    consents.tsv, consent_statements.tsv, assents.tsv, assent_statements.tsv,
    submissions.tsv, enquiries.tsv, raw/*.jsonl
    signatures/sub-00001/sub-00001_consent-v1_signature.png
social-media-break/                       the adult laboratory study
  README.md
  donations/                              the donated data, BIDS layout, no names
    dataset_description.json, README, CHANGES
    participants.tsv + .json              one row per code with consent: consent versions,
                                          phases, sends, check-ins, archives, screenshots,
                                          platforms, phone
    phenotype/checkin.tsv + .json         the mid-break check-ins: one row each, one column
                                          per question, with the questions and answer labels
    sub-JA101CD/sub-JA101CD_sessions.tsv  one session per phase: ses-pre (the first page,
                                          before the break), ses-mid (screenshots sent with
                                          the check-ins), ses-post (the after-break page),
                                          however many sends it took
    sub-JA101CD/ses-pre/beh/
      sub-JA101CD_ses-pre_task-donation_beh.tsv + .json   index of the files: what the cleaner's
                                          manifest says is inside an archive, or the screenshot checks
      sub-JA101CD_ses-pre_task-tiktokwatch_run-01_beh.tsv + .json   one table per kind of record,
      ..._task-tiktoksearch_, _tiktokengage_, _tiktokapp_, _tiktoktotals_,   unpacked once from each
      ..._task-youtubewatch_, _youtubesearch_, _youtubesubs_             archive, with dictionaries
    sourcedata/sub-JA101CD/ses-pre/
      sub-JA101CD_ses-pre_run-01_archive.zip, ..._run-02_screenshot.png   the files as received
    sourcedata/raw/*.jsonl
  identifying/                            coordinators only
    consents.tsv, consent_statements.tsv  the consent records, with the typed names and the
                                          answers the code was built from (incl. postcode)
    signatures/sub-JA101CD/sub-JA101CD_consent-v1_signature.png
    raw/consents.jsonl
```

Family participants are labelled `sub-00001`, `sub-00002`… in order of
consent (the number is stored on the participant record the first time it is
exported); lab participants are labelled by their participant code
(`sub-JA101CD`), which the laboratory data also uses, so the two datasets join
on it. The lab study's sessions are the study's phases, `ses-pre`, `ses-mid`
and `ses-post`, set by the page each send came from (nobody is asked), so a
late-arriving export sent days after the first still lands in the same
session; a check-in screenshot's `check_in_id` points at its row in
`phenotype/checkin.tsv`. Declined families appear in `schools/identifying/` only, without a label. Tables are
BIDS-style TSV (tab-separated, `n/a` for missing, UTF-8), rewritten each run;
images and signatures are copied once; anything deleted from the study (a
withdrawal) disappears from the bucket too. The screenshots have no BIDS
modality of their own, so they sit under `sourcedata/` and each send is a
session whose `beh` table lists them; a future derivatives dataset can hold
whatever is extracted from them.

**The OneDrive copy.** No Microsoft integration is needed, and no key is
stored anywhere Microsoft can see. One Mac that is regularly on (it may
sleep or be offline; a missed run is simply skipped and the next catches
up) mirrors the bucket into a folder the OneDrive app syncs, every 15
minutes, in the background:

1. In Cloud Shell, once: `bash consent-app/firebase/scripts/setup-exports.sh <project-id>`.
   It creates the bucket if needed, a service account that can read that
   bucket and nothing else, and a key file, and starts an export. Download
   the key from Cloud Shell (menu ⋮ → Download).
2. On the Mac: `bash mac-sync-install.sh ~/Downloads/<key>.json`
   (`consent-app/firebase/scripts/mac-sync-install.sh`). It asks which
   OneDrive folder to use, installs `rclone` and the key under
   `~/Library/Application Support/MyPhoneMyBrain Sync/`, adds a launchd job
   every 15 minutes, and runs the first copy. Offline runs are skipped
   quietly; a real failure shows a macOS notification at most every six
   hours; the log is `~/Library/Logs/MyPhoneMyBrain Sync.log`.
   `bash mac-sync-install.sh --add <folder> [bids|all]` mirrors into a
   second place too, by default the de-identified research datasets only
   (every study's `donations/`, no `identifying/` folder; use `all` only
   where the DPIA allows identifying data, such as the University's own
   storage). The job discovers the studies from the bucket and mirrors each
   written folder on its own, so anything the team keeps beside them, such
   as `social-media-break/lab-visits/`, is never touched; `--remove <folder>` stops that, `--list`
   shows the folders and runs a copy, `--uninstall` removes it all. Rerun
   `setup-exports.sh` to rotate the key.

Use a restricted SharePoint or Teams library with sync turned off for
everyone except that Mac, and give researchers access to the `donations/`
folders only.
Note that OneDrive keeps deleted files in its recycle bin for a while, so a
withdrawal is not final there until it is emptied.

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
* **Participants' email addresses (lab study).** Given only when a
  participant asks for a progress email from the guide. Kept in
  `labReminders` and `social-media-break/identifying/reminders.tsv`, used for
  that email and at most one follow-up two days later, never in the research
  dataset. The emails go from the study's Gmail account with the lab
  contact as reply-to.
* **The lab study's code answers.** The participant code is built from
  the participant's first name, the house number, the birth month and the
  postcode, and those four answers are kept as well, because the team uses
  them as research variables. House number plus postcode is a home address,
  so they live only on the consent record (`labConsents`, coordinators and
  auditors) and in `social-media-break/identifying/consents.tsv`, never in
  the `social-media-break/donations/` research dataset, which carries the
  code alone. The approved information
  sheet does not yet mention keeping them.
* **Free text.** The parent's open answer (up to 500 characters) may contain
  names or details about other people despite the request not to include
  them. It sits in `surveys/` with the participant id only; decide who reads
  it before researchers do.
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
* **Team emails.** Enquiry notifications go out through the team's Gmail
  account over SMTP, so copies sit in that account's Sent folder; it needs
  2-step verification and a mention in the DPIA. The password is held in
  Secret Manager, not in the code or in GitHub.
* **The export and OneDrive.** The hourly export is a second copy of all
  the data in a private bucket in London, and the OneDrive mirror a third,
  in the University's Microsoft 365. The DPIA should name both, and the
  OneDrive library should be restricted, unsynced except for the one Mac,
  and emptied of deleted files when a family withdraws.
* **Copies for families.** Nothing is emailed to families. The thank-you
  page builds a PDF of the record on the device, from what was recorded,
  for the family to download and keep; no personal data leaves the server
  for this.

## Cost

At the scale of a school-based study (thousands of families, a few
screenshots each) this sits inside or just above the free tier: Firestore
writes are a few per family, Storage is a few hundred KB per family, and the
functions run for a couple of seconds per send. Expect a few pounds a month
once traffic is real, dominated by Storage, plus a few pounds per thousand
screenshots for the Vision checks.
