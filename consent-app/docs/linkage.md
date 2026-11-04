# The linkage registry

One study ID for each young person (`sub-0001`, `sub-0002` …) joining their
**website** record (consent, phone use), their **MySelf** survey codes and their
**EEG** recordings, kept online in the staff portal (School study › Linkage) for
the project manager and the research team. It feeds the BIDS export and is how
EEG collected elsewhere gets tied to the right young person.

It replaces the local script (`scripts/match-myself.mjs`, see
[myself-linkage.md](myself-linkage.md)) as the main route. The script still works
and gives the same automatic links (a test checks the two agree).

## Setup (once)

1. **Let the portal read MySelf.** Someone who owns the MySelf projects opens
   [Google Cloud Shell](https://shell.cloud.google.com/), pastes
   `consent-app/firebase/scripts/grant-myself-read.sh` and runs:

   ```
   bash grant-myself-read.sh myself-research myself-identity
   ```

   This gives myphone-mybrain's functions service account
   (`<project number>-compute@developer.gserviceaccount.com`) **Cloud Datastore
   Viewer** on both MySelf projects: read-only, Firestore only. If
   `myself-identity` is not set up yet the script says so and skips it; run it
   again once it is. (Other project IDs: set `MYSELF_RESEARCH_PROJECT`,
   `MYSELF_IDENTITY_PROJECT`, `MYSELF_STUDY` on the functions.)
2. **Map MySelf sites to schools.** Linkage › MySelf › "MySelf sites and the
   website's schools" (project manager): one line per site, `GSAL=GSAL`. A MySelf
   study code's letters are its site (GSAL01 is GSAL).
3. Linkage › Overview › **Run matching now**. After that it runs by itself.

Until step 1 is done, the MySelf page says **MySelf not connected**, gives the
command, and takes MySelf's own files instead: the BIDS `participants.tsv` and,
if available, the identifiers CSV. Both are read in the browser; only codes,
sites, first sitting date and UPN are kept, and the names are used for that one
matching run and dropped.

## What is read from where

| Source | Read | Kept here |
| --- | --- | --- |
| Website | `participants` (consenting), `optOuts`, `schoolUploads` (UPN and the school's legal name) | the study ID link only; names stay where they already are |
| MySelf research project | `studies/{study}/sessions`: sessionId, studyCode (site), releaseKey, startedAt | sites, sitting dates, releases |
| MySelf identity project | `studies/{study}/claims` (session to code) and `studies/{study}/participants` (code, UPN) | code, UPN |
| MySelf identity project, names | givenName, familyName, dateOfBirth, postcode | **never**: read into memory for a matching run, and for a reviewer who presses "Show MySelf's name" (logged) |
| EEG manifest | uploaded on Linkage › EEG recordings | recording id, names, date of birth, sex, ethnicity, recording date, site, task, file name; names removed 180 days after the recording has its study ID |

## How matching works

The engine is `firebase/functions/src/linkage.ts` (pure, tested in
`linkage.test.ts`); `linkageStore.ts` reads and writes Firestore. Every side works
out the MySelf-style ID with `myselfId.ts`.

Tiers, strongest first:

| Tier | Meaning | Links on its own? |
| --- | --- | --- |
| exact | the same MySelf-style ID (same names and date of birth) | yes, if unique on both sides and not a twin |
| variant | one side's ID is the other's under a usual slip: nickname, day and month swapped, names swapped, half a double-barrelled name, first of two first names, the school's legal name | the same |
| UPN | the same Unique Pupil Number | the same |
| fuzzy | Jaro-Winkler on names (allowing them swapped), date of birth (same, swapped, a digit off, within a week), same school or site, same postcode; sex and ethnicity only nudge near-ties | **never**: always reviewed |

* **Unique on both sides**: the record fits exactly one study ID, and no other new
  record fits that study ID at that tier. (Several EEG recordings of one child
  count as one.)
* **Twins never link on their own**: if another person or record has the same
  surname and date of birth under a different first name, every suggestion goes
  to a person, even an exact one.
* A second website record, or a second MySelf code, for someone who already has
  one always goes to review (registered twice? MySelf should merge the codes).
* Each new record either joins an existing study ID or, with nothing to ask
  about, gets a new one. A record with suggestions waits: it never gets an ID it
  might have to give back. IDs are given in order and never reused; a study ID
  whose records are all taken off is retired.
* Sources are taken in order: website, MySelf, EEG.
* **Decisions are final**: "Same person" links; "Different" means the pair is
  never suggested again (an unlink records "different" too).
* **Withdrawn**: a website opt-out (either kind) marks the study ID withdrawn.
  Its records stay linked (so new EEG still finds them), but it is left out of
  `linkage/participants.tsv` and its EEG rows say `withdrawn`.

It runs every hour (at 50 past, before the export at 5 past, reading MySelf
first), within ten minutes of new website data (a check every ten minutes), after every upload and decision,
and on "Run matching now". One run at a time.

## The pages

* **Overview**: counts, sources, "MySelf not connected" when it is not, Run
  matching now, search (study ID, name, website label or reference, MySelf code,
  UPN, EEG recording), and counts by school.
* **Review**: one suggestion at a time, side by side: the record without a study
  ID, and every record under the suggested ID; what the match rests on. Keys:
  **S** same person, **D** different, **K** skip.
* **Person** (`#linkage/person/sub-0001`): its records, how each joined, pending
  suggestions, history. The project manager can unlink a record, with a reason.
* **EEG recordings**: template download, upload (CSV or .xlsx; dates dd/mm/yyyy
  or other UK forms), and every recording with its study ID or status.
* **MySelf**: connection status (with the command), file upload, site mapping.
* **History**: every study ID given, link, decision, unlink, upload and look at a
  MySelf name.

## Exports

The hourly export writes:

* `linkage/participants.tsv` (+ `.json`): `participant_id` (sub-XXXX), sex, age at
  first contact, school id, year group, first contact year, which sources exist.
  No names; withdrawn left out.
* `linkage/eeg_map.tsv`: recording id → study ID and session (ses-01, ses-02 … by
  recording date), status, and a suggested BIDS path
  `sub-XXXX/ses-NN/eeg/sub-XXXX_ses-NN_task-<task>_eeg.<ext>`.
* `linkage/README.md`: including how to strip names from EDF/BDF/BrainVision
  headers before a file goes into the dataset.
* `linkage/identifying/crosswalk.tsv`: study ID → website labels and ids,
  reference codes, MySelf codes, UPNs, EEG recording ids.
* `linkage_id` in the website's `schools/donations/participants.tsv`.
* The Google Sheet's **Linkage** tab: counts by school and source, nothing
  identifying.

The Mac sync (`firebase/scripts/mac-sync-install.sh`) copies `linkage/` into
every folder; `linkage/identifying/` only into "all" folders (the University's
own storage), and deletes it anywhere else.

## Checks

* `npm --prefix consent-app/firebase/functions test` (linkage.test.ts: parity with
  the script, each tier, uniqueness, twins, decisions, EEG dates, stable IDs,
  withdrawal, MySelf join).
* `npm --prefix consent-app test` (linkageFiles.test.ts: the manifest and MySelf
  files, CSV and Excel).
* `node consent-app/scripts/linkage-e2e.mjs`: the emulators, a fake MySelf
  (`linkFakeMyself`), seeded website records and a manifest; walks the pages.

## Data protection (DPIA note)

* **Purpose and basis**: linking a young person's records across parts of one
  study they (and their parent or carer) agreed to, under the same lawful basis
  as the study. Nothing new is collected; EEG names already exist on the
  recording sheets.
* **Minimisation**: MySelf names, dates of birth and addresses are never stored
  in the portal: read into memory to match and, on request, to show a reviewer
  (logged in the History, before the read). The registry keeps MySelf codes,
  sites, sitting dates, releases and UPNs. EEG names are kept only until 180 days
  after the recording has its study ID, then removed automatically (the
  pseudonymous ID their name gave is kept, so the record stays matchable).
* **Access**: Firestore rules deny every client; only the portal's functions read
  the registry, and only for the project manager and the research team (research
  assistants are refused). Unlinking and settings are the project manager's.
  The functions' access to MySelf is read-only (Cloud Datastore Viewer) and can
  be removed at any time with `gcloud projects remove-iam-policy-binding`.
* **Location**: all Firebase projects involved are in europe-west2 (London).
* **Research outputs**: `linkage/participants.tsv` and `eeg_map.tsv` carry study IDs
  only; the crosswalk is in `identifying/`, which is copied only to the
  University's own storage. EEG files must have names stripped from their
  headers before they go into the dataset (linkage/README.md).
* **Withdrawal**: a website opt-out withdraws the study ID within the hour; its
  rows leave the research tables and its EEG is marked not to convert.
* **Accountability**: every automatic link, decision, unlink, upload and name
  look-up is in the linkage History (`linkAudit`) with who and when; user actions
  are also in the portal audit log.
