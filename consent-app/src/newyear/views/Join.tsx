import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { ErrorSummary } from '../../components/ui/ErrorSummary';
import { CheckboxField, ChoiceField, FieldWrapper, TextField } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { announce } from '../../lib/announce';
import type { FieldError } from '../../lib/validation';
import { APPS, DEFAULT_LENGTH, LENGTHS, LIMITS, type AppId, type BreakLength } from '../config';
import { addDays, defaultStartDate, formatDay, isIsoDate } from '../dates';
import { funName, shuffleFunName } from '../names';
import { NyShell } from '../NyShell';
import { canStore } from '../persistence';
import { mulberry32, randomSeed } from '../rng';
import { useNy } from '../store';

/** Joining: age, apps, length, start day and a generated fun name. */
export function Join() {
  const { dispatch, today } = useNy();
  const rng = useRef(mulberry32(randomSeed()));
  const [adult, setAdult] = useState(false);
  const [apps, setApps] = useState<AppId[]>([]);
  const [otherApp, setOtherApp] = useState('');
  const [length, setLength] = useState<BreakLength>(DEFAULT_LENGTH);
  const [start, setStart] = useState(() => defaultStartDate(today));
  const [name, setName] = useState(() => funName(rng.current));
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [storable] = useState(canStore);
  const latest = addDays(today, LIMITS.startDaysAhead);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const hasOther = apps.includes('other');

  /** A problem disappears as soon as its field is changed; the rest stay until the next try. */
  const fixed = (...fields: string[]) => setErrors((now) => now.filter((e) => !fields.includes(e.field)));
  const toggleApp = (id: AppId, on: boolean) => {
    setApps((now) => (on ? [...now.filter((a) => a !== id), id] : now.filter((a) => a !== id)));
    fixed(`ny-app-${APPS[0].id}`, ...(id === 'other' && !on ? ['ny-other-app'] : []));
  };

  const validate = (): FieldError[] => {
    const found: FieldError[] = [];
    if (!adult) found.push({ field: 'ny-adult', message: 'Please confirm you are 18 or over.' });
    if (!apps.length) found.push({ field: `ny-app-${APPS[0].id}`, message: 'Choose at least one app to take a break from.' });
    if (hasOther && !otherApp.trim()) found.push({ field: 'ny-other-app', message: 'Type the name of the other app, or untick Other.' });
    if (!isIsoDate(start)) found.push({ field: 'ny-start', message: 'Enter the day you want to start, for example 1 January.' });
    else if (start < today) found.push({ field: 'ny-start', message: 'Choose a start day from today onwards.' });
    else if (start > latest) found.push({ field: 'ny-start', message: 'Choose a start day within the next year.' });
    return found;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempt((a) => a + 1);
    const found = validate();
    setErrors(found);
    if (found.length) return;
    const chosen = APPS.map((a) => a.id).filter((id) => apps.includes(id));
    dispatch({
      type: 'join',
      participant: { name, apps: chosen, otherApp: hasOther ? otherApp.trim().slice(0, LIMITS.otherApp) : '', lengthDays: length, startDate: start, joinedOn: today, joinedAt: new Date().toISOString() },
    });
    announce(`You have joined as ${name}.`);
  };

  const shuffle = () => setName((current) => shuffleFunName(current, rng.current));

  return (
    <NyShell kicker="Join the preview" title="Set up your break." intro={<p>Four quick choices. You can delete everything later.</p>}>
      <form className="ny-form" onSubmit={submit} noValidate>
        <ErrorSummary errors={errors} focusKey={attempt} />
        {!storable && (
          <Callout tone="warning" title="This browser won’t keep your progress.">
            <p>It may be in private browsing, or set to block what websites save. You can still try the preview, but everything will be gone when you close the page.</p>
          </Callout>
        )}

        <section className="ny-section">
          <FieldWrapper as="fieldset" id="ny-age" label="1. Your age" hint="The study is for adults.">
            <CheckboxField
              id="ny-adult"
              checked={adult}
              onChange={(on) => {
                setAdult(on);
                fixed('ny-adult');
              }}
              label="I am 18 or over" error={errs['ny-adult']} emphasis />
          </FieldWrapper>
        </section>

        <section className="ny-section">
          <FieldWrapper as="fieldset" id="ny-apps" label="2. Which apps are you taking a break from?" hint="Choose as many as you like. Messaging and calls are fine." error={errs[`ny-app-${APPS[0].id}`]}>
            <div className="ny-apps">
              {APPS.map((app) => (
                <CheckboxField key={app.id} id={`ny-app-${app.id}`} checked={apps.includes(app.id)} onChange={(on) => toggleApp(app.id, on)} label={app.label} />
              ))}
            </div>
          </FieldWrapper>
          {hasOther && (
            <TextField
              id="ny-other-app"
              label="Which other app?"
              hint="Only you see this. It is never shown on the leaderboard."
              value={otherApp}
              maxLength={LIMITS.otherApp}
              autoComplete="off"
              width="half"
              onChange={(e) => {
                setOtherApp(e.target.value);
                fixed('ny-other-app');
              }}
              error={errs['ny-other-app']}
            />
          )}
        </section>

        <section className="ny-section ny-length">
          <ChoiceField
            id="ny-length"
            name="ny-length"
            legend={<span className="ny-legend">3. For how long?</span>}
            value={String(length)}
            onChange={(v) => setLength(Number(v) as BreakLength)}
            options={LENGTHS.map((n) => ({ value: String(n), label: `${n} days` }))}
          />
        </section>

        <section className="ny-section">
          <TextField
            id="ny-start"
            type="date"
            label="4. When do you want to start?"
            hint="This is day 1 of your break. New Year’s Day is a good day to start. So is today."
            value={start}
            min={today}
            max={latest}
            className="mpmb-input--date"
            onChange={(e) => {
              setStart(e.target.value);
              fixed('ny-start');
            }}
            error={errs['ny-start']}
          />
          {isIsoDate(start) && start >= today && start <= latest && (
            <p className="ny-note" aria-live="polite">
              {formatDay(start)} to {formatDay(addDays(start, length - 1))}.
            </p>
          )}
        </section>

        <section aria-labelledby="ny-name-title" className="ny-section ny-name">
          <h2 className="mpmb-h3" id="ny-name-title">
            Your name on the leaderboard
          </h2>
          <div className="ny-name__row">
            <p className="ny-name__value" aria-live="polite" aria-atomic="true">
              <span className="mpmb-sr-only">Your fun name is </span>
              {name}
            </p>
            <Button variant="secondary" onClick={shuffle}>
              <Icon name="refresh" size={18} /> Shuffle
            </Button>
          </div>
          <p className="mpmb-hint">Names are made from a list of friendly words, so nobody can put a real name on the leaderboard. Shuffle until you like it.</p>
        </section>

        <div className="mpmb-actions">
          <Button type="submit" variant="primary" arrow>
            Start my break
          </Button>
          <Button variant="ghost" onClick={() => dispatch({ type: 'go', route: { view: 'about' } })}>
            Back
          </Button>
        </div>
      </form>
    </NyShell>
  );
}
