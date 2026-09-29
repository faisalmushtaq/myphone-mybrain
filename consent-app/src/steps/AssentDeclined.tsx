import { StepShell } from '../components/StepShell';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { useStore } from '../state/context';
import { clearState } from '../state/persistence';
import { useSubmission } from '../state/useSubmission';

/** A calm ending when the young person does not want to take part. */
export function AssentDeclined() {
  const { state, dispatch } = useStore();
  const { submit, submitting } = useSubmission();
  const childName = state.identity.firstName.trim() || 'you';

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
          <Button variant="primary" arrow loading={submitting} onClick={() => void submit()}>
            Let the team know
          </Button>
          <Button variant="secondary" onClick={finishWithoutSending}>
            Finish without sending anything
          </Button>
        </>
      }
    >
      <p>
        <strong>Let the team know</strong> tells the research team that {childName === 'you' ? 'you do' : `${childName} does`} not want to take part, so nobody asks again. Only your name, your school and
        your parent or guardian’s name and email are sent — not your date of birth, and no permission form.
      </p>
      <p>
        <strong>Finish without sending anything</strong> clears everything from this device and sends nothing at all.
      </p>
      {state.submission.stage === 'failed' && (
        <Callout tone="warning" role="alert">
          <p>{state.submission.error}</p>
          <Button variant="secondary" onClick={() => void submit()}>
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
