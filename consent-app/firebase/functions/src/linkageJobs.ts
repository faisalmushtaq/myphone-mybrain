import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { runLinkage } from './linkageStore.js';

const REGION = 'europe-west2';

/** Every hour at ten to (before the export at five past): MySelf brought up to date, then matching. */
export const linkageHourly = onSchedule({ region: REGION, schedule: '50 * * * *', timeZone: 'Europe/London', memory: '1GiB', timeoutSeconds: 300 }, async () => {
  const r = await runLinkage(getFirestore(), { syncMyself: true });
  logger.info('Linkage run', { ...r, myself: { synced: r.myself.synced, participants: r.myself.participants } });
});

/** How many website records, opt-outs and class lists there are: when it changes, there is something new to match. */
export async function websiteSignature(db: Firestore): Promise<string> {
  const counts = await Promise.all(['participants', 'optOuts', 'schoolUploads'].map(async (c) => (await db.collection(c).count().get()).data().count));
  return counts.join('/');
}

/**
 * New website data, matched within ten minutes: three counts every ten
 * minutes, and a run only when they changed (MySelf as last read). A
 * scheduled check rather than a Firestore trigger, so the deploy needs
 * nothing beyond what the other scheduled functions already use.
 */
export const linkageOnNewData = onSchedule({ region: REGION, schedule: 'every 10 minutes', timeZone: 'Europe/London', memory: '1GiB', timeoutSeconds: 300 }, async () => {
  const db = getFirestore();
  const signature = await websiteSignature(db);
  const state = await db.collection('linkMeta').doc('state').get();
  if (state.data()?.websiteSignature === signature) return;
  const r = await runLinkage(db, {});
  if (r.busy) return;
  await state.ref.set({ websiteSignature: signature }, { merge: true });
  logger.info('Linkage: new website data matched', { signature, newPeople: r.newPeople, autoLinks: r.autoLinks });
});
