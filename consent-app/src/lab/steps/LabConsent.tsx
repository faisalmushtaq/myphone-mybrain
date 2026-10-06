import { useState } from 'react';
import { getApi } from '../../api';
import { SignaturePad } from '../../components/SignaturePad';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Disclosure } from '../../components/ui/Disclosure';
import { CheckboxField, ChoiceField, TextField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import { formatIsoDate, todayIso } from '../../lib/dates';
import { limits } from '../../lib/validation';
import { describeError, labClientInfo, labSession } from '../api';
import { idDetails, labConsentForm } from '../config';
import { LabShell } from '../LabShell';
import { useLab } from '../store';
import { validateLabConsent, type FieldError } from '../validation';

/** The approved consent form: every statement ticked, a name, a signature and the date. Sent as soon as it is signed. */
export function LabConsent() {
  const { state, dispatch } = useLab();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [editDate, setEditDate] = useState(false);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const { consent, submission } = state;
  const busy = submission.consentStage === 'sending';

  const next = async () => {
    const found = validateLabConsent(consent);
    setErrors(found);
    if (found.length) return;
    const completedAt = new Date().toISOString();
    dispatch({ type: 'consent-complete' });
    dispatch({ type: 'submission', patch: { consentStage: 'sending', consentError: null } });
    announce('Saving your consent.');
    try {
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      const details = idDetails(state.codeParts);
      if (!details) throw new Error('Your details are missing. Go back to the first step and enter them again.');
      const result = await getApi().submitLabConsent(session, { participantCode: state.code, consent: { ...consent, completedAt }, codeParts: details, client: labClientInfo() });
      dispatch({ type: 'submission', patch: { consentStage: 'sent', consentError: null, consentId: result.consentId, consentVersion: result.version, consentSentAt: result.receivedAt } });
      announce('Consent saved.');
      dispatch({ type: 'next' });
    } catch (error) {
      const message = describeError(error, 'your consent');
      dispatch({ type: 'submission', patch: { consentStage: 'failed', consentError: message } });
      setErrors([{ field: 'lab-send', message }]);
    }
  };

  return (
    <LabShell kicker="Your consent" title="Your consent to take part." intro={<p>Tick each statement to confirm it, answer the Yes or No question, then sign. The ticked statements are all needed to take part; record linking is your choice. Participant ID <strong className="mpmb-mono">{state.code}</strong>.</p>} errors={errors} onContinue={() => void next()} continueLabel="Confirm and sign" continueLoading={busy} width="wide">
      {submission.consentStage === 'failed' && submission.consentError && (
        <Callout tone="important" role="alert">
          <p>{submission.consentError}</p>
        </Callout>
      )}
      <section aria-labelledby="lab-statements-heading">
        <h2 className="mpmb-h3" id="lab-statements-heading">
          {labConsentForm.title}
        </h2>
        <div className="mpmb-fields">
          {labConsentForm.statements.map((s) =>
            s.kind === 'optional' ? (
              <ChoiceField key={s.id} id={`lab-stmt-${s.id}`} name={`lab-stmt-${s.id}`} legend={s.text} hint={s.note} value={consent.responses[s.id] ? (consent.responses[s.id].response === 'agreed' ? 'agreed' : 'declined') : null} onChange={(v) => dispatch({ type: 'consent-response', statementId: s.id, version: s.version, agreed: v === 'agreed' })} options={[{ value: 'agreed', label: 'Yes' }, { value: 'declined', label: 'No' }]} error={errs[`lab-stmt-${s.id}-agreed`]} />
            ) : (
              <CheckboxField key={s.id} id={`lab-stmt-${s.id}`} checked={consent.responses[s.id]?.response === 'agreed'} onChange={(checked) => dispatch({ type: 'consent-response', statementId: s.id, version: s.version, agreed: checked })} label={s.text} hint={s.note} error={errs[`lab-stmt-${s.id}`]} emphasis />
            ),
          )}
        </div>
      </section>
      <section className="mpmb-sign" aria-labelledby="lab-sign-heading">
        <h2 className="mpmb-h3" id="lab-sign-heading">
          Sign to confirm
        </h2>
        <div className="mpmb-fields">
          <TextField id="lab-typed-name" label="Your full name" required autoComplete="name" maxLength={limits.name} width="half" value={consent.typedName} onChange={(e) => dispatch({ type: 'consent-typed-name', name: e.target.value })} error={errs['lab-typed-name']} />
          <div className={`mpmb-field${errs['lab-signature'] ? ' has-error' : ''}`}>
            <p className="mpmb-label">Your signature</p>
            {errs['lab-signature'] && (
              <p className="mpmb-error" id="lab-signature-error">
                <span className="mpmb-sr-only">Error: </span>
                {errs['lab-signature']}
              </p>
            )}
            <SignaturePad id="lab-signature" value={consent.signature} onChange={(signature) => dispatch({ type: 'consent-signature', signature })} error={errs['lab-signature']} />
          </div>
          <div className={`mpmb-field mpmb-field--date${errs['lab-date'] ? ' has-error' : ''}`} id="lab-date" tabIndex={-1}>
            {editDate ? (
              <div className="mpmb-inline">
                <label className="mpmb-label" htmlFor="lab-date-input">
                  Date
                </label>
                <input id="lab-date-input" type="date" className="mpmb-input mpmb-input--short" value={consent.confirmedDate} max={todayIso()} onChange={(e) => dispatch({ type: 'consent-date', date: e.target.value })} />
                <Button variant="link" onClick={() => setEditDate(false)}>
                  Done
                </Button>
              </div>
            ) : (
              <p className="mpmb-inline mpmb-date-line">
                Date: <strong>{formatIsoDate(consent.confirmedDate)}</strong>
                <Button variant="link" onClick={() => setEditDate(true)}>
                  Change
                </Button>
              </p>
            )}
          </div>
          <Disclosure summary="What happens with this record">
            <p>Your answers, name, signature, the date and the version of the information you read are stored as the record of your consent, against your participant ID. You can download a copy at the end. You can withdraw at any time by contacting the team.</p>
          </Disclosure>
        </div>
      </section>
    </LabShell>
  );
}
