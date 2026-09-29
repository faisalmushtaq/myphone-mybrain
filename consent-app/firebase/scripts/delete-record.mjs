#!/usr/bin/env node
// Deletes everything stored for one reference code: the participant, every
// consent, assent, survey and donation record, the images and signatures in
// Storage, any queued email, and the submission row. For test records only:
// a real withdrawal is a separate process agreed with ethics, and is recorded
// by appending, never by deleting.
//
//   node consent-app/firebase/scripts/delete-record.mjs <project-id> MPMB-XXXX-XXX [MPMB-YYYY-YYY ...]
//
// Run where Application Default Credentials exist for a project Owner:
// Cloud Shell has them; a laptop needs `gcloud auth application-default login`.
// Needs the functions' dependencies: npm --prefix consent-app/firebase/functions ci
import { createRequire } from 'node:module';
import path from 'node:path';

const [project, ...codes] = process.argv.slice(2);
if (!project || !codes.length) {
  console.error('Usage: delete-record.mjs <project-id> <reference-code> [more codes]');
  process.exit(1);
}
const require = createRequire(path.join(path.dirname(new URL(import.meta.url).pathname), '../functions/node_modules/x.js'));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
initializeApp({ projectId: project, storageBucket: `${project}.firebasestorage.app` });
const db = getFirestore();
const bucket = getStorage().bucket();

for (const code of codes) {
  const subRef = db.collection('submissions').doc(code);
  const sub = (await subRef.get()).data();
  if (!sub) {
    console.log(`${code}: no submission found`);
    continue;
  }
  const { participantId } = sub;
  let docs = 0;
  for (const coll of ['consents', 'assents', 'surveys', 'donations']) {
    const snap = await db.collection(coll).where('participantId', '==', participantId).get();
    for (const d of snap.docs) {
      await d.ref.delete();
      docs += 1;
    }
  }
  const mail = await db.collection('mail').where('message.subject', '>=', `MyPhone/MyBrain: your permission has been recorded (${code})`).where('message.subject', '<=', `MyPhone/MyBrain: your permission has been recorded (${code})`).get();
  for (const d of mail.docs) {
    await d.ref.delete();
    docs += 1;
  }
  await db.collection('participants').doc(participantId).delete();
  await subRef.delete();
  docs += 2;
  let files = 0;
  for (const prefix of [`donations/${participantId}/`, `signatures/${participantId}/`]) {
    const [list] = await bucket.getFiles({ prefix });
    for (const f of list) {
      await f.delete({ ignoreNotFound: true });
      files += 1;
    }
  }
  if (sub.sessionUid) {
    const [q] = await bucket.getFiles({ prefix: `quarantine/${sub.sessionUid}/` });
    for (const f of q) {
      await f.delete({ ignoreNotFound: true });
      files += 1;
    }
  }
  console.log(`${code}: deleted ${docs} documents and ${files} files (participant ${participantId})`);
}
