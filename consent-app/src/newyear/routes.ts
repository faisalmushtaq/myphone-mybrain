import type { Route, View } from './model';
import { STAGE_IDS, type StageId } from './schedule';

/**
 * Each screen has its own address after the page's (#/tracker,
 * #/brain-check/halfway…), so the browser's back button moves between
 * screens and a reload stays put. The leading slash keeps these from ever
 * matching an element id on the page.
 */
const HASH: Record<View, string> = {
  about: 'about',
  join: 'join',
  tracker: 'tracker',
  checkin: 'check-in',
  checks: 'brain-checks',
  brain: 'brain-check',
  results: 'results',
  leaderboard: 'leaderboard',
  leave: 'leave',
};

const VIEW_BY_HASH = Object.fromEntries(Object.entries(HASH).map(([view, hash]) => [hash, view as View])) as Record<string, View>;

export function routeToHash(route: Route): string {
  return `#/${HASH[route.view]}${route.stage && (route.view === 'brain' || route.view === 'results') ? `/${route.stage}` : ''}`;
}

export function hashToRoute(hash: string): Route | null {
  const m = /^#\/([a-z-]+)(?:\/([a-z]+))?$/.exec(hash);
  if (!m) return null;
  const view = VIEW_BY_HASH[m[1]];
  if (!view) return null;
  const stage = m[2] && (STAGE_IDS as readonly string[]).includes(m[2]) ? (m[2] as StageId) : undefined;
  if (view === 'brain' || view === 'results') return stage ? { view, stage } : { view: 'checks' };
  return { view };
}
