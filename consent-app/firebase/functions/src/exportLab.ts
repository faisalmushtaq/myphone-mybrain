import type { DocumentData } from 'firebase-admin/firestore';
import JSZip from 'jszip';
import { jsonFile, jsonlFile, rejectedOf, researchDocs, textFile, toTsv, tsvFile, type Doc, type OutFile, type Row } from './export.js';
import { cleaner, labCheckInForm, labConsentForm, labStudy, storyChats, storyStructures, type StoryPhase, type StorySignifier } from './forms.js';

/**
 * The social media break study's part of the hourly export: its own folder,
 * social-media-break/, holding the website's dataset, donations/, in BIDS
 * layout labelled by participant ID (already a pseudonym: the survey
 * platform builds the same ID from the same four details, so the laboratory
 * data and this donated data meet without a name), and its own identifying/ folder for the
 * consent records, names and signatures. The laboratory's own datasets (the
 * visits, any tracking) are expected to sit beside donations/, written by
 * the team, never inside it.
 *
 *   social-media-break/donations/participants.tsv              one row per consenting participant
 *   social-media-break/donations/sub-<CODE>/sub-<CODE>_sessions.tsv
 *                                               one session per phase of the study
 *                                               (ses-pre before the break, ses-mid the
 *                                               check-ins during it, ses-post after),
 *                                               however many sends it took
 *   social-media-break/donations/phenotype/checkin.tsv   the check-in answers, one row each
 *   social-media-break/donations/phenotype/mystory_<phase>.tsv   MyStory on the form, one row per story,
 *                                               one table per phase (each phase asks its own questions)
 *   social-media-break/donations/phenotype/mystory_chat_<phase>.tsv   MyStory's AI chat, one row per
 *                                               conversation, finished or not
 *   social-media-break/donations/sub-<CODE>/ses-<phase>/beh/*_task-donation_beh.tsv
 *                                               the files of that phase, with what the
 *                                               cleaner's manifest says is inside, or
 *                                               the screenshot checks
 *   social-media-break/donations/sourcedata/sub-<CODE>/ses-<phase>/   the archives and screenshots
 *   social-media-break/donations/sourcedata/raw/*.jsonl   every record (labStoryChats: the chats in full)
 *   social-media-break/identifying/consents.tsv, consent_statements.tsv, signatures/,
 *                                               visits.tsv (the lab bookings), contacts.tsv,
 *                                               lab_times.tsv (the times offered), rejected_uploads.tsv,
 *                                               mystory_voice/ (spoken answers: a voice identifies
 *                                               a person, so never in donations/)
 */

const BIDS_VERSION = '1.10.0';
const TASK = 'donation';
const CODE_URL = 'https://github.com/faisalmushtaq/myphone-mybrain';
/** The study's folder in the export bucket, and its two website-owned subfolders. */
export const LAB_ROOT = 'social-media-break';
const B = `${LAB_ROOT}/donations`;
const I = `${LAB_ROOT}/identifying`;
const two = (n: number) => String(n).padStart(2, '0');

/** Where in the study a send belongs, from the page it came from: before the break, a check-in during it, after it. */
export type LabPhase = 'pre' | 'mid' | 'post';
export const LAB_PHASES: LabPhase[] = ['pre', 'mid', 'post'];

/**
 * The team's permanent test accounts on the live site, for trying the break
 * study's pages (MyStory's chat above all) as a participant would. Kept, and
 * left out of every file of the export, so the research data holds only real
 * participants. Added 14 October 2026 at the team's request.
 */
export const TEST_PARTICIPANTS: ReadonlySet<string> = new Set([
  'MP9C78C162BB9F', // the team's own, for checking MyStory by hand
  'MPEFE6E0593853', // used to test the AI chat live
]);

/** Everything in the snapshot except the test accounts' records, with how many records were set aside. */
export function withoutTestAccounts(snap: LabSnapshot): { snap: LabSnapshot; excluded: number } {
  let excluded = 0;
  const keep = (docs: Doc[] | undefined, byId = false): Doc[] =>
    (docs ?? []).filter((d) => {
      const code = byId ? d.id : String(d.data.participantCode ?? '');
      if (!TEST_PARTICIPANTS.has(code)) return true;
      excluded += 1;
      return false;
    });
  return {
    snap: {
      participants: keep(snap.participants, true),
      consents: keep(snap.consents),
      donations: keep(snap.donations),
      reminders: keep(snap.reminders, true),
      checkIns: keep(snap.checkIns),
      stories: keep(snap.stories),
      storyChats: keep(snap.storyChats),
      bookings: keep(snap.bookings),
      contacts: keep(snap.contacts, true),
      // The times offered belong to no participant.
      slots: snap.slots ?? [],
    },
    excluded,
  };
}

export interface LabSnapshot {
  participants: Doc[];
  consents: Doc[];
  donations: Doc[];
  reminders: Doc[];
  checkIns: Doc[];
  /** MyStory (story.ts). */
  stories?: Doc[];
  /** MyStory's AI chat conversations (storyChat.ts). */
  storyChats?: Doc[];
  /** The lab visits and the contact details given when booking (booking.ts). */
  bookings?: Doc[];
  contacts?: Doc[];
  /** The lab times the team offers (labSlots, booking.ts). */
  slots?: Doc[];
}

/** Everything a participant sent in one phase of the study: one BIDS session, however many sends it took. */
export interface LabSession {
  code: string;
  label: string;
  /** ses-pre, ses-mid, ses-post, or ses-unspecified for sends recorded without a phase. */
  session: string;
  phase: string;
  /** The sends, in time order. */
  donations: Doc[];
  /** The files of those sends, in time order, each with the send it came in. */
  files: { file: DocumentData; donation: Doc }[];
}

/** sub-MP2670FF90A5F2: the participant ID is the BIDS label. */
export const labLabel = (code: string) => `sub-${code}`;

/** ses-pre, ses-mid or ses-post; anything else was recorded without a phase. */
export const labSessionLabel = (phase: unknown) => `ses-${LAB_PHASES.includes(phase as LabPhase) ? String(phase) : 'unspecified'}`;

/** Sends are grouped by participant and phase, so a participant has at most one pre, one mid and one post session. */
export function labSessionsOf(snap: LabSnapshot): LabSession[] {
  const sorted = [...snap.donations].sort((a, b) => String(a.data.receivedAt ?? '').localeCompare(String(b.data.receivedAt ?? '')));
  const byKey = new Map<string, LabSession>();
  for (const d of sorted) {
    const code = String(d.data.participantCode);
    const session = labSessionLabel(d.data.phase);
    const key = `${code}/${session}`;
    if (!byKey.has(key)) byKey.set(key, { code, label: labLabel(code), session, phase: session.slice('ses-'.length), donations: [], files: [] });
    const s = byKey.get(key)!;
    s.donations.push(d);
    for (const file of (d.data.files ?? []) as DocumentData[]) s.files.push({ file, donation: d });
  }
  const order = (s: LabSession) => {
    const i = LAB_PHASES.indexOf(s.phase as LabPhase);
    return i < 0 ? LAB_PHASES.length : i;
  };
  return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label) || order(a) - order(b));
}

/** Where a donated file lives inside the dataset, relative to the dataset root. */
export function labFile(s: LabSession, run: number, file: DocumentData): string {
  const kind = file.kind === 'archive' ? 'archive' : 'screenshot';
  const ext = kind === 'archive' ? 'zip' : /\.jpe?g$/i.test(String(file.path ?? '')) ? 'jpg' : 'png';
  return `sourcedata/${s.label}/${s.session}/${s.label}_${s.session}_run-${two(run)}_${kind}.${ext}`;
}

/** Where a signature image lives, relative to the study's identifying/ folder. */
export function labSignatureFile(code: string, version: unknown): string {
  const label = labLabel(code);
  return `signatures/${label}/${label}_consent-v${String(version ?? 1)}_signature.png`;
}

const byLabel = (a: Row, b: Row) => String(a.participant_id).localeCompare(String(b.participant_id));
const last = <T>(xs: T[]): T | undefined => xs[xs.length - 1];

/** Whole years on the day consent was confirmed, from the date of birth kept with the consent (the date itself stays in identifying/). */
export function ageOnConsent(consent: DocumentData | undefined): number | null {
  const dob = consent?.codeParts?.dateOfBirth;
  const on = consent?.confirmedDate;
  if (typeof dob !== 'string' || typeof on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dob) || !/^\d{4}-\d{2}-\d{2}$/.test(on)) return null;
  const [by, bm, bd] = dob.split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export function labParticipantsTable(snap: LabSnapshot): Row[] {
  const sessions = labSessionsOf(snap);
  const consentBy = new Map(snap.consents.map((c) => [c.id, c]));
  return snap.participants
    .filter((p) => p.data.consentId)
    .map(({ id, data: d }) => {
      const consent = consentBy.get(String(d.consentId));
      const mine = sessions.filter((s) => s.code === id);
      const files = mine.flatMap((s) => s.files.map((f) => f.file));
      const sends = mine.flatMap((s) => s.donations).sort((a, b) => String(a.data.receivedAt ?? '').localeCompare(String(b.data.receivedAt ?? '')));
      return {
        participant_id: labLabel(id),
        consented_on: consent?.data.confirmedDate,
        consent_version: consent?.data.formVersion,
        information_version: consent?.data.informationVersion,
        consent_n: d.consentVersion,
        age: ageOnConsent(consent?.data),
        phases: mine.map((s) => s.phase),
        sends_n: sends.length,
        checkins_n: snap.checkIns.filter((c) => c.data.participantCode === id).length,
        archives_n: files.filter((f) => f.kind === 'archive').length,
        screenshots_n: files.filter((f) => f.kind === 'screenshot').length,
        platforms: Array.from(new Set(files.flatMap((f) => (Array.isArray(f.platforms) ? (f.platforms as string[]) : [])))).sort(),
        platforms_not_used: Array.isArray(d.platformsNotUsed) ? [...(d.platformsNotUsed as string[])].sort() : [],
        phone: d.phone ?? last(sends)?.data.phone,
        first_send_at: sends[0]?.data.receivedAt,
        last_send_at: last(sends)?.data.receivedAt,
        stories_n: (snap.stories ?? []).filter((x) => x.data.participantCode === id).length,
        ...visitColumns(snap.bookings ?? [], id),
      };
    })
    .sort(byLabel);
}

/** The standing lab visits for a participant (booked, attended or missed; the latest of each), for participants.tsv. */
export function visitColumns(bookings: Doc[], code: string): Row {
  const out: Row = {};
  for (const visit of [1, 2]) {
    const mine = bookings.filter((b) => b.data.participantCode === code && b.data.visit === visit && b.data.status !== 'cancelled').sort((a, b) => String(a.data.start ?? '').localeCompare(String(b.data.start ?? '')));
    const latest = last(mine);
    out[`visit${visit}_on`] = latest ? String(latest.data.start ?? '').slice(0, 10) || null : null;
    out[`visit${visit}_status`] = latest?.data.status ?? null;
  }
  return out;
}

export const LAB_PARTICIPANT_COLUMNS = ['participant_id', 'consented_on', 'consent_version', 'information_version', 'consent_n', 'age', 'phases', 'sends_n', 'checkins_n', 'archives_n', 'screenshots_n', 'platforms', 'platforms_not_used', 'phone', 'first_send_at', 'last_send_at', 'stories_n', 'visit1_on', 'visit1_status', 'visit2_on', 'visit2_status'];

/* ── MyStory ───────────────────────────────────────────────────────────── */

/** MyStory's session_id is the phase, whether or not files were sent in it. */
const NOTE = '; a MyStory session can have no row in that participant’s sub-<CODE>_sessions.tsv (and no subject folder at all) when nothing was sent in that phase: the sessions files list only phases with files sent';
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').split('_').slice(0, 4).join('_');
const PHASE_SESSION: Record<StoryPhase, string> = { pre: 'ses-pre', mid: 'ses-mid', post: 'ses-post' };

/** The columns one signifier becomes: a triangle gives one share per corner; every signifier says whether it was answered. */
export function signifierColumns(sig: StorySignifier): string[] {
  const id = sig.id.replace(/-/g, '_');
  if (sig.type === 'triad') return [...sig.corners.map((c) => `${id}_${slug(c)}`), `${id}_status`];
  return [id, `${id}_status`];
}

export function labStoryColumns(phase: StoryPhase): string[] {
  return ['participant_id', 'session_id', 'story_id', 'story_n', 'submitted_at', 'structure_version', 'source', 'check_in_id', 'prompt_id', 'title', 'story', ...storyStructures[phase].signifiers.flatMap(signifierColumns)];
}

/** One phase's stories: one row each, in time order, the signifiers spread over their columns. */
export function labStoryTable(phase: StoryPhase, stories: Doc[]): Row[] {
  const structure = storyStructures[phase];
  // The chat's stories have their own table (labStoryChatTable).
  const mine = stories.filter((x) => x.data.phase === phase && x.data.mode !== 'chat').sort((a, b) => String(a.data.participantCode).localeCompare(String(b.data.participantCode)) || String(a.data.receivedAt ?? '').localeCompare(String(b.data.receivedAt ?? '')));
  const counts = new Map<string, number>();
  return mine.map(({ id, data: d }) => {
    const code = String(d.participantCode);
    counts.set(code, (counts.get(code) ?? 0) + 1);
    const row: Row = { participant_id: labLabel(code), session_id: PHASE_SESSION[phase], story_id: id, story_n: counts.get(code), submitted_at: d.receivedAt, structure_version: d.structureVersion, source: d.source, check_in_id: d.checkInId ?? null, prompt_id: d.promptId, title: d.title, story: d.story };
    const answers = (d.answers ?? {}) as Record<string, unknown>;
    for (const sig of structure.signifiers) {
      const a = answers[sig.id];
      const id2 = sig.id.replace(/-/g, '_');
      row[`${id2}_status`] = a === undefined || a === null ? 'skipped' : a === 'na' ? 'not-sure' : 'answered';
      const answered = a !== undefined && a !== null && a !== 'na';
      if (sig.type === 'triad') {
        const t = (answered ? a : {}) as Record<string, unknown>;
        sig.corners.forEach((c, i) => (row[`${id2}_${slug(c)}`] = answered ? t[['a', 'b', 'c'][i]] : null));
      } else row[id2] = answered ? (Array.isArray(a) ? a.join(',') : a) : null;
    }
    return row;
  });
}

/* ── MyStory's AI chat ─────────────────────────────────────────────────── */

export function labStoryChatColumns(phase: StoryPhase): string[] {
  return ['participant_id', 'session_id', 'chat_id', 'chat_n', 'story_id', 'started_at', 'finished_at', 'protocol', 'protocol_version', 'model', 'source', 'check_in_id', 'status', 'ending', 'turns', 'interview_closed', 'questions_covered', 'own_words', ...storyChats[phase].extractionKeys.map((k) => `said_${k.key}`), 'candidates_n', 'retellings_added', 'retellings_still_added', 'retellings_check_failed', 'chosen_persona', 'chosen_similarity', 'rating', 'requests_n', 'edited', 'voice_clips', 'final_story', 'final_similarity', 'flags', 'model_calls', 'failed_calls', 'input_tokens', 'output_tokens'];
}

/**
 * How a conversation ended, one set of levels for finished and unfinished
 * alike (16 October 2026; before, an unfinished one read "stopped: <reason>").
 * A finished one keeps what was filed; one never finished either stopped (the
 * participant stopped partway, or the model failed: storyChat.ts's fallback)
 * or was left.
 */
export function chatEnding(d: DocumentData): string | null {
  if (d.status === 'done') return d.ending ?? null;
  if (d.status === 'stopped') return d.fallback === 'participant stopped' || d.stoppedEarly === true || d.interviewClosed === 'stopped_early' ? 'stopped-early' : 'model-unavailable';
  return 'abandoned';
}

/** One phase's chat conversations, finished or not: one row each, the participant's own words by question, the retelling chosen, rated and corrected. */
export function labStoryChatTable(phase: StoryPhase, chats: Doc[]): Row[] {
  const p = storyChats[phase];
  const counts = new Map<string, number>();
  return chats
    .filter((x) => x.data.phase === phase)
    .sort((a, b) => String(a.data.participantCode).localeCompare(String(b.data.participantCode)) || String(a.data.startedAt ?? '').localeCompare(String(b.data.startedAt ?? '')))
    .map(({ id, data: d }) => {
      const code = String(d.participantCode);
      counts.set(code, (counts.get(code) ?? 0) + 1);
      const candidates = (d.candidates ?? []) as { index: number; persona: string; added?: string[]; stillAdded?: string[]; similarity?: number | null; checkFailed?: boolean }[];
      const chosen = candidates.find((c) => c.index === d.chosenIndex);
      const calls = (d.calls ?? []) as { ok: boolean; inputTokens?: number; outputTokens?: number }[];
      const transcript = (d.transcript ?? []) as { role: string; content: string }[];
      const row: Row = {
        participant_id: labLabel(code),
        session_id: PHASE_SESSION[phase],
        chat_id: id,
        chat_n: counts.get(code),
        story_id: d.storyId ?? null,
        started_at: d.startedAt,
        finished_at: d.finishedAt ?? null,
        protocol: d.protocolKey,
        protocol_version: d.protocolVersion,
        model: d.model ?? null,
        source: d.source,
        check_in_id: d.checkInId ?? null,
        status: d.status,
        ending: chatEnding(d),
        turns: d.turns ?? 0,
        interview_closed: d.interviewClosed ?? null,
        questions_covered: Array.isArray(d.questionsCovered) ? d.questionsCovered : null,
        // Everything they typed (or spoke and sent), whatever became of the chat: the words are kept even when no story was filed.
        own_words: transcript.filter((m) => m.role === 'user').map((m) => m.content).join(' / ') || null,
        candidates_n: candidates.length,
        retellings_added: candidates.reduce((n, c) => n + (c.added?.length ?? 0), 0),
        retellings_still_added: candidates.reduce((n, c) => n + (c.stillAdded?.length ?? 0), 0),
        retellings_check_failed: [...candidates, ...((d.requests ?? []) as { checkFailed?: boolean }[])].filter((c) => c.checkFailed === true).length,
        chosen_persona: chosen?.persona ?? null,
        chosen_similarity: chosen?.similarity ?? null,
        rating: d.rating ?? null,
        requests_n: ((d.requests ?? []) as unknown[]).length,
        edited: ((d.edits ?? []) as unknown[]).length > 0,
        voice_clips: ((d.voiceClips ?? []) as unknown[]).length,
        final_story: d.status === 'done' ? d.finalScenario : null,
        final_similarity: d.finalSimilarity ?? null,
        flags: ((d.flags ?? []) as { rule: string; tier: string }[]).map((f) => `${f.rule}:${f.tier}`).join(',') || null,
        model_calls: calls.length,
        failed_calls: calls.filter((c) => !c.ok).length,
        input_tokens: calls.reduce((n, c) => n + (c.inputTokens ?? 0), 0),
        output_tokens: calls.reduce((n, c) => n + (c.outputTokens ?? 0), 0),
      };
      const extraction = (d.extraction ?? {}) as Record<string, string | null>;
      for (const k of p.extractionKeys) row[`said_${k.key}`] = extraction[k.key] ?? null;
      return row;
    });
}

export function labStoryChatDictionary(phase: StoryPhase): Record<string, unknown> {
  const p = storyChats[phase];
  const out: Record<string, unknown> = {
    MeasurementToolMetadata: { Description: `MyStory's AI chat (${p.key} ${p.version}, ${p.model}): the MySelf micro-narrative protocol (Skeggs et al., CHI 2025, https://doi.org/10.1145/3706598.3713999). An AI interviewer asks the phase's questions one at a time; the answers are extracted in the participant's own words; ${p.personas.length} personas (${p.personas.map((x) => x.key).join(', ')}) each write a short retelling; the participant chooses one, rates how well it fits (0 to 10) and can edit it or ask for changes. The full conversations, every model call and every change are in sourcedata/raw/labStoryChats.jsonl.` },
    participant_id: { Description: 'sub- followed by the participant ID' },
    session_id: { Description: `${PHASE_SESSION[phase]}: the phase of the study${NOTE}` },
    chat_id: { Description: 'Identifier of the conversation (sourcedata/raw/labStoryChats.jsonl)' },
    chat_n: { Description: 'Which conversation this was for the participant in this phase, in order of starting: 1 for the first (a participant can chat more than once, after each mid-break check-in or after leaving one unfinished)' },
    story_id: { Description: 'The story filed at the end (sourcedata/raw/labStories.jsonl); empty if the conversation was not finished' },
    started_at: { Description: 'When the conversation started (ISO 8601, UTC)' },
    finished_at: { Description: 'When the story was filed' },
    protocol: { Description: 'The protocol run (src/lab/mystory/<phase>.toml)' },
    protocol_version: { Description: 'Its version' },
    model: { Description: 'The model the protocol asked for when the conversation started (each call’s own model, as the provider reported it, is in labStoryChats.jsonl, calls)' },
    source: { Description: 'The page the chat was on' },
    check_in_id: { Description: 'For a chat after a check-in: that check-in' },
    status: { Description: 'Where the conversation got to', Levels: { interview: 'Left during the questions', choose: 'Left before choosing a retelling', rate: 'Left before rating', adapt: 'Left while changing it', done: 'Finished, story filed', stopped: 'Stopped before any retelling, for one of two reasons (see ending): the participant stopped partway or said something the team must review (interview_closed is stopped_early), or the model could not carry on. Their answers are kept (own_words); a story is filed only if they then pressed Finish (status done)' } },
    ending: { Description: 'How it ended. For a finished conversation (status done), how the story was filed; for one never finished, why', Levels: { 'rated-full-marks': 'Finished: rated 10, the chosen retelling kept as it was', kept: 'Finished: kept after changes asked of the AI, or as it was', edited: 'Finished: the participant edited the words themselves', 'stopped-early': 'The participant stopped partway, or said something the team must review, before the questions were done: no retellings were written. If finished, their own answers were filed as the story; if not (status stopped), they never pressed Finish and no story was filed', 'model-unavailable': 'The interviewer or the retellings could not be reached (the model failed). If finished, their own answers were filed as the story; if not (status stopped), no story was filed', abandoned: 'Not finished: the participant left (status interview, choose, rate or adapt) and no story was filed; their answers so far are in own_words' } },
    turns: { Description: 'Replies the participant typed in the interview' },
    interview_closed: { Description: 'What ended the questions; empty while they were still going', Levels: { model: 'The interviewer judged every question answered', turn_limit: 'The protocol’s turn limit', stopped_early: 'The interviewer closed before every question was answered and the participant had answered fewer than half, or said something the safeguarding rules flag for review: no retellings were written (ending stopped-early)' } },
    questions_covered: { Description: 'The protocol’s questions (numbered from 1, in the order of the said_ columns) the interviewer judged answered when it closed the questions; empty if the questions never closed, or closed at the turn limit, or before 16 October 2026 unless the participant stopped early' },
    own_words: { Description: 'Everything the participant typed (or spoke and sent) in the interview, in order, separated by " / ": kept for every conversation, finished or not' },
    candidates_n: { Description: 'Retellings offered' },
    retellings_added: { Description: 'Sentences in the retellings’ first drafts that were not what the participant said, found by the check before they were shown and fixed (each retelling’s draft, what was found and the version shown are in labStoryChats.jsonl, candidates)' },
    retellings_still_added: { Description: 'Sentences still not what they said after one fix, and so cut from the retelling before it was shown (the version before the cut is kept in labStoryChats.jsonl)' },
    retellings_check_failed: { Description: 'Retellings and rewrites asked for whose check could not run (the model call failed), and so were shown unchecked: candidates and requests with checkFailed in labStoryChats.jsonl' },
    chosen_similarity: { Description: 'Semantic similarity (cosine, text-embedding-3-small) between everything the participant said and the retelling they chose, as the original team measured it (Skeggs et al. 2025: real pairs M = 0.79, chance 0.37, with their embedding). For reviewing the lowest by hand; it decided nothing' },
    chosen_persona: { Description: 'The persona whose retelling was chosen', Levels: Object.fromEntries(p.personas.map((x) => [x.key, x.text.split('\n')[0]])) },
    rating: { Description: 'How close the chosen retelling was to what they wanted to say, 0 (not at all) to 10 (exactly right)' },
    requests_n: { Description: 'Changes asked of the AI' },
    edited: { Description: 'Whether the participant edited the words themselves' },
    voice_clips: { Description: 'Answers spoken rather than typed, each written down by gpt-4o-mini-transcribe into the reply box for the participant to check before sending (the words sent are in the conversation, the transcription with each clip in labStoryChats.jsonl). A voice identifies a person, so the recordings are not in this dataset: they are in the study’s identifying/ folder, mystory_voice/, listed in clips.tsv, for study coordinators only' },
    final_story: { Description: 'The story as filed' },
    final_similarity: { Description: 'The same similarity for the story as filed, after any changes; empty when the story is their own answers' },
    flags: { Description: 'Safeguarding rules matched (rule:tier), for the team to review; nothing was shown to the participant' },
    model_calls: { Description: 'Model calls made' },
    failed_calls: { Description: 'Model calls that failed' },
    input_tokens: { Description: 'Tokens sent to the model, all calls' },
    output_tokens: { Description: 'Tokens returned by the model, all calls' },
  };
  for (const k of p.extractionKeys) out[`said_${k.key}`] = { Description: `${k.question} (extracted from the conversation in the participant's own words; empty if they did not say)` };
  return out;
}

export function labStoryDictionary(phase: StoryPhase): Record<string, unknown> {
  const s = storyStructures[phase];
  const status = { Description: 'Whether this question was answered', Levels: { answered: 'Answered', 'not-sure': 'The participant chose “not sure” or “doesn’t apply”', skipped: 'Left out' } };
  const out: Record<string, unknown> = {
    MeasurementToolMetadata: { Description: `MyStory (${s.id} ${s.version}), ${s.title.toLowerCase()}: a short story in the participant’s own words about one of the prompts, then a few questions placing it, as in SenseMaker-style micro-narratives. Each phase of the study asks its own questions.` },
    participant_id: { Description: 'sub- followed by the participant ID' },
    session_id: { Description: `${PHASE_SESSION[phase]}: the phase of the study the story belongs to${NOTE}` },
    story_id: { Description: 'Identifier of the story' },
    story_n: { Description: 'Which story this was for the participant in this phase: 1 for the first' },
    submitted_at: { Description: 'When the story was received (ISO 8601, UTC)' },
    structure_version: { Description: `Version of ${s.id} answered` },
    source: { Description: 'The page the story was told on', Levels: { baseline: 'The first page, before the break', checkin: 'After a mid-break check-in', after: 'The after-break page', story: 'MyStory’s own page, from a personal link', book: 'The booking page' } },
    check_in_id: { Description: 'For a story told after a check-in: that check-in (phenotype/checkin.tsv)' },
    prompt_id: { Description: 'The prompt the participant chose to answer', Levels: Object.fromEntries(s.prompts.map((p) => [p.id, p.text])) },
    title: { Description: 'The title the participant gave the story' },
    story: { Description: 'The story, as typed (free text; participants are asked to leave out names)' },
  };
  for (const sig of s.signifiers) {
    const id = sig.id.replace(/-/g, '_');
    if (sig.type === 'triad') sig.corners.forEach((c, i) => (out[`${id}_${slug(c)}`] = { Description: `${sig.question} Share given to “${c}” (corner ${i + 1} of the triangle): the three shares add up to 1`, Units: 'proportion' }));
    else if (sig.type === 'dyad') out[id] = { Description: `${sig.question} A slider from 0 (“${sig.left}”) to 100 (“${sig.right}”)` };
    else out[id] = { Description: `${sig.question}${sig.multiple ? ' Several may be chosen, separated by commas.' : ''}`, Levels: Object.fromEntries(sig.options.map((o) => [o.value, o.label])) };
    out[`${id}_status`] = status;
  }
  return out;
}

export function labSessionsTable(sessions: LabSession[]): Row[] {
  return sessions.map((s) => ({
    session_id: s.session,
    phase: s.phase,
    acq_time: s.donations[0]?.data.receivedAt,
    last_send_at: last(s.donations)?.data.receivedAt,
    sends_n: s.donations.length,
    archives_n: s.files.filter((f) => f.file.kind === 'archive').length,
    screenshots_n: s.files.filter((f) => f.file.kind === 'screenshot').length,
    platforms: Array.from(new Set(s.files.flatMap((f) => (Array.isArray(f.file.platforms) ? (f.file.platforms as string[]) : [])))).sort(),
    phone: last(s.donations)?.data.phone,
    needs_review: s.donations.some((d) => d.data.needsReview === true),
    // Files the checks refused in this phase's sends, recorded from 16 October 2026 (identifying/rejected_uploads.tsv says why).
    rejected_n: s.donations.reduce((n, d) => n + rejectedOf(d.data).length, 0),
  }));
}

export const LAB_SESSION_COLUMNS = ['session_id', 'phase', 'acq_time', 'last_send_at', 'sends_n', 'archives_n', 'screenshots_n', 'platforms', 'phone', 'needs_review', 'rejected_n'];

export const LAB_REJECTED_COLUMNS = ['participant_code', 'participant_id', 'session_id', 'send_id', 'kind', 'upload_id', 'rejected_at', 'reason', 'reasons'];

/** Every file the server refused, with why: from a send that kept others (its labDonations record) or one that kept none (the participant's record). Recorded from 16 October 2026. */
export function labRejectedTable(snap: LabSnapshot): Row[] {
  const rows: Row[] = [];
  for (const d of snap.donations)
    for (const r of rejectedOf(d.data)) rows.push({ participant_code: d.data.participantCode, participant_id: labLabel(String(d.data.participantCode)), session_id: labSessionLabel(d.data.phase), send_id: d.id, kind: r.kind ?? null, upload_id: r.uploadId, rejected_at: r.at, reason: r.reason, reasons: r.reasons ?? [] });
  for (const p of snap.participants)
    for (const r of rejectedOf(p.data)) rows.push({ participant_code: p.id, participant_id: labLabel(p.id), session_id: labSessionLabel(r.phase), send_id: null, kind: r.kind ?? null, upload_id: r.uploadId, rejected_at: r.at, reason: r.reason, reasons: r.reasons ?? [] });
  return rows.sort((a, b) => String(a.rejected_at).localeCompare(String(b.rejected_at)) || String(a.upload_id).localeCompare(String(b.upload_id)));
}

export const LAB_TIME_COLUMNS = ['slot_id', 'start', 'end', 'visit', 'capacity', 'booked', 'status', 'location', 'note', 'booking_ids', 'created_at', 'updated_at'];

/** The lab times the team offered, in time order: places, how many booked, open or closed. The booking ids lead to visits.tsv, and a note is free text, so this sits in identifying/. */
export function labTimesTable(slots: Doc[]): Row[] {
  return [...slots]
    .sort((a, b) => String(a.data.start ?? '').localeCompare(String(b.data.start ?? '')) || a.id.localeCompare(b.id))
    .map(({ id, data: d }) => ({ slot_id: id, start: d.start, end: d.end, visit: d.visit ?? 'either', capacity: d.capacity, booked: d.booked ?? 0, status: d.status, location: d.location ?? null, note: d.note ?? null, booking_ids: Array.isArray(d.bookingIds) ? d.bookingIds : [], created_at: d.createdAt ?? null, updated_at: d.updatedAt ?? null }));
}

export function labBehTable(s: LabSession): Row[] {
  return s.files.map(({ file: f, donation }, i) => ({
    run: two(i + 1),
    kind: f.kind,
    filename: labFile(s, i + 1, f),
    tables: f.kind === 'archive' ? archiveTablesFor(f).map((t) => t.task) : null,
    received_at: donation.data.receivedAt,
    send_id: donation.id,
    check_in_id: donation.data.checkInId ?? null,
    bytes: f.bytes,
    sha256: f.sha256,
    platforms: f.platforms,
    categories: f.categories,
    ...Object.fromEntries(cleaner.categoryIds.map((id) => [`kept_${id}`, (f.kept as Record<string, number> | null | undefined)?.[id] ?? null])),
    cleaner: f.manifest?.cleaner,
    cleaned_at: f.manifest?.cleanedAt,
    entries: f.entries,
    unpacked_bytes: f.unpackedBytes,
    width: f.width,
    height: f.height,
    verdict: f.quality?.verdict,
    looks_like_screen: f.quality?.looksLikeScreen,
    apps_visible: f.quality?.appsVisible,
    checked_with_vision: f.quality?.checkedWithVision,
    terms_found: f.quality?.termsFound,
    reasons: f.quality?.reasons,
  }));
}

/* ── The archives, BIDS-ified ─────────────────────────────────────────────
 * A cleaned archive has no BIDS modality of its own, so besides keeping the
 * ZIP under sourcedata/ the export unpacks it, once, into tidy behavioural
 * tables, one per kind of record, each with a data dictionary:
 *   task-tiktokwatch    one row per video watched: time, link
 *   task-tiktoksearch   one row per search: time, search_term
 *   task-tiktokengage   likes, reposts and shares: time, action, link, method
 *   task-tiktokapp      app opens: time
 *   task-tiktoktotals   activity totals per section of the export
 *   task-youtubewatch   time, title, url, channel, channel_url
 *   task-youtubesearch  time, query, url
 *   task-youtubesubs    channel_id, channel_url, channel_title
 *   task-instagramreels, -instagramposts, -instagramlikes   time, url
 *   task-instagramsearch   time, search_term
 * Rows are the participant's own records as the cleaner left them; dates
 * stay as the platform wrote them (TikTok: "YYYY-MM-DD HH:MM:SS" UTC;
 * YouTube: ISO 8601). A derivatives dataset can aggregate them later.
 */

export interface ArchiveTable {
  task: string;
  columns: string[];
  dictionary: Record<string, unknown>;
  /** Which archive entry and (for TikTok) which cleaner category produce it. */
  entry: string;
  category?: string;
}

const dict = (description: string, columns: Record<string, string>) => ({ TaskDescription: description, ...Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, { Description: v }])) });

export const ARCHIVE_TABLES: ArchiveTable[] = [
  { task: 'tiktokwatch', entry: 'tiktok_cleaned.json', category: 'tt_watch', columns: ['time', 'link'], dictionary: dict('Videos watched on TikTok, from the participant’s own data export, reduced on their device to time and link.', { time: 'When the video was watched, as TikTok wrote it (YYYY-MM-DD HH:MM:SS, UTC)', link: 'Link to the video' }) },
  { task: 'tiktoksearch', entry: 'tiktok_cleaned.json', category: 'tt_search', columns: ['time', 'search_term'], dictionary: dict('Searches made on TikTok.', { time: 'When the search was made (YYYY-MM-DD HH:MM:SS, UTC)', search_term: 'The words searched for' }) },
  { task: 'tiktokengage', entry: 'tiktok_cleaned.json', category: 'tt_engage', columns: ['time', 'action', 'link', 'method'], dictionary: dict('Videos the participant liked, reposted or shared on TikTok.', { time: 'When (YYYY-MM-DD HH:MM:SS, UTC; likes may carry a date only)', action: 'like, repost or share', link: 'Link to the video', method: 'For shares, how it was shared' }) },
  { task: 'tiktokapp', entry: 'tiktok_cleaned.json', category: 'tt_login', columns: ['time'], dictionary: dict('Times the TikTok app was opened (TikTok’s login history, stripped of device and network details).', { time: 'When the app was opened (YYYY-MM-DD HH:MM:SS, UTC)' }) },
  { task: 'tiktoktotals', entry: 'tiktok_cleaned.json', category: 'tt_counts', columns: ['section', 'items'], dictionary: dict('How many records each section of the TikTok export held, counted on the device; the content itself was not kept.', { section: 'Section of the TikTok export', items: 'Number of records in it' }) },
  { task: 'youtubewatch', entry: 'youtube/history/watch-history.json', columns: ['time', 'title', 'url', 'channel', 'channel_url'], dictionary: dict('Videos watched on YouTube, from the participant’s Google Takeout export.', { time: 'When the video was watched (ISO 8601, as Google wrote it)', title: 'Video title, as recorded by Google (usually prefixed "Watched")', url: 'Link to the video', channel: 'Channel name', channel_url: 'Link to the channel' }) },
  { task: 'youtubesearch', entry: 'youtube/history/search-history.json', columns: ['time', 'query', 'url'], dictionary: dict('Searches made on YouTube.', { time: 'When the search was made (ISO 8601, as Google wrote it)', query: 'The words searched for', url: 'Link to the search results' }) },
  { task: 'youtubesubs', entry: 'youtube/subscriptions/subscriptions.csv', columns: ['channel_id', 'channel_url', 'channel_title'], dictionary: dict('Channels the participant subscribes to on YouTube.', { channel_id: 'YouTube channel id', channel_url: 'Link to the channel', channel_title: 'Channel name' }) },
  { task: 'instagramreels', entry: 'instagram/reels_watched.json', columns: ['time', 'url'], dictionary: dict('Reels watched on Instagram, from the participant’s own data export, reduced on their device to time and link.', { time: 'When the reel was watched (ISO 8601, UTC)', url: 'Link to the reel' }) },
  { task: 'instagramposts', entry: 'instagram/posts_viewed.json', columns: ['time', 'url'], dictionary: dict('Posts viewed on Instagram.', { time: 'When the post was viewed (ISO 8601, UTC)', url: 'Link to the post' }) },
  { task: 'instagramlikes', entry: 'instagram/likes.json', columns: ['time', 'url'], dictionary: dict('Posts liked on Instagram.', { time: 'When the post was liked (ISO 8601, UTC)', url: 'Link to the post' }) },
  { task: 'instagramsearch', entry: 'instagram/searches.json', columns: ['time', 'search_term'], dictionary: dict('Searches made on Instagram (accounts and words).', { time: 'When the search was made (ISO 8601, UTC)', search_term: 'The account or words searched for' }) },
];

/** The tables an archive yields, decided from its record alone (entries and kept categories), so the expected paths are known without opening it. */
export function archiveTablesFor(file: DocumentData): ArchiveTable[] {
  const entries = new Set(Array.isArray(file.entries) ? (file.entries as string[]) : []);
  const categories = new Set(Array.isArray(file.categories) ? (file.categories as string[]) : []);
  return ARCHIVE_TABLES.filter((t) => entries.has(t.entry) && (!t.category || categories.has(t.category)));
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
type Json = Record<string, unknown>;
const asRows = (v: unknown): Json[] => (Array.isArray(v) ? v.filter((x): x is Json => typeof x === 'object' && x !== null) : []);

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim().length));
}

/** Turns the files inside a cleaned archive into rows for one table. */
export function archiveTableRows(table: ArchiveTable, texts: Map<string, string>): Row[] {
  const text = texts.get(table.entry);
  if (text === undefined) return [];
  if (table.entry === 'tiktok_cleaned.json') {
    const data = JSON.parse(text) as Json;
    const act = (data.Activity ?? {}) as Json;
    switch (table.task) {
      case 'tiktokwatch':
        return asRows(act.WatchHistory).map((r) => ({ time: str(r.Date), link: str(r.Link) }));
      case 'tiktoksearch':
        return asRows(act.Searches).map((r) => ({ time: str(r.Date), search_term: str(r.SearchTerm) }));
      case 'tiktokengage':
        return [
          ...asRows(act.Likes).map((r) => ({ time: str(r.date ?? r.Date), action: 'like', link: str(r.link ?? r.Link), method: '' })),
          ...asRows(act.Reposts).map((r) => ({ time: str(r.Date), action: 'repost', link: str(r.Link), method: '' })),
          ...asRows(act.Shares).map((r) => ({ time: str(r.Date), action: 'share', link: str(r.Link), method: str(r.Method) })),
        ].sort((a, b) => a.time.localeCompare(b.time));
      case 'tiktokapp':
        return asRows(act.LoginTimestamps).map((r) => ({ time: str(r.Date) }));
      case 'tiktoktotals':
        return Object.entries((data.AggregateCounts ?? {}) as Record<string, unknown>).map(([section, items]) => ({ section, items }));
      default:
        return [];
    }
  }
  if (table.task === 'youtubewatch') return asRows(JSON.parse(text)).map((r) => ({ time: str(r.time), title: str(r.title), url: str(r.titleUrl), channel: str(asRows(r.subtitles)[0]?.name), channel_url: str(asRows(r.subtitles)[0]?.url) }));
  if (table.task === 'youtubesearch') return asRows(JSON.parse(text)).map((r) => ({ time: str(r.time), query: str(r.title).replace(/^Searched for /, ''), url: str(r.titleUrl) }));
  if (table.task.startsWith('instagram')) return asRows(JSON.parse(text)).map((r) => (table.task === 'instagramsearch' ? { time: str(r.time), search_term: str(r.search) } : { time: str(r.time), url: str(r.url) }));
  if (table.task === 'youtubesubs') {
    const [header, ...rows] = parseCsv(text);
    const col = (name: RegExp) => header?.findIndex((h) => name.test(h)) ?? -1;
    const id = col(/id/i);
    const url = col(/url/i);
    const title = col(/title/i);
    return rows.map((r) => ({ channel_id: r[id] ?? '', channel_url: r[url] ?? '', channel_title: r[title] ?? '' }));
  }
  return [];
}

/** Where an archive's tables go, relative to the dataset root: beside the index, named by task and the archive's run. */
export function archiveTablePath(s: LabSession, run: number, task: string): string {
  return `${s.label}/${s.session}/beh/${s.label}_${s.session}_task-${task}_run-${two(run)}_beh`;
}

/** Something to build from a stored file once, when its outputs are missing from the bucket. */
export interface Derivation {
  source: string;
  /** The archive's own place in the export, and its SHA-256 from the record: what manifest.json names when it cannot be unpacked. */
  archive: string;
  sha256?: string | null;
  paths: string[];
  build: (buffer: Buffer) => Promise<OutFile[]>;
}

export async function buildArchiveTables(zipBuffer: Buffer, tables: { table: ArchiveTable; base: string }[]): Promise<OutFile[]> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const texts = new Map<string, string>();
  for (const name of Object.keys(zip.files)) if (!zip.files[name].dir) texts.set(name, await zip.files[name].async('string'));
  const out: OutFile[] = [];
  for (const { table, base } of tables) {
    const rows = archiveTableRows(table, texts);
    out.push({ path: `${base}.tsv`, body: toTsv(rows, table.columns), contentType: 'text/tab-separated-values; charset=utf-8' }, jsonFile(`${base}.json`, { TaskName: table.task, ...table.dictionary }));
  }
  return out;
}

export function labConsentTables(docs: Doc[]): { records: Row[]; statements: Row[] } {
  const records = docs.map(({ id, data: d }) => ({
    consent_id: id,
    participant_id: labLabel(String(d.participantCode)),
    participant_code: d.participantCode,
    version: d.version,
    supersedes: d.supersedes,
    form_id: d.formId,
    form_version: d.formVersion,
    information_version: d.informationVersion,
    typed_name: d.typedName,
    first_name: d.codeParts?.firstName,
    last_name: d.codeParts?.lastName,
    date_of_birth: d.codeParts?.dateOfBirth,
    postcode: d.codeParts?.postcode,
    signature_method: d.signature?.method,
    signature_typed_name: d.signature?.typedName,
    signature_file: d.signature?.image?.path ? labSignatureFile(String(d.participantCode), d.version) : null,
    confirmed_date: d.confirmedDate,
    completed_at: d.completedAt,
    received_at: d.receivedAt,
    created_at: d.createdAt,
  }));
  const statements = docs.flatMap(({ id, data: d }) =>
    Object.entries((d.responses ?? {}) as Record<string, DocumentData>).map(([statementId, r]) => ({
      consent_id: id,
      participant_id: labLabel(String(d.participantCode)),
      version: d.version,
      statement_id: statementId,
      statement_version: r.version,
      response: r.response,
      responded_at: r.respondedAt,
      via: r.via,
    })),
  );
  return { records, statements };
}

/** The mid-break check-ins: one row per check-in, in time order, with one column per question. */
export function labCheckInTable(checkIns: Doc[]): Row[] {
  return [...checkIns]
    .sort((a, b) => String(a.data.participantCode).localeCompare(String(b.data.participantCode)) || String(a.data.receivedAt ?? '').localeCompare(String(b.data.receivedAt ?? '')))
    .map(({ id, data: d }) => ({
      participant_id: labLabel(String(d.participantCode)),
      session_id: 'ses-mid',
      check_in_id: id,
      check_in_n: d.number,
      submitted_at: d.receivedAt,
      form_version: d.formVersion,
      ...Object.fromEntries(labCheckInForm.questions.map((q) => [q.id.replace(/-/g, '_'), (d.answers as Record<string, unknown> | undefined)?.[q.id] ?? null])),
    }));
}

export function labCheckInColumns(): string[] {
  return ['participant_id', 'session_id', 'check_in_id', 'check_in_n', 'submitted_at', 'form_version', ...labCheckInForm.questions.map((q) => q.id.replace(/-/g, '_'))];
}

export function labCheckInDictionary(): Record<string, unknown> {
  const out: Record<string, unknown> = {
    MeasurementToolMetadata: { Description: `The website’s mid-break check-in (${labCheckInForm.id} ${labCheckInForm.version}): a few questions answered during the social media break, as often as the participant checks in.` },
    participant_id: { Description: 'sub- followed by the participant ID' },
    session_id: { Description: 'Always ses-mid: the check-ins happen during the break; screenshots sent with them are in that session, linked by check_in_id' },
    check_in_id: { Description: 'Identifier of the check-in; the check_in_id column of ses-mid’s donation index points here' },
    check_in_n: { Description: 'Which check-in this was for the participant: 1 for the first' },
    submitted_at: { Description: 'When the check-in was received (ISO 8601, UTC)' },
    form_version: { Description: 'Version of the check-in questions answered' },
  };
  for (const q of labCheckInForm.questions) {
    out[q.id.replace(/-/g, '_')] = q.type === 'choice' ? { LongName: q.label, Description: q.text, Levels: Object.fromEntries(q.options.map((o) => [o.value, o.label])) } : { LongName: q.label, Description: `${q.text} Free text, at most ${q.maxLength} characters; n/a when left blank.` };
  }
  return out;
}

export function labDatasetDescription(exportedAt: string): Record<string, unknown> {
  return {
    Name: 'MyPhone/MyBrain social media break study: donated social media and screen-time data',
    BIDSVersion: BIDS_VERSION,
    DatasetType: 'raw',
    License: 'Restricted. Research data for the named study team only.',
    Authors: ['The MyPhone/MyBrain team, University of Leeds'],
    EthicsApprovals: ['University of Leeds School of Psychology Research Ethics Committee, SoPREC 4202, approved 11 June 2026'],
    GeneratedBy: [{ Name: 'MyPhone/MyBrain data donation export', Version: `${labConsentForm.id} ${labConsentForm.version}; cleaner ${cleaner.version}`, Description: 'Regenerated every hour from the study database; see the README', CodeURL: CODE_URL }],
    // The day, not the hour: the file then changes once a day, not every run (manifest.json has the exact time).
    SourceDatasets: [{ URL: `firestore://${labStudy.studyId}`, Version: exportedAt.slice(0, 10) }],
  };
}

export function labParticipantsDictionary(): Record<string, unknown> {
  return {
    participant_id: { Description: 'sub- followed by the participant ID: MP and the first 12 hexadecimal digits of the SHA-256 hash of the participant’s first name, last name, date of birth and postcode, normalised as described in the website’s docs/participant-id.md. The study’s survey platform builds the same ID from the same four details, so the two meet without a name.' },
    consented_on: { Description: 'Date the participant confirmed consent on the website, from the current consent record' },
    consent_version: { Description: 'Version of the consent form wording agreed to' },
    information_version: { Description: 'Version of the participant information sheet shown' },
    consent_n: { Description: 'Number of consent records for this participant (a second consent from another device is appended, never overwritten)' },
    age: { Description: 'Age in whole years on the day consent was confirmed, from the date of birth given (the date itself is kept in identifying/)', Units: 'years' },
    phases: { Description: 'Phases of the study with files sent: one session each, in sub-<CODE>_sessions.tsv. MyStory’s stories and chats carry the phase as session_id too (ses-pre, ses-mid, ses-post), even for a phase with no files sent and so no row in the sessions file', Levels: { pre: 'Before the social media break, from the first page (ses-pre)', mid: 'Screenshots sent with the mid-break check-ins (ses-mid)', post: 'After the break, from the after-break page (ses-post)', unspecified: 'Sent before phases were recorded (ses-unspecified)' } },
    sends_n: { Description: 'Occasions on which files were sent, across all phases' },
    checkins_n: { Description: 'Mid-break check-ins sent; the answers are in phenotype/checkin.tsv' },
    archives_n: { Description: 'Cleaned TikTok or YouTube archives accepted in total' },
    screenshots_n: { Description: 'Screen-time screenshots accepted in total' },
    platforms: { Description: 'Platforms found in the cleaned archives', Levels: { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram' } },
    platforms_not_used: { Description: 'Apps the participant said they do not use (“I don’t use it” on the website), so no data is expected from them; an app comes off this list if its data is sent later', Levels: { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram' } },
    phone: { Description: 'Phone the screen-time screenshots come from, as chosen on the screenshots step', Levels: { iphone: 'iPhone', android: 'Android' } },
    first_send_at: { Description: 'When the first send was received (ISO 8601, UTC)' },
    last_send_at: { Description: 'When the latest send was received (ISO 8601, UTC)' },
    stories_n: { Description: 'MyStory stories filed, all phases together: those written on the form (phenotype/mystory_<phase>.tsv) and those filed at the end of the AI chat (story_id in phenotype/mystory_chat_<phase>.tsv); a chat left unfinished files none' },
    visit1_on: { Description: 'Date of the first lab visit (YYYY-MM-DD, from the booking’s start in UTC): the latest booking for that visit that was not cancelled (a moved visit counts at its new time); n/a when none is booked. The bookings themselves are in identifying/visits.tsv' },
    visit1_status: { Description: 'Where that booking stands', Levels: { booked: 'Booked, not yet marked', attended: 'The team marked it attended', missed: 'The team marked it missed' } },
    visit2_on: { Description: 'Date of the second lab visit, as visit1_on' },
    visit2_status: { Description: 'Where that booking stands', Levels: { booked: 'Booked, not yet marked', attended: 'The team marked it attended', missed: 'The team marked it missed' } },
  };
}

export function labBehDictionary(): Record<string, unknown> {
  const out: Record<string, unknown> = {
    TaskName: TASK,
    TaskDescription: 'The participant downloaded their own TikTok, YouTube or Instagram data, removed everything but dates, links and search words on their own device (keeping only the categories they ticked), and sent the cleaned archive together with screenshots of their phone’s screen-time summary: before their social media break from the first page (ses-pre), with the weekly check-ins during it (screenshots only, ses-mid), and after it from the after-break page (ses-post). The files are under sourcedata/; this table lists them with what each archive’s manifest says is inside and the automatic checks run on each screenshot.',
    run: { Description: 'Order of the file within this session (all sends of this phase, in time order)' },
    kind: { Description: 'What the file is', Levels: { archive: 'A cleaned ZIP archive made by the website’s cleaner', screenshot: 'A screen-time screenshot, re-encoded without device metadata' } },
    filename: { Description: 'Path of the file, relative to the dataset root' },
    tables: { Description: 'For an archive, the task labels of the behavioural tables it was unpacked into, beside this file (sub-<CODE>_ses-<phase>_task-<label>_run-<nn>_beh.tsv)' },
    received_at: { Description: 'When the send that carried this file was received (ISO 8601, UTC)' },
    send_id: { Description: 'Identifier of the send; files with the same id arrived together' },
    check_in_id: { Description: 'For screenshots sent with a mid-break check-in (ses-mid), the check-in they belong to; see phenotype/checkin.tsv' },
    bytes: { Description: 'File size as stored', Units: 'bytes' },
    sha256: { Description: 'SHA-256 of the stored file' },
    platforms: { Description: 'Platforms the archive holds (archives only)', Levels: { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram' } },
    categories: { Description: 'Categories the participant chose to keep (archives only); see the kept_* columns' },
  };
  const platformName: Record<string, string> = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram' };
  for (const id of cleaner.categoryIds) out[`kept_${id}`] = { Description: `Rows kept in “${cleaner.titleOf[id]}” (${platformName[cleaner.platformOf[id]] ?? cleaner.platformOf[id]}); n/a when the category was not kept or this is a screenshot` };
  Object.assign(out, {
    cleaner: { Description: 'The cleaner that made the archive, from its manifest' },
    cleaned_at: { Description: 'When the archive was cleaned on the participant’s device (ISO 8601)' },
    entries: { Description: 'File names inside the archive' },
    unpacked_bytes: { Description: 'Total size of the files inside the archive', Units: 'bytes' },
    width: { Description: 'Screenshot width', Units: 'pixels' },
    height: { Description: 'Screenshot height', Units: 'pixels' },
    verdict: { Description: 'Automatic quality check on a screenshot', Levels: { accepted: 'Looks like a screen-time page', review: 'Kept, but a person should look' } },
    looks_like_screen: { Description: 'Whether the image looks like a phone screenshot rather than a photograph' },
    apps_visible: { Description: 'Whether the text suggests the per-app list with times is in the picture' },
    checked_with_vision: { Description: 'Whether Cloud Vision text and SafeSearch detection ran' },
    terms_found: { Description: 'Screen-time words found by text detection' },
    reasons: { Description: 'Notes from the checks, for the team' },
  });
  return out;
}

const LAB_README = `MyPhone/MyBrain social media break study: donated data

Adults taking part in the laboratory study (two EEG visits around a break
from social media) download their own TikTok, YouTube or Instagram data, keep
only the categories they choose, reduced on their own device to dates, links
and search words, and send the cleaned archive together with screenshots of
their phone's screen-time summary: before the break from the first page, and
again after it from the after-break page. During the break they check in on
a third page with a few questions and, if they can, a screenshot. In each
phase they can also tell a short story about their phone use (MyStory),
either on a form or in a chat with an AI interviewer. This
dataset is regenerated automatically every hour from the study's database
and mirrors the current records. Do not edit files here.

participants.tsv          one row per participant with consent on file:
                          consent dates and versions, phases with data, sends,
                          check-ins, archives and screenshots, platforms, phone,
                          stories, and the dates of the two lab visits
phenotype/checkin.tsv     the mid-break check-ins: one row per check-in, one
                          column per question, with checkin.json describing
                          each question and its answers
phenotype/mystory_<phase>.tsv   MyStory written on the form: one row per story
                          (the prompt chosen, title, story, and the questions
                          placing it: a triangle's three shares, sliders from
                          0 to 100, choices), one table per phase (pre, mid,
                          post), each described by its .json
phenotype/mystory_chat_<phase>.tsv   MyStory's AI chat: one row per conversation,
                          finished or not (everything the participant said,
                          the answers by question in their own words, the
                          retelling chosen, its rating, changes, the story
                          filed, how it ended), one table per phase, each
                          described by its .json. The stories the chat filed
                          are here, not in mystory_<phase>.tsv; the full
                          conversations are in sourcedata/raw/labStoryChats.jsonl.
                          session_id is the phase: a participant may have
                          stories in a phase with no files sent, and so no
                          row for it in their sessions file
sub-<CODE>/               one session per phase of the study: ses-pre holds
                          everything sent before the break, ses-mid the
                          screenshots sent with the check-ins (check_in_id links
                          each to phenotype/checkin.tsv), ses-post everything
                          sent after it (ses-unspecified for sends recorded
                          before phases were), however many sends it took.
                          Its beh/ folder holds
                          *_task-donation_beh.tsv, the index of files sent (with
                          what each archive's manifest says is inside, or the
                          screenshot's automatic checks), and, unpacked from each
                          archive, one table per kind of record with its own
                          data dictionary:
                            task-tiktokwatch    videos watched: time, link
                            task-tiktoksearch   searches: time, search_term
                            task-tiktokengage   likes, reposts, shares
                            task-tiktokapp      app opens: time
                            task-tiktoktotals   record counts per section
                            task-youtubewatch   time, title, url, channel
                            task-youtubesearch  time, query, url
                            task-youtubesubs    subscriptions
                            task-instagramreels, -posts, -likes   time, url
                            task-instagramsearch   time, search_term
                          The run number ties a table to its archive in the index.
                          The sessions file gives each phase's first and last send,
                          and (rejected_n, from 16 October 2026) how many files
                          the checks refused; why is in identifying/rejected_uploads.tsv.
sourcedata/               the cleaned archives (.zip) and screenshots as received,
                          named by subject, session and run
sourcedata/raw/           every record as JSON Lines (without the website's
                          sign-in ids or anything about the device): labParticipants,
                          labDonations, labCheckIns, labStories (every MyStory
                          story) and labStoryChats (every chat in full: each
                          turn, model call, retelling, change, the safeguarding
                          rules matched and the words that matched, and what
                          each spoken answer was written down as)

Participants are labelled by their participant ID (sub-MP2670FF90A5F2):
MP and 12 hexadecimal digits of a hash of their first name, last name, date
of birth and postcode, built the same way by the study's survey platform, so
this data and the questionnaire and laboratory data can be joined without a
name. Names, dates of birth, postcodes and signatures from the consent
records are kept outside this dataset, in the identifying/ folder next to
it, for study coordinators only; participants.tsv has age at consent. So are
the recordings of answers spoken in MyStory's chat (identifying/mystory_voice/,
listed in clips.tsv): a voice identifies a person. Participants listed in participants.tsv without a subject folder
have consented but not sent anything yet.

Inside a cleaned archive: manifest.json (what was kept and removed),
tiktok_cleaned.json (TikTok: watch history, searches, likes, reposts, shares,
app-open times, activity totals, each reduced to dates, links and terms),
youtube/history/watch-history.json, youtube/history/search-history.json,
youtube/subscriptions/subscriptions.csv, and instagram/reels_watched.json,
posts_viewed.json, likes.json and searches.json (time and link, or the search
words). The server accepts no other file names and never opens the content
beyond checking it is well-formed and unpacking it into the tables above.

Timestamps are ISO 8601 in UTC. Missing values are n/a.
`;

const LAB_SOURCEDATA_README = `Cleaned archives and screenshots as received, named
sub-<CODE>_ses-<phase>_run-<nn>_archive.zip or _screenshot.png/.jpg, and in
raw/ every record of the study's collections as JSON Lines (labParticipants,
labDonations, labCheckIns, labStories, labStoryChats: MyStory's chats in full).
The recordings of answers spoken in MyStory's chat are not here: a voice
identifies a person, so they are in ../../identifying/mystory_voice/. See
../README.
`;

const LAB_ROOT_README = `# MyPhone/MyBrain: the social media break study

The adult laboratory study (two EEG visits around a break from social
media). This folder gathers the study's datasets, all labelled by the
participant ID built from first name, last name, date of birth and postcode
(sub-MP2670FF90A5F2), so they join without a name.

donations/     written by the website every hour: the TikTok, YouTube and
               Instagram data participants cleaned on their own device and
               donated, with their screen-time screenshots, before and after
               the break, the mid-break check-ins, and MyStory (stories
               written on the form, phenotype/mystory_<phase>.tsv, and
               conversations with the AI interviewer,
               phenotype/mystory_chat_<phase>.tsv, in full in
               sourcedata/raw/); BIDS layout, no names; for researchers
identifying/   written by the website every hour: consent records with typed
               names, the four details the participant ID is built from
               (first name, last name, date of birth, postcode), signatures,
               the lab visits and contact details, and the recordings of
               answers spoken in MyStory's chat (mystory_voice/); for study
               coordinators only

The two folders above are mirrors: anything added inside them is removed on
the next run. Keep the laboratory's own datasets (the visits, any tracking)
beside them in this folder, for example lab-visits/, never inside them.
`;

const LAB_IDENTIFYING_README = `Identifying data for the social media break study. Study coordinators only.
Regenerated every hour as a mirror of the database; do not edit files here.

consents.tsv             every consent record, by participant ID, with the typed
                         name and the four details the ID is built from
                         (first name, last name, date of birth, postcode);
                         a second consent for the same ID is a new row and
                         supersedes points at the one before
consent_statements.tsv   one row per statement per consent record
reminders.tsv            email addresses of participants who asked for a progress
                         email, when it and the one follow-up were sent
visits.tsv               every lab booking: visit, time, place, booked, moved,
                         attended, missed or cancelled, and each confirmation
                         and reminder with its outcome
contacts.tsv             the email address and UK mobile given when booking, and
                         whether texts were wanted
lab_times.tsv            every lab time offered: start, end, which visit, places,
                         how many booked (the booking ids lead to visits.tsv),
                         open or closed, room and the team's note
rejected_uploads.tsv     every file the checks refused (from 16 October 2026),
                         with the reason the participant was shown; never the
                         file, which is not kept
signatures/              drawn signatures, named by participant ID and version
mystory_voice/           answers spoken in MyStory's AI chat, as recorded:
                         sub-<CODE>/ses-<phase>/sub-<CODE>_ses-<phase>_chat-<id>_clip-<nn>.<ext>,
                         listed with their length, format and stage in
                         clips.tsv (described by clips.json); what each was
                         written down as is in the chat's record in
                         donations/sourcedata/raw/labStoryChats.jsonl
raw/                     every document as JSON Lines (consents, bookings,
                         contacts, reminders, slots), without the website's
                         sign-in ids

Files are tab-separated UTF-8 with n/a for missing values; timestamps are
ISO 8601 in UTC. The donated data, labelled by code only, is in the
donations/ folder next to this one.
`;

export const LAB_VISIT_COLUMNS = ['participant_code', 'participant_id', 'visit', 'start', 'end', 'place', 'status', 'booked_at', 'booked_by', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'replaces', 'confirmation_email', 'confirmation_text', 'reminders', 'booking_id'];

/** Every lab booking, in time order: booked, moved (the old one cancelled, pointing at the new), attended, missed. */
export function labVisitsTable(bookings: Doc[]): Row[] {
  return [...bookings]
    .sort((a, b) => String(a.data.start ?? '').localeCompare(String(b.data.start ?? '')))
    .map(({ id, data: d }) => ({
      participant_code: d.participantCode,
      participant_id: labLabel(String(d.participantCode)),
      visit: d.visit,
      start: d.start,
      end: d.end,
      place: d.place?.name,
      status: d.status,
      booked_at: d.bookedAt,
      booked_by: d.bookedBy,
      cancelled_at: d.cancelledAt,
      cancelled_by: d.cancelledBy,
      cancel_reason: d.cancelReason,
      replaces: d.replaces,
      confirmation_email: d.confirmation?.email,
      confirmation_text: d.confirmation?.sms,
      reminders: Object.entries((d.reminders ?? {}) as Record<string, Record<string, unknown>>)
        .map(([k, v]) => `${k}:${String(v?.outcome ?? v?.skipped ?? 'claimed')}`)
        .sort(),
      booking_id: id,
    }));
}

/* ── MyStory's recordings ──────────────────────────────────────────────── */

/** The recordings' folder inside the study's identifying/ folder (the Mac's "bids" copy skips identifying/). */
export const VOICE = 'mystory_voice';
export const LAB_VOICE_COLUMNS = ['participant_id', 'session_id', 'chat_id', 'clip_id', 'file', 'seconds', 'bytes', 'mime_type', 'stage', 'transcribed_ok', 'recorded_at'];

/**
 * Every recording of every conversation, named BIDS-style and numbered in the
 * order the conversation holds them:
 * sub-<CODE>/ses-<phase>/sub-<CODE>_ses-<phase>_chat-<chatId>_clip-<nn>.<ext>,
 * relative to mystory_voice/. A clip whose recording could not be kept is
 * listed without a file, and keeps its number.
 */
export function labVoiceClips(chats: Doc[]): { source: string | null; file: string | null; row: Row }[] {
  const sorted = [...chats].sort((a, b) => String(a.data.participantCode).localeCompare(String(b.data.participantCode)) || String(a.data.startedAt ?? '').localeCompare(String(b.data.startedAt ?? '')));
  return sorted.flatMap(({ id, data: d }) => {
    const label = labLabel(String(d.participantCode));
    const session = labSessionLabel(d.phase);
    return ((d.voiceClips ?? []) as DocumentData[]).map((clip, i) => {
      const source = typeof clip.path === 'string' ? clip.path : null;
      const ext = source ? /\.([a-z0-9]{2,5})$/i.exec(source)?.[1]?.toLowerCase() ?? 'bin' : null;
      const file = source ? `${label}/${session}/${label}_${session}_chat-${id}_clip-${two(i + 1)}.${ext}` : null;
      return { source, file, row: { participant_id: label, session_id: session, chat_id: id, clip_id: clip.clipId, file, seconds: clip.seconds ?? null, bytes: clip.bytes ?? null, mime_type: clip.mimeType ?? null, stage: clip.stage ?? null, transcribed_ok: clip.ok ?? null, recorded_at: clip.at ?? null } };
    });
  });
}

export function labVoiceDictionary(): Record<string, unknown> {
  return {
    MeasurementToolMetadata: { Description: 'MyStory’s AI chat lets participants speak an answer instead of typing it (from 14 October 2026). Each recording is kept as sent and listed here, one row per clip. A voice identifies a person, so the recordings are kept here, in identifying/, for study coordinators only, never in the donations/ dataset. What each clip was written down as, and the words the participant then sent, are in donations/sourcedata/raw/labStoryChats.jsonl (voiceClips, transcript).' },
    participant_id: { Description: 'sub- followed by the participant ID' },
    session_id: { Description: 'The phase of the study the conversation belongs to: ses-pre, ses-mid or ses-post (as in donations/phenotype/mystory_chat_<phase>.tsv)' },
    chat_id: { Description: 'The conversation (chat_id in donations/phenotype/mystory_chat_<phase>.tsv)' },
    clip_id: { Description: 'Identifier of the clip (voiceClips[].clipId in labStoryChats.jsonl)' },
    file: { Description: 'Path of the recording, relative to this folder; the clip number is its place in the conversation’s recordings, from 01. n/a when the recording could not be kept (the transcription may still have worked)' },
    seconds: { Description: 'Length of the recording, as the browser measured it', Units: 's' },
    bytes: { Description: 'Size of the recording as sent', Units: 'bytes' },
    mime_type: { Description: 'The format the participant’s browser recorded in (for example audio/webm;codecs=opus, audio/mp4)' },
    stage: { Description: 'Where in the conversation it was spoken', Levels: { interview: 'An answer to the interviewer', adapt: 'A change asked for to the chosen retelling' } },
    transcribed_ok: { Description: 'Whether it was written down; if not, the participant was asked to type their answer' },
    recorded_at: { Description: 'When it was received (ISO 8601, UTC)' },
  };
}

/** The lab study's files, binary copies and counts, for runExport to merge with the schools study's. */
export function labExport(everything: LabSnapshot, exportedAt: string): { files: OutFile[]; copies: Map<string, string>; hashes: Map<string, string>; derived: Derivation[]; counts: Record<string, number> } {
  const { snap, excluded } = withoutTestAccounts(everything);
  const sessions = labSessionsOf(snap);
  const behColumns = Object.keys(labBehDictionary()).filter((k) => !['TaskName', 'TaskDescription'].includes(k));
  const files: OutFile[] = [
    textFile(`${LAB_ROOT}/README.md`, LAB_ROOT_README, 'text/markdown; charset=utf-8'),
    jsonFile(`${B}/dataset_description.json`, labDatasetDescription(exportedAt)),
    textFile(`${B}/README`, LAB_README),
    textFile(`${B}/CHANGES`, `1.0.0 ${exportedAt.slice(0, 10)}\n  - Regenerated automatically every hour; see ../../manifest.json.\n`),
    tsvFile(`${B}/participants.tsv`, labParticipantsTable(snap), LAB_PARTICIPANT_COLUMNS),
    jsonFile(`${B}/participants.json`, labParticipantsDictionary()),
    tsvFile(`${B}/phenotype/checkin.tsv`, labCheckInTable(snap.checkIns), labCheckInColumns()),
    jsonFile(`${B}/phenotype/checkin.json`, labCheckInDictionary()),
    textFile(`${B}/sourcedata/README.md`, LAB_SOURCEDATA_README, 'text/markdown; charset=utf-8'),
    // Without the sign-in ids (left out of every raw file) or what the device said about itself (kept with the consent in identifying/raw/), 16 October 2026.
    jsonlFile(`${B}/sourcedata/raw/labParticipants.jsonl`, researchDocs(snap.participants)),
    jsonlFile(`${B}/sourcedata/raw/labDonations.jsonl`, researchDocs(snap.donations)),
    jsonlFile(`${B}/sourcedata/raw/labCheckIns.jsonl`, researchDocs(snap.checkIns)),
    jsonlFile(`${B}/sourcedata/raw/labStories.jsonl`, researchDocs(snap.stories ?? [])),
    jsonlFile(`${B}/sourcedata/raw/labStoryChats.jsonl`, researchDocs(snap.storyChats ?? [])),
    textFile(`${I}/README.md`, LAB_IDENTIFYING_README, 'text/markdown; charset=utf-8'),
    jsonlFile(`${I}/raw/consents.jsonl`, snap.consents),
    jsonlFile(`${I}/raw/bookings.jsonl`, snap.bookings ?? []),
    jsonlFile(`${I}/raw/contacts.jsonl`, snap.contacts ?? []),
    tsvFile(`${I}/visits.tsv`, labVisitsTable(snap.bookings ?? []), LAB_VISIT_COLUMNS),
    tsvFile(`${I}/lab_times.tsv`, labTimesTable(snap.slots ?? []), LAB_TIME_COLUMNS),
    tsvFile(`${I}/rejected_uploads.tsv`, labRejectedTable(snap), LAB_REJECTED_COLUMNS),
    jsonlFile(`${I}/raw/slots.jsonl`, snap.slots ?? []),
    tsvFile(
      `${I}/contacts.tsv`,
      (snap.contacts ?? []).map(({ id, data: d }) => ({ participant_code: id, participant_id: labLabel(id), email: d.email, mobile: d.mobile, sms_reminders: d.smsReminders, updated_at: d.updatedAt })),
      ['participant_code', 'participant_id', 'email', 'mobile', 'sms_reminders', 'updated_at'],
    ),
  ];
  for (const phase of LAB_PHASES) {
    files.push(tsvFile(`${B}/phenotype/mystory_${phase}.tsv`, labStoryTable(phase, snap.stories ?? []), labStoryColumns(phase)), jsonFile(`${B}/phenotype/mystory_${phase}.json`, labStoryDictionary(phase)));
    files.push(tsvFile(`${B}/phenotype/mystory_chat_${phase}.tsv`, labStoryChatTable(phase, snap.storyChats ?? []), labStoryChatColumns(phase)), jsonFile(`${B}/phenotype/mystory_chat_${phase}.json`, labStoryChatDictionary(phase)));
  }
  const { records, statements } = labConsentTables(snap.consents);
  files.push(tsvFile(`${I}/consents.tsv`, records), tsvFile(`${I}/consent_statements.tsv`, statements));
  files.push(
    tsvFile(
      `${I}/reminders.tsv`,
      snap.reminders.map(({ id, data: d }) => ({ participant_code: id, participant_id: labLabel(id), email: d.email, requested_at: d.requestedAt, status_email: d.statusOutcome, follow_up_due_at: d.followUpDueAt, follow_up_sent_at: d.followUpSentAt, follow_up_email: d.followUpOutcome, completed_at: d.completedAt })),
      ['participant_code', 'participant_id', 'email', 'requested_at', 'status_email', 'follow_up_due_at', 'follow_up_sent_at', 'follow_up_email', 'completed_at'],
    ),
    jsonlFile(`${I}/raw/reminders.jsonl`, snap.reminders),
  );

  const bySubject = new Map<string, LabSession[]>();
  for (const s of sessions) {
    if (!bySubject.has(s.label)) bySubject.set(s.label, []);
    bySubject.get(s.label)!.push(s);
  }
  for (const [label, mine] of bySubject) {
    files.push(tsvFile(`${B}/${label}/${label}_sessions.tsv`, labSessionsTable(mine), LAB_SESSION_COLUMNS));
    for (const s of mine) {
      const base = `${B}/${label}/${s.session}/beh/${label}_${s.session}_task-${TASK}_beh`;
      files.push(tsvFile(`${base}.tsv`, labBehTable(s), behColumns), jsonFile(`${base}.json`, labBehDictionary()));
    }
  }

  const copies = new Map<string, string>();
  // The SHA-256 each record holds for its stored file, which the export stamps on the copy (exportWrite.ts).
  const hashes = new Map<string, string>();
  const derived: Derivation[] = [];
  for (const s of sessions) {
    s.files.forEach(({ file }, i) => {
      if (typeof file.path !== 'string') return;
      const archive = `${B}/${labFile(s, i + 1, file)}`;
      copies.set(file.path, archive);
      if (typeof file.sha256 === 'string') hashes.set(file.path, file.sha256);
      if (file.kind !== 'archive') return;
      const tables = archiveTablesFor(file).map((table) => ({ table, base: `${B}/${archiveTablePath(s, i + 1, table.task)}` }));
      if (tables.length) derived.push({ source: file.path, archive, sha256: typeof file.sha256 === 'string' ? file.sha256 : null, paths: tables.flatMap((t) => [`${t.base}.tsv`, `${t.base}.json`]), build: (buffer) => buildArchiveTables(buffer, tables) });
    });
  }
  // MyStory's spoken answers: a voice identifies a person, so the recordings go to identifying/, never donations/ (16 October 2026).
  const voice = labVoiceClips(snap.storyChats ?? []);
  for (const v of voice) if (v.source) copies.set(v.source, `${I}/${VOICE}/${v.file}`);
  files.push(tsvFile(`${I}/${VOICE}/clips.tsv`, voice.map((v) => v.row), LAB_VOICE_COLUMNS), jsonFile(`${I}/${VOICE}/clips.json`, labVoiceDictionary()));
  for (const c of snap.consents) {
    const path = c.data.signature?.image?.path;
    if (typeof path === 'string') copies.set(path, `${I}/${labSignatureFile(String(c.data.participantCode), c.data.version)}`);
    if (typeof path === 'string' && typeof c.data.signature?.image?.sha256 === 'string') hashes.set(path, c.data.signature.image.sha256);
  }

  const all = sessions.flatMap((s) => s.files.map((f) => f.file));
  const counts = {
    labParticipants: snap.participants.filter((p) => p.data.consentId).length,
    labConsents: snap.consents.length,
    labDonations: snap.donations.length,
    labArchives: all.filter((f) => f.kind === 'archive').length,
    labScreenshots: all.filter((f) => f.kind === 'screenshot').length,
    labSignatures: snap.consents.filter((c) => typeof c.data.signature?.image?.path === 'string').length,
    labCheckIns: snap.checkIns.length,
    labStories: (snap.stories ?? []).length,
    labStoryChats: (snap.storyChats ?? []).length,
    labStoryVoiceClips: (snap.storyChats ?? []).reduce((n, c) => n + ((c.data.voiceClips ?? []) as unknown[]).length, 0),
    labBookings: (snap.bookings ?? []).filter((b) => b.data.status !== 'cancelled').length,
    labTestRecordsLeftOut: excluded,
  };
  return { files, copies, hashes, derived, counts };
}
