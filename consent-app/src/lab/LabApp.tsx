import { useEffect, type ComponentType } from 'react';
import { labJourney } from './reducer';
import { labStepTitles, type LabStepId } from './model';
import { LabStoreProvider, useLab } from './store';
import { LabClean } from './steps/LabClean';
import { LabConsent } from './steps/LabConsent';
import { LabDone } from './steps/LabDone';
import { LabGuide } from './steps/LabGuide';
import { LabInformation } from './steps/LabInformation';
import { LabScreenshots } from './steps/LabScreenshots';
import { LabSend } from './steps/LabSend';
import { LabWelcome } from './steps/LabWelcome';
import { ParticipantId } from './steps/ParticipantId';

const steps: Record<LabStepId, ComponentType> = {
  welcome: LabWelcome,
  'participant-id': ParticipantId,
  information: LabInformation,
  consent: LabConsent,
  guide: LabGuide,
  screenshots: LabScreenshots,
  clean: LabClean,
  send: LabSend,
  done: LabDone,
};

function Frame() {
  const { state, dispatch } = useLab();
  const Step = steps[state.stepId];
  const journey = labJourney(state);
  const index = journey.indexOf(state.stepId);

  // A link straight to the guide (shared before the lab visit) opens on it, whatever was saved; the guide routes onwards by itself.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('step');
    if (wanted === 'guide') dispatch({ type: 'go-to', stepId: 'guide' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showBar = state.stepId !== 'welcome';
  return (
    <div className="mpmb-frame mpmb-lab">
      <div className={`mpmb-band${showBar ? '' : ' mpmb-band--slim'}`}>
        <div className="mpmb-band__inner">
          <div className="mpmb-band__row">
            <p className="mpmb-band__kicker">
              <span>MyPhone/MyBrain</span> Social media break study
            </p>
            <a className="mpmb-band__back" href="/break/">
              ← About the study
            </a>
          </div>
          {showBar && (
            <div className="mpmb-lab-bar" aria-label="Progress">
              <span>{index >= 0 ? `Step ${index + 1} of ${journey.length} · ` : ''}{labStepTitles[state.stepId]}</span>
              {state.codeConfirmed && (
                <span>
                  Code <strong className="mpmb-mono">{state.code}</strong>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <main className="mpmb-main" id="mpmb-main">
        <Step />
      </main>
      {/* One permanent live region for announcements (see lib/announce.ts). */}
      <div id="mpmb-live" className="mpmb-sr-only" aria-live="polite" aria-atomic="true" />
    </div>
  );
}

export function LabApp() {
  return (
    <LabStoreProvider>
      <Frame />
    </LabStoreProvider>
  );
}
