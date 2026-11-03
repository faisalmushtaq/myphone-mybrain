import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { SelectField, TextField } from '../components/ui/Field';
import { ask, messageOf } from './api';
import { StateBadge } from './RaViews';
import { ASSIGNMENT_LABEL, AVAILABILITY_LABEL, dayLines, longDate, ROLE_LABEL, saveFile, shortDate, stamp, todayIso, VISIT_STATUS_LABEL, visitWhen, type AssignmentStatus, type Availability, type Counts, type DocRow, type DocType, type PortalUser, type Role, type School, type Settings, type Visit, type VisitDay, type VisitStatus } from './types';

/** Loads with an action, shows loading and errors, and offers a reload. */
function useLoad<T>(action: string, data: Record<string, unknown> = {}) {
  const key = JSON.stringify(data);
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setValue(await ask<T>(action, JSON.parse(key) as Record<string, unknown>));
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, [action, key]);
  useEffect(() => {
    void load();
  }, [load]);
  return { value, error, load };
}

function Loading({ error, children }: { error: string | null; children: ReactNode }) {
  if (error)
    return (
      <Callout tone="warning" role="alert">
        {error}
      </Callout>
    );
  return <>{children}</>;
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="mpmb-error" role="alert">
      {error}
    </p>
  ) : null;
}

/* ── Overview ─────────────────────────────────────────────────────────── */

interface PersonRow extends PortalUser {
  counts: Counts;
  documents: { typeId: string; label: string; state: DocRow['state'] }[];
  ready: boolean;
  reasons: string[];
  toCheck: number;
}

interface VisitRow extends Visit {
  confirmed: number;
  offered: number;
}

export function TeamHome({ role, go }: { role: Role; go: (hash: string) => void }) {
  const people = useLoad<{ people: PersonRow[] }>('people');
  const visits = useLoad<{ visits: VisitRow[] }>('visits', { from: todayIso() });
  const pending = (people.value?.people ?? []).filter((p) => p.status === 'pending');
  const toCheck = (people.value?.people ?? []).filter((p) => p.toCheck > 0);
  const ras = (people.value?.people ?? []).filter((p) => p.status === 'active' && p.role === 'ra');
  const upcoming = (visits.value?.visits ?? []).filter((v) => v.status !== 'cancelled' && v.status !== 'done').slice(0, 8);
  return (
    <div className="mpmb-tools__section">
      <div className="mpmb-portal__stats">
        <Stat n={ras.length} label="research assistants" />
        <Stat n={ras.filter((p) => p.ready).length} label="ready for visits" />
        <Stat n={upcoming.length} label="visits coming up" />
        {role === 'pm' && <Stat n={toCheck.reduce((n, p) => n + p.toCheck, 0)} label="documents to check" />}
      </div>
      {role === 'pm' && pending.length > 0 && (
        <Callout tone="important" title={`${pending.length} account${pending.length === 1 ? '' : 's'} to approve`}>
          <Button variant="primary" onClick={() => go('#people')}>
            Review
          </Button>
        </Callout>
      )}
      {role === 'pm' && toCheck.length > 0 && (
        <section>
          <h2 className="mpmb-h2">Documents to check</h2>
          <ul className="mpmb-tools__list">
            {toCheck.map((p) => (
              <li key={p.uid} className="mpmb-tools__row">
                <span>
                  <strong>{p.name}</strong>: {p.toCheck} waiting
                </span>
                <Button variant="secondary" onClick={() => go(`#person/${p.uid}`)}>
                  Check
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2 className="mpmb-h2">Coming up</h2>
        <Loading error={visits.error}>
          {!upcoming.length ? <p>No visits planned. Add one under Visits.</p> : <VisitTable visits={upcoming} go={go} />}
        </Loading>
      </section>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="mpmb-portal__stat">
      <span className="mpmb-portal__statn">{n}</span> {label}
    </div>
  );
}

function VisitTable({ visits, go }: { visits: VisitRow[]; go: (hash: string) => void }) {
  return (
    <ul className="mpmb-tools__list">
      {visits.map((v) => (
        <li key={v.visitId} className="mpmb-tools__row">
          <span>
            <strong>{v.schoolName}</strong>
            <br />
            {visitWhen(v)} · {v.location}
            <br />
            {v.confirmed} of {v.needed} confirmed{v.offered ? `, ${v.offered} waiting` : ''}{' '}
            <span className={`mpmb-portal__badge mpmb-portal__badge--${v.status === 'locked' ? 'ok' : v.status === 'staffing' ? 'wait' : 'todo'}`}>{VISIT_STATUS_LABEL[v.status]}</span>
          </span>
          <Button variant="secondary" onClick={() => go(`#visit/${v.visitId}`)}>
            Open
          </Button>
        </li>
      ))}
    </ul>
  );
}

/* ── People ───────────────────────────────────────────────────────────── */

export function People({ role, go }: { role: Role; go: (hash: string) => void }) {
  const { value, error, load } = useLoad<{ people: PersonRow[]; settings: { minTraining: number; minPilots: number } }>('people');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const act = async (uid: string, action: string, data: Record<string, unknown> = {}) => {
    setBusy(`${uid}-${action}`);
    setActionError(null);
    try {
      await ask(action, { uid, ...data });
      await load();
    } catch (e) {
      setActionError(messageOf(e));
    } finally {
      setBusy(null);
    }
  };
  const all = value?.people ?? [];
  const pending = all.filter((p) => p.status === 'pending');
  const active = all.filter((p) => p.status === 'active');
  const archived = all.filter((p) => p.status === 'archived');
  return (
    <Loading error={error}>
      <div className="mpmb-tools__section">
        <ErrorLine error={actionError} />
        {role === 'pm' && pending.length > 0 && (
          <section>
            <h2 className="mpmb-h2">Asking for an account</h2>
            <ul className="mpmb-tools__list">
              {pending.map((p) => (
                <li key={p.uid} className="mpmb-tools__row mpmb-tools__row--stack">
                  <span>
                    <strong>{p.name}</strong> ({p.email}
                    {p.phone ? `, ${p.phone}` : ''}) asked to join as {p.requested === 'team' ? 'research team' : 'a research assistant'}, {stamp(p.createdAt)}.
                  </span>
                  <div className="mpmb-actions">
                    <select className="mpmb-select" aria-label={`Role for ${p.name}`} value={roles[p.uid] ?? (p.requested === 'team' ? 'researcher' : 'ra')} onChange={(e) => setRoles({ ...roles, [p.uid]: e.target.value as Role })}>
                      {(['ra', 'researcher', 'pm'] as Role[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                    <Button variant="primary" loading={busy === `${p.uid}-approve`} onClick={() => void act(p.uid, 'approve', { role: roles[p.uid] ?? (p.requested === 'team' ? 'researcher' : 'ra') })}>
                      Approve
                    </Button>
                    <Button variant="secondary" loading={busy === `${p.uid}-reject`} onClick={() => void act(p.uid, 'reject')}>
                      Decline
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h2 className="mpmb-h2">Research assistants</h2>
          <p className="mpmb-hint">
            Ready means every required document is checked and in date, and at least {value?.settings.minTraining ?? 2} training sessions and {value?.settings.minPilots ?? 1} pilot. A school’s own forms are checked per visit.
          </p>
          <PeopleList people={active.filter((p) => p.role === 'ra')} go={go} />
        </section>
        <section>
          <h2 className="mpmb-h2">Research team</h2>
          <ul className="mpmb-tools__list">
            {active
              .filter((p) => p.role !== 'ra')
              .map((p) => (
                <li key={p.uid} className="mpmb-tools__row">
                  <span>
                    <strong>{p.name}</strong> · {p.role ? ROLE_LABEL[p.role] : ''}
                    <br />
                    <span className="mpmb-hint">{p.email}</span>
                  </span>
                  {role === 'pm' && (
                    <Button variant="ghost" onClick={() => go(`#person/${p.uid}`)}>
                      Manage
                    </Button>
                  )}
                </li>
              ))}
          </ul>
        </section>
        {role === 'pm' && archived.length > 0 && (
          <section>
            <h2 className="mpmb-h2">Archived</h2>
            <ul className="mpmb-tools__list">
              {archived.map((p) => (
                <li key={p.uid} className="mpmb-tools__row">
                  <span>
                    {p.name} · archived {stamp(p.archivedAt)}
                  </span>
                  <Button variant="ghost" loading={busy === `${p.uid}-restore`} onClick={() => void act(p.uid, 'restore')}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Loading>
  );
}

function PeopleList({ people, go }: { people: PersonRow[]; go: (hash: string) => void }) {
  if (!people.length) return <p>Nobody yet.</p>;
  return (
    <ul className="mpmb-tools__list">
      {people.map((p) => (
        <li key={p.uid} className="mpmb-tools__row">
          <span>
            <strong>{p.name}</strong>{' '}
            <span className={`mpmb-portal__badge mpmb-portal__badge--${p.ready ? 'ok' : 'todo'}`}>{p.ready ? 'Ready' : 'Not ready'}</span>
            <br />
            Training {p.counts.training} · Pilots {p.counts.pilots} · {p.documents.filter((d) => d.state === 'verified' || d.state === 'expiring-soon').length}/{p.documents.length} documents
            {!p.ready && (
              <>
                <br />
                <span className="mpmb-hint">{p.reasons.join('; ')}</span>
              </>
            )}
          </span>
          <Button variant="secondary" onClick={() => go(`#person/${p.uid}`)}>
            Open
          </Button>
        </li>
      ))}
    </ul>
  );
}

interface PersonDetail {
  user: PortalUser;
  counts: Counts;
  sessions: { id: string; kind: string; date: string; title: string }[];
  documents: DocRow[];
  history: { docId: string; typeId: string; schoolId: string | null; status: string; uploadedAt: string; fileName: string; hasCopy: boolean; note: string | null }[];
  availability: { date: string; value: Availability; note: string }[];
}

export function Person({ uid, role, go }: { uid: string; role: Role; go: (hash: string) => void }) {
  const { value, error, load } = useLoad<PersonDetail>('person', { uid });
  const [actionError, setActionError] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<Role | ''>('');
  const pm = role === 'pm';
  const act = async (action: string, data: Record<string, unknown> = {}) => {
    setActionError(null);
    try {
      await ask(action, { uid, ...data });
      await load();
    } catch (e) {
      setActionError(messageOf(e));
    }
  };
  if (!value) return <Loading error={error}>Loading…</Loading>;
  const u = value.user;
  return (
    <div className="mpmb-tools__section">
      <Button variant="link" onClick={() => go('#people')}>
        ← All people
      </Button>
      <div>
        <h2 className="mpmb-h2">{u.name}</h2>
        <p>
          {u.role ? ROLE_LABEL[u.role] : 'No role'} · {u.email}
          {u.phone ? ` · ${u.phone}` : ''}
        </p>
        <p>
          Training {value.counts.training} · Pilots {value.counts.pilots}
        </p>
      </div>
      <ErrorLine error={actionError} />
      <section>
        <h3 className="mpmb-h3">Documents</h3>
        {!pm && <p className="mpmb-hint">Only the project manager can open the copies.</p>}
        {value.documents.map((d) => (
          <DocCheck key={`${d.typeId}|${d.schoolId ?? ''}`} doc={d} pm={pm} reload={load} />
        ))}
      </section>
      <section>
        <h3 className="mpmb-h3">Availability ahead</h3>
        {!value.availability.length ? (
          <p>None marked.</p>
        ) : (
          <ul className="mpmb-portal__chips">
            {value.availability.map((a) => (
              <li key={a.date} className={`mpmb-portal__chip mpmb-portal__day--${a.value}`}>
                {shortDate(a.date)}: {AVAILABILITY_LABEL[a.value]}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="mpmb-h3">Training and pilots attended</h3>
        {!value.sessions.length ? <p>None yet.</p> : (
          <ul className="mpmb-tools__list">
            {value.sessions.map((s) => (
              <li key={s.id} className="mpmb-tools__row">
                <span>
                  {s.title} · {shortDate(s.date)}
                </span>
                <span className="mpmb-hint">{s.kind === 'pilot' ? 'Pilot' : 'Training'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {pm && (
        <section>
          <h3 className="mpmb-h3">Account</h3>
          <div className="mpmb-actions">
            <select className="mpmb-select" aria-label="New role" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
              <option value="">Change role…</option>
              {(['ra', 'researcher', 'pm'] as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <Button variant="secondary" disabled={!newRole} onClick={() => void act('set-role', { role: newRole })}>
              Save role
            </Button>
            {u.status === 'active' && (
              <Button variant="danger" onClick={() => window.confirm(`Archive ${u.name}? They can no longer sign in, and their document copies are deleted after the retention period.`) && void act('archive')}>
                Archive
              </Button>
            )}
          </div>
          {value.history.length > 0 && (
            <>
              <h3 className="mpmb-h3">Every upload</h3>
              <ul className="mpmb-tools__list">
                {value.history.map((h) => (
                  <li key={h.docId} className="mpmb-tools__row">
                    <span>
                      {h.typeId}
                      {h.schoolId ? ` (${h.schoolId})` : ''} · {h.fileName} · {stamp(h.uploadedAt)} · {h.status}
                      {h.hasCopy ? '' : ' · copy deleted'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function DocCheck({ doc, pm, reload }: { doc: DocRow; pm: boolean; reload: () => Promise<void> }) {
  const [form, setForm] = useState({ certificateNumber: doc.details?.certificateNumber ?? '', issueDate: doc.details?.issueDate ?? '', updateService: doc.details?.updateService ?? false, expiresOn: doc.details?.expiresOn ?? '', note: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(doc.state === 'uploaded');
  const decide = async (decision: 'verified' | 'rejected') => {
    setBusy(true);
    setError(null);
    try {
      await ask('verify-document', { docId: doc.docId, decision, note: form.note, details: { certificateNumber: form.certificateNumber, issueDate: form.issueDate || null, updateService: form.updateService, expiresOn: form.expiresOn || null } });
      await reload();
      setOpen(false);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const view = async () => {
    try {
      const { url } = await ask<{ url: string }>('document-url', { docId: doc.docId });
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(messageOf(e));
    }
  };
  const id = `chk-${doc.typeId}-${doc.schoolId ?? 'all'}`;
  return (
    <div className="mpmb-card mpmb-portal__doc">
      <div className="mpmb-portal__doc-head">
        <strong>
          {doc.label}
          {doc.schoolName ? ` (${doc.schoolName})` : ''}
        </strong>
        <StateBadge state={doc.state} />
      </div>
      {doc.validUntil && <p className="mpmb-hint">Valid until {longDate(doc.validUntil)}</p>}
      {pm && doc.details?.certificateNumber && (
        <p className="mpmb-hint">
          Certificate {doc.details.certificateNumber}, issued {doc.details.issueDate}
          {doc.details.updateService ? ', Update Service' : ''}
          {doc.verifiedBy ? `. Checked by ${doc.verifiedBy}, ${stamp(doc.verifiedAt ?? null)}` : ''}
        </p>
      )}
      {pm && doc.docId && (
        <div className="mpmb-actions">
          {doc.hasCopy && (
            <Button variant="secondary" onClick={() => void view()}>
              Open the copy
            </Button>
          )}
          {!open && (
            <Button variant="ghost" onClick={() => setOpen(true)}>
              Check again
            </Button>
          )}
        </div>
      )}
      {pm && doc.docId && open && (
        <div className="mpmb-portal__check">
          {doc.dbs && (
            <div className="mpmb-tools__grid">
              <TextField id={`${id}-num`} label="Certificate number" inputMode="numeric" value={form.certificateNumber} onChange={(e) => setForm({ ...form, certificateNumber: e.target.value })} />
              <TextField id={`${id}-issue`} label="Issue date" type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} />
            </div>
          )}
          {doc.dbs && (
            <label className="mpmb-portal__inline">
              <input type="checkbox" checked={form.updateService} onChange={(e) => setForm({ ...form, updateService: e.target.checked })} /> On the DBS Update Service (checked online)
            </label>
          )}
          {(doc.expires || doc.dbs) && <TextField id={`${id}-exp`} label={doc.dbs ? 'Recheck date' : 'Expiry date'} required={!doc.dbs} tag={doc.dbs ? '(optional: otherwise three years from issue, or none on the Update Service)' : undefined} type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} />}
          <TextField id={`${id}-note`} label="Note" tag="(needed if you reject it: what should they send?)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <div className="mpmb-actions">
            <Button variant="primary" loading={busy} onClick={() => void decide('verified')}>
              Accept
            </Button>
            <Button variant="secondary" loading={busy} onClick={() => void decide('rejected')}>
              Reject
            </Button>
          </div>
        </div>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

/* ── Visits ───────────────────────────────────────────────────────────── */

/** Downloads a calendar file the server builds: one visit, or every visit coming up. */
async function downloadIcs(action: 'visit-ics' | 'visits-ics', data: Record<string, unknown> = {}) {
  const r = await ask<{ filename: string; ics: string }>(action, data);
  saveFile(r.filename, r.ics);
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isWeekend = (iso: string) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());

interface VisitFormValue {
  schoolId: string;
  startDate: string;
  endDate: string;
  start: string;
  end: string;
  location: string;
  needed: string;
  notes: string;
  /** Days changed from the usual: switched on or off, or other times. */
  overrides: Record<string, { on?: boolean; start?: string; end?: string }>;
}

/** Every day of the period, with the usual times, weekends off, and any day changed. */
function formDays(f: VisitFormValue): VisitDay[] {
  if (!f.startDate) return [];
  const last = f.endDate && f.endDate >= f.startDate ? f.endDate : f.startDate;
  const out: VisitDay[] = [];
  for (let d = f.startDate, n = 0; d <= last && n < 62; d = addDays(d, 1), n += 1) {
    const o = f.overrides[d] ?? {};
    out.push({ date: d, on: o.on ?? !isWeekend(d), start: o.start || f.start, end: o.end || f.end });
  }
  return out;
}

export function emptyVisitForm(): VisitFormValue {
  return { schoolId: '', startDate: '', endDate: '', start: '08:30', end: '15:00', location: '', needed: '4', notes: '', overrides: {} };
}

export function visitFormFrom(v: Visit): VisitFormValue {
  const overrides: VisitFormValue['overrides'] = {};
  for (const d of v.days) {
    const o: { on?: boolean; start?: string; end?: string } = {};
    if (d.on === isWeekend(d.date)) o.on = d.on;
    if (d.start !== v.start) o.start = d.start;
    if (d.end !== v.end) o.end = d.end;
    if (Object.keys(o).length) overrides[d.date] = o;
  }
  return { schoolId: v.schoolId, startDate: v.startDate, endDate: v.endDate, start: v.start, end: v.end, location: v.location, needed: String(v.needed), notes: v.notes, overrides };
}

/**
 * Adding or changing a visit: the school, the first and last dates, the usual
 * times and where; then every day of the period listed, each switched on or
 * off (weekends off to start with) and with its own times if they differ.
 */
function VisitForm({ schools, initial, visitId, onSaved, submitLabel, idPrefix = 'v' }: { schools: School[]; initial: VisitFormValue; visitId?: string; onSaved: (visitId: string) => void | Promise<void>; submitLabel: string; idPrefix?: string }) {
  const [form, setForm] = useState<VisitFormValue>(initial);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const days = formDays(form);
  const on = days.filter((d) => d.on);
  const schoolName = schools.find((s) => s.id === form.schoolId)?.name ?? '';
  const setDay = (date: string, patch: { on?: boolean; start?: string; end?: string }) => setForm({ ...form, overrides: { ...form.overrides, [date]: { ...form.overrides[date], ...patch } } });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const { visitId: id } = await ask<{ visitId: string }>('save-visit', {
        visitId,
        schoolId: form.schoolId,
        startDate: form.startDate,
        endDate: form.endDate || form.startDate,
        start: form.start,
        end: form.end,
        location: form.location,
        needed: Number(form.needed),
        notes: form.notes,
        days: days.map((d) => ({ date: d.date, on: d.on, start: d.start, end: d.end })),
      });
      await onSaved(id);
    } catch (err) {
      setFormError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="mpmb-card" onSubmit={(e) => void submit(e)}>
      <div className="mpmb-tools__grid">
        <SelectField id={`${idPrefix}-school`} label="School" options={schools.filter((s) => s.active || s.id === form.schoolId).map((s) => ({ value: s.id, label: s.name }))} value={form.schoolId} onChange={(e) => setForm({ ...form, schoolId: e.target.value })} />
        <TextField id={`${idPrefix}-location`} label="Where" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} hint={schoolName ? `${schoolName}: the address, room or meeting point (for example "Main reception, Alwoodley Gates, LS17 8GS").` : 'The address, room or meeting point.'} />
        <TextField id={`${idPrefix}-from`} label="First date" type="date" min={visitId ? undefined : todayIso()} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: form.endDate && form.endDate >= e.target.value ? form.endDate : e.target.value })} />
        <TextField id={`${idPrefix}-to`} label="Last date" type="date" min={form.startDate || todayIso()} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} hint="The same as the first date for a one-day visit." />
        <TextField id={`${idPrefix}-start`} label="Usual start" type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        <TextField id={`${idPrefix}-end`} label="Usual end" type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        <TextField id={`${idPrefix}-needed`} label="Research assistants needed" type="number" min={1} max={30} value={form.needed} onChange={(e) => setForm({ ...form, needed: e.target.value })} />
      </div>
      {days.length > 0 && (
        <fieldset className="mpmb-portal__days">
          <legend className="mpmb-label">
            The days ({on.length} of {days.length} on)
          </legend>
          <p className="mpmb-hint">Weekends start switched off. Switch any day on or off, and change a day’s times if they differ from the usual.</p>
          <ul className="mpmb-tools__list">
            {days.map((d) => (
              <li key={d.date} className={`mpmb-tools__row mpmb-portal__vday${d.on ? '' : ' is-off'}`}>
                <label className="mpmb-portal__inline">
                  <input type="checkbox" checked={d.on} onChange={(e) => setDay(d.date, { on: e.target.checked })} aria-label={`${longDate(d.date)}: the visit runs`} />
                  <span>
                    <strong>{shortDate(d.date)}</strong>
                    {!d.on && <span className="mpmb-hint"> · off</span>}
                  </span>
                </label>
                {d.on && (
                  <span className="mpmb-portal__times">
                    <input className="mpmb-input" type="time" aria-label={`${longDate(d.date)}: start`} value={d.start} onChange={(e) => setDay(d.date, { start: e.target.value })} />
                    <span aria-hidden="true">to</span>
                    <input className="mpmb-input" type="time" aria-label={`${longDate(d.date)}: end`} value={d.end} onChange={(e) => setDay(d.date, { end: e.target.value })} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <TextField id={`${idPrefix}-notes`} label="Notes for the research assistants" required={false} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      <ErrorLine error={formError} />
      <Button type="submit" variant="primary" loading={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}

export function Visits({ go }: { go: (hash: string) => void }) {
  const { value, error, load } = useLoad<{ visits: VisitRow[]; schools: School[] }>('visits');
  const [dlError, setDlError] = useState<string | null>(null);
  return (
    <Loading error={error}>
      <div className="mpmb-tools__section">
        <section>
          <h2 className="mpmb-h2">Visits</h2>
          {!value ? <p>Loading…</p> : !value.visits.length ? <p>None yet.</p> : <VisitTable visits={value.visits} go={go} />}
          <div className="mpmb-actions">
            <Button variant="secondary" onClick={() => void downloadIcs('visits-ics').catch((e) => setDlError(messageOf(e)))}>
              Add all upcoming visits to my calendar (.ics)
            </Button>
          </div>
          <ErrorLine error={dlError} />
        </section>
        <section>
          <h2 className="mpmb-h2">Add a visit</h2>
          {value && (
            <VisitForm
              schools={value.schools}
              initial={emptyVisitForm()}
              submitLabel="Add the visit"
              onSaved={async (visitId) => {
                await load();
                go(`#visit/${visitId}`);
              }}
            />
          )}
        </section>
      </div>
    </Loading>
  );
}

interface CanvassDay {
  date: string;
  start: string;
  end: string;
  yes: string[];
  maybe: string[];
  no: string[];
  noAnswer: string[];
}

/** For provisional dates: day by day, who could do it, who might, who can't, and who hasn't answered. */
function CanvassSummary({ days, provisional }: { days: CanvassDay[]; provisional: boolean }) {
  return (
    <section aria-labelledby="canvass-h" className="mpmb-card mpmb-portal__canvass">
      <h3 className="mpmb-h3" id="canvass-h">
        {provisional ? 'Who could do these provisional dates' : 'Answers given while the dates were provisional'}
      </h3>
      {provisional && <p className="mpmb-hint">Research assistants were asked day by day. Move the visit on to Staffing once the school confirms: those who said they can do it are told, and you can then offer places.</p>}
      <table className="mpmb-portal__table">
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Can do</th>
            <th scope="col">Maybe</th>
            <th scope="col">Can’t do</th>
            <th scope="col">No answer</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <th scope="row">
                {shortDate(d.date)}
                <br />
                <span className="mpmb-hint">
                  {d.start}–{d.end}
                </span>
              </th>
              {([d.yes, d.maybe, d.no, d.noAnswer] as string[][]).map((names, i) => (
                <td key={i}>
                  <strong>{names.length}</strong>
                  {names.length > 0 && <span className="mpmb-hint"> · {names.join(', ')}</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

interface Candidate {
  uid: string;
  name: string;
  email: string;
  perDay: { date: string; value: Availability | null; covers: 'yes' | 'no' | 'unknown' }[];
  coverage: 'all' | 'some' | 'none' | 'unknown';
  availableDates: string[];
  availabilityNote: string;
  interested: boolean;
  counts: Counts;
  eligible: boolean;
  reasons: string[];
  assignment: { status: AssignmentStatus; override: { reason: string; byName: string } | null; note: string } | null;
}

const COVERAGE: Record<Candidate['coverage'], { label: (c: Candidate) => string; tone: string }> = {
  all: { label: (c) => (c.perDay.length === 1 ? AVAILABILITY_LABEL[c.perDay[0].value ?? 'all'] : 'Available every day'), tone: 'ok' },
  some: { label: (c) => `Available ${c.availableDates.length} of ${c.perDay.length} days`, tone: 'wait' },
  none: { label: () => 'Not available', tone: 'todo' },
  unknown: { label: () => 'No availability given', tone: 'wait' },
};

export function VisitView({ visitId, go }: { visitId: string; go: (hash: string) => void }) {
  const { value, error, load } = useLoad<{ visit: Visit & { requiredDocs: string[] }; candidates: Candidate[]; canvass: CanvassDay[] | null; placesLeft: number; mayOverride: boolean; mayRemove: boolean }>('visit', { visitId });
  const schools = useLoad<{ schools: School[] }>('schools');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<{ uid: string; name: string } | null>(null);
  const [reason, setReason] = useState('');
  if (!value) return <Loading error={error}>Loading…</Loading>;
  const v = value.visit;
  const placed = value.candidates.filter((c) => c.assignment && c.assignment.status !== 'withdrawn' && c.assignment.status !== 'removed');
  const free = value.candidates.filter((c) => !c.assignment || c.assignment.status === 'declined' || c.assignment.status === 'withdrawn' || c.assignment.status === 'removed');
  const confirmedCount = placed.filter((c) => c.assignment!.status === 'confirmed').length;
  const toggle = (uid: string) => {
    const next = new Set(chosen);
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    setChosen(next);
  };
  const offer = async () => {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      const r = await ask<{ offered: number }>('offer', { visitId, uids: [...chosen], overrides });
      setChosen(new Set());
      setOverrides({});
      setMessage(`Offered to ${r.offered}. They have been notified and emailed.`);
      await load();
    } catch (e) {
      setActionError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const run = async (action: string, data: Record<string, unknown>, done?: string) => {
    setActionError(null);
    setMessage(null);
    try {
      await ask(action, { visitId, ...data });
      if (done) setMessage(done);
      await load();
      return true;
    } catch (e) {
      setActionError(messageOf(e));
      return false;
    }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    const ok = await run('remove-confirmed', { uid: removing.uid, reason }, `${removing.name} removed. They have been notified and emailed, and the place is open again.`);
    setBusy(false);
    if (ok) {
      setRemoving(null);
      setReason('');
    }
  };
  return (
    <div className="mpmb-tools__section">
      <Button variant="link" onClick={() => go('#visits')}>
        ← All visits
      </Button>
      <div>
        <h2 className="mpmb-h2">{v.schoolName}</h2>
        <p>
          <strong>Where:</strong> {v.location}
        </p>
        <ul className="mpmb-portal__daylist">
          {dayLines(v).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p>
          {v.needed} needed · {value.placesLeft} place{value.placesLeft === 1 ? '' : 's'} left ·{' '}
          <span className={`mpmb-portal__badge mpmb-portal__badge--${v.status === 'locked' ? 'ok' : 'wait'}`}>{VISIT_STATUS_LABEL[v.status]}</span>
        </p>
        <p className="mpmb-hint">Needs: {v.requiredDocs.join(', ')}. Documents must be in date on every day.</p>
        <div className="mpmb-actions">
          <select className="mpmb-select" aria-label="Visit status" value={v.status} onChange={(e) => {
              const next = e.target.value as VisitStatus;
              const note = next === 'provisional' ? 'Every research assistant is told about these possible dates (push and email, as they choose).' : (next === 'staffing' && v.status === 'provisional') ? 'Those who said they could do it are told the dates are confirmed; everyone else hears about new dates.' : (next === 'staffing' && v.status === 'draft') ? 'Every research assistant is told about the new dates.' : (next === 'cancelled' && v.status === 'provisional') ? 'Everyone who answered is told the dates won’t go ahead.' : '';
              if (note && !window.confirm(`${VISIT_STATUS_LABEL[next]}: ${note} Go ahead?`)) return;
              void run('set-visit-status', { status: next }, note ? `Status changed. ${note}` : undefined);
            }}>
            {(Object.keys(VISIT_STATUS_LABEL) as VisitStatus[]).map((s) => (
              <option key={s} value={s}>
                {VISIT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => void downloadIcs('visit-ics', { visitId }).catch((e) => setActionError(messageOf(e)))}>
            Add to my calendar (.ics)
          </Button>
          <Button variant="ghost" onClick={() => setEditing(!editing)} aria-expanded={editing}>
            {editing ? 'Close' : 'Change dates, times or place'}
          </Button>
        </div>
      </div>
      {editing && schools.value && (
        <section aria-label="Change the visit">
          {confirmedCount > 0 && <p className="mpmb-hint">{confirmedCount} confirmed: they will be notified and emailed an updated calendar invitation if the days, times or place change.</p>}
          <VisitForm
            schools={schools.value.schools}
            initial={visitFormFrom(v)}
            visitId={visitId}
            idPrefix="ve"
            submitLabel="Save the changes"
            onSaved={async () => {
              setEditing(false);
              setMessage(confirmedCount ? 'Saved. Anyone confirmed has been told of any change.' : 'Saved.');
              await load();
            }}
          />
        </section>
      )}
      <ErrorLine error={actionError} />
      {message && (
        <Callout tone="success" role="status">
          {message}
        </Callout>
      )}
      {value.canvass && <CanvassSummary days={value.canvass} provisional={v.status === 'provisional'} />}
      <section>
        <h3 className="mpmb-h3">Placed</h3>
        {!placed.length ? (
          <p>Nobody yet.</p>
        ) : (
          <ul className="mpmb-tools__list">
            {placed.map((c) => (
              <li key={c.uid} className="mpmb-tools__row">
                <span>
                  <strong>{c.name}</strong> · {ASSIGNMENT_LABEL[c.assignment!.status]}
                  {c.assignment!.override ? ` · booked without being ready: ${c.assignment!.override.reason}` : ''}
                  {c.assignment!.note ? ` · “${c.assignment!.note}”` : ''}
                </span>
                {c.assignment!.status === 'offered' && (
                  <Button variant="ghost" onClick={() => window.confirm(`Withdraw the offer to ${c.name}?`) && void run('withdraw-offer', { uid: c.uid }, `Offer to ${c.name} withdrawn.`)}>
                    Withdraw offer
                  </Button>
                )}
                {c.assignment!.status === 'confirmed' &&
                  (value.mayRemove ? (
                    <Button variant="ghost" onClick={() => (setRemoving({ uid: c.uid, name: c.name }), setReason(''))}>
                      Remove…
                    </Button>
                  ) : (
                    <span className="mpmb-hint">Only the project manager can remove</span>
                  ))}
              </li>
            ))}
          </ul>
        )}
        {removing && (
          <div className="mpmb-card mpmb-portal__dialog" role="dialog" aria-modal="false" aria-labelledby="remove-h">
            <h3 className="mpmb-h3" id="remove-h">
              Remove {removing.name} from this visit?
            </h3>
            <p>They have confirmed. They will get a notification and an email with the reason, their calendar entry is cancelled, and the place opens again.</p>
            <TextField id="remove-reason" label="Reason (recorded and sent to them)" value={reason} onChange={(e) => setReason(e.target.value)} hint="For example: emailed on 3 November to withdraw, unwell." />
            <div className="mpmb-actions">
              <Button variant="primary" loading={busy} disabled={!reason.trim()} onClick={() => void remove()}>
                Remove {removing.name}
              </Button>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Keep them
              </Button>
            </div>
          </div>
        )}
      </section>
      <section>
        <h3 className="mpmb-h3">Choose who to ask</h3>
        <p className="mpmb-hint">Ready and available first. Each person’s availability is shown day by day. Tick people, then lock them in: each one gets a notification and an email asking them to confirm, for every day of the visit.</p>
        <ul className="mpmb-tools__list">
          {free.map((c) => (
            <li key={c.uid} className={`mpmb-tools__row mpmb-portal__candidate${c.eligible ? '' : ' is-blocked'}`}>
              <label className="mpmb-portal__inline">
                <input type="checkbox" checked={chosen.has(c.uid)} disabled={!c.eligible && !value.mayOverride} onChange={() => toggle(c.uid)} />
                <span>
                  <strong>{c.name}</strong> <span className={`mpmb-portal__badge mpmb-portal__badge--${COVERAGE[c.coverage].tone}`}>{COVERAGE[c.coverage].label(c)}</span>
                  {c.interested && <span className="mpmb-portal__badge mpmb-portal__badge--ok">Interested</span>}
                  {c.assignment?.status === 'declined' && <span className="mpmb-portal__badge mpmb-portal__badge--todo">Declined before</span>}
                  {c.assignment?.status === 'removed' && <span className="mpmb-portal__badge mpmb-portal__badge--todo">Removed before</span>}
                  {c.perDay.length > 1 && (
                    <span className="mpmb-portal__perday">
                      {c.perDay.map((d) => (
                        <span key={d.date} className={`mpmb-portal__dayChip mpmb-portal__dayChip--${d.covers}`} title={d.value ? AVAILABILITY_LABEL[d.value] : 'Not given'}>
                          {shortDate(d.date)}: {d.covers === 'yes' ? '✓' : d.covers === 'no' ? '✗' : '?'}
                        </span>
                      ))}
                    </span>
                  )}
                  <br />
                  <span className="mpmb-hint">
                    Training {c.counts.training} · Pilots {c.counts.pilots}
                    {c.availabilityNote ? ` · “${c.availabilityNote}”` : ''}
                    {!c.eligible ? ` · Not ready: ${c.reasons.join('; ')}` : ''}
                  </span>
                </span>
              </label>
              {!c.eligible && value.mayOverride && chosen.has(c.uid) && <input className="mpmb-input" aria-label={`Why book ${c.name} anyway`} placeholder="Why book them anyway? (recorded)" value={overrides[c.uid] ?? ''} onChange={(e) => setOverrides({ ...overrides, [c.uid]: e.target.value })} />}
            </li>
          ))}
        </ul>
        {v.status === 'provisional' && (
          <Callout tone="important" title="Provisional dates">
            <p>Places can’t be offered until the dates are confirmed. Once the school confirms, set the status to Staffing.</p>
          </Callout>
        )}
        <div className="mpmb-actions">
          <Button variant="primary" loading={busy} disabled={!chosen.size || v.status === 'provisional'} onClick={() => void offer()}>
            Lock in and notify {chosen.size ? `(${chosen.size})` : ''}
          </Button>
        </div>
      </section>
    </div>
  );
}

/* ── Training and pilots ──────────────────────────────────────────────── */

interface Session {
  id: string;
  kind: 'training' | 'pilot';
  date: string;
  title: string;
  notes: string;
  attendees: string[];
}

export function Sessions() {
  const { value, error, load } = useLoad<{ sessions: Session[]; people: { uid: string; name: string; role: Role }[] }>('sessions');
  const blank = { id: '', kind: 'training' as 'training' | 'pilot', date: todayIso(), title: '', notes: '', attendees: [] as string[] };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await ask('save-session', { ...form, id: form.id || undefined });
      setForm(blank);
      await load();
    } catch (err) {
      setFormError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  const ras = (value?.people ?? []).filter((p) => p.role === 'ra');
  const names = new Map((value?.people ?? []).map((p) => [p.uid, p.name]));
  return (
    <Loading error={error}>
      <div className="mpmb-tools__section">
        <form className="mpmb-card" onSubmit={(e) => void save(e)}>
          <h2 className="mpmb-h2">{form.id ? 'Change a session' : 'Record a training session or pilot'}</h2>
          <div className="mpmb-tools__grid">
            <SelectField id="s-kind" label="Kind" placeholder="Choose" options={[{ value: 'training', label: 'Training' }, { value: 'pilot', label: 'Pilot' }]} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'training' | 'pilot' })} />
            <TextField id="s-date" label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <TextField id="s-title" label="Title" placeholder="EEG set-up training" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <fieldset className="mpmb-tools__days">
            <legend className="mpmb-label">Who attended</legend>
            {ras.map((p) => (
              <label key={p.uid} className="mpmb-portal__inline">
                <input type="checkbox" checked={form.attendees.includes(p.uid)} onChange={(e) => setForm({ ...form, attendees: e.target.checked ? [...form.attendees, p.uid] : form.attendees.filter((u) => u !== p.uid) })} /> {p.name}
              </label>
            ))}
          </fieldset>
          <TextField id="s-notes" label="Notes" required={false} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <ErrorLine error={formError} />
          <div className="mpmb-actions">
            <Button type="submit" variant="primary" loading={busy}>
              Save
            </Button>
            {form.id && (
              <Button variant="ghost" onClick={() => setForm(blank)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
        <section>
          <h2 className="mpmb-h2">Recorded</h2>
          <ul className="mpmb-tools__list">
            {(value?.sessions ?? []).map((s) => (
              <li key={s.id} className="mpmb-tools__row">
                <span>
                  <strong>{s.title}</strong> · {s.kind === 'pilot' ? 'Pilot' : 'Training'} · {shortDate(s.date)}
                  <br />
                  <span className="mpmb-hint">{s.attendees.map((u) => names.get(u) ?? 'someone archived').join(', ') || 'Nobody ticked'}</span>
                </span>
                <span className="mpmb-actions">
                  <Button variant="ghost" onClick={() => setForm({ ...s })}>
                    Change
                  </Button>
                  <Button variant="ghost" onClick={() => window.confirm('Delete this session?') && void ask('delete-session', { id: s.id }).then(load)}>
                    Delete
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Loading>
  );
}

/* ── Schools ──────────────────────────────────────────────────────────── */

export function Schools() {
  const { value, error, load } = useLoad<{ schools: School[] }>('schools');
  const [edit, setEdit] = useState<{ id: string; name: string; area: string; forms: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    setFormError(null);
    const requiredDocs: DocType[] = edit.forms
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((label) => ({ id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40), label, hint: '' }));
    try {
      await ask('save-school', { id: edit.id || undefined, name: edit.name, area: edit.area, requiredDocs });
      setEdit(null);
      await load();
    } catch (err) {
      setFormError(messageOf(err));
    }
  };
  return (
    <Loading error={error}>
      <div className="mpmb-tools__section">
        <ul className="mpmb-tools__list">
          {(value?.schools ?? []).map((s) => (
            <li key={s.id} className="mpmb-tools__row">
              <span>
                <strong>{s.name}</strong> · {s.area}
                <br />
                <span className="mpmb-hint">{s.requiredDocs.length ? `Also asks for: ${s.requiredDocs.map((d) => d.label).join(', ')}` : 'No extra forms'}</span>
              </span>
              <Button variant="ghost" onClick={() => setEdit({ id: s.id, name: s.name, area: s.area, forms: s.requiredDocs.map((d) => d.label).join('\n') })}>
                Change
              </Button>
            </li>
          ))}
        </ul>
        {!edit && (
          <Button variant="secondary" onClick={() => setEdit({ id: '', name: '', area: '', forms: '' })}>
            Add a school
          </Button>
        )}
        {edit && (
          <form className="mpmb-card" onSubmit={(e) => void save(e)}>
            <h2 className="mpmb-h2">{edit.id ? `Change ${edit.name}` : 'Add a school'}</h2>
            <TextField id="sc-name" label="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <TextField id="sc-area" label="Area" required={false} value={edit.area} onChange={(e) => setEdit({ ...edit, area: e.target.value })} />
            <label className="mpmb-label" htmlFor="sc-forms">
              Forms this school asks for, one per line <span className="mpmb-label__tag">(optional)</span>
            </label>
            <textarea id="sc-forms" className="mpmb-input" rows={3} value={edit.forms} onChange={(e) => setEdit({ ...edit, forms: e.target.value })} />
            <ErrorLine error={formError} />
            <div className="mpmb-actions">
              <Button type="submit" variant="primary">
                Save
              </Button>
              <Button variant="ghost" onClick={() => setEdit(null)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </Loading>
  );
}

/* ── Settings and audit (the project manager) ─────────────────────────── */

export function SettingsView() {
  const { value, error, load } = useLoad<{ settings: Settings }>('settings');
  const [form, setForm] = useState<Settings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => setForm(value?.settings ?? null), [value]);
  if (!form) return <Loading error={error}>Loading…</Loading>;
  const num = (k: keyof Settings) => (e: { target: { value: string } }) => setForm({ ...form, [k]: Number(e.target.value) });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await ask('save-settings', { settings: form });
      setMessage('Saved.');
      await load();
    } catch (err) {
      setFormError(messageOf(err));
    }
  };
  return (
    <form className="mpmb-tools__section" onSubmit={(e) => void save(e)}>
      <div className="mpmb-tools__grid">
        <TextField id="st-train" label="Training sessions needed" type="number" min={0} value={form.minTraining} onChange={num('minTraining')} />
        <TextField id="st-pilot" label="Pilots needed" type="number" min={0} value={form.minPilots} onChange={num('minPilots')} />
        <TextField id="st-ret" label="Days to keep copies after archiving" type="number" min={0} value={form.retentionDays} onChange={num('retentionDays')} />
        <TextField id="st-soon" label="Warn this many days before expiry" type="number" min={0} value={form.expiringSoonDays} onChange={num('expiringSoonDays')} />
        <TextField id="st-dbs" label="Years a DBS counts without the Update Service" type="number" min={1} value={form.dbsValidYears} onChange={num('dbsValidYears')} />
      </div>
      <section>
        <h2 className="mpmb-h2">Withdrawing from a confirmed visit</h2>
        <p className="mpmb-hint">Research assistants cannot cancel a visit they have confirmed. They are asked to email this person, who removes them in the portal.</p>
        <div className="mpmb-tools__grid">
          <TextField id="st-wname" label="Name" value={form.withdrawalContact.name} onChange={(e) => setForm({ ...form, withdrawalContact: { ...form.withdrawalContact, name: e.target.value } })} />
          <TextField id="st-wemail" label="Email" type="email" value={form.withdrawalContact.email} onChange={(e) => setForm({ ...form, withdrawalContact: { ...form.withdrawalContact, email: e.target.value } })} />
        </div>
      </section>
      <section>
        <h2 className="mpmb-h2">Documents everyone needs</h2>
        {form.docTypes.map((t, i) => (
          <div key={t.id} className="mpmb-tools__grid">
            <TextField id={`dt-${i}`} label={`Name (${t.id})`} value={t.label} onChange={(e) => setForm({ ...form, docTypes: form.docTypes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
            <TextField id={`dth-${i}`} label="What to upload" required={false} value={t.hint} onChange={(e) => setForm({ ...form, docTypes: form.docTypes.map((x, j) => (j === i ? { ...x, hint: e.target.value } : x)) })} />
          </div>
        ))}
        <Button variant="ghost" onClick={() => setForm({ ...form, docTypes: [...form.docTypes, { id: `doc-${form.docTypes.length + 1}`, label: 'New document', hint: '' }] })}>
          Add a document type
        </Button>
      </section>
      <ErrorLine error={formError} />
      {message && <p role="status">{message}</p>}
      <div className="mpmb-actions">
        <Button type="submit" variant="primary">
          Save settings
        </Button>
      </div>
    </form>
  );
}

export function Audit() {
  const { value, error } = useLoad<{ entries: { id: string; at: string | null; by: string; action: string; target: string; details: Record<string, unknown> }[] }>('audit');
  return (
    <Loading error={error}>
      <ul className="mpmb-tools__list mpmb-portal__audit">
        {(value?.entries ?? []).map((e) => (
          <li key={e.id} className="mpmb-tools__row mpmb-tools__row--stack">
            <span>
              <strong>{e.action}</strong> · {stamp(e.at)} · {e.by}
            </span>
            <span className="mpmb-hint">
              {e.target} {Object.keys(e.details).length ? JSON.stringify(e.details) : ''}
            </span>
          </li>
        ))}
      </ul>
    </Loading>
  );
}
