import { useState } from 'react';
import { getApi } from '../../api';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { DateField, TextField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import { formatTimestamp, isoYearsAgo } from '../../lib/dates';
import { describeError, labSession } from '../api';
import { ageFrom, buildParticipantId, formatPostcode, idName, isoDateOf, isUkPostcode, labPages, labStudy, normaliseParticipantCode, PARTICIPANT_CODE } from '../config';
import { LabShell } from '../LabShell';
import { namesOf } from '../PlatformChecklist';
import { nextFilesStep, phaseHave, platformsToDo, resumeStep } from '../reducer';
import { useLab } from '../store';
import { ukMobile, type FieldError } from '../validation';
import { filesPhrase } from '../words';

const words = {
  baseline: {
    kicker: 'About you',
    title: 'Tell us who you are.',
    lead: 'Your first name, last name, date of birth and postcode make your participant ID: the label on everything you send, instead of your name. The study’s questionnaire asks for the same four details, so your answers there and your data here can be matched. We also ask for your mobile number, so the team can contact you.',
    leadKnown: 'Your participant ID is the label on everything you send, instead of your name.',
  },
  checkin: {
    kicker: 'Mid-break check-in',
    title: 'Your mid-break check-in.',
    lead: 'A few quick questions about how your break is going: about two minutes. First, enter the details you gave at the start, or your participant ID, so we can find your record. You gave your consent then, so there is nothing to sign.',
    leadKnown: 'A few quick questions about how your break is going: about two minutes. You gave your consent at the start, so there is nothing to sign.',
  },
  after: {
    kicker: 'After your break',
    title: 'Welcome back after your break.',
    lead: 'This part is shorter: a reminder of what you agreed to, then your screen-time screenshots and app data again, from after the break. First, enter the details you gave at the start, or your participant ID, so we can find your record. There is nothing to sign.',
    leadKnown: 'This part is shorter: a reminder of what you agreed to, then your screen-time screenshots and app data again, from after the break. There is nothing to sign.',
  },
  book: {
    kicker: 'Your lab visits',
    title: 'Book or change your lab visits.',
    lead: 'Choose a time for each of your two lab visits, or change or cancel the ones you booked. First, enter your participant ID (it is in our emails) or the details you gave at the start, so we can find your record.',
    leadKnown: 'Choose a time for each of your two lab visits, or change or cancel the ones you booked.',
  },
  story: {
    kicker: 'MyStory',
    title: 'MyStory.',
    lead: 'A few minutes, in your own words. First, enter the details you gave at the start, or your participant ID, so your story joins up with the rest of your data, labelled with your participant ID, not your name.',
    leadKnown: 'A few minutes, in your own words. Your story is labelled with your participant ID, not your name.',
  },
} as const;

/**
 * Who the person is: four details they always know, from which the
 * participant ID is built exactly as the study's survey platform builds it
 * (see PARTICIPANT_CODE in ../config). The same details find the person again
 * on any device, so nobody has to remember a code; someone who has their ID
 * (it is in every email) can type it instead, for example to change their
 * lab visits; a link from an email, or this device, can also carry the ID,
 * and then one press confirms it. The server then says what it already
 * holds, so the person carries on where they left off. Signing up needs the
 * four details themselves.
 */
export function ParticipantId() {
  const { state, dispatch } = useLab();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState(false);
  // No consent on file: for four details nobody signed up with, or for an ID from a link or this device (then the details are asked instead).
  const [notFound, setNotFound] = useState<null | { kind: 'details' } | { kind: 'id'; id: string }>(null);
  // Signing in with the participant ID, typed, instead of the four details.
  const [byId, setById] = useState(false);
  const [typedId, setTypedId] = useState('');
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const parts = state.codeParts;
  const firstPage = state.flow === 'baseline';
  // First page, "Already started?": the details (or the ID) find the record; nobody is signed up from here, and the mobile number given at sign-up is not asked again.
  const carryingOn = firstPage && state.carryOn;
  const signingUp = firstPage && !state.carryOn;
  // An ID this device remembers, or one a link carried: confirmed with one press.
  const known = state.returning && Boolean(state.code);
  const text = carryingOn
    ? { kicker: 'Welcome back', title: 'Carry on where you left off.', lead: 'Enter the same details you gave at the start, or your participant ID (it is in our emails). You carry on from where you stopped, on any device.', leadKnown: 'Press Continue if this is your participant ID: you carry on from where you stopped.' }
    : words[state.flow];
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
    // Signing up also asks for a mobile number (decided 7 October 2026): not part of the ID, but the team needs it to contact people.
    if (signingUp && !state.booking.mobile.trim()) found.push({ field: 'lab-mobile-start', message: 'Enter your mobile number, so the team can contact you.' });
    else if (signingUp && !ukMobile(state.booking.mobile)) found.push({ field: 'lab-mobile-start', message: 'Enter a UK mobile number, such as 07700 900123.' });
    return found;
  };

  const validateTypedId = (): FieldError[] => {
    if (!typedId.trim()) return [{ field: 'lab-id', message: 'Enter your participant ID.' }];
    if (!PARTICIPANT_CODE.test(normaliseParticipantCode(typedId))) return [{ field: 'lab-id', message: 'Enter your participant ID as it is in our emails: MP and then 12 letters and numbers, such as MP2670FF90A5F2.' }];
    return [];
  };

  const switchTo = (id: boolean) => {
    setById(id);
    setErrors([]);
    setNotFound(null);
  };

  const next = async () => {
    setNotFound(null);
    const typed = !known && byId;
    const found = known ? [] : typed ? validateTypedId() : validateDetails();
    setErrors(found);
    if (found.length) return;
    setBusy(true);
    try {
      const code = known ? state.code : typed ? normaliseParticipantCode(typedId) : await buildParticipantId(parts);
      if (!code) throw new Error('Your details could not be turned into a participant ID.');
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      const lookup = await getApi().lookupLabParticipant(session, code);
      if (!lookup.exists) {
        // Signing up needs the four details themselves (they are kept with the consent), so an ID alone cannot start the study.
        if (known || typed) {
          setNotFound({ kind: 'id', id: code });
          if (known) dispatch({ type: 'code', code: '', returning: false });
          return;
        }
        if (!signingUp) {
          setNotFound({ kind: 'details' });
          return;
        }
        // Signing up: the date of birth must be in the study's age range. Checked only now, for someone new, so a participant who has turned 22 since signing up still gets in.
        if (age !== null && age > labStudy.maxAge) {
          setErrors([{ field: 'lab-dob', message: `This study is for people aged ${labStudy.minAge} to ${labStudy.maxAge}, so you can’t sign up. Thank you for your interest.` }]);
          return;
        }
        dispatch({ type: 'confirm-code', code, returning: false, lookup });
        dispatch({ type: 'go-to', stepId: 'information' });
        return;
      }
      dispatch({ type: 'confirm-code', code, returning: known || typed, lookup });
      if (firstPage) {
        setWelcome(true);
        announce('We already have your consent. You can carry on where you left off.');
        return;
      }
      dispatch({ type: 'go-to', stepId: resumeStep({ ...state, progress: lookup }) });
    } catch (error) {
      setErrors([{ field: known ? 'lab-known' : typed ? 'lab-id' : 'lab-first-name', message: describeError(error, typed ? 'your participant ID' : 'your details') }]);
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
            <strong>We could not find anyone who signed up with these details.</strong> Check they are exactly as you gave them at the start: the same spelling of your first and last name, your date of birth, and the postcode you gave then, even if you have moved since.{' '}
            {carryingOn ? (
              <>
                Not signed up yet?{' '}
                <Button
                  variant="link"
                  onClick={() => {
                    setNotFound(null);
                    dispatch({ type: 'carry-on', on: false });
                  }}
                >
                  Sign up with these details
                </Button>
              </>
            ) : (
              <>
                If you have not signed up yet, <a href={labPages.baseline.path}>start on the first page</a>.
              </>
            )}{' '}
            Stuck? Contact {contact}.
          </p>
        </Callout>
      )}
      {notFound?.kind === 'id' && (
        <Callout tone="important" role="alert">
          {byId ? (
            <p>
              We could not find anyone with participant ID <strong className="mpmb-mono">{notFound.id}</strong>. Check it against the emails we sent you, or use your details instead{signingUp ? ', which is also how you sign up' : ''}. Stuck? Contact {contact}.
            </p>
          ) : (
            <p>
              We have no consent on file for participant ID <strong className="mpmb-mono">{notFound.id}</strong>. Enter your details below instead{signingUp ? ' to sign up' : ''}. Stuck? Contact {contact}.
            </p>
          )}
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
      ) : byId ? (
        <div className="mpmb-fields">
          <TextField
            id="lab-id"
            label="Participant ID"
            hint="MP and then 12 letters and numbers, such as MP2670FF90A5F2. It is in every email we have sent you."
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={24}
            width="half"
            className="mpmb-input--upper mpmb-mono"
            value={typedId}
            onChange={(e) => setTypedId(e.target.value)}
            onBlur={() => typedId.trim() && setTypedId(normaliseParticipantCode(typedId))}
            error={errs['lab-id']}
          />
          <Button variant="link" onClick={() => switchTo(false)}>
            Use my details instead
          </Button>
        </div>
      ) : (
        <div className="mpmb-fields">
          <p className="mpmb-hint mpmb-id-switch">
            {signingUp ? 'Already taking part and have your participant ID?' : 'Have your participant ID? It is in our emails.'}{' '}
            <Button variant="link" onClick={() => switchTo(true)}>
              Use my participant ID instead
            </Button>
          </p>
          <TextField id="lab-first-name" label="First name" hint="As on official documents, not a nickname. Just your first name, no middle names." required autoComplete="given-name" maxLength={60} width="half" value={parts.firstName} onChange={(e) => dispatch({ type: 'code-parts', parts: { firstName: e.target.value } })} error={errs['lab-first-name']} />
          <TextField id="lab-last-name" label="Last name" required autoComplete="family-name" maxLength={60} width="half" value={parts.lastName} onChange={(e) => dispatch({ type: 'code-parts', parts: { lastName: e.target.value } })} error={errs['lab-last-name']} />
          <DateField id="lab-dob" label="Date of birth" value={parts.dateOfBirth} onChange={(dateOfBirth) => dispatch({ type: 'code-parts', parts: { dateOfBirth } })} error={errs['lab-dob']} autofill="self" min={isoYearsAgo(100)} max={isoYearsAgo(labStudy.minAge)} />
          <TextField
            id="lab-postcode"
            label="Postcode"
            hint={signingUp ? 'Where you live now, such as LS2 9JT.' : 'The postcode you gave at the start, even if you have moved since.'}
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
          {signingUp && (
            <TextField
              id="lab-mobile-start"
              label="Mobile number"
              hint="A UK mobile, so the team can contact you about the study. It is not part of your participant ID."
              required
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              maxLength={30}
              width="half"
              value={state.booking.mobile}
              onChange={(e) => dispatch({ type: 'booking-contact', patch: { mobile: e.target.value } })}
              error={errs['lab-mobile-start']}
            />
          )}
          {signingUp ? (
            <p className="mpmb-hint">
              Use exactly the same details whenever you come back, and in the questionnaire, so everything matches up.{' '}
              <Button variant="link" onClick={() => dispatch({ type: 'carry-on', on: true })}>
                Already started? Carry on where you left off
              </Button>
            </p>
          ) : (
            <p className="mpmb-hint">{carryingOn ? 'Use exactly the details you gave at the start: the postcode then, even if you have moved since.' : 'Your details are only used to find your record.'}</p>
          )}
        </div>
      )}
    </LabShell>
  );
}
