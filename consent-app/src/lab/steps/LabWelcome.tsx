import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { labStudy } from '../config';
import { LabShell } from '../LabShell';
import { useLab } from '../store';

export function LabWelcome() {
  const { state, dispatch } = useLab();
  const consented = state.submission.consentStage === 'sent';

  const start = (returning: boolean) => {
    dispatch({ type: 'code', code: returning ? state.code : '', returning });
    dispatch({ type: 'go-to', stepId: 'participant-id' });
  };
  const resume = () => dispatch({ type: 'go-to', stepId: consented ? 'clean' : 'participant-id' });

  return (
    <LabShell
      kicker={labStudy.name}
      title="Take part in the social media break study."
      intro={
        <p>
          For adults aged {labStudy.minAge} to {labStudy.maxAge} who have been invited by the research team. Giving consent takes about five minutes. This page then shows you how to download your TikTok and YouTube data, lets you choose what to share, and sends it to the team before your first lab visit.
        </p>
      }
      hideContinue
      hideBack
    >
      {state.restored && state.codeConfirmed && (
        <Callout tone="info" role="status">
          <p>
            Welcome back. Your participant code is <strong className="mpmb-mono">{state.code}</strong>.{' '}
            <Button variant="link" onClick={resume}>
              Carry on where you left off
            </Button>
          </p>
        </Callout>
      )}
      <ol className="mpmb-next-steps" role="list">
        {['Make your participant code, the same one the questionnaire uses.', 'Read the information and give your consent.', 'Request your data from TikTok and YouTube; it can take a few days to arrive.', 'Come back, remove anything you don’t want to share on your own device, and send the rest.'].map((text, i) => (
          <li key={text}>
            <span aria-hidden="true">{i + 1}</span>
            <p>{text}</p>
          </li>
        ))}
      </ol>
      <div className="mpmb-actions">
        <Button variant="primary" arrow onClick={() => start(false)}>
          Start
        </Button>
        <Button variant="secondary" onClick={() => start(true)}>
          I have a participant code already
        </Button>
        <Button variant="link" onClick={() => dispatch({ type: 'go-to', stepId: 'guide' })}>
          Just show me how to download my data
        </Button>
      </div>
      <p className="mpmb-hint">
        Questions about the study: {labStudy.contact.name}, <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a>. Nothing about your social media is read until you choose to send it.
      </p>
    </LabShell>
  );
}
