import { useEffect, useState } from 'react';
import { Callout } from '../../components/ui/Callout';
import { messageOf, when } from '../api';
import type { Staff } from '../StaffApp';

interface Stage {
  id: string;
  label: string;
  n: number;
}
interface DayCount {
  day: string;
  n: number;
}
export interface DashboardData {
  generatedAt: string;
  schools: {
    stages: Stage[];
    other: { questionsAnswered: number; youngAgreed: number; saidNo: number; noPhone: number; youngSaidNo: number; waiting: number; screenshots: number };
    bySchool: { id: string; name: string; started: number; yes: number; sent: number }[];
    daily: { started: DayCount[]; sent: DayCount[] };
  };
  breakStudy: {
    stages: Stage[];
    stories: { pre: number; mid: number; post: number };
    daily: { signedUp: DayCount[] };
  };
  /** The last data health check (firebase/functions/src/health.ts), or null before the first export has run. */
  health?: {
    checkedAt: string;
    ok: boolean;
    problems: { area: 'schools' | 'break' | 'uploads'; what: string; action: string; count: number; examples: string[] }[];
    notes: string[];
  } | null;
}

/**
 * The data health check at the top of each study's dashboard (17 October 2026): checked with the hourly export, the
 * records against each other and the stored files. Fine is one line; a problem is shown in full, with what to do.
 */
function Health({ health, area }: { health: DashboardData['health']; area: 'schools' | 'break' }) {
  if (!health) return <p className="mpmb-hint">The data check has not run yet: it runs with the hourly export.</p>;
  const mine = health.problems.filter((p) => p.area === area || p.area === 'uploads');
  const others = health.problems.length - mine.length;
  const stale = Date.now() - Date.parse(health.checkedAt) > 3 * 3600_000;
  if (!mine.length)
    return (
      <p className="mpmb-hint">
        Data check {when(health.checkedAt)}: every record holds what it says, every file is stored, nothing is stored twice.
        {others ? ` The other study has ${others} problem${others === 1 ? '' : 's'}: see its tab.` : ''}
        {stale ? ' This check is more than three hours old: the hourly export may have stopped. Tell the developer.' : ''}
      </p>
    );
  return (
    <Callout tone="important" role="alert">
      <p>
        <strong>Data check {when(health.checkedAt)}: {mine.length} problem{mine.length === 1 ? '' : 's'} found.</strong> The same is in DATA HEALTH.txt in the export folder.
      </p>
      <ul>
        {mine.map((p) => (
          <li key={p.what}>
            {p.what}: <strong>{p.count}</strong>. {p.action}
            {p.examples.length > 0 && <span className="mpmb-dash__muted"> ({p.examples.slice(0, 3).join('; ')}{p.count > 3 ? '; …' : ''})</span>}
          </li>
        ))}
      </ul>
    </Callout>
  );
}

/** "1 parent", "2 parents". */
const count = (n: number, one: string, many: string) => (
  <>
    <strong>{n}</strong> {n === 1 ? one : many}
  </>
);
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–');
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** One headline number. */
function Tile({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div className="mpmb-dash__tile">
      <span className="mpmb-dash__value">{value}</span>
      <span className="mpmb-dash__label">{label}</span>
      {note && <span className="mpmb-dash__note">{note}</span>}
    </div>
  );
}

/** How many reach each step: one bar per step, the first as the whole, each labelled with its count and share of the first. */
function Funnel({ title, stages }: { title: string; stages: Stage[] }) {
  const top = Math.max(1, stages[0]?.n ?? 0);
  return (
    <figure className="mpmb-dash__chart" aria-label={title}>
      <figcaption className="mpmb-h3">{title}</figcaption>
      <ol className="mpmb-dash__funnel" role="list">
        {stages.map((s) => (
          <li key={s.id} className="mpmb-dash__step" title={`${s.label}: ${s.n} (${pct(s.n, stages[0]?.n ?? 0)} of the first step)`}>
            <span className="mpmb-dash__steplabel">{s.label}</span>
            <span className="mpmb-dash__track">
              {s.n > 0 && <span className="mpmb-dash__bar" style={{ width: `${(s.n / top) * 100}%` }} />}
            </span>
            <span className="mpmb-dash__stepvalue">
              {s.n} <span className="mpmb-dash__muted">{pct(s.n, stages[0]?.n ?? 0)}</span>
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** A count per day for the last 30 days: columns, a hover read-out, and the same as a table. */
function Daily({ title, days }: { title: string; days: DayCount[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.n));
  const total = days.reduce((n, d) => n + d.n, 0);
  const W = 600;
  const H = 120;
  const slot = W / days.length;
  const bar = Math.max(2, slot - 2);
  const shown = hover !== null ? days[hover] : null;
  return (
    <figure className="mpmb-dash__chart" aria-label={`${title}: ${total} in the last 30 days`}>
      <figcaption className="mpmb-h3">
        {title} <span className="mpmb-dash__muted">· {total} in the last 30 days</span>
      </figcaption>
      <p className="mpmb-dash__readout" aria-live="polite">
        {shown ? `${dayLabel(shown.day)}: ${shown.n}` : `Most in a day: ${Math.max(0, ...days.map((d) => d.n))}`}
      </p>
      <svg className="mpmb-dash__svg" viewBox={`0 0 ${W} ${H + 2}`} role="img" aria-hidden="true" onMouseLeave={() => setHover(null)}>
        <line x1={0} x2={W} y1={H} y2={H} className="mpmb-dash__axis" />
        {days.map((d, i) => {
          const h = d.n ? Math.max(3, (d.n / max) * (H - 4)) : 0;
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              {/* The hit area is the whole column, wider than the bar. */}
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
              {h > 0 && <rect x={i * slot + (slot - bar) / 2} y={H - h} width={bar} height={h} rx={Math.min(4, bar / 2)} className={`mpmb-dash__col${hover === i ? ' is-hover' : ''}`} />}
            </g>
          );
        })}
      </svg>
      {/* Dates as page text, so they stay readable however small the chart is drawn. */}
      <p className="mpmb-dash__ticks" aria-hidden="true">
        <span>{dayLabel(days[0]?.day ?? '')}</span>
        <span>{dayLabel(days[days.length - 1]?.day ?? '')}</span>
      </p>
      <details className="mpmb-dash__table">
        <summary>Show as a table</summary>
        <table className="mpmb-table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Count</th>
            </tr>
          </thead>
          <tbody>
            {days
              .filter((d) => d.n)
              .map((d) => (
                <tr key={d.day}>
                  <td>{dayLabel(d.day)}</td>
                  <td>{d.n}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/**
 * Each study's first tab on the staff page (16 October 2026): how it is
 * going, at a glance; the studies are shown apart. Counts only, worked out from the records when the tab opens;
 * the break study leaves out the team's test accounts. Who to contact is on
 * "Families not finished"; the data itself is in the OneDrive export.
 */
export function Dashboard({ staff, study }: { staff: Staff; study: 'schools' | 'break' }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    staff
      .ask<DashboardData>('dashboard')
      .then(setData)
      .catch((e) => setError(messageOf(e)));
    // Once, when the tab opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error)
    return (
      <Callout tone="important" role="alert">
        <p>{error}</p>
      </Callout>
    );
  if (!data) return <p className="mpmb-hint">Counting…</p>;
  const s = data.schools;
  const b = data.breakStudy;
  const [started, yes, sent] = s.stages.map((x) => x.n);

  return (
    <div className="mpmb-tools__section mpmb-dash">
      <p className="mpmb-hint">Counted {when(data.generatedAt)}. Reload the page for the latest.</p>
      <Health health={data.health ?? null} area={study} />

      {study === 'schools' && (
        <section aria-labelledby="dash-schools">
          <h2 className="mpmb-h2" id="dash-schools">
            Schools study: families
          </h2>
          <div className="mpmb-dash__tiles">
            <Tile label="Forms saved" value={started} />
            <Tile label="Screen time sent" value={sent} note={`${pct(sent, started)} of forms`} />
            <Tile label="Waiting for screen time" value={s.other.waiting} note="said yes, nothing sent yet" />
            <Tile label="Questions answered" value={s.other.questionsAnswered} note={`${pct(s.other.questionsAnswered, started)} of forms`} />
            <Tile label="Screenshots received" value={s.other.screenshots} />
          </div>
          <div className="mpmb-dash__grid">
            <Funnel title="From form to screen time" stages={s.stages} />
            <div className="mpmb-dash__chart">
              <p className="mpmb-h3">Answers along the way</p>
              <ul className="mpmb-dash__facts" role="list">
                <li>{count(yes, 'family said yes to sharing the screen time', 'families said yes to sharing the screen time')}</li>
                <li>
                  {count(s.other.youngAgreed, 'young person agreed to share', 'young people agreed to share')}; {count(s.other.youngSaidNo, 'said no', 'said no')}
                </li>
                <li>{count(s.other.saidNo, 'parent said no to sharing', 'parents said no to sharing')}</li>
                <li>{count(s.other.noPhone, 'young person has no phone of their own', 'young people have no phone of their own')}</li>
              </ul>
            </div>
            <Daily title="Forms saved per day" days={s.daily.started} />
            <Daily title="Screen time sends per day" days={s.daily.sent} />
          </div>
          <h3 className="mpmb-h3">By school</h3>
          <div className="mpmb-dash__scroll">
            <table className="mpmb-table">
              <thead>
                <tr>
                  <th scope="col">School</th>
                  <th scope="col">Forms saved</th>
                  <th scope="col">Said yes</th>
                  <th scope="col">Screen time sent</th>
                  <th scope="col">Sent, of forms</th>
                </tr>
              </thead>
              <tbody>
                {s.bySchool.length ? (
                  s.bySchool.map((r) => (
                    <tr key={r.id}>
                      <th scope="row">{r.name}</th>
                      <td>{r.started}</td>
                      <td>{r.yes}</td>
                      <td>{r.sent}</td>
                      <td>{pct(r.sent, r.started)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5}>No forms yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {study === 'break' && (
        <section aria-labelledby="dash-break">
          <h2 className="mpmb-h2" id="dash-break">
            Social media break study
          </h2>
          <div className="mpmb-dash__tiles">
            <Tile label="Signed up" value={b.stages[0]?.n ?? 0} />
            <Tile label="Finished (second visit)" value={b.stages[5]?.n ?? 0} note={`${pct(b.stages[5]?.n ?? 0, b.stages[0]?.n ?? 0)} of sign-ups`} />
            <Tile label="MyStory stories" value={b.stories.pre + b.stories.mid + b.stories.post} note={`${b.stories.pre} before, ${b.stories.mid} during, ${b.stories.post} after`} />
          </div>
          <div className="mpmb-dash__grid">
            <Funnel title="Through the study" stages={b.stages} />
            <Daily title="Sign-ups per day" days={b.daily.signedUp} />
          </div>
        </section>
      )}
    </div>
  );
}
