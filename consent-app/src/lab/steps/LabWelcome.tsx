import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { labPages, labStudy } from '../config';
import { LabShell } from '../LabShell';
import { resumeStep } from '../reducer';
import { useLab } from '../store';

export function LabWelcome() {
  const { state, dispatch } = useLab();
  const consented = state.submission.consentStage === 'sent';

  const start = () => {
    dispatch({ type: 'code', code: '', returning: false });
    dispatch({ type: 'go-to', stepId: 'participant-id' });
  };
  const resume = () => dispatch({ type: 'go-to', stepId: consented ? resumeStep(state) : 'participant-id' });

  return (
    <LabShell
      kicker={labStudy.name}
      title="Take part in the social media break study."
      intro={
        <p>
          For adults aged {labStudy.minAge} to {labStudy.maxAge} who have been invited by the research team. Giving consent takes about five minutes. You then send screenshots of your screen-time summary straight away, request your data from TikTok, YouTube or Instagram, and come back to choose what to share from it before your first lab visit.
        </p>
      }
      hideContinue
      hideBack
    >
      {state.restored && state.codeConfirmed && (
        <Callout tone="info" role="status">
          <p>
            Welcome back. Your participant ID is <strong className="mpmb-mono">{state.code}</strong>.{' '}
            <Button variant="link" onClick={resume}>
              Carry on where you left off
            </Button>
          </p>
        </Callout>
      )}
      <ol className="mpmb-next-steps" role="list">
        {['Enter your name, date of birth and postcode. They make your participant ID, which labels your data instead of your name.', 'Read the information and give your consent.', 'Take screenshots of your screen-time summary and send them; it takes a few minutes.', 'Request your data from the app you use most, TikTok, YouTube or Instagram. It can take a few days to arrive; we can email you a reminder.', 'Come back with the file, remove anything you don’t want to share on your own device, and send the rest.'].map((text, i) => (
          <li key={text}>
            <span aria-hidden="true">{i + 1}</span>
            <p>{text}</p>
          </li>
        ))}
      </ol>
      <div className="mpmb-actions">
        <Button variant="primary" arrow onClick={start}>
          Start
        </Button>
        <Button variant="link" onClick={() => dispatch({ type: 'go-to', stepId: 'guide' })}>
          Just show me how to download my data
        </Button>
      </div>
      <p className="mpmb-hint">
        Started already? Press Start and enter the same details: you carry on where you left off, on any device. During your break, do your <a href={labPages.checkin.path}>mid-break check-in</a>; when the break ends, send your data again on the <a href={labPages.after.path}>after-break page</a>.
      </p>
      <p className="mpmb-hint">
        Questions about the study: {labStudy.contact.name}, <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a>. Nothing about your social media is read until you choose to send it.
      </p>
    </LabShell>
  );
}
