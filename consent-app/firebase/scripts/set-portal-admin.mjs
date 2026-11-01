#!/usr/bin/env node
// Makes someone a project manager on the staff portal (myphonemybrain.com/portal/):
// the first one, or another later. Creates their sign-in account if they have
// none yet (they then sign in with the emailed link), marks the account
// active with the project manager role, and sets the portalRole claim,
// keeping any study roles (coordinator, researcher, auditor) they already have.
//
//   node consent-app/firebase/scripts/set-portal-admin.mjs <project-id> <email> ["Full name"]
//
// Run where Application Default Credentials exist for a project Owner:
// Cloud Shell has them; a laptop needs `gcloud auth application-default login`.
// Needs the functions' dependencies: npm --prefix consent-app/firebase/functions ci
// Against the emulators: FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node … demo-mpmb you@leeds.ac.uk
import { createRequire } from 'node:module';
import path from 'node:path';

const [project, rawEmail, ...nameParts] = process.argv.slice(2);
if (!project || !rawEmail || !rawEmail.includes('@')) {
  console.error('Usage: set-portal-admin.mjs <project-id> <email> ["Full name"]');
  process.exit(1);
}
const email = rawEmail.trim().toLowerCase();
const require = createRequire(path.join(path.dirname(new URL(import.meta.url).pathname), '../functions/node_modules/x.js'));
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: project });
const auth = getAuth();
const db = getFirestore();

let user;
try {
  user = await auth.getUserByEmail(email);
} catch {
  user = await auth.createUser({ email, emailVerified: true });
  console.log(`Created a sign-in account for ${email}.`);
}
const claims = { ...(user.customClaims ?? {}), portalRole: 'pm' };
await auth.setCustomUserClaims(user.uid, claims);
const ref = db.collection('portalUsers').doc(user.uid);
const had = await ref.get();
const name = nameParts.join(' ').trim() || had.data()?.name || email;
await ref.set({ email, name, phone: had.data()?.phone ?? '', requested: 'team', role: 'pm', status: 'active', smsOptIn: false, archivedAt: null, ...(had.exists ? {} : { createdAt: FieldValue.serverTimestamp() }), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
await db.collection('portalAudit').add({ at: FieldValue.serverTimestamp(), by: 'script', byEmail: '', byName: 'set-portal-admin.mjs', action: 'set-role', target: user.uid, details: { role: 'pm', email } });
console.log(`${email} is a project manager on the portal. They sign in at https://myphonemybrain.com/portal/ with the emailed link.`);
