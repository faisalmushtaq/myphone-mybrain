import { useState } from 'react';
import { getApi } from '../../api';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { ChoiceField, FieldWrapper } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import { describeError, labClientInfo, labSession } from '../api';
import { labCheckInForm, labStudy } from '../config';
import { LabShell } from '../LabShell';
import { ShotPicker } from '../ShotPicker';
import { useLab } from '../store';
import { useLabSender } from '../useLabSender';
import type { FieldError } from '../validation';

/**
 * The mid-break check-in: a few quick questions and, if the person can, a
 * screenshot of this week's screen time. The answers are filed under the
 * participant code; the screenshots go with them, linked to the check-in.
 */
export function LabCheckIn() {
  const { state, dispatch } = useLab();
  const { send, busy: sending } = useLabSender();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const ready = state.codeConfirmed && state.submission.consentStage === 'sent';
  const answers = state.checkIn.answers;
  const pending = state.screenshots.filter((s) => s.status !== 'sent');
  const answered = Boolean(state.checkIn.checkInId);

  const validate = (): FieldError[] => {
    const found: FieldError[] = [];
    for (const q of labCheckInForm.questions) {
      const value = (answers[q.id] ?? '').trim();
      if (q.required && !value) found.push({ field: q.type === 'choice' ? `lab-q-${q.id}-${q.options[0].value}` : `lab-q-${q.id}`, message: `Please answer: ${q.text}` });
      if (q.type === 'text' && value.length > q.maxLength) found.push({ field: `lab-q-${q.id}`, message: `Please keep this under ${q.maxLength} characters.` });
    }
    return found;
  };

  const submit = async () => {
    setErrors([]);
    if (!answered) {
      const found = validate();
      if (found.length) {
        setErrors(found);
        return;
      }
    }
    setBusy(true);
    try {
      let checkInId = state.checkIn.checkInId;
      if (!checkInId) {
        const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
        const tidy = Object.fromEntries(labCheckInForm.questions.filter((q) => (answers[q.id] ?? '').trim()).map((q) => [q.id, (answers[q.id] ?? '').trim()]));
        const result = await getApi().submitLabCheckIn(session, { participantCode: state.code, formId: labCheckInForm.id, formVersion: labCheckInForm.version, answers: tidy, client: labClientInfo() });
        dispatch({ type: 'checkin-sent', checkInId: result.checkInId, receivedAt: result.receivedAt, count: result.count });
        checkInId = result.checkInId;
        announce('Check-in sent.');
      }
      if (pending.length) {
        const sent = await send(['screenshot'], { checkInId });
        if (!sent.ok) {
          setErrors([{ field: 'lab-files', message: `Your answers are in, but the screenshots did not go: ${sent.message ?? 'please try again.'}` }]);
          return;
        }
      }
      dispatch({ type: 'go-to', stepId: 'done' });
    } catch (error) {
      setErrors([{ field: 'lab-files', message: describeError(error, 'your check-in') }]);
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <LabShell kicker="Mid-break check-in" title="Enter your participant code first." intro={<p>Your code joins your answers up with the rest of your data.</p>} hideContinue hideBack>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => dispatch({ type: 'go-to', stepId: 'participant-id' })}>
            Enter my code
          </Button>
        </div>
      </LabShell>
    );
  }

  return (
    <LabShell
      kicker="Mid-break check-in"
      title="How is your break going?"
      intro={<p>A few quick questions about the past week. There are no right answers, and nothing here changes your payment or your place in the study.</p>}
      errors={errors}
      onContinue={() => void submit()}
      continueLabel={answered ? (pending.length ? 'Send my screenshots' : 'Continue') : 'Send my check-in'}
      continueLoading={busy || sending}
      width="wide"
    >
      {answered && (
        <Callout tone="success" role="status">
          <p>Your answers are in. {pending.length ? 'Your screenshots still need to go.' : ''}</p>
        </Callout>
      )}
      <section aria-labelledby="checkin-questions" className="mpmb-checkin">
        <h2 className="mpmb-h2" id="checkin-questions">
          1. A few questions
        </h2>
        {labCheckInForm.questions.map((q) =>
          q.type === 'choice' ? (
            <ChoiceField key={q.id} id={`lab-q-${q.id}`} name={`lab-q-${q.id}`} legend={q.text} hint={q.hint} value={answers[q.id] ?? null} onChange={(v) => !answered && dispatch({ type: 'checkin-answer', questionId: q.id, value: v })} options={q.options} error={errs[`lab-q-${q.id}-${q.options[0].value}`]} />
          ) : (
            <FieldWrapper key={q.id} id={`lab-q-${q.id}`} label={q.text} hint={q.hint} error={errs[`lab-q-${q.id}`]}>
              <textarea id={`lab-q-${q.id}`} className="mpmb-input mpmb-input--area" rows={4} maxLength={q.maxLength} value={answers[q.id] ?? ''} readOnly={answered} onChange={(e) => dispatch({ type: 'checkin-answer', questionId: q.id, value: e.target.value })} aria-describedby={q.hint ? `lab-q-${q.id}-hint` : undefined} />
            </FieldWrapper>
          ),
        )}
      </section>

      <section aria-labelledby="checkin-shots" id="lab-files" tabIndex={-1}>
        <h2 className="mpmb-h2" id="checkin-shots">
          2. This week’s screen time <span className="mpmb-optional">(if you can)</span>
        </h2>
        <p>A screenshot of your Screen Time (iPhone: Settings, Screen Time, See All App &amp; Website Activity) or Digital Wellbeing (Android: Settings, Digital Wellbeing) for the past week. The weekly chart and the list of apps are the most useful.</p>
        <ShotPicker busy={busy || sending} onAdded={() => setErrors([])} />
      </section>
      <p className="mpmb-hint">
        Sent to the study’s secure storage at the University of Leeds, labelled with your participant code <strong className="mpmb-mono">{state.code}</strong>. Problems with Brick or the break? Contact {labStudy.contact.name} at <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a>.
      </p>
    </LabShell>
  );
}
