import { ConsentSummary } from '../components/ConsentSummary';
import { SaveStatus } from '../components/SaveStatus';
import { StepShell } from '../components/StepShell';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Icon } from '../components/ui/Icon';
import { phoneUseApplies } from '../model/journey';
import { useStore } from '../state/context';
import { useSync } from '../state/useSync';

/**
 * Everything that has been sent, with the chance to change it. Changes are
 * saved as amendments; the original record is kept. Sent screenshots cannot
 * be removed here (the team can do that on request), but more can be added.
 */
export function Check() {
  const { state, dispatch } = useStore();
  const { dirty, submission } = useSync();
  const childName = state.identity.firstName.trim() || 'the young person';
  const sent = submission.consentStage === 'sent' && !dirty;
  const canAddImages = phoneUseApplies(state) && state.assent.status !== 'not-started';
  const sentImages = state.donation.images.filter((i) => i.status === 'sent').length;

  return (
    <StepShell
      kicker="Check"
      title="Check what you’ve sent."
      intro={<p>This is the record the research team holds. If anything is wrong, use “Change”; the correction is saved as an update and the original is kept.</p>}
      onContinue={() => dispatch({ type: 'go-to', stepId: 'done', returnTo: null })}
      continueLabel="Everything is right — finish"
      continueLoading={submission.consentStage === 'sending'}
      hideBack
      width="wide"
    >
      <SaveStatus />

      {state.assent.status === 'not-started' && (
        <Callout tone="warning" role="status">
          <p>{childName}’s agreement has not been completed yet. Choose “Change” next to their section to complete it.</p>
        </Callout>
      )}

      <div className="mpmb-legend" aria-label="Key">
        <span className="mpmb-legend__item mpmb-legend__item--identity">
          <Icon name="lock" size={16} /> Identifying details
        </span>
        <span className="mpmb-legend__item mpmb-legend__item--record">
          <Icon name="check" size={16} /> Permission and agreement
        </span>
        <span className="mpmb-legend__item mpmb-legend__item--research">
          <Icon name="image" size={16} /> Screen time and apps
        </span>
      </div>

      <ConsentSummary onChange={(step) => dispatch({ type: 'go-to', stepId: step, returnTo: 'check' })} />

      {canAddImages && (
        <div className="mpmb-inline">
          <Button variant="secondary" onClick={() => dispatch({ type: 'go-to', stepId: 'phone-use', returnTo: 'check' })}>
            {sentImages ? 'Add more screenshots' : 'Add screenshots'}
          </Button>
          {sentImages > 0 && <span className="mpmb-hint">To remove a screenshot you have already sent, contact the team and quote your reference.</span>}
        </div>
      )}

      {!sent && submission.consentStage !== 'failed' && (
        <p className="mpmb-hint" role="status">
          Your record is being saved. You can finish once it is.
        </p>
      )}
    </StepShell>
  );
}
