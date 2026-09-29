import { useStore } from '../state/context';
import { useSync } from '../state/useSync';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { Icon } from './ui/Icon';

/**
 * A one-line status of whether the permission and agreement are on the
 * server, with a retry when saving failed. Shown on the screens that follow
 * the agreement, so a family always knows their participation is recorded.
 */
export function SaveStatus() {
  const { state } = useStore();
  const { sendConsent, dirty } = useSync();
  const { consentStage, consentError, referenceCode, consentVersion } = state.submission;
  if (state.assent.status === 'not-started') return null;

  if (consentStage === 'failed') {
    return (
      <Callout tone="warning" role="alert" title={referenceCode ? 'Your changes have not been saved yet' : 'Your permission has not been saved yet'}>
        <p>{consentError}</p>
        <Button variant="secondary" onClick={() => void sendConsent()}>
          Try again
        </Button>
      </Callout>
    );
  }
  if (consentStage === 'sending' || (consentStage === 'sent' && dirty)) {
    return (
      <p className="mpmb-save mpmb-save--busy" role="status">
        <span className="mpmb-spinner" aria-hidden="true" /> {referenceCode ? 'Saving your changes…' : 'Saving your permission…'}
      </p>
    );
  }
  if (consentStage === 'sent') {
    return (
      <p className="mpmb-save mpmb-save--done" role="status">
        <Icon name="check" size={16} /> {consentVersion > 1 ? 'Changes saved.' : 'Permission saved.'} Reference <strong>{referenceCode}</strong>
      </p>
    );
  }
  return null;
}
