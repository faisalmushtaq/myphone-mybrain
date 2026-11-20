import { APP_IDS, LIMITS, OLD_STORAGE_KEY, STORAGE_KEY, type AppId } from './config';
import { isIsoDate } from './dates';
import type { CheckIn, NyState, Participant, SessionRecord, Visit } from './model';
import { isFunName } from './names';

/**
 * The preview keeps everything in this browser's localStorage, under one key.
 * Nothing is sent anywhere. Storage can be full, blocked (private browsing,
 * some embedded browsers) or cleared at any time, so every read and write is
 * wrapped and the page carries on without it.
 *
 * What is read back is checked: anything malformed (an old version, a
 * hand-edited value) is dropped rather than trusted.
 *
 * Two tabs: each save carries a revision number, and a tab that sees another
 * tab's newer save (the `storage` event) takes it before doing anything else,
 * so an out-of-date tab never writes over newer answers.
 */
export type Saved = Pick<NyState, 'participant' | 'checkIns' | 'visits' | 'sessions' | 'preview'>;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

function readParticipant(v: unknown): Participant | null {
  if (!isObj(v)) return null;
  const apps = Array.isArray(v.apps) ? v.apps.filter((a): a is AppId => typeof a === 'string' && (APP_IDS as readonly string[]).includes(a)) : [];
  const mode = v.mode === 'total' ? 'total' : v.mode === 'apps' ? 'apps' : null;
  if (!isFunName(v.name) || !mode || (mode === 'apps' && !apps.length) || !isIsoDate(v.startDate) || !isIsoDate(v.joinedOn)) return null;
  if (!isObj(v.demographics) || !isObj(v.reminders) || !isObj(v.consent)) return null;
  const d = v.demographics;
  const r = v.reminders;
  const frequency = r.frequency === 'daily' || r.frequency === 'every-3-days' || r.frequency === 'weekly' || r.frequency === 'never' ? r.frequency : 'weekly';
  return {
    name: v.name,
    onLeaderboard: v.onLeaderboard !== false,
    mode,
    apps: [...new Set(apps)],
    otherApp: str(v.otherApp, LIMITS.otherApp),
    goalMinutes: mode === 'total' && isInt(v.goalMinutes, LIMITS.goalMinMinutes, LIMITS.goalMaxMinutes) ? v.goalMinutes : null,
    startDate: v.startDate,
    joinedOn: v.joinedOn,
    joinedAt: str(v.joinedAt, 40),
    demographics: {
      birthMonth: str(d.birthMonth, 7),
      sex: str(d.sex, 30),
      gender: str(d.gender, 30),
      genderText: str(d.genderText, LIMITS.text),
      ethnicity: str(d.ethnicity, 40),
      ethnicityText: str(d.ethnicityText, LIMITS.text),
      countryOfBirth: str(d.countryOfBirth, 12),
      countryOfResidence: str(d.countryOfResidence, 12),
      education: str(d.education, 12),
      firstLanguage: str(d.firstLanguage, LIMITS.text),
      otherLanguages: str(d.otherLanguages, LIMITS.text * 2),
      work: str(d.work, 20),
      job: str(d.job, LIMITS.text),
    },
    reminders: { email: r.email === true, sms: r.sms === true, phone: str(r.phone, 30), frequency },
    consent: { version: str(v.consent.version, 20), statements: isObj(v.consent.statements) ? (Object.fromEntries(Object.entries(v.consent.statements).filter(([, b]) => typeof b === 'boolean')) as Record<string, boolean>) : {}, at: str(v.consent.at, 40) },
    savedAsApp: v.savedAsApp === true,
    endedOn: isIsoDate(v.endedOn) ? v.endedOn : null,
  };
}

function readCheckIn(v: unknown): CheckIn | null {
  if (!isObj(v) || typeof v.id !== 'string' || !isIsoDate(v.date) || typeof v.at !== 'string') return null;
  if (v.status !== 'on-track' && v.status !== 'little' && v.status !== 'lot' && v.status !== 'stopped') return null;
  if (!isInt(v.mood, 1, 5) || !isInt(v.urge, 1, 5)) return null;
  const slip = v.status === 'little' || v.status === 'lot';
  return {
    id: v.id,
    date: v.date,
    at: v.at,
    status: v.status,
    slipDate: slip && isIsoDate(v.slipDate) ? v.slipDate : null,
    minutes: slip && isInt(v.minutes, 0, LIMITS.minutes) ? v.minutes : null,
    mood: v.mood,
    urge: v.urge,
    note: str(v.note, LIMITS.note),
  };
}

function readVisit(v: unknown): Visit | null {
  if (!isObj(v) || typeof v.id !== 'string' || !isIsoDate(v.startedOn) || !isObj(v.device)) return null;
  if (!['start', 'return', 'end', 'followup1', 'followup3'].includes(String(v.kind))) return null;
  // The task results and screenshot are kept as they were saved; their shape is checked where they are made.
  return v as unknown as Visit;
}

/** Saved progress, checked; null if there is none worth keeping. */
export function readSaved(raw: unknown): Saved | null {
  if (!isObj(raw) || raw.v !== 2) return null;
  const participant = readParticipant(raw.participant);
  if (!participant) return null;
  const checkIns = Array.isArray(raw.checkIns) ? raw.checkIns.map(readCheckIn).filter((c): c is CheckIn => Boolean(c)) : [];
  const visits = Array.isArray(raw.visits) ? raw.visits.map(readVisit).filter((x): x is Visit => Boolean(x)) : [];
  const sessions = Array.isArray(raw.sessions) ? (raw.sessions.filter((s) => isObj(s) && typeof s.at === 'string' && isObj(s.device)) as unknown as SessionRecord[]) : [];
  const offset = isObj(raw.preview) && isInt(raw.preview.dayOffset, 0, 400) ? raw.preview.dayOffset : 0;
  return { participant, checkIns, visits, sessions, preview: { dayOffset: offset } };
}

/** The revision of the last save this tab wrote or read. */
let revision = 0;

function readRaw(): { saved: Saved | null; rev: number } {
  const store = storage();
  if (!store) return { saved: null, rev: 0 };
  try {
    // The prototype's data does not fit the open-ended design: it is dropped.
    store.removeItem(OLD_STORAGE_KEY);
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return { saved: null, rev: 0 };
    const parsed = JSON.parse(raw) as { rev?: unknown };
    return { saved: readSaved(parsed), rev: typeof parsed.rev === 'number' ? parsed.rev : 0 };
  } catch {
    return { saved: null, rev: 0 };
  }
}

export function loadNyState(): Saved | null {
  const { saved, rev } = readRaw();
  revision = rev;
  return saved;
}

let timer: number | null = null;
let pending: NyState | null = null;

function write(state: NyState): void {
  const store = storage();
  if (!store) return;
  try {
    // Nothing to save before joining. Deleting is done only by clearNyState ("Delete everything"), never here,
    // so a tab still on the landing page can't remove what another tab has saved.
    if (!state.participant) return;
    // Another tab saved since this one last read: its data wins; this tab is brought up to date by the storage event.
    const now = readRaw().rev;
    if (now > revision) return;
    revision += 1;
    const { participant, checkIns, visits, sessions, preview } = state;
    store.setItem(STORAGE_KEY, JSON.stringify({ v: 2, rev: revision, savedAt: new Date().toISOString(), participant, checkIns, visits, sessions, preview }));
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

/** Calls back with another tab's save, as soon as it happens. */
export function onOtherTabSave(f: (saved: Saved | null) => void): () => void {
  const listener = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY && e.key !== null) return;
    // A save of this tab's that was still waiting is out of date now.
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    pending = null;
    const { saved, rev } = readRaw();
    revision = rev;
    f(saved);
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}

/** "Delete everything on this device". */
export function clearNyState(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  pending = null;
  revision = 0;
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
