import type { IsoDate } from './dates';
import type { CheckIn, DigitSpanResult, Flash, NyState, OddballResult, Participant, Route, StageRecord } from './model';
import type { StageId } from './schedule';

export type NyAction =
  | { type: 'go'; route: Route }
  | { type: 'join'; participant: Participant }
  | { type: 'check-in'; checkIn: CheckIn }
  | { type: 'memory-done'; stage: StageId; result: DigitSpanResult }
  | { type: 'attention-done'; stage: StageId; result: OddballResult; today: IsoDate }
  | { type: 'preview-shift'; days: number }
  | { type: 'preview-reset' }
  | { type: 'preview-fill'; checkIns: CheckIn[] }
  | { type: 'flash'; flash: Flash | null }
  | { type: 'delete-all' };

export function initialNyState(): NyState {
  return { route: { view: 'about' }, participant: null, checkIns: {}, stages: {}, preview: { dayOffset: 0 }, flash: null };
}

const emptyStage = (): StageRecord => ({ digitSpan: null, oddball: null, completedOn: null, completedAt: null });

/** Views that need someone to have joined first. */
const JOINED_VIEWS = new Set(['tracker', 'checkin', 'checks', 'brain', 'results', 'leaderboard', 'leave']);

/** The route actually shown: before joining, only the landing page and the join page. */
export function shownRoute(state: Pick<NyState, 'route' | 'participant'>): Route {
  if (!state.participant && JOINED_VIEWS.has(state.route.view)) return { view: 'about' };
  if (state.participant && state.route.view === 'join') return { view: 'tracker' };
  if ((state.route.view === 'brain' || state.route.view === 'results') && !state.route.stage) return { view: 'checks' };
  return state.route;
}

export function nyReducer(state: NyState, action: NyAction): NyState {
  switch (action.type) {
    case 'go':
      return { ...state, route: action.route, flash: null };
    case 'join':
      return { ...state, participant: action.participant, checkIns: {}, stages: {}, route: { view: 'tracker' }, flash: { kind: 'joined' } };
    case 'check-in': {
      // Once per day of the break: an answer already given stands.
      if (state.checkIns[action.checkIn.day]) return { ...state, route: { view: 'tracker' } };
      return { ...state, checkIns: { ...state.checkIns, [action.checkIn.day]: action.checkIn }, route: { view: 'tracker' }, flash: { kind: 'checked-in', day: action.checkIn.day } };
    }
    case 'memory-done': {
      const record = state.stages[action.stage] ?? emptyStage();
      if (record.completedAt) return state;
      return { ...state, stages: { ...state.stages, [action.stage]: { ...record, digitSpan: action.result } } };
    }
    case 'attention-done': {
      const record = state.stages[action.stage] ?? emptyStage();
      if (record.completedAt || !record.digitSpan) return state;
      const done: StageRecord = { ...record, oddball: action.result, completedOn: action.today, completedAt: action.result.finishedAt };
      return { ...state, stages: { ...state.stages, [action.stage]: done }, route: { view: 'results', stage: action.stage } };
    }
    // The preview tools: a message about an earlier screen no longer applies.
    case 'preview-shift':
      return { ...state, preview: { dayOffset: Math.max(0, Math.min(400, state.preview.dayOffset + action.days)) }, flash: null };
    case 'preview-reset':
      return { ...state, preview: { dayOffset: 0 }, flash: null };
    case 'preview-fill': {
      const checkIns = { ...state.checkIns };
      for (const c of action.checkIns) if (!checkIns[c.day]) checkIns[c.day] = c;
      return { ...state, checkIns, flash: null };
    }
    case 'flash':
      return { ...state, flash: action.flash };
    case 'delete-all':
      return { ...initialNyState(), flash: { kind: 'deleted' } };
    default:
      return state;
  }
}
