import type { IsoDate } from './dates';
import type { CheckIn, Flash, NyState, Participant, Route, SessionRecord, Visit } from './model';

export type VisitPatch = Partial<Pick<Visit, 'scales' | 'digitSpan' | 'oddball' | 'skippedBrainCheck' | 'screenshot' | 'reflection'>>;
export type SettingsPatch = Partial<Pick<Participant, 'reminders' | 'onLeaderboard' | 'savedAsApp'>>;

export type NyAction =
  | { type: 'go'; route: Route }
  | { type: 'join'; participant: Participant }
  | { type: 'check-in'; checkIn: CheckIn }
  | { type: 'visit-begin'; visit: Visit }
  | { type: 'visit-update'; id: string; patch: VisitPatch }
  | { type: 'visit-complete'; id: string; today: IsoDate; at: string }
  | { type: 'visit-discard'; id: string }
  | { type: 'settings'; patch: SettingsPatch }
  | { type: 'session'; session: SessionRecord }
  | { type: 'preview-shift'; days: number }
  | { type: 'preview-reset' }
  | { type: 'preview-fill'; checkIns: CheckIn[] }
  | { type: 'flash'; flash: Flash | null }
  | { type: 'synced'; saved: Pick<NyState, 'participant' | 'checkIns' | 'visits' | 'sessions' | 'preview'> | null }
  | { type: 'delete-all' };

export function initialNyState(): NyState {
  return { route: { view: 'about' }, participant: null, checkIns: [], visits: [], sessions: [], preview: { dayOffset: 0 }, flash: null };
}

/** Views that need someone to have joined first. */
const JOINED_VIEWS = new Set(['tracker', 'checkin', 'visits', 'visit', 'results', 'leaderboard', 'settings', 'leave']);

/** The route actually shown: before joining, only the landing page and the join page. */
export function shownRoute(state: Pick<NyState, 'route' | 'participant' | 'visits'>): Route {
  if (!state.participant && JOINED_VIEWS.has(state.route.view)) return { view: 'about' };
  if (state.participant && state.route.view === 'join') return { view: 'tracker' };
  const known = state.visits.some((v) => v.id === state.route.visitId);
  if (state.route.view === 'results' && !known) return { view: 'visits' };
  if (state.route.view === 'visit' && (state.route.visitId ? !known : !state.route.kind)) return { view: 'visits' };
  return state.route;
}

/** At most this many sign-in records are kept on the device. */
const MAX_SESSIONS = 200;

export function nyReducer(state: NyState, action: NyAction): NyState {
  switch (action.type) {
    case 'go':
      return { ...state, route: action.route, flash: null };
    case 'join':
      return { ...state, participant: action.participant, checkIns: [], visits: [], route: { view: 'tracker' }, flash: { kind: 'joined' } };
    case 'check-in': {
      if (state.checkIns.some((c) => c.id === action.checkIn.id)) return state;
      return { ...state, checkIns: [...state.checkIns, action.checkIn], route: { view: 'tracker' }, flash: { kind: 'checked-in', status: action.checkIn.status } };
    }
    case 'visit-begin': {
      if (state.visits.some((v) => v.id === action.visit.id)) return state;
      return { ...state, visits: [...state.visits, action.visit], route: { view: 'visit', visitId: action.visit.id }, flash: null };
    }
    case 'visit-update':
      return { ...state, visits: state.visits.map((v) => (v.id === action.id && !v.completedAt ? { ...v, ...action.patch } : v)) };
    case 'visit-complete': {
      const visit = state.visits.find((v) => v.id === action.id);
      if (!visit || visit.completedAt) return state;
      const visits = state.visits.map((v) => (v.id === action.id ? { ...v, completedOn: action.today, completedAt: action.at } : v));
      // The end visit ends the break.
      const participant = visit.kind === 'end' && state.participant ? { ...state.participant, endedOn: action.today } : state.participant;
      return { ...state, visits, participant, route: { view: 'results', visitId: action.id }, flash: { kind: 'visit-done', visitId: action.id } };
    }
    case 'visit-discard':
      return { ...state, visits: state.visits.filter((v) => v.id !== action.id || v.completedAt), route: { view: 'tracker' } };
    case 'settings':
      return state.participant ? { ...state, participant: { ...state.participant, ...action.patch }, flash: { kind: 'settings-saved' } } : state;
    case 'session':
      return { ...state, sessions: [...state.sessions, action.session].slice(-MAX_SESSIONS) };
    // The preview tools: a message about an earlier screen no longer applies.
    case 'preview-shift':
      return { ...state, preview: { dayOffset: Math.max(0, Math.min(400, state.preview.dayOffset + action.days)) }, flash: null };
    case 'preview-reset':
      return { ...state, preview: { dayOffset: 0 }, flash: null };
    case 'preview-fill':
      return { ...state, checkIns: [...state.checkIns, ...action.checkIns], flash: null };
    case 'flash':
      return { ...state, flash: action.flash };
    // Another tab saved: take its data (the screen stays where it is).
    case 'synced':
      if (!action.saved) return { ...initialNyState(), route: { view: 'about' } };
      return { ...state, ...action.saved };
    case 'delete-all':
      return { ...initialNyState(), flash: { kind: 'deleted' } };
    default:
      return state;
  }
}
