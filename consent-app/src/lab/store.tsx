import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from 'react';
import { getApi } from '../api';
import type { LabFlow, LabState } from './model';
import { loadLabState, saveLabState, startingLabState } from './persistence';
import { labReducer, type LabAction } from './reducer';

interface LabStore {
  state: LabState;
  dispatch: Dispatch<LabAction>;
}

const LabContext = createContext<LabStore | null>(null);

export function LabStoreProvider({ flow, children }: { flow: LabFlow; children: ReactNode }) {
  const [state, dispatch] = useReducer(labReducer, flow, (f: LabFlow) => loadLabState(f) ?? startingLabState(f));

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

  // Coming back to a page: ask the server what has arrived since, perhaps from another device, so the next step is the right one.
  const refresh = state.restored && state.codeConfirmed && state.submission.consentStage === 'sent' && state.session ? state.session : null;
  useEffect(() => {
    if (!refresh) return;
    let cancelled = false;
    getApi()
      .lookupLabParticipant(refresh, state.code)
      .then((progress) => {
        if (!cancelled && progress.exists) dispatch({ type: 'progress', progress });
      })
      .catch(() => {
        /* the saved progress stands */
      });
    return () => {
      cancelled = true;
    };
    // Once per visit, when the session is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh?.sessionId]);

  return <LabContext.Provider value={{ state, dispatch }}>{children}</LabContext.Provider>;
}

export function useLab(): LabStore {
  const store = useContext(LabContext);
  if (!store) throw new Error('useLab must be used inside LabStoreProvider');
  return store;
}
