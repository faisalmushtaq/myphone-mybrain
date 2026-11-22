import { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { ask, messageOf } from './api';
import { newIssueId } from './issueQueue';
import { ErrorLine, Loading, useLoad } from './TeamViews';
import { stamp, type Role } from './types';

/**
 * The safeguarding log (22 November 2026; firebase/functions/src/sgLog.ts).
 * Anyone reports a concern and sees their own reports; the PI and the project
 * coordinator (the log holders) see every record, record what was done and
 * close it with the outcome. Kept apart from the Notebook and the research data.
 */

const SOURCES: [string, string][] = [
  ['session', 'Told or seen at a session'],
  ['data', 'Found later in the study’s data'],
  ['other', 'Something else'],
];
const DSL: [string, string][] = [
  ['yes', 'Yes, I told the DSL (or deputy)'],
  ['not-yet', 'Not yet'],
  ['not-reachable', 'I couldn’t reach the DSL'],
  ['not-needed', 'Found later in the data: for the PI to decide'],
];
const HOW: [string, string][] = [
  ['in-person', 'In person'],
  ['phone', 'By phone'],
  ['email', 'By secure email'],
  ['other', 'Other'],
];
const STEP: Record<string, string> = { action: 'Action taken', note: 'Note', addendum: 'Added by the reporter', closed: 'Closed', reopened: 'Reopened' };
const lab = (list: [string, string][], v: string | null) => list.find(([k]) => k === v)?.[1] ?? v ?? '';

interface Step {
  id: string;
  at: string;
  byName: string;
  kind: string;
  text: string;
}
interface Rec {
  id: string;
  uid: string;
  reporterName: string;
  occurredAt: string;
  receivedAt: string;
  source: string;
  visitId: string | null;
  schoolName: string;
  about: string;
  yearGroup: string;
  account: string;
  immediate: string;
  immediateDanger: boolean;
  dsl: string;
  dslName: string;
  dslAt: string | null;
  dslHow: string | null;
  status: 'open' | 'closed';
  outcome: string;
  steps: Step[];
}

const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function SafeguardingLog({ role, arg, go }: { role: Role; arg?: string; go: (h: string) => void }) {
  const mine = useLoad<{ reports: Rec[]; holder: boolean }>('sg-mine');
  const holder = mine.value?.holder ?? false;
  const [all, setAll] = useState<Rec[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const loadAll = async () => {
    try {
      setAll((await ask<{ records: Rec[] }>('sg-list')).records);
    } catch (e) {
      setErr(messageOf(e));
    }
  };
  useEffect(() => {
    if (holder) void loadAll();
  }, [holder]);
  const reload = async () => {
    await mine.load();
    if (holder) await loadAll();
  };
  if (arg === 'new') return <SgReport go={go} onSaved={() => void reload()} />;
  const records = holder ? all : (mine.value?.reports ?? null);
  const open = arg && records ? records.find((r) => r.id === arg) : undefined;
  if (open) return <SgRecord rec={open} holder={holder} back={() => go('#safeguarding-log')} reload={reload} />;
  return (
    <Loading error={mine.error ?? err}>
      <p className="mpmb-hint">
        {holder ? 'Every safeguarding concern logged, open ones first. Only the PI and the project coordinator can see this log.' : 'Concerns you have logged. Only the PI and the project coordinator can read the safeguarding log; you see your own reports and whether each is still open.'} It is kept apart from the Notebook and the research data. <a href="#safeguarding">The safeguarding procedure</a>.
      </p>
      <Callout tone="important" title="A concern at a session">
        <p>Listen, don’t promise secrecy, write down their words, and tell the school’s DSL the same day. If a child is in immediate danger and the DSL can’t be reached, tell another teacher and/or call 999. Then log it here, so the project coordinator and the PI know.</p>
        <Button onClick={() => go('#safeguarding-log/new')}>Log a safeguarding concern</Button>
      </Callout>
      {role === 'pm' ? <Holders /> : null}
      {!records ? (
        <p>Loading…</p>
      ) : !records.length ? (
        <p>{holder ? 'Nothing has been logged.' : 'You haven’t logged any.'}</p>
      ) : (
        <ul className="mpmb-issue__list">
          {records.map((r) => (
            <li key={r.id}>
              <a className={`mpmb-issue__item mpmb-sglog__item is-${r.status}${r.immediateDanger ? ' is-danger' : ''}`} href={`#safeguarding-log/${r.id}`}>
                <span className="mpmb-issue__when">
                  {stamp(r.occurredAt)} · {r.schoolName || 'Not at a visit'} · {r.reporterName}
                </span>
                <span className="mpmb-issue__what">
                  <strong>{r.about}</strong>
                  {r.yearGroup ? ` · ${r.yearGroup}` : ''} · {lab(SOURCES, r.source)}
                  {r.immediateDanger ? ' · immediate danger' : ''}
                </span>
                <span className="mpmb-issue__meta">
                  <span className={`mpmb-issue__status is-${r.status === 'open' ? 'open' : 'cleared'}`}>{r.status === 'open' ? 'Open' : 'Closed'}</span> DSL: {r.dsl === 'yes' ? `told (${r.dslName})` : lab(DSL, r.dsl).toLowerCase()}
                  {holder && r.steps.length ? ` · ${r.steps.length} step${r.steps.length > 1 ? 's' : ''}` : ''}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Loading>
  );
}

function SgReport({ go, onSaved }: { go: (h: string) => void; onSaved: () => void }) {
  const ctx = useLoad<{ suggested: string | null; visits: { visitId: string; label: string; today: boolean }[] }>('issue-context');
  const [when, setWhen] = useState(localInput(new Date()));
  const [source, setSource] = useState('session');
  const [visitId, setVisitId] = useState('');
  const [about, setAbout] = useState('');
  const [yearGroup, setYearGroup] = useState('');
  const [account, setAccount] = useState('');
  const [danger, setDanger] = useState(false);
  const [immediate, setImmediate] = useState('');
  const [dsl, setDsl] = useState('');
  const [dslName, setDslName] = useState('');
  const [dslAt, setDslAt] = useState(localInput(new Date()));
  const [dslHow, setDslHow] = useState('in-person');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [id] = useState(() => newIssueId());
  useEffect(() => {
    if (!visitId && ctx.value) setVisitId(ctx.value.suggested ?? 'none');
  }, [ctx.value, visitId]);
  const save = async () => {
    setErr(null);
    if (!about.trim()) return setErr('Say who it is about.');
    if (account.trim().length < 10) return setErr('Write down what was said or seen.');
    if (!dsl) return setErr('Say whether the school’s DSL has been told.');
    if (dsl === 'yes' && !dslName.trim()) return setErr('Give the name of the DSL (or deputy) you told.');
    setBusy(true);
    try {
      await ask('sg-report', { report: { id, occurredAt: new Date(when).toISOString(), source, visitId: visitId === 'none' ? null : visitId, about, yearGroup, account, immediate, immediateDanger: danger, dsl, dslName, dslAt: dsl === 'yes' ? new Date(dslAt).toISOString() : null, dslHow: dsl === 'yes' ? dslHow : null } });
      setDone(id);
      onSaved();
    } catch (e) {
      const m = messageOf(e);
      setErr(typeof navigator !== 'undefined' && navigator.onLine === false ? 'No connection, so it hasn’t been logged. Keep your written note, make sure the DSL has been told, and log it here as soon as you have a connection. For safety, nothing is kept on this phone.' : m);
    } finally {
      setBusy(false);
    }
  };
  if (done)
    return (
      <>
        <Callout tone="success" title="Logged">
          <p>The PI and the project coordinator have been told there is a new concern to read. {dsl === 'yes' ? '' : 'If the school’s DSL hasn’t been told yet, tell them today.'}</p>
          <p>Please destroy any paper note once you have checked it is all here.</p>
        </Callout>
        <div className="mpmb-actions">
          <Button onClick={() => go(`#safeguarding-log/${done}`)}>See it</Button>
          <Button variant="secondary" onClick={() => go('#safeguarding-log')}>
            Back to the log
          </Button>
        </div>
      </>
    );
  return (
    <section className="mpmb-sglog__form" aria-labelledby="sg-new">
      <p>
        <Button variant="link" onClick={() => go('#safeguarding-log')}>
          ‹ Safeguarding log
        </Button>
      </p>
      <h2 className="mpmb-h2" id="sg-new">
        Log a safeguarding concern
      </h2>
      <Callout tone="important" title="First">
        <p>
          Tell the school’s <strong>DSL the same day</strong>, before you leave if you can. If a child is in immediate danger and the DSL can’t be reached, tell another teacher and/or call <a href="tel:999">999</a>. Logging it here does not replace that.
        </p>
      </Callout>
      <p className="mpmb-hint">Only the PI and the project coordinator can read what you write. It is never part of the research data.</p>
      <label className="mpmb-label" htmlFor="sg-when">
        When it happened (or was found)
      </label>
      <input id="sg-when" type="datetime-local" className="mpmb-input" value={when} onChange={(e) => setWhen(e.target.value)} />
      <fieldset className="mpmb-issue__fieldset">
        <legend className="mpmb-label">How it came up</legend>
        <div className="mpmb-issue__chips">
          {SOURCES.map(([k, l]) => (
            <button key={k} type="button" className={`mpmb-issue__chip${source === k ? ' is-on' : ''}`} aria-pressed={source === k} onClick={() => setSource(k)}>
              {l}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="mpmb-label" htmlFor="sg-visit">
        Visit
      </label>
      <select id="sg-visit" className="mpmb-select" value={visitId} onChange={(e) => setVisitId(e.target.value)}>
        {(ctx.value?.visits ?? []).map((v) => (
          <option key={v.visitId} value={v.visitId}>
            {v.label}
            {v.today ? ' (today)' : ''}
          </option>
        ))}
        <option value="none">Not at a visit</option>
      </select>
      <label className="mpmb-label" htmlFor="sg-about">
        Who it is about
      </label>
      <p className="mpmb-hint" id="sg-about-hint">
        Their first name and surname; or the study ID, if found in the data.
      </p>
      <input id="sg-about" className="mpmb-input" value={about} onChange={(e) => setAbout(e.target.value)} aria-describedby="sg-about-hint" autoComplete="off" />
      <label className="mpmb-label" htmlFor="sg-year">
        Year group or class (if known)
      </label>
      <input id="sg-year" className="mpmb-input" value={yearGroup} onChange={(e) => setYearGroup(e.target.value)} autoComplete="off" />
      <label className="mpmb-label" htmlFor="sg-account">
        What was said or seen
      </label>
      <p className="mpmb-hint" id="sg-account-hint">
        In their words, as exactly as you can, and what you saw. Just the facts: not what you think it means.
      </p>
      <textarea id="sg-account" className="mpmb-input mpmb-input--full" rows={6} value={account} onChange={(e) => setAccount(e.target.value)} aria-describedby="sg-account-hint" />
      <label className="mpmb-check mpmb-sglog__danger">
        <input type="checkbox" checked={danger} onChange={(e) => setDanger(e.target.checked)} /> A child was in immediate danger
      </label>
      <fieldset className="mpmb-issue__fieldset">
        <legend className="mpmb-label">Has the school’s DSL been told?</legend>
        <div className="mpmb-issue__chips">
          {DSL.filter(([k]) => source === 'data' || k !== 'not-needed').map(([k, l]) => (
            <button key={k} type="button" className={`mpmb-issue__chip${dsl === k ? ' is-on' : ''}`} aria-pressed={dsl === k} onClick={() => setDsl(k)}>
              {l}
            </button>
          ))}
        </div>
      </fieldset>
      {dsl === 'yes' ? (
        <div className="mpmb-sglog__dsl">
          <label className="mpmb-label" htmlFor="sg-dsl-name">
            Who you told
          </label>
          <input id="sg-dsl-name" className="mpmb-input" value={dslName} onChange={(e) => setDslName(e.target.value)} placeholder="Name and role, e.g. Mrs Patel, deputy DSL" />
          <label className="mpmb-label" htmlFor="sg-dsl-at">
            When
          </label>
          <input id="sg-dsl-at" type="datetime-local" className="mpmb-input" value={dslAt} onChange={(e) => setDslAt(e.target.value)} />
          <label className="mpmb-label" htmlFor="sg-dsl-how">
            How
          </label>
          <select id="sg-dsl-how" className="mpmb-select" value={dslHow} onChange={(e) => setDslHow(e.target.value)}>
            {HOW.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
      ) : dsl === 'not-yet' || dsl === 'not-reachable' ? (
        <Callout tone="warning">
          <p>{dsl === 'not-yet' ? 'Tell the DSL (or deputy) today, then add a note to this report to say you have.' : 'Tell another member of staff now and keep trying the DSL. The project coordinator will follow it up.'}</p>
        </Callout>
      ) : null}
      <label className="mpmb-label" htmlFor="sg-immediate">
        What you did straight away (optional)
      </label>
      <p className="mpmb-hint" id="sg-immediate-hint">
        For example, who else you told, or whether 999 was called.
      </p>
      <textarea id="sg-immediate" className="mpmb-input mpmb-input--full" rows={2} value={immediate} onChange={(e) => setImmediate(e.target.value)} aria-describedby="sg-immediate-hint" />
      <ErrorLine error={err} />
      <div className="mpmb-actions">
        <Button onClick={() => void save()} loading={busy}>
          Log the concern
        </Button>
      </div>
    </section>
  );
}

function SgRecord({ rec: r, holder, back, reload }: { rec: Rec; holder: boolean; back: () => void; reload: () => Promise<void> }) {
  const [kind, setKind] = useState(holder ? 'action' : 'addendum');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const add = async (k: string, t: string) => {
    setBusy(true);
    setErr(null);
    try {
      await ask('sg-step', { id: r.id, kind: k, text: t });
      setText('');
      await reload();
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const kinds: [string, string][] = holder ? (r.status === 'open' ? [['action', 'An action taken'], ['note', 'A note'], ['closed', 'Close it, with the outcome']] : [['note', 'A note']]) : [['addendum', 'Something to add']];
  const k = kinds.some(([x]) => x === kind) ? kind : kinds[0][0];
  return (
    <>
      <p>
        <Button variant="link" onClick={back}>
          ‹ Safeguarding log
        </Button>
      </p>
      <div className={`mpmb-issue__entry mpmb-sglog__entry is-${r.status}${r.immediateDanger ? ' is-danger' : ''}`}>
        <h2 className="mpmb-h2">
          {r.about}
          {r.yearGroup ? `, ${r.yearGroup}` : ''}
        </h2>
        <p className="mpmb-hint">
          {stamp(r.occurredAt)} · {r.schoolName || 'Not at a visit'} · {lab(SOURCES, r.source)} · logged by {r.reporterName}, {stamp(r.receivedAt)}
        </p>
        <p>
          <span className={`mpmb-issue__status is-${r.status === 'open' ? 'open' : 'cleared'}`}>{r.status === 'open' ? 'Open' : 'Closed'}</span>
          {r.immediateDanger ? <strong className="mpmb-sglog__flag"> Immediate danger</strong> : null}
        </p>
        <h3 className="mpmb-h4">What was said or seen</h3>
        <p className="mpmb-issue__notebody">{r.account}</p>
        <h3 className="mpmb-h4">The school’s DSL</h3>
        <p>{r.dsl === 'yes' ? `Told: ${r.dslName}${r.dslAt ? `, ${stamp(r.dslAt)}` : ''}${r.dslHow ? `, ${lab(HOW, r.dslHow).toLowerCase()}` : ''}.` : `${lab(DSL, r.dsl)}.`}</p>
        {r.immediate ? (
          <>
            <h3 className="mpmb-h4">Done straight away</h3>
            <p className="mpmb-issue__notebody">{r.immediate}</p>
          </>
        ) : null}
        {r.outcome ? (
          <>
            <h3 className="mpmb-h4">Outcome</h3>
            <p className="mpmb-issue__notebody">{r.outcome}</p>
          </>
        ) : null}
      </div>
      <h3 className="mpmb-h3">{holder ? 'What has been done' : 'What you added'}</h3>
      {r.steps.length ? (
        <ul className="mpmb-issue__comments">
          {r.steps.map((x) => (
            <li key={x.id} className={`is-${x.kind}`}>
              <span className="mpmb-hint">
                {STEP[x.kind] ?? x.kind} · {x.byName} · {stamp(x.at)}
              </span>
              {x.text ? <p>{x.text}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mpmb-hint">Nothing yet.</p>
      )}
      {!holder ? <p className="mpmb-hint">The PI and the project coordinator record what is done; you see whether it is still open.</p> : null}
      <section className="mpmb-equip__form" aria-label="Add to this record">
        <div className="mpmb-issue__chips">
          {kinds.map(([x, l]) => (
            <button key={x} type="button" className={`mpmb-issue__chip${k === x ? ' is-on' : ''}`} aria-pressed={k === x} onClick={() => setKind(x)}>
              {l}
            </button>
          ))}
        </div>
        <label className="mpmb-label" htmlFor="sg-step">
          {k === 'closed' ? 'The outcome' : k === 'action' ? 'What was done, by whom' : 'Add'}
        </label>
        <textarea id="sg-step" className="mpmb-input mpmb-input--full" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={k === 'action' ? 'e.g. PI reviewed; coordinator phoned the DSL to confirm it was received' : k === 'closed' ? 'e.g. DSL confirmed it is being handled under the school’s procedures; nothing further for us' : ''} />
        <ErrorLine error={err} />
        <div className="mpmb-actions">
          <Button onClick={() => void add(k, text)} loading={busy} disabled={!text.trim()}>
            {k === 'closed' ? 'Close it' : 'Add'}
          </Button>
          {holder && r.status === 'closed' ? (
            <Button variant="ghost" onClick={() => void add('reopened', '')}>
              Reopen
            </Button>
          ) : null}
        </div>
      </section>
      <p className="mpmb-hint">Nothing in this record can be changed or deleted: each step is added, with who and when.</p>
    </>
  );
}

function Holders() {
  const { value, load } = useLoad<{ settings: { holders: string[] } }>('sg-settings');
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!value) return null;
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await ask('sg-save-settings', { holders: (text ?? '').split(/[\s,;]+/).filter(Boolean) });
      setText(null);
      await load();
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="mpmb-issue__filters">
      <summary>Who holds the log</summary>
      <p>The project manager(s), and: {value.settings.holders.join(', ') || 'no one else'}. They can read every record and are emailed (with no details) when one is logged.</p>
      {text === null ? (
        <Button variant="secondary" onClick={() => setText(value.settings.holders.join(', '))}>
          Change
        </Button>
      ) : (
        <>
          <label className="mpmb-label" htmlFor="sg-holders">
            Their portal email addresses (the PI by default)
          </label>
          <input id="sg-holders" className="mpmb-input mpmb-input--full" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="mpmb-actions">
            <Button onClick={() => void save()} loading={busy}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setText(null)}>
              Cancel
            </Button>
          </div>
        </>
      )}
      <ErrorLine error={err} />
    </details>
  );
}
