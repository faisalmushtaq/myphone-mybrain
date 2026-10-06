import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from 'react';
import { getApi } from '../api';
import type { LabState } from './model';
import { loadLabState, saveLabState } from './persistence';
import { initialLabState, labReducer, type LabAction } from './reducer';

interface LabStore {
  state: LabState;
  dispatch: Dispatch<LabAction>;
}

const LabContext = createContext<LabStore | null>(null);

export function LabStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(labReducer, undefined, () => loadLabState() ?? initialLabState());

  useEffect(() => saveLabState(state), [state]);

  useEffect(() => {
    if (state.session) return;
    let cancelled = false;
    getApi()
      .startSession()
      .then((session) => {
        if (!cancelled) dispatch({ type: 'session', session });
      })
      .catch(() => {
        /* retried when first needed */
      });
    return () => {
      cancelled = true;
    };
  }, [state.session]);

  return <LabContext.Provider value={{ state, dispatch }}>{children}</LabContext.Provider>;
}

export function useLab(): LabStore {
  const store = useContext(LabContext);
  if (!store) throw new Error('useLab must be used inside LabStoreProvider');
  return store;
}
