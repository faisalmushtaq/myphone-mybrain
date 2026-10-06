import { useState } from 'react';
import type { LabPhone } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { androidSteps, jumpTo, phones, screenTimeIphone, Steps } from '../guideSteps';
import { LabShell } from '../LabShell';
import { ShotPicker } from '../ShotPicker';
import { phaseHave } from '../reducer';
import { useLab } from '../store';
import { useLabSender } from '../useLabSender';
import type { FieldError } from '../validation';

/**
 * The first donation of each page: screenshots of the phone's screen-time
 * summary, taken and sent straight away, before the app data download that
 * takes days. The phone's own steps are shown here so nothing has to be
 * looked up elsewhere. Filed under the page's phase: before the break on the
 * first page, after it on the after-break page.
 */
export function LabScreenshots() {
  const { state, dispatch } = useLab();
  const { send, busy } = useLabSender();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [nudges, setNudges] = useState(0);
  const ready = state.codeConfirmed && state.submission.consentStage === 'sent';
  const phone = state.phone;
  const pending = state.screenshots.filter((s) => s.status !== 'sent');
  const sent = state.screenshots.filter((s) => s.status === 'sent');
  const onServer = phaseHave(state).screenshots;
  const after = state.flow === 'after';

  const choosePhone = (p: LabPhone) => {
    dispatch({ type: 'phone', phone: p });
    window.setTimeout(() => jumpTo(`shots-${p}`), 60);
  };

  const next = async () => {
    setErrors([]);
    // The study needs at least one screenshot; after two nudges the person may go on without.
    if (!state.screenshots.length && !onServer && nudges < 2) {
      setNudges(nudges + 1);
      setErrors([{ field: 'lab-files', message: nudges === 0 ? 'Add at least one screenshot of your screen-time summary before going on. The study needs it alongside your app data.' : 'The study really does need your screen-time screenshots. If you cannot add them right now, press Continue once more to go on and add them later.' }]);
      return;
    }
    if (!pending.length) {
      dispatch({ type: 'go-to', stepId: 'guide' });
      return;
    }
    const result = await send(['screenshot']);
    if (result.ok) dispatch({ type: 'go-to', stepId: 'guide' });
    else setErrors([{ field: 'lab-files', message: result.message ?? 'Please try again.' }]);
  };

  if (!ready) {
    return (
      <LabShell kicker="Your screenshots" title="First, tell us who you are." intro={<p>We need your details and your consent before any data can be sent. It takes a minute.</p>} hideContinue hideBack>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => dispatch({ type: 'go-to', stepId: 'participant-id' })}>
            Enter my details
          </Button>
        </div>
      </LabShell>
    );
  }

  return (
    <LabShell
      kicker="Your screenshots"
      title={after ? 'Send your screen-time screenshots from after your break.' : 'Send your screen-time screenshots.'}
      intro={
        <p>
          {after ? 'Take them on the last day of your break, before you unlock your apps, the same way as last time. ' : ''}This part takes a few minutes and goes to the team straight away. Take screenshots of your phone’s Screen Time (iPhone) or Digital Wellbeing (Android) summary, add them here and send them. Several are better than one: the weekly chart, the daily view and the full list of apps with their times.
        </p>
      }
      errors={errors}
      onContinue={() => void next()}
      continueLabel={pending.length ? `Send ${pending.length === 1 ? 'my screenshot' : `my ${pending.length} screenshots`}` : sent.length || onServer ? 'Next: my app data' : 'Continue'}
      continueLoading={busy}
      width="wide"
    >
      <section aria-labelledby="shots-how-heading">
        <h2 className="mpmb-h2" id="shots-how-heading" tabIndex={-1}>
          1. Take the screenshots
        </h2>
        <p>Take several, not just the first screen: scroll down so the chart, the totals and the full app list (including anything under “Show more”) are all captured.</p>
        <fieldset className="mpmb-field">
          <legend className="mpmb-label">Which phone do you have?</legend>
          <div className="mpmb-chips" role="presentation">
            {phones.map((p) => (
              <label key={p.id} className={`mpmb-chip${phone === p.id ? ' is-selected' : ''}`} htmlFor={`lab-phone-${p.id}`}>
                <input id={`lab-phone-${p.id}`} type="radio" name="lab-phone" value={p.id} className="mpmb-choice__input" checked={phone === p.id} onChange={() => choosePhone(p.id)} />
                <span className="mpmb-choice__dot" aria-hidden="true" />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
        {phone === 'iphone' && (
          <div id="shots-iphone" className="mpmb-guide-phone" tabIndex={-1}>
            <h3 className="mpmb-h3">On iPhone</h3>
            <p className="mpmb-hint">To take a screenshot, press the Side button and Volume Up together.</p>
            <Steps steps={screenTimeIphone} />
          </div>
        )}
        {phone === 'android' && (
          <div id="shots-android" className="mpmb-guide-phone" tabIndex={-1}>
            <h3 className="mpmb-h3">On Android</h3>
            <p className="mpmb-hint">To take a screenshot, press Power and Volume Down together.</p>
            <Steps steps={androidSteps} />
          </div>
        )}
      </section>

      <section aria-labelledby="shots-heading" id="lab-files" tabIndex={-1}>
        <h2 className="mpmb-h2" id="shots-heading" tabIndex={-1}>
          2. Add them here
        </h2>
        <p className="mpmb-hint">Your screenshots show the apps on your phone and how long you used each one, and they are sent as they are. If you would rather not show an app, crop it out first (in Photos or Gallery, tap Edit). Camera and location details are removed before anything leaves this device.</p>
        <ShotPicker busy={busy} onAdded={() => setErrors([])} />
      </section>

      <p className="mpmb-hint">{pending.length ? 'Pressing Send uploads these screenshots to the study’s secure storage at the University of Leeds, linked to your participant ID. Then we show you how to request your app data.' : sent.length || onServer ? 'Your screenshots are with the team. Next, request your app data.' : 'Nothing has been sent yet.'}</p>
    </LabShell>
  );
}
