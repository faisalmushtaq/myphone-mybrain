import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { addDays, localIsoDate, type IsoDate } from './dates';
import type { NyState } from './model';
import { deviceInfo } from './device';
import { flushNyState, loadNyState, onOtherTabSave, saveNyState } from './persistence';
import { initialNyState, nyReducer, type NyAction } from './reducer';
import { hashToRoute } from './routes';

interface NyStore {
  state: NyState;
  dispatch: Dispatch<NyAction>;
  /** Today's local date, moved on by the preview tools' day offset. */
  today: IsoDate;
}

const NyContext = createContext<NyStore | null>(null);

/** Saved progress if there is any, opening on the screen named in the address (#/leaderboard…), or else the tracker or the landing page. */
function startingState(): NyState {
  const saved = loadNyState();
  const linked = hashToRoute(window.location.hash);
  const base = saved ? { ...initialNyState(), ...saved } : initialNyState();
  return { ...base, route: linked ?? { view: saved ? 'tracker' : 'about' } };
}

/** The device's date, checked every minute and whenever the page comes back into view, so a page left open overnight moves on to the new day. */
function useDeviceDate(): IsoDate {
  const [date, setDate] = useState(() => localIsoDate());
  useEffect(() => {
    const check = () => setDate(localIsoDate());
    const timer = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);
  return date;
}

export function NyStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(nyReducer, undefined, startingState);
  const deviceDate = useDeviceDate();
  const today = addDays(deviceDate, state.preview.dayOffset);

  // Data just taken from another tab is already saved: writing it back would start the two tabs saving at each other.
  const fromOtherTab = useRef(false);
  useEffect(() => {
    if (fromOtherTab.current) {
      fromOtherTab.current = false;
      return;
    }
    saveNyState(state);
  }, [state]);

  // Another tab saved: take its answers, so this tab never writes over them.
  useEffect(
    () =>
      onOtherTabSave((saved) => {
        fromOtherTab.current = true;
        dispatch({ type: 'synced', saved });
      }),
    [],
  );

  // Each opening of the study is recorded with the device (once someone has joined).
  const joined = Boolean(state.participant);
  useEffect(() => {
    if (joined) dispatch({ type: 'session', session: { at: new Date().toISOString(), device: deviceInfo() } });
  }, [joined]);

  // A check-in saved just before the tab is closed is written at once rather than lost.
  useEffect(() => {
    const leaving = () => flushNyState();
    const hidden = () => document.visibilityState === 'hidden' && flushNyState();
    window.addEventListener('pagehide', leaving);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', leaving);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);

  const value = useMemo(() => ({ state, dispatch, today }), [state, today]);
  return <NyContext.Provider value={value}>{children}</NyContext.Provider>;
}

export function useNy(): NyStore {
  const store = useContext(NyContext);
  if (!store) throw new Error('useNy must be used inside NyStoreProvider');
  return store;
}
