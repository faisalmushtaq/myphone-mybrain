import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from 'react';
import { getApi } from '../api';
import type { LabPhase } from '../api/types';
import type { LabFlow, LabState } from './model';
import { groupWords, labForms, type LabGroup } from './config';
import { groupOfState } from './reducer';
import { loadLabState, saveLabState, startingLabState } from './persistence';
import { initialLabState, labReducer, type LabAction } from './reducer';

interface LabStore {
  state: LabState;
  dispatch: Dispatch<LabAction>;
  /** On a lab computer, shared between participants: nothing is kept on the device, and the page forgets the participant when done. */
  atLab: boolean;
}

const LabContext = createContext<LabStore | null>(null);

export function LabStoreProvider({ flow, phase, group = 'break', atLab = false, children }: { flow: LabFlow; phase?: LabPhase; group?: LabGroup; atLab?: boolean; children: ReactNode }) {
  const [state, dispatch] = useReducer(labReducer, flow, (f: LabFlow) => (atLab ? initialLabState(f, phase, group) : (loadLabState(f, phase, group) ?? startingLabState(f, phase, group))));

  useEffect(() => {
    if (!atLab) saveLabState(state);
  }, [state, atLab]);

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

  return <LabContext.Provider value={{ state, dispatch, atLab }}>{children}</LabContext.Provider>;
}

export function useLab(): LabStore {
  const store = useContext(LabContext);
  if (!store) throw new Error('useLab must be used inside LabStoreProvider');
  return store;
}

/** This person's group, its words and its forms (21 October 2026): from their record once known, else the page's. */
export function useLabGroup() {
  const { state } = useLab();
  const group = groupOfState(state);
  return { group, words: groupWords[group], forms: labForms[group] };
}
