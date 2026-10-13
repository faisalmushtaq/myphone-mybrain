#!/usr/bin/env node
// Deletes everything stored for one break-study participant ID: the
// participant, consents, donations, check-ins, MyStory stories and chats
// (with their voice recordings), reminders, contact details, bookings, and
// their files in Storage. For TEST records only (such as the ones made when
// testing the live site): a real withdrawal is a separate process agreed with
// ethics, and is recorded, not deleted.
//
//   node consent-app/firebase/scripts/delete-lab-record.mjs <project-id> MPXXXXXXXXXXXX [MP... ...]
//
// Run where Application Default Credentials exist for a project Owner:
// Cloud Shell has them. Needs the functions' dependencies:
// npm --prefix consent-app/firebase/functions ci
// The hourly export drops the deleted records at its next run.
import { createRequire } from 'node:module';
import path from 'node:path';

const [project, ...codes] = process.argv.slice(2);
if (!project || !codes.length || !codes.every((c) => /^MP[0-9A-F]{12}$/.test(c))) {
  console.error('Usage: delete-lab-record.mjs <project-id> <participant ID, MP and 12 characters> [more IDs]');
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
  let docs = 0;
  let files = 0;
  const chats = await db.collection('labStoryChats').where('participantCode', '==', code).get();
  for (const chat of chats.docs) {
    const [voice] = await bucket.getFiles({ prefix: `labStoryVoice/${chat.id}/` });
    for (const f of voice) {
      await f.delete();
      files += 1;
    }
  }
  for (const coll of ['labConsents', 'labDonations', 'labCheckIns', 'labStories', 'labStoryChats', 'labBookings']) {
    const snap = await db.collection(coll).where('participantCode', '==', code).get();
    for (const d of snap.docs) {
      await d.ref.delete();
      docs += 1;
    }
  }
  for (const coll of ['labParticipants', 'labReminders', 'labContacts']) {
    const ref = db.collection(coll).doc(code);
    if ((await ref.get()).exists) {
      await ref.delete();
      docs += 1;
    }
  }
  for (const prefix of [`lab/${code}/`, `signatures/lab/${code}/`]) {
    const [found] = await bucket.getFiles({ prefix });
    for (const f of found) {
      await f.delete();
      files += 1;
    }
  }
  console.log(`${code}: ${docs} records and ${files} files deleted`);
}
