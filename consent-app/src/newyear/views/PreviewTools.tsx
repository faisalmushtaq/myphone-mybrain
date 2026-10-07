import { Button } from '../../components/ui/Button';
import { Disclosure } from '../../components/ui/Disclosure';
import { announce } from '../../lib/announce';
import { addDays, formatDay, localIsoDate } from '../dates';
import type { CheckIn } from '../model';
import { mulberry32, randomInt, randomSeed } from '../rng';
import { useNy } from '../store';
import type { BreakSummary } from '../summary';

/**
 * Preview only: pretend it is a later day, so the team can try the halfway
 * and end checks, and fill the calendar with made-up answers to see how it
 * looks. None of this would be in the real study.
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
  const fill = () => {
    const rng = mulberry32(randomSeed());
    const checkIns: CheckIn[] = summary.days
      .filter((d) => d.state === 'not-checked')
      .map((d) => {
        const roll = rng();
        const kept = roll < 0.72 ? 'yes' : roll < 0.9 ? 'little' : 'lot';
        return { day: d.date, kept, slipMinutes: kept === 'yes' ? null : randomInt(rng, 5, kept === 'lot' ? 120 : 30), mood: randomInt(rng, 2, 5), craving: randomInt(rng, 1, 4), note: '', savedOn: today, savedAt: new Date().toISOString() };
      });
    dispatch({ type: 'preview-fill', checkIns });
    announce(checkIns.length ? `Filled in ${checkIns.length} ${checkIns.length === 1 ? 'day' : 'days'} with example answers.` : 'There were no past days to fill in.');
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
        <Button variant="ghost" onClick={reset} disabled={!offset}>
          Back to the real date
        </Button>
      </div>
      <div className="ny-tools__row">
        <Button variant="secondary" onClick={fill} disabled={!summary.days.some((d) => d.state === 'not-checked')}>
          Fill in past days with example answers
        </Button>
      </div>
      <p className="mpmb-hint">These tools are only in the preview. In the real study, days pass one at a time.</p>
    </Disclosure>
  );
}
