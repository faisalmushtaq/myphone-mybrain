import { useState } from 'react';
import { SignaturePad } from '../components/SignaturePad';
import { StatementList } from '../components/StatementList';
import { StepShell } from '../components/StepShell';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { TextField } from '../components/ui/Field';
import { parentInformationVersion } from '../config/copy';
import { parentConsentForm } from '../config/statements';
import { study } from '../config/study';
import { formatIsoDate, todayIso } from '../lib/dates';
import { limits, namesLookDifferent, validateConsent, type FieldError } from '../lib/validation';
import { useStore } from '../state/context';

/** Statements, typed name, drawn signature and date: the consent record. */
export function ParentConsent() {
  const { state, dispatch } = useStore();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [editDate, setEditDate] = useState(false);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const consent = state.consent;
  const childName = state.identity.firstName.trim() || 'the young person';
  const nameWarning = consent.typedName && namesLookDifferent(consent.typedName, state.guardian.fullName);
  const requiredCount = parentConsentForm.statements.filter((s) => s.kind === 'required').length;

  const next = () => {
    const found = validateConsent(consent, parentConsentForm);
    setErrors(found);
    if (found.length) return;
    dispatch({ type: 'consent-complete', informationVersion: parentInformationVersion.version });
    dispatch({ type: 'next' });
  };

  return (
    <StepShell
      kicker={parentConsentForm.title}
      title={<>Your permission for {childName} to take part.</>}
      intro={
        <p>
          Please read each statement and choose. The first {requiredCount} are needed to take part; the others are separate choices, and you can say no to any of them. The{' '}
          <a href={study.contact.privacyPageUrl} target="_blank" rel="noopener">
            privacy notice
          </a>{' '}
          explains how information is looked after.
        </p>
      }
      errors={errors}
      onContinue={next}
      continueLabel="Confirm my consent"
    >
      {consent.revisedAt && !consent.signature && (
        <Callout tone="important" role="status">
          <p>You changed one of your answers after signing, so please sign again at the bottom to confirm the new answers.</p>
        </Callout>
      )}
      <StatementList
        statements={parentConsentForm.statements}
        responses={consent.responses}
        errors={errs}
        onRespond={(s, response) => dispatch({ type: 'consent-response', statementId: s.id, version: s.version, response })}
        onClear={(s) => dispatch({ type: 'consent-response', statementId: s.id, version: s.version, response: 'declined' })}
        yesLabel="Yes, I agree"
        noLabel="No"
      />

      <div className="mpmb-sign">
        <h2 className="mpmb-h3">Sign to confirm</h2>
        <p>Your signature confirms the choices above. It is stored with this record as evidence of your consent.</p>
        <div className="mpmb-fields">
          <TextField id="consent-typed-name" label="Your full name" required autoComplete="name" maxLength={limits.name} value={consent.typedName} onChange={(e) => dispatch({ type: 'consent-typed-name', name: e.target.value })} error={errs['consent-typed-name']} />
          {nameWarning && (
            <Callout tone="warning" role="status">
              <p>
                This name looks different from the name you gave earlier (<strong>{state.guardian.fullName}</strong>). That is fine if you write your name differently, but please check.
              </p>
            </Callout>
          )}
          <div className={`mpmb-field${errs['signature-pad'] ? ' has-error' : ''}`}>
            <p className="mpmb-label" id="signature-label">
              Your signature
            </p>
            <p className="mpmb-hint" id="signature-hint">
              Sign in the box using your finger, a stylus or a mouse.
            </p>
            {errs['signature-pad'] && (
              <p className="mpmb-error" id="signature-pad-error">
                <span className="mpmb-sr-only">Error: </span>
                {errs['signature-pad']}
              </p>
            )}
            <SignaturePad id="signature-pad" value={consent.signature} onChange={(signature) => dispatch({ type: 'consent-signature', signature })} error={errs['signature-pad']} />
          </div>
          <div className={`mpmb-field mpmb-field--date${errs['consent-date'] ? ' has-error' : ''}`} id="consent-date" tabIndex={-1}>
            <p className="mpmb-label">Date</p>
            {errs['consent-date'] && (
              <p className="mpmb-error">
                <span className="mpmb-sr-only">Error: </span>
                {errs['consent-date']}
              </p>
            )}
            {editDate ? (
              <div className="mpmb-inline">
                <input id="consent-date-input" type="date" className="mpmb-input mpmb-input--short" value={consent.confirmedDate} max={todayIso()} onChange={(e) => dispatch({ type: 'consent-date', date: e.target.value })} aria-label="Date of consent" />
                <Button variant="link" onClick={() => setEditDate(false)}>
                  Done
                </Button>
              </div>
            ) : (
              <p className="mpmb-inline">
                <strong>{formatIsoDate(consent.confirmedDate)}</strong>
                <Button variant="link" onClick={() => setEditDate(true)}>
                  Change date
                </Button>
              </p>
            )}
            <p className="mpmb-hint">Today’s date is filled in automatically. The exact time you confirm is also recorded.</p>
          </div>
        </div>
      </div>
    </StepShell>
  );
}
