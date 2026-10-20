import { randomUUID } from 'node:crypto';
import { FieldValue, getFirestore, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { labStudy, storyChats, type ChatProtocol, type StoryPhase } from './forms.js';
import { normaliseCode, rateLimitLookups } from './lab.js';
import { readSecret } from './secrets.js';
import {
  adaptPrompt,
  checkPrompt,
  cleanAdaptation,
  cosine,
  endedEarly,
  extractionPrompt,
  interviewerPrompt,
  mockEmbedder,
  mockModel,
  ModelError,
  openAiEmbedder,
  openAiModel,
  revisePrompt,
  unfaithful,
  withoutSentences,
  safeguardingHits,
  scenarioPrompt,
  type ChatMessage,
  type CheckedSentence,
  type Embedder,
  type ModelCall,
  type Prompt,
} from './storyPrompts.js';
import { isObj, validateClient, type ClientInfo } from './validate.js';
import { alreadyToldMessage } from './story.js';
import { mayRetellStory } from './testAccounts.js';

/**
 * MyStory's AI chat (decided 13 October 2026): the MySelf micro-narrative
 * protocol, embedded in the break study's pages. Sam, an AI interviewer, asks
 * the phase's questions one at a time; the answers are extracted in the
 * participant's own words; three personas each write a short retelling; the
 * participant picks one, rates how well it fits, and can edit it or ask for
 * a change. The story they end with is MyStory's story for that phase.
 *
 * The protocol for each phase is a TOML file (src/lab/mystory/<phase>.toml),
 * the same format MySelf reads; the prompts are MySelf's (storyPrompts.ts).
 * The OpenAI key stays here, in Secret Manager (scripts/set-openai-key.sh):
 * the page sends only what the participant typed and chose, never a prompt,
 * so it cannot change what the model is told.
 *
 *   labStoryChats/{id}   one per conversation: every turn, the model calls
 *                        (prompt key, model, tokens), the extraction, the
 *                        retellings, the choice, the rating, every change
 *                        asked for or made, safeguarding flags, and the
 *                        final story
 *   labStories/{id}      the finished story, as MyStory's other stories
 *
 * Every step is saved as it happens, so a conversation that stops halfway is
 * still data, as in MySelf. Without a key the chat says it is not set up and
 * the page offers MyStory's own form instead; in the emulator a stand-in
 * model answers (storyPrompts.mockModel).
 */

const REGION = 'europe-west2';
const callOptions = { region: REGION, memory: '256MiB' as const, timeoutSeconds: 180, enforceAppCheck: process.env.MPMB_ENFORCE_APP_CHECK === 'true' };
const PHASES: StoryPhase[] = ['pre', 'mid', 'post'];
const SOURCES = ['baseline', 'checkin', 'after', 'story', 'book'];
const DOC_ID = /^[A-Za-z0-9]{1,40}$/;
/** Conversations a device may start in an hour, and model calls the whole study may make in a day: a ceiling on the bill. */
const CHATS_PER_HOUR = 6;
const CALLS_PER_DAY = Number(process.env.MPMB_STORY_CALLS_PER_DAY ?? 3000);
const MAX_ADAPTATIONS = 5;
export const OPENAI_SECRET = 'mpmb-openai-key';

type Status = 'interview' | 'choose' | 'rate' | 'adapt' | 'done' | 'stopped';

interface Candidate {
  index: number;
  persona: string;
  text: string;
  confidence: string;
  /** What the check found added to the first draft and took out ([] if nothing), and anything still there after. */
  added?: string[];
  stillAdded?: string[];
  draft?: string;
  /** The fixed version, before the sentences still not right were cut. */
  beforeCut?: string;
  /** Cosine similarity of the retelling to the participant's own words. */
  similarity?: number | null;
  /** The check could not run, so the draft was shown unchecked (the failed call is in calls). */
  checkFailed?: boolean;
}

export interface ChatDoc {
  participantCode: string;
  phase: StoryPhase;
  protocolKey: string;
  protocolVersion: string;
  status: Status;
  transcript: (ChatMessage & { at: string })[];
  turns: number;
  extraction: Record<string, string | null> | null;
  candidates: Candidate[];
  chosenIndex: number | null;
  rating: number | null;
  finalScenario: string | null;
  requests?: unknown[];
  edits?: unknown[];
  flags?: { tier: string }[];
  fallback?: string;
  sessionUid: string;
}

/** What the page shows: the protocol's own words, so the TOML file decides them. */
function screensFor(protocol: ChatProtocol) {
  return { ...protocol.screens, questionCount: protocol.interview.questions.length, maxChars: protocol.maxChars, minChars: protocol.minChars };
}

async function modelFor(): Promise<ModelCall | null> {
  // The emulator's stand-in model; the end-to-end test can switch the chat off (meta/e2e storyChatOff) to reach the written form.
  if (process.env.FUNCTIONS_EMULATOR === 'true') return (await getFirestore().collection('meta').doc('e2e').get()).data()?.storyChatOff ? null : mockModel;
  const key = await readSecret(OPENAI_SECRET);
  return key ? openAiModel(key) : null;
}

async function embedderFor(): Promise<Embedder | null> {
  if (process.env.FUNCTIONS_EMULATOR === 'true') return mockEmbedder;
  const key = await readSecret(OPENAI_SECRET);
  return key ? openAiEmbedder(key) : null;
}

/** How close each text is to what the participant said, by embedding; null for all if it cannot be measured. */
async function similarities(db: Firestore, ref: DocumentReference, transcript: ChatMessage[], texts: string[]): Promise<(number | null)[]> {
  const own = transcript.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
  const at = new Date().toISOString();
  try {
    const embed = await embedderFor();
    if (!embed || !own || !texts.length) return texts.map(() => null);
    await spendCall(db);
    const [mine, ...theirs] = await embed([own, ...texts]);
    await ref.update({ calls: FieldValue.arrayUnion({ stage: 'similarity', prompt: 'embedding', model: embed === mockEmbedder ? 'mock' : 'text-embedding-3-small', at, ok: true }) });
    return theirs.map((v) => cosine(mine!, v));
  } catch (error) {
    await ref.update({ calls: FieldValue.arrayUnion({ stage: 'similarity', prompt: 'embedding', at, ok: false, error: error instanceof ModelError ? error.kind : 'unknown' }) });
    return texts.map(() => null);
  }
}

/**
 * A retelling is checked against the interview, sentence by sentence, before
 * it is shown. Sentences that are not what the participant said are fixed
 * once by the model and checked again; any still not right are cut, word for
 * word. A check that cannot run leaves the draft as it is (it is still the
 * participant's to choose, rate and correct, as in the original).
 */
async function faithful(db: Firestore, ref: DocumentReference, model: ModelCall, protocol: ChatProtocol, transcript: ChatMessage[], draft: string) {
  try {
    const check = async (story: string) => unfaithful((await call<{ sentences: CheckedSentence[] }>(db, ref, model, checkPrompt(transcript, story), protocol, 'check')).sentences);
    const first = await check(draft);
    if (!first.length) return { text: draft, added: [], stillAdded: [] };
    const added = first.map((x) => `"${x.sentence.trim()}": ${x.problem}`);
    const revised = (await call<{ scenario: string }>(db, ref, model, revisePrompt(draft, added), protocol, 'revise')).scenario.trim() || draft;
    const again = await check(revised);
    const text = again.length ? withoutSentences(revised, again.map((x) => x.sentence)) : revised;
    return { text, added, stillAdded: again.map((x) => `"${x.sentence.trim()}": ${x.problem}`), draft, ...(again.length ? { beforeCut: revised } : {}) };
  } catch {
    // Recorded, so the team knows this one was not checked; the failed call is in calls.
    return { text: draft, checkFailed: true };
  }
}

/** Counts a model call against the study's daily ceiling; refuses once it is reached. */
async function spendCall(db: Firestore, n = 1): Promise<void> {
  // The day's count is spread over several records, each added to without a transaction: with one record, many
  // conversations at once collided on it and their model calls failed as if the model were down (the swarm test,
  // 17 October 2026). The ceiling is checked against the sum.
  const day = new Date().toISOString().slice(0, 10);
  const shards = Array.from({ length: CALL_SHARDS }, (_, k) => db.collection('ratelimits').doc(`story-calls-${day}-${k}`));
  await shards[Math.floor(Math.random() * CALL_SHARDS)].set({ count: FieldValue.increment(n), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const used = (await db.getAll(...shards)).reduce((sum, snap) => sum + Number(snap.data()?.count ?? 0), 0);
  if (used > CALLS_PER_DAY) throw new ModelError('rate_limit', 'the daily ceiling on model calls is reached', false);
}

/** How many records the day's count of model calls is spread over. */
const CALL_SHARDS = 10;

/** One model call, recorded on the conversation whatever happens. */
async function call<T>(db: Firestore, ref: DocumentReference, model: ModelCall, prompt: Prompt, protocol: ChatProtocol, stage: string): Promise<T> {
  const at = new Date().toISOString();
  try {
    await spendCall(db);
    const result = await model<T>(prompt, protocol);
    await ref.update({ calls: FieldValue.arrayUnion({ stage, prompt: prompt.key, model: result.model, inputTokens: result.usage.input, outputTokens: result.usage.output, at, ok: true }), updatedAt: FieldValue.serverTimestamp() });
    return result.output;
  } catch (error) {
    const kind = error instanceof ModelError ? error.kind : 'unknown';
    await ref.update({ calls: FieldValue.arrayUnion({ stage, prompt: prompt.key, at, ok: false, error: kind }), updatedAt: FieldValue.serverTimestamp() });
    logger.warn('MyStory chat model call failed', { stage, prompt: prompt.key, kind });
    throw error;
  }
}

async function flag(ref: DocumentReference, protocol: ChatProtocol, text: string, stage: string, code: string) {
  const hits = safeguardingHits(protocol, text);
  if (!hits.length) return;
  const at = new Date().toISOString();
  await ref.update({ flags: FieldValue.arrayUnion(...hits.map((h) => ({ ...h, stage, at }))) });
  // The rule, never the words: the team reads the conversation itself on the export.
  for (const h of hits) logger.warn('MyStory safeguarding flag', { participantCode: code, rule: h.rule, tier: h.tier, stage });
}

/** The interview is over: extract, then the personas write at the same time. */
async function retell(db: Firestore, ref: DocumentReference, model: ModelCall, protocol: ChatProtocol, transcript: ChatMessage[]) {
  const extraction = await call<Record<string, string | null>>(db, ref, model, extractionPrompt(protocol, transcript), protocol, 'extract');
  const settled = await Promise.all(
    protocol.personas.map(async (persona, index) => {
      try {
        const out = await call<{ scenario: string; confidence: string }>(db, ref, model, scenarioPrompt(protocol, persona, extraction), protocol, 'generate');
        const draft = out.scenario.trim();
        if (!draft) return null;
        const checked = await faithful(db, ref, model, protocol, transcript, draft);
        // Nothing left once what they did not say is cut: this voice is not offered.
        return checked.text ? { index, persona: persona.key, confidence: out.confidence, ...checked } : null;
      } catch {
        return null;
      }
    }),
  );
  const candidates: Candidate[] = settled.filter((c): c is NonNullable<typeof c> => c !== null);
  const scores = await similarities(db, ref, transcript, candidates.map((c) => c.text));
  candidates.forEach((c, i) => (c.similarity = scores[i] ?? null));
  return { extraction, candidates };
}

/** The story the participant ended with, filed as MyStory's story for the phase. */
async function fileStory(db: Firestore, ref: DocumentReference, chat: ChatDoc & Record<string, unknown>, story: string, how: string, uid: string) {
  const receivedAt = new Date();
  // One story per conversation, filed under the conversation's own id: a "Keep this story" sent twice (a double tap, or
  // again after the answer was lost on a poor connection) finds it already filed (the swarm test, 17 October 2026).
  const storyRef = db.collection('labStories').doc(ref.id);
  const participantRef = db.collection('labParticipants').doc(chat.participantCode);
  const chosen = chat.candidates.find((c) => c.index === chat.chosenIndex) ?? null;
  // How close the filed story is to their words, after their changes; not measured when it is their words.
  const [finalSimilarity = null] = story && how !== 'stopped-early' && how !== 'model-unavailable' ? await similarities(db, ref, chat.transcript, [story]) : [null];
  const filed = await db.runTransaction(async (tx) => {
    const now = (await tx.get(ref)).data();
    if (now?.status === 'done') return { storyId: String(now.storyId ?? storyRef.id), receivedAt: toIsoString(now.finishedAt) ?? receivedAt.toISOString(), ending: String(now.ending ?? how), first: false };
    tx.create(storyRef, {
      studyId: labStudy.studyId,
      participantCode: chat.participantCode,
      phase: chat.phase,
      mode: 'chat',
      chatId: ref.id,
      structureId: chat.protocolKey,
      structureVersion: chat.protocolVersion,
      promptId: null,
      promptText: null,
      title: null,
      story,
      answers: {},
      extraction: chat.extraction ?? null,
      chosenPersona: chosen?.persona ?? null,
      rating: chat.rating ?? null,
      ending: how,
      finalSimilarity,
      source: chat.source ?? 'story',
      checkInId: chat.checkInId ?? null,
      sessionUid: uid,
      client: chat.client ?? null,
      receivedAt,
      createdAt: FieldValue.serverTimestamp(),
  });
  tx.update(ref, { status: 'done', finalScenario: story, ending: how, finalSimilarity, storyId: storyRef.id, finishedAt: receivedAt, updatedAt: FieldValue.serverTimestamp() });
  tx.set(participantRef, { storyIds: FieldValue.arrayUnion(storyRef.id), storyCounts: { [chat.phase]: FieldValue.increment(1) }, lastStoryAt: receivedAt, sessionUids: FieldValue.arrayUnion(uid), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { storyId: storyRef.id, receivedAt: receivedAt.toISOString(), ending: how, first: true };
  });
  if (filed.first) logger.info('Story recorded from the chat', { participantCode: chat.participantCode, storyId: storyRef.id, phase: chat.phase, ending: how });
  return { storyId: filed.storyId, receivedAt: filed.receivedAt, ending: filed.ending };
}

/** A stored time as an ISO string, or null. */
function toIsoString(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (v && typeof (v as { toDate?: () => Date }).toDate === 'function') return (v as { toDate: () => Date }).toDate().toISOString();
  return typeof v === 'string' ? v : null;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const labStoryChat = onCall(callOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const data = request.data as Record<string, unknown>;
  if (!isObj(data)) throw new HttpsError('invalid-argument', 'The request is malformed.');
  const db = getFirestore();

  /* ── Start: check who it is, open the conversation, ask the first question ── */
  if (data.action === 'start') {
    const code = normaliseCode(data.participantCode);
    const phase = PHASES.includes(data.phase as StoryPhase) ? (data.phase as StoryPhase) : null;
    const problems: string[] = [];
    if (!code) problems.push('The participant ID is malformed.');
    if (!phase) problems.push('The phase of the study is missing or unknown.');
    if (!SOURCES.includes(String(data.source))) problems.push('The page the story came from is unknown.');
    if (data.checkInId !== null && data.checkInId !== undefined && (typeof data.checkInId !== 'string' || !DOC_ID.test(data.checkInId))) problems.push('The check-in reference is malformed.');
    validateClient(data.client, problems);
    if (problems.length) throw new HttpsError('invalid-argument', problems[0], { problems });
    const protocol = storyChats[phase!];
    const model = await modelFor();
    // Not set up yet (no key stored): the page offers MyStory's own form instead.
    if (!model) return { available: false };
    const participant = (await db.collection('labParticipants').doc(code!).get()).data();
    if (!participant?.consentId) throw new HttpsError('failed-precondition', 'We have no consent on file for this participant ID. Please check your details.');
    // One story for each phase (19 October 2026), apart from the team's test accounts.
    if (Number(participant.storyCounts?.[phase!] ?? 0) >= 1 && !mayRetellStory(code!)) throw new HttpsError('failed-precondition', alreadyToldMessage);
    // "Start the chat" sent again (after its answer was lost on a poor connection): the chat this device has just begun,
    // with nothing said yet, is given back, not a second one (the swarm test, 17 October 2026).
    const recent = (await db.collection('labStoryChats').where('sessionUid', '==', uid).get()).docs.find((d) => {
      const c = d.data();
      const opened = c.startedAt?.toDate?.() as Date | undefined;
      return c.participantCode === code && c.phase === phase && c.status === 'interview' && Number(c.turns ?? 0) === 0 && Array.isArray(c.transcript) && c.transcript.some((m: ChatMessage) => m.role === 'assistant') && opened && Date.now() - opened.getTime() < 15 * 60_000;
    });
    if (recent) {
      const opening = (recent.data().transcript as ChatMessage[]).find((m) => m.role === 'assistant')!.content;
      return { available: true, chatId: recent.id, protocol: { key: protocol.key, version: protocol.version }, screens: screensFor(protocol), reply: opening };
    }
    await rateLimitLookups(db, uid, 'story-chat', CHATS_PER_HOUR);
    const ref = db.collection('labStoryChats').doc();
    const startedAt = new Date();
    await ref.set({
      studyId: labStudy.studyId,
      participantCode: code,
      phase,
      protocolKey: protocol.key,
      protocolVersion: protocol.version,
      approvalStatus: protocol.approvalStatus,
      model: protocol.model,
      status: 'interview',
      transcript: [],
      turns: 0,
      extraction: null,
      candidates: [],
      chosenIndex: null,
      rating: null,
      finalScenario: null,
      requests: [],
      edits: [],
      flags: [],
      calls: [],
      source: data.source,
      checkInId: data.checkInId ?? null,
      client: data.client as ClientInfo,
      sessionUid: uid,
      startedAt,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    try {
      const turn = await call<{ reply: string; interviewDone: boolean }>(db, ref, model, interviewerPrompt(protocol, []), protocol, 'collect');
      if (!turn.reply.trim()) throw new ModelError('malformed_output', 'the interviewer had nothing to ask', false);
      await ref.update({ transcript: FieldValue.arrayUnion({ role: 'assistant', content: turn.reply, at: new Date().toISOString() }) });
      return { available: true, chatId: ref.id, protocol: { key: protocol.key, version: protocol.version }, screens: screensFor(protocol), reply: turn.reply };
    } catch {
      await ref.update({ status: 'stopped', fallback: 'the interviewer could not be reached' });
      return { available: false };
    }
  }

  /* ── Every other step continues a conversation this device started ── */
  const chatId = typeof data.chatId === 'string' && DOC_ID.test(data.chatId) ? data.chatId : null;
  if (!chatId) throw new HttpsError('invalid-argument', 'The conversation reference is malformed.');
  const ref = db.collection('labStoryChats').doc(chatId);
  const snap = await ref.get();
  const chat = snap.data() as (ChatDoc & Record<string, unknown>) | undefined;
  if (!chat || chat.sessionUid !== uid) throw new HttpsError('not-found', 'This conversation could not be found. Please start again.');
  const protocol = storyChats[chat.phase];
  if (chat.status === 'done') return { stage: 'done', story: chat.finalScenario, storyId: chat.storyId ?? null };
  const model = await modelFor();

  switch (data.action) {
    case 'reply': {
      // An answer sent again (after its reply was lost on a poor connection, or "Try again"): the page says which answer
      // it is, counting from 0. Already taken: Remi's reply to it is given again, or the next step if the interview has
      // moved on; nothing is added twice (the swarm test, 17 October 2026).
      const asked = chat.transcript.filter((m) => m.role === 'user').length;
      const repeat = typeof data.turn === 'number' && Number.isInteger(data.turn) && data.turn >= 0 && data.turn < asked;
      if (repeat) {
        if (chat.status === 'choose') return { stage: 'choose', candidates: chat.candidates.map(({ index, text: t }) => ({ index, text: t })) };
        if (chat.status === 'stopped') return { stage: 'stopped', text: chat.stoppedEarly ? STOPPED_EARLY : protocol.screens.fallbackText };
        let seen = -1;
        const after = chat.transcript.findIndex((m) => m.role === 'user' && ++seen === data.turn);
        const answer = chat.transcript.slice(after + 1).find((m) => m.role === 'assistant');
        if (chat.status === 'interview' && answer && data.turn === asked - 1) return { stage: 'interview', reply: answer.content };
      }
      if (chat.status !== 'interview') throw new HttpsError('failed-precondition', 'The interview is already over.');
      const said = repeat ? (chat.transcript.filter((m) => m.role === 'user').at(-1)?.content ?? '') : text(data.text, protocol.maxChars);
      if (said.length < protocol.minChars) return { stage: 'interview', reply: 'Could you say a little more?', again: true };
      const transcript: ChatMessage[] = repeat ? chat.transcript.map(({ role, content }) => ({ role, content })) : [...chat.transcript.map(({ role, content }) => ({ role, content })), { role: 'user', content: said }];
      const turns = repeat ? chat.turns : chat.turns + 1;
      if (!repeat) await ref.update({ transcript: FieldValue.arrayUnion({ role: 'user', content: said, at: new Date().toISOString() }), turns, updatedAt: FieldValue.serverTimestamp() });
      await flag(ref, protocol, said, 'collect', chat.participantCode);
      if (!model) return await fallback(ref, protocol, 'no model');
      try {
        let done = turns >= protocol.maxTurns;
        // Which questions the interviewer judged answered when it closed, kept for the export (questions_covered).
        let covered: number[] | undefined;
        if (!done) {
          const turn = await call<{ reply: string; interviewDone: boolean; questionsCovered?: number[] }>(db, ref, model, interviewerPrompt(protocol, transcript), protocol, 'collect');
          // The closing turn's reply is discarded, as MySelf does: the app says what happens next, not the model.
          if (turn.interviewDone) {
            const distress = (chat.flags ?? []).some((f) => f.tier === 'safeguarding_review') || safeguardingHits(protocol, said).some((h) => h.tier === 'safeguarding_review');
            if (endedEarly(protocol, turn.questionsCovered, distress)) {
              await ref.update({ interviewDone: true, interviewClosed: 'stopped_early', questionsCovered: turn.questionsCovered ?? [], status: 'stopped', fallback: 'participant stopped', stoppedEarly: true, updatedAt: FieldValue.serverTimestamp() });
              return { stage: 'stopped', text: STOPPED_EARLY };
            }
            covered = Array.isArray(turn.questionsCovered) ? turn.questionsCovered : undefined;
            done = true;
          }
          else {
            await ref.update({ transcript: FieldValue.arrayUnion({ role: 'assistant', content: turn.reply, at: new Date().toISOString() }) });
            return { stage: 'interview', reply: turn.reply };
          }
        }
        await ref.update({ interviewDone: true, interviewClosed: turns >= protocol.maxTurns ? 'turn_limit' : 'model', ...(covered ? { questionsCovered: covered } : {}) });
        const { extraction, candidates } = await retell(db, ref, model, protocol, transcript);
        if (!candidates.length) return await fallback(ref, protocol, 'no retelling could be generated', extraction);
        await ref.update({ extraction, candidates, status: 'choose', updatedAt: FieldValue.serverTimestamp() });
        return { stage: 'choose', candidates: candidates.map(({ index, text: t }) => ({ index, text: t })) };
      } catch {
        return await fallback(ref, protocol, 'the model could not be reached');
      }
    }
    case 'choose': {
      // Chosen already (the same choice sent again): the next step again.
      if (chat.status === 'rate' && chat.chosenIndex === data.index) return { stage: 'rate', story: chat.finalScenario };
      if (chat.status !== 'choose') throw new HttpsError('failed-precondition', 'There is nothing to choose from yet.');
      const picked = chat.candidates.find((c) => c.index === data.index);
      if (!picked) throw new HttpsError('invalid-argument', 'Choose one of the stories.');
      await ref.update({ chosenIndex: picked.index, finalScenario: picked.text, status: 'rate', updatedAt: FieldValue.serverTimestamp() });
      return { stage: 'rate', story: picked.text };
    }
    case 'rate': {
      if (chat.status === 'adapt' && chat.rating === data.rating) return { stage: 'adapt', story: chat.finalScenario };
      if (chat.status !== 'rate') throw new HttpsError('failed-precondition', 'There is nothing to rate yet.');
      const rating = typeof data.rating === 'number' && Number.isInteger(data.rating) && data.rating >= 0 && data.rating <= 10 ? data.rating : null;
      if (rating === null) throw new HttpsError('invalid-argument', 'Choose a number from 0 to 10.');
      await ref.update({ rating, status: 'adapt', updatedAt: FieldValue.serverTimestamp() });
      // Full marks: nothing to change, so the chosen story is the story.
      if (rating >= protocol.adaptBelowRating) {
        const filed = await fileStory(db, ref, { ...chat, rating }, chat.finalScenario ?? '', 'rated-full-marks', uid);
        return { stage: 'done', story: chat.finalScenario, ...filed };
      }
      return { stage: 'adapt', story: chat.finalScenario };
    }
    case 'adapt': {
      if (chat.status !== 'adapt') throw new HttpsError('failed-precondition', 'There is nothing to change yet.');
      const ask = text(data.request, protocol.maxChars);
      if (!ask) return { stage: 'adapt', story: chat.finalScenario, needsRequest: true };
      const requests = Array.isArray(chat.requests) ? chat.requests.length : 0;
      if (requests >= MAX_ADAPTATIONS) return { stage: 'adapt', story: chat.finalScenario, limit: true };
      const base = text(data.story, protocol.maxChars * 2) || (chat.finalScenario ?? '');
      await flag(ref, protocol, ask, 'adapt', chat.participantCode);
      if (!model) return { stage: 'adapt', story: base, failed: true };
      try {
        const out = await call<{ newScenario: string; changed: boolean }>(db, ref, model, adaptPrompt(base, ask), protocol, 'adapt');
        const rewritten = cleanAdaptation(out.newScenario) || base;
        // A rewrite is checked like a retelling: against everything they have said, asked for or written themselves.
        const said: ChatMessage[] = [
          ...chat.transcript.map(({ role, content }) => ({ role, content })),
          ...((chat.requests ?? []) as { request: string }[]).map((r) => ({ role: 'user' as const, content: r.request })),
          ...((chat.edits ?? []) as { after: string }[]).map((e) => ({ role: 'user' as const, content: e.after })),
          ...(base !== chat.finalScenario ? [{ role: 'user' as const, content: base }] : []),
          { role: 'user', content: ask },
        ];
        const checked = rewritten === base ? { text: base } : await faithful(db, ref, model, protocol, said, rewritten);
        const { text: kept, ...found } = checked;
        const revised = kept || base;
        await ref.update({ requests: FieldValue.arrayUnion({ request: ask, before: base, after: revised, changed: out.changed, ...found, at: new Date().toISOString() }), finalScenario: revised, updatedAt: FieldValue.serverTimestamp() });
        return { stage: 'adapt', story: revised, unchanged: out.changed === false };
      } catch {
        return { stage: 'adapt', story: base, failed: true };
      }
    }
    case 'finish': {
      // Keep the story as it stands, with any edits the participant made themselves.
      if (chat.status !== 'adapt' && chat.status !== 'stopped') throw new HttpsError('failed-precondition', 'The story is not ready yet.');
      const story = text(data.story, protocol.maxChars * 2) || (chat.finalScenario ?? '');
      if (!story && chat.status === 'adapt') throw new HttpsError('invalid-argument', 'Your story is empty.');
      if (story && story !== chat.finalScenario) {
        await ref.update({ edits: FieldValue.arrayUnion({ before: chat.finalScenario ?? null, after: story, at: new Date().toISOString() }) });
        await flag(ref, protocol, story, 'edit', chat.participantCode);
      }
      // After a failure: the participant's own answers, as they wrote them, are the story.
      const own = chat.transcript.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
      // Nothing typed and no story (it stopped before the first answer): nothing to file, so no empty story (16 October 2026).
      if (!story && !own.trim()) throw new HttpsError('failed-precondition', 'There is nothing to save yet: you have not told us anything. You can start again, or write your story yourself.');
      const filed = await fileStory(db, ref, chat, story || own, chat.status === 'stopped' ? (chat.fallback === 'participant stopped' ? 'stopped-early' : 'model-unavailable') : story === chat.finalScenario ? 'kept' : 'edited', uid);
      return { stage: 'done', story: story || own, ...filed };
    }
    default:
      throw new HttpsError('invalid-argument', 'Unknown step.');
  }
});

/** Said by the app, not the model, when the participant stops partway: no retellings, their words kept, help a tap away. */
export const STOPPED_EARLY = 'That’s completely fine. We’ll stop here, and what you’ve said is saved. If you’d like to talk to someone, the people below are there to help, or you can reach out to someone you trust. Tap Finish when you’re ready.';

/** The model could not carry on: the conversation stops, and what the participant wrote is kept. */
async function fallback(ref: DocumentReference, protocol: ChatProtocol, reason: string, extraction?: Record<string, string | null>) {
  await ref.update({ status: 'stopped', fallback: reason, ...(extraction ? { extraction } : {}), updatedAt: FieldValue.serverTimestamp() });
  return { stage: 'stopped', text: protocol.screens.fallbackText };
}

/* ── Voice: speak an answer instead of typing it (MySelf's transcribe, 14 October 2026) ── */

/**
 * A recording of the participant's answer, turned into words for the reply
 * box, as in MySelf's MyStory (apps/functions/src/transcribe.ts): the same
 * model, the same limits, the same containers. Transcribed by OpenAI, the
 * provider the chat already uses, not the browser's own recogniser (which
 * would send the voice to Apple or Google). The words come back to the box
 * to be read and corrected before they are sent; the recording is kept,
 * under the conversation, for the team (labStoryVoice/{chatId}/{clipId}),
 * readable by nobody through the website.
 */
const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
const MAX_CLIP_BYTES = 4_000_000;
const CLIPS_PER_CHAT = 40;
const CLIP_EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'mp4',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
};

/** "audio/webm;codecs=opus" is what MediaRecorder reports. */
export function clipExtension(mimeType: string): string | null {
  return CLIP_EXTENSIONS[mimeType.split(';')[0]!.trim().toLowerCase()] ?? null;
}

/** What the emulator's stand-in transcriber hears: always the same words. */
export const MOCK_TRANSCRIPT = 'Going back on felt strange and a bit boring.';

async function transcribeClip(apiKey: string, audio: Buffer, mimeType: string, extension: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), `speech.${extension}`);
  form.append('model', TRANSCRIBE_MODEL);
  form.append('language', 'en');
  form.append('response_format', 'json');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form });
  // The provider's own message is not passed on: it can quote the request back, and the request is somebody's voice.
  if (!response.ok) throw new ModelError(response.status === 429 ? 'rate_limit' : 'transport', `HTTP ${response.status}`);
  const { text } = (await response.json()) as { text?: string };
  return (text ?? '').trim();
}

export const labStoryVoice = onCall({ ...callOptions, memory: '512MiB' as const, timeoutSeconds: 120 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please try again.');
  const data = request.data as Record<string, unknown>;
  const chatId = isObj(data) && typeof data.chatId === 'string' && DOC_ID.test(data.chatId) ? data.chatId : null;
  const mimeType = isObj(data) && typeof data.mimeType === 'string' && data.mimeType.length <= 80 ? data.mimeType : '';
  const seconds = isObj(data) && typeof data.seconds === 'number' && data.seconds >= 0 && data.seconds <= 600 ? Math.round(data.seconds) : null;
  if (!chatId || !isObj(data) || typeof data.audio !== 'string' || data.audio.length < 32 || data.audio.length > Math.ceil(MAX_CLIP_BYTES * 1.4)) {
    throw new HttpsError('invalid-argument', 'Something went wrong sending that. Try again, or type your answer instead.');
  }
  const extension = clipExtension(mimeType);
  if (!extension) throw new HttpsError('invalid-argument', 'Your phone recorded that in a way I can’t read. You can type your answer instead.');
  const audio = Buffer.from(data.audio, 'base64');
  if (audio.byteLength === 0) throw new HttpsError('invalid-argument', 'I didn’t catch any sound there. Try again, or type your answer instead.');
  if (audio.byteLength > MAX_CLIP_BYTES) throw new HttpsError('invalid-argument', 'That was a bit too long to send. Try a shorter one, or type your answer.');

  const db = getFirestore();
  const ref = db.collection('labStoryChats').doc(chatId);
  const chat = (await ref.get()).data() as (ChatDoc & { voiceClips?: unknown[] }) | undefined;
  if (!chat || chat.sessionUid !== uid) throw new HttpsError('not-found', 'That recording could not be sent. You can type your answer instead.');
  if (chat.status !== 'interview' && chat.status !== 'adapt') throw new HttpsError('failed-precondition', 'That recording could not be sent. You can type your answer instead.');
  if ((chat.voiceClips?.length ?? 0) >= CLIPS_PER_CHAT) throw new HttpsError('resource-exhausted', 'That’s as many recordings as this chat can take. You can type your answer instead.');

  const emulator = process.env.FUNCTIONS_EMULATOR === 'true';
  const apiKey = emulator ? null : await readSecret(OPENAI_SECRET);
  if (!emulator && !apiKey) throw new HttpsError('unavailable', 'Recording isn’t available just now. You can type your answer instead.');
  try {
    await spendCall(db);
  } catch {
    throw new HttpsError('resource-exhausted', 'Recording isn’t available just now. You can type your answer instead.');
  }

  const clipId = randomUUID();
  const path = `labStoryVoice/${chatId}/${clipId}.${extension}`;
  const [kept, written] = await Promise.allSettled([
    getStorage().bucket().file(path).save(audio, { contentType: mimeType.split(';')[0]!.trim(), resumable: false, metadata: { metadata: { chatId, clipId, participantCode: chat.participantCode } } }),
    emulator ? Promise.resolve(MOCK_TRANSCRIPT) : transcribeClip(apiKey!, audio, mimeType, extension),
  ]);
  if (kept.status === 'rejected') logger.error('MyStory voice: the recording could not be kept', { chatId, reason: String((kept.reason as Error)?.message ?? kept.reason).slice(0, 200) });
  const said = written.status === 'fulfilled' ? written.value : null;
  await ref.update({
    voiceClips: FieldValue.arrayUnion({ clipId, path: kept.status === 'fulfilled' ? path : null, bytes: audio.byteLength, seconds, mimeType, stage: chat.status, model: emulator ? 'mock' : TRANSCRIBE_MODEL, transcript: said, ok: said !== null, at: new Date().toISOString() }),
    updatedAt: FieldValue.serverTimestamp(),
  });
  // Only that it happened: no words, no audio.
  logger.info('MyStory voice', { chatId, ok: said !== null, seconds });
  if (said === null) {
    throw new HttpsError('unavailable', kept.status === 'fulfilled' ? 'I’ve kept your recording, but I couldn’t turn it into words. Could you type what you said?' : 'I couldn’t turn that into words just now. Try again, or type it instead.');
  }
  if (!said) throw new HttpsError('invalid-argument', 'Nothing came through on that one. Have another go, or type your answer.');
  return { text: said, clipId, kept: kept.status === 'fulfilled' };
});
