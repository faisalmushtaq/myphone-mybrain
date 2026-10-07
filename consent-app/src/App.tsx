import { useEffect, useRef, type ComponentType } from 'react';
import { HandoverScreen } from './components/HandoverScreen';
import { ProgressNav } from './components/ProgressNav';
import { PrototypePanel } from './components/PrototypePanel';
import { buildJourney } from './model/journey';
import { firstIncomplete } from './state/useSync';
import type { StepId } from './model/types';
import { StoreProvider, useStore } from './state/context';
import { useSync } from './state/useSync';
import { AssentDeclined } from './steps/AssentDeclined';
import { ChildAssent } from './steps/ChildAssent';
import { ChildDetails } from './steps/ChildDetails';
import { Done } from './steps/Done';
import { ParentConsent } from './steps/ParentConsent';
import { ParentDetails } from './steps/ParentDetails';
import { OptOut } from './steps/OptOut';
import { ParentMore, ParentQuestions } from './steps/ParentQuestions';
import { PhoneSource } from './steps/PhoneSource';
import { PhoneUse } from './steps/PhoneUse';
import { Resume } from './steps/Resume';
import { Check } from './steps/Check';
import { Welcome } from './steps/Welcome';

const steps: Record<StepId, ComponentType> = {
  welcome: Welcome,
  'opt-out': OptOut,
  resume: Resume,
  'child-details': ChildDetails,
  'parent-details': ParentDetails,
  'parent-consent': ParentConsent,
  'parent-questions': ParentQuestions,
  'phone-source': PhoneSource,
  'child-assent': ChildAssent,
  'assent-declined': AssentDeclined,
  'phone-use': PhoneUse,
  'parent-more': ParentMore,
  check: Check,
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

/**
 * Sends the record as soon as everything it needs is in and the family
 * reaches the screenshots, the longer questions or the check page (and sends
 * changes made later), so a family that stops part-way still counts.
 * Failures are left for the person to retry from the status line; nothing
 * loops.
 */
function SyncManager() {
  const { state } = useStore();
  const { sendConsent, dirty } = useSync();
  const { stepId } = state;
  const { consentStage } = state.submission;
  const ready = state.resume
    ? // Carrying on later: a yes goes on the way to the screenshots; a no goes when they press Finish (src/steps/AssentDeclined.tsx), so it can still be changed until then.
      state.resume.canAgree && stepId === 'phone-use' && firstIncomplete(state) === null
    : (stepId === 'phone-use' || stepId === 'parent-more' || stepId === 'check') && firstIncomplete(state) === null;
  // Changes after the first send go as one amendment from the check page, not one per answer.
  const due = ready && (consentStage === 'idle' || (consentStage === 'sent' && dirty && stepId === 'check'));
  useEffect(() => {
    if (!due) return;
    const timer = window.setTimeout(() => void sendConsent(), 400);
    return () => window.clearTimeout(timer);
  }, [due, sendConsent]);
  return null;
}

function Shell() {
  const { state } = useStore();
  useHistorySync();
  const Step = steps[state.stepId];
  const showProgress = state.stepId !== 'welcome' && state.stepId !== 'done' && state.stepId !== 'opt-out' && state.stepId !== 'resume' && !state.resume;
  const showHandover = state.handover !== null;

  return (
    <div className="mpmb-frame">
      <div className={`mpmb-band${showProgress ? '' : ' mpmb-band--slim'}`}>
        <div className="mpmb-band__inner">
          <p className="mpmb-band__kicker">
            <span>MyPhone/MyBrain</span> Phone use and screen time
          </p>
          {showProgress && <ProgressNav />}
        </div>
      </div>
      <main className="mpmb-main" id="mpmb-main">
        {showHandover ? <HandoverScreen /> : <Step />}
      </main>
      <SyncManager />
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
