import { useState } from 'react';
import { SaveStatus } from '../components/SaveStatus';
import { StepShell } from '../components/StepShell';
import { Button } from '../components/ui/Button';
import { parentInvolved } from '../model/journey';
import { useStore } from '../state/context';
import { clearState } from '../state/persistence';
import { useSync } from '../state/useSync';

/**
 * A calm answer when the young person does not want to share their screen
 * time. With a parent or carer there, the form carries on to them (their
 * permission and answers still count, and they are asked a few more
 * questions instead); a 16- or 17-year-old on their own has sent nothing, so
 * finishing clears the device. Carrying on later with a record, the no is
 * sent to that record when they finish, so they can still change it until
 * then.
 */
export function AssentDeclined() {
  const { state, dispatch } = useStore();
  const { sendConsent } = useSync();
  const [busy, setBusy] = useState(false);
  const withParent = parentInvolved(state);

  const finishResumed = async () => {
    setBusy(true);
    const sent = await sendConsent();
    setBusy(false);
    if (sent) dispatch({ type: 'go-to', stepId: 'done', returnTo: null });
  };

  const finishWithoutSending = () => {
    clearState();
    dispatch({ type: 'reset' });
  };

  return (
    <StepShell
      kicker="No problem"
      title="Thanks for telling us."
      intro={<p>Sharing your screen time is a choice, and choosing not to is completely fine. Nobody will ask why, and it won’t change anything at school.</p>}
      hideContinue
      hideBack
      secondaryAction={
        state.resume ? (
          <Button variant="primary" loading={busy} onClick={() => void finishResumed()}>
            Finish
          </Button>
        ) : withParent ? (
          <Button variant="primary" arrow onClick={() => dispatch({ type: 'next' })}>
            Continue
          </Button>
        ) : (
          <Button variant="primary" onClick={finishWithoutSending}>
            Finish
          </Button>
        )
      }
    >
      {state.resume && <SaveStatus />}
      <p>{state.resume ? 'Nothing from your phone will be shared. Finish lets the research team know your answer.' : withParent ? 'Nothing from your phone will be shared. Next, please hand the phone back to your parent or carer: there are a few more questions for them.' : 'Nothing has been sent. Finish clears everything you typed from this device.'}</p>
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
