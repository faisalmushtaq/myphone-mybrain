#!/usr/bin/env bash
# One-off: stores the password the enquiry function sends email with (a Gmail
# app password by default) in Secret Manager, and lets the functions read it.
# Nothing goes into the repository or GitHub. Run again to change it.
#
#   bash consent-app/firebase/scripts/set-mail-password.sh <project-id> [secret-name]
#
# Run in Cloud Shell (https://shell.cloud.google.com). The sending account and
# the recipient are set in .github/workflows/firebase-deploy.yml (repository
# variables MPMB_SMTP_USER and MPMB_MAIL_TO, with defaults).
set -euo pipefail
PROJECT="${1:-}"; SECRET="${2:-mpmb-smtp-password}"
[[ -n "$PROJECT" ]] || { echo "Usage: $0 <project-id> [secret-name]"; exit 1; }
ok() { printf '  ✓ %s\n' "$*"; }

gcloud services enable secretmanager.googleapis.com --project="$PROJECT" >/dev/null
read -r -s -p "Paste the app password (spaces are fine; nothing is shown as you type): " PASS; echo
PASS="${PASS// /}"
[[ ${#PASS} -ge 8 ]] || { echo "That does not look like an app password."; exit 1; }

if gcloud secrets describe "$SECRET" --project="$PROJECT" >/dev/null 2>&1; then
  printf '%s' "$PASS" | gcloud secrets versions add "$SECRET" --project="$PROJECT" --data-file=- >/dev/null
  ok "new version of $SECRET stored"
else
  printf '%s' "$PASS" | gcloud secrets create "$SECRET" --project="$PROJECT" --replication-policy=user-managed --locations=europe-west2 --data-file=- >/dev/null
  ok "$SECRET created in europe-west2"
fi

NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
gcloud secrets add-iam-policy-binding "$SECRET" --project="$PROJECT" --member="serviceAccount:$NUMBER-compute@developer.gserviceaccount.com" --role=roles/secretmanager.secretAccessor >/dev/null
ok "the functions may read it"
echo "Done. Within about five minutes new website enquiries will be emailed to the team; no redeploy is needed."
echo "Test: send a message through the contact form, then check the inbox. The stored record's 'notified' field says sent, failed or not-configured."
