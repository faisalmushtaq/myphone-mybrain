import { createHash } from 'node:crypto';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { labStudy, storyLimits, storyStructures, type StoryPhase, type StorySignifier, type StoryStructure } from './forms.js';
import { normaliseCode, rateLimitLookups } from './lab.js';
import { mayRetellStory } from './testAccounts.js';
import { sendMail } from './mail.js';
import { isObj, str, validateClient, type ClientInfo } from './validate.js';

/**
 * MyStory: a short story in the participant's own words, then a few
 * "signifiers" placing it (a triangle of three things, sliders between two
 * ends, quick choices), with a different structure for each phase of the
 * break study (src/lab/mystory.ts in the app). Filed under the participant
 * ID, never a name.
 *
 *   labStories/{id}   one per story: phase, structure and version, the prompt
 *                     answered, title, story, and each signifier's answer
 *
 * Every signifier may be left out or answered "not sure" ('na'): a story is
 * worth keeping without them.
 */

const REGION = 'europe-west2';
const callOptions = { region: REGION, memory: '256MiB' as const, timeoutSeconds: 60, enforceAppCheck: process.env.MPMB_ENFORCE_APP_CHECK === 'true' };
const STORIES_PER_HOUR = 12;
/** Said when a participant who has told their story for a phase tries again (19 October 2026). */
export const alreadyToldMessage = `You have already sent your story for this part of the study. Each person tells one story for each part. If you need to change it, contact ${labStudy.contactName} at ${labStudy.contactEmail}.`;
const PHASES: StoryPhase[] = ['pre', 'mid', 'post'];
/** Where the story was told: the page it came from. */
const SOURCES = ['baseline', 'checkin', 'after', 'story', 'book'];
const DOC_ID = /^[A-Za-z0-9]{1,40}$/;

/** A triangle answer: how much of each corner, three shares adding up to 1. */
export type TriadAnswer = { a: number; b: number; c: number };
export type StoryAnswer = TriadAnswer | number | string | string[] | 'na';

export interface LabStoryPayload {
  participantCode: string;
  phase: StoryPhase;
  structureId: string;
  structureVersion: string;
  promptId: string;
  title: string;
  story: string;
  answers: Record<string, StoryAnswer>;
  source: string;
  checkInId?: string | null;
  client: ClientInfo;
}

function answerProblem(sig: StorySignifier, a: unknown): string | null {
  if (a === 'na') return null;
  switch (sig.type) {
    case 'triad': {
      if (!isObj(a) || !['a', 'b', 'c'].every((k) => typeof a[k] === 'number' && Number.isFinite(a[k]) && (a[k] as number) >= 0 && (a[k] as number) <= 1)) return `The answer to "${sig.id}" is not three shares.`;
      const sum = (a.a as number) + (a.b as number) + (a.c as number);
      return Math.abs(sum - 1) > 0.02 ? `The shares for "${sig.id}" do not add up to the whole.` : null;
    }
    case 'dyad':
      return typeof a === 'number' && Number.isFinite(a) && a >= 0 && a <= 100 ? null : `The answer to "${sig.id}" is not between 0 and 100.`;
    case 'choice': {
      const values = new Set(sig.options.map((o) => o.value));
      if (sig.multiple) return Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === 'string' && values.has(x)) && new Set(a).size === a.length ? null : `The answers to "${sig.id}" are not among its options.`;
      return typeof a === 'string' && values.has(a) ? null : `The answer to "${sig.id}" is not one of its options.`;
    }
  }
}

export function validateLabStoryPayload(input: unknown): string[] {
  const problems: string[] = [];
  if (!isObj(input)) return ['The story is not an object.'];
  const p = input as Partial<LabStoryPayload>;
  if (!normaliseCode(p.participantCode)) problems.push('The participant ID is malformed.');
  const phase = PHASES.includes(p.phase as StoryPhase) ? (p.phase as StoryPhase) : null;
  if (!phase) {
    problems.push('The phase of the study is missing or unknown.');
    return problems;
  }
  const structure: StoryStructure = storyStructures[phase];
  if (p.structureId !== structure.id || p.structureVersion !== structure.version) problems.push(`The story must use ${structure.id} ${structure.version}.`);
  if (!structure.prompts.some((x) => x.id === p.promptId)) problems.push('Choose one of the questions to answer.');
  if (!str(p.title, storyLimits.titleMax) || !(p.title as string).trim()) problems.push(`Give your story a title of up to ${storyLimits.titleMax} characters.`);
  if (typeof p.story !== 'string' || p.story.trim().length < storyLimits.storyMin) problems.push(`Tell your story in at least a sentence or two (${storyLimits.storyMin} characters or more).`);
  else if (p.story.length > storyLimits.storyMax) problems.push(`Please keep your story under ${storyLimits.storyMax} characters.`);
  if (!isObj(p.answers)) problems.push('The answers are malformed.');
  else {
    const byId = new Map(structure.signifiers.map((s) => [s.id, s]));
    for (const [id, a] of Object.entries(p.answers)) {
      const sig = byId.get(id);
      if (!sig) problems.push(`Unknown question "${id}".`);
      else {
        const problem = answerProblem(sig, a);
        if (problem) problems.push(problem);
      }
    }
  }
  if (!SOURCES.includes(String(p.source))) problems.push('The page the story came from is unknown.');
  if (p.checkInId !== null && p.checkInId !== undefined && (typeof p.checkInId !== 'string' || !DOC_ID.test(p.checkInId))) problems.push('The check-in reference is malformed.');
  validateClient(p.client, problems);
  return problems;
}

/** A triangle answer as stored: three shares rounded to three places, still adding up to 1. */
export function tidyTriad(a: TriadAnswer): TriadAnswer {
  const total = a.a + a.b + a.c;
  const r = (x: number) => Math.round((x / total) * 1000) / 1000;
  const out = { a: r(a.a), b: r(a.b), c: 0 };
  out.c = Math.round((1 - out.a - out.b) * 1000) / 1000;
  return out;
}

export const submitLabStory = onCall(callOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const problems = validateLabStoryPayload(request.data);
  if (problems.length) {
    logger.warn('Rejected story', { uid, problems });
    throw new HttpsError('invalid-argument', problems[0], { problems });
  }
  const p = request.data as LabStoryPayload;
  const code = normaliseCode(p.participantCode)!;
  const db = getFirestore();
  await rateLimitLookups(db, uid, 'lab-story', STORIES_PER_HOUR);
  const participantRef = db.collection('labParticipants').doc(code);
  const participant = (await participantRef.get()).data();
  if (!participant?.consentId) throw new HttpsError('failed-precondition', 'We have no consent on file for this participant ID. Please check your details.');
  const structure = storyStructures[p.phase];
  const answers = Object.fromEntries(
    Object.entries(p.answers).map(([id, a]) => {
      const sig = structure.signifiers.find((s) => s.id === id)!;
      return [id, sig.type === 'triad' && a !== 'na' ? tidyTriad(a as TriadAnswer) : sig.type === 'dyad' && typeof a === 'number' ? Math.round(a * 10) / 10 : a];
    }),
  );
  const receivedAt = new Date();
  // The same story sent twice (a double tap, or again after the answer was lost on a poor connection) is filed once: its
  // id comes from the participant, the phase and the words (the swarm test, 17 October 2026).
  const same = createHash('sha256').update([code, p.phase, p.checkInId ?? '', p.promptId, p.title.trim(), p.story.trim()].join('\u0000')).digest('hex').slice(0, 28);
  const ref = db.collection('labStories').doc(`s${same}`);
  const filed = await db.runTransaction(async (tx) => {
    const [heldSnap, participantSnap] = await Promise.all([tx.get(ref), tx.get(participantRef)]);
    const held = heldSnap.data();
    if (held) return { storyId: ref.id, receivedAt: held.receivedAt?.toDate?.().toISOString?.() ?? receivedAt.toISOString(), first: false };
    // One story for each phase (19 October 2026), apart from the team's test accounts.
    if (Number(participantSnap.data()?.storyCounts?.[p.phase] ?? 0) >= 1 && !mayRetellStory(code)) throw new HttpsError('failed-precondition', alreadyToldMessage);
    tx.create(ref, {
      studyId: labStudy.studyId,
      participantCode: code,
      phase: p.phase,
      structureId: p.structureId,
      structureVersion: p.structureVersion,
      promptId: p.promptId,
      promptText: structure.prompts.find((x) => x.id === p.promptId)!.text,
      title: p.title.trim(),
      story: p.story.trim(),
      answers,
      source: p.source,
      checkInId: p.checkInId ?? null,
      sessionUid: uid,
      client: p.client,
      receivedAt,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(participantRef, { storyIds: FieldValue.arrayUnion(ref.id), storyCounts: { [p.phase]: FieldValue.increment(1) }, lastStoryAt: receivedAt, sessionUids: FieldValue.arrayUnion(uid), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { storyId: ref.id, receivedAt: receivedAt.toISOString(), first: true };
  });
  if (filed.first) logger.info('Story recorded', { participantCode: code, storyId: ref.id, phase: p.phase });
  return { storyId: filed.storyId, receivedAt: filed.receivedAt };
});


const EMAILS_PER_HOUR = 5;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A copy of their story, emailed to the participant at their request (19 October 2026). Only for a story this browser
 * sent, so nobody can have someone else's story sent anywhere; the address is used once and not stored.
 */
export const emailLabStory = onCall(callOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const data = (request.data ?? {}) as { participantCode?: unknown; storyId?: unknown; email?: unknown };
  const code = normaliseCode(data.participantCode);
  const storyId = typeof data.storyId === 'string' && DOC_ID.test(data.storyId) ? data.storyId : null;
  const email = typeof data.email === 'string' ? data.email.trim() : '';
  if (!code || !storyId) throw new HttpsError('invalid-argument', 'The story reference is malformed.');
  if (email.length > 254 || !EMAIL.test(email)) throw new HttpsError('invalid-argument', 'Enter a full email address, such as name@example.com.');
  const db = getFirestore();
  await rateLimitLookups(db, uid, 'lab-story-email', EMAILS_PER_HOUR);
  const ref = db.collection('labStories').doc(storyId);
  const story = (await ref.get()).data();
  if (!story || story.participantCode !== code || story.sessionUid !== uid) throw new HttpsError('not-found', 'That story could not be found from this page. Please download it or print it instead.');
  const phaseWords = { pre: 'before your break', mid: 'during your break', post: 'after your break' }[story.phase as StoryPhase] ?? '';
  const when = (story.receivedAt?.toDate?.() as Date | undefined)?.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }) ?? '';
  const text = [
    'Hello,',
    '',
    `Here is the story you told for MyStory, ${phaseWords}, in the ${labStudy.name}${when ? `, on ${when}` : ''}.`,
    '',
    ...(story.title ? [String(story.title), ''] : []),
    String(story.story ?? ''),
    '',
    `It is saved for the research under your participant ID, ${code}, never your name. If you ever want it removed, email ${labStudy.contactName} at ${labStudy.contactEmail} and quote that ID.`,
    '',
    'If you need to talk to someone about how you are feeling: in an emergency, call 999 or go to A&E. To talk to someone now: Samaritans 116 123 or text SHOUT to 85258 (all 24 hours). For support that isn\'t urgent: the University Student Counselling and Wellbeing Service, 0113 343 4107 or scw@leeds.ac.uk.',
    '',
    'MyPhone/MyBrain, School of Psychology, University of Leeds',
  ].join('\n');
  const outcome = await sendMail({ to: email, replyTo: labStudy.contactEmail, subject: 'MyPhone/MyBrain: your MyStory story', text });
  // That a copy was asked for, and how it went: never the address.
  await ref.set({ copiesEmailed: FieldValue.arrayUnion({ at: new Date().toISOString(), outcome }) }, { merge: true });
  logger.info('Story emailed to the participant', { participantCode: code, storyId, outcome });
  return { email: outcome };
});
