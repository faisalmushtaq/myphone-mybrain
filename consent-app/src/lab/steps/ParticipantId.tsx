import { useState } from 'react';
import { getApi } from '../../api';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { DateField, TextField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import { formatTimestamp, isoYearsAgo } from '../../lib/dates';
import { describeError, labSession } from '../api';
import { ageFrom, buildParticipantId, formatPostcode, idName, isoDateOf, isUkPostcode, labPages, labStudy } from '../config';
import { LabShell } from '../LabShell';
import { namesOf } from '../PlatformChecklist';
import { nextFilesStep, phaseHave, platformsToDo, resumeStep } from '../reducer';
import { useLab } from '../store';
import type { FieldError } from '../validation';
import { filesPhrase } from '../words';

const words = {
  baseline: {
    kicker: 'About you',
    title: 'Tell us who you are.',
    lead: 'Your first name, last name, date of birth and postcode make your participant ID: the label on everything you send, instead of your name. The study’s questionnaire asks for the same four details, so your answers there and your data here can be matched.',
    leadKnown: 'Your participant ID is the label on everything you send, instead of your name.',
  },
  checkin: {
    kicker: 'Mid-break check-in',
    title: 'Your mid-break check-in.',
    lead: 'A few quick questions about how your break is going: about two minutes. First, enter the details you gave at the start so we can find your record. You gave your consent then, so there is nothing to sign.',
    leadKnown: 'A few quick questions about how your break is going: about two minutes. You gave your consent at the start, so there is nothing to sign.',
  },
  after: {
    kicker: 'After your break',
    title: 'Welcome back after your break.',
    lead: 'This part is shorter: a reminder of what you agreed to, then your screen-time screenshots and app data again, from after the break. First, enter the details you gave at the start so we can find your record. There is nothing to sign.',
    leadKnown: 'This part is shorter: a reminder of what you agreed to, then your screen-time screenshots and app data again, from after the break. There is nothing to sign.',
  },
} as const;

/**
 * Who the person is: four details they always know, from which the
 * participant ID is built exactly as the study's survey platform builds it
 * (see PARTICIPANT_CODE in ../config). The same details find the person again
 * on any device, so nobody has to remember a code; a link from a progress
 * email, or this device, can also carry the ID, and then one press confirms
 * it. The server then says what it already holds, so the person carries on
 * where they left off.
 */
export function ParticipantId() {
  const { state, dispatch } = useLab();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState(false);
  // No consent on file: for four details nobody signed up with, or for an ID from a link or this device (then the details are asked instead).
  const [notFound, setNotFound] = useState<null | { kind: 'details' } | { kind: 'id'; id: string }>(null);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const parts = state.codeParts;
  const firstPage = state.flow === 'baseline';
  // An ID this device remembers, or one a link carried: confirmed with one press.
  const known = state.returning && Boolean(state.code);
  const text = words[state.flow];
  const dob = isoDateOf(parts.dateOfBirth);
  const age = dob ? ageFrom(dob) : null;

  const validateDetails = (): FieldError[] => {
    const found: FieldError[] = [];
    if (!idName(parts.firstName)) found.push({ field: 'lab-first-name', message: 'Enter your first name.' });
    if (!idName(parts.lastName)) found.push({ field: 'lab-last-name', message: 'Enter your last name.' });
    const typedSome = Boolean(parts.dateOfBirth.day || parts.dateOfBirth.month || parts.dateOfBirth.year);
    if (!dob) found.push({ field: 'lab-dob', message: typedSome ? 'Enter a real date of birth, such as 14 3 2005.' : 'Enter your date of birth.' });
    else if (age !== null && age < labStudy.minAge) found.push({ field: 'lab-dob', message: `This study is for adults: you need to be ${labStudy.minAge} or over to take part.` });
    else if (age !== null && age > 110) found.push({ field: 'lab-dob', message: 'Check the year of your date of birth.' });
    if (!parts.postcode.trim()) found.push({ field: 'lab-postcode', message: 'Enter your postcode.' });
    else if (!isUkPostcode(parts.postcode)) found.push({ field: 'lab-postcode', message: 'Enter a full UK postcode, such as LS2 9JT.' });
    return found;
  };

  const next = async () => {
    setNotFound(null);
    const found = known ? [] : validateDetails();
    setErrors(found);
    if (found.length) return;
    setBusy(true);
    try {
      const code = known ? state.code : await buildParticipantId(parts);
      if (!code) throw new Error('Your details could not be turned into a participant ID.');
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      const lookup = await getApi().lookupLabParticipant(session, code);
      if (!lookup.exists) {
        // Signing up needs the four details themselves (they are kept with the consent), so an ID alone cannot start the study.
        if (known) {
          setNotFound({ kind: 'id', id: code });
          dispatch({ type: 'code', code: '', returning: false });
          return;
        }
        if (!firstPage) {
          setNotFound({ kind: 'details' });
          return;
        }
        dispatch({ type: 'confirm-code', code, returning: false, lookup });
        dispatch({ type: 'go-to', stepId: 'information' });
        return;
      }
      dispatch({ type: 'confirm-code', code, returning: known, lookup });
      if (firstPage) {
        setWelcome(true);
        announce('We already have your consent. You can carry on where you left off.');
        return;
      }
      dispatch({ type: 'go-to', stepId: resumeStep({ ...state, progress: lookup }) });
    } catch (error) {
      setErrors([{ field: known ? 'lab-known' : 'lab-first-name', message: describeError(error, 'your details') }]);
    } finally {
      setBusy(false);
    }
  };

  const contact = (
    <>
      {labStudy.contact.name} at <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a>
    </>
  );

  // The first page, for someone whose consent is already on file: what has arrived, and the next thing to do.
  if (firstPage && (welcome || (state.codeConfirmed && state.submission.consentOnFile && state.stepId === 'participant-id'))) {
    const when = state.progress?.consentedAt ?? state.submission.consentSentAt;
    const have = phaseHave(state);
    const nextStep = nextFilesStep(state);
    return (
      <LabShell kicker="About you" title="Welcome back." hideContinue hideBack>
        <Callout tone="success" role="status">
          <p>
            We already have your consent{when ? `, recorded ${formatTimestamp(when)}` : ''}. Received from you so far: <strong>{filesPhrase(have)}</strong>.
          </p>
        </Callout>
        <p>{nextStep === 'screenshots' ? 'Next: your screen-time screenshots. They take a few minutes and go to the team straight away.' : nextStep === 'guide' ? `Next: your app data. Still to do: ${namesOf(platformsToDo(state))}. Request the download, or if it has arrived, clean it and send it.` : nextStep === 'send' ? 'Next: send the files you prepared on this device.' : 'Everything the study needs from before your break is in. You can add more files if you like.'}</p>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => dispatch({ type: 'go-to', stepId: nextStep === 'done' ? 'screenshots' : nextStep })}>
            {nextStep === 'screenshots' ? 'Continue: my screenshots' : nextStep === 'guide' ? 'Continue: my app data' : nextStep === 'send' ? 'Continue: send my data' : 'Add more files'}
          </Button>
        </div>
        {nextStep === 'done' && (
          <p className="mpmb-hint">
            During your break, use the <a href={labPages.checkin.path}>mid-break check-in</a>; when it ends, send your data again on the <a href={labPages.after.path}>after-break page</a>.
          </p>
        )}
        <p className="mpmb-hint">
          Your participant ID is <strong className="mpmb-mono">{state.code}</strong>. Don’t recognise any of this? If you have never signed up for this study, someone may have used your details: contact {contact}.
        </p>
      </LabShell>
    );
  }

  return (
    <LabShell kicker={text.kicker} title={text.title} intro={<p>{known ? text.leadKnown : text.lead}</p>} errors={errors} onContinue={() => void next()} continueLoading={busy} hideBack={!firstPage}>
      {notFound?.kind === 'details' && (
        <Callout tone="important" role="alert">
          <p>
            <strong>We could not find anyone who signed up with these details.</strong> Check they are exactly as you gave them at the start: the same spelling of your first and last name, your date of birth, and the postcode you gave then, even if you have moved since. If you have not signed up yet, <a href={labPages.baseline.path}>start on the first page</a>. Stuck? Contact {contact}.
          </p>
        </Callout>
      )}
      {notFound?.kind === 'id' && (
        <Callout tone="important" role="alert">
          <p>
            We have no consent on file for participant ID <strong className="mpmb-mono">{notFound.id}</strong>. Enter your details below instead{firstPage ? ' to sign up' : ''}. Stuck? Contact {contact}.
          </p>
        </Callout>
      )}
      {known ? (
        <div className="mpmb-fields" id="lab-known" tabIndex={-1}>
          <p className="mpmb-code-line">
            Your participant ID: <strong className="mpmb-mono">{state.code}</strong>
          </p>
          <p className="mpmb-hint">Filled in from your link or from this device. Press Continue if it is yours.</p>
          <Button variant="link" onClick={() => dispatch({ type: 'code', code: '', returning: false })}>
            Not mine: enter my details instead
          </Button>
        </div>
      ) : (
        <div className="mpmb-fields">
          <TextField id="lab-first-name" label="First name" hint="As on official documents, not a nickname. Just your first name, no middle names." required autoComplete="given-name" maxLength={60} width="half" value={parts.firstName} onChange={(e) => dispatch({ type: 'code-parts', parts: { firstName: e.target.value } })} error={errs['lab-first-name']} />
          <TextField id="lab-last-name" label="Last name" required autoComplete="family-name" maxLength={60} width="half" value={parts.lastName} onChange={(e) => dispatch({ type: 'code-parts', parts: { lastName: e.target.value } })} error={errs['lab-last-name']} />
          <DateField id="lab-dob" label="Date of birth" value={parts.dateOfBirth} onChange={(dateOfBirth) => dispatch({ type: 'code-parts', parts: { dateOfBirth } })} error={errs['lab-dob']} autofill="self" min={isoYearsAgo(100)} max={isoYearsAgo(labStudy.minAge)} />
          <TextField
            id="lab-postcode"
            label="Postcode"
            hint={firstPage ? 'Where you live now, such as LS2 9JT.' : 'The postcode you gave at the start, even if you have moved since.'}
            required
            autoComplete="postal-code"
            autoCapitalize="characters"
            maxLength={10}
            width="half"
            className="mpmb-input--upper"
            value={parts.postcode}
            onChange={(e) => dispatch({ type: 'code-parts', parts: { postcode: e.target.value } })}
            onBlur={() => parts.postcode && dispatch({ type: 'code-parts', parts: { postcode: formatPostcode(parts.postcode) } })}
            error={errs['lab-postcode']}
          />
          {firstPage && age !== null && age > labStudy.maxAge && (
            <Callout tone="info">
              <p>
                This study is for people aged {labStudy.minAge} to {labStudy.maxAge}. If you are older, please check with {contact} before you carry on.
              </p>
            </Callout>
          )}
          <p className="mpmb-hint">{firstPage ? 'Use exactly the same details whenever you come back, and in the questionnaire, so everything matches up. Started already? Enter the same details and you will carry on where you left off.' : 'Your details are only used to find your record.'}</p>
        </div>
      )}
    </LabShell>
  );
}
