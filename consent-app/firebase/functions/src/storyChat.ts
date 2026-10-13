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
  cleanAdaptation,
  endedEarly,
  extractionPrompt,
  interviewerPrompt,
  mockModel,
  ModelError,
  openAiModel,
  safeguardingHits,
  scenarioPrompt,
  type ChatMessage,
  type ModelCall,
  type Prompt,
} from './storyPrompts.js';
import { isObj, validateClient, type ClientInfo } from './validate.js';

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
  flags?: { tier: string }[];
  fallback?: string;
  sessionUid: string;
}

/** What the page shows: the protocol's own words, so the TOML file decides them. */
function screensFor(protocol: ChatProtocol) {
  return { ...protocol.screens, questionCount: protocol.interview.questions.length, maxChars: protocol.maxChars, minChars: protocol.minChars };
}

async function modelFor(): Promise<ModelCall | null> {
  if (process.env.FUNCTIONS_EMULATOR === 'true') return mockModel;
  const key = await readSecret(OPENAI_SECRET);
  return key ? openAiModel(key) : null;
}

/** Counts a model call against the study's daily ceiling; refuses once it is reached. */
async function spendCall(db: Firestore, n = 1): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.collection('ratelimits').doc(`story-calls-${day}`);
  const used = await db.runTransaction(async (tx) => {
    const count = Number((await tx.get(ref)).data()?.count ?? 0) + n;
    tx.set(ref, { count, updatedAt: FieldValue.serverTimestamp() });
    return count;
  });
  if (used > CALLS_PER_DAY) throw new ModelError('rate_limit', 'the daily ceiling on model calls is reached', false);
}

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
        const text = out.scenario.trim();
        return text ? { index, persona: persona.key, text, confidence: out.confidence } : null;
      } catch {
        return null;
      }
    }),
  );
  const candidates = settled.filter((c): c is Candidate => c !== null);
  return { extraction, candidates };
}

/** The story the participant ended with, filed as MyStory's story for the phase. */
async function fileStory(db: Firestore, ref: DocumentReference, chat: ChatDoc & Record<string, unknown>, story: string, how: string, uid: string) {
  const receivedAt = new Date();
  const storyRef = db.collection('labStories').doc();
  const participantRef = db.collection('labParticipants').doc(chat.participantCode);
  const chosen = chat.candidates.find((c) => c.index === chat.chosenIndex) ?? null;
  const batch = db.batch();
  batch.set(storyRef, {
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
    source: chat.source ?? 'story',
    checkInId: chat.checkInId ?? null,
    sessionUid: uid,
    client: chat.client ?? null,
    receivedAt,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.update(ref, { status: 'done', finalScenario: story, ending: how, storyId: storyRef.id, finishedAt: receivedAt, updatedAt: FieldValue.serverTimestamp() });
  batch.set(participantRef, { storyIds: FieldValue.arrayUnion(storyRef.id), storyCounts: { [chat.phase]: FieldValue.increment(1) }, lastStoryAt: receivedAt, sessionUids: FieldValue.arrayUnion(uid), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  logger.info('Story recorded from the chat', { participantCode: chat.participantCode, storyId: storyRef.id, phase: chat.phase, ending: how });
  return { storyId: storyRef.id, receivedAt: receivedAt.toISOString() };
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
    await rateLimitLookups(db, uid, 'story-chat', CHATS_PER_HOUR);
    const participant = (await db.collection('labParticipants').doc(code!).get()).data();
    if (!participant?.consentId) throw new HttpsError('failed-precondition', 'We have no consent on file for this participant ID. Please check your details.');
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
      if (chat.status !== 'interview') throw new HttpsError('failed-precondition', 'The interview is already over.');
      const said = text(data.text, protocol.maxChars);
      if (said.length < protocol.minChars) return { stage: 'interview', reply: 'Could you say a little more?', again: true };
      const transcript: ChatMessage[] = [...chat.transcript.map(({ role, content }) => ({ role, content })), { role: 'user', content: said }];
      const turns = chat.turns + 1;
      await ref.update({ transcript: FieldValue.arrayUnion({ role: 'user', content: said, at: new Date().toISOString() }), turns, updatedAt: FieldValue.serverTimestamp() });
      await flag(ref, protocol, said, 'collect', chat.participantCode);
      if (!model) return await fallback(ref, protocol, 'no model');
      try {
        let done = turns >= protocol.maxTurns;
        if (!done) {
          const turn = await call<{ reply: string; interviewDone: boolean; questionsCovered?: number[] }>(db, ref, model, interviewerPrompt(protocol, transcript), protocol, 'collect');
          // The closing turn's reply is discarded, as MySelf does: the app says what happens next, not the model.
          if (turn.interviewDone) {
            const distress = (chat.flags ?? []).some((f) => f.tier === 'safeguarding_review') || safeguardingHits(protocol, said).some((h) => h.tier === 'safeguarding_review');
            if (endedEarly(protocol, turn.questionsCovered, distress)) {
              await ref.update({ interviewDone: true, interviewClosed: 'stopped_early', questionsCovered: turn.questionsCovered ?? [], status: 'stopped', fallback: 'participant stopped', stoppedEarly: true, updatedAt: FieldValue.serverTimestamp() });
              return { stage: 'stopped', text: STOPPED_EARLY };
            }
            done = true;
          }
          else {
            await ref.update({ transcript: FieldValue.arrayUnion({ role: 'assistant', content: turn.reply, at: new Date().toISOString() }) });
            return { stage: 'interview', reply: turn.reply };
          }
        }
        await ref.update({ interviewDone: true, interviewClosed: turns >= protocol.maxTurns ? 'turn_limit' : 'model' });
        const { extraction, candidates } = await retell(db, ref, model, protocol, transcript);
        if (!candidates.length) return await fallback(ref, protocol, 'no retelling could be generated', extraction);
        await ref.update({ extraction, candidates, status: 'choose', updatedAt: FieldValue.serverTimestamp() });
        return { stage: 'choose', candidates: candidates.map(({ index, text: t }) => ({ index, text: t })) };
      } catch {
        return await fallback(ref, protocol, 'the model could not be reached');
      }
    }
    case 'choose': {
      if (chat.status !== 'choose') throw new HttpsError('failed-precondition', 'There is nothing to choose from yet.');
      const picked = chat.candidates.find((c) => c.index === data.index);
      if (!picked) throw new HttpsError('invalid-argument', 'Choose one of the stories.');
      await ref.update({ chosenIndex: picked.index, finalScenario: picked.text, status: 'rate', updatedAt: FieldValue.serverTimestamp() });
      return { stage: 'rate', story: picked.text };
    }
    case 'rate': {
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
        const revised = cleanAdaptation(out.newScenario) || base;
        await ref.update({ requests: FieldValue.arrayUnion({ request: ask, before: base, after: revised, changed: out.changed, at: new Date().toISOString() }), finalScenario: revised, updatedAt: FieldValue.serverTimestamp() });
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
