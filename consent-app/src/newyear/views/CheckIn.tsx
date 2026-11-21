import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { ErrorSummary } from '../../components/ui/ErrorSummary';
import { ChoiceField, FieldWrapper, TextField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import type { FieldError } from '../../lib/validation';
import { isSlip, LIMITS, MOOD_LABELS, STATUS_OPTIONS, URGE_LABELS, type CheckStatus } from '../config';
import { addDays, formatDay, relativeDay, type IsoDate } from '../dates';
import { newId } from '../device';
import { NyShell } from '../NyShell';
import { useNy } from '../store';
import { summarise } from '../summary';
import { aimText, hasChosen, urgeObject } from '../targets';

interface ScaleProps {
  id: string;
  legend: string;
  hint?: string;
  labels: readonly string[];
  value: number | null;
  onChange: (value: number) => void;
  error?: string;
}

/** A 1 to 5 scale as five big radio buttons, each with its number and its words. */
export function Scale({ id, legend, hint, labels, value, onChange, error }: ScaleProps) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <fieldset className={`mpmb-choice ny-scale${error ? ' has-error' : ''}`} id={`${id}-group`}>
      <legend className="mpmb-choice__legend ny-legend">{legend}</legend>
      {hint && (
        <p className="mpmb-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="mpmb-error" id={`${id}-error`}>
          <span className="mpmb-sr-only">Error: </span>
          {error}
        </p>
      )}
      <div className="ny-scale__options">
        {labels.map((label, i) => {
          const v = i + 1;
          const optionId = `${id}-${v}`;
          return (
            <label key={v} className={`mpmb-choice__option ny-scale__option${value === v ? ' is-selected' : ''}`} htmlFor={optionId}>
              <input id={optionId} type="radio" name={id} value={v} checked={value === v} onChange={() => onChange(v)} className="mpmb-choice__input" aria-describedby={describedBy} aria-invalid={error ? true : undefined} />
              <span className="mpmb-choice__dot" aria-hidden="true" />
              <span className="ny-scale__n" aria-hidden="true">
                {v}
              </span>
              <span className="ny-scale__label">{label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * The check-in, any time, as often as people like, whatever happened before
 * (the PI, 20 November 2026: "even if they've lapsed"). It is about the time
 * since the last check-in: still going strong, slipped (and when), or stopped
 * for now; then mood and urge, and an optional note.
 */
export function CheckIn() {
  const { state, dispatch, today } = useNy();
  const s = useMemo(() => summarise(state, today), [state, today]);
  const [status, setStatus] = useState<CheckStatus | null>(null);
  const [slipDate, setSlipDate] = useState<IsoDate>(today);
  const [minutes, setMinutes] = useState('');
  const [mood, setMood] = useState<number | null>(null);
  const [urge, setUrge] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [attempt, setAttempt] = useState(0);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const fixed = (field: string) => setErrors((now) => now.filter((e) => e.field !== field));
  if (!s) return null;
  const p = s.participant;
  const before = s.phase === 'before';
  // The period this check-in is about: since the last one, or since the start.
  const since = s.lastCheckIn && s.lastCheckIn.date >= p.startDate ? s.lastCheckIn.date : p.startDate;
  const sinceText = s.lastCheckIn && s.lastCheckIn.date >= p.startDate ? `since your last check-in (${relativeDay(since, today)})` : 'since your break started';
  const what = aimText(p);
  const slipped = status !== null && isSlip(status);
  const slipDays: IsoDate[] = [];
  for (let d = today; d >= since && d >= p.startDate && slipDays.length < 14; d = addDays(d, -1)) slipDays.push(d);

  const validate = (): FieldError[] => {
    const found: FieldError[] = [];
    if (!before && !status) found.push({ field: 'ny-status-on-track', message: 'Please say how it has been going.' });
    if (slipped && minutes.trim() && !(/^\d{1,4}$/.test(minutes.trim()) && Number(minutes) <= LIMITS.minutes)) found.push({ field: 'ny-minutes', message: 'Please give the minutes as a whole number, up to 1440, or leave it blank.' });
    if (!mood) found.push({ field: 'ny-mood-1', message: 'Please choose how your mood is, from 1 to 5.' });
    if (!urge) found.push({ field: 'ny-urge-1', message: `Please choose how much you want to use ${urgeObject(p)}, from 1 to 5.` });
    return found;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempt((a) => a + 1);
    const found = validate();
    setErrors(found);
    if (found.length || !mood || !urge) return;
    const st: CheckStatus = before ? 'on-track' : (status ?? 'on-track');
    dispatch({
      type: 'check-in',
      checkIn: { id: newId(), date: today, at: new Date().toISOString(), status: st, slipDate: isSlip(st) ? slipDate : null, minutes: isSlip(st) && minutes.trim() ? Number(minutes) : null, mood, urge, note: note.trim().slice(0, LIMITS.note) },
    });
    announce('Check-in saved.');
  };

  return (
    <NyShell kicker="Check-in" title="How are you getting on?" pageTitle="Check-in" intro={<p>A minute or so, as often as you like. There are no wrong answers: an honest answer helps more than a perfect one.</p>}>
      <form className="ny-form ny-checkin" onSubmit={submit} noValidate>
        <ErrorSummary errors={errors} focusKey={attempt} />
        {!before && (
          <ChoiceField
            id="ny-status"
            name="ny-status"
            legend={<span className="ny-legend">Have you stayed {what} {sinceText}?</span>}
            value={status}
            onChange={(v) => {
              setStatus(v as CheckStatus);
              fixed('ny-status-on-track');
            }}
            options={STATUS_OPTIONS}
            error={errs['ny-status-on-track']}
          />
        )}
        {slipped && (
          <>
            <ChoiceField id="ny-slipday" name="ny-slipday" legend={<span className="ny-legend">When was the {status === 'lot' ? '' : 'last '}slip?</span>} hint="If there was more than one, choose the most recent." value={slipDate} onChange={(v) => setSlipDate(v)} options={slipDays.map((d) => ({ value: d, label: `${relativeDay(d, today).replace(/^./, (c) => c.toUpperCase())}${d === today || relativeDay(d, today) === 'yesterday' ? `, ${formatDay(d, 'no-year')}` : ''}` }))} />
            <TextField id="ny-minutes" label={`Roughly how many minutes ${hasChosen(p) ? `on ${urgeObject(p)}` : 'over your limit'}, that day?`} hint="A rough guess is fine. Leave it blank if you’re not sure." tag="(optional)" inputMode="numeric" pattern="[0-9]*" autoComplete="off" width="short" value={minutes} maxLength={4} onChange={(e) => { setMinutes(e.target.value); fixed('ny-minutes'); }} error={errs['ny-minutes']} />
            <p className="ny-note">Slips happen to most people. Your days off so far still count, and you can carry straight on.</p>
          </>
        )}
        {status === 'stopped' && <p className="ny-note">That’s fine. Check in again whenever you restart, or end your break from your tracker when you’re ready. Every answer helps the research, including this one.</p>}
        <Scale id="ny-mood" legend="How is your mood right now?" labels={MOOD_LABELS} value={mood} onChange={(v) => { setMood(v); fixed('ny-mood-1'); }} error={errs['ny-mood-1']} />
        <Scale id="ny-urge" legend={`How much do you want to use ${urgeObject(p)} right now?`} labels={URGE_LABELS} value={urge} onChange={(v) => { setUrge(v); fixed('ny-urge-1'); }} error={errs['ny-urge-1']} />
        <FieldWrapper id="ny-note" label="Anything you’d like to note?" tag="(optional)" hint="Just for the research. Notes are never shown on the leaderboard, and nobody reads them as they come in." error={errs['ny-note']}>
          <textarea id="ny-note" className="mpmb-input mpmb-input--area" rows={3} maxLength={LIMITS.note} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby="ny-note-hint ny-note-count" />
          <p className="mpmb-hint ny-count" id="ny-note-count">
            {note.length} of {LIMITS.note} characters
          </p>
        </FieldWrapper>
        <div className="mpmb-actions">
          <Button type="submit" variant="primary" arrow>
            Save my check-in
          </Button>
          <Button variant="ghost" onClick={() => dispatch({ type: 'go', route: { view: 'tracker' } })}>
            Cancel
          </Button>
        </div>
      </form>
    </NyShell>
  );
}
