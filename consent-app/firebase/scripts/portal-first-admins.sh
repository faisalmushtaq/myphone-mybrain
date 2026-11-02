#!/usr/bin/env bash
# Sets up the staff portal's project managers and the permission that lets the
# portal open document copies. Paste into Google Cloud Shell
# (https://shell.cloud.google.com/?project=myphone-mybrain), which is already
# signed in as you; it needs nothing from this repository.
#
# 1. Makes each person below a project manager (creating their sign-in account
#    if needed; they then sign in at https://myphonemybrain.com/portal/ with the
#    emailed link). Keeps any study roles they already have.
# 2. Lets the functions' service account sign short-lived links to document
#    copies (Service Account Token Creator on itself).
set -euo pipefail
PROJECT=myphone-mybrain
gcloud config set project "$PROJECT" >/dev/null

WORK="$(mktemp -d)"
cd "$WORK"
npm init -y >/dev/null
npm install --silent firebase-admin@13 >/dev/null
cat > admins.mjs <<'JS'
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
const PEOPLE = [
  ['S.A.Ali1@leeds.ac.uk', 'Sarmad Ali'],
  ['f.mushtaq@leeds.ac.uk', 'Faisal Mushtaq'],
];
initializeApp({ projectId: 'myphone-mybrain' });
const auth = getAuth();
const db = getFirestore();
for (const [rawEmail, name] of PEOPLE) {
  const email = rawEmail.trim().toLowerCase();
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    user = await auth.createUser({ email, emailVerified: true, displayName: name });
  }
  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), portalRole: 'pm' });
  const ref = db.collection('portalUsers').doc(user.uid);
  const had = await ref.get();
  await ref.set({ email, name, phone: had.data()?.phone ?? '', requested: 'team', role: 'pm', status: 'active', smsOptIn: false, archivedAt: null, ...(had.exists ? {} : { createdAt: FieldValue.serverTimestamp() }), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection('portalAudit').add({ at: FieldValue.serverTimestamp(), by: 'script', byEmail: '', byName: 'portal-first-admins.sh', action: 'set-role', target: user.uid, details: { role: 'pm', email } });
  console.log(`${name} (${email}) is a project manager on the portal.`);
}
JS
node admins.mjs

NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
SA="${NUMBER}-compute@developer.gserviceaccount.com"
gcloud iam service-accounts add-iam-policy-binding "$SA" --member="serviceAccount:$SA" --role=roles/iam.serviceAccountTokenCreator --quiet >/dev/null
echo "The functions' service account ($SA) can now sign links to document copies."
echo "Done. Sign in at https://myphonemybrain.com/portal/ once the portal is live."
