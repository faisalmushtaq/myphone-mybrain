import { useMemo } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { STAGE_TEXT } from '../config';
import { formatDay } from '../dates';
import { NyShell } from '../NyShell';
import type { StagePlan, StageStatus } from '../schedule';
import { useNy } from '../store';
import { summarise } from '../summary';

const STATUS_WORD: Record<StageStatus, string> = { done: 'Done', ready: 'Ready now', upcoming: 'Coming up', missed: 'Missed' };
const STATUS_MARK: Record<StageStatus, string> = { done: '✓', ready: '→', upcoming: '…', missed: '–' };

function when(plan: StagePlan): string {
  switch (plan.id) {
    case 'baseline':
      return `Any time up to ${formatDay(plan.dueBy, 'no-year')}, your first day`;
    case 'halfway':
      return `${formatDay(plan.date, 'no-year')}, day ${plan.day}`;
    case 'end':
      return `${formatDay(plan.date, 'no-year')}, the last day`;
    default:
      return `${formatDay(plan.date, 'no-year')}, a month after your break`;
  }
}

/** The four brain checks, when each is, and what is done. */
export function Checks() {
  const { state, dispatch, today } = useNy();
  const summary = useMemo(() => summarise(state, today), [state, today]);
  if (!summary) return null;

  return (
    <NyShell kicker="Brain checks" title="Your brain checks." intro={<p>Each one is two short games, memory and attention, about 5 minutes in all. Doing them at each stage shows how you change over the break.</p>}>
      <ol className="ny-stages" role="list">
        {summary.stages.map(({ plan, status }) => {
          const record = state.stages[plan.id];
          return (
            <li key={plan.id} className={`ny-stage is-${status}`}>
              <span className="ny-stage__mark" aria-hidden="true">
                {STATUS_MARK[status]}
              </span>
              <div className="ny-stage__body">
                <h2 className="mpmb-h4">
                  {STAGE_TEXT[plan.id].name}
                  {plan.optional && <span className="mpmb-optional"> (optional)</span>}
                </h2>
                <p className="ny-stage__when">{when(plan)}</p>
                <p className="ny-stage__status">
                  <strong>{STATUS_WORD[status]}</strong>
                  {status === 'done' && record?.completedOn ? `, on ${formatDay(record.completedOn, 'no-year')}.` : status === 'upcoming' ? `: opens on ${formatDay(plan.opens, 'no-year')}.` : status === 'missed' ? '. That’s fine: the next one still counts.' : status === 'ready' && plan.id === 'baseline' && today > plan.dueBy ? '. A little late, but still worth doing.' : '.'}
                </p>
                {status === 'ready' && (
                  <Button variant="primary" arrow onClick={() => dispatch({ type: 'go', route: { view: 'brain', stage: plan.id } })}>
                    {record?.digitSpan ? 'Finish this brain check' : 'Start this brain check'}
                  </Button>
                )}
                {status === 'done' && (
                  <Button variant="secondary" onClick={() => dispatch({ type: 'go', route: { view: 'results', stage: plan.id } })}>
                    See results
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <section aria-labelledby="ny-games" className="ny-section">
        <h2 className="mpmb-h3" id="ny-games">
          The two games
        </h2>
        <div className="ny-cards">
          <div className="ny-card">
            <h3 className="mpmb-h4">Memory</h3>
            <p>Digits appear one at a time. Then you tap them in the same order. It starts with 3 and gets longer, up to 10.</p>
          </div>
          <div className="ny-card">
            <h3 className="mpmb-h4">Attention</h3>
            <p>Shapes appear one at a time. Tap only for the orange square, not the blue circle. 100 shapes, about 3 minutes.</p>
          </div>
        </div>
      </section>

      <Callout tone="important" title="Not a medical test">
        <p>Scores go up and down from day to day, with sleep, mood and practice, and doing a game a second time often helps a little on its own. If you are worried about your memory or concentration, talk to a doctor.</p>
      </Callout>
    </NyShell>
  );
}
