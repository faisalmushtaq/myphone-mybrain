import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { messageOf, type UsagePage, type UsagePart, type UsageSummary } from '../api';
import type { Staff } from '../StaffApp';

const RANGES = [7, 30, 90, 365] as const;

/** 75 → "1:15"; 40 → "40 s". */
const duration = (s: number | null) => {
  if (s === null) return '–';
  const whole = Math.round(s);
  return whole < 60 ? `${whole} s` : `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};
const percent = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–');
const visits = (n: number) => `${n} visit${n === 1 ? '' : 's'}`;
/** "child-details>handover" → "child details (handing over)". */
const partLabel = (p: string) => p.replace('>handover', ' (handing over)').replace(/[-_]/g, ' ');
const FORM_NAMES: Record<string, string> = { family: 'Family form', break: 'Break study' };
const VARIANT_NAMES: Record<string, string> = { parent: 'parent or carer', young: 'young person' };

function Bar({ value }: { value: number }) {
  return (
    <span className="mpmb-usage__bar" aria-hidden="true">
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

function FormFunnel({ page }: { page: UsagePage }) {
  const title = `${FORM_NAMES[page.app ?? ''] ?? page.page}${page.variant ? `, ${VARIANT_NAMES[page.variant] ?? page.variant}` : ''}`;
  return (
    <section className="mpmb-card mpmb-usage__card" aria-label={title}>
      <h3 className="mpmb-h3">{title}</h3>
      <p className="mpmb-hint">
        <span className="mpmb-mono">{page.page}</span> · {visits(page.views)} · {page.finished ?? 0} reached the end ({percent(page.finished ?? 0, page.views)}) · typical visit {duration(page.medianActive)}
        {page.saveFailures ? ` · ${page.saveFailures} failed saves` : ''}
      </p>
      <div className="mpmb-usage__scroll">
        <table className="mpmb-usage__table">
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">Got this far</th>
              <th scope="col">Typical time</th>
              <th scope="col">Stopped here</th>
              <th scope="col">Asked to fix</th>
            </tr>
          </thead>
          <tbody>
            {page.parts.map((p) => (
              <tr key={p.part}>
                <th scope="row">{partLabel(p.part)}</th>
                <td>
                  <Bar value={p.share} /> {p.reached} ({p.share}%)
                </td>
                <td>{duration(p.medianSeconds)}</td>
                <td className={p.part !== 'done' && p.lastHere ? 'mpmb-usage__flag' : undefined}>{p.part === 'done' ? '–' : p.lastHere}</td>
                <td>{p.errors.length ? p.errors.map((e) => `${e.field.replace(/^(child|parent|guardian|lab)-/, '')} ×${e.count}`).join(', ') : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PageDetails({ page }: { page: UsagePage }) {
  const sections = page.parts.filter((p: UsagePart) => p.part !== 'top' || page.parts.length === 1);
  return (
    <details className="mpmb-card mpmb-usage__card">
      <summary>
        <span className="mpmb-mono">{page.page}</span> · {visits(page.views)} · typical read {duration(page.medianActive)} · typically scrolled {page.medianScroll ?? 0}% down
      </summary>
      {sections.length > 0 && (
        <div className="mpmb-usage__scroll">
          <table className="mpmb-usage__table">
            <thead>
              <tr>
                <th scope="col">Part of the page</th>
                <th scope="col">Read by</th>
                <th scope="col">Typical time</th>
                <th scope="col">Last part read</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((p) => (
                <tr key={p.part}>
                  <th scope="row">{partLabel(p.part)}</th>
                  <td>
                    <Bar value={p.share} /> {p.reached} ({p.share}%)
                  </td>
                  <td>{duration(p.medianSeconds)}</td>
                  <td>{p.lastHere}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.clicks.length > 0 && (
        <>
          <h4 className="mpmb-usage__subhead">Links followed</h4>
          <ul className="mpmb-tools__list" role="list">
            {page.clicks.map((c) => (
              <li key={`${c.to}|${c.label}`} className="mpmb-tools__row">
                <span className="mpmb-tools__main">
                  {c.label || c.to} <span className="mpmb-mono mpmb-hint">{c.to}</span>
                </span>
                <span>×{c.count}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {page.sources.length > 0 && (
        <p className="mpmb-hint">Came from: {page.sources.map((s) => `${s.ref === '(direct)' ? 'a link or typed address' : s.ref.replace(/^ext:/, '')} ×${s.count}`).join(' · ')}</p>
      )}
    </details>
  );
}

/**
 * How the website is used, counted anonymously (assets/js/usage.js and
 * src/lib/usage.ts): for the online forms, how far people get, how long each
 * step takes, where they stop and which fields they are asked to fix; for
 * the other pages, which parts are read and for how long, and which links
 * are followed. Nothing here identifies anyone.
 */
export function Usage({ staff }: { staff: Staff }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { ask } = staff;
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError(null);
    ask<UsageSummary>('usage', { days })
      .then((s) => live && setSummary(s))
      .catch((e) => live && setError(messageOf(e)))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [days, ask]);

  const forms = (summary?.pages ?? []).filter((p) => p.app);
  const pages = (summary?.pages ?? []).filter((p) => !p.app);
  const most = Math.max(1, ...(summary?.byDay ?? []).map((d) => d.views));

  return (
    <div className="mpmb-tools__section mpmb-usage">
      <p>
        How people use the website, counted anonymously: no names, answers, codes or IP addresses, and nothing stored on their devices. Use it to find where people get stuck. “Stopped here” means a visit ended on that step without reaching the end; some of those families come back later in a new visit.
      </p>
      <div className="mpmb-tools__actions" role="group" aria-label="Period">
        {RANGES.map((r) => (
          <Button key={r} variant={r === days ? 'primary' : 'secondary'} onClick={() => setDays(r)} disabled={busy && r === days}>
            {r === 365 ? 'Last year' : `Last ${r} days`}
          </Button>
        ))}
      </div>
      {error && (
        <Callout tone="important" role="alert">
          <p>{error}</p>
        </Callout>
      )}
      {!summary && !error && <p className="mpmb-hint">Loading…</p>}
      {summary && (
        <>
          <p>
            <strong>{visits(summary.views)}</strong> from {summary.from} to {summary.to}: {Object.entries(summary.devices)
              .map(([d, n]) => `${percent(n, summary.views)} ${d}`)
              .join(', ')}
            .
          </p>
          {summary.byDay.length > 1 && (
            <div className="mpmb-usage__days" role="img" aria-label={`Visits per day, at most ${most}`}>
              {summary.byDay.map((d) => (
                <span key={d.day} title={`${d.day}: ${d.views}`} style={{ height: `${Math.max(4, (d.views / most) * 100)}%` }} />
              ))}
            </div>
          )}
          <h2 className="mpmb-h3">The online forms</h2>
          {forms.length ? forms.map((p) => <FormFunnel key={`${p.page}|${p.variant ?? ''}`} page={p} />) : <p className="mpmb-hint">No visits yet.</p>}
          <h2 className="mpmb-h3">Pages</h2>
          {pages.length ? pages.map((p) => <PageDetails key={p.page} page={p} />) : <p className="mpmb-hint">No visits yet.</p>}
        </>
      )}
    </div>
  );
}
