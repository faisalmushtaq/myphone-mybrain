import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Disclosure } from '../../components/ui/Disclosure';
import { compareScores, describeScores, type ComparableScores } from '../compare';
import { VISIT_TEXT } from '../config';
import { daysBetween, formatDay } from '../dates';
import type { Visit } from '../model';
import { NyShell } from '../NyShell';
import { chosenNames, listText, meetsAim } from '../targets';
import { useNy } from '../store';

function comparable(v: Visit): ComparableScores {
  const a = v.sart?.scores;
  return { span: v.digitSpan?.score.span ?? null, commissions: a ? a.commissions : null, noGo: a ? a.noGo : null, omissions: a ? a.omissions : null, go: a ? a.go : null, medianRtMs: a?.medianRtMs ?? null, cvRt: a?.cvRt ?? null };
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
  const withBrain = done.filter((v) => v.digitSpan && v.sart);
  const earlierBrain = withBrain.filter((v) => String(v.completedAt) < String(visit.completedAt));
  const against = [...new Set([earlierBrain[0], earlierBrain[earlierBrain.length - 1]].filter((v): v is Visit => Boolean(v)))];
  const startScales = done.find((v) => v.kind === 'start')?.scales;
  const validated = Boolean(visit.screenshot && visit.digitSpan && visit.sart);
  const span = visit.digitSpan?.score;
  const odd = visit.sart?.scores;
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
                {odd.commissions}
                <span> of {odd.noGo} threes</span>
              </p>
              <p>
                The threes you tapped for by mistake: the main score of this game, where fewer means steadier attention. You missed {odd.omissions} of the {odd.go} other digits, and your typical reaction time was {msText(odd.medianRtMs)}.
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
            {[shot.chosenMinutesPerDay !== null ? `${shot.chosenMinutesPerDay} minutes a day on ${listText(chosenNames(p))}` : '', shot.totalMinutesPerDay !== null ? `${shot.totalMinutesPerDay} minutes a day on your phone in all` : ''].filter(Boolean).join(', and ')}.
            {visit.kind !== 'start' && (meetsAim(p, shot) ? ' Those days count as proven days off.' : ' That’s more than your aim, so those days don’t count as proven days off.')}
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
                  <th scope="col">Threes tapped</th>
                  <th scope="col">Digits missed</th>
                  <th scope="col">Reaction time</th>
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
                      <td>
                        {c.commissions} of {c.noGo}
                      </td>
                      <td>{c.omissions}</td>
                      <td>{msText(c.medianRtMs)}</td>
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
              <dt>Threes tapped (commission errors)</dt>
              <dd>
                {odd.commissions} of {odd.noGo} ({pct(odd.commissionRate)})
              </dd>
            </div>
            <div>
              <dt>Other digits missed (omission errors)</dt>
              <dd>
                {odd.omissions} of {odd.go} ({pct(odd.omissionRate)})
              </dd>
            </div>
            <div>
              <dt>Reaction time, median</dt>
              <dd>{msText(odd.medianRtMs)}</dd>
            </div>
            <div>
              <dt>Reaction time, mean (standard deviation)</dt>
              <dd>
                {msText(odd.meanRtMs)} ({msText(odd.sdRtMs)})
              </dd>
            </div>
            <div>
              <dt>Steadiness (coefficient of variation; lower is steadier)</dt>
              <dd>{odd.cvRt === null ? 'n/a' : odd.cvRt.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Reaction time before taps for a 3, and before threes held back</dt>
              <dd>
                {msText(odd.rtBeforeCommissionMs)} and {msText(odd.rtBeforeWithheldMs)}
              </dd>
            </div>
            <div>
              <dt>Too-quick taps (under 100 ms, not counted)</dt>
              <dd>{odd.anticipations}</dd>
            </div>
          </dl>
          <p className="mpmb-hint">The attention game is the Sustained Attention to Response Task (Robertson and others, 1997). People usually speed up just before tapping for a 3: compare the two reaction times above. Reaction times in a browser are approximate, to within a few hundredths of a second.</p>
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
