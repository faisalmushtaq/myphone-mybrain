import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { TextField } from '../components/ui/Field';
import { ask, messageOf } from './api';
import { eegManifest, EEG_TEMPLATE, myselfIdentifiers, myselfParticipants, readTable } from './linkageFiles';
import { ErrorLine, Loading, useLoad } from './TeamViews';
import { saveFile, stamp, type Role } from './types';

/**
 * The linkage registry (4 November 2026): one study ID a young person across
 * the website, MySelf and EEG. School study › Linkage, for the project
 * manager and the research team. The matching runs on the server
 * (firebase/functions/src/linkage.ts); this is where a person decides what it
 * could not, and where EEG manifests (and, until MySelf can be read
 * directly, MySelf's files) come in.
 */

type Kind = 'website' | 'myself' | 'eeg';
interface Card {
  key: string;
  kind: Kind;
  ref: string;
  missing?: boolean;
  [k: string]: unknown;
}
interface PersonCard {
  studyId: string;
  status?: string;
  statusReason?: string;
  records: Card[];
}
interface SourceCounts {
  total: number;
  linked: number;
  awaiting: number;
  unlinked: number;
}
interface Summary {
  people: number;
  active: number;
  withdrawn: number;
  pending: number;
  multiSource: number;
  lastRunAt: string | null;
  lastRunBy: string;
  sources: Record<Kind, SourceCounts>;
  myself: { synced?: boolean; checkedAt?: string; participants?: number; research?: { ok: boolean; error: string }; identity?: { ok: boolean; error: string } } | null;
  perSchool: { school: string; people: number; website: number; myself: number; eeg: number; allThree: number }[];
}
interface QueueItem {
  id: string;
  tier: string;
  score: number;
  matchedOn: string[];
  reason: string;
  others: number;
  record: Card;
  person: PersonCard;
}

const KIND_LABEL: Record<Kind, string> = { website: 'Website', myself: 'MySelf', eeg: 'EEG' };
const TIER_LABEL: Record<string, string> = { exact: 'Same ID', variant: 'ID under a usual slip', upn: 'Same UPN', fuzzy: 'Close in name and date of birth', decision: 'Decided', new: 'New' };
const SECTIONS = [
  ['', 'Overview'],
  ['review', 'Review'],
  ['eeg', 'EEG recordings'],
  ['myself', 'MySelf'],
  ['audit', 'History'],
] as const;

export function Linkage({ role, hash, go }: { role: Role; hash: string; go: (h: string) => void }) {
  const parts = hash.replace(/^#/, '').split('/');
  const section = parts[1] ?? '';
  return (
    <>
      <nav className="mpmb-link__nav" aria-label="Linkage">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#linkage${id ? `/${id}` : ''}`} className={`mpmb-link__navitem${section === id || (id === '' && section === 'person') ? ' is-current' : ''}`} aria-current={section === id ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>
      {section === 'review' ? <Review /> : section === 'eeg' ? <EegView /> : section === 'myself' ? <MyselfView role={role} /> : section === 'audit' ? <History /> : section === 'person' && parts[2] ? <PersonView studyId={parts[2]} role={role} go={go} /> : <Overview go={go} />}
    </>
  );
}

/* ── Overview and search ──────────────────────────────────────────────── */

function Overview({ go }: { go: (h: string) => void }) {
  const { value, error, load } = useLoad<{ summary: Summary }>('link-summary');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [ran, setRan] = useState<string | null>(null);
  const run = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const r = await ask<{ result: { newPeople: number; autoLinks: number; candidates: number; myself: { synced: boolean } } }>('link-run');
      setRan(`Done: ${r.result.newPeople} new study IDs, ${r.result.autoLinks} linked on their own, ${r.result.candidates} waiting for review${r.result.myself.synced ? '; MySelf read' : '; MySelf not read'}.`);
      await load();
    } catch (e) {
      setRunError(messageOf(e));
    } finally {
      setRunning(false);
    }
  };
  const s = value?.summary;
  return (
    <Loading error={error}>
      {!s ? (
        <p>Loading…</p>
      ) : (
        <>
          <p className="mpmb-hint">Each young person gets one study ID (sub-0001 …), given in order and never reused, joining their website record, MySelf survey codes and EEG recordings. Matching runs every hour and whenever new records arrive; only certain matches (the same ID, a usual slip in a name or date, or the same UPN, unique on both sides and never twins) link on their own. Everything else waits for you under Review.</p>
          <div className="mpmb-link__stats">
            <Stat n={s.people} label="study IDs" />
            <Stat n={s.multiSource} label="with more than one source" />
            <Stat n={s.pending} label="suggestions to review" tone={s.pending ? 'warn' : undefined} onClick={() => go('#linkage/review')} />
            <Stat n={s.withdrawn} label="withdrawn" />
          </div>
          <table className="mpmb-link__table">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Records</th>
                <th scope="col">With a study ID</th>
                <th scope="col">Waiting for review</th>
                <th scope="col">No study ID yet</th>
              </tr>
            </thead>
            <tbody>
              {(['website', 'myself', 'eeg'] as Kind[]).map((k) => (
                <tr key={k}>
                  <th scope="row">{KIND_LABEL[k]}</th>
                  <td>{s.sources[k].total}</td>
                  <td>{s.sources[k].linked}</td>
                  <td>{s.sources[k].awaiting}</td>
                  <td>{s.sources[k].unlinked}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!s.myself?.identity?.ok ? (
            <Callout tone="warning" title="MySelf not connected">
              <p>
                The portal cannot read MySelf yet, so MySelf codes come only from files uploaded by hand. <a href="#linkage/myself">How to connect it</a>.
              </p>
            </Callout>
          ) : null}
          <p className="mpmb-hint">{s.lastRunAt ? `Last matching run ${stamp(s.lastRunAt)} (${s.lastRunBy}).` : 'No matching run yet.'}</p>
          <div className="mpmb-actions">
            <Button onClick={() => void run()} loading={running}>
              Run matching now
            </Button>
          </div>
          {ran ? <p role="status">{ran}</p> : null}
          <ErrorLine error={runError} />
          <Search go={go} />
          {s.perSchool.length ? (
            <>
              <h2 className="mpmb-h2">By school</h2>
              <table className="mpmb-link__table">
                <thead>
                  <tr>
                    <th scope="col">School</th>
                    <th scope="col">Study IDs</th>
                    <th scope="col">Website</th>
                    <th scope="col">MySelf</th>
                    <th scope="col">EEG</th>
                    <th scope="col">All three</th>
                  </tr>
                </thead>
                <tbody>
                  {s.perSchool.map((r) => (
                    <tr key={r.school}>
                      <th scope="row">{r.school}</th>
                      <td>{r.people}</td>
                      <td>{r.website}</td>
                      <td>{r.myself}</td>
                      <td>{r.eeg}</td>
                      <td>{r.allThree}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </>
      )}
    </Loading>
  );
}

function Stat({ n, label, tone, onClick }: { n: number; label: string; tone?: 'warn'; onClick?: () => void }) {
  const body = (
    <>
      <strong>{n}</strong>
      <span>{label}</span>
    </>
  );
  return onClick ? (
    <button type="button" className={`mpmb-link__stat${tone ? ` is-${tone}` : ''}`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={`mpmb-link__stat${tone ? ` is-${tone}` : ''}`}>{body}</div>
  );
}

function Search({ go }: { go: (h: string) => void }) {
  const [q, setQ] = useState('');
  const [result, setResult] = useState<{ people: PersonCard[]; records: (Card & { awaiting: boolean })[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await ask('link-search', { q }));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mpmb-link__search">
      <h2 className="mpmb-h2">Find someone</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
        className="mpmb-link__searchform"
      >
        <TextField id="link-q" label="Study ID, name, website label or reference, MySelf code, UPN or EEG recording" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" loading={busy}>
          Search
        </Button>
      </form>
      <ErrorLine error={error} />
      {result ? (
        <ul className="mpmb-tools__list">
          {result.people.map((p) => (
            <li key={p.studyId} className="mpmb-tools__row mpmb-tools__row--stack">
              <a href={`#linkage/person/${p.studyId}`} onClick={(e) => (e.preventDefault(), go(`#linkage/person/${p.studyId}`))}>
                <strong>{p.studyId}</strong>
              </a>
              <span className="mpmb-hint">
                {p.status === 'withdrawn' ? 'Withdrawn · ' : ''}
                {p.records.map(oneLine).join(' · ')}
              </span>
            </li>
          ))}
          {result.records.map((r) => (
            <li key={r.key} className="mpmb-tools__row mpmb-tools__row--stack">
              <strong>{oneLine(r)}</strong>
              <span className="mpmb-hint">{r.awaiting ? 'No study ID yet: waiting for review' : 'No study ID yet'}</span>
            </li>
          ))}
          {!result.people.length && !result.records.length ? <li className="mpmb-tools__row">Nothing found.</li> : null}
        </ul>
      ) : null}
    </section>
  );
}

const oneLine = (r: Card) => (r.kind === 'website' ? `Website ${String(r.label ?? r.ref)} ${String(r.name ?? '')}` : r.kind === 'myself' ? `MySelf ${r.ref}` : `EEG ${r.ref} ${String(r.name ?? '')}`).trim();

/* ── Review ───────────────────────────────────────────────────────────── */

function Review() {
  const { value, error, load } = useLoad<{ items: QueueItem[]; total: number }>('link-queue');
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const items = (value?.items ?? []).filter((x) => !done.includes(x.id));
  const item = items[Math.min(index, Math.max(0, items.length - 1))];
  const decide = useCallback(
    async (decision: 'same' | 'different') => {
      if (!item || busy) return;
      setBusy(true);
      setErr(null);
      try {
        await ask('link-decide', { id: item.id, decision });
        // "Same" settles the record: its other suggestions go too.
        setDone((d) => [...d, ...(decision === 'same' ? (value?.items ?? []).filter((x) => x.record.key === item.record.key).map((x) => x.id) : [item.id])]);
      } catch (e) {
        setErr(messageOf(e));
      } finally {
        setBusy(false);
      }
    },
    [item, busy, value],
  );
  const skip = useCallback(() => setIndex((i) => (items.length ? (i + 1) % items.length : 0)), [items.length]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 's' || e.key === 'S') void decide('same');
      else if (e.key === 'd' || e.key === 'D') void decide('different');
      else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowRight') skip();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [decide, skip]);
  return (
    <Loading error={error}>
      {!value ? (
        <p>Loading…</p>
      ) : !item ? (
        <>
          <p>Nothing waiting for review.</p>
          <div className="mpmb-actions">
            <Button variant="secondary" onClick={() => (setDone([]), void load())}>
              Check again
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mpmb-hint">
            {items.length} waiting{value.total > value.items.length ? ` (the first ${value.items.length} of ${value.total})` : ''}. Is the record on the left the same young person as the study ID on the right? Keys: <kbd>S</kbd> same, <kbd>D</kbd> different, <kbd>K</kbd> skip. A decision is kept: the pair is never suggested again.
          </p>
          <div className="mpmb-link__why">
            <span className={`mpmb-link__tier is-${item.tier}`}>{TIER_LABEL[item.tier] ?? item.tier}</span>
            {item.tier === 'fuzzy' ? <span>score {item.score.toFixed(2)}</span> : null}
            <span>{item.matchedOn.join(' · ')}</span>
          </div>
          <p className="mpmb-link__reason">{item.reason}</p>
          <div className="mpmb-link__pair">
            <div className="mpmb-link__side">
              <p className="mpmb-kicker">Record without a study ID</p>
              <RecordCard card={item.record} />
            </div>
            <div className="mpmb-link__side">
              <p className="mpmb-kicker">
                Study ID {item.person.studyId}
                {item.person.status === 'withdrawn' ? ' · withdrawn' : ''}
              </p>
              {item.person.records.map((r) => (
                <RecordCard key={r.key} card={r} />
              ))}
            </div>
          </div>
          <div className="mpmb-actions mpmb-link__decide">
            <Button onClick={() => void decide('same')} loading={busy}>
              Same person (S)
            </Button>
            <Button variant="secondary" onClick={() => void decide('different')} disabled={busy}>
              Different (D)
            </Button>
            <Button variant="ghost" onClick={skip} disabled={busy}>
              Skip (K)
            </Button>
          </div>
          <ErrorLine error={err} />
        </>
      )}
    </Loading>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="mpmb-link__field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function RecordCard({ card }: { card: Card }) {
  const [names, setNames] = useState<{ givenName: string; familyName: string; dateOfBirth: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (card.missing) return <div className="mpmb-link__card">{KIND_LABEL[card.kind]} {card.ref}: no longer in its source.</div>;
  const show = async () => {
    setBusy(true);
    setErr(null);
    try {
      setNames((await ask<{ names: { givenName: string; familyName: string; dateOfBirth: string | null } }>('link-myself-names', { code: card.ref })).names);
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const s = (k: string) => (card[k] === null || card[k] === undefined ? '' : String(card[k]));
  return (
    <div className={`mpmb-link__card is-${card.kind}`}>
      <p className="mpmb-link__cardhead">
        <span className="mpmb-link__kind">{KIND_LABEL[card.kind]}</span> {card.kind === 'website' ? s('label') || card.ref : card.ref}
      </p>
      <dl>
        {card.kind === 'website' ? (
          <>
            <Field label="Name">{s('name')}</Field>
            <Field label="Date of birth">{s('dob')}</Field>
            <Field label="School">{s('school')}</Field>
            <Field label="Year">{s('yearGroup')}</Field>
            <Field label="Reference">{s('referenceCode')}</Field>
            <Field label="UPN">{s('upn')}</Field>
            <Field label="Opted out">{s('withdrawn')}</Field>
          </>
        ) : card.kind === 'myself' ? (
          <>
            <Field label="Sites">{((card.sites as string[]) ?? []).join(', ')}</Field>
            <Field label="Sittings">{`${s('sittings')}${card.firstSitting ? `: ${s('firstSitting')}${card.lastSitting !== card.firstSitting ? ` to ${s('lastSitting')}` : ''}` : ''}`}</Field>
            <Field label="Release">{((card.releases as string[]) ?? []).join(', ')}</Field>
            <Field label="UPN">{s('upn')}</Field>
            <Field label="Name">{names ? `${names.givenName} ${names.familyName}${names.dateOfBirth ? `, born ${names.dateOfBirth}` : ''}` : ''}</Field>
          </>
        ) : (
          <>
            <Field label="Name">{s('name')}</Field>
            <Field label="Date of birth">{s('dob')}</Field>
            <Field label="Sex">{s('sex')}</Field>
            <Field label="Ethnicity">{s('ethnicity')}</Field>
            <Field label="Recorded">{s('recordingDate')}</Field>
            <Field label="Site">{s('school') || s('site')}</Field>
          </>
        )}
      </dl>
      {card.kind === 'myself' && !names ? (
        <Button variant="link" onClick={() => void show()} loading={busy}>
          Show MySelf’s name for this code (logged)
        </Button>
      ) : null}
      <ErrorLine error={err} />
    </div>
  );
}

/* ── One study ID ─────────────────────────────────────────────────────── */

interface PersonDetail {
  person: PersonCard & { createdAt: string | null; links: { key: string; tier: string; matchedOn: string[]; how: string; by: string; at: string | null }[] };
  pending: { id: string; tier: string; record: Card }[];
  decisions: { record: string; decision: string; by: string; at: string | null; note: string }[];
  history: { at: string | null; by: string; action: string; details: Record<string, unknown> }[];
}

function PersonView({ studyId, role, go }: { studyId: string; role: Role; go: (h: string) => void }) {
  const { value, error, load } = useLoad<PersonDetail>('link-person', { studyId });
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const unlink = async () => {
    setBusy(true);
    setErr(null);
    try {
      await ask('link-unlink', { studyId, recordKey: unlinking, reason });
      setUnlinking(null);
      setReason('');
      await load();
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Loading error={error}>
      {!value ? (
        <p>Loading…</p>
      ) : (
        <>
          <p>
            <Button variant="link" onClick={() => go('#linkage')}>
              ‹ Linkage
            </Button>
          </p>
          <h2 className="mpmb-h2">
            {studyId}
            {value.person.status !== 'active' ? <span className="mpmb-link__status"> · {value.person.status}{value.person.statusReason ? ` (${value.person.statusReason})` : ''}</span> : null}
          </h2>
          <p className="mpmb-hint">Study ID since {stamp(value.person.createdAt)}.</p>
          <div className="mpmb-link__records">
            {value.person.records.map((r) => {
              const how = value.person.links.find((l) => l.key === r.key);
              return (
                <div key={r.key}>
                  <RecordCard card={r} />
                  <p className="mpmb-hint">{how ? `${how.how === 'new' ? 'Started this study ID' : how.how === 'decision' ? `Linked by ${how.by}` : `Linked on its own: ${TIER_LABEL[how.tier] ?? how.tier}`}${how.matchedOn.length ? ` (${how.matchedOn.join('; ')})` : ''}, ${stamp(how.at)}` : ''}</p>
                  {role === 'pm' ? (
                    unlinking === r.key ? (
                      <div className="mpmb-link__unlink">
                        <TextField id={`why-${r.key}`} label="Why is this not them? (kept in the history)" value={reason} onChange={(e) => setReason(e.target.value)} />
                        <div className="mpmb-actions">
                          <Button variant="secondary" onClick={() => void unlink()} loading={busy}>
                            Take it off this study ID
                          </Button>
                          <Button variant="ghost" onClick={() => setUnlinking(null)}>
                            Cancel
                          </Button>
                        </div>
                        <ErrorLine error={err} />
                      </div>
                    ) : (
                      <Button variant="link" onClick={() => (setUnlinking(r.key), setReason(''))}>
                        Unlink…
                      </Button>
                    )
                  ) : null}
                </div>
              );
            })}
          </div>
          {value.pending.length ? (
            <Callout title="Waiting for review">
              <p>{value.pending.length} record{value.pending.length > 1 ? 's' : ''} may also be this young person. <a href="#linkage/review">Review</a>.</p>
            </Callout>
          ) : null}
          <h3 className="mpmb-h3">History</h3>
          <ul className="mpmb-tools__list">
            {value.history.map((h, i) => (
              <li key={i} className="mpmb-tools__row mpmb-tools__row--stack">
                <span>
                  <strong>{h.action}</strong> · {stamp(h.at)} · {h.by}
                </span>
                <span className="mpmb-hint">{JSON.stringify(h.details)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Loading>
  );
}

/* ── EEG recordings ───────────────────────────────────────────────────── */

interface Recording {
  recordingId: string;
  name: string;
  dob: string | null;
  sex: string;
  recordingDate: string | null;
  site: string;
  school: string;
  task: string;
  studyId: string | null;
  status: string;
}

function EegView() {
  const { value, error, load } = useLoad<{ recordings: Recording[] }>('link-eeg-list');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ saved: number; added: number; updated: number; problems: string[] } | null>(null);
  const [preview, setPreview] = useState<{ fileName: string; rows: Record<string, string>[] } | null>(null);
  const choose = async (file: File | undefined) => {
    setErr(null);
    setOutcome(null);
    if (!file) return;
    try {
      const m = eegManifest(await readTable(file));
      if (m.problem) throw new Error(m.problem);
      if (!m.rows.length) throw new Error('The manifest has no rows.');
      setPreview({ fileName: file.name, rows: m.rows });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const send = async () => {
    if (!preview) return;
    setBusy(true);
    setErr(null);
    try {
      setOutcome(await ask('link-eeg-upload', { rows: preview.rows, fileName: preview.fileName }));
      setPreview(null);
      await load();
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="mpmb-hint">Upload the EEG manifest (CSV or Excel): one row a recording, with the recording id, the young person’s first and last name, date of birth (dd/mm/yyyy), sex, ethnicity, the recording date and the school or site. The file is read in this browser; the names are kept in the portal (for the project manager and research team only) until {180} days after the recording has its study ID, then removed. Sex and ethnicity only break ties between close matches.</p>
      <div className="mpmb-actions">
        <Button variant="secondary" onClick={() => saveFile('eeg-manifest-template.csv', EEG_TEMPLATE, 'text/csv;charset=utf-8')}>
          Download the template
        </Button>
        <label className="mpmb-btn mpmb-btn--primary mpmb-link__file">
          <span>Choose a manifest…</span>
          <input type="file" accept=".csv,.tsv,.txt,.xlsx" onChange={(e) => void choose(e.target.files?.[0])} data-testid="eeg-file" />
        </label>
      </div>
      <ErrorLine error={err} />
      {preview ? (
        <Callout title={`${preview.rows.length} recording${preview.rows.length === 1 ? '' : 's'} in ${preview.fileName}`}>
          <p>
            First: {preview.rows[0].recordingId}, {preview.rows[0].firstName} {preview.rows[0].lastName}, born {preview.rows[0].dob}. A recording already uploaded is updated.
          </p>
          <div className="mpmb-actions">
            <Button onClick={() => void send()} loading={busy}>
              Add them and match
            </Button>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Cancel
            </Button>
          </div>
        </Callout>
      ) : null}
      {outcome ? (
        <Callout tone={outcome.problems.length ? 'warning' : undefined} title={`${outcome.added} added, ${outcome.updated} updated`}>
          {outcome.problems.length ? (
            <ul>
              {outcome.problems.slice(0, 20).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <p>All rows read. Matching has run; anything uncertain is under Review.</p>
          )}
        </Callout>
      ) : null}
      <Loading error={error}>
        <h2 className="mpmb-h2">Recordings</h2>
        {!value ? (
          <p>Loading…</p>
        ) : !value.recordings.length ? (
          <p>No manifest uploaded yet.</p>
        ) : (
          <div className="mpmb-link__scroll">
            <table className="mpmb-link__table">
              <thead>
                <tr>
                  <th scope="col">Recording</th>
                  <th scope="col">Recorded</th>
                  <th scope="col">Name</th>
                  <th scope="col">Born</th>
                  <th scope="col">Site</th>
                  <th scope="col">Study ID</th>
                </tr>
              </thead>
              <tbody>
                {value.recordings.map((r) => (
                  <tr key={r.recordingId}>
                    <th scope="row">{r.recordingId}</th>
                    <td>{r.recordingDate ?? ''}</td>
                    <td>{r.name || <span className="mpmb-hint">removed</span>}</td>
                    <td>{r.dob ?? ''}</td>
                    <td>{r.school || r.site}</td>
                    <td>{r.studyId ? <a href={`#linkage/person/${r.studyId}`}>{r.studyId}</a> : <span className="mpmb-hint">{r.status}</span>}{r.studyId && r.status === 'withdrawn' ? ' (withdrawn)' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loading>
    </>
  );
}

/* ── MySelf ───────────────────────────────────────────────────────────── */

interface MyselfState {
  status: { mode: string; researchProject: string; identityProject: string; study: string; research: { ok: boolean; error: string }; identity: { ok: boolean; error: string } };
  held: number;
  grant: string;
  settings: { siteMap: Record<string, string> };
}

function MyselfView({ role }: { role: Role }) {
  const { value, error, load } = useLoad<MyselfState>('link-myself-status');
  const schools = useLoad<{ schools: { id: string; name: string }[] }>('link-settings');
  const [parts, setParts] = useState<{ name: string; rows: unknown[] } | null>(null);
  const [ids, setIds] = useState<{ name: string; rows: unknown[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [map, setMap] = useState<string | null>(null);
  const connected = value?.status.research.ok && value?.status.identity.ok;
  const read = async (file: File | undefined, which: 'parts' | 'ids') => {
    setErr(null);
    if (!file) return;
    try {
      const table = await readTable(file);
      const r = which === 'parts' ? myselfParticipants(table) : myselfIdentifiers(table);
      if (r.problem) throw new Error(r.problem);
      (which === 'parts' ? setParts : setIds)({ name: file.name, rows: r.rows });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const upload = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await ask<{ saved: number; withNames: number }>('link-myself-upload', { participants: parts?.rows ?? [], identifiers: ids?.rows ?? [] });
      setDone(`${r.saved} MySelf codes held${r.withNames ? `; ${r.withNames} names used for this matching run and not kept` : ''}.`);
      setParts(null);
      setIds(null);
      await load();
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const saveMap = async () => {
    setBusy(true);
    setErr(null);
    try {
      const siteMap: Record<string, string> = {};
      for (const line of (map ?? '').split('\n')) {
        const [k, v] = line.split('=').map((x) => x?.trim());
        if (k && v) siteMap[k] = v;
      }
      await ask('link-save-settings', { siteMap });
      setMap(null);
      await load();
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Loading error={error}>
      {!value ? (
        <p>Loading…</p>
      ) : (
        <>
          {connected ? (
            <Callout title="MySelf connected">
              <p>
                The portal reads MySelf directly ({value.status.researchProject} and {value.status.identityProject}, study {value.status.study}) every hour: each code’s sites, sitting dates, release and UPN. Names are read only to match and when you ask to see one, and are never kept here. {value.held} MySelf codes held.
              </p>
            </Callout>
          ) : (
            <Callout tone="warning" title="MySelf not connected">
              <p>
                {!value.status.research.ok ? `${value.status.researchProject}: ${value.status.research.error} ` : ''}
                {!value.status.identity.ok ? `${value.status.identityProject}: ${value.status.identity.error}` : ''}
              </p>
              <p>To connect it, someone who owns the MySelf projects runs this in Google Cloud Shell (the script is consent-app/firebase/scripts/grant-myself-read.sh):</p>
              <pre className="mpmb-link__code">{value.grant}</pre>
              <p>Until then, upload MySelf’s files below. {value.held} MySelf codes held from uploads.</p>
            </Callout>
          )}
          <h2 className="mpmb-h2">Upload MySelf’s files</h2>
          <p className="mpmb-hint">From MySelf’s export: the BIDS participants.tsv (codes, sites, first sitting) and, if you have it, the identifiers CSV (names, date of birth, address, UPN). The names are used for one matching run and not kept.</p>
          <div className="mpmb-actions">
            <label className="mpmb-btn mpmb-btn--secondary mpmb-link__file">
              <span>{parts ? `participants.tsv: ${parts.rows.length} codes` : 'Choose participants.tsv…'}</span>
              <input type="file" accept=".tsv,.csv,.txt" onChange={(e) => void read(e.target.files?.[0], 'parts')} />
            </label>
            <label className="mpmb-btn mpmb-btn--secondary mpmb-link__file">
              <span>{ids ? `identifiers: ${ids.rows.length} rows` : 'Choose the identifiers CSV…'}</span>
              <input type="file" accept=".csv,.tsv,.txt,.xlsx" onChange={(e) => void read(e.target.files?.[0], 'ids')} />
            </label>
            <Button onClick={() => void upload()} loading={busy} disabled={!parts && !ids}>
              Add and match
            </Button>
          </div>
          {done ? <p role="status">{done}</p> : null}
          <ErrorLine error={err} />
          <h2 className="mpmb-h2">MySelf sites and the website’s schools</h2>
          <p className="mpmb-hint">A MySelf study code starts with the site’s letters (GSAL01 is site GSAL). Saying which school each site is keeps close-name suggestions within one school.</p>
          {map === null ? (
            <>
              <ul className="mpmb-tools__list">
                {Object.entries(value.settings.siteMap).map(([k, v]) => (
                  <li key={k} className="mpmb-tools__row">
                    {k} = {schools.value?.schools.find((s) => s.id === v)?.name ?? v}
                  </li>
                ))}
                {!Object.keys(value.settings.siteMap).length ? <li className="mpmb-tools__row">None yet.</li> : null}
              </ul>
              {role === 'pm' ? (
                <Button variant="link" onClick={() => setMap(Object.entries(value.settings.siteMap).map(([k, v]) => `${k}=${v}`).join('\n'))}>
                  Change…
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <label className="mpmb-label" htmlFor="sitemap">
                One a line: SITE=school id ({(schools.value?.schools ?? []).map((s) => s.id).join(', ')})
              </label>
              <textarea id="sitemap" className="mpmb-input mpmb-input--full" rows={5} value={map} onChange={(e) => setMap(e.target.value)} />
              <div className="mpmb-actions">
                <Button onClick={() => void saveMap()} loading={busy}>
                  Save
                </Button>
                <Button variant="ghost" onClick={() => setMap(null)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </Loading>
  );
}

/* ── History ──────────────────────────────────────────────────────────── */

function History() {
  const { value, error } = useLoad<{ entries: { id: string; at: string | null; by: string; action: string; target: string; details: Record<string, unknown> }[] }>('link-audit');
  return (
    <Loading error={error}>
      <p className="mpmb-hint">Everything that changed in the registry, newest first: every study ID given, every link (automatic or decided), every unlink, upload and look at a MySelf name.</p>
      <ul className="mpmb-tools__list mpmb-portal__audit">
        {(value?.entries ?? []).map((e) => (
          <li key={e.id} className="mpmb-tools__row mpmb-tools__row--stack">
            <span>
              <strong>{e.action}</strong> · {stamp(e.at)} · {e.by} · {/^sub-/.test(e.target) ? <a href={`#linkage/person/${e.target}`}>{e.target}</a> : e.target}
            </span>
            <span className="mpmb-hint">{Object.keys(e.details).length ? JSON.stringify(e.details) : ''}</span>
          </li>
        ))}
      </ul>
    </Loading>
  );
}
