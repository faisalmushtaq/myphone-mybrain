#!/usr/bin/env bash
# One-off: makes the staff portal's push notification keys (VAPID, docs/portal.md,
# "Notifications"). The private key goes into Secret Manager (mpmb-push-private-key)
# for the functions to read; the public key is printed, to be set as the GitHub
# repository variable MPMB_PUSH_PUBLIC_KEY (Settings → Secrets and variables →
# Actions → Variables), after which the next deploy switches push on. Nothing
# goes into the repository. Running it again makes new keys, and every device
# then has to turn notifications on again, so only do that if the old private
# key has leaked.
#
#   bash consent-app/firebase/scripts/set-push-keys.sh <project-id>
#
# Run in Cloud Shell (https://shell.cloud.google.com), which has Node.js.
set -euo pipefail
PROJECT="${1:-}"; SECRET="mpmb-push-private-key"
[[ -n "$PROJECT" ]] || { echo "Usage: $0 <project-id>"; exit 1; }
ok() { printf '  ✓ %s\n' "$*"; }

gcloud services enable secretmanager.googleapis.com --project="$PROJECT" >/dev/null
WORK="$(mktemp -d)"
( cd "$WORK" && npm init -y >/dev/null && npm install --silent web-push@3 >/dev/null )
KEYS="$(cd "$WORK" && npx --no-install web-push generate-vapid-keys --json)"
PUBLIC="$(printf '%s' "$KEYS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).publicKey))')"
PRIVATE="$(printf '%s' "$KEYS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).privateKey))')"
rm -rf "$WORK"

if gcloud secrets describe "$SECRET" --project="$PROJECT" >/dev/null 2>&1; then
  printf '%s' "$PRIVATE" | gcloud secrets versions add "$SECRET" --project="$PROJECT" --data-file=- >/dev/null
  ok "new version of $SECRET stored"
else
  printf '%s' "$PRIVATE" | gcloud secrets create "$SECRET" --project="$PROJECT" --replication-policy=user-managed --locations=europe-west2 --data-file=- >/dev/null
  ok "$SECRET created in europe-west2"
fi
NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
gcloud secrets add-iam-policy-binding "$SECRET" --project="$PROJECT" --member="serviceAccount:$NUMBER-compute@developer.gserviceaccount.com" --role=roles/secretmanager.secretAccessor >/dev/null
ok "the functions may read it"
echo
echo "Now set this as the GitHub repository variable MPMB_PUSH_PUBLIC_KEY, then deploy:"
echo
echo "  $PUBLIC"
echo
