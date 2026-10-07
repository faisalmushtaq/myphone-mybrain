import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Disclosure } from '../../components/ui/Disclosure';
import { compareScores, describeScores, type ComparableScores } from '../compare';
import { STAGE_TEXT } from '../config';
import { formatDay } from '../dates';
import type { StageRecord } from '../model';
import { NyShell } from '../NyShell';
import { STAGE_IDS, type StageId } from '../schedule';
import { useNy } from '../store';

function comparable(record: StageRecord): ComparableScores {
  const odd = record.oddball?.scores;
  return { span: record.digitSpan?.score.span ?? null, medianRtMs: odd?.medianRtMs ?? null, hits: odd ? odd.hits : null, targets: odd ? odd.targets : null, falseAlarms: odd ? odd.falseAlarms : null };
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
const msText = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v)} ms`);

/** One brain check's scores, in plain words and compared with the earlier ones. */
export function Results({ stage }: { stage: StageId }) {
  const { state, dispatch } = useNy();
  const record = state.stages[stage];
  const text = STAGE_TEXT[stage];
  const toTracker = () => dispatch({ type: 'go', route: { view: 'tracker' } });
  const toChecks = () => dispatch({ type: 'go', route: { view: 'checks' } });

  if (!record?.completedAt || !record.digitSpan || !record.oddball) {
    return (
      <NyShell kicker={text.title} title="No results yet." intro={<p>Results appear here once both games of this brain check are done.</p>}>
        <div className="mpmb-actions">
          <Button variant="primary" onClick={toChecks}>
            Back to the brain checks
          </Button>
        </div>
      </NyShell>
    );
  }

  const now = comparable(record);
  const earlier = STAGE_IDS.slice(0, STAGE_IDS.indexOf(stage)).filter((id) => state.stages[id]?.completedAt);
  // Compared with the first check (before the break, usually) and, if there was one in between, the most recent.
  const against = [...new Set([earlier[0], earlier[earlier.length - 1]].filter((id): id is StageId => Boolean(id)))];
  const done = STAGE_IDS.filter((id) => state.stages[id]?.completedAt);
  const span = record.digitSpan.score;
  const odd = record.oddball.scores;

  return (
    <NyShell kicker={text.title} title={`Your results ${text.when}.`} pageTitle={`${text.title}: results`} intro={<p>Done on {formatDay(record.completedOn ?? '')}. Thank you.</p>}>
      <section aria-labelledby="ny-words" className="ny-section ny-results">
        <h2 className="mpmb-h3" id="ny-words">
          In plain words
        </h2>
        {against.length ? (
          against.map((id) => (
            <div key={id} className="ny-compare">
              <p className="ny-compare__head">Compared with {STAGE_TEXT[id].when}:</p>
              <ul className="mpmb-list" role="list">
                {compareScores(now, comparable(state.stages[id] as StageRecord), STAGE_TEXT[id].when).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <>
            <ul className="mpmb-list" role="list">
              {describeScores(now).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="ny-note">This is your starting point. At halfway, you’ll see how you compare.</p>
          </>
        )}
      </section>

      <div className="ny-cards">
        <div className="ny-card">
          <h2 className="mpmb-h4">Memory</h2>
          <p className="ny-big-number">
            {span.span || '<3'}
            <span> digits</span>
          </p>
          <p>
            The longest run of digits you remembered in order. You got {span.correctTrials} of {span.totalTrials} rounds right.
          </p>
        </div>
        <div className="ny-card">
          <h2 className="mpmb-h4">Attention</h2>
          <p className="ny-big-number">
            {odd.medianRtMs === null ? 'n/a' : Math.round(odd.medianRtMs)}
            <span> ms</span>
          </p>
          <p>
            Your typical reaction time to an orange square. You spotted {odd.hits} of {odd.targets}, and {odd.falseAlarms === 0 ? 'never tapped by mistake' : `tapped by mistake ${odd.falseAlarms === 1 ? 'once' : `${odd.falseAlarms} times`}`}.
          </p>
        </div>
      </div>

      {done.length > 1 && (
        <section aria-labelledby="ny-over-time" className="ny-section">
          <h2 className="mpmb-h3" id="ny-over-time">
            Over time
          </h2>
          <div className="ny-table-wrap">
            <table className="ny-table">
              <caption className="mpmb-sr-only">Your scores at each brain check</caption>
              <thead>
                <tr>
                  <th scope="col">Check</th>
                  <th scope="col">Digits</th>
                  <th scope="col">Reaction time</th>
                  <th scope="col">Spotted</th>
                  <th scope="col">Mistaken taps</th>
                </tr>
              </thead>
              <tbody>
                {done.map((id) => {
                  const c = comparable(state.stages[id] as StageRecord);
                  return (
                    <tr key={id} className={id === stage ? 'is-current' : undefined}>
                      <th scope="row">{STAGE_TEXT[id].name}</th>
                      <td>{c.span || '<3'}</td>
                      <td>{msText(c.medianRtMs)}</td>
                      <td>
                        {c.hits} of {c.targets}
                      </td>
                      <td>{c.falseAlarms}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Disclosure summary="All the numbers">
        <dl className="ny-numbers">
          <div>
            <dt>Digit span (longest correct)</dt>
            <dd>{span.span}</dd>
          </div>
          <div>
            <dt>Memory rounds right</dt>
            <dd>
              {span.correctTrials} of {span.totalTrials}
            </dd>
          </div>
          <div>
            <dt>Targets spotted (hits)</dt>
            <dd>
              {odd.hits} of {odd.targets} ({pct(odd.hitRate)})
            </dd>
          </div>
          <div>
            <dt>Targets missed</dt>
            <dd>{odd.misses}</dd>
          </div>
          <div>
            <dt>Mistaken taps (false alarms)</dt>
            <dd>
              {odd.falseAlarms} of {odd.standards} ({pct(odd.falseAlarmRate)})
            </dd>
          </div>
          <div>
            <dt>Blue circles left alone</dt>
            <dd>{odd.correctRejections}</dd>
          </div>
          <div>
            <dt>Reaction time, median</dt>
            <dd>{msText(odd.medianRtMs)}</dd>
          </div>
          <div>
            <dt>Reaction time, mean</dt>
            <dd>{msText(odd.meanRtMs)}</dd>
          </div>
          <div>
            <dt>Too-quick taps (under 150 ms, not counted)</dt>
            <dd>{odd.anticipations}</dd>
          </div>
          <div>
            <dt>d′ (d-prime)</dt>
            <dd>{odd.dPrime === null ? 'n/a' : odd.dPrime.toFixed(2)}</dd>
          </div>
        </dl>
        <p className="mpmb-hint">d′ puts spotting targets and avoiding mistaken taps into one number: higher means telling the shapes apart more clearly. Reaction times in a browser are approximate, to within a few hundredths of a second.</p>
      </Disclosure>

      <Callout tone="important" title="Not a medical test">
        <p>Scores go up and down from day to day, with sleep, mood and practice, and doing a game a second time often helps a little on its own. So treat small changes lightly. If you are worried about your memory or concentration, talk to a doctor.</p>
      </Callout>

      <div className="mpmb-actions">
        <Button variant="primary" arrow onClick={toTracker}>
          Back to my tracker
        </Button>
        <Button variant="secondary" onClick={toChecks}>
          All brain checks
        </Button>
      </div>
    </NyShell>
  );
}
