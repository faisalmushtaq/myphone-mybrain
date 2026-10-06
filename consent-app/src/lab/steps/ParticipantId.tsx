import { useState } from 'react';
import { getApi } from '../../api';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { SelectField, TextField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import { formatTimestamp } from '../../lib/dates';
import { describeError, labSession } from '../api';
import { buildParticipantCode, normaliseParticipantCode } from '../config';
import { LabShell } from '../LabShell';
import { useLab } from '../store';
import { validateCode, type FieldError } from '../validation';

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The participant code is built exactly as the lab questionnaire builds it,
 * so the two match without anyone having to remember it. People who already
 * have theirs can type it instead.
 */
export function ParticipantId() {
  const { state, dispatch } = useLab();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [onFile, setOnFile] = useState<string | null>(null);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const parts = state.codeParts;
  const built = buildParticipantCode(parts);
  const typed = normaliseParticipantCode(state.code);
  const code = state.returning ? typed : built;

  const validateParts = (): FieldError[] => {
    const found: FieldError[] = [];
    if (parts.mother.replace(/[^A-Za-z]/g, '').length < 2) found.push({ field: 'lab-mother', message: 'Enter your mother’s first name (at least two letters).' });
    if (!/\d/.test(parts.house)) found.push({ field: 'lab-house', message: 'Enter your house number.' });
    if (!parts.month) found.push({ field: 'lab-month', message: 'Choose the month you were born.' });
    if (parts.postcode.replace(/[^A-Za-z]/g, '').length < 2) found.push({ field: 'lab-postcode', message: 'Enter your postcode; only its last two letters are used.' });
    return found;
  };

  const next = async () => {
    const found = state.returning ? validateCode(typed) : [...validateParts(), ...(validateParts().length ? [] : validateCode(built))];
    setErrors(found);
    if (found.length) return;
    setBusy(true);
    try {
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      const lookup = await getApi().lookupLabParticipant(session, code);
      dispatch({ type: 'code', code, returning: state.returning });
      dispatch({ type: 'code-confirmed', confirmed: true });
      if (lookup.exists) {
        dispatch({ type: 'consent-on-file', consentedAt: lookup.consentedAt });
        setOnFile(lookup.consentedAt);
        announce('We already have your consent. You can go on to your data.');
        return;
      }
      dispatch({ type: 'go-to', stepId: 'information' });
    } catch (error) {
      setErrors([{ field: 'lab-code', message: describeError(error, 'your code') }]);
    } finally {
      setBusy(false);
    }
  };

  if (onFile !== null || (state.codeConfirmed && state.submission.consentOnFile && state.stepId === 'participant-id')) {
    const when = onFile ?? state.submission.consentSentAt;
    return (
      <LabShell kicker="Your participant code" title={<>Welcome back, {code}.</>} hideContinue>
        <Callout tone="success" role="status">
          <p>We already have your consent{when ? `, recorded ${formatTimestamp(when)}` : ''}. You can go straight on to your data.</p>
        </Callout>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => dispatch({ type: 'go-to', stepId: 'guide' })}>
            Continue to my data
          </Button>
          <Button variant="ghost" onClick={() => setOnFile(null)}>
            That isn’t me
          </Button>
        </div>
      </LabShell>
    );
  }

  return (
    <LabShell
      kicker="Your participant code"
      title={state.returning ? 'Enter your participant code.' : 'Make your participant code.'}
      intro={state.returning ? <p>It is the code the questionnaire gave you, such as JA101CD.</p> : <p>The questionnaire in the lab builds the same code from these four answers, so your data and your questionnaire can be matched without using your name. None of the answers themselves are kept.</p>}
      errors={errors}
      onContinue={() => void next()}
      continueLoading={busy}
    >
      {state.returning ? (
        <div className="mpmb-fields">
          <TextField id="lab-code" label="Your participant code" required autoComplete="off" autoCapitalize="characters" maxLength={12} width="half" className="mpmb-input--upper mpmb-mono" value={state.code} onChange={(e) => dispatch({ type: 'code', code: e.target.value, returning: true })} error={errs['lab-code']} />
          <Button variant="link" onClick={() => dispatch({ type: 'code', code: '', returning: false })}>
            I don’t have one yet
          </Button>
        </div>
      ) : (
        <div className="mpmb-fields">
          <TextField id="lab-mother" label="Your mother’s first name" hint="Only the first two letters are used." required autoComplete="off" maxLength={40} width="half" value={parts.mother} onChange={(e) => dispatch({ type: 'code-parts', parts: { mother: e.target.value } })} error={errs['lab-mother']} />
          <TextField id="lab-house" label="Your house number" hint="Only the first digit is used." required inputMode="numeric" autoComplete="off" maxLength={6} width="short" value={parts.house} onChange={(e) => dispatch({ type: 'code-parts', parts: { house: e.target.value } })} error={errs['lab-house']} />
          <SelectField id="lab-month" label="The month you were born" required options={months.map((m, i) => ({ value: String(i + 1).padStart(2, '0'), label: m }))} value={parts.month} onChange={(e) => dispatch({ type: 'code-parts', parts: { month: e.target.value } })} error={errs['lab-month']} />
          <TextField id="lab-postcode" label="Your postcode" hint="Only the last two letters are used." required autoComplete="postal-code" autoCapitalize="characters" maxLength={10} width="half" className="mpmb-input--upper" value={parts.postcode} onChange={(e) => dispatch({ type: 'code-parts', parts: { postcode: e.target.value } })} error={errs['lab-postcode']} />
          <p className="mpmb-code-line" aria-live="polite">
            Your participant code: <strong className="mpmb-mono">{built || '—'}</strong>
          </p>
          {errs['lab-code'] && <p className="mpmb-error">{errs['lab-code']}</p>}
          <Button variant="link" onClick={() => dispatch({ type: 'code', code: '', returning: true })}>
            I already have my code
          </Button>
        </div>
      )}
    </LabShell>
  );
}
