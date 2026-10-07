import { useMemo } from 'react';
import { Icon } from '../../components/ui/Icon';
import { exampleEntries, rankEntries } from '../leaderboard';
import { NyDraft, NyShell } from '../NyShell';
import { useNy } from '../store';
import { ownEntry, summarise } from '../summary';

/**
 * The leaderboard: fun names, current streaks and check-ins only. In the
 * preview the other rows are invented examples, made from the same word
 * lists and labelled as such.
 */
export function Leaderboard() {
  const { state, today } = useNy();
  const summary = useMemo(() => summarise(state, today), [state, today]);
  const rows = useMemo(() => {
    if (!summary) return [];
    const you = ownEntry(summary);
    return rankEntries([you, ...exampleEntries(summary.dayNumber, 9, [you.name])]);
  }, [summary]);
  if (!summary) return null;

  return (
    <NyShell kicker="Leaderboard" title="Keeping each other going." intro={<p>Ranked by current streak, then by check-ins. It’s all self-reported, so it’s here for encouragement, not as a contest.</p>}>
      <div className="ny-board-wrap">
        {/* Explicit roles keep this a table for screen readers when narrow screens lay each row out on two lines. */}
        <table className="ny-board" role="table">
          <caption>
            <span className="ny-board__caption">Example names: the real leaderboard will show other participants.</span> <NyDraft label="Preview" />
          </caption>
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader" className="ny-board__rank">
                <span aria-hidden="true">#</span>
                <span className="mpmb-sr-only">Rank</span>
              </th>
              <th scope="col" role="columnheader" className="ny-board__name">
                Name
              </th>
              <th scope="col" role="columnheader" className="ny-board__num ny-board__streak">
                Streak
              </th>
              <th scope="col" role="columnheader" className="ny-board__num ny-board__count">
                Check-ins
              </th>
              <th scope="col" role="columnheader" className="ny-board__badge">
                Brain check
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows.map((row) => (
              <tr key={row.name} role="row" className={row.isYou ? 'is-you' : 'is-example'}>
                <td role="cell" className="ny-board__rank">
                  {row.rank}
                </td>
                <th scope="row" role="rowheader" className="ny-board__name">
                  <span className="ny-board__fun">{row.name}</span>
                  {row.isYou ? <span className="ny-tag ny-tag--you">You</span> : <span className="ny-tag">Example</span>}
                </th>
                <td role="cell" className="ny-board__num ny-board__streak">
                  <span className="ny-board__narrow" aria-hidden="true">
                    Streak:{' '}
                  </span>
                  {row.streak}
                  <span className="ny-board__unit"> {row.streak === 1 ? 'day' : 'days'}</span>
                </td>
                <td role="cell" className="ny-board__num ny-board__count">
                  {row.checkIns}
                  <span className="ny-board__narrow" aria-hidden="true">
                    {' '}
                    {row.checkIns === 1 ? 'check-in' : 'check-ins'}
                  </span>
                </td>
                <td role="cell" className="ny-board__badge">
                  {row.brainCheckDone ? (
                    <span className="ny-badge" title="Latest brain check done">
                      <Icon name="check" size={16} />
                      <span className="mpmb-sr-only">Done</span>
                    </span>
                  ) : (
                    <span className="mpmb-sr-only">Not yet</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mpmb-hint">
        <span className="ny-badge ny-badge--inline" aria-hidden="true">
          <Icon name="check" size={14} />
        </span>{' '}
        means the latest brain check is done. The leaderboard never shows the apps you chose, your notes, your moods or your scores.
      </p>
    </NyShell>
  );
}
