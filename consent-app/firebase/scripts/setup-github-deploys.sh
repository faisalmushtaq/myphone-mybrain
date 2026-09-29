#!/usr/bin/env bash
# One-off: lets GitHub Actions deploy the Firebase rules and functions on
# every push to main, with no keys to paste anywhere. Uses Workload Identity
# Federation: GitHub proves which repository a job runs for, and Google lets
# that repository act as a deploy-only service account.
#
#   bash consent-app/firebase/scripts/setup-github-deploys.sh <project-id> [owner/repo]
#
# Run in Cloud Shell (https://shell.cloud.google.com). Safe to rerun.
set -euo pipefail
PROJECT="${1:-}"; REPO="${2:-faisalmushtaq/myphone-mybrain}"
[[ -n "$PROJECT" ]] || { echo "Usage: $0 <project-id> [owner/repo]"; exit 1; }
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
SA="github-deploy@$PROJECT.iam.gserviceaccount.com"
POOL="github"; PROVIDER="github-repo"

say "1. Service account that GitHub will act as"
gcloud iam service-accounts describe "$SA" --project="$PROJECT" >/dev/null 2>&1 || gcloud iam service-accounts create github-deploy --project="$PROJECT" --display-name="GitHub deploys" >/dev/null
ok "$SA"
for role in roles/firebase.admin roles/cloudfunctions.admin roles/run.admin roles/iam.serviceAccountUser roles/cloudscheduler.admin roles/artifactregistry.admin roles/cloudbuild.builds.editor roles/serviceusage.serviceUsageAdmin roles/firebaserules.admin roles/storage.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="$role" --condition=None >/dev/null 2>&1 || echo "  (could not grant $role)"
done
ok "deploy roles granted"

say "2. Trusting GitHub Actions for $REPO"
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --project="$PROJECT" >/dev/null
gcloud iam workload-identity-pools describe "$POOL" --project="$PROJECT" --location=global >/dev/null 2>&1 || gcloud iam workload-identity-pools create "$POOL" --project="$PROJECT" --location=global --display-name="GitHub Actions" >/dev/null
gcloud iam workload-identity-pools providers describe "$PROVIDER" --project="$PROJECT" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1 || gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --project="$PROJECT" --location=global --workload-identity-pool="$POOL" --display-name="GitHub" --issuer-uri="https://token.actions.githubusercontent.com" --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" --attribute-condition="assertion.repository=='$REPO'" >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$SA" --project="$PROJECT" --role=roles/iam.workloadIdentityUser --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO" >/dev/null
ok "jobs from $REPO may act as $SA"

say "Done. The workflow in .github/workflows/firebase-deploy.yml uses:"
echo "  workload_identity_provider: projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"
echo "  service_account:            $SA"
echo "If those differ from the workflow file, update it. From now on every push to main that touches"
echo "consent-app/firebase/ deploys the rules and functions; Actions tab → 'Deploy Firebase backend' runs it by hand."
