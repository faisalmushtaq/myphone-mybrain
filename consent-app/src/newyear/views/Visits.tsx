import { useMemo } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { VISIT_TEXT } from '../config';
import { formatDay } from '../dates';
import { NyShell } from '../NyShell';
import { useNy } from '../store';
import { summarise } from '../summary';

/** Every visit so far, and what can be done next. */
export function Visits() {
  const { state, dispatch, today } = useNy();
  const s = useMemo(() => summarise(state, today), [state, today]);
  if (!s) return null;
  const done = state.visits.filter((v) => v.completedAt).sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));
  const go = (kind: 'start' | 'return' | 'end') => dispatch({ type: 'go', route: { view: 'visit', kind } });

  return (
    <NyShell kicker="Visits" title="Your visits." intro={<p>A visit is a screenshot of your screen time, the brain check (a memory game and an attention game) and, at the start and end, some questions. Scores that come with a screenshot count as validated.</p>}>
      <div className="ny-cards">
        {!s.startDone && (
          <div className="ny-card ny-card--action">
            <h2 className="mpmb-h3">Start visit</h2>
            <p>About 12 minutes. Best done before your break starts.</p>
            <Button variant="primary" arrow onClick={() => go('start')}>
              Start it
            </Button>
          </div>
        )}
        {s.startDone && s.phase === 'during' && (
          <div className="ny-card ny-card--action">
            <h2 className="mpmb-h3">Return visit</h2>
            <p>Any time. A screenshot at least once a week, and the brain check whenever you like.</p>
            <Button variant="primary" arrow onClick={() => go('return')}>
              Start a return visit
            </Button>
          </div>
        )}
        {s.startDone && s.phase === 'during' && (
          <div className="ny-card">
            <h2 className="mpmb-h3">Ready to stop?</h2>
            <p>The end visit has the same questions, brain check and screenshot as the start, so you can see what changed.</p>
            <Button variant="secondary" onClick={() => go('end')}>
              End my break
            </Button>
          </div>
        )}
        {s.followUps.map((f) => (
          <div key={f.kind} className={`ny-card${f.status === 'ready' ? ' ny-card--action' : ''}`}>
            <h2 className="mpmb-h3">{VISIT_TEXT[f.kind].title}</h2>
            <p>{f.status === 'ready' ? `Open now, until ${formatDay(f.closes, 'no-year')}.` : f.status === 'upcoming' ? `Opens on ${formatDay(f.opens)}.` : f.status === 'done' ? 'Done. Thank you.' : 'This one has closed.'}</p>
            {f.status === 'ready' && (
              <Button variant="primary" arrow onClick={() => dispatch({ type: 'go', route: { view: 'visit', kind: f.kind } })}>
                Start it
              </Button>
            )}
          </div>
        ))}
      </div>

      <section aria-labelledby="ny-done" className="ny-section">
        <h2 className="mpmb-h3" id="ny-done">
          Done so far
        </h2>
        {done.length ? (
          <ol className="ny-stages" role="list">
            {done.map((v) => (
              <li key={v.id} className="ny-stage is-done">
                <span className="ny-stage__mark" aria-hidden="true">
                  ✓
                </span>
                <div className="ny-stage__body">
                  <h3 className="mpmb-h4">{VISIT_TEXT[v.kind].title}</h3>
                  <p className="ny-stage__when">
                    {formatDay(v.completedOn ?? v.startedOn)}
                    {v.screenshot ? ' · screenshot' : ''}
                    {v.digitSpan && v.oddball ? ` · brain check${v.screenshot ? ' (validated)' : ''}` : ''}
                  </p>
                  <Button variant="secondary" onClick={() => dispatch({ type: 'go', route: { view: 'results', visitId: v.id } })}>
                    See results
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p>No visits yet.</p>
        )}
      </section>

      <Callout tone="important" title="Not a medical test">
        <p>Scores go up and down from day to day, with sleep, mood and practice, and doing a game a second time often helps a little on its own. If you are worried about your memory or concentration, talk to a doctor.</p>
      </Callout>
    </NyShell>
  );
}
