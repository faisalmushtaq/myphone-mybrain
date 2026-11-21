import { useMemo } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { VISIT_TEXT } from '../config';
import { planText } from '../targets';
import { daysBetween, formatDay, relativeDay } from '../dates';
import { isStandalone } from '../install';
import { NyShell } from '../NyShell';
import { useNy } from '../store';
import { summarise, type BreakSummary } from '../summary';
import { Calendar } from './Calendar';
import { PreviewTools } from './PreviewTools';
import { SaveApp } from './SaveApp';

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

function headline(s: BreakSummary): { title: string; intro: string } {
  if (s.phase === 'before') {
    const wait = daysBetween(s.today, s.participant.startDate);
    return { title: `Your break starts ${wait === 1 ? 'tomorrow' : `on ${formatDay(s.participant.startDate, 'no-year')}`}.`, intro: s.startDone ? `${days(wait)} to go. You’re all set.` : `${days(wait)} to go. Do your start visit before then.` };
  }
  if (s.phase === 'ended') return { title: 'Your break has ended.', intro: `It ran from ${formatDay(s.participant.startDate, 'no-year')} to ${formatDay(s.participant.endedOn ?? s.today, 'no-year')}. Thank you for taking part.` };
  return { title: `Day ${s.dayNumber} of your break.`, intro: s.dayNumber === 1 ? 'Your break starts today. Good luck.' : 'It runs for as long as you like. Check in any time.' };
}

/** A kind word that fits where things stand now, never praise for an old answer. */
function encouragement(s: BreakSummary): string | null {
  if (s.phase !== 'during' || !s.lastCheckIn) return null;
  const gap = daysBetween(s.lastCheckIn.date, s.today);
  if (gap > 3) return `We last heard from you ${gap} days ago. However it’s gone since then, a check-in now picks things up.`;
  if (s.lastCheckIn.status === 'stopped') return 'You’ve paused for now. Check in when you restart, or end your break when you’re ready.';
  if (s.lastCheckIn.status === 'little' || s.lastCheckIn.status === 'lot') return s.best > 0 ? `A slip is part of changing a habit. Your best run of ${days(s.best)} still counts, and you can carry straight on.` : 'A slip is part of changing a habit. You can carry straight on.';
  return s.streak > 1 ? `${days(s.streak)} in a row. Keep going.` : 'Still going strong. Nice work.';
}

function NextCard({ s }: { s: BreakSummary }) {
  const { dispatch } = useNy();
  if (s.unfinished) {
    return (
      <div className="ny-card ny-card--action">
        <h2 className="mpmb-h3">Finish your {VISIT_TEXT[s.unfinished.kind].title.toLowerCase()}</h2>
        <p>You started it {relativeDay(s.unfinished.startedOn, s.today)}. Everything you did is saved.</p>
        <Button variant="primary" arrow onClick={() => dispatch({ type: 'go', route: { view: 'visit', visitId: s.unfinished?.id } })}>
          Carry on
        </Button>
      </div>
    );
  }
  if (!s.startDone) {
    return (
      <div className="ny-card ny-card--action">
        <h2 className="mpmb-h3">Your start visit</h2>
        <p>Some questions, the brain check, screen-time screenshots and your app data downloads: about 20 minutes, plus waiting for the downloads to arrive. Best done before your break starts.</p>
        <Button variant="primary" arrow onClick={() => dispatch({ type: 'go', route: { view: 'visit', kind: 'start' } })}>
          Start it
        </Button>
      </div>
    );
  }
  const ready = s.followUps.find((f) => f.status === 'ready');
  if (ready) {
    return (
      <div className="ny-card ny-card--action">
        <h2 className="mpmb-h3">Your {VISIT_TEXT[ready.kind].title.toLowerCase()} is ready</h2>
        <p>The same questions, brain check and screenshot as at the start, to see how things are now. Open until {formatDay(ready.closes, 'no-year')}.</p>
        <Button variant="primary" arrow onClick={() => dispatch({ type: 'go', route: { view: 'visit', kind: ready.kind } })}>
          Start it
        </Button>
      </div>
    );
  }
  if (s.phase === 'during') {
    return (
      <div className={`ny-card${s.shot.due ? ' ny-card--action' : ''}`}>
        <h2 className="mpmb-h3">{s.shot.due ? 'Time for your screenshot' : 'Return visit'}</h2>
        <p>
          {s.shot.uncovered
            ? `${days(s.shot.uncovered)} of your break ${s.shot.uncovered === 1 ? 'needs' : 'need'} a screenshot, from ${formatDay(s.shot.oldestUncovered ?? s.today, 'no-year')}. Send one at least once a week, while your phone still has those days.`
            : 'Every day so far is covered by a screenshot. Come back any time for a brain check, or when the next days need covering.'}
        </p>
        <Button variant={s.shot.due ? 'primary' : 'secondary'} arrow onClick={() => dispatch({ type: 'go', route: { view: 'visit', kind: 'return' } })}>
          Start a return visit
        </Button>
      </div>
    );
  }
  const upcoming = s.followUps.find((f) => f.status === 'upcoming');
  return (
    <div className="ny-card">
      <h2 className="mpmb-h3">{upcoming ? 'Next' : 'Visits'}</h2>
      <p>{upcoming ? `Your ${VISIT_TEXT[upcoming.kind].title.toLowerCase()} opens on ${formatDay(upcoming.opens)}. We’ll remind you.` : s.phase === 'before' ? 'Your return visits begin once your break starts.' : 'Nothing else to do. Thank you.'}</p>
    </div>
  );
}

/** The home screen: where the break stands, the check-in, what's next, and the days so far. */
export function Tracker() {
  const { state, dispatch, today } = useNy();
  const s = useMemo(() => summarise(state, today), [state, today]);
  if (!s) return null;
  const p = s.participant;
  const { title, intro } = headline(s);
  const cheer = encouragement(s);
  const plan = planText(p);

  return (
    <NyShell kicker="My tracker" title={title} pageTitle="My tracker" intro={<p>{intro}</p>}>
      {state.flash?.kind === 'joined' && (
        <Callout tone="success" role="status" title={`You’re in, ${p.name}.`}>
          <p>Start with your start visit, then check in whenever you like.</p>
        </Callout>
      )}
      {state.flash?.kind === 'checked-in' && (
        <Callout tone="success" role="status" title="Check-in saved.">
          <p>Thank you. Honest answers are what make this useful.</p>
        </Callout>
      )}

      {!p.savedAsApp && !isStandalone() && (
        <section className="ny-card ny-card--action ny-saveapp-card" aria-labelledby="ny-save-h">
          <h2 className="mpmb-h3" id="ny-save-h">
            Save the study to your phone
          </h2>
          <p>So you stay signed in and get reminders. On an iPhone, reminders only work once it’s saved to your Home Screen.</p>
          <SaveApp compact />
          <Button variant="link" onClick={() => dispatch({ type: 'settings', patch: { savedAsApp: true } })}>
            I’ve done this
          </Button>
        </section>
      )}

      {s.phase !== 'before' && (
        <dl className="ny-stats">
          <div>
            <dt>Current streak</dt>
            <dd>{days(s.streak)}</dd>
          </div>
          <div>
            <dt>Proven by screenshots</dt>
            <dd>{days(s.tally.verified)}</dd>
          </div>
          <div>
            <dt>Days off in all</dt>
            <dd>{s.tally.daysOff}</dd>
          </div>
          <div>
            <dt>Check-ins</dt>
            <dd>{s.tally.checkIns}</dd>
          </div>
        </dl>
      )}
      {s.streakAsOf && s.streakAsOf < today && s.phase === 'during' && <p className="mpmb-hint">Your streak counts up to {relativeDay(s.streakAsOf, today)}, your latest answer. Check in to bring it up to date.</p>}
      {cheer && <p className="ny-cheer">{cheer}</p>}

      <div className="ny-cards">
        <div className="ny-card ny-card--action">
          <h2 className="mpmb-h3">Check in</h2>
          <p>{s.lastCheckIn ? `Your last check-in was ${relativeDay(s.lastCheckIn.date, today)}.` : 'Tell us how you’re getting on, any time.'} A minute or so: how it’s going, your mood, and how much you want your phone.</p>
          <Button variant="primary" arrow onClick={() => dispatch({ type: 'go', route: { view: 'checkin' } })}>
            Check in now
          </Button>
        </div>
        <NextCard s={s} />
      </div>

      {s.days.length > 0 && (
        <section aria-labelledby="ny-days" className="ny-section">
          <h2 className="mpmb-h3" id="ny-days">
            Your days
          </h2>
          <Calendar days={s.days} />
        </section>
      )}

      <section aria-labelledby="ny-choices" className="ny-section ny-choices">
        <h2 className="mpmb-h3" id="ny-choices">
          Your break
        </h2>
        <p>
          {plan}, from {formatDay(p.startDate)}
          {p.endedOn ? ` to ${formatDay(p.endedOn)}` : ', for as long as you like'}.
        </p>
        <div className="ny-links">
          {s.phase === 'during' && s.startDone && !s.unfinished && (
            <Button variant="link" onClick={() => dispatch({ type: 'go', route: { view: 'visit', kind: 'end' } })}>
              I’m ready to end my break
            </Button>
          )}
          <Button variant="link" onClick={() => dispatch({ type: 'go', route: { view: 'settings' } })}>
            Settings and reminders
          </Button>
          <Button variant="link" onClick={() => dispatch({ type: 'go', route: { view: 'leave' } })}>
            Leave the study
          </Button>
        </div>
      </section>

      <PreviewTools summary={s} />
    </NyShell>
  );
}
