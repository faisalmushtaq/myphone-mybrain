import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { ChoiceField, FieldWrapper } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import { FULL_VISITS, VISIT_TEXT, type VisitKind } from '../config';
import type { Answers } from '../survey/engine';
import { surveyFor } from '../survey/surveys';
import { ageOn } from './Join';
import { Survey } from './Survey';
import { addDays, formatDay } from '../dates';
import { deviceInfo, newId } from '../device';
import type { Visit as VisitRecord } from '../model';
import { NyDraft, NyShell } from '../NyShell';
import { lastCoveredDay } from '../progress';
import { useNy } from '../store';
import { summarise, type BreakSummary } from '../summary';
import { DigitSpanGame } from './DigitSpanGame';
import { AppData, ScreenTimeShots } from './Donation';
import { SartGame } from './SartGame';


type Step = 'survey' | 'remi' | 'remi-offer' | 'brain-offer' | 'memory' | 'attention' | 'screenshot' | 'app-data' | 'reflect' | 'complete';

/** The next thing to do in a visit, from what it already has. */
export function nextStep(v: VisitRecord, remiMidDue = false): Step {
  const full = FULL_VISITS.includes(v.kind);
  if (full && !v.survey?.done) return 'survey';
  // Remi, the AI chat: at the start and the end, and offered once at a return visit two weeks or more in.
  if ((v.kind === 'start' || v.kind === 'end') && !v.remi) return 'remi';
  if (v.kind === 'return' && remiMidDue && !v.remi && v.screenshot) return 'remi-offer';
  if (!full && !v.screenshot) return 'screenshot';
  if (!v.skippedBrainCheck && !v.digitSpan) return full ? 'memory' : 'brain-offer';
  if (!v.skippedBrainCheck && !v.sart) return 'attention';
  if (full && !v.screenshot) return 'screenshot';
  // The app data downloads, as in the lab study: at the start and at the end.
  if ((v.kind === 'start' || v.kind === 'end') && !v.appData?.done) return 'app-data';
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
    const visit: VisitRecord = { id: newId(), kind, startedOn: today, startedAt: new Date().toISOString(), device: deviceInfo(), survey: null, digitSpan: null, sart: null, skippedBrainCheck: false, screenshot: null, appData: null, remi: null, reflection: null, completedOn: null, completedAt: null };
    dispatch({ type: 'visit-begin', visit });
  };
  return (
    <NyShell kicker={text.title} title={full ? `Your ${text.title.toLowerCase()}.` : 'A return visit.'} pageTitle={text.title} intro={<p>{full ? 'About 20 minutes, plus your app data downloads, which can take a few days to arrive. It saves as you go.' : 'About 2 minutes for the screenshot, and 5 more if you do the brain check.'}</p>}>
      {blocked ? (
        <Callout tone="info">
          <p>{blocked}</p>
        </Callout>
      ) : (
        <>
          <ol className="mpmb-list">
            {full && <li>Questions about why you’re taking a break, how you’ve been, sleep, and your phone and social media (about 15 minutes), one at a time.</li>}
            {!full && <li>Screenshots of your phone’s screen-time summary, which prove your days off.</li>}
            <li>{full ? 'The brain check: a memory game, then an attention game (about 10 minutes).' : 'If you like, the brain check: a memory game and an attention game (about 10 minutes). Your scores count as validated with the screenshots.'}</li>
            {full && <li>Screenshots of your phone’s screen-time summary.</li>}
            {(kind === 'start' || kind === 'end') && <li>Your TikTok, YouTube and Instagram data downloads, as in the lab study: read and cleaned on your device, and you choose what to share. They can take a few days to arrive, so you can finish later.</li>}
            {(kind === 'start' || kind === 'end') && <li>A chat with Remi, the study’s AI chat, as in the lab study (about 10 minutes).</li>}
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

function Questions({ visit, s }: { visit: VisitRecord; s: BreakSummary }) {
  const { dispatch, today } = useNy();
  const plan = surveyFor(visit.kind);
  if (!plan) return null;
  const saved = visit.survey;
  const save = (answers: Answers, position: number, done = false) => dispatch({ type: 'visit-update', id: visit.id, patch: { survey: { set: plan.set, version: plan.version, answers, position, done } } });
  return (
    <NyShell kicker={`${VISIT_TEXT[visit.kind].title} · Questions`} title="Some questions." pageTitle="Questions" className="ny-step--questions">
      <Survey
        sections={plan.sections}
        answers={saved?.answers ?? {}}
        position={saved?.position ?? 0}
        ageNow={ageOn(s.participant.demographics.birthMonth, today)}
        onChange={(answers, position) => save(answers, position)}
        onDone={(answers) => {
          save(answers, 0, true);
          announce('Questions done. Next, the brain check.');
        }}
        onLater={() => dispatch({ type: 'go', route: { view: 'tracker' } })}
      />
    </NyShell>
  );
}

function Screenshot({ visit, s }: { visit: VisitRecord; s: BreakSummary }) {
  const { state, dispatch, today } = useNy();
  const p = s.participant;
  const covered = lastCoveredDay(state.visits);
  // The start visit's screenshots are the week before (the baseline); later ones pick up where the last left off.
  const defaultFrom = visit.kind === 'start' ? addDays(today, -7) : covered && covered >= p.startDate ? addDays(covered, 1) : p.startDate;
  return (
    <NyShell kicker={`${VISIT_TEXT[visit.kind].title} · Screen time`} title="Your screen-time screenshots." pageTitle="Screen time">
      <ScreenTimeShots participant={p} kind={visit.kind === 'start' ? 'start' : 'later'} defaultFrom={defaultFrom} today={today} onSave={(shot) => dispatch({ type: 'visit-update', id: visit.id, patch: { screenshot: shot } })} onLater={() => dispatch({ type: 'go', route: { view: 'tracker' } })} />
    </NyShell>
  );
}

function AppDataStep({ visit }: { visit: VisitRecord }) {
  const { dispatch } = useNy();
  return (
    <NyShell kicker={`${VISIT_TEXT[visit.kind].title} · Your app data`} title={visit.kind === 'end' ? 'Request a new data download.' : 'Request your data downloads.'} pageTitle="Your app data">
      <AppData
        initial={visit.appData}
        onSave={(appData) => dispatch({ type: 'visit-update', id: visit.id, patch: { appData } })}
        onLater={(appData) => {
          dispatch({ type: 'visit-update', id: visit.id, patch: { appData } });
          dispatch({ type: 'go', route: { view: 'tracker' } });
        }}
      />
    </NyShell>
  );
}

const REMI_PROTOCOL = { start: 'online-pre', return: 'online-mid', end: 'online-post' } as const;

/**
 * Remi, the study's AI chat, as in the lab study's MyStory: a short chat whose
 * questions come only from the team's file (src/newyear/mystory/online-*.toml),
 * ending with a short story the person can pick or correct. It runs on the
 * study's server, so the preview only shows where it goes.
 */
function RemiStep({ visit, optional }: { visit: VisitRecord; optional: boolean }) {
  const { dispatch } = useNy();
  const protocol = REMI_PROTOCOL[visit.kind as keyof typeof REMI_PROTOCOL];
  const record = (status: 'preview' | 'declined') => dispatch({ type: 'visit-update', id: visit.id, patch: { remi: { protocol, status, at: new Date().toISOString() } } });
  return (
    <NyShell kicker={`${VISIT_TEXT[visit.kind].title} · Remi`} title="A chat with Remi." pageTitle="Remi" intro={<p>Remi is the study’s AI chat, made by the research team for this project, as in the lab study. It asks a few questions about {visit.kind === 'start' ? 'how you use your phone, and why you’re taking a break' : visit.kind === 'end' ? 'how your break went' : 'how your break is going'}, one at a time, then shows you a short story based on what you said. You pick the one that fits, or say what’s not quite right. About 10 minutes.</p>}>
      <Callout tone="info" title="Not in the preview yet">
        <p>
          Remi runs on the study’s server, and its questions for the online study are with the team to adapt from the lab study’s. It will be here once they are approved. <NyDraft label="Preview" />
        </p>
      </Callout>
      <div className="mpmb-actions">
        <Button variant="primary" arrow onClick={() => record('preview')}>
          Continue
        </Button>
        {optional && (
          <Button variant="secondary" onClick={() => record('declined')}>
            Not this time
          </Button>
        )}
      </div>
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
  // The midway Remi chat is offered once, at a return visit two weeks or more into the break.
  const remiMidDue = s.dayNumber >= 15 && !state.visits.some((v) => v.id !== visit.id && v.remi?.protocol === 'online-mid');
  const step = nextStep(visit, remiMidDue);
  const title = VISIT_TEXT[visit.kind].title;
  const toTracker = () => dispatch({ type: 'go', route: { view: 'tracker' } });

  if (step === 'survey') return <Questions visit={visit} s={s} />;
  if (step === 'remi' || step === 'remi-offer') return <RemiStep visit={visit} optional={step === 'remi-offer'} />;
  if (step === 'screenshot') return <Screenshot visit={visit} s={s} />;
  if (step === 'app-data') return <AppDataStep visit={visit} />;
  if (step === 'reflect') return <Reflect visit={visit} />;
  if (step === 'brain-offer' && !doBrain) {
    return (
      <NyShell kicker={`${title} · Brain check`} title="Do the brain check too?" pageTitle="Brain check" intro={<p>About 10 minutes: a memory game, then an attention game. With your screenshots, your scores count as validated, and you’ll see how they compare with your start.</p>}>
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
        <SartGame onQuit={toTracker} onDone={(result) => dispatch({ type: 'visit-update', id: visit.id, patch: { sart: result } })} />
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
