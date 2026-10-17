# Testing against real Google servers (a separate test project)

The swarm tests (`scripts/swarm-test.mjs` for families, `scripts/swarm-lab.mjs`
for the break study) normally run against the Firebase emulators on one
computer. That shows the website and the functions behave correctly under a
crowd and on a bad connection, but not how Google's real servers cope: cold
starts, many copies of a function at once, real Storage and Firestore limits.

For that, the same tests can run against a **separate Firebase project made
for testing**. Never the live project: the tests make hundreds of made-up
records, bookings and stories, and both scripts refuse to run against
`myphone-mybrain`.

## What it costs

A run of 100 families and 40 break-study participants is a few hundred
function calls and a few hundred megabytes of storage: pennies on the Blaze
(pay as you go) plan. Set a budget alert of £10 on the test project to be safe.
The AI chat is left out unless asked for (`SWARM_CHAT=1`): it would call the
real model and needs its own OpenAI key in the test project.

## 1. Make the test project (once, about 15 minutes)

In Google Cloud Shell (https://shell.cloud.google.com), with this repository
cloned:

```bash
MPMB_TEST_PROJECT=1 bash consent-app/firebase/scripts/setup-project.sh mpmb-test-<something> <billing-account-id>
```

This is the same set-up as the live project (Firestore and Storage in London,
anonymous sign-in, the rules and all the functions), but it writes the test
project's web settings to `consent-app/.env.test-project` (never committed)
and leaves the live site's settings alone. Then give the test project its own
staff key:

```bash
bash consent-app/firebase/scripts/set-staff-key.sh mpmb-test-<something>
```

Leave App Check off in the test project: the tests drive a browser with no
reCAPTCHA.

## 2. A key for the checks

The tests read the records back to check them, which needs a service account
key for the **test** project only:

```bash
gcloud iam service-accounts create swarm-checks --project=mpmb-test-<something>
gcloud projects add-iam-policy-binding mpmb-test-<something> --member=serviceAccount:swarm-checks@mpmb-test-<something>.iam.gserviceaccount.com --role=roles/datastore.user
gcloud projects add-iam-policy-binding mpmb-test-<something> --member=serviceAccount:swarm-checks@mpmb-test-<something>.iam.gserviceaccount.com --role=roles/storage.objectViewer
gcloud iam service-accounts keys create ~/swarm-checks.json --iam-account=swarm-checks@mpmb-test-<something>.iam.gserviceaccount.com
```

Keep `~/swarm-checks.json` out of the repository and delete the key when the
testing is done.

## 3. Run the tests

From `consent-app/`, with the settings from `.env.test-project`:

```bash
set -a; . ./.env.test-project; set +a
export SWARM_PROJECT=mpmb-test-<something> GOOGLE_APPLICATION_CREDENTIALS=~/swarm-checks.json
SWARM_FAMILIES=100 SWARM_AT_ONCE=25 node scripts/swarm-test.mjs
SWARM_FAMILIES=100 SWARM_AT_ONCE=25 SWARM_CHAOS=1 node scripts/swarm-test.mjs
SWARM_STAFF_KEY=<the test project's staff key> SWARM_PEOPLE=40 SWARM_AT_ONCE=12 node scripts/swarm-lab.mjs
```

Each prints its checks and writes a report (`swarm-report.json`,
`swarm-lab-report.json`). The hourly export and the data health check run on
the test project as on the live one: an hour later, `DATA HEALTH.txt` in the
test project's export bucket says whether everything still checks out.

## 4. Afterwards

Delete the test project (Firebase console → Project settings → Delete
project), or keep it for the next round of changes. Either way, delete the
service account key.
