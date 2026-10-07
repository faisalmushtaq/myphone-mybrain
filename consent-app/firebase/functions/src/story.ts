import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { labStudy, storyLimits, storyStructures, type StoryPhase, type StorySignifier, type StoryStructure } from './forms.js';
import { normaliseCode, rateLimitLookups } from './lab.js';
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
  const ref = db.collection('labStories').doc();
  const batch = db.batch();
  batch.set(ref, {
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
  batch.set(participantRef, { storyIds: FieldValue.arrayUnion(ref.id), storyCounts: { [p.phase]: FieldValue.increment(1) }, lastStoryAt: receivedAt, sessionUids: FieldValue.arrayUnion(uid), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  logger.info('Story recorded', { participantCode: code, storyId: ref.id, phase: p.phase });
  return { storyId: ref.id, receivedAt: receivedAt.toISOString() };
});
