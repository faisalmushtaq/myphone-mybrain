import { Button } from '../../components/ui/Button';
import { Disclosure } from '../../components/ui/Disclosure';
import { announce } from '../../lib/announce';
import { addDays, formatDay, localIsoDate } from '../dates';
import { newId } from '../device';
import type { CheckIn } from '../model';
import { mulberry32, randomInt, randomSeed } from '../rng';
import { useNy } from '../store';
import type { BreakSummary } from '../summary';

/**
 * Preview only: pretend it is a later day, so the team can try return
 * visits, the end and the follow-ups, and fill the time since the last
 * check-in with made-up check-ins. None of this would be in the real study.
 */
export function PreviewTools({ summary }: { summary: BreakSummary }) {
  const { state, dispatch, today } = useNy();
  const offset = state.preview.dayOffset;
  const shift = (days: number) => {
    dispatch({ type: 'preview-shift', days });
    announce(`In the preview it is now ${formatDay(addDays(today, days))}.`);
  };
  const reset = () => {
    dispatch({ type: 'preview-reset' });
    announce(`Back to the real date, ${formatDay(localIsoDate())}.`);
  };
  const p = summary.participant;
  const from = summary.lastCheckIn && summary.lastCheckIn.date >= p.startDate ? addDays(summary.lastCheckIn.date, 1) : p.startDate;
  const fill = () => {
    const rng = mulberry32(randomSeed());
    const checkIns: CheckIn[] = [];
    for (let d = from; d < today; d = addDays(d, randomInt(rng, 1, 3))) {
      const roll = rng();
      const status = roll < 0.8 ? 'on-track' : roll < 0.93 ? 'little' : 'lot';
      checkIns.push({ id: newId(), date: d, at: `${d}T20:00:00.000Z`, status, slipDate: status === 'on-track' ? null : d, minutes: status === 'on-track' ? null : randomInt(rng, 5, status === 'lot' ? 120 : 30), mood: randomInt(rng, 2, 5), urge: randomInt(rng, 1, 4), note: '' });
    }
    dispatch({ type: 'preview-fill', checkIns });
    announce(checkIns.length ? `Added ${checkIns.length} example check-ins.` : 'There was no time to fill in.');
  };
  return (
    <Disclosure summary="Preview tools: try later days" className="ny-tools">
      <p>
        For trying the preview out. In the preview it is <strong>{formatDay(today)}</strong>
        {offset ? ` (${offset} ${offset === 1 ? 'day' : 'days'} ahead of the real date)` : ''}.
      </p>
      <div className="ny-tools__row">
        <Button variant="secondary" onClick={() => shift(1)}>
          Move on a day
        </Button>
        <Button variant="secondary" onClick={() => shift(7)}>
          Move on a week
        </Button>
        <Button variant="secondary" onClick={() => shift(30)}>
          Move on a month
        </Button>
        <Button variant="ghost" onClick={reset} disabled={!offset}>
          Back to the real date
        </Button>
      </div>
      <div className="ny-tools__row">
        <Button variant="secondary" onClick={fill} disabled={summary.phase !== 'during' || from >= today}>
          Add example check-ins since the last one
        </Button>
      </div>
      <p className="mpmb-hint">These tools are only in the preview. In the real study, days pass one at a time.</p>
    </Disclosure>
  );
}
