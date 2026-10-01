#!/usr/bin/env bash
# Sets up the Firebase project for the MyPhone/MyBrain consent app with as
# few console clicks as possible. Designed for Google Cloud Shell
# (https://shell.cloud.google.com), which is already signed in as you and has
# gcloud, node, npm and the Firebase CLI installed. It also works on a laptop
# with gcloud and firebase-tools.
#
#   bash consent-app/firebase/scripts/setup-project.sh <project-id> [billing-account-id]
#
# It is safe to run more than once: every step checks before it changes
# anything. Steps that need a person (a card for billing, the Auth
# "Get started" click if the API refuses) print the exact link and wait.
set -euo pipefail

PROJECT="${1:-}"
BILLING="${2:-}"
REGION="europe-west2"
DOMAIN="myphonemybrain.com"
REPO="faisalmushtaq/myphone-mybrain"
HERE="$(cd "$(dirname "$0")/.." && pwd)"   # consent-app/firebase

if [[ -z "$PROJECT" ]]; then
  echo "Usage: $0 <project-id> [billing-account-id]"
  echo "  project-id: lower-case letters, digits and hyphens, globally unique, e.g. myphone-mybrain-leeds"
  echo "  billing-account-id: from 'gcloud billing accounts list' (optional; needed for Storage and Functions)"
  exit 1
fi

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1. In Cloud Shell it is preinstalled; on a laptop install it first."; exit 1; }; }
need gcloud; need node; need npm
FIREBASE="firebase"
command -v firebase >/dev/null 2>&1 || FIREBASE="npx --yes firebase-tools@15"

say "1. Signing in"
if ! gcloud auth print-access-token >/dev/null 2>&1; then gcloud auth login; fi
ACCOUNT="$(gcloud config get-value account 2>/dev/null)"
ok "gcloud as $ACCOUNT"
if ! $FIREBASE projects:list >/dev/null 2>&1; then $FIREBASE login --no-localhost; fi
ok "firebase CLI signed in"

say "2. Project $PROJECT"
if gcloud projects describe "$PROJECT" >/dev/null 2>&1; then
  ok "Google Cloud project exists"
else
  gcloud projects create "$PROJECT" --name="MyPhone/MyBrain" --set-as-default >/dev/null
  ok "Google Cloud project created"
fi
gcloud config set project "$PROJECT" >/dev/null 2>&1
if $FIREBASE projects:list 2>/dev/null | grep -q "$PROJECT"; then
  ok "Firebase is enabled on it"
else
  $FIREBASE projects:addfirebase "$PROJECT" >/dev/null
  ok "Firebase added to the project"
fi

say "3. Billing (the Blaze plan is simply a billing account linked to the project)"
if gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null | grep -qi true; then
  ok "billing already linked"
elif [[ -n "$BILLING" ]]; then
  gcloud billing projects link "$PROJECT" --billing-account="$BILLING" >/dev/null
  ok "linked billing account $BILLING"
else
  echo "  No billing account given. Your accounts:"
  gcloud billing accounts list 2>/dev/null || true
  echo "  If the list is empty, create one (needs a card, or the University's account) at:"
  echo "    https://console.cloud.google.com/billing?project=$PROJECT"
  echo "  Then re-run this script with the account id (looks like 0X0X0X-0X0X0X-0X0X0X) as the second argument,"
  echo "  or upgrade in the Firebase console: https://console.firebase.google.com/project/$PROJECT/usage/details"
  read -r -p "  Press Enter once billing is linked, or Ctrl-C to stop here... "
fi

say "4. Enabling the Google APIs the backend uses"
gcloud services enable \
  firestore.googleapis.com storage.googleapis.com firebasestorage.googleapis.com identitytoolkit.googleapis.com \
  cloudfunctions.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com run.googleapis.com \
  eventarc.googleapis.com pubsub.googleapis.com cloudscheduler.googleapis.com firebaserules.googleapis.com \
  compute.googleapis.com --project="$PROJECT" >/dev/null
ok "APIs enabled"
# On new projects Cloud Build runs as the default compute service account, which needs the builder role to build the functions.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
COMPUTE_SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"
for role in roles/cloudbuild.builds.builder roles/logging.logWriter roles/artifactregistry.writer roles/storage.objectAdmin; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$COMPUTE_SA" --role="$role" --condition=None >/dev/null 2>&1 || echo "  (could not grant $role to $COMPUTE_SA; grant it in IAM if the functions fail to build)"
done
ok "build permissions for $COMPUTE_SA"

say "5. Firestore in $REGION"
if gcloud firestore databases describe --database='(default)' --project="$PROJECT" >/dev/null 2>&1; then
  ok "database exists"
else
  gcloud firestore databases create --location="$REGION" --type=firestore-native --project="$PROJECT" >/dev/null
  ok "database created in $REGION"
fi

say "6. Storage bucket in $REGION"
BUCKET="$PROJECT.firebasestorage.app"
TOKEN="$(gcloud auth print-access-token)"
if gcloud storage buckets describe "gs://$BUCKET" --project="$PROJECT" >/dev/null 2>&1; then
  ok "bucket gs://$BUCKET exists"
else
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --project="$PROJECT" >/dev/null
  ok "bucket gs://$BUCKET created"
fi
LINK="$(curl -sS -X POST "https://firebasestorage.googleapis.com/v1beta/projects/$PROJECT/buckets/$BUCKET:addFirebase" \
  -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" -H "Content-Type: application/json" -d '{}')"
if echo "$LINK" | grep -q '"name"'; then ok "bucket linked to Firebase Storage"; 
elif echo "$LINK" | grep -qi 'already'; then ok "bucket already linked to Firebase Storage";
else echo "  Could not link the bucket automatically ($LINK). Open https://console.firebase.google.com/project/$PROJECT/storage and click Get started, choosing $REGION."; fi

say "7. Anonymous sign-in and the authorised domain"
AUTH_BODY="{\"signIn\":{\"anonymous\":{\"enabled\":true}},\"authorizedDomains\":[\"localhost\",\"$PROJECT.firebaseapp.com\",\"$PROJECT.web.app\",\"$DOMAIN\"]}"
auth_patch() {
  curl -sS -X PATCH "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT/config?updateMask=signIn.anonymous.enabled,authorizedDomains" \
    -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" -H "Content-Type: application/json" -d "$AUTH_BODY"
}
RESP="$(auth_patch)"
if echo "$RESP" | grep -q '"authorizedDomains"'; then
  ok "anonymous sign-in on, $DOMAIN authorised"
else
  echo "  The Auth API needs the one-off 'Get started' click first:"
  echo "    https://console.firebase.google.com/project/$PROJECT/authentication"
  read -r -p "  Click Get started there, then press Enter to continue... "
  TOKEN="$(gcloud auth print-access-token)"
  RESP="$(auth_patch)"
  if echo "$RESP" | grep -q '"authorizedDomains"'; then ok "anonymous sign-in on, $DOMAIN authorised"; else echo "  Still refused: $RESP"; echo "  Enable Anonymous under Sign-in method and add $DOMAIN under Settings → Authorized domains by hand."; fi
fi

say "8. Web app and its settings"
APP_ID="$($FIREBASE apps:list WEB --project "$PROJECT" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s).result||[];console.log(r.length?r[0].appId:"")}catch{console.log("")}})')"
if [[ -z "$APP_ID" ]]; then
  APP_ID="$($FIREBASE apps:create WEB "Consent app" --project "$PROJECT" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).result.appId)})')"
  ok "web app registered ($APP_ID)"
else
  ok "web app exists ($APP_ID)"
fi
CONFIG="$($FIREBASE apps:sdkconfig WEB "$APP_ID" --project "$PROJECT" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s).result.sdkConfig;console.log([`MPMB_BACKEND=firebase`,`FIREBASE_API_KEY=${c.apiKey}`,`FIREBASE_PROJECT_ID=${c.projectId}`,`FIREBASE_APP_ID=${c.appId}`,`FIREBASE_AUTH_DOMAIN=${c.authDomain}`,`FIREBASE_STORAGE_BUCKET=${c.storageBucket||c.projectId+".firebasestorage.app"}`].join("\n"))})')"
echo "$CONFIG" > "$HERE/.site-variables.txt"
ENV_FILE="$HERE/../.env.production"
{
  echo "# Firebase settings for the live site, written by firebase/scripts/setup-project.sh."
  echo "# Public identifiers (they are in the page anyway); access is governed by the security rules. Commit this file."
  echo "$CONFIG" | sed 's/^MPMB_BACKEND=/VITE_MPMB_BACKEND=/; s/^FIREBASE_/VITE_FIREBASE_/'
} > "$ENV_FILE"
ok "settings written to consent-app/.env.production (commit it to point the live site at this project)"

say "9. Deploying the security rules and the Cloud Functions"
[[ -f "$HERE/functions/.env" ]] || cp "$HERE/functions/.env.example" "$HERE/functions/.env"
(cd "$HERE/functions" && npm ci --silent)
(cd "$HERE" && $FIREBASE deploy --only firestore:rules,storage --project "$PROJECT" --force)
ok "security rules deployed"
DEPLOYED=""
for attempt in 1 2 3; do
  if (cd "$HERE" && $FIREBASE deploy --only functions --project "$PROJECT" --force); then DEPLOYED=1; break; fi
  echo "  Attempt $attempt failed. The first deploy of several functions often races on the sources bucket; retrying in 30 seconds..."
  sleep 30
done
if [[ -z "$DEPLOYED" ]]; then
  echo "  The functions did not deploy. Show the build log with:"
  echo "    gcloud builds list --region=$REGION --project=$PROJECT --limit=3"
  echo "    gcloud builds log <BUILD_ID> --region=$REGION --project=$PROJECT"
  echo "  and paste it back."
  exit 1
fi
ok "functions deployed to $REGION"
# Callable functions must be invokable by anyone (Firebase Auth and App Check are checked inside them). A deploy that
# failed half-way can leave the service without that setting, which shows up as a plain "401 Unauthorized" page.
for fn in submitconsent submitdonation enquiry; do
  gcloud run services add-iam-policy-binding "$fn" --region="$REGION" --member=allUsers --role=roles/run.invoker --project="$PROJECT" --quiet >/dev/null 2>&1 \
    && ok "$fn is invokable by the website" || echo "  (could not set the invoker on $fn; run: gcloud run services add-iam-policy-binding $fn --region=$REGION --member=allUsers --role=roles/run.invoker --project=$PROJECT)"
done

say "9b. Checking the functions answer"
API_KEY="$(echo "$CONFIG" | sed -n 's/^FIREBASE_API_KEY=//p')"
ID_TOKEN="$(curl -sS -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$API_KEY" -H 'Content-Type: application/json' -d '{"returnSecureToken":true}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).idToken||""))')"
for fn in submitConsent submitDonation; do
  BODY="$(curl -sS -X POST "https://$REGION-$PROJECT.cloudfunctions.net/$fn" -H "Authorization: Bearer $ID_TOKEN" -H 'Content-Type: application/json' -d '{"data":{}}')"
  if echo "$BODY" | grep -q '"status":"INVALID_ARGUMENT"'; then ok "$fn answers (rejects an empty request, as it should)"; else echo "  ✗ $fn did not answer as expected: $(echo "$BODY" | head -c 160)"; fi
done
ENQ="$(curl -sS -X POST "https://$REGION-$PROJECT.cloudfunctions.net/enquiry" -H 'Content-Type: application/json' -H "Origin: https://$DOMAIN" -d '{}')"
if echo "$ENQ" | grep -q '"ok":false'; then ok "enquiry answers (rejects an empty form, as it should)"; else echo "  ✗ enquiry did not answer as expected: $(echo "$ENQ" | head -c 160)"; fi

say "10. Pointing the website at the project"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  (cd "$HERE/../.." && git add consent-app/.env.production && git -c user.name="setup-project" -c user.email="setup@myphonemybrain.com" commit -q -m "Point the live site at the Firebase project" && git push -q) && ok "committed and pushed consent-app/.env.production; the site is rebuilding: https://github.com/$REPO/actions"
else
  echo "  Commit consent-app/.env.production to the repository, or paste its contents to Claude, who can. Its contents:"
  echo
  sed 's/^/    /' "$ENV_FILE"
  echo
fi

say "Done. Still by hand, when you are ready:"
echo "  • App Check (reCAPTCHA v3):  https://console.firebase.google.com/project/$PROJECT/appcheck"
echo "  • Photo checks (Vision API): https://console.cloud.google.com/apis/library/vision.googleapis.com?project=$PROJECT  then MPMB_VISION=true in functions/.env and redeploy"
echo "  • Emails to the team about website enquiries: bash consent-app/firebase/scripts/set-mail-password.sh $PROJECT (stores the Gmail app password)"
echo "  • Budget alert:              https://console.cloud.google.com/billing/budgets?project=$PROJECT"
echo "  • Test the live form:        https://$DOMAIN/take-part/consent/  then look in https://console.firebase.google.com/project/$PROJECT/firestore"
