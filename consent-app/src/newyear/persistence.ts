import { APP_IDS, LENGTHS, LIMITS, STORAGE_KEY, type AppId, type BreakLength } from './config';
import { isIsoDate } from './dates';
import type { CheckIn, NyState, Participant, StageRecord } from './model';
import { isFunName } from './names';
import { STAGE_IDS, type StageId } from './schedule';

/**
 * The preview keeps everything in this browser's localStorage, under one key.
 * Nothing is sent anywhere. Storage can be full, blocked (private browsing,
 * some embedded browsers) or cleared at any time, so every read and write is
 * wrapped and the page carries on without it.
 *
 * What is read back is checked field by field: anything malformed (an old
 * version, a hand-edited value) is dropped rather than trusted.
 */
type Saved = Pick<NyState, 'participant' | 'checkIns' | 'stages' | 'preview'>;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

function readParticipant(v: unknown): Participant | null {
  if (!isObj(v)) return null;
  const apps = Array.isArray(v.apps) ? v.apps.filter((a): a is AppId => typeof a === 'string' && (APP_IDS as readonly string[]).includes(a)) : [];
  if (!isFunName(v.name) || !apps.length || !(LENGTHS as readonly unknown[]).includes(v.lengthDays) || !isIsoDate(v.startDate) || !isIsoDate(v.joinedOn)) return null;
  const otherApp = typeof v.otherApp === 'string' ? v.otherApp.slice(0, LIMITS.otherApp) : '';
  return { name: v.name, apps: [...new Set(apps)], otherApp, lengthDays: v.lengthDays as BreakLength, startDate: v.startDate, joinedOn: v.joinedOn, joinedAt: typeof v.joinedAt === 'string' ? v.joinedAt : '' };
}

function readCheckIn(day: string, v: unknown): CheckIn | null {
  if (!isIsoDate(day) || !isObj(v)) return null;
  if (v.kept !== 'yes' && v.kept !== 'little' && v.kept !== 'lot') return null;
  if (!isInt(v.mood, 1, 5) || !isInt(v.craving, 1, 5)) return null;
  const slipMinutes = isInt(v.slipMinutes, 0, LIMITS.slipMinutes) && v.kept !== 'yes' ? v.slipMinutes : null;
  return {
    day,
    kept: v.kept,
    slipMinutes,
    mood: v.mood,
    craving: v.craving,
    note: typeof v.note === 'string' ? v.note.slice(0, LIMITS.note) : '',
    savedOn: isIsoDate(v.savedOn) ? v.savedOn : day,
    savedAt: typeof v.savedAt === 'string' ? v.savedAt : '',
  };
}

function readStage(v: unknown): StageRecord | null {
  if (!isObj(v)) return null;
  const span = isObj(v.digitSpan) && isObj(v.digitSpan.score) && typeof v.digitSpan.score.span === 'number' && Array.isArray(v.digitSpan.trials) ? (v.digitSpan as unknown as StageRecord['digitSpan']) : null;
  const odd = span && isObj(v.oddball) && isObj(v.oddball.scores) && typeof v.oddball.scores.hits === 'number' && Array.isArray(v.oddball.trials) ? (v.oddball as unknown as StageRecord['oddball']) : null;
  if (!span) return null;
  const complete = Boolean(odd) && isIsoDate(v.completedOn);
  return { digitSpan: span, oddball: odd, completedOn: complete ? (v.completedOn as string) : null, completedAt: complete && typeof v.completedAt === 'string' ? v.completedAt : null };
}

/** Saved progress, checked; null if there is none worth keeping. */
export function readSaved(raw: unknown): Saved | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  const participant = readParticipant(raw.participant);
  if (!participant) return null;
  const checkIns: Record<string, CheckIn> = {};
  if (isObj(raw.checkIns)) {
    for (const [day, value] of Object.entries(raw.checkIns)) {
      const c = readCheckIn(day, value);
      if (c) checkIns[day] = c;
    }
  }
  const stages: Partial<Record<StageId, StageRecord>> = {};
  if (isObj(raw.stages)) {
    for (const id of STAGE_IDS) {
      const s = readStage(raw.stages[id]);
      if (s) stages[id] = s;
    }
  }
  const offset = isObj(raw.preview) && isInt(raw.preview.dayOffset, 0, 400) ? raw.preview.dayOffset : 0;
  return { participant, checkIns, stages, preview: { dayOffset: offset } };
}

export function loadNyState(): Saved | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    return raw ? readSaved(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

let timer: number | null = null;
let pending: NyState | null = null;

function write(state: NyState): void {
  const store = storage();
  if (!store) return;
  try {
    if (!state.participant) {
      store.removeItem(STORAGE_KEY);
      return;
    }
    const { participant, checkIns, stages, preview } = state;
    store.setItem(STORAGE_KEY, JSON.stringify({ v: 1, savedAt: new Date().toISOString(), participant, checkIns, stages, preview }));
  } catch {
    /* storage full or blocked: carry on without saving */
  }
}

/** Saves shortly after each change (a burst of changes is written once). Nothing is saved before someone joins. */
export function saveNyState(state: NyState): void {
  pending = state;
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(flushNyState, 150);
}

/** Writes a save that is still waiting, straight away: called when the page is being left. */
export function flushNyState(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  if (pending) write(pending);
  pending = null;
}

/** "Delete everything on this device". */
export function clearNyState(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  pending = null;
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Whether this browser lets the page keep anything at all (for a warning when it doesn't). */
export function canStore(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const probe = `${STORAGE_KEY}:probe`;
    store.setItem(probe, '1');
    store.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
