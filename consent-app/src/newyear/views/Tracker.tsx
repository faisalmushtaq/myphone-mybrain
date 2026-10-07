import { useMemo } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { APPS, STAGE_TEXT } from '../config';
import { addDays, daysBetween, formatDay, relativeDay } from '../dates';
import { NyShell } from '../NyShell';
import { useNy } from '../store';
import { summarise, type BreakSummary } from '../summary';
import { Calendar } from './Calendar';
import { PreviewTools } from './PreviewTools';

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

function headline(s: BreakSummary): { title: string; intro: string } {
  if (s.phase === 'before') {
    const wait = daysBetween(s.today, s.plan.startDate);
    return { title: `Your break starts ${wait === 1 ? 'tomorrow' : `on ${formatDay(s.plan.startDate, 'no-year')}`}.`, intro: `${days(wait)} to go. Do your first brain check before you start.` };
  }
  if (s.phase === 'after') return { title: `You finished your ${s.plan.lengthDays}-day break.`, intro: `It ran from ${formatDay(s.plan.startDate, 'no-year')} to ${formatDay(s.endDate, 'no-year')}. Well done for taking part.` };
  return { title: `Day ${s.dayNumber} of ${s.plan.lengthDays}.`, intro: s.dayNumber === 1 ? 'Your break starts today. Good luck.' : `Your break ends on ${formatDay(s.endDate, 'no-year')}.` };
}

/** A kind word that fits the most recent answer. */
function encouragement(s: BreakSummary, latestKept: boolean | null): string | null {
  if (latestKept === null) return null;
  if (latestKept) return s.streak > 1 ? `${days(s.streak)} in a row. Keep going.` : 'A day off your apps. Nice work.';
  return s.best > 0 ? `A slip is part of changing a habit. Your best run of ${days(s.best)} still counts, and today is a fresh start.` : 'A slip is part of changing a habit. Today is a fresh start.';
}

function CheckInCard({ s }: { s: BreakSummary }) {
  const { dispatch } = useNy();
  const go = () => dispatch({ type: 'go', route: { view: 'checkin' } });
  let body: string;
  if (s.openDays.length) {
    const [first, second] = s.openDays;
    return (
      <div className="ny-card ny-card--action">
        <h2 className="mpmb-h3">How did {relativeDay(first, s.today)} go?</h2>
        <p>A quick check-in: did you stay off your apps? {second ? `You can also fill in ${formatDay(second, 'no-year')}.` : ''}</p>
        <Button variant="primary" arrow onClick={go}>
          Check in for {relativeDay(first, s.today)}
        </Button>
      </div>
    );
  }
  if (s.phase === 'before') body = `Check-ins start on ${formatDay(addDays(s.plan.startDate, 1), 'no-year')}, about the first day of your break.`;
  else if (s.phase === 'during' && s.dayNumber === 1) body = 'Your first check-in is tomorrow, about how today went.';
  else if (s.phase === 'during') body = 'You are all checked in. Come back tomorrow to say how today went.';
  else body = 'Check-ins for this break are closed. Thank you for every one.';
  return (
    <div className="ny-card">
      <h2 className="mpmb-h3">Daily check-in</h2>
      <p>{body}</p>
    </div>
  );
}

function NextCheckCard({ s }: { s: BreakSummary }) {
  const { dispatch } = useNy();
  const next = s.next;
  if (!next) {
    return (
      <div className="ny-card">
        <h2 className="mpmb-h3">Brain checks</h2>
        <p>No more brain checks to do on this break.</p>
        <Button variant="secondary" onClick={() => dispatch({ type: 'go', route: { view: 'checks' } })}>
          See my results
        </Button>
      </div>
    );
  }
  const text = STAGE_TEXT[next.stage.id];
  if (next.status === 'ready') {
    return (
      <div className="ny-card ny-card--action">
        <h2 className="mpmb-h3">Your {text.title.toLowerCase()} is ready.</h2>
        <p>About 5 minutes: a memory game, then an attention game. Find a quiet spot where you won’t be interrupted.{next.stage.optional ? ' This one is optional.' : ''}</p>
        <Button variant="primary" arrow onClick={() => dispatch({ type: 'go', route: { view: 'brain', stage: next.stage.id } })}>
          Start the brain check
        </Button>
      </div>
    );
  }
  return (
    <div className="ny-card">
      <h2 className="mpmb-h3">Next brain check</h2>
      <p>
        {text.name}: opens {relativeDay(next.stage.opens, s.today) === 'tomorrow' ? 'tomorrow' : `on ${formatDay(next.stage.opens)}`}. It will appear here.
      </p>
    </div>
  );
}

/** The dashboard: day N of M, streaks, the check-in, the next brain check and the calendar. */
export function Tracker() {
  const { state, dispatch, today } = useNy();
  const s = useMemo(() => summarise(state, today), [state, today]);
  if (!s) return null;
  const { title, intro } = headline(s);
  const latest = Object.keys(state.checkIns)
    .filter((d) => d >= s.plan.startDate && d <= s.endDate)
    .sort()
    .pop();
  const latestKept = latest ? state.checkIns[latest].kept === 'yes' : null;
  const cheer = encouragement(s, latestKept);
  const progressDay = Math.min(Math.max(s.dayNumber, 0), s.plan.lengthDays);
  const appNames = APPS.filter((a) => s.participant.apps.includes(a.id)).map((a) => (a.id === 'other' && s.participant.otherApp ? `Other (${s.participant.otherApp})` : a.label));

  return (
    <NyShell kicker="My tracker" title={title} pageTitle="My tracker" intro={<p>{intro}</p>}>
      {state.flash?.kind === 'joined' && (
        <Callout tone="success" role="status" title={`You’re in, ${s.participant.name}.`}>
          <p>Start with your first brain check, then check in each day of your break.</p>
        </Callout>
      )}
      {state.flash?.kind === 'checked-in' && (
        <Callout tone="success" role="status" title="Check-in saved.">
          <p>Thanks for your answers about {formatDay(state.flash.day, 'no-year')}. Honest answers are what make this useful.</p>
        </Callout>
      )}

      <div className="ny-progress">
        <div className="ny-progress__label">
          <span>{s.phase === 'before' ? 'Not started yet' : s.phase === 'after' ? 'Break finished' : `Day ${s.dayNumber} of ${s.plan.lengthDays}`}</span>
          <span>
            {formatDay(s.plan.startDate, 'short')} – {formatDay(s.endDate, 'short')}
          </span>
        </div>
        <div className="ny-progress__bar" role="progressbar" aria-label="Days of your break" aria-valuemin={0} aria-valuemax={s.plan.lengthDays} aria-valuenow={progressDay} aria-valuetext={`Day ${progressDay} of ${s.plan.lengthDays}`}>
          <span style={{ width: `${(progressDay / s.plan.lengthDays) * 100}%` }} />
        </div>
      </div>

      <dl className="ny-stats">
        <div>
          <dt>Current streak</dt>
          <dd>{days(s.streak)}</dd>
        </div>
        <div>
          <dt>Best streak</dt>
          <dd>{days(s.best)}</dd>
        </div>
        <div>
          <dt>Days kept</dt>
          <dd>{s.tally.kept}</dd>
        </div>
        <div>
          <dt>Check-ins</dt>
          <dd>{s.tally.checkIns}</dd>
        </div>
      </dl>
      {cheer && <p className="ny-cheer">{cheer}</p>}

      <div className="ny-cards">
        <CheckInCard s={s} />
        <NextCheckCard s={s} />
      </div>

      <section aria-labelledby="ny-days" className="ny-section">
        <h2 className="mpmb-h3" id="ny-days">
          Your days
        </h2>
        <Calendar days={s.days} />
      </section>

      <section aria-labelledby="ny-choices" className="ny-section ny-choices">
        <h2 className="mpmb-h3" id="ny-choices">
          Your break
        </h2>
        <p>
          {days(s.plan.lengthDays)} off {appNames.join(', ')}, from {formatDay(s.plan.startDate)} to {formatDay(s.endDate)}.
        </p>
        <p className="mpmb-hint">Only you see your apps and your answers. The leaderboard shows your fun name, streak and number of check-ins, nothing else.</p>
        <div className="ny-links">
          <Button variant="link" onClick={() => dispatch({ type: 'go', route: { view: 'leaderboard' } })}>
            See the leaderboard
          </Button>
          <Button variant="link" onClick={() => dispatch({ type: 'go', route: { view: 'leave' } })}>
            Leave or start again
          </Button>
        </div>
      </section>

      <PreviewTools summary={s} />
    </NyShell>
  );
}
