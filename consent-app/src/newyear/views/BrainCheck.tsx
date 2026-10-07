import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { announce } from '../../lib/announce';
import { STAGE_TEXT } from '../config';
import { formatDay } from '../dates';
import { NyShell } from '../NyShell';
import type { StageId } from '../schedule';
import { useNy } from '../store';
import { summarise } from '../summary';
import { DigitSpanGame } from './DigitSpanGame';
import { OddballGame } from './OddballGame';

type Part = 'intro' | 'memory' | 'attention';

/** One stage's brain check: a short introduction, the memory game, then the attention game. */
export function BrainCheck({ stage }: { stage: StageId }) {
  const { state, dispatch, today } = useNy();
  const summary = useMemo(() => summarise(state, today), [state, today]);
  const record = state.stages[stage];
  const [part, setPart] = useState<Part>(record?.digitSpan ? 'attention' : 'intro');
  const text = STAGE_TEXT[stage];
  const entry = summary?.stages.find((s) => s.plan.id === stage);
  const toChecks = () => dispatch({ type: 'go', route: { view: 'checks' } });

  if (!summary || !entry) return null;

  if (entry.status === 'done') {
    return (
      <NyShell kicker={text.title} title="You’ve done this one.">
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => dispatch({ type: 'go', route: { view: 'results', stage } })}>
            See your results
          </Button>
        </div>
      </NyShell>
    );
  }

  if (entry.status !== 'ready') {
    return (
      <NyShell kicker={text.title} title={entry.status === 'upcoming' ? `Not open yet.` : 'This one has closed.'} intro={<p>{entry.status === 'upcoming' ? `It opens on ${formatDay(entry.plan.opens)}.` : 'That’s fine: the next brain check still counts.'}</p>}>
        {entry.status === 'upcoming' && <p className="mpmb-hint">In this preview you can move the date on with the preview tools at the bottom of your tracker.</p>}
        <div className="mpmb-actions">
          <Button variant="primary" onClick={toChecks}>
            Back to the brain checks
          </Button>
        </div>
      </NyShell>
    );
  }

  if (part === 'intro') {
    return (
      <NyShell key="intro" kicker={text.title} title="Two short games." pageTitle={text.title} intro={<p>A memory game, then an attention game. About 5 minutes in all.</p>}>
        <ul className="mpmb-list" role="list">
          <li>Find a quiet spot where you won’t be interrupted for 5 minutes.</li>
          <li>Turn on Do Not Disturb, so messages don’t pop up.</li>
          <li>A phone or a computer is fine. Use the same one each time if you can.</li>
          <li>Do your best, but don’t worry: there is no pass or fail.</li>
        </ul>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => setPart('memory')}>
            Start with the memory game
          </Button>
          <Button variant="ghost" onClick={toChecks}>
            Not now
          </Button>
        </div>
      </NyShell>
    );
  }

  if (part === 'memory') {
    return (
      <NyShell key="memory" kicker={`${text.title} · 1 of 2`} title="The memory game." pageTitle={`${text.title}: memory`} width="normal" className="ny-step--game">
        <DigitSpanGame
          onQuit={toChecks}
          onDone={(result) => {
            dispatch({ type: 'memory-done', stage, result });
            announce(`Memory game done. You remembered up to ${result.score.span} digits. Next, the attention game.`);
            setPart('attention');
          }}
        />
      </NyShell>
    );
  }

  return (
    <NyShell key="attention" kicker={`${text.title} · 2 of 2`} title="The attention game." pageTitle={`${text.title}: attention`} width="normal" className="ny-step--game">
      <OddballGame onQuit={toChecks} onDone={(result) => dispatch({ type: 'attention-done', stage, result, today })} />
    </NyShell>
  );
}
