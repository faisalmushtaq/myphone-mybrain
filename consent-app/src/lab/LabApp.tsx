import { useEffect, type ComponentType } from 'react';
import type { LabPhase } from '../api/types';
import { labPages, PARTICIPANT_CODE, normaliseParticipantCode } from './config';
import { labStepTitles, type LabFlow, type LabStepId } from './model';
import { labJourney } from './reducer';
import { LabStoreProvider, useLab } from './store';
import { LabBook } from './steps/LabBook';
import { LabCheckIn } from './steps/LabCheckIn';
import { LabClean } from './steps/LabClean';
import { LabConsent } from './steps/LabConsent';
import { LabDone } from './steps/LabDone';
import { LabGuide } from './steps/LabGuide';
import { LabInformation } from './steps/LabInformation';
import { LabReminder } from './steps/LabReminder';
import { LabScreenshots } from './steps/LabScreenshots';
import { LabSend } from './steps/LabSend';
import { LabStory } from './steps/LabStory';
import { LabWelcome } from './steps/LabWelcome';
import { ParticipantId } from './steps/ParticipantId';

const steps: Record<LabStepId, ComponentType> = {
  welcome: LabWelcome,
  'participant-id': ParticipantId,
  information: LabInformation,
  consent: LabConsent,
  reminder: LabReminder,
  checkin: LabCheckIn,
  guide: LabGuide,
  screenshots: LabScreenshots,
  clean: LabClean,
  send: LabSend,
  done: LabDone,
  book: LabBook,
  mystory: LabStory,
};

function Frame() {
  const { state, dispatch } = useLab();
  const Step = steps[state.stepId];
  const journey = labJourney(state);
  const index = journey.indexOf(state.stepId);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // A link from a progress email carries the participant ID, so any device can carry on with one press.
    const code = normaliseParticipantCode(params.get('code') ?? '');
    if (PARTICIPANT_CODE.test(code)) {
      dispatch({ type: 'use-code', code });
      params.delete('code');
      const rest = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
      return;
    }
    // A link straight to the guide (shared before the lab visit) opens on it, whatever was saved; the guide routes onwards by itself.
    if (params.get('step') === 'guide' && state.flow !== 'checkin') dispatch({ type: 'go-to', stepId: 'guide' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showBar = state.stepId !== 'welcome';
  return (
    <div className="mpmb-frame mpmb-lab">
      <div className={`mpmb-band${showBar ? '' : ' mpmb-band--slim'}`}>
        <div className="mpmb-band__inner">
          <div className="mpmb-band__row">
            <p className="mpmb-band__kicker">
              <span>MyPhone/MyBrain</span> Social media break study{state.flow !== 'baseline' ? ` · ${labPages[state.flow].label}` : ''}
            </p>
            <a className="mpmb-band__back" href="/break/">
              ← About the study
            </a>
          </div>
          {showBar && (
            <div className="mpmb-lab-bar" aria-label="Progress">
              <span>
                {index >= 0 ? `Step ${index + 1} of ${journey.length} · ` : ''}
                {labStepTitles[state.stepId]}
              </span>
              {state.codeConfirmed && (
                <span>
                  ID <strong className="mpmb-mono">{state.code}</strong>
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

export function LabApp({ flow = 'baseline', phase }: { flow?: LabFlow; phase?: LabPhase }) {
  return (
    <LabStoreProvider flow={flow} phase={phase}>
      <Frame />
    </LabStoreProvider>
  );
}
