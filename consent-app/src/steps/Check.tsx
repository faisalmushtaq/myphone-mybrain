import { useEffect, useRef, useState } from 'react';
import { ConsentSummary } from '../components/ConsentSummary';
import { SaveStatus } from '../components/SaveStatus';
import { StepShell } from '../components/StepShell';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Icon } from '../components/ui/Icon';
import { assentApplies, lastCall, parentInvolved, phoneUseApplies, youngFinishes } from '../model/journey';
import { useStore } from '../state/context';
import { firstIncomplete, useSync } from '../state/useSync';

/**
 * Everything that has been saved (as the family went along), with the
 * chance to change it. Changes are saved too; a change to the permission or
 * the agreement keeps the original. Sent screenshots cannot be removed here
 * (the team can do that on request), but more can be added.
 *
 * When the young person has the phone at the end (youngFinishes), this is
 * their short "Nearly done" page instead: no parent's details, just Finish,
 * which sends everything. The phone never goes back to the parent.
 */
export function Check() {
  const { state, dispatch } = useStore();
  const { sendConsent, dirty, submission } = useSync();
  const childName = state.identity.firstName.trim() || 'the young person';
  const sent = submission.consentStage === 'sent' && !dirty;
  const canAddImages = phoneUseApplies(state);
  const sentImages = state.donation.images.filter((i) => i.status === 'sent').length;
  const prompt = lastCall(state);
  // The prompt being shown, kept from the moment Finish was pressed (it is marked as shown then, so lastCall no longer offers it).
  const [asking, setAsking] = useState<NonNullable<ReturnType<typeof lastCall>> | null>(null);
  const [finishing, setFinishing] = useState(false);
  const saving = submission.consentStage === 'sending' || finishing;
  const promptRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (asking) promptRef.current?.focus();
  }, [asking]);

  // Anything not yet saved goes first, so "Finish and clear this device" on the next page can never lose it.
  const done = async () => {
    if (saving) return;
    // Something the record needs was undone (for example the permission changed and not signed again): go back to it.
    const missing = firstIncomplete(state);
    if (missing) {
      dispatch({ type: 'go-to', stepId: missing, returnTo: 'check' });
      return;
    }
    if (submission.consentStage !== 'sent' || dirty) {
      setFinishing(true);
      const saved = await sendConsent();
      setFinishing(false);
      if (!saved) return;
    }
    dispatch({ type: 'go-to', stepId: 'done', returnTo: null });
  };
  const finish = () => {
    if (!prompt) return void done();
    dispatch({ type: 'share-prompted' });
    setAsking(prompt);
    window.scrollTo({ top: 0 });
  };

  if (asking) {
    const own = !parentInvolved(state) || youngFinishes(state);
    const why = `The screenshots are the most useful part of the study: they show how long ${own ? 'you spend' : `${childName} spends`} on ${own ? 'your' : 'their'} phone, and on which apps. It takes about two minutes.`;
    const copy =
      asking === 'here'
        ? { title: `Is ${childName} with you now?`, body: `${childName} can still say whether to share their screen time: now, if they are with you, or later with the link on the next page. ${why}`, yes: `Yes, ${childName} is here`, no: 'Finish: they will do it later' }
        : asking === 'after-all'
          ? { title: `Would you share ${childName}’s screen time after all?`, body: `${why} If not, that is completely fine: your answers are saved.`, yes: 'Yes, share it', no: 'No, finish' }
          : { title: own ? 'Add your screen time before you finish?' : `Add ${childName}’s screen time before you finish?`, body: `No screenshots have been added yet. ${why}`, yes: 'Add the screenshots now', no: 'Finish without them' };
    const yes = () => {
      setAsking(null);
      if (asking === 'here') {
        dispatch({ type: 'set-child-present', present: true });
        dispatch({ type: 'go-to', stepId: 'child-assent', returnTo: 'check' });
      } else dispatch({ type: 'go-to', stepId: asking === 'after-all' ? 'phone-source' : 'phone-use', returnTo: 'check' });
    };
    return (
      <div className="mpmb-step mpmb-step--normal mpmb-lastcall">
        <header className="mpmb-step__header">
          <p className="mpmb-kicker">Before you finish</p>
          <h1 className="mpmb-h1" tabIndex={-1} ref={promptRef}>
            {copy.title}
          </h1>
          <div className="mpmb-lead">
            <p>{copy.body}</p>
          </div>
        </header>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={yes}>
            {copy.yes}
          </Button>
          <Button variant="secondary" loading={saving} onClick={() => void done()}>
            {copy.no}
          </Button>
        </div>
        {submission.consentStage === 'failed' && <SaveStatus />}
      </div>
    );
  }

  if (youngFinishes(state)) {
    const shared = sentImages > 0;
    return (
      <StepShell
        kicker="Nearly done"
        title={<>Nearly done, {childName}.</>}
        intro={<p>{state.assent.status === 'declined' ? 'Tap Finish to send your answer.' : shared ? 'Tap Finish to send your answer and your screenshots.' : 'Tap Finish to send your answer.'} That’s all: you don’t need to give the phone back first.</p>}
        onContinue={finish}
        continueLabel="Finish"
        continueLoading={saving}
        hideBack
      >
        <SaveStatus />
      </StepShell>
    );
  }

  return (
    <StepShell
      kicker="Check"
      title="Check what you’ve sent."
      intro={<p>This is what the research team holds: it was saved as you went along. If anything is wrong, use “Change”; the change is saved too, and a changed permission or agreement keeps the original.</p>}
      onContinue={finish}
      continueLabel="Everything is right — finish"
      continueLoading={saving}
      hideBack
      width="wide"
    >
      <SaveStatus />

      {assentApplies(state) && state.assent.status === 'not-started' && (
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
          <Icon name="image" size={16} /> Answers and screen time
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
