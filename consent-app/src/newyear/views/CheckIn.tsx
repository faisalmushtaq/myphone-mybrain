import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { ErrorSummary } from '../../components/ui/ErrorSummary';
import { ChoiceField, FieldWrapper, TextField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import type { FieldError } from '../../lib/validation';
import { CRAVING_LABELS, KEPT_OPTIONS, LIMITS, MOOD_LABELS } from '../config';
import { formatDay, relativeDay, type IsoDate } from '../dates';
import { NyShell } from '../NyShell';
import { useNy } from '../store';
import type { KeptAnswer } from '../streaks';
import { summarise } from '../summary';

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
function Scale({ id, legend, hint, labels, value, onChange, error }: ScaleProps) {
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

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The daily check-in: did you stay off your apps, roughly how long if not, mood, cravings and an optional note. */
export function CheckIn() {
  const { state, dispatch, today } = useNy();
  const summary = useMemo(() => summarise(state, today), [state, today]);
  const open = summary?.openDays ?? [];
  const [day, setDay] = useState<IsoDate>(open[0] ?? '');
  const [kept, setKept] = useState<KeptAnswer | null>(null);
  const [minutes, setMinutes] = useState('');
  const [mood, setMood] = useState<number | null>(null);
  const [craving, setCraving] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [attempt, setAttempt] = useState(0);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const back = () => dispatch({ type: 'go', route: { view: 'tracker' } });
  /** A problem disappears as soon as its question is answered; the rest stay until the next try. */
  const fixed = (field: string) => setErrors((now) => now.filter((e) => e.field !== field));

  if (!summary || !open.length || !open.includes(day)) {
    return (
      <NyShell kicker="Daily check-in" title="Nothing to check in right now." intro={<p>Each check-in is about a day of your break once it is over. You can fill in a missed day for up to two days.</p>}>
        <div className="mpmb-actions">
          <Button variant="primary" onClick={back}>
            Back to my tracker
          </Button>
        </div>
      </NyShell>
    );
  }

  const when = relativeDay(day, today);
  /** "yesterday", or "on Tuesday 6 October" for an older day. */
  const onWhen = when === 'yesterday' ? when : `on ${when}`;
  const slipped = kept === 'little' || kept === 'lot';

  const validate = (): FieldError[] => {
    const found: FieldError[] = [];
    if (!kept) found.push({ field: 'ny-kept-yes', message: `Please say whether you stayed off your apps ${onWhen}.` });
    if (slipped && minutes.trim() && !(/^\d{1,4}$/.test(minutes.trim()) && Number(minutes) <= LIMITS.slipMinutes)) found.push({ field: 'ny-minutes', message: 'Please give the minutes as a whole number, up to 1440 (a whole day), or leave it blank.' });
    if (!mood) found.push({ field: 'ny-mood-1', message: 'Please choose how your mood was, from 1 to 5.' });
    if (!craving) found.push({ field: 'ny-craving-1', message: 'Please choose how much you wanted to use the apps, from 1 to 5.' });
    if (note.length > LIMITS.note) found.push({ field: 'ny-note', message: `Please keep the note to ${LIMITS.note} characters.` });
    return found;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempt((a) => a + 1);
    const found = validate();
    setErrors(found);
    if (found.length || !kept || !mood || !craving) return;
    dispatch({
      type: 'check-in',
      checkIn: { day, kept, slipMinutes: slipped && minutes.trim() ? Number(minutes) : null, mood, craving, note: note.trim().slice(0, LIMITS.note), savedOn: today, savedAt: new Date().toISOString() },
    });
    announce(`Check-in saved for ${formatDay(day, 'no-year')}.`);
  };

  return (
    <NyShell kicker="Daily check-in" title={`How did ${when} go?`} pageTitle="Daily check-in" intro={<p>A minute or two. There are no wrong answers: an honest answer helps more than a perfect one.</p>}>
      <form className="ny-form ny-checkin" onSubmit={submit} noValidate>
        <ErrorSummary errors={errors} focusKey={attempt} />

        {open.length > 1 && (
          <ChoiceField
            id="ny-day"
            name="ny-day"
            legend={<span className="ny-legend">Which day are you checking in for?</span>}
            hint="You missed a day. You can fill it in for up to two days."
            value={day}
            onChange={(v) => setDay(v)}
            options={open.map((d) => ({ value: d, label: `${capitalise(relativeDay(d, today))}${relativeDay(d, today) === 'yesterday' ? `, ${formatDay(d, 'no-year')}` : ''}` }))}
          />
        )}

        <ChoiceField
          id="ny-kept"
          name="ny-kept"
          legend={<span className="ny-legend">Did you stay off your chosen apps {onWhen}?</span>}
          hint={relativeDay(day, today) === 'yesterday' ? formatDay(day) : undefined}
          value={kept}
          onChange={(v) => {
            setKept(v as KeptAnswer);
            fixed('ny-kept-yes');
          }}
          options={KEPT_OPTIONS}
          error={errs['ny-kept-yes']}
        />

        {slipped && (
          <TextField
            id="ny-minutes"
            label="Roughly how many minutes did you spend on them?"
            hint="A rough guess is fine. Leave it blank if you’re not sure."
            tag="(optional)"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            width="short"
            value={minutes}
            maxLength={4}
            onChange={(e) => {
              setMinutes(e.target.value);
              fixed('ny-minutes');
            }}
            error={errs['ny-minutes']}
          />
        )}
        {slipped && <p className="ny-note">Slips happen to most people. Your best streak and your days kept still count.</p>}

        <Scale id="ny-mood" legend={`How was your mood ${onWhen}?`} labels={MOOD_LABELS} value={mood} onChange={(v) => { setMood(v); fixed('ny-mood-1'); }} error={errs['ny-mood-1']} />
        <Scale id="ny-craving" legend={`How much did you want to use the apps ${onWhen}?`} labels={CRAVING_LABELS} value={craving} onChange={(v) => { setCraving(v); fixed('ny-craving-1'); }} error={errs['ny-craving-1']} />

        <FieldWrapper id="ny-note" label="Anything you’d like to note?" tag="(optional)" hint="Just for you. Notes are never shown on the leaderboard." error={errs['ny-note']}>
          <textarea id="ny-note" className="mpmb-input mpmb-input--area" rows={3} maxLength={LIMITS.note} value={note} onChange={(e) => { setNote(e.target.value); fixed('ny-note'); }} aria-describedby={`ny-note-hint ny-note-count${errs['ny-note'] ? ' ny-note-error' : ''}`} />
          <p className="mpmb-hint ny-count" id="ny-note-count">
            {note.length} of {LIMITS.note} characters
          </p>
        </FieldWrapper>

        <div className="mpmb-actions">
          <Button type="submit" variant="primary" arrow>
            Save my check-in
          </Button>
          <Button variant="ghost" onClick={back}>
            Cancel
          </Button>
        </div>
      </form>
    </NyShell>
  );
}
