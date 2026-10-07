import { useEffect, useRef } from 'react';
import { Icon } from '../components/ui/Icon';
import type { Route, View } from './model';
import { shownRoute } from './reducer';
import { hashToRoute, routeToHash } from './routes';
import { NyStoreProvider, useNy } from './store';
import { About } from './views/About';
import { BrainCheck } from './views/BrainCheck';
import { CheckIn } from './views/CheckIn';
import { Checks } from './views/Checks';
import { Join } from './views/Join';
import { Leaderboard } from './views/Leaderboard';
import { Leave } from './views/Leave';
import { Results } from './views/Results';
import { Tracker } from './views/Tracker';

const NAV: { view: View; label: string }[] = [
  { view: 'tracker', label: 'My tracker' },
  { view: 'checks', label: 'Brain checks' },
  { view: 'leaderboard', label: 'Leaderboard' },
];

/** Which nav item a screen belongs under. */
const SECTION: Partial<Record<View, View>> = { tracker: 'tracker', checkin: 'tracker', leave: 'tracker', checks: 'checks', brain: 'checks', results: 'checks', leaderboard: 'leaderboard' };

/** Keeps the address in step with the screen, so the back button and reloads work. */
function useHistorySync(shown: Route) {
  const { dispatch, state } = useNy();
  const fromBrowser = useRef(false);
  const first = useRef(true);

  useEffect(() => {
    const onPop = () => {
      fromBrowser.current = true;
      dispatch({ type: 'go', route: hashToRoute(window.location.hash) ?? { view: state.participant ? 'tracker' : 'about' } });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [dispatch, state.participant]);

  const hash = routeToHash(shown);
  useEffect(() => {
    const current = window.location.hash;
    if (fromBrowser.current) {
      fromBrowser.current = false;
      // The browser moved to an address this page corrects (for example a screen that needs joining first).
      if (current && current !== hash) window.history.replaceState(null, '', hash);
      return;
    }
    if (first.current) {
      first.current = false;
      if (current && current !== hash) window.history.replaceState(null, '', hash);
      return;
    }
    if (current !== hash) window.history.pushState(null, '', hash);
  }, [hash]);
}

function Screen({ route }: { route: Route }) {
  switch (route.view) {
    case 'join':
      return <Join />;
    case 'tracker':
      return <Tracker />;
    case 'checkin':
      return <CheckIn />;
    case 'checks':
      return <Checks />;
    case 'brain':
      return <BrainCheck stage={route.stage ?? 'baseline'} />;
    case 'results':
      return <Results stage={route.stage ?? 'baseline'} />;
    case 'leaderboard':
      return <Leaderboard />;
    case 'leave':
      return <Leave />;
    default:
      return <About />;
  }
}

function Frame() {
  const { state, dispatch } = useNy();
  const shown = shownRoute(state);
  useHistorySync(shown);
  const participant = state.participant;
  const inGame = shown.view === 'brain';
  const section = SECTION[shown.view];

  return (
    <div className="mpmb-frame mpmb-ny">
      <div className="mpmb-band ny-band">
        <div className="mpmb-band__inner">
          <div className="mpmb-band__row">
            <p className="mpmb-band__kicker">
              <span>MyPhone/MyBrain</span> New Year social media break
            </p>
            {participant && (
              <p className="ny-band__who">
                <span className="mpmb-sr-only">Your fun name: </span>
                {participant.name}
              </p>
            )}
          </div>
          {participant && !inGame && (
            <nav className="ny-nav" aria-label="New Year break">
              <ul>
                {NAV.map((item) => (
                  <li key={item.view}>
                    <button type="button" className="ny-nav__item" aria-current={section === item.view ? 'page' : undefined} onClick={() => dispatch({ type: 'go', route: { view: item.view } })}>
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      </div>
      <div className="ny-preview" role="note" aria-label="Preview">
        <div className="ny-preview__inner">
          <Icon name="eye" size={20} />
          <p>
            <strong>Preview: not open yet.</strong> Nothing you do here is sent anywhere; it stays on this device.
          </p>
        </div>
      </div>
      {/* Not a <main>: the site's page already has one around the app. */}
      <div className="mpmb-main ny-main">
        <Screen key={`${shown.view}-${shown.stage ?? ''}`} route={shown} />
      </div>
      {/* One permanent live region for announcements (see lib/announce.ts). */}
      <div id="mpmb-live" className="mpmb-sr-only" aria-live="polite" aria-atomic="true" />
    </div>
  );
}

export function NewYearApp() {
  return (
    <NyStoreProvider>
      <Frame />
    </NyStoreProvider>
  );
}
