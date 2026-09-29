import { StepShell } from '../components/StepShell';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { useStore } from '../state/context';
import { clearState } from '../state/persistence';
import { useSync } from '../state/useSync';

/** A calm ending when the young person does not want to take part. */
export function AssentDeclined() {
  const { state, dispatch } = useStore();
  const { sendConsent, submission } = useSync();
  const childName = state.identity.firstName.trim() || 'you';

  const tellTeam = async () => {
    const result = await sendConsent();
    if (result) dispatch({ type: 'go-to', stepId: 'done', returnTo: null });
  };

  const finishWithoutSending = () => {
    clearState();
    dispatch({ type: 'reset' });
  };

  return (
    <StepShell
      kicker="No problem"
      title="Thanks for telling us."
      intro={<p>Taking part is a choice, and choosing not to is completely fine. Nothing else will happen, and nobody will ask why.</p>}
      hideContinue
      hideBack
      secondaryAction={
        <>
          <Button variant="primary" arrow loading={submission.consentStage === 'sending'} onClick={() => void tellTeam()}>
            Let the team know
          </Button>
          <Button variant="secondary" onClick={finishWithoutSending}>
            Finish without sending anything
          </Button>
        </>
      }
    >
      <p>
        <strong>Let the team know</strong> tells the research team that {childName === 'you' ? 'you do' : `${childName} does`} not want to take part, so nobody asks again. Only your name, your school and your parent or
        guardian’s name are sent — no date of birth and no permission form.
      </p>
      <p>
        <strong>Finish without sending anything</strong> clears everything from this device and sends nothing at all.
      </p>
      {submission.consentStage === 'failed' && (
        <Callout tone="warning" role="alert">
          <p>{submission.consentError}</p>
          <Button variant="secondary" onClick={() => void tellTeam()}>
            Try again
          </Button>
        </Callout>
      )}
      <Button
        variant="link"
        onClick={() => {
          dispatch({ type: 'assent-signature', signature: null });
          dispatch({ type: 'go-to', stepId: 'child-assent' });
        }}
      >
        ← Go back and change my answer
      </Button>
    </StepShell>
  );
}
