import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import { getApi, mockFlags } from '../api';
import { study } from '../config/study';
import { imageStore } from '../lib/imageStore';
import type { AppState } from '../model/types';
import { clearState, loadState, saveState } from './persistence';
import { initialState, reducer, type Action } from './reducer';

interface Store {
  state: AppState;
  dispatch: Dispatch<Action>;
}

const StoreContext = createContext<Store | null>(null);

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => loadState()?.state ?? initialState());

  // Persist progress (debounced) on every change.
  useEffect(() => saveState(state), [state]);

  // Keep the mock API's failure switches in step with the prototype controls.
  useEffect(() => {
    mockFlags.failUploads = state.prototype.failUploads;
    mockFlags.failSubmit = state.prototype.failSubmit;
  }, [state.prototype.failUploads, state.prototype.failSubmit]);

  // Start a server session once (in production this sets the session cookie and returns the CSRF token).
  useEffect(() => {
    if (state.session) return;
    let cancelled = false;
    getApi()
      .startSession()
      .then((session) => {
        if (!cancelled) dispatch({ type: 'session', session });
      })
      .catch(() => {
        /* The session is retried when it is first needed (upload or submit). */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear everything after a period without interaction, in case the device is shared or left unattended.
  useEffect(() => {
    if (state.stepId === 'welcome' && !state.route) return;
    const minutes = state.stepId === 'done' ? Math.min(10, study.inactivityMinutes) : study.inactivityMinutes;
    let timer = window.setTimeout(clear, minutes * 60 * 1000);
    function clear() {
      clearState();
      imageStore.clear();
      dispatch({ type: 'reset', reason: 'inactivity' });
    }
    function bump() {
      window.clearTimeout(timer);
      timer = window.setTimeout(clear, minutes * 60 * 1000);
    }
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, bump, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, bump);
    };
  }, [state.stepId, state.route]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside StoreProvider');
  return store;
}
