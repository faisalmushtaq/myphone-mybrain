#!/usr/bin/env bash
# One-off: the private bucket the nightly data export is written to, and a
# read-only key for the one computer that mirrors it into the team's OneDrive
# folder (see mac-sync-install.sh). The key can read that bucket and nothing
# else. Safe to rerun; rerun to rotate the key.
#
#   bash consent-app/firebase/scripts/setup-exports.sh <project-id> [bucket-name]
#
# Run in Cloud Shell (https://shell.cloud.google.com).
set -euo pipefail
PROJECT="${1:-}"; BUCKET="${2:-$PROJECT-exports}"
[[ -n "$PROJECT" ]] || { echo "Usage: $0 <project-id> [bucket-name]"; exit 1; }
SA="exports-reader@$PROJECT.iam.gserviceaccount.com"
KEY="$HOME/mpmb-exports-key.json"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }

say "1. The export bucket"
if gcloud storage buckets describe "gs://$BUCKET" --project="$PROJECT" >/dev/null 2>&1; then
  ok "gs://$BUCKET exists"
else
  gcloud storage buckets create "gs://$BUCKET" --project="$PROJECT" --location=europe-west2 --uniform-bucket-level-access --public-access-prevention >/dev/null
  ok "gs://$BUCKET created in London, private"
fi

say "2. A read-only identity for the computer that mirrors it"
gcloud iam service-accounts describe "$SA" --project="$PROJECT" >/dev/null 2>&1 || gcloud iam service-accounts create exports-reader --project="$PROJECT" --display-name="Reads the data export bucket" >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role=roles/storage.objectViewer >/dev/null
ok "$SA may read gs://$BUCKET and nothing else"

existing="$(gcloud iam service-accounts keys list --iam-account="$SA" --project="$PROJECT" --managed-by=user --format='value(name)' | wc -l | tr -d ' ')"
if [[ "$existing" != "0" ]]; then
  read -r -p "A key already exists. Make a new one and cancel the old ($existing)? The computer using the old key must be set up again. [y/N] " answer
  [[ "${answer:-N}" =~ ^[Yy]$ ]] || { echo "Keeping the existing key."; exit 0; }
  gcloud iam service-accounts keys list --iam-account="$SA" --project="$PROJECT" --managed-by=user --format='value(name)' | while read -r key; do gcloud iam service-accounts keys delete "$key" --iam-account="$SA" --project="$PROJECT" --quiet >/dev/null; done
  ok "old keys cancelled"
fi
gcloud iam service-accounts keys create "$KEY" --iam-account="$SA" --project="$PROJECT" >/dev/null
chmod 600 "$KEY"
ok "key saved to $KEY (in this Cloud Shell only)"

say "3. First export"
if gcloud scheduler jobs run "firebase-schedule-exportData-europe-west2" --location=europe-west2 --project="$PROJECT" --quiet >/dev/null 2>&1; then
  ok "export started; it takes a minute. The bucket then holds README.md, manifest.json, identifying/ and research/"
else
  echo "  (the export schedule is not deployed yet; the first export runs after the next backend deploy, then nightly at 02:30)"
fi

say "Done. Next, on the Mac that will hold the OneDrive copy:"
echo "  1. Download the key from Cloud Shell: menu ⋮ (top right) → Download → enter  $KEY"
echo "  2. In Terminal on the Mac, with the downloaded file in Downloads:"
echo "       curl -fsSL https://raw.githubusercontent.com/faisalmushtaq/myphone-mybrain/main/consent-app/firebase/scripts/mac-sync-install.sh -o ~/Downloads/mac-sync-install.sh"
echo "       bash ~/Downloads/mac-sync-install.sh ~/Downloads/mpmb-exports-key.json $BUCKET"
echo "  3. Delete the key from Cloud Shell and Downloads once it is installed: rm $KEY"
