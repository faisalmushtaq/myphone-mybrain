#!/usr/bin/env bash
# Lets the staff portal's linkage registry READ MySelf (4 November 2026).
#
# Paste into Google Cloud Shell (https://shell.cloud.google.com/), signed in as
# someone who can change IAM on the MySelf projects (an Owner of
# myself-research and, if it exists, myself-identity). It needs nothing from
# this repository.
#
#   bash grant-myself-read.sh [research-project] [identity-project]
#   defaults: myself-research myself-identity
#
# It gives myphone-mybrain's functions service account
# (<project number>-compute@developer.gserviceaccount.com) Cloud Datastore
# Viewer (roles/datastore.viewer) on each project: read-only, Firestore only.
# The portal then reads, per participant code: sites, sitting dates, release
# and UPN; it reads names and dates of birth only into memory, to match and
# when a reviewer asks, and never stores them. Undo with the same command
# and "remove-iam-policy-binding".
set -euo pipefail
PORTAL=myphone-mybrain
RESEARCH="${1:-myself-research}"
IDENTITY="${2:-myself-identity}"

NUMBER="$(gcloud projects describe "$PORTAL" --format='value(projectNumber)')"
SA="${NUMBER}-compute@developer.gserviceaccount.com"
echo "The portal's functions run as $SA"

for P in "$RESEARCH" "$IDENTITY"; do
  if ! gcloud projects describe "$P" >/dev/null 2>&1; then
    echo "  $P: not found, or you cannot see it: skipped. (MySelf's identity project may not be set up yet; run this again once it is.)"
    continue
  fi
  gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$SA" --role=roles/datastore.viewer --condition=None --quiet >/dev/null
  echo "  $P: the portal can now read its Firestore (Cloud Datastore Viewer)."
done
echo "Done. In the portal: School study > Linkage > MySelf > Check the connection, then Run matching now."
