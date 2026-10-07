#!/usr/bin/env bash
# One-off: stores the text message service's credentials (a Twilio account
# SID and auth token) in Secret Manager as "SID:TOKEN", and lets the
# functions read them. Nothing goes into the repository or GitHub. Run again
# to change them.
#
#   bash consent-app/firebase/scripts/set-sms-credentials.sh <project-id> [secret-name]
#
# Run in Cloud Shell (https://shell.cloud.google.com). Then set the sender as
# the repository variable MPMB_SMS_FROM (Settings → Secrets and variables →
# Actions → Variables): a Twilio phone number such as +447700900123, or a name
# of up to 11 letters and digits such as MyPhoneMB (UK networks show it
# instead of a number; replies are not possible). Redeploy the backend
# (Actions → Deploy Firebase backend → Run workflow) for the sender to apply.
# See docs/booking.md.
set -euo pipefail
PROJECT="${1:-}"; SECRET="${2:-mpmb-sms-credentials}"
[[ -n "$PROJECT" ]] || { echo "Usage: $0 <project-id> [secret-name]"; exit 1; }
ok() { printf '  ✓ %s\n' "$*"; }

gcloud services enable secretmanager.googleapis.com --project="$PROJECT" >/dev/null
read -r -p "Twilio account SID (starts AC): " SID
read -r -s -p "Twilio auth token (nothing is shown as you type): " TOKEN; echo
SID="${SID// /}"; TOKEN="${TOKEN// /}"
[[ "$SID" == AC* && ${#SID} -ge 30 ]] || { echo "That does not look like an account SID."; exit 1; }
[[ ${#TOKEN} -ge 16 ]] || { echo "That does not look like an auth token."; exit 1; }

if gcloud secrets describe "$SECRET" --project="$PROJECT" >/dev/null 2>&1; then
  printf '%s:%s' "$SID" "$TOKEN" | gcloud secrets versions add "$SECRET" --project="$PROJECT" --data-file=- >/dev/null
  ok "new version of $SECRET stored"
else
  printf '%s:%s' "$SID" "$TOKEN" | gcloud secrets create "$SECRET" --project="$PROJECT" --replication-policy=user-managed --locations=europe-west2 --data-file=- >/dev/null
  ok "$SECRET created in europe-west2"
fi

NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
gcloud secrets add-iam-policy-binding "$SECRET" --project="$PROJECT" --member="serviceAccount:$NUMBER-compute@developer.gserviceaccount.com" --role=roles/secretmanager.secretAccessor >/dev/null
ok "the functions may read it"
echo "Done. Once MPMB_SMS_FROM is set and the backend redeployed, the booking page offers text reminders."
echo "Test: on the staff page (Lab times → Check emails and texts arrive), send a test text to your phone."
