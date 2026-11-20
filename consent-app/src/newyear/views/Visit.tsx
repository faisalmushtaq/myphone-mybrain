import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { ErrorSummary } from '../../components/ui/ErrorSummary';
import { ChoiceField, FieldWrapper, TextField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import type { FieldError } from '../../lib/validation';
import { APPS, FULL_VISITS, SWEMWBS, VISIT_TEXT, type VisitKind } from '../config';
import { addDays, daysBetween, formatDay, isIsoDate, type IsoDate } from '../dates';
import { deviceInfo, newId } from '../device';
import type { Visit as VisitRecord } from '../model';
import { NyDraft, NyShell } from '../NyShell';
import { lastCoveredDay } from '../progress';
import { useNy } from '../store';
import { summarise, type BreakSummary } from '../summary';
import { DigitSpanGame } from './DigitSpanGame';
import { OddballGame } from './OddballGame';

/** The longest stretch one screenshot can cover: phones keep a few weeks at most. */
const MAX_COVER_DAYS = 28;

type Step = 'scales' | 'brain-offer' | 'memory' | 'attention' | 'screenshot' | 'reflect' | 'complete';

/** The next thing to do in a visit, from what it already has. */
export function nextStep(v: VisitRecord): Step {
  const full = FULL_VISITS.includes(v.kind);
  if (full && !v.scales) return 'scales';
  if (!full && !v.screenshot) return 'screenshot';
  if (!v.skippedBrainCheck && !v.digitSpan) return full ? 'memory' : 'brain-offer';
  if (!v.skippedBrainCheck && !v.oddball) return 'attention';
  if (full && !v.screenshot) return 'screenshot';
  if (v.kind === 'end' && !v.reflection) return 'reflect';
  return 'complete';
}

/** Whether a new visit of this kind can be started now, and if not, why. */
export function canBegin(kind: VisitKind, s: BreakSummary): string | null {
  if (s.unfinished) return 'You have a visit you haven’t finished yet. Finish it first.';
  if (kind === 'start') return s.startDone ? 'You’ve done your start visit.' : null;
  if (!s.startDone) return 'Do your start visit first.';
  if (kind === 'return') return s.phase === 'during' ? null : s.phase === 'before' ? 'Return visits begin once your break has started.' : 'Your break has ended. Your follow-ups appear on your tracker.';
  if (kind === 'end') return s.phase === 'ended' ? 'Your break has already ended.' : s.phase === 'before' ? 'Your break hasn’t started yet.' : null;
  const f = s.followUps.find((x) => x.kind === kind);
  if (!f) return 'Follow-ups open after the end of your break.';
  return f.status === 'ready' ? null : f.status === 'upcoming' ? `It opens on ${formatDay(f.opens)}.` : f.status === 'done' ? 'You’ve done this one.' : 'This one has closed.';
}

function Intro({ kind, s }: { kind: VisitKind; s: BreakSummary }) {
  const { dispatch, today } = useNy();
  const text = VISIT_TEXT[kind];
  const blocked = canBegin(kind, s);
  const full = FULL_VISITS.includes(kind);
  const begin = () => {
    const visit: VisitRecord = { id: newId(), kind, startedOn: today, startedAt: new Date().toISOString(), device: deviceInfo(), scales: null, digitSpan: null, oddball: null, skippedBrainCheck: false, screenshot: null, reflection: null, completedOn: null, completedAt: null };
    dispatch({ type: 'visit-begin', visit });
  };
  return (
    <NyShell kicker={text.title} title={full ? `Your ${text.title.toLowerCase()}.` : 'A return visit.'} pageTitle={text.title} intro={<p>{full ? 'About 12 minutes, and it saves as you go.' : 'About 2 minutes for the screenshot, and 5 more if you do the brain check.'}</p>}>
      {blocked ? (
        <Callout tone="info">
          <p>{blocked}</p>
        </Callout>
      ) : (
        <>
          <ol className="mpmb-list">
            {full && <li>Some questions about how you’ve been feeling (about 2 minutes).</li>}
            {!full && <li>A screenshot of your phone’s screen-time summary, which proves your days off.</li>}
            <li>{full ? 'The brain check: a memory game, then an attention game (about 5 minutes).' : 'If you like, the brain check: a memory game and an attention game (about 5 minutes). Your scores count as validated with the screenshot.'}</li>
            {full && <li>A screenshot of your phone’s screen-time summary.</li>}
            {kind === 'end' && <li>Two questions about how it went.</li>}
          </ol>
          {kind === 'end' && (
            <Callout tone="important">
              <p>This ends your break. You can still check in afterwards, and we’ll invite you to two short follow-ups, one and three months from now.</p>
            </Callout>
          )}
          <p className="mpmb-hint">For the brain check: a quiet spot, Do Not Disturb on, and the same device as last time if you can.</p>
        </>
      )}
      <div className="mpmb-actions">
        {!blocked && (
          <Button variant="primary" arrow onClick={begin}>
            Start
          </Button>
        )}
        <Button variant={blocked ? 'primary' : 'ghost'} onClick={() => dispatch({ type: 'go', route: { view: 'tracker' } })}>
          {blocked ? 'Back to my tracker' : 'Not now'}
        </Button>
      </div>
    </NyShell>
  );
}

function Scales({ visit }: { visit: VisitRecord }) {
  const { dispatch } = useNy();
  const [answers, setAnswers] = useState<(number | null)[]>(() => SWEMWBS.items.map(() => null));
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [attempt, setAttempt] = useState(0);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempt((a) => a + 1);
    const found = answers.flatMap((a, i) => (a ? [] : [{ field: `ny-sw-${i}-1`, message: `Please answer “${SWEMWBS.items[i]}”.` }]));
    setErrors(found);
    if (found.length) return;
    dispatch({ type: 'visit-update', id: visit.id, patch: { scales: { swemwbs: answers as number[] } } });
    announce('Saved. Next, the brain check.');
  };
  return (
    <NyShell kicker={`${VISIT_TEXT[visit.kind].title} · Questions`} title="How you’ve been feeling." pageTitle="Questions">
      <form className="ny-form" onSubmit={submit} noValidate>
        <ErrorSummary errors={errors} focusKey={attempt} />
        <p>{SWEMWBS.intro}</p>
        {SWEMWBS.items.map((item, i) => (
          <ChoiceField
            key={item}
            id={`ny-sw-${i}`}
            name={`ny-sw-${i}`}
            legend={<span className="ny-legend">{item}</span>}
            value={answers[i] ? String(answers[i]) : null}
            onChange={(v) => {
              setAnswers((now) => now.map((a, j) => (j === i ? Number(v) : a)));
              setErrors((now) => now.filter((x) => x.field !== `ny-sw-${i}-1`));
            }}
            options={SWEMWBS.options.map((o, k) => ({ value: String(k + 1), label: o }))}
            error={errors.find((x) => x.field === `ny-sw-${i}-1`)?.message}
          />
        ))}
        <p className="mpmb-hint">
          The Short Warwick-Edinburgh Mental Wellbeing Scale. The lab study’s questionnaires will be added here once the team has listed them. <NyDraft />
        </p>
        <div className="mpmb-actions">
          <Button type="submit" variant="primary" arrow>
            Save and continue
          </Button>
        </div>
      </form>
    </NyShell>
  );
}

function Screenshot({ visit, s }: { visit: VisitRecord; s: BreakSummary }) {
  const { state, dispatch, today } = useNy();
  const p = s.participant;
  const covered = lastCoveredDay(state.visits);
  const yesterday = addDays(today, -1);
  // The start visit's screenshot is the week before (the baseline); later ones pick up where the last left off.
  const defaultFrom = visit.kind === 'start' ? addDays(today, -7) : covered && covered >= p.startDate ? addDays(covered, 1) : p.startDate;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [from, setFrom] = useState<IsoDate>(defaultFrom > yesterday ? yesterday : defaultFrom);
  const [to, setTo] = useState<IsoDate>(yesterday);
  const [minutes, setMinutes] = useState('');
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [attempt, setAttempt] = useState(0);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const apps = APPS.filter((a) => p.apps.includes(a.id)).map((a) => (a.id === 'other' && p.otherApp ? p.otherApp : a.label)).join(', ');
  const pick = (f: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
    setErrors((now) => now.filter((e) => e.field !== 'ny-shot'));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempt((a) => a + 1);
    const found: FieldError[] = [];
    if (!file) found.push({ field: 'ny-shot', message: 'Please choose your screenshot.' });
    else if (!/^image\//.test(file.type)) found.push({ field: 'ny-shot', message: 'Please choose a picture (a screenshot), not another kind of file.' });
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) found.push({ field: 'ny-from', message: 'Please give the first and last day the screenshot shows, first day first.' });
    else if (to > today) found.push({ field: 'ny-to', message: 'The last day can’t be later than today.' });
    else if (daysBetween(from, to) + 1 > MAX_COVER_DAYS) found.push({ field: 'ny-from', message: `One screenshot can cover up to ${MAX_COVER_DAYS} days. Send another for the rest.` });
    if (!/^\d{1,4}$/.test(minutes.trim()) || Number(minutes) > 1440) found.push({ field: 'ny-shot-minutes', message: 'Please give the minutes a day as a whole number (0 if none).' });
    setErrors(found);
    if (found.length || !file) return;
    dispatch({ type: 'visit-update', id: visit.id, patch: { screenshot: { fileName: file.name.slice(0, 120), fileType: file.type, fileBytes: file.size, from, to, minutesPerDay: Number(minutes), readBy: 'self', at: new Date().toISOString() } } });
    if (preview) URL.revokeObjectURL(preview);
    announce('Screenshot saved.');
  };
  return (
    <NyShell kicker={`${VISIT_TEXT[visit.kind].title} · Screenshot`} title="Your screen-time screenshot." pageTitle="Screenshot">
      <form className="ny-form" onSubmit={submit} noValidate>
        <ErrorSummary errors={errors} focusKey={attempt} />
        <p>{visit.kind === 'start' ? 'This shows how you used your phone before your break, so we can compare.' : 'This proves your days off. Every day of your break needs to be covered by a screenshot, so send one at least once a week.'}</p>
        <details className="ny-help">
          <summary>How to take it</summary>
          <p>
            <strong>iPhone:</strong> Settings, Screen Time, See All App &amp; Website Activity, then Week. Take a screenshot showing the daily average and the apps.
          </p>
          <p>
            <strong>Android:</strong> Settings, Digital Wellbeing &amp; parental controls (or Digital Wellbeing). Tap the chart, then take a screenshot showing the days and the apps.
          </p>
        </details>
        <FieldWrapper id="ny-shot" label="Your screenshot" error={errs['ny-shot']}>
          <input id="ny-shot" type="file" accept="image/*" className="mpmb-input" onChange={(e) => pick(e.target.files?.[0] ?? null)} aria-invalid={errs['ny-shot'] ? true : undefined} />
          {preview && <img src={preview} alt="Your screenshot" className="ny-shot__preview" />}
        </FieldWrapper>
        <Callout tone="info">
          <p>
            In the real study, the screenshot is read for you. In the preview, please tell us what it shows. The picture stays on this device. <NyDraft label="Preview" />
          </p>
        </Callout>
        <div className="ny-row">
          <TextField id="ny-from" type="date" label="First day it shows" value={from} max={today} className="mpmb-input--date" onChange={(e) => setFrom(e.target.value)} error={errs['ny-from']} />
          <TextField id="ny-to" type="date" label="Last day it shows" value={to} max={today} className="mpmb-input--date" onChange={(e) => setTo(e.target.value)} error={errs['ny-to']} />
        </div>
        <TextField
          id="ny-shot-minutes"
          label={p.mode === 'apps' ? `Minutes a day on ${apps}, on average` : 'Total phone time a day, on average, in minutes'}
          hint={p.mode === 'apps' ? 'Add up the chosen apps’ daily averages. 0 if none of them appear.' : 'The daily average at the top of the screenshot, in minutes (2h 30m is 150).'}
          inputMode="numeric"
          pattern="[0-9]*"
          width="short"
          maxLength={4}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          error={errs['ny-shot-minutes']}
        />
        <div className="mpmb-actions">
          <Button type="submit" variant="primary" arrow>
            Save the screenshot
          </Button>
          <Button variant="ghost" onClick={() => dispatch({ type: 'go', route: { view: 'tracker' } })}>
            Finish later
          </Button>
        </div>
      </form>
    </NyShell>
  );
}

function Reflect({ visit }: { visit: VisitRecord }) {
  const { dispatch } = useNy();
  const [why, setWhy] = useState('');
  const [again, setAgain] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  return (
    <NyShell kicker={`${VISIT_TEXT[visit.kind].title} · How it went`} title="How did it go?" pageTitle="How it went">
      <form
        className="ny-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!again) {
            setError('Please choose an answer.');
            return;
          }
          dispatch({ type: 'visit-update', id: visit.id, patch: { reflection: { why: why.trim().slice(0, 500), again } } });
        }}
      >
        <FieldWrapper id="ny-why" label="Why are you ending your break now?" tag="(optional)">
          <textarea id="ny-why" className="mpmb-input mpmb-input--area" rows={3} maxLength={500} value={why} onChange={(e) => setWhy(e.target.value)} />
        </FieldWrapper>
        <ChoiceField id="ny-again" name="ny-again" legend={<span className="ny-legend">Would you take a break like this again?</span>} value={again} onChange={(v) => { setAgain(v); setError(undefined); }} options={[{ value: 'yes', label: 'Yes' }, { value: 'maybe', label: 'Maybe' }, { value: 'no', label: 'No' }]} error={error} />
        <div className="mpmb-actions">
          <Button type="submit" variant="primary" arrow>
            Continue
          </Button>
        </div>
      </form>
    </NyShell>
  );
}

/** A visit: begin a new one (an introduction), or carry on with one, step by step. */
export function Visit({ visitId, kind }: { visitId?: string; kind?: VisitKind }) {
  const { state, dispatch, today } = useNy();
  const s = useMemo(() => summarise(state, today), [state, today]);
  const visit = state.visits.find((v) => v.id === visitId) ?? null;
  const [doBrain, setDoBrain] = useState(false);
  const done = Boolean(visit?.completedAt);
  // A finished visit's address shows its results.
  useEffect(() => {
    if (done && visit) dispatch({ type: 'go', route: { view: 'results', visitId: visit.id } });
  }, [done, visit, dispatch]);
  if (!s) return null;
  if (!visit) return kind ? <Intro kind={kind} s={s} /> : null;
  if (done) return null;
  const step = nextStep(visit);
  const title = VISIT_TEXT[visit.kind].title;
  const toTracker = () => dispatch({ type: 'go', route: { view: 'tracker' } });

  if (step === 'scales') return <Scales visit={visit} />;
  if (step === 'screenshot') return <Screenshot visit={visit} s={s} />;
  if (step === 'reflect') return <Reflect visit={visit} />;
  if (step === 'brain-offer' && !doBrain) {
    return (
      <NyShell kicker={`${title} · Brain check`} title="Do the brain check too?" pageTitle="Brain check" intro={<p>About 5 minutes: a memory game, then an attention game. With your screenshot, your scores count as validated, and you’ll see how they compare with your start.</p>}>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => setDoBrain(true)}>
            Do the brain check
          </Button>
          <Button variant="secondary" onClick={() => dispatch({ type: 'visit-update', id: visit.id, patch: { skippedBrainCheck: true } })}>
            Not this time
          </Button>
        </div>
      </NyShell>
    );
  }
  if (step === 'memory' || step === 'brain-offer') {
    return (
      <NyShell key="memory" kicker={`${title} · Memory game`} title="The memory game." pageTitle={`${title}: memory`} width="normal" className="ny-step--game">
        <DigitSpanGame
          onQuit={toTracker}
          onDone={(result) => {
            dispatch({ type: 'visit-update', id: visit.id, patch: { digitSpan: result } });
            announce(`Memory game done. You remembered up to ${result.score.span} digits. Next, the attention game.`);
          }}
        />
      </NyShell>
    );
  }
  if (step === 'attention') {
    return (
      <NyShell key="attention" kicker={`${title} · Attention game`} title="The attention game." pageTitle={`${title}: attention`} width="normal" className="ny-step--game">
        <p className="mpmb-hint">Your memory game is saved.</p>
        <OddballGame onQuit={toTracker} onDone={(result) => dispatch({ type: 'visit-update', id: visit.id, patch: { oddball: result } })} />
      </NyShell>
    );
  }
  // Everything is in: finish.
  return (
    <NyShell kicker={title} title="All done." pageTitle={`${title}: done`} intro={<p>Thank you. Save it to see your results.</p>}>
      <div className="mpmb-actions">
        <Button variant="primary" arrow onClick={() => dispatch({ type: 'visit-complete', id: visit.id, today, at: new Date().toISOString() })}>
          {visit.kind === 'end' ? 'End my break and see my results' : 'See my results'}
        </Button>
      </div>
    </NyShell>
  );
}
