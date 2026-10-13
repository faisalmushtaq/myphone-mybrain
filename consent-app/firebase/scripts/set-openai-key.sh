#!/usr/bin/env bash
# One-off: stores the OpenAI API key MyStory's AI chat uses (docs/mystory.md,
# "The AI chat") in Secret Manager, and lets the functions read it. Nothing
# goes into the repository or GitHub. Run again to change it. Until it is
# stored, MyStory shows its own form instead of the chat.
#
#   bash consent-app/firebase/scripts/set-openai-key.sh <project-id> [secret-name]
#
# Run in Cloud Shell (https://shell.cloud.google.com). The key is on
# platform.openai.com, under API keys; it starts "sk-". It can be the same key
# MySelf's MyStory uses, or a separate one for this study (easier to watch
# and cap its spending on its own).
set -euo pipefail
PROJECT="${1:-}"; SECRET="${2:-mpmb-openai-key}"
[[ -n "$PROJECT" ]] || { echo "Usage: $0 <project-id> [secret-name]"; exit 1; }
ok() { printf '  ✓ %s\n' "$*"; }

gcloud services enable secretmanager.googleapis.com --project="$PROJECT" >/dev/null
read -r -s -p "Paste the OpenAI API key (nothing is shown as you type): " KEY; echo
KEY="${KEY// /}"
[[ ${#KEY} -ge 20 && "$KEY" == sk-* ]] || { echo "That does not look like an OpenAI API key (it starts sk-)."; exit 1; }

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
echo "Done. MyStory's AI chat can use the key within about ten minutes; no redeploy is needed."
