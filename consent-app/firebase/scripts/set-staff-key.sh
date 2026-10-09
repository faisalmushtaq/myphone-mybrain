#!/usr/bin/env bash
# One-off: makes the staff key for the research team's page
# (myphonemybrain.com/break/staff/), stores it in Secret Manager, lets the
# functions read it, and prints it once. Share it only within the team, for
# example in the team's password manager. Nothing goes into the repository or
# GitHub. Run again to replace it (the old key stops working within ten
# minutes).
#
#   bash consent-app/firebase/scripts/set-staff-key.sh <project-id> [secret-name]
#
# Run in Cloud Shell (https://shell.cloud.google.com).
set -euo pipefail
PROJECT="${1:-}"; SECRET="${2:-mpmb-staff-key}"
[[ -n "$PROJECT" ]] || { echo "Usage: $0 <project-id> [secret-name]"; exit 1; }
ok() { printf '  ✓ %s\n' "$*"; }

gcloud services enable secretmanager.googleapis.com --project="$PROJECT" >/dev/null
# 32 random characters from an alphabet without look-alikes: about 160 bits.
# `head` closing the pipe early makes `tr` exit with SIGPIPE, which pipefail would treat as a failure and stop the script silently.
KEY="$(LC_ALL=C tr -dc 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789' </dev/urandom | head -c 32 || true)"
[[ ${#KEY} -eq 32 ]] || { echo "Could not make a key; please run the script again."; exit 1; }

if gcloud secrets describe "$SECRET" --project="$PROJECT" >/dev/null 2>&1; then
  printf '%s' "$KEY" | gcloud secrets versions add "$SECRET" --project="$PROJECT" --data-file=- >/dev/null
  ok "new version of $SECRET stored"
else
  printf '%s' "$KEY" | gcloud secrets create "$SECRET" --project="$PROJECT" --replication-policy=user-managed --locations=europe-west2 --data-file=- >/dev/null
  ok "$SECRET created in europe-west2"
fi

NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
gcloud secrets add-iam-policy-binding "$SECRET" --project="$PROJECT" --member="serviceAccount:$NUMBER-compute@developer.gserviceaccount.com" --role=roles/secretmanager.secretAccessor >/dev/null
ok "the functions may read it"
echo
echo "The staff key (shown only now; copy it into the team's password manager):"
echo
echo "    $KEY"
echo
echo "Sign in at https://myphonemybrain.com/break/staff/ with it. It works within a few minutes; no redeploy is needed."
