import { ConsentSummary } from '../components/ConsentSummary';
import { StepShell } from '../components/StepShell';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Icon } from '../components/ui/Icon';
import { study } from '../config/study';
import { useStore } from '../state/context';
import { useSubmission } from '../state/useSubmission';

/** Everything in one place, with change links, before it is sent. */
export function Review() {
  const { state, dispatch } = useStore();
  const { submit, submitting } = useSubmission();
  const incomplete = state.assent.status === 'not-started';

  return (
    <StepShell
      kicker="Check and send"
      title="Check everything before you send it."
      intro={<p>This is the record that will be kept: who agreed to what, and when. Use “Change” to go back to any part.</p>}
      onContinue={() => void submit()}
      continueLabel="Send"
      continueLoading={submitting}
      width="wide"
    >
      {incomplete && (
        <Callout tone="warning" role="status">
          <p>The young person’s agreement has not been completed yet. Choose “Change” next to their section to complete it.</p>
        </Callout>
      )}
      <div className="mpmb-legend" aria-label="Key">
        <span className="mpmb-legend__item mpmb-legend__item--identity">
          <Icon name="lock" size={16} /> Identifying details
        </span>
        <span className="mpmb-legend__item mpmb-legend__item--record">
          <Icon name="check" size={16} /> Consent record
        </span>
        <span className="mpmb-legend__item mpmb-legend__item--research">
          <Icon name="image" size={16} /> Research information
        </span>
      </div>
      <ConsentSummary onChange={(step) => dispatch({ type: 'go-to', stepId: step, returnTo: 'review' })} />

      {state.submission.stage === 'failed' && (
        <Callout tone="warning" role="alert" title="Not sent yet">
          <p>{state.submission.error}</p>
          <Button variant="secondary" onClick={() => void submit()}>
            Try again
          </Button>
        </Callout>
      )}
      {submitting && (
        <p className="mpmb-status" role="status">
          {state.submission.stageLabel}
        </p>
      )}
      <Callout tone="info">
        <p>
          When you press “Send”, this record goes to the {study.organisation} research team. You will see a reference code, and a copy of this summary (without the date of birth, postcode or signature)
          will be emailed to the parent or guardian. How the information is looked after is set out in the{' '}
          <a href={study.contact.privacyPageUrl} target="_blank" rel="noopener">
            privacy notice
          </a>
          .
        </p>
      </Callout>
    </StepShell>
  );
}
