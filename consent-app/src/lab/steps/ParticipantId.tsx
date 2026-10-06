import { useState } from 'react';
import { getApi } from '../../api';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { SelectField, TextField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import { formatTimestamp } from '../../lib/dates';
import { describeError, labSession } from '../api';
import { buildParticipantCode, formatPostcode, isUkPostcode, labPages, labStudy, nameHasTwoLetters, normaliseParticipantCode } from '../config';
import { LabShell } from '../LabShell';
import { nextFilesStep, phaseHave, resumeStep } from '../reducer';
import { useLab } from '../store';
import { validateCode, type FieldError } from '../validation';
import { filesPhrase } from '../words';

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const intro = {
  baseline: {
    kicker: 'Your participant code',
    build: 'Make your participant code.',
    typed: 'Enter your participant code.',
  },
  checkin: {
    kicker: 'Mid-break check-in',
    build: 'Your mid-break check-in.',
    typed: 'Your mid-break check-in.',
  },
  after: {
    kicker: 'After your break',
    build: 'Welcome back after your break.',
    typed: 'Welcome back after your break.',
  },
} as const;

/**
 * The participant code is built exactly as the lab questionnaire builds it,
 * so the two match without anyone having to remember it. People who already
 * have theirs can type it instead; on the check-in and after-break pages
 * that is the default, filled in when this device remembers it. The server
 * then says what it already holds for the code, so the person carries on
 * where they left off, on whichever device.
 */
export function ParticipantId() {
  const { state, dispatch } = useLab();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [noConsent, setNoConsent] = useState<string | null>(null);
  // The code someone said was not theirs: it already has another person's consent.
  const [notMine, setNotMine] = useState<string | null>(null);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const parts = state.codeParts;
  const built = buildParticipantCode(parts);
  // Until the postcode is complete, its letters are unknown: show placeholders rather than letters from half a postcode.
  const preview = isUkPostcode(parts.postcode) ? built : `${buildParticipantCode({ ...parts, postcode: '' })}__`;
  const typed = normaliseParticipantCode(state.code);
  const code = state.returning ? typed : built;
  const words = intro[state.flow];
  const firstPage = state.flow === 'baseline';

  const validateParts = (): FieldError[] => {
    const found: FieldError[] = [];
    if (!nameHasTwoLetters(parts.firstName)) found.push({ field: 'lab-first-name', message: 'Enter your first name (at least two letters).' });
    if (!/\d/.test(parts.house)) found.push({ field: 'lab-house', message: 'Enter your house number.' });
    if (!parts.month) found.push({ field: 'lab-month', message: 'Choose the month you were born.' });
    if (!parts.postcode.trim()) found.push({ field: 'lab-postcode', message: 'Enter your postcode.' });
    else if (!isUkPostcode(parts.postcode)) found.push({ field: 'lab-postcode', message: 'Enter a full UK postcode, such as LS2 9JT.' });
    return found;
  };

  const next = async () => {
    setNoConsent(null);
    setNotMine(null);
    const found = state.returning ? validateCode(typed) : [...validateParts(), ...(validateParts().length ? [] : validateCode(built))];
    setErrors(found);
    if (found.length) return;
    setBusy(true);
    try {
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      const lookup = await getApi().lookupLabParticipant(session, code);
      if (!lookup.exists && !firstPage) {
        setNoConsent(code);
        return;
      }
      dispatch({ type: 'confirm-code', code, returning: state.returning, lookup });
      if (!lookup.exists) {
        dispatch({ type: 'go-to', stepId: 'information' });
        return;
      }
      if (firstPage) {
        setWelcome(true);
        announce('We already have your consent. You can carry on where you left off.');
        return;
      }
      dispatch({ type: 'go-to', stepId: resumeStep({ ...state, progress: lookup }) });
    } catch (error) {
      setErrors([{ field: state.returning ? 'lab-code' : 'lab-first-name', message: describeError(error, 'your code') }]);
    } finally {
      setBusy(false);
    }
  };

  // The first page, for someone whose consent is already on file: what has arrived, and the next thing to do.
  if (firstPage && (welcome || (state.codeConfirmed && state.submission.consentOnFile && state.stepId === 'participant-id'))) {
    const when = state.progress?.consentedAt ?? state.submission.consentSentAt;
    const have = phaseHave(state);
    const nextStep = nextFilesStep(state);
    return (
      <LabShell kicker="Your participant code" title={<>Welcome back, {code}.</>} hideContinue hideBack>
        <Callout tone="success" role="status">
          <p>
            We already have your consent{when ? `, recorded ${formatTimestamp(when)}` : ''}. Received from you so far: <strong>{filesPhrase(have)}</strong>.
          </p>
        </Callout>
        <p>{nextStep === 'screenshots' ? 'Next: your screen-time screenshots. They take a few minutes and go to the team straight away.' : nextStep === 'guide' ? 'Next: your app data. Request the download, or if it has arrived, clean it and send it.' : 'Everything the study needs from before your break is in. You can add more files if you like.'}</p>
        <p className="mpmb-hint">If you have never given consent for this study, this code belongs to someone else: press “That isn’t me”.</p>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => dispatch({ type: 'go-to', stepId: nextStep === 'done' ? 'screenshots' : nextStep })}>
            {nextStep === 'screenshots' ? 'Continue: my screenshots' : nextStep === 'guide' ? 'Continue: my app data' : 'Add more files'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setWelcome(false);
              setNotMine(code);
              // Keep the answers so they can be checked; the typed code is cleared.
              dispatch({ type: 'code', code: state.returning ? '' : state.code, returning: state.returning });
            }}
          >
            That isn’t me
          </Button>
        </div>
        {nextStep === 'done' && (
          <p className="mpmb-hint">
            During your break, use the <a href={labPages.checkin.path}>mid-break check-in</a>; when it ends, send your data again on the <a href={labPages.after.path}>after-break page</a>.
          </p>
        )}
      </LabShell>
    );
  }

  const lead = firstPage ? (
    state.returning ? (
      <p>It is the code the questionnaire gave you, such as JA101CD.</p>
    ) : (
      <p>The questionnaire in the lab builds the same code from these four answers, so your data and your questionnaire can be matched without either of them holding your name. Your four answers are kept with your consent record too, for the research.</p>
    )
  ) : state.flow === 'checkin' ? (
    <p>A few quick questions about how your break is going: about two minutes. Your participant code joins your answers up with the rest of your data, never your name. You gave your consent at the start, so there is nothing to sign.</p>
  ) : (
    <p>The second part is shorter: a reminder of what you agreed to, then your screen-time screenshots and your app data again, this time from after the break. You gave your consent at the start, so there is nothing to sign.</p>
  );

  return (
    <LabShell kicker={words.kicker} title={state.returning ? words.typed : words.build} intro={lead} errors={errors} onContinue={() => void next()} continueLoading={busy} hideBack={!firstPage}>
      {notMine && (
        <Callout tone="important" role="alert">
          <p>
            <strong>Someone has already taken part with the code {notMine}.</strong> Two people can end up with the same code, for example twins whose first names start with the same two letters. Check your answers below. If they are right, please do not carry on with this code: contact {labStudy.contact.name} at <a href={`mailto:${labStudy.contact.email}?subject=${encodeURIComponent(`Participant code ${notMine} is already taken`)}`}>{labStudy.contact.email}</a> and the team will give you a code to use.
          </p>
        </Callout>
      )}
      {noConsent && (
        <Callout tone="important" role="alert">
          <p>
            We have no consent on file for <strong className="mpmb-mono">{noConsent}</strong>. Check the code: it is the one you made when you signed up. If you have not taken part yet, <a href={labPages.baseline.path}>start on the first page</a>. If you are stuck, contact {labStudy.contact.name} at <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a>.
          </p>
        </Callout>
      )}
      {state.returning ? (
        <div className="mpmb-fields">
          <TextField
            id="lab-code"
            label="Your participant code"
            hint={!firstPage && typed ? 'Filled in from this device. Check it is yours.' : 'Seven characters, such as JA101CD.'}
            required
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={12}
            width="half"
            className="mpmb-input--upper mpmb-mono"
            value={state.code}
            onChange={(e) => dispatch({ type: 'code', code: e.target.value, returning: true })}
            error={errs['lab-code']}
          />
          <Button variant="link" onClick={() => dispatch({ type: 'code', code: '', returning: false })}>
            {firstPage ? 'I don’t have one yet' : 'I don’t remember my code'}
          </Button>
        </div>
      ) : (
        <div className="mpmb-fields">
          {!firstPage && <p>Answer these four questions as you did at the start and we will rebuild your code.</p>}
          <TextField id="lab-first-name" label="Your first name" hint="The first two letters go into your code." required autoComplete="given-name" maxLength={40} width="half" value={parts.firstName} onChange={(e) => dispatch({ type: 'code-parts', parts: { firstName: e.target.value } })} error={errs['lab-first-name']} />
          <TextField id="lab-house" label="Your house number" hint="The first digit goes into your code." required inputMode="numeric" autoComplete="off" maxLength={6} width="short" value={parts.house} onChange={(e) => dispatch({ type: 'code-parts', parts: { house: e.target.value } })} error={errs['lab-house']} />
          <SelectField id="lab-month" label="The month you were born" required options={months.map((m, i) => ({ value: String(i + 1).padStart(2, '0'), label: m }))} value={parts.month} onChange={(e) => dispatch({ type: 'code-parts', parts: { month: e.target.value } })} error={errs['lab-month']} />
          <TextField id="lab-postcode" label="Your postcode" hint="Your full UK postcode, such as LS2 9JT. The last two letters go into your code." required autoComplete="postal-code" autoCapitalize="characters" maxLength={10} width="half" className="mpmb-input--upper" value={parts.postcode} onChange={(e) => dispatch({ type: 'code-parts', parts: { postcode: e.target.value } })} onBlur={() => parts.postcode && dispatch({ type: 'code-parts', parts: { postcode: formatPostcode(parts.postcode) } })} error={errs['lab-postcode']} />
          <p className="mpmb-code-line" aria-live="polite">
            Your participant code: <strong className="mpmb-mono">{preview === '__' ? '—' : preview}</strong>
          </p>
          {errs['lab-code'] && <p className="mpmb-error">{errs['lab-code']}</p>}
          <Button variant="link" onClick={() => dispatch({ type: 'code', code: '', returning: true })}>
            {firstPage ? 'I already have my code' : 'I know my code'}
          </Button>
        </div>
      )}
    </LabShell>
  );
}
