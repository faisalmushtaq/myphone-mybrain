import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { labPages, labStudy } from '../config';
import { LabShell } from '../LabShell';
import { resumeStep } from '../reducer';
import { useLab } from '../store';

/**
 * The break study's first page: two equal ways in (decided 7 October 2026),
 * "New to the study" and "Already started?", so someone coming back never
 * has to find a line of small print. Coming back, the person's participant
 * ID or the same four details find their record on any device, and they
 * carry on where they left off; this device may remember them already.
 */
export function LabWelcome() {
  const { state, dispatch } = useLab();
  const consented = state.submission.consentStage === 'sent';
  const remembered = state.restored && state.codeConfirmed;

  const start = () => {
    dispatch({ type: 'carry-on', on: false });
    dispatch({ type: 'code', code: '', returning: false });
    dispatch({ type: 'go-to', stepId: 'participant-id' });
  };
  const carryOn = () => {
    if (remembered && consented) {
      dispatch({ type: 'go-to', stepId: resumeStep(state) });
      return;
    }
    dispatch({ type: 'carry-on', on: true });
    dispatch({ type: 'go-to', stepId: 'participant-id' });
  };

  return (
    <LabShell
      kicker={labStudy.name}
      title="Take part in the social media break study."
      intro={
        <p>
          For adults aged {labStudy.minAge} to {labStudy.maxAge} who have been invited by the research team. Giving consent takes about five minutes. You then send screenshots of your screen-time summary straight away, request your data from each of TikTok, YouTube and Instagram that you use, and come back to choose what to share from it before your first lab visit.
        </p>
      }
      hideContinue
      hideBack
    >
      <div className="mpmb-routes">
        <button type="button" className="mpmb-route" onClick={start} aria-labelledby="lab-new-title" aria-describedby="lab-new-body">
          <span className="mpmb-route__icon" aria-hidden="true">
            <Icon name="young" size={30} />
          </span>
          <span className="mpmb-route__title" id="lab-new-title">
            New to the study
          </span>
          <span className="mpmb-route__body" id="lab-new-body">
            Enter your details, read the information and give your consent: about five minutes.
          </span>
          <span className="mpmb-route__cta" aria-hidden="true">
            Start →
          </span>
        </button>
        <button type="button" className="mpmb-route mpmb-route--young" onClick={carryOn} aria-labelledby="lab-back-title" aria-describedby="lab-back-body">
          <span className="mpmb-route__icon" aria-hidden="true">
            <Icon name="refresh" size={30} />
          </span>
          <span className="mpmb-route__title" id="lab-back-title">
            Already started?
          </span>
          <span className="mpmb-route__body" id="lab-back-body">
            {remembered ? (
              <>
                Welcome back. This device remembers your participant ID, <span className="mpmb-mono">{state.code}</span>: carry on where you left off.
              </>
            ) : (
              'Carry on where you left off, on any device: with your participant ID (it is in our emails) or the same details you gave at the start.'
            )}
          </span>
          <span className="mpmb-route__cta" aria-hidden="true">
            Continue →
          </span>
        </button>
      </div>

      <h2 className="mpmb-h3">How it works</h2>
      <ol className="mpmb-next-steps" role="list">
        {['Enter your name, date of birth and postcode. They make your participant ID, which labels your data instead of your name.', 'Read the information and give your consent.', 'Take screenshots of your screen-time summary and send them; it takes a few minutes.', 'Request your data from each of TikTok, YouTube and Instagram that you use, starting with the one you use most. Each can take a few days to arrive; we can email you a link to come back with.', 'Come back with the file, remove anything you don’t want to share on your own device, and send the rest.'].map((text, i) => (
          <li key={text}>
            <span aria-hidden="true">{i + 1}</span>
            <p>{text}</p>
          </li>
        ))}
      </ol>
      <p>
        <Button variant="link" onClick={() => dispatch({ type: 'go-to', stepId: 'guide' })}>
          Just show me how to download my data
        </Button>
      </p>
      <p className="mpmb-hint">
        During your break, do your <a href={labPages.checkin.path}>mid-break check-in</a>; when the break ends, send your data again on the <a href={labPages.after.path}>after-break page</a>.
      </p>
      <p className="mpmb-hint">
        Questions about the study: {labStudy.contact.name}, <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a>. Nothing about your social media is read until you choose to send it.
      </p>
    </LabShell>
  );
}
