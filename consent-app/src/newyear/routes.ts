import { type VisitKind } from './config';
import type { Route, View } from './model';

/**
 * Each screen has its own address after the page's (#/tracker,
 * #/visit/3fa2…, #/new-visit/return…), so the browser's back button moves
 * between screens and a reload stays put. The leading slash keeps these from
 * ever matching an element id on the page.
 */
const HASH: Record<View, string> = {
  about: 'about',
  join: 'join',
  tracker: 'tracker',
  checkin: 'check-in',
  visits: 'visits',
  visit: 'visit',
  results: 'results',
  leaderboard: 'leaderboard',
  settings: 'settings',
  leave: 'leave',
};

const VIEW_BY_HASH = Object.fromEntries(Object.entries(HASH).map(([view, hash]) => [hash, view as View])) as Record<string, View>;
const KINDS: readonly VisitKind[] = ['start', 'return', 'end', 'followup1', 'followup3'];

export function routeToHash(route: Route): string {
  if (route.view === 'visit' && !route.visitId && route.kind) return `#/new-visit/${route.kind}`;
  if ((route.view === 'visit' || route.view === 'results') && route.visitId) return `#/${HASH[route.view]}/${route.visitId}`;
  return `#/${HASH[route.view]}`;
}

export function hashToRoute(hash: string): Route | null {
  const m = /^#\/([a-z-]+)(?:\/([a-z0-9]+))?$/.exec(hash);
  if (!m) return null;
  if (m[1] === 'new-visit') return m[2] && (KINDS as readonly string[]).includes(m[2]) ? { view: 'visit', kind: m[2] as VisitKind } : { view: 'visits' };
  const view = VIEW_BY_HASH[m[1]];
  if (!view) return null;
  if (view === 'visit' || view === 'results') return m[2] ? { view, visitId: m[2] } : { view: 'visits' };
  return { view };
}
