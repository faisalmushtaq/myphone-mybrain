import { ConsentSummary } from '../components/ConsentSummary';
import { StepShell } from '../components/StepShell';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Disclosure } from '../components/ui/Disclosure';
import { Icon } from '../components/ui/Icon';
import { relationships } from '../config/fields';
import { OTHER_SCHOOL_ID, schools } from '../config/schools';
import { parentConsentForm } from '../config/statements';
import { study } from '../config/study';
import { formatIsoDate } from '../lib/dates';
import { useStore } from '../state/context';
import { useSubmission } from '../state/useSubmission';

/**
 * A short confirmation of what is about to be sent, with the full record
 * available under "Review everything" for anyone who wants it.
 */
export function Send() {
  const { state, dispatch } = useStore();
  const { submit, submitting } = useSubmission();
  const { identity, guardian, consent, assent, donation } = state;
  const childName = identity.firstName.trim() || 'the young person';
  const schoolName = identity.schoolId === OTHER_SCHOOL_ID ? identity.schoolOther : schools.find((s) => s.id === identity.schoolId)?.name ?? '';
  const relationship = guardian.relationship === 'other' ? guardian.relationshipOther : relationships.find((r) => r.id === guardian.relationship)?.label ?? '';
  const yes = parentConsentForm.statements.filter((s) => s.kind === 'optional' && consent.responses[s.id]?.response === 'agreed').map((s) => s.label.toLowerCase());
  const no = parentConsentForm.statements.filter((s) => s.kind === 'optional' && consent.responses[s.id]?.response === 'declined').map((s) => s.label.toLowerCase());
  const uploaded = donation.images.filter((i) => i.status === 'uploaded').length;

  const assentLine =
    assent.status === 'completed'
      ? `${childName} signed to say yes`
      : assent.status === 'deferred'
        ? assent.deferredBy === 'young'
          ? `${childName} would like to decide later`
          : `${childName} wasn’t here; the team will ask separately`
        : 'Not completed yet';
  const phoneLine =
    donation.status === 'completed'
      ? `${uploaded} screenshot${uploaded === 1 ? '' : 's'} ready to send`
      : donation.status === 'skipped'
        ? 'Skipped for now'
        : donation.status === 'not-consented'
          ? 'Not sharing'
          : donation.status === 'deferred'
            ? `Waiting for ${childName}’s agreement`
            : 'Not added yet';

  return (
    <StepShell
      kicker="Send"
      title="Ready to send."
      intro={<p>Here is what will be sent to the {study.organisation} research team. Check the short version, or open the full record if you want to see everything.</p>}
      onContinue={() => void submit()}
      continueLabel="Send"
      continueLoading={submitting}
    >
      {assent.status === 'not-started' && (
        <Callout tone="warning" role="status">
          <p>{childName}’s agreement has not been completed yet. Open “Review everything” and choose “Change” next to their section to complete it.</p>
        </Callout>
      )}
      <dl className="mpmb-brief">
        <div>
          <dt>
            <Icon name="young" size={18} /> Young person
          </dt>
          <dd>
            {identity.firstName} {identity.lastName}
            {identity.yearGroup ? `, ${identity.yearGroup}` : ''}
            {schoolName ? `, ${schoolName}` : ''}
          </dd>
        </div>
        <div>
          <dt>
            <Icon name="parent" size={18} /> Permission
          </dt>
          <dd>
            {guardian.fullName}
            {relationship ? ` (${relationship.toLowerCase()})` : ''}, signed {consent.confirmedDate ? formatIsoDate(consent.confirmedDate) : ''}
            {yes.length ? `. Yes to ${yes.join(', ')}` : ''}
            {no.length ? `. No to ${no.join(', ')}` : ''}.
          </dd>
        </div>
        <div>
          <dt>
            <Icon name="check" size={18} /> Agreement
          </dt>
          <dd>{assentLine}</dd>
        </div>
        <div>
          <dt>
            <Icon name="image" size={18} /> Screen time
          </dt>
          <dd>{phoneLine}</dd>
        </div>
      </dl>

      <Disclosure summary="Review everything before sending">
        <ConsentSummary onChange={(step) => dispatch({ type: 'go-to', stepId: step, returnTo: 'send' })} />
      </Disclosure>

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
      <p className="mpmb-hint">
        You will get a reference code, and a copy of the summary (without the date of birth, postcode or signature) is emailed to {guardian.email || 'the parent or guardian'}. See the{' '}
        <a href={study.contact.privacyPageUrl} target="_blank" rel="noopener">
          privacy notice
        </a>{' '}
        for how information is looked after.
      </p>
    </StepShell>
  );
}
