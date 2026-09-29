import { useEffect, useRef, type ComponentType } from 'react';
import { HandoverScreen } from './components/HandoverScreen';
import { ProgressNav } from './components/ProgressNav';
import { PrototypePanel } from './components/PrototypePanel';
import { buildJourney } from './model/journey';
import type { StepId } from './model/types';
import { StoreProvider, useStore } from './state/context';
import { AssentDeclined } from './steps/AssentDeclined';
import { ChildAssent } from './steps/ChildAssent';
import { ChildDetails } from './steps/ChildDetails';
import { Done } from './steps/Done';
import { ParentConsent } from './steps/ParentConsent';
import { ParentDetails } from './steps/ParentDetails';
import { PhoneUse } from './steps/PhoneUse';
import { Send } from './steps/Send';
import { Welcome } from './steps/Welcome';

const steps: Record<StepId, ComponentType> = {
  welcome: Welcome,
  'child-details': ChildDetails,
  'parent-details': ParentDetails,
  'parent-consent': ParentConsent,
  'child-assent': ChildAssent,
  'assent-declined': AssentDeclined,
  'phone-use': PhoneUse,
  send: Send,
  done: Done,
};

/**
 * Keeps the browser's Back button in step with the journey: each step (and
 * each handover) is a history entry, going back returns to the previous
 * step, and going forward is ignored so validation is never skipped.
 */
function useHistorySync() {
  const { state, dispatch } = useStore();
  const depth = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const key = state.handover ? `${state.stepId}>handover` : state.stepId;

  useEffect(() => {
    const current = window.history.state as { mpmb?: string; depth?: number } | null;
    if (current?.mpmb === key) {
      depth.current = current.depth ?? 0;
      return;
    }
    if (current?.mpmb === undefined) {
      window.history.replaceState({ mpmb: key, depth: 0 }, '');
      depth.current = 0;
      return;
    }
    depth.current += 1;
    window.history.pushState({ mpmb: key, depth: depth.current }, '');
  }, [key]);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const target = e.state as { mpmb?: string; depth?: number } | null;
      const s = stateRef.current;
      if (target && typeof target.depth === 'number' && target.depth < depth.current) {
        depth.current = target.depth;
        if (s.handover) {
          dispatch({ type: 'cancel-handover' });
          return;
        }
        const stepId = (target.mpmb ?? '').split('>')[0] as StepId;
        if (buildJourney(s).includes(stepId) && stepId !== s.stepId) dispatch({ type: 'go-to', stepId });
        else dispatch({ type: 'back' });
        return;
      }
      window.history.pushState({ mpmb: key, depth: depth.current }, '');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [dispatch, key]);
}

function Shell() {
  const { state } = useStore();
  useHistorySync();
  const Step = steps[state.stepId];
  const showProgress = state.stepId !== 'welcome' && state.stepId !== 'done';
  const showHandover = state.handover !== null;

  return (
    <div className="mpmb-frame">
      <div className={`mpmb-band${showProgress ? '' : ' mpmb-band--slim'}`}>
        <div className="mpmb-band__inner">
          <p className="mpmb-band__kicker">
            <span>MyPhone/MyBrain</span> Take part online
          </p>
          {showProgress && <ProgressNav />}
        </div>
      </div>
      <main className="mpmb-main" id="mpmb-main">
        {showHandover ? <HandoverScreen /> : <Step />}
      </main>
      {/* One permanent live region for upload and sending announcements (see lib/announce.ts). */}
      <div id="mpmb-live" className="mpmb-sr-only" aria-live="polite" aria-atomic="true" />
      {__PROTOTYPE__ && <PrototypePanel />}
    </div>
  );
}

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
