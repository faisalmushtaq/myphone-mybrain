import { useEffect, useState } from 'react';
import { StatementList } from '../components/StatementList';
import { StepShell } from '../components/StepShell';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Disclosure } from '../components/ui/Disclosure';
import { Draft } from '../components/ui/Draft';
import { TextField } from '../components/ui/Field';
import { youngRecap } from '../config/copy';
import { childAssentForm } from '../config/statements';
import { study } from '../config/study';
import { limits, validateAssent, type FieldError } from '../lib/validation';
import { useStore } from '../state/context';

/**
 * The young person's own agreement, in their own words. Saying no is a valid
 * answer and leads to a respectful ending rather than an error. Whichever
 * route was taken, a short recap of what taking part means comes first.
 */
export function ChildAssent() {
  const { state, dispatch } = useStore();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const assent = state.assent;
  const childName = state.identity.firstName.trim();
  const declined = assent.responses['take-part']?.response === 'declined';
  const phoneAllowedByParent = state.consent.responses['phone-use']?.response !== 'declined';

  useEffect(() => {
    dispatch({ type: 'assent-started' });
  }, [dispatch]);

  // After "No", only the decision itself matters: the other statements are hidden.
  const statements = childAssentForm.statements.filter((s) => (declined ? s.id === 'take-part' || s.kind === 'required' : true)).filter((s) => (s.id === 'phone-use' ? phoneAllowedByParent : true));

  const next = () => {
    const found = validateAssent(assent, childAssentForm, phoneAllowedByParent);
    setErrors(found);
    if (found.length) return;
    dispatch({ type: 'assent-status', status: declined ? 'declined' : 'completed' });
    dispatch({ type: 'next' });
  };

  const decideLater = () => {
    dispatch({ type: 'assent-status', status: 'deferred', deferredBy: 'young' });
    dispatch({ type: 'go-to', stepId: 'review', returnTo: null });
  };

  return (
    <StepShell
      kicker={childName ? `For ${childName}` : 'For the young person'}
      title="Do you want to take part?"
      intro={<p>Your parent or guardian has said it is okay with them. Now it is up to you. Read each part and choose. If anything is confusing, ask someone before you answer.</p>}
      errors={errors}
      onContinue={next}
      continueLabel={declined ? 'Continue' : 'Confirm my answers'}
      secondaryAction={
        study.allowDeferredAssent && !declined ? (
          <Button variant="link" onClick={decideLater}>
            I’d like to decide later
          </Button>
        ) : undefined
      }
    >
      <div className="mpmb-card mpmb-card--mist mpmb-recap">
        <h2 className="mpmb-h3">
          {youngRecap.heading} {youngRecap.draft && <Draft />}
        </h2>
        <ul className="mpmb-recap__list" role="list">
          {youngRecap.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <Disclosure summary="What is a screen-time summary?">
          <p>It is the page in your phone’s Settings that shows how long you have spent on each app. It does not show what you did in the apps, your messages, photos or posts.</p>
        </Disclosure>
      </div>

      <StatementList
        statements={statements}
        responses={assent.responses}
        errors={errs}
        onRespond={(s, response) => dispatch({ type: 'assent-response', statementId: s.id, version: s.version, response })}
        onClear={(s) => dispatch({ type: 'assent-response', statementId: s.id, version: s.version, response: 'declined' })}
        yesLabel="Yes"
        noLabel="No"
      />

      {declined && (
        <Callout tone="info" role="status">
          <p>
            <strong>That’s completely fine.</strong> On the next screen you can choose whether to let the team know, so nobody asks you again, or to finish without sending anything.
          </p>
        </Callout>
      )}
      {!phoneAllowedByParent && !declined && (
        <Callout tone="info">
          <p>Your parent or guardian chose not to share phone-use information, so we won’t ask you about that part.</p>
        </Callout>
      )}
      {!declined && (
        <div className="mpmb-sign">
          <h2 className="mpmb-h3">Your name</h2>
          <div className="mpmb-fields">
            <TextField id="assent-typed-name" label="Type your first name" required autoComplete="off" maxLength={limits.name} width="half" value={assent.typedName} onChange={(e) => dispatch({ type: 'assent-typed-name', name: e.target.value })} error={errs['assent-typed-name']} hint="This is your way of signing." />
          </div>
        </div>
      )}
    </StepShell>
  );
}
