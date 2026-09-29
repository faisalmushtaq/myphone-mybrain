import { useEffect, useState } from 'react';
import { SignaturePad } from '../components/SignaturePad';
import { StepShell } from '../components/StepShell';
import { Button } from '../components/ui/Button';
import { Disclosure } from '../components/ui/Disclosure';
import { Draft } from '../components/ui/Draft';
import { youngRecap } from '../config/copy';
import { childAssentForm } from '../config/statements';
import { study } from '../config/study';
import { validateAssent, type FieldError } from '../lib/validation';
import { useStore } from '../state/context';

/**
 * The young person's agreement is one signature. The three things the
 * signature means are listed above the box in their own words; saying no and
 * deciding later are equally visible choices.
 */
export function ChildAssent() {
  const { state, dispatch } = useStore();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const assent = state.assent;
  const childName = state.identity.firstName.trim();
  const covered = childAssentForm.statements.filter((s) => s.coveredBySignature);

  useEffect(() => {
    dispatch({ type: 'assent-started' });
  }, [dispatch]);

  const sign = () => {
    const found = validateAssent(assent);
    setErrors(found);
    if (found.length) return;
    dispatch({ type: 'assent-sign' });
    dispatch({ type: 'next' });
  };

  const decline = () => {
    dispatch({ type: 'assent-decline' });
    dispatch({ type: 'next' });
  };

  const later = () => {
    dispatch({ type: 'assent-status', status: 'deferred', deferredBy: 'young' });
    dispatch({ type: 'go-to', stepId: 'check', returnTo: null });
  };

  return (
    <StepShell
      kicker={childName ? `For ${childName}` : 'For the young person'}
      title="Do you want to take part?"
      intro={<p>Your parent or guardian has said it’s okay with them. It’s still your choice. Signing your name below means yes.</p>}
      errors={errors}
      onContinue={sign}
      continueLabel="Sign and continue"
      secondaryAction={
        <>
          <Button variant="secondary" onClick={decline}>
            I don’t want to take part
          </Button>
          {study.allowDeferredAssent && (
            <Button variant="link" onClick={later}>
              I’d like to decide later
            </Button>
          )}
        </>
      }
    >
      <div className="mpmb-recap">
        <ul className="mpmb-recap__list" role="list">
          {youngRecap.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <Disclosure summary="What is a screen-time summary?">
          <p>It is the page in your phone’s Settings that shows how long you have spent on each app. It does not show what you did in the apps, your messages, photos or posts. Sharing it is a separate choice, and you can skip it.</p>
        </Disclosure>
      </div>

      <div className={`mpmb-field mpmb-assent-sign${errs['assent-signature'] ? ' has-error' : ''}`}>
        <p className="mpmb-label mpmb-label--large" id="assent-sign-label">
          Signing your name means: <Draft />
        </p>
        <ul className="mpmb-required__list" role="list" aria-labelledby="assent-sign-label">
          {covered.map((s) => (
            <li key={s.id}>{s.text}</li>
          ))}
        </ul>
        {errs['assent-signature'] && (
          <p className="mpmb-error" id="assent-signature-error">
            <span className="mpmb-sr-only">Error: </span>
            {errs['assent-signature']}
          </p>
        )}
        <SignaturePad
          id="assent-signature"
          value={assent.signature}
          onChange={(signature) => dispatch({ type: 'assent-signature', signature })}
          error={errs['assent-signature']}
          placeholder={childName ? `${childName}, sign here` : 'Sign here'}
          typedLabel="Type your first name to sign"
          typedHint="Typing your name here, yourself, counts as your signature."
          switchLabel="I’d rather type my name"
        />
      </div>
    </StepShell>
  );
}
