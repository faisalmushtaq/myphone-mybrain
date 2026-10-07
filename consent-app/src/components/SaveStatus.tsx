import { youngAlone } from '../model/journey';
import { useStore } from '../state/context';
import { firstIncomplete, useSync } from '../state/useSync';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { Icon } from './ui/Icon';

/**
 * A one-line status of whether the record is on the server, with a retry
 * when saving failed. Shown once the record can be saved (from the moment
 * the parent signs), so a family always knows what they gave is recorded.
 */
export function SaveStatus() {
  const { state } = useStore();
  const { sendConsent, dirty } = useSync();
  const { consentStage, consentError, referenceCode } = state.submission;
  if (firstIncomplete(state) && consentStage !== 'sent') return null;
  // Carrying on later: only the young person's answer is sent from here; the record itself went before.
  if (state.resume && consentStage === 'idle') return null;
  const what = youngAlone(state) || state.resume ? 'Your answer' : 'Your permission';

  if (consentStage === 'failed') {
    return (
      <Callout tone="warning" role="alert" title={referenceCode && !state.resume ? 'Your latest answers have not been saved yet' : `${what} has not been saved yet`}>
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
        <span className="mpmb-spinner" aria-hidden="true" /> {referenceCode && !state.resume ? 'Saving…' : `Saving ${what.toLowerCase()}…`}
      </p>
    );
  }
  if (consentStage === 'sent') {
    return (
      <p className="mpmb-save mpmb-save--done" role="status">
        <Icon name="check" size={16} /> {state.resume ? (state.resume.canAgree ? 'Your answer is saved.' : 'Adding to your record.') : 'Everything so far is saved.'} Reference <strong>{referenceCode}</strong>
      </p>
    );
  }
  return null;
}
