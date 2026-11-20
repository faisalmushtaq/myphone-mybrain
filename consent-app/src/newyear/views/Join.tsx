import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { ErrorSummary } from '../../components/ui/ErrorSummary';
import { CheckboxField, ChoiceField, FieldWrapper, SelectField, TextField } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { announce } from '../../lib/announce';
import type { FieldError } from '../../lib/validation';
import { APPS, COMMON_LANGUAGES, COUNTRY_CODES, EDUCATION_OPTIONS, ETHNICITY_GROUPS, ETHNICITY_SELF_DESCRIBE, GENDER_OPTIONS, LIMITS, MIN_AGE, MODES, PREFER_NOT, REMINDER_OPTIONS, SEX_OPTIONS, WORK_OPTIONS, type AppId, type BreakMode, type ReminderFrequency } from '../config';
import { addDays, formatDay, isIsoDate } from '../dates';
import type { Demographics } from '../model';
import { funName, shuffleFunName } from '../names';
import { NyDraft, NyShell } from '../NyShell';
import { canStore } from '../persistence';
import { mulberry32, randomSeed } from '../rng';
import { useNy } from '../store';
import { SaveApp } from './SaveApp';

const STEPS = ['Your age', 'Consent', 'About you', 'Your break', 'Name and reminders', 'Your account', 'Save it to your phone'] as const;

/** Draft consent statements (to be agreed with the team and the ethics committee). Optional ones can be left unticked. */
export const CONSENT_VERSION = '0.1-draft';
const CONSENT = [
  { id: 'read-information', required: true, text: 'I have read the information about the study, and I have been able to ask questions by email.' },
  { id: 'voluntary', required: true, text: 'Taking part is voluntary. I can stop at any time without giving a reason.' },
  { id: 'what-is-kept', required: true, text: 'My answers, brain-check results, screen-time screenshots, and the type of device and country I use the study from will be kept by the University of Leeds under a participant ID, not my name, and used for research.' },
  { id: 'not-monitored', required: true, text: 'My answers and notes are not read as they come in. If I need help, I will contact the support services the study lists, or someone I trust.' },
  { id: 'publication', required: true, text: 'Anonymised results may be published, and anonymised data shared with other researchers.' },
  { id: 'take-part', required: true, text: 'I agree to take part in the MyPhone/MyBrain online study.' },
  { id: 'email-reminders', required: false, text: 'I agree to be sent reminder emails (optional).' },
  { id: 'sms-reminders', required: false, text: 'I agree to be sent reminder text messages (optional).' },
] as const;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function countryOptions(): { value: string; label: string }[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(['en-GB'], { type: 'region' });
  } catch {
    names = null;
  }
  return COUNTRY_CODES.map((code) => ({ value: code, label: names?.of(code) ?? code }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en-GB'))
    .concat([{ value: PREFER_NOT, label: 'Prefer not to say' }]);
}

/** Whole years between a birth month ('YYYY-MM') and today, counting the birthday as the first of that month. */
export function ageOn(birthMonth: string, today: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(birthMonth);
  if (!m) return null;
  const [ty, tm] = today.split('-').map(Number);
  const years = ty - Number(m[1]) - (tm < Number(m[2]) ? 1 : 0);
  return years;
}

const EMPTY_DEMOGRAPHICS: Demographics = { birthMonth: '', sex: '', gender: '', genderText: '', ethnicity: '', ethnicityText: '', countryOfBirth: '', countryOfResidence: '', education: '', firstLanguage: '', otherLanguages: '', work: '', job: '' };

function StepFrame({ step, children }: { step: number; children: ReactNode }) {
  return (
    <>
      <p className="ny-stepper" aria-live="polite">
        Step {step + 1} of {STEPS.length}: <strong>{STEPS[step]}</strong>
      </p>
      <div className="ny-stepper__bar" aria-hidden="true">
        <span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>
      {children}
    </>
  );
}

/** Joining, a step at a time: age, consent, about you, the break, name and reminders, the account, and saving it to the phone. */
export function Join() {
  const { dispatch, today } = useNy();
  const rng = useRef(mulberry32(randomSeed()));
  const countries = useMemo(countryOptions, []);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [storable] = useState(canStore);
  const [birthYear, setBirthYear] = useState('');
  const [birthMonth, setBirthMonth] = useState('');
  const [consent, setConsent] = useState<Record<string, boolean>>({});
  const [d, setD] = useState<Demographics>(EMPTY_DEMOGRAPHICS);
  const [mode, setMode] = useState<BreakMode | null>(null);
  const [apps, setApps] = useState<AppId[]>([]);
  const [otherApp, setOtherApp] = useState('');
  const [goal, setGoal] = useState('');
  const [start, setStart] = useState(today);
  const [name, setName] = useState(() => funName(rng.current));
  const [onBoard, setOnBoard] = useState(true);
  const [frequency, setFrequency] = useState<ReminderFrequency>('every-3-days');
  const [phone, setPhone] = useState('');
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const fixed = (...fields: string[]) => setErrors((now) => now.filter((e) => !fields.includes(e.field)));
  const set = <K extends keyof Demographics>(k: K, v: Demographics[K]) => {
    setD((now) => ({ ...now, [k]: v }));
    fixed(`ny-${k}`);
  };
  const thisYear = Number(today.slice(0, 4));
  const years = Array.from({ length: 100 }, (_, i) => String(thisYear - MIN_AGE + 1 - i));
  const born = birthYear && birthMonth ? `${birthYear}-${birthMonth}` : '';
  const sms = consent['sms-reminders'] === true;
  const emailOk = consent['email-reminders'] === true;
  const latest = addDays(today, LIMITS.startDaysAhead);

  const validate = (): FieldError[] => {
    const found: FieldError[] = [];
    if (step === 0) {
      const age = ageOn(born, today);
      if (!born) found.push({ field: 'ny-birth-month', message: 'Please choose the month and year you were born.' });
      else if (age === null || age < MIN_AGE) found.push({ field: 'ny-birth-month', message: `The online study is for people aged ${MIN_AGE} or over. If you’re at school in Bradford or Leeds, ask your school about the school study.` });
    }
    if (step === 1) {
      for (const c of CONSENT) if (c.required && !consent[c.id]) found.push({ field: `ny-consent-${c.id}`, message: 'Please tick each statement to take part. The last two are optional.' });
    }
    if (step === 2) {
      const need: [keyof Demographics, string][] = [
        ['sex', 'Please choose your sex registered at birth, or Prefer not to say.'],
        ['gender', 'Please choose your gender, or Prefer not to say.'],
        ['ethnicity', 'Please choose your ethnic group, or Prefer not to say.'],
        ['countryOfBirth', 'Please choose the country you were born in, or Prefer not to say.'],
        ['countryOfResidence', 'Please choose the country you live in, or Prefer not to say.'],
        ['education', 'Please choose your highest level of education, or Prefer not to say.'],
        ['work', 'Please choose what you do, or Prefer not to say.'],
      ];
      for (const [k, message] of need) if (!d[k]) found.push({ field: `ny-${k}`, message });
      if (d.gender === 'self-describe' && !d.genderText.trim()) found.push({ field: 'ny-genderText', message: 'Please describe your gender, or choose another answer.' });
      if (d.ethnicity === ETHNICITY_SELF_DESCRIBE && !d.ethnicityText.trim()) found.push({ field: 'ny-ethnicityText', message: 'Please describe your ethnic group, or choose another answer.' });
      if (!d.firstLanguage.trim()) found.push({ field: 'ny-firstLanguage', message: 'Please give your first language (or write “Prefer not to say”).' });
    }
    if (step === 3) {
      if (!mode) found.push({ field: 'ny-mode-apps', message: 'Please choose how you want to take a break.' });
      if (mode === 'apps' && !apps.length) found.push({ field: `ny-app-${APPS[0].id}`, message: 'Choose at least one app to take a break from.' });
      if (mode === 'apps' && apps.includes('other') && !otherApp.trim()) found.push({ field: 'ny-other-app', message: 'Type the name of the other app, or untick Other.' });
      const g = Number(goal);
      if (mode === 'total' && !(/^\d{1,3}$/.test(goal.trim()) && g >= LIMITS.goalMinMinutes && g <= LIMITS.goalMaxMinutes)) found.push({ field: 'ny-goal', message: `Please give a daily limit in minutes, from ${LIMITS.goalMinMinutes} to ${LIMITS.goalMaxMinutes}.` });
      if (!isIsoDate(start) || start < today || start > latest) found.push({ field: 'ny-start', message: 'Choose a start day from today, within the next year.' });
    }
    if (step === 4 && sms && !/^\+?[\d\s()-]{7,20}$/.test(phone.trim())) found.push({ field: 'ny-phone', message: 'Please give a mobile number for the text reminders, with the country code (for example +44 7700 900123), or untick text reminders.' });
    return found;
  };

  const finish = (savedAsApp: boolean) => {
    const chosen = APPS.map((a) => a.id).filter((id) => apps.includes(id));
    dispatch({
      type: 'join',
      participant: {
        name,
        onLeaderboard: onBoard,
        mode: mode ?? 'apps',
        apps: mode === 'apps' ? chosen : [],
        otherApp: mode === 'apps' && apps.includes('other') ? otherApp.trim().slice(0, LIMITS.otherApp) : '',
        goalMinutes: mode === 'total' ? Number(goal) : null,
        startDate: start,
        joinedOn: today,
        joinedAt: new Date().toISOString(),
        demographics: { ...d, birthMonth: born, genderText: d.gender === 'self-describe' ? d.genderText.trim() : '', ethnicityText: d.ethnicity === ETHNICITY_SELF_DESCRIBE ? d.ethnicityText.trim() : '' },
        reminders: { email: emailOk, sms, phone: sms ? phone.trim() : '', frequency },
        consent: { version: CONSENT_VERSION, statements: Object.fromEntries(CONSENT.map((c) => [c.id, consent[c.id] === true])), at: new Date().toISOString() },
        savedAsApp,
        endedOn: null,
      },
    });
    announce(`You have joined as ${name}.`);
  };

  const next = (e?: FormEvent) => {
    e?.preventDefault();
    setAttempt((a) => a + 1);
    const found = validate();
    setErrors(found);
    if (found.length) return;
    setStep((s) => s + 1);
    window.scrollTo({ top: 0 });
  };
  const back = () => {
    setErrors([]);
    if (step === 0) dispatch({ type: 'go', route: { view: 'about' } });
    else setStep((s) => s - 1);
  };

  const actions = (label = 'Continue') => (
    <div className="mpmb-actions">
      <Button type="submit" variant="primary" arrow>
        {label}
      </Button>
      <Button variant="ghost" onClick={back}>
        Back
      </Button>
    </div>
  );

  let body: ReactNode;
  if (step === 0) {
    body = (
      <>
        {!storable && (
          <Callout tone="warning" title="This browser won’t keep your progress.">
            <p>It may be in private browsing, or set to block what websites save. You can still try the preview, but everything will be gone when you close the page.</p>
          </Callout>
        )}
        <FieldWrapper as="fieldset" id="ny-birth-month" label="When were you born?" hint={`The study is for people aged ${MIN_AGE} or over. We ask for the month and year only.`} error={errs['ny-birth-month']}>
          <div className="ny-row">
            <select id="ny-birth-month" className="mpmb-select" aria-label="Month" value={birthMonth} onChange={(e) => { setBirthMonth(e.target.value); fixed('ny-birth-month'); }}>
              <option value="">Month</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={String(i + 1).padStart(2, '0')}>
                  {m}
                </option>
              ))}
            </select>
            <select id="ny-birth-year" className="mpmb-select" aria-label="Year" value={birthYear} onChange={(e) => { setBirthYear(e.target.value); fixed('ny-birth-month'); }}>
              <option value="">Year</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </FieldWrapper>
        {actions()}
      </>
    );
  } else if (step === 1) {
    body = (
      <>
        <p>
          Please read the information about the study first (on the <Button variant="link" onClick={() => dispatch({ type: 'go', route: { view: 'about' } })}>study page</Button>), then tick each statement. <NyDraft />
        </p>
        <FieldWrapper as="fieldset" id="ny-consent" label="Consent" error={CONSENT.some((c) => errs[`ny-consent-${c.id}`]) ? 'Please tick each statement to take part. The last two are optional.' : undefined}>
          {CONSENT.map((c) => (
            <CheckboxField
              key={c.id}
              id={`ny-consent-${c.id}`}
              checked={consent[c.id] === true}
              onChange={(on) => {
                setConsent((now) => ({ ...now, [c.id]: on }));
                fixed(`ny-consent-${c.id}`);
              }}
              label={c.text}
              emphasis={c.required}
            />
          ))}
        </FieldWrapper>
        <p className="mpmb-hint">Reminders are optional, and you can turn them off at any time in Settings or from any message. Your email address and phone number are kept apart from your answers.</p>
        {actions('I agree')}
      </>
    );
  } else if (step === 2) {
    body = (
      <>
        <p>These help us understand who takes part, and compare people across the world. Every question has “Prefer not to say”.</p>
        <SelectField id="ny-sex" label="Sex registered at birth" options={SEX_OPTIONS} value={d.sex} onChange={(e) => set('sex', e.target.value)} error={errs['ny-sex']} />
        <SelectField id="ny-gender" label="Gender" options={GENDER_OPTIONS} value={d.gender} onChange={(e) => set('gender', e.target.value)} error={errs['ny-gender']} />
        {d.gender === 'self-describe' && <TextField id="ny-genderText" label="Your gender, in your own words" maxLength={LIMITS.text} value={d.genderText} onChange={(e) => set('genderText', e.target.value)} error={errs['ny-genderText']} width="half" />}
        <FieldWrapper id="ny-ethnicity" label="Ethnic group" hint="The UK census groups. If none fits, choose “Prefer to self-describe”." error={errs['ny-ethnicity']}>
          <select id="ny-ethnicity" className="mpmb-select" value={d.ethnicity} onChange={(e) => set('ethnicity', e.target.value)} aria-invalid={errs['ny-ethnicity'] ? true : undefined}>
            <option value="">Choose one</option>
            {ETHNICITY_GROUPS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={ETHNICITY_SELF_DESCRIBE}>Prefer to self-describe</option>
            <option value={PREFER_NOT}>Prefer not to say</option>
          </select>
        </FieldWrapper>
        {d.ethnicity === ETHNICITY_SELF_DESCRIBE && <TextField id="ny-ethnicityText" label="Your ethnic group, in your own words" maxLength={LIMITS.text} value={d.ethnicityText} onChange={(e) => set('ethnicityText', e.target.value)} error={errs['ny-ethnicityText']} width="half" />}
        <SelectField id="ny-countryOfBirth" label="Country of birth" options={countries} value={d.countryOfBirth} onChange={(e) => set('countryOfBirth', e.target.value)} error={errs['ny-countryOfBirth']} />
        <SelectField id="ny-countryOfResidence" label="Country you live in" options={countries} value={d.countryOfResidence} onChange={(e) => set('countryOfResidence', e.target.value)} error={errs['ny-countryOfResidence']} />
        <SelectField id="ny-education" label="Highest level of education you have finished" options={EDUCATION_OPTIONS} value={d.education} onChange={(e) => set('education', e.target.value)} error={errs['ny-education']} />
        <TextField id="ny-firstLanguage" label="Your first language" list="ny-languages" maxLength={LIMITS.text} autoComplete="off" value={d.firstLanguage} onChange={(e) => set('firstLanguage', e.target.value)} error={errs['ny-firstLanguage']} width="half" />
        <TextField id="ny-otherLanguages" label="Other languages you speak well" tag="(optional)" hint="Separate them with commas." maxLength={LIMITS.text * 2} autoComplete="off" value={d.otherLanguages} onChange={(e) => set('otherLanguages', e.target.value)} />
        <datalist id="ny-languages">
          {COMMON_LANGUAGES.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
        <SelectField id="ny-work" label="What do you do?" options={WORK_OPTIONS} value={d.work} onChange={(e) => set('work', e.target.value)} error={errs['ny-work']} />
        {(d.work === 'employed' || d.work === 'self-employed' || d.work === 'other') && <TextField id="ny-job" label="Your job or profession" tag="(optional)" hint="In your own words, for example “nurse” or “software developer”." maxLength={LIMITS.text} value={d.job} onChange={(e) => set('job', e.target.value)} />}
        {actions()}
      </>
    );
  } else if (step === 3) {
    body = (
      <>
        <ChoiceField
          id="ny-mode"
          name="ny-mode"
          legend={<span className="ny-legend">How do you want to take a break?</span>}
          value={mode}
          onChange={(v) => {
            setMode(v as BreakMode);
            fixed('ny-mode-apps');
          }}
          options={MODES.map((m) => ({ value: m.value, label: `${m.label}. ${m.hint}` }))}
          error={errs['ny-mode-apps']}
        />
        {mode === 'apps' && (
          <>
            <FieldWrapper as="fieldset" id="ny-apps" label="Which apps?" hint="Choose as many as you like." error={errs[`ny-app-${APPS[0].id}`]}>
              <div className="ny-apps">
                {APPS.map((app) => (
                  <CheckboxField
                    key={app.id}
                    id={`ny-app-${app.id}`}
                    checked={apps.includes(app.id)}
                    onChange={(on) => {
                      setApps((now) => (on ? [...now.filter((a) => a !== app.id), app.id] : now.filter((a) => a !== app.id)));
                      fixed(`ny-app-${APPS[0].id}`, 'ny-other-app');
                    }}
                    label={app.label}
                  />
                ))}
              </div>
            </FieldWrapper>
            {apps.includes('other') && <TextField id="ny-other-app" label="Which other app?" hint="Only you see this." value={otherApp} maxLength={LIMITS.otherApp} autoComplete="off" width="half" onChange={(e) => { setOtherApp(e.target.value); fixed('ny-other-app'); }} error={errs['ny-other-app']} />}
          </>
        )}
        {mode === 'total' && (
          <TextField
            id="ny-goal"
            label="Your daily limit for all phone use, in minutes"
            hint="Look at your screen time for last week first. A limit you can keep is better than a perfect one: for example 120 for two hours."
            inputMode="numeric"
            pattern="[0-9]*"
            width="short"
            maxLength={3}
            value={goal}
            onChange={(e) => {
              setGoal(e.target.value);
              fixed('ny-goal');
            }}
            error={errs['ny-goal']}
          />
        )}
        <TextField
          id="ny-start"
          type="date"
          label="When do you want to start?"
          hint="Day 1 of your break. It runs for as long as you like: you decide when to end it."
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
        {isIsoDate(start) && start >= today && <p className="ny-note">Starting {start === today ? 'today' : formatDay(start)}.</p>}
        {actions()}
      </>
    );
  } else if (step === 4) {
    body = (
      <>
        <section aria-labelledby="ny-name-title" className="ny-section ny-name">
          <h2 className="mpmb-h3" id="ny-name-title">
            Your fun name
          </h2>
          <div className="ny-name__row">
            <p className="ny-name__value" aria-live="polite" aria-atomic="true">
              <span className="mpmb-sr-only">Your fun name is </span>
              {name}
            </p>
            <Button variant="secondary" onClick={() => setName((c) => shuffleFunName(c, rng.current))}>
              <Icon name="refresh" size={18} /> Shuffle
            </Button>
          </div>
          <p className="mpmb-hint">Names are made from a list of friendly words, so nobody can put a real name on the leaderboard.</p>
          <CheckboxField id="ny-board" checked={onBoard} onChange={setOnBoard} label="Show my fun name on the leaderboard" hint="It shows your fun name, the days your screenshots prove, your streak and check-ins. Never your apps, answers or scores. You can change this any time." />
        </section>
        <ChoiceField id="ny-frequency" name="ny-frequency" legend={<span className="ny-legend">How often should we remind you to check in?</span>} hint="You can check in any time as well. Once a week we also ask for a screen-time screenshot." value={frequency} onChange={(v) => setFrequency(v as ReminderFrequency)} options={REMINDER_OPTIONS} />
        <p className="mpmb-hint">
          Reminders come as notifications once the study is saved to your phone{emailOk ? ', and by email' : ''}
          {sms ? ' and text' : ''}.
        </p>
        {sms && <TextField id="ny-phone" label="Mobile number for text reminders" hint="With the country code, for example +44 7700 900123." type="tel" autoComplete="tel" value={phone} maxLength={30} width="half" onChange={(e) => { setPhone(e.target.value); fixed('ny-phone'); }} error={errs['ny-phone']} />}
        {actions()}
      </>
    );
  } else if (step === 5) {
    body = (
      <>
        <p>
          In the real study you make an account here with your email address and a password, so you can carry on from any device and stay signed in. <NyDraft label="Preview" />
        </p>
        <Callout tone="info" title="Not in the preview">
          <p>The preview keeps everything on this device and has no accounts. Nothing you type in it is sent anywhere.</p>
        </Callout>
        {actions()}
      </>
    );
  } else {
    body = (
      <>
        <SaveApp />
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => finish(true)}>
            I’ve saved it: start my break
          </Button>
          <Button variant="secondary" onClick={() => finish(false)}>
            I’ll do this later
          </Button>
          <Button variant="ghost" onClick={back}>
            Back
          </Button>
        </div>
      </>
    );
  }

  return (
    <NyShell kicker="Join the online study · Preview" title={step === 6 ? 'Save it to your phone.' : 'Join the study.'} intro={step === 0 ? <p>About ten minutes. You can stop at any time.</p> : undefined}>
      <form className="ny-form" onSubmit={next} noValidate>
        <StepFrame step={step}>
          <ErrorSummary errors={errors} focusKey={attempt} />
          {body}
        </StepFrame>
      </form>
    </NyShell>
  );
}
