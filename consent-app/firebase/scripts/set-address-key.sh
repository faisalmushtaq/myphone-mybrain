#!/usr/bin/env bash
# One-off: stores the Ideal Postcodes API key the address finder uses
# (docs/address-lookup.md) in Secret Manager, and lets the functions read it.
# Nothing goes into the repository or GitHub. Run again to change it.
#
#   bash consent-app/firebase/scripts/set-address-key.sh <project-id> [secret-name]
#
# Run in Cloud Shell (https://shell.cloud.google.com). The key is on the
# Ideal Postcodes dashboard (ideal-postcodes.co.uk), under API keys; it starts "ak_".
set -euo pipefail
PROJECT="${1:-}"; SECRET="${2:-mpmb-address-key}"
[[ -n "$PROJECT" ]] || { echo "Usage: $0 <project-id> [secret-name]"; exit 1; }
ok() { printf '  ✓ %s\n' "$*"; }

gcloud services enable secretmanager.googleapis.com --project="$PROJECT" >/dev/null
read -r -s -p "Paste the Ideal Postcodes API key (nothing is shown as you type): " KEY; echo
KEY="${KEY// /}"
[[ ${#KEY} -ge 8 ]] || { echo "That does not look like an API key."; exit 1; }

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
echo "Done. The address finder can use the key within about ten minutes; no redeploy is needed for that."
echo "The form shows the finder once VITE_MPMB_ADDRESS_LOOKUP=on in consent-app/.env.production is deployed (docs/address-lookup.md)."
