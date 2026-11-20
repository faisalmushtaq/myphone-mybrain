import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Disclosure } from '../../components/ui/Disclosure';
import { compareScores, describeScores, type ComparableScores } from '../compare';
import { VISIT_TEXT } from '../config';
import { daysBetween, formatDay } from '../dates';
import type { Visit } from '../model';
import { NyShell } from '../NyShell';
import { meetsAim } from '../progress';
import { useNy } from '../store';

function comparable(v: Visit): ComparableScores {
  const odd = v.oddball?.scores;
  return { span: v.digitSpan?.score.span ?? null, medianRtMs: odd?.medianRtMs ?? null, hits: odd ? odd.hits : null, targets: odd ? odd.targets : null, falseAlarms: odd ? odd.falseAlarms : null };
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
const msText = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v)} ms`);
const total = (a: number[]) => a.reduce((x, y) => x + y, 0);
const label = (v: Visit) => `${VISIT_TEXT[v.kind].name}, ${formatDay(v.completedOn ?? v.startedOn, 'no-year')}`;

/** One visit's results, in plain words, compared with the start and with the visit before. */
export function Results({ visitId }: { visitId: string }) {
  const { state, dispatch } = useNy();
  const visit = state.visits.find((v) => v.id === visitId);
  const p = state.participant;
  if (!visit || !p) return null;
  const done = state.visits.filter((v) => v.completedAt).sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));
  const withBrain = done.filter((v) => v.digitSpan && v.oddball);
  const earlierBrain = withBrain.filter((v) => String(v.completedAt) < String(visit.completedAt));
  const against = [...new Set([earlierBrain[0], earlierBrain[earlierBrain.length - 1]].filter((v): v is Visit => Boolean(v)))];
  const startScales = done.find((v) => v.kind === 'start')?.scales;
  const validated = Boolean(visit.screenshot && visit.digitSpan && visit.oddball);
  const span = visit.digitSpan?.score;
  const odd = visit.oddball?.scores;
  const shot = visit.screenshot;

  return (
    <NyShell kicker={VISIT_TEXT[visit.kind].title} title="Your results." pageTitle={`${VISIT_TEXT[visit.kind].title}: results`} intro={<p>{formatDay(visit.completedOn ?? visit.startedOn)}. Thank you.</p>}>
      {visit.kind === 'end' && (
        <Callout tone="success" title="Your break has ended. Well done.">
          <p>We’ll invite you to two short follow-ups, one and three months from now, to see how things are then.</p>
        </Callout>
      )}

      {span && odd && (
        <section aria-labelledby="ny-words" className="ny-section ny-results">
          <h2 className="mpmb-h3" id="ny-words">
            Your brain check {validated ? <span className="ny-tag ny-tag--you">Validated</span> : <span className="ny-tag">Not validated</span>}
          </h2>
          {!validated && <p className="mpmb-hint">Scores count as validated when a screen-time screenshot comes with them.</p>}
          {against.length ? (
            <>
              {against.map((then) => (
                <div key={then.id} className="ny-compare">
                  <p className="ny-compare__head">Compared with your {VISIT_TEXT[then.kind].name.toLowerCase()} ({formatDay(then.completedOn ?? then.startedOn, 'no-year')}):</p>
                  <ul className="mpmb-list" role="list">
                    {compareScores(comparable(visit), comparable(then), 'then').map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="ny-note">Doing the games again usually helps a little on its own, so small changes may be practice rather than your break.</p>
            </>
          ) : (
            <>
              <ul className="mpmb-list" role="list">
                {describeScores(comparable(visit)).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="ny-note">This is your starting point. Your next brain check, with a screenshot, shows how you compare.</p>
            </>
          )}
          <div className="ny-cards">
            <div className="ny-card">
              <h3 className="mpmb-h4">Memory</h3>
              <p className="ny-big-number">
                {span.span || '<3'}
                <span> digits</span>
              </p>
              <p>
                The longest run of digits you remembered in order. You got {span.correctTrials} of {span.totalTrials} rounds right.
              </p>
            </div>
            <div className="ny-card">
              <h3 className="mpmb-h4">Attention</h3>
              <p className="ny-big-number">
                {odd.medianRtMs === null ? 'n/a' : Math.round(odd.medianRtMs)}
                <span> ms</span>
              </p>
              <p>
                Your typical reaction time to an orange square. You spotted {odd.hits} of {odd.targets}, and {odd.falseAlarms === 0 ? 'never tapped by mistake' : `tapped by mistake ${odd.falseAlarms === 1 ? 'once' : `${odd.falseAlarms} times`}`}.
              </p>
            </div>
          </div>
        </section>
      )}
      {!span && visit.skippedBrainCheck && <p>You didn’t do the brain check this time. Do it at your next return visit to see how your scores compare.</p>}

      {visit.scales && (
        <section aria-labelledby="ny-wellbeing" className="ny-section">
          <h2 className="mpmb-h3" id="ny-wellbeing">
            Wellbeing
          </h2>
          <p>
            Your wellbeing score is {total(visit.scales.swemwbs)} out of 35
            {startScales && visit.kind !== 'start' ? `, compared with ${total(startScales.swemwbs)} at the start` : ''}. Higher means feeling better over the last two weeks.
          </p>
        </section>
      )}

      {shot && (
        <section aria-labelledby="ny-shot-h" className="ny-section">
          <h2 className="mpmb-h3" id="ny-shot-h">
            Your screenshot
          </h2>
          <p>
            It covers {formatDay(shot.from, 'no-year')} to {formatDay(shot.to, 'no-year')} ({daysBetween(shot.from, shot.to) + 1} days):{' '}
            {p.mode === 'apps' ? `${shot.minutesPerDay} minutes a day on your chosen apps` : `${shot.minutesPerDay} minutes a day on your phone`}.
            {visit.kind !== 'start' && (meetsAim(p.mode, p.goalMinutes, shot.minutesPerDay) ? ' Those days count as proven days off.' : p.mode === 'apps' ? ' That’s more than a few minutes, so those days don’t count as proven days off.' : ' That’s over your limit, so those days don’t count as proven days off.')}
          </p>
        </section>
      )}

      {withBrain.length > 1 && (
        <section aria-labelledby="ny-over-time" className="ny-section">
          <h2 className="mpmb-h3" id="ny-over-time">
            Over time
          </h2>
          <div className="ny-table-wrap">
            <table className="ny-table">
              <caption className="mpmb-sr-only">Your scores at each brain check</caption>
              <thead>
                <tr>
                  <th scope="col">Visit</th>
                  <th scope="col">Digits</th>
                  <th scope="col">Reaction time</th>
                  <th scope="col">Spotted</th>
                  <th scope="col">Mistaken taps</th>
                  <th scope="col">Validated</th>
                </tr>
              </thead>
              <tbody>
                {withBrain.map((v) => {
                  const c = comparable(v);
                  return (
                    <tr key={v.id} className={v.id === visit.id ? 'is-current' : undefined}>
                      <th scope="row">{label(v)}</th>
                      <td>{c.span || '<3'}</td>
                      <td>{msText(c.medianRtMs)}</td>
                      <td>
                        {c.hits} of {c.targets}
                      </td>
                      <td>{c.falseAlarms}</td>
                      <td>{v.screenshot ? 'Yes' : 'No'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {span && odd && (
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
              <dt>Mistaken taps (false alarms)</dt>
              <dd>
                {odd.falseAlarms} of {odd.standards} ({pct(odd.falseAlarmRate)})
              </dd>
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
          <p className="mpmb-hint">d′ puts spotting targets and avoiding mistaken taps into one number: higher means telling the shapes apart more clearly. With no taps at all it still comes out at about 0.5, because of the standard correction for perfect scores. Reaction times in a browser are approximate, to within a few hundredths of a second.</p>
        </Disclosure>
      )}

      <Callout tone="important" title="Not a medical test">
        <p>Scores go up and down from day to day, with sleep, mood and practice. So treat small changes lightly. If you are worried about your memory or concentration, talk to a doctor.</p>
      </Callout>

      <div className="mpmb-actions">
        <Button variant="primary" arrow onClick={() => dispatch({ type: 'go', route: { view: 'tracker' } })}>
          Back to my tracker
        </Button>
        <Button variant="secondary" onClick={() => dispatch({ type: 'go', route: { view: 'visits' } })}>
          All visits
        </Button>
      </div>
    </NyShell>
  );
}
