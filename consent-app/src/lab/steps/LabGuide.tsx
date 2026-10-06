import { useState } from 'react';
import { getApi } from '../../api';
import type { LabPlatform } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { TextField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import { describeError, labSession } from '../api';
import { labStudy } from '../config';
import { apps, jumpTo, NextLink, Steps } from '../guideSteps';
import { LabShell } from '../LabShell';
import { useLab } from '../store';

/**
 * How to request a copy of your data from the app you use most. It can take
 * days to arrive, so this step comes after the screenshots have gone and
 * offers an email that brings the person back when the file is ready.
 */
export function LabGuide() {
  const { state, dispatch } = useLab();
  const [later, setLater] = useState(false);
  const [email, setEmail] = useState('');
  const [reminder, setReminder] = useState<{ kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; followUpAt: string } | { kind: 'not-sent'; message: string }>({ kind: 'idle' });
  const ready = state.codeConfirmed && state.submission.consentStage === 'sent';
  const app = state.app;
  const chosen = apps.find((a) => a.id === app);
  const after = state.flow === 'after';

  const chooseApp = (a: LabPlatform) => {
    dispatch({ type: 'app', app: a });
    window.setTimeout(() => jumpTo(`guide-${a}`), 60);
  };

  // Not a form of its own: it sits inside the step's form, so the button and the Enter key call this directly.
  const sendReminder = async () => {
    if (reminder.kind === 'sending') return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setReminder({ kind: 'not-sent', message: 'Enter an email address in the format name@example.com.' });
      return;
    }
    setReminder({ kind: 'sending' });
    try {
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      const result = await getApi().requestLabReminder(session, { participantCode: state.code, email: email.trim(), phase: state.phase });
      if (result.outcome === 'sent') {
        setReminder({ kind: 'sent', followUpAt: result.followUpAt });
        announce('Email sent.');
      } else setReminder({ kind: 'not-sent', message: 'We could not send the email just now. Your progress is saved on this device anyway; come back to this page when your file arrives.' });
    } catch (error) {
      setReminder({ kind: 'not-sent', message: describeError(error, 'the email') });
    }
  };

  const next = () => {
    if (ready) dispatch({ type: 'go-to', stepId: 'clean' });
    else {
      dispatch({ type: 'code', code: state.code, returning: Boolean(state.code) });
      dispatch({ type: 'go-to', stepId: 'participant-id' });
    }
  };

  return (
    <LabShell
      kicker="Get your app data"
      title={after ? 'Request a new data download.' : 'Request your data download.'}
      intro={
        after ? (
          <p>Ask the same app as last time for a fresh copy of your data, even if you still have the old file: the new one covers your break. It can take from a few minutes to a few days to arrive. Start it now, then come back to this page with the file; you will choose exactly what to share before anything is sent.</p>
        ) : (
          <p>Ask the app you use most, TikTok, YouTube or Instagram, for a copy of your data. It can take from a few minutes to a few days to arrive. Start it now, then come back to this page with the file; you will choose exactly what to share before anything is sent.</p>
        )
      }
      onContinue={next}
      continueLabel={ready ? 'I have my file' : 'I have my file: enter my code'}
      width="wide"
      secondaryAction={
        <Button variant="ghost" onClick={() => setLater(true)}>
          I’ll come back later
        </Button>
      }
    >
      {later && (
        <Callout tone="info" role="status">
          {ready ? (
            <>
              <p>
                <strong>Come back when your download has arrived.</strong> Your progress is saved under your participant code <strong className="mpmb-mono">{state.code}</strong>. If you would like, we can email you a note of where you are, with a link that opens this page ready for you on any device; if we have not received your file two days later, we will send one reminder.
              </p>
              {reminder.kind === 'sent' ? (
                <p>Sent. Check your inbox (and spam folder) for an email from MyPhone/MyBrain. Your address is kept only for that email and the one reminder.</p>
              ) : (
                <div className="mpmb-inline">
                  <TextField
                    id="lab-reminder-email"
                    label="Your email address"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    maxLength={254}
                    width="half"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void sendReminder();
                      }
                    }}
                    error={reminder.kind === 'not-sent' ? reminder.message : undefined}
                    hint="Used only for this note and one reminder, then kept with your consent record."
                  />
                  <Button variant="secondary" loading={reminder.kind === 'sending'} onClick={() => void sendReminder()}>
                    Email me my progress
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p>Come back to this page when your file has arrived and enter your participant code. If you want an email reminder, enter your code and give your consent first.</p>
          )}
        </Callout>
      )}
      <Callout tone="info">
        <p>
          <strong>Before you start:</strong> make sure you are logged in to your own account. When a format option appears, always choose <strong>JSON</strong>. You do not need to share everything: you can untick items when you request the data, and you will choose again, item by item, before anything is sent. If you use more than one of the apps, you can do each in turn.
        </p>
      </Callout>

      <section aria-labelledby="guide-apps">
        <h2 className="mpmb-h2" id="guide-apps" tabIndex={-1}>
          Which app do you use most?
        </h2>
        <fieldset className="mpmb-field">
          <legend className="mpmb-sr-only">Which app do you use most?</legend>
          <div className="mpmb-chips" role="presentation">
            {apps.map((a) => (
              <label key={a.id} className={`mpmb-chip${app === a.id ? ' is-selected' : ''}`} htmlFor={`lab-app-${a.id}`}>
                <input id={`lab-app-${a.id}`} type="radio" name="lab-app" value={a.id} className="mpmb-choice__input" checked={app === a.id} onChange={() => chooseApp(a.id)} />
                <span className="mpmb-choice__dot" aria-hidden="true" />
                {a.name}
              </label>
            ))}
          </div>
        </fieldset>
        {chosen && (
          <div id={`guide-${chosen.id}`} className="mpmb-guide-phone" tabIndex={-1}>
            <h3 className="mpmb-h3">{chosen.name}</h3>
            <p className="mpmb-hint">{chosen.where}</p>
            <Steps steps={chosen.steps} />
            <NextLink onClick={next}>{ready ? 'Continue: I have my file' : 'Continue: enter my code'}</NextLink>
          </div>
        )}
      </section>

      <Callout tone="info">
        <p>
          <strong>Then:</strong> with the ZIP file on this device, press “I have my file”. You will see exactly what it contains, untick anything you would rather keep private, and only then send it. The reading and cleaning happen on your own device; nothing is uploaded until you say so. Large YouTube exports work best on a laptop.
        </p>
      </Callout>
      <p className="mpmb-hint">
        Platform menus change from time to time, so a button may sit in a slightly different place. If you get stuck, contact {labStudy.contact.name} at <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a>.
      </p>
    </LabShell>
  );
}
