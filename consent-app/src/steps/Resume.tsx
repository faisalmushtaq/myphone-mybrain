import { useState } from 'react';
import { getApi } from '../api';
import { ApiError } from '../api/types';
import { StepShell } from '../components/StepShell';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { DateField, TextField } from '../components/ui/Field';
import { study } from '../config/study';
import { dateOfBirthRange, partsToDate } from '../lib/dates';
import { forgetFinishReference, normaliseReference, peekFinishForYoung, peekFinishReference, REFERENCE } from '../lib/entryLink';
import type { FieldError } from '../lib/validation';
import { decidesAlone } from '../model/journey';
import type { DateParts } from '../model/types';
import { useStore } from '../state/context';
import { clearState } from '../state/persistence';

/**
 * Finishing a record sent earlier (the team chases families who have not, after the workshop too, but the wording never offers "later"):
 * the reference from the thank-you page (or the copy of the record) and the
 * young person's date of birth find it, on any device. Then only what can
 * still be added is asked: the young person's answer, if it was put off, and
 * the screenshots. Nothing already sent is shown or can be changed here.
 */
export function Resume() {
  const { state, dispatch } = useStore();
  const [reference, setReference] = useState(() => peekFinishReference());
  // The link a parent sent the young person (&for=young): it speaks to them, asks only their birthday, and goes straight to their part.
  const [forYoung] = useState(() => peekFinishForYoung() && REFERENCE.test(normaliseReference(peekFinishReference())));
  const [dob, setDob] = useState<DateParts>({ day: '', month: '', year: '' });
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const range = dateOfBirthRange(study.minAge, study.maxAge + 1);
  const found = state.resume;

  const startAgain = () => {
    forgetFinishReference();
    clearState();
    dispatch({ type: 'reset' });
  };

  const find = async () => {
    const code = normaliseReference(reference);
    const problems: FieldError[] = [];
    if (!REFERENCE.test(code)) problems.push({ field: 'resume-reference', message: 'Enter the reference as it is on your thank-you page or your copy of the record, such as MPMB-ABCD-EF2.' });
    if (!partsToDate(dob)) problems.push({ field: 'resume-dob', message: forYoung ? 'Type your birthday.' : 'Enter the young person’s date of birth.' });
    setErrors(problems);
    if (problems.length) return;
    setReference(code);
    setBusy(true);
    try {
      const api = getApi();
      let session = state.session ?? (await api.startSession());
      if (!state.session) dispatch({ type: 'session', session });
      const ask = () => api.resumeLookup(session, { referenceCode: code, dateOfBirth: dob });
      const summary = await ask().catch(async (error: unknown) => {
        if (!(error instanceof ApiError && error.code === 'expired')) throw error;
        session = await api.startSession();
        dispatch({ type: 'session', session });
        return ask();
      });
      forgetFinishReference();
      dispatch({ type: 'resume-found', summary, dateOfBirth: dob });
      // Sent to the young person for their part: straight to it, without the "we found your record" page.
      if (forYoung && summary.canAgree) dispatch({ type: 'next' });
    } catch (error) {
      const message = error instanceof ApiError && error.code === 'validation' ? (forYoung ? 'That birthday doesn’t match. Check it, or ask the person who sent you the link.' : error.message) : 'We could not check the reference just now. Check your connection and try again.';
      setErrors([{ field: forYoung ? 'resume-dob' : 'resume-reference', message }]);
    } finally {
      setBusy(false);
    }
  };

  if (found) {
    const name = state.identity.firstName.trim() || 'the young person';
    const alone = decidesAlone(state);
    if (!found.canAgree && !found.canAddScreenshots) {
      return (
        <StepShell kicker="Carry on" title="There is nothing to add." hideBack hideContinue secondaryAction={<Button variant="secondary" onClick={startAgain}>Back to the start</Button>}>
          <Callout tone="info">
            <p>
              {found.reason === 'declined'
                ? `${name} said no to sharing their screen time, so nothing more is needed from this record. If they have changed their mind, email ${study.contact.email} quoting reference ${found.referenceCode}.`
                : found.reason === 'full'
                  ? `We have all the screenshots we can take for this record (reference ${found.referenceCode}). Thank you.`
                  : found.reason === 'unfinished'
                    ? `This record was saved before the parent or carer said whether to share ${name}’s screen time. To add it, email ${study.contact.email} quoting reference ${found.referenceCode}, and the team will help.`
                    : `This record does not include screen time: the parent or carer said no to sharing it, or chose the questions instead. To change that, email ${study.contact.email} quoting reference ${found.referenceCode}.`}
            </p>
          </Callout>
        </StepShell>
      );
    }
    const next = found.canAgree
      ? alone
        ? 'Next, you decide whether to share your screen time.'
        : `Next, ${name} decides whether to share their screen time: their parent or carer has already said yes. If someone else is holding this phone or computer, please hand it to ${name}.`
      : found.phoneSource === 'parent'
        ? `Next, add ${name}’s screenshots from your phone (Apple Family Sharing or Google Family Link).`
        : `Next, add the screenshots of ${name}’s screen time. ${name} has already said yes to sharing it.`;
    return (
      <StepShell kicker="Carry on" title="We found your record." intro={<p>Reference {found.referenceCode}. {next}</p>} onContinue={() => dispatch({ type: 'next' })} continueLabel={found.canAgree ? (alone ? 'Continue' : `Continue to ${name}’s part`) : 'Add the screenshots'} hideBack>
        <p className="mpmb-hint">
          What you sent before stays as it is; this only adds to it. {found.imageCount > 0 ? `${found.imageCount} screenshot${found.imageCount === 1 ? ' was' : 's were'} sent before.` : ''}
        </p>
        <Button variant="link" onClick={startAgain}>
          Not your record? Start again
        </Button>
      </StepShell>
    );
  }

  if (forYoung) {
    return (
      <StepShell
        kicker="Your part"
        title="Hi! It’s your turn."
        intro={
          <>
            <p>MyPhone/MyBrain is a University of Leeds study at your school, about how young people use their phones. Your parent or carer has done their part.</p>
            <p>Type your birthday so we know it’s you. Then you decide whether to share your screen time. It’s up to you.</p>
          </>
        }
        errors={errors}
        onContinue={() => void find()}
        continueLabel="Carry on"
        continueLoading={busy}
        secondaryAction={
          <Button variant="link" onClick={startAgain}>
            Not you? Start a new form
          </Button>
        }
        hideBack
      >
        <DateField id="resume-dob" label="Your date of birth" hint="So we know it’s you." value={dob} onChange={setDob} error={errs['resume-dob']} autofill="self" min={range.min} max={range.max} />
        <p className="mpmb-hint">Reference {normaliseReference(reference)}.</p>
      </StepShell>
    );
  }

  return (
    <StepShell
      kicker="Carry on"
      title="Carry on with your reference."
      intro={<p>Started this form but didn’t finish? Add the young person’s part, or the screenshots, here.</p>}
      errors={errors}
      onContinue={() => void find()}
      continueLabel="Find my record"
      continueLoading={busy}
      secondaryAction={
        <Button variant="link" onClick={startAgain}>
          Start a new form instead
        </Button>
      }
      hideBack
    >
      <div className="mpmb-fields">
        <TextField
          id="resume-reference"
          label="Your reference"
          hint="On your thank-you page and your copy of the record. It looks like MPMB-ABCD-EF2."
          required
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={20}
          width="half"
          className="mpmb-input--upper mpmb-mono"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          onBlur={() => reference.trim() && setReference(normaliseReference(reference))}
          error={errs['resume-reference']}
        />
        <DateField id="resume-dob" label="The young person’s date of birth" hint="To check it is your record." value={dob} onChange={setDob} error={errs['resume-dob']} autofill="off" min={range.min} max={range.max} />
      </div>
      <p className="mpmb-hint">No reference? Just start a new form: it takes about five minutes. Or email {study.contact.email} and the team will help.</p>
    </StepShell>
  );
}
