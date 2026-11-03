import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { SelectField, TextField } from '../components/ui/Field';
import { ask, messageOf } from './api';
import { TeamEmailRange } from './Reports';
import { StateBadge } from './RaViews';
import { AVAILABILITY_LABEL, DAY_ROLE_LABEL, DAY_ROLES, LEVEL_LABEL, longDate, ROLE_LABEL, saveFile, shortDate, stamp, todayIso, VISIT_STATUS_LABEL, visitWhen, type Availability, type Counts, type DayRole, type DocRow, type DocType, type Level, type PortalUser, type Role, type School, type Settings, type StatusTag, type TeamExtras, type TrainingClaim, type Visit, type VisitDay } from './types';

/** Loads with an action, shows loading and errors, and offers a reload. */
export function useLoad<T>(action: string, data: Record<string, unknown> = {}) {
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

export function Loading({ error, children }: { error: string | null; children: ReactNode }) {
  if (error)
    return (
      <Callout tone="warning" role="alert">
        {error}
      </Callout>
    );
  return <>{children}</>;
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="mpmb-error" role="alert">
      {error}
    </p>
  ) : null;
}

/* ── Overview ─────────────────────────────────────────────────────────── */

interface PersonRow extends PortalUser, TeamExtras {
  counts: Counts;
  daysAttended: number;
  documents: { typeId: string; label: string; state: DocRow['state'] }[];
  ready: boolean;
  reasons: string[];
  toCheck: number;
  /** Training and pilots they logged that the team has not confirmed yet. */
  waiting?: { training: number; pilots: number };
}

/** A visit in a list, with person-days: each day's places for both jobs. */
export interface VisitRow extends Visit {
  needed: number;
  confirmed: number;
  offered: number;
}

/** Tags as small labels. */
export function TagBadges({ tags }: { tags: StatusTag[] }) {
  return (
    <>
      {tags.map((t) => (
        <span key={t.id} className={`mpmb-portal__badge mpmb-portal__badge--${t.id === 'ready' ? 'ok' : t.id === 'on-hold' || t.id === 'left' ? 'todo' : 'wait'}`}>
          {t.label}
        </span>
      ))}
    </>
  );
}

/** "Level 3: Experienced" with the jobs they do. */
export function levelLine(p: Pick<TeamExtras, 'level' | 'capabilities'>): string {
  return [p.level ? `Level ${p.level}: ${LEVEL_LABEL[p.level]}` : 'Level not set', p.capabilities.length ? p.capabilities.map((r) => DAY_ROLE_LABEL[r]).join(' and ') : 'No jobs set'].join(' · ');
}

export function TeamHome({ role, go }: { role: Role; go: (hash: string) => void }) {
  const people = useLoad<{ people: PersonRow[]; claimsWaiting?: number }>('people');
  const visits = useLoad<{ visits: VisitRow[]; attendanceDue: { visitId: string; date: string; unmarked: number; schoolName: string }[] }>('visits');
  const pending = (people.value?.people ?? []).filter((p) => p.status === 'pending');
  const toCheck = (people.value?.people ?? []).filter((p) => p.toCheck > 0);
  const ras = (people.value?.people ?? []).filter((p) => p.status === 'active' && p.role === 'ra');
  const upcoming = (visits.value?.visits ?? []).filter((v) => v.status !== 'cancelled' && v.status !== 'done' && v.lastDate >= todayIso()).slice(0, 8);
  const due = visits.value?.attendanceDue ?? [];
  return (
    <div className="mpmb-tools__section">
      <div className="mpmb-portal__stats">
        <Stat n={ras.length} label="research assistants" />
        <Stat n={ras.filter((p) => p.ready).length} label="ready for visits" />
        <Stat n={upcoming.length} label="visits coming up" />
        {role === 'pm' && <Stat n={toCheck.reduce((n, p) => n + p.toCheck, 0)} label="documents to check" />}
        <Stat n={people.value?.claimsWaiting ?? 0} label="training and pilots to confirm" />
      </div>
      {(people.value?.claimsWaiting ?? 0) > 0 && (
        <Callout tone="important" title={`${people.value?.claimsWaiting} training or pilot entr${people.value?.claimsWaiting === 1 ? 'y' : 'ies'} to confirm`}>
          <p>Research assistants logged these themselves; they count once the team confirms them.</p>
          <Button variant="primary" onClick={() => go('#sessions')}>
            Confirm
          </Button>
        </Callout>
      )}
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
      {due.length > 0 && (
        <Callout tone="important" title="Attendance to mark">
          <ul className="mpmb-tools__list">
            {due.map((d) => (
              <li key={`${d.visitId}-${d.date}`} className="mpmb-tools__row">
                <span>
                  {d.schoolName}, {shortDate(d.date)}: {d.unmarked} not marked
                </span>
                <Button variant="secondary" onClick={() => go(`#visit/${d.visitId}`)}>
                  Mark
                </Button>
              </li>
            ))}
          </ul>
        </Callout>
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

export function VisitTable({ visits, go }: { visits: VisitRow[]; go: (hash: string) => void }) {
  return (
    <ul className="mpmb-tools__list">
      {visits.map((v) => (
        <li key={v.visitId} className="mpmb-tools__row">
          <span>
            <strong>{v.schoolName}</strong>
            <br />
            {visitWhen(v)} · {v.location}
            <br />
            EEG {v.roleNeeds.eeg} · Co-production {v.roleNeeds.copro} a day · {v.confirmed} of {v.needed} person-days confirmed{v.offered ? `, ${v.offered} waiting` : ''}{' '}
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
  const { value, error, load } = useLoad<{ people: PersonRow[]; settings: { minTraining: number; minPilots: number; tags: StatusTag[] } }>('people');
  const [tagFilter, setTagFilter] = useState('');
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
                    {p.phone ? `, ${p.phone}` : ''}) asked to join as {p.requested === 'team' ? 'a staff member' : 'a research assistant'}, {stamp(p.createdAt)}.
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
          <div className="mpmb-actions">
            <select className="mpmb-select" aria-label="Show only people tagged" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
              <option value="">Every status</option>
              {(value?.settings.tags ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                  {t.retired ? ' (retired)' : ''}
                </option>
              ))}
              <option value="none">No status yet</option>
            </select>
          </div>
          <PeopleList people={active.filter((p) => p.role === 'ra' && (!tagFilter || (tagFilter === 'none' ? !p.tags.length : p.tags.some((t) => t.id === tagFilter))))} go={go} />
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
            <span className={`mpmb-portal__badge mpmb-portal__badge--${p.ready ? 'ok' : 'todo'}`}>{p.ready ? 'Documents and training done' : 'Not ready'}</span> <TagBadges tags={p.tags} />
            <br />
            {levelLine(p)}
            <br />
            Training {p.counts.training} · Pilots {p.counts.pilots}
            {p.waiting && p.waiting.training + p.waiting.pilots > 0 ? ` (${p.waiting.training + p.waiting.pilots} waiting)` : ''} · {p.documents.filter((d) => d.state === 'verified' || d.state === 'expiring-soon').length}/{p.documents.length} documents · {p.daysAttended} school day{p.daysAttended === 1 ? '' : 's'} attended
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

interface PersonNote {
  id: string;
  text: string;
  byName: string;
  mine: boolean;
  at: string | null;
}

interface PersonDetail extends TeamExtras {
  user: PortalUser;
  settings: { tags: StatusTag[] };
  daysAttended: number;
  notes: PersonNote[];
  counts: Counts;
  sessions: { id: string; kind: string; date: string; title: string }[];
  claims?: TrainingClaim[];
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
          <TagBadges tags={value.tags} />
        </p>
        <p>
          {levelLine(value)}
          {value.levelReason ? ` (${value.levelReason})` : ''}
        </p>
        <p>
          Training {value.counts.training} · Pilots {value.counts.pilots} · School days attended {value.daysAttended}
        </p>
        {(value.claims ?? []).some((c) => c.status === 'waiting') && (
          <p className="mpmb-hint">
            Logged by them, waiting for the team:{' '}
            {(value.claims ?? [])
              .filter((c) => c.status === 'waiting')
              .map((c) => `${c.kind === 'pilot' ? 'pilot' : 'training'} “${c.title}” (${shortDate(c.date)})`)
              .join('; ')}
            .{' '}
            <Button variant="link" onClick={() => go('#sessions')}>
              Confirm them
            </Button>
          </p>
        )}
        {value.availabilityNote && <p className="mpmb-hint">Availability: {value.availabilityNote}</p>}
      </div>
      <ErrorLine error={actionError} />
      {u.role === 'ra' && <PersonEdit key={JSON.stringify([u.name, u.phone, value.tags, value.level, value.capabilities, value.availabilityNote])} uid={uid} detail={value} reload={load} />}
      <PersonNotes uid={uid} notes={value.notes} pm={pm} reload={load} />
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

/** The team's details about someone: name and phone as the team keeps them, availability notes, status, experience and jobs. Never shown to them. */
function PersonEdit({ uid, detail, reload }: { uid: string; detail: PersonDetail; reload: () => Promise<void> }) {
  const [form, setForm] = useState({ name: detail.user.name, phone: detail.user.phone, availabilityNote: detail.availabilityNote, tags: detail.tags.map((t) => t.id), level: detail.level ? String(detail.level) : '', levelReason: detail.levelReason, capabilities: detail.capabilities });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await ask('save-person', { uid, name: form.name, phone: form.phone, availabilityNote: form.availabilityNote, tags: form.tags, level: form.level ? Number(form.level) : null, levelReason: form.levelReason, capabilities: form.capabilities });
      setSaved(true);
      await reload();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  const tags = detail.settings.tags.filter((t) => !t.retired || form.tags.includes(t.id));
  return (
    <form className="mpmb-card" onSubmit={(e) => void save(e)} aria-labelledby="pe-h">
      <h3 className="mpmb-h3" id="pe-h">
        Status, experience and jobs
      </h3>
      <p className="mpmb-hint">For the team only. They see only “Ready” or “On hold”, never the other statuses, the level or the notes.</p>
      <fieldset className="mpmb-tools__days">
        <legend className="mpmb-label">Status</legend>
        {tags.map((t) => (
          <label key={t.id} className="mpmb-portal__inline">
            <input type="checkbox" checked={form.tags.includes(t.id)} onChange={(e) => setForm({ ...form, tags: e.target.checked ? [...form.tags, t.id] : form.tags.filter((x) => x !== t.id) })} /> {t.label}
            {t.retired ? ' (retired)' : ''}
          </label>
        ))}
      </fieldset>
      <div className="mpmb-tools__grid">
        <SelectField id="pe-level" label="Experience" placeholder="Not set" options={([1, 2, 3, 4] as Level[]).map((l) => ({ value: String(l), label: `${l}: ${LEVEL_LABEL[l]}` }))} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} />
        <TextField id="pe-reason" label="Why this level" required={false} value={form.levelReason} onChange={(e) => setForm({ ...form, levelReason: e.target.value })} hint="Optional: for example “led three school days”." />
      </div>
      <fieldset className="mpmb-tools__days">
        <legend className="mpmb-label">Jobs they can do on the day</legend>
        {DAY_ROLES.map((r) => (
          <label key={r} className="mpmb-portal__inline">
            <input type="checkbox" checked={form.capabilities.includes(r)} onChange={(e) => setForm({ ...form, capabilities: e.target.checked ? [...form.capabilities, r] : form.capabilities.filter((x) => x !== r) })} /> {DAY_ROLE_LABEL[r]}
          </label>
        ))}
      </fieldset>
      <div className="mpmb-tools__grid">
        <TextField id="pe-name" label="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <TextField id="pe-phone" label="Mobile" required={false} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </div>
      <TextField id="pe-avail" label="Notes on availability" required={false} value={form.availabilityNote} onChange={(e) => setForm({ ...form, availabilityNote: e.target.value })} hint="For example “no Fridays; lectures on Tuesday mornings”." />
      <ErrorLine error={error} />
      {saved && <p role="status">Saved.</p>}
      <Button type="submit" variant="primary" loading={busy}>
        Save
      </Button>
    </form>
  );
}

/** The team's notes about someone: dated, with who wrote them; never shown to the person. */
function PersonNotes({ uid, notes, pm, reload }: { uid: string; notes: PersonNote[]; pm: boolean; reload: () => Promise<void> }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await ask('add-note', { uid, text: draft });
      setDraft('');
      await reload();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm('Delete this note?')) return;
    try {
      await ask('delete-note', { id });
      await reload();
    } catch (err) {
      setError(messageOf(err));
    }
  };
  return (
    <section aria-labelledby="notes-h">
      <h3 className="mpmb-h3" id="notes-h">
        Team notes
      </h3>
      <p className="mpmb-hint">Seen by the research team only.</p>
      {notes.length > 0 && (
        <ul className="mpmb-tools__list">
          {notes.map((n) => (
            <li key={n.id} className="mpmb-tools__row mpmb-tools__row--stack">
              <span>{n.text}</span>
              <span className="mpmb-hint">
                {n.byName}, {stamp(n.at)}{' '}
                {(n.mine || pm) && (
                  <Button variant="link" onClick={() => void remove(n.id)}>
                    Delete
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => void add(e)}>
        <label className="mpmb-label" htmlFor="note-new">
          Add a note
        </label>
        <textarea id="note-new" className="mpmb-input" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <ErrorLine error={error} />
        <Button type="submit" variant="secondary" loading={busy} disabled={!draft.trim()}>
          Add the note
        </Button>
      </form>
    </section>
  );
}

function DocCheck({ doc, pm, reload }: { doc: DocRow; pm: boolean; reload: () => Promise<void> }) {
  const [form, setForm] = useState({ certificateNumber: doc.details?.certificateNumber ?? '', issueDate: doc.details?.issueDate ?? '', updateService: doc.details?.updateService ?? false, expiresOn: doc.details?.expiresOn ?? '', note: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(doc.state === 'uploaded');
  const [editing, setEditing] = useState(false);
  const saveDetails = async () => {
    setBusy(true);
    setError(null);
    try {
      await ask('save-doc-details', { docId: doc.docId, details: { certificateNumber: form.certificateNumber, issueDate: form.issueDate || '', updateService: form.updateService, expiresOn: form.expiresOn || '' } });
      setEditing(false);
      await reload();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
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
          {!open && doc.state !== 'uploaded' && doc.state !== 'rejected' && (doc.dbs || doc.expires) && (
            <Button variant="ghost" onClick={() => setEditing(!editing)} aria-expanded={editing}>
              Correct the details
            </Button>
          )}
        </div>
      )}
      {pm && doc.docId && editing && !open && (
        <div className="mpmb-portal__check">
          {doc.dbs && (
            <div className="mpmb-tools__grid">
              <TextField id={`${id}-enum`} label="Certificate number" inputMode="numeric" value={form.certificateNumber} onChange={(e) => setForm({ ...form, certificateNumber: e.target.value })} />
              <TextField id={`${id}-eissue`} label="Issue date" type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} />
            </div>
          )}
          {doc.dbs && (
            <label className="mpmb-portal__inline">
              <input type="checkbox" checked={form.updateService} onChange={(e) => setForm({ ...form, updateService: e.target.checked })} /> On the DBS Update Service
            </label>
          )}
          <TextField id={`${id}-eexp`} label={doc.dbs ? 'Recheck date' : 'Expiry date'} required={false} type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} />
          <Button variant="primary" loading={busy} onClick={() => void saveDetails()}>
            Save the details
          </Button>
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
export async function downloadIcs(action: 'visit-ics' | 'visits-ics', data: Record<string, unknown> = {}) {
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
  eeg: string;
  copro: string;
  arrival: string;
  taxiFrom: string;
  taxiTime: string;
  direct: string;
  notes: string;
  /** Days changed from the usual: switched on or off, other times, other numbers or travel times. */
  overrides: Record<string, DayOverride>;
}
type DayOverride = { on?: boolean; start?: string; end?: string; eeg?: string; copro?: string; arrival?: string; taxiTime?: string };
const DEFAULT_TAXI_FROM = 'School of Psychology, University of Leeds';
const count = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v));

/** Every day of the period, with the usual times, weekends off, and any day changed. */
function formDays(f: VisitFormValue): VisitDay[] {
  if (!f.startDate) return [];
  const last = f.endDate && f.endDate >= f.startDate ? f.endDate : f.startDate;
  const out: VisitDay[] = [];
  for (let d = f.startDate, n = 0; d <= last && n < 62; d = addDays(d, 1), n += 1) {
    const o = f.overrides[d] ?? {};
    const eeg = count(o.eeg);
    const copro = count(o.copro);
    out.push({ date: d, on: o.on ?? !isWeekend(d), start: o.start || f.start, end: o.end || f.end, ...(eeg !== undefined ? { eeg } : {}), ...(copro !== undefined ? { copro } : {}), ...(o.arrival ? { arrival: o.arrival } : {}), ...(o.taxiTime ? { taxiTime: o.taxiTime } : {}) });
  }
  return out;
}

export function emptyVisitForm(): VisitFormValue {
  return { schoolId: '', startDate: '', endDate: '', start: '08:30', end: '15:00', location: '', eeg: '6', copro: '2', arrival: '', taxiFrom: DEFAULT_TAXI_FROM, taxiTime: '', direct: '', notes: '', overrides: {} };
}

export function visitFormFrom(v: Visit): VisitFormValue {
  const overrides: VisitFormValue['overrides'] = {};
  for (const d of v.days) {
    const o: DayOverride = {};
    if (d.on === isWeekend(d.date)) o.on = d.on;
    if (d.start !== v.start) o.start = d.start;
    if (d.end !== v.end) o.end = d.end;
    if (d.eeg !== undefined) o.eeg = String(d.eeg);
    if (d.copro !== undefined) o.copro = String(d.copro);
    if (d.arrival) o.arrival = d.arrival;
    if (d.taxiTime) o.taxiTime = d.taxiTime;
    if (Object.keys(o).length) overrides[d.date] = o;
  }
  return { schoolId: v.schoolId, startDate: v.startDate, endDate: v.endDate, start: v.start, end: v.end, location: v.location, eeg: String(v.roleNeeds.eeg), copro: String(v.roleNeeds.copro), arrival: v.travel.arrival, taxiFrom: v.travel.taxiFrom, taxiTime: v.travel.taxiTime, direct: v.travel.direct, notes: v.notes, overrides };
}

/**
 * Adding or changing a visit: the school, the first and last dates, the usual
 * times and where; then every day of the period listed, each switched on or
 * off (weekends off to start with) and with its own times if they differ.
 */
export function VisitForm({ schools, initial, visitId, onSaved, submitLabel, idPrefix = 'v' }: { schools: School[]; initial: VisitFormValue; visitId?: string; onSaved: (visitId: string) => void | Promise<void>; submitLabel: string; idPrefix?: string }) {
  const [form, setForm] = useState<VisitFormValue>(initial);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const days = formDays(form);
  const on = days.filter((d) => d.on);
  const schoolName = schools.find((s) => s.id === form.schoolId)?.name ?? '';
  const [dayDetail, setDayDetail] = useState<string | null>(null);
  const setDay = (date: string, patch: DayOverride) => setForm({ ...form, overrides: { ...form.overrides, [date]: { ...form.overrides[date], ...patch } } });
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
        roleNeeds: { eeg: Number(form.eeg), copro: Number(form.copro) },
        travel: { arrival: form.arrival, taxiFrom: form.taxiFrom, taxiTime: form.taxiTime, direct: form.direct },
        notes: form.notes,
        days,
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
        <TextField id={`${idPrefix}-eeg`} label="EEG: people needed each day" type="number" min={0} max={30} value={form.eeg} onChange={(e) => setForm({ ...form, eeg: e.target.value })} />
        <TextField id={`${idPrefix}-copro`} label="Co-production: people needed each day" type="number" min={0} max={30} value={form.copro} onChange={(e) => setForm({ ...form, copro: e.target.value })} />
      </div>
      <fieldset className="mpmb-portal__days">
        <legend className="mpmb-label">Travel (optional)</legend>
        <div className="mpmb-tools__grid">
          <TextField id={`${idPrefix}-arrive`} label="Arrive at the school by" required={false} type="time" value={form.arrival} onChange={(e) => setForm({ ...form, arrival: e.target.value })} />
          <TextField id={`${idPrefix}-taxitime`} label="Taxi leaves at" required={false} type="time" value={form.taxiTime} onChange={(e) => setForm({ ...form, taxiTime: e.target.value })} />
          <TextField id={`${idPrefix}-taxifrom`} label="Taxi leaves from" required={false} value={form.taxiFrom} onChange={(e) => setForm({ ...form, taxiFrom: e.target.value })} />
          <TextField id={`${idPrefix}-direct`} label="For anyone going straight there" required={false} value={form.direct} onChange={(e) => setForm({ ...form, direct: e.target.value })} hint="For example “Please let Sarmad know if you are travelling directly.”" />
        </div>
      </fieldset>
      {days.length > 0 && (
        <fieldset className="mpmb-portal__days">
          <legend className="mpmb-label">
            The days ({on.length} of {days.length} on)
          </legend>
          <p className="mpmb-hint">Weekends start switched off. Switch any day on or off, and change a day’s times if they differ from the usual. “Numbers and travel” sets a day’s own EEG and co-production numbers, or its own arrival and taxi times.</p>
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
                    <span className="mpmb-hint">
                      EEG {d.eeg ?? form.eeg} · Co-production {d.copro ?? form.copro}
                    </span>
                    <Button variant="link" onClick={() => setDayDetail(dayDetail === d.date ? null : d.date)} aria-expanded={dayDetail === d.date}>
                      Numbers and travel
                    </Button>
                  </span>
                )}
                {d.on && dayDetail === d.date && (
                  <span className="mpmb-portal__times">
                    <label className="mpmb-hint">
                      EEG <input className="mpmb-input mpmb-portal__num" type="number" min={0} max={30} aria-label={`${longDate(d.date)}: EEG needed`} placeholder={form.eeg} value={form.overrides[d.date]?.eeg ?? ''} onChange={(e) => setDay(d.date, { eeg: e.target.value })} />
                    </label>
                    <label className="mpmb-hint">
                      Co-production <input className="mpmb-input mpmb-portal__num" type="number" min={0} max={30} aria-label={`${longDate(d.date)}: co-production needed`} placeholder={form.copro} value={form.overrides[d.date]?.copro ?? ''} onChange={(e) => setDay(d.date, { copro: e.target.value })} />
                    </label>
                    <label className="mpmb-hint">
                      Arrive <input className="mpmb-input" type="time" aria-label={`${longDate(d.date)}: arrive by`} value={form.overrides[d.date]?.arrival ?? ''} onChange={(e) => setDay(d.date, { arrival: e.target.value })} />
                    </label>
                    <label className="mpmb-hint">
                      Taxi <input className="mpmb-input" type="time" aria-label={`${longDate(d.date)}: taxi leaves`} value={form.overrides[d.date]?.taxiTime ?? ''} onChange={(e) => setDay(d.date, { taxiTime: e.target.value })} />
                    </label>
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
          <h2 className="mpmb-h2">Upcoming and recent</h2>
          {!value ? <p>Loading…</p> : !value.visits.length ? <p>None yet.</p> : <VisitTable visits={value.visits} go={go} />}
          <div className="mpmb-actions">
            <Button variant="secondary" onClick={() => void downloadIcs('visits-ics').catch((e) => setDlError(messageOf(e)))}>
              Add all upcoming visits to my calendar (.ics)
            </Button>
          </div>
          <ErrorLine error={dlError} />
        </section>
        {value && <TeamEmailRange schools={value.schools.filter((s) => s.active)} />}
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

export interface CanvassDay {
  date: string;
  start: string;
  end: string;
  yes: string[];
  maybe: string[];
  no: string[];
  noAnswer: string[];
}

/** For provisional dates: day by day, who could do it, who might, who can't, and who hasn't answered. */
export function CanvassSummary({ days, provisional }: { days: CanvassDay[]; provisional: boolean }) {
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

/* ── Training and pilots ──────────────────────────────────────────────── */

interface Session {
  id: string;
  kind: 'training' | 'pilot';
  date: string;
  title: string;
  notes: string;
  attendees: string[];
  role?: DayRole | null;
}

export function Sessions() {
  const { value, error, load } = useLoad<{ sessions: Session[]; people: { uid: string; name: string; role: Role }[] }>('sessions');
  const blank = { id: '', kind: 'training' as 'training' | 'pilot', role: '' as DayRole | '', date: todayIso(), title: '', notes: '', attendees: [] as string[] };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await ask('save-session', { ...form, id: form.id || undefined, role: form.role || null });
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
        <ClaimsToConfirm onChange={load} />
        <form className="mpmb-card" onSubmit={(e) => void save(e)}>
          <h2 className="mpmb-h2">{form.id ? 'Change a session' : 'Record a training session or pilot'}</h2>
          <div className="mpmb-tools__grid">
            <SelectField id="s-kind" label="Kind" placeholder="Choose" options={[{ value: 'training', label: 'Training' }, { value: 'pilot', label: 'Pilot' }]} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'training' | 'pilot' })} />
            <TextField id="s-date" label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <TextField id="s-title" label="Title" placeholder="EEG set-up training" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            {form.kind === 'training' && <SelectField id="s-role" label="Training for" placeholder="Both jobs, or general" options={DAY_ROLES.map((r) => ({ value: r, label: DAY_ROLE_LABEL[r] }))} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as DayRole | '' })} />}
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
                  <strong>{s.title}</strong> · {s.kind === 'pilot' ? 'Pilot' : 'Training'}
                  {s.role ? ` (${DAY_ROLE_LABEL[s.role]})` : ''} · {shortDate(s.date)}
                  <br />
                  <span className="mpmb-hint">{s.attendees.map((u) => names.get(u) ?? 'someone archived').join(', ') || 'Nobody ticked'}</span>
                </span>
                <span className="mpmb-actions">
                  <Button variant="ghost" onClick={() => setForm({ ...s, role: s.role ?? '' })}>
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

type WaitingClaim = TrainingClaim & { uid: string; name: string; matches: { id: string; title: string; attendees: number }[] };

/** What research assistants logged themselves, for the team to confirm or decline (4 November 2026). */
function ClaimsToConfirm({ onChange }: { onChange: () => Promise<void> }) {
  const { value, error, load } = useLoad<{ waiting: WaitingClaim[]; recent: (TrainingClaim & { name: string; decidedByName: string })[] }>('training-claims');
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [into, setInto] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const waiting = value?.waiting ?? [];
  const target = (c: WaitingClaim) => (c.sessionId ? undefined : (into[c.id] ?? c.matches[0]?.id ?? 'new'));
  const confirm = async (list: WaitingClaim[]) => {
    setBusy(list.length === 1 ? list[0].id : 'bulk');
    setMessage(null);
    try {
      const r = await ask<{ confirmed: number; problems: string[] }>('confirm-claims', { items: list.map((c) => ({ id: c.id, into: target(c) })) });
      setMessage({ tone: r.problems.length ? 'warning' : 'success', text: `Confirmed ${r.confirmed}.${r.problems.length ? ` Not confirmed: ${r.problems.join(' ')}` : ''}` });
      setTicked({});
      await Promise.all([load(), onChange()]);
    } catch (e) {
      setMessage({ tone: 'warning', text: messageOf(e) });
    } finally {
      setBusy(null);
    }
  };
  const decline = async (c: WaitingClaim) => {
    const reason = window.prompt(`Why can't you confirm ${c.name}'s ${c.kind === 'pilot' ? 'pilot' : 'training'} on ${shortDate(c.date)}? They will see this.`);
    if (!reason) return;
    setBusy(c.id);
    setMessage(null);
    try {
      await ask('decline-claim', { id: c.id, reason });
      setMessage({ tone: 'success', text: `Declined; ${c.name} has been told why.` });
      await load();
    } catch (e) {
      setMessage({ tone: 'warning', text: messageOf(e) });
    } finally {
      setBusy(null);
    }
  };
  const chosen = waiting.filter((c) => ticked[c.id]);
  return (
    <section className="mpmb-card" aria-labelledby="claims-heading">
      <h2 className="mpmb-h2" id="claims-heading">
        To confirm{waiting.length ? ` (${waiting.length})` : ''}
      </h2>
      <p className="mpmb-hint">Training and pilots research assistants logged themselves. They count towards visits only once confirmed.</p>
      <ErrorLine error={error} />
      {message && (
        <Callout tone={message.tone} role="status">
          {message.text}
        </Callout>
      )}
      {!value ? (
        <p>Loading…</p>
      ) : !waiting.length ? (
        <p>Nothing waiting.</p>
      ) : (
        <>
          <ul className="mpmb-tools__list">
            {waiting.map((c) => (
              <li key={c.id} className="mpmb-tools__row">
                <span>
                  <label className="mpmb-portal__inline">
                    <input type="checkbox" checked={!!ticked[c.id]} onChange={(e) => setTicked({ ...ticked, [c.id]: e.target.checked })} /> <strong>{c.name}</strong>
                  </label>
                  : {c.kind === 'pilot' ? 'Pilot' : 'Training'}
                  {c.role ? ` (${DAY_ROLE_LABEL[c.role]})` : ''} · “{c.title}” · {shortDate(c.date)}
                  {c.ranBy ? ` · run by ${c.ranBy}` : ''}
                  {c.notes ? (
                    <>
                      <br />
                      <span className="mpmb-hint">{c.notes}</span>
                    </>
                  ) : null}
                  <br />
                  {c.sessionId ? (
                    <span className="mpmb-hint">Says they were at a session the team recorded.</span>
                  ) : (
                    <select className="mpmb-select" aria-label={`Where to record ${c.name}'s entry`} value={target(c)} onChange={(e) => setInto({ ...into, [c.id]: e.target.value })}>
                      {c.matches.map((m) => (
                        <option key={m.id} value={m.id}>
                          Add to “{m.title}” ({m.attendees} already there)
                        </option>
                      ))}
                      <option value="new">Record as a new session</option>
                    </select>
                  )}
                </span>
                <span className="mpmb-actions">
                  <Button variant="secondary" loading={busy === c.id} onClick={() => void confirm([c])}>
                    Confirm
                  </Button>
                  <Button variant="ghost" disabled={busy === c.id} onClick={() => void decline(c)}>
                    Decline
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <div className="mpmb-actions">
            <Button variant="primary" disabled={!chosen.length} loading={busy === 'bulk'} onClick={() => void confirm(chosen)}>
              Confirm the {chosen.length || ''} ticked
            </Button>
            <Button variant="ghost" onClick={() => setTicked(Object.fromEntries(waiting.map((c) => [c.id, true])))}>
              Tick all
            </Button>
          </div>
        </>
      )}
      {value && value.recent.length > 0 && (
        <details>
          <summary>Recently decided</summary>
          <ul className="mpmb-tools__list">
            {value.recent.map((c) => (
              <li key={c.id} className="mpmb-tools__row">
                <span>
                  {c.name}: “{c.title}”, {shortDate(c.date)} · {c.status === 'confirmed' ? 'Confirmed' : `Declined (${c.reason})`} by {c.decidedByName || 'the team'}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/* ── Schools ──────────────────────────────────────────────────────────── */

type SchoolEdit = { id: string; name: string; area: string; forms: string; contactName: string; contactEmails: string; includeDbs: boolean; dbsCopies: boolean };

export function Schools({ role }: { role: Role }) {
  const { value, error, load } = useLoad<{ schools: School[] }>('schools');
  const [edit, setEdit] = useState<SchoolEdit | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [password, setPassword] = useState<{ schoolId: string; password: string; link: string } | null>(null);
  const pm = role === 'pm';
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
      await ask('save-school', { id: edit.id || undefined, name: edit.name, area: edit.area, requiredDocs, contactName: edit.contactName, contactEmails: edit.contactEmails, includeDbs: edit.includeDbs, ...(pm ? { dbsCopies: edit.dbsCopies } : {}) });
      setEdit(null);
      await load();
    } catch (err) {
      setFormError(messageOf(err));
    }
  };
  const dbsAction = async (s: School, action: 'make-dbs-password' | 'close-dbs-access') => {
    if (action === 'make-dbs-password' && s.dbsAccess?.active && !window.confirm(`Make a new DBS page password for ${s.name}? The old one stops working.`)) return;
    if (action === 'close-dbs-access' && !window.confirm(`Close ${s.name}’s DBS page? Their password stops working.`)) return;
    setFormError(null);
    try {
      const r = await ask<{ password?: string; link?: string }>(action, { schoolId: s.id });
      setPassword(r.password ? { schoolId: s.id, password: r.password, link: r.link ?? '' } : null);
      await load();
    } catch (err) {
      setFormError(messageOf(err));
    }
  };
  return (
    <Loading error={error}>
      <div className="mpmb-tools__section">
        <ErrorLine error={!edit ? formError : null} />
        <ul className="mpmb-tools__list">
          {(value?.schools ?? []).map((s) => (
            <li key={s.id} className="mpmb-tools__row mpmb-tools__row--stack">
              <span>
                <strong>{s.name}</strong> · {s.area}
                <br />
                <span className="mpmb-hint">{s.requiredDocs.length ? `Also asks for: ${s.requiredDocs.map((d) => d.label).join(', ')}` : 'No extra forms'}</span>
                <br />
                <span className="mpmb-hint">
                  {s.contactEmails?.length ? `Contact: ${s.contactName ? `${s.contactName}, ` : ''}${s.contactEmails.join(', ')}` : 'No school contact yet'} · DBS details in emails {s.includeDbs ? 'on' : 'off'}
                </span>
                <br />
                <span className="mpmb-hint">
                  DBS page: {s.dbsAccess?.active ? `open (password made ${stamp(s.dbsAccess.setAt)}${s.dbsAccess.lastViewedAt ? `, last viewed ${stamp(s.dbsAccess.lastViewedAt)}` : ', not viewed yet'})` : 'closed (no password)'}
                  {s.dbsCopies ? ' · certificate copies shared' : ''}
                </span>
              </span>
              {password?.schoolId === s.id && (
                <Callout tone="important" title="The school’s DBS page password">
                  <p>
                    <strong className="mpmb-portal__password">{password.password}</strong>
                  </p>
                  <p>Give it to the school by phone; it is shown only now. The page: {password.link}</p>
                </Callout>
              )}
              <div className="mpmb-actions">
                <Button variant="ghost" onClick={() => setEdit({ id: s.id, name: s.name, area: s.area, forms: s.requiredDocs.map((d) => d.label).join('\n'), contactName: s.contactName ?? '', contactEmails: (s.contactEmails ?? []).join(', '), includeDbs: s.includeDbs === true, dbsCopies: s.dbsCopies === true })}>
                  Change
                </Button>
                {pm && (
                  <Button variant="secondary" onClick={() => void dbsAction(s, 'make-dbs-password')}>
                    {s.dbsAccess?.active ? 'New DBS page password' : 'Make a DBS page password'}
                  </Button>
                )}
                {pm && s.dbsAccess?.active && (
                  <Button variant="ghost" onClick={() => void dbsAction(s, 'close-dbs-access')}>
                    Close access
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {!edit && (
          <Button variant="secondary" onClick={() => setEdit({ id: '', name: '', area: '', forms: '', contactName: '', contactEmails: '', includeDbs: false, dbsCopies: false })}>
            Add a school
          </Button>
        )}
        {edit && (
          <form className="mpmb-card" onSubmit={(e) => void save(e)}>
            <h2 className="mpmb-h2">{edit.id ? `Change ${edit.name}` : 'Add a school'}</h2>
            <TextField id="sc-name" label="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <TextField id="sc-area" label="Area" required={false} value={edit.area} onChange={(e) => setEdit({ ...edit, area: e.target.value })} />
            <TextField id="sc-contact" label="School contact’s name" required={false} value={edit.contactName} onChange={(e) => setEdit({ ...edit, contactName: e.target.value })} />
            <TextField id="sc-emails" label="School email addresses" required={false} value={edit.contactEmails} onChange={(e) => setEdit({ ...edit, contactEmails: e.target.value })} hint="Separate several with commas. Emails about who is coming go here." />
            <label className="mpmb-portal__inline">
              <input type="checkbox" checked={edit.includeDbs} onChange={(e) => setEdit({ ...edit, includeDbs: e.target.checked })} /> This school wants DBS details (the email links to its password-protected DBS page; numbers are never emailed)
            </label>
            {pm && (
              <label className="mpmb-portal__inline">
                <input type="checkbox" checked={edit.dbsCopies} onChange={(e) => setEdit({ ...edit, dbsCopies: e.target.checked })} /> Let this school open copies of the certificates on its DBS page
              </label>
            )}
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
      await ask('save-settings', { settings: { ...form, alwaysCopy: form.alwaysCopy.filter(Boolean) } });
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
        <h2 className="mpmb-h2">Always copy in</h2>
        <p className="mpmb-hint">Copied into every portal email sent to anyone else (offers, confirmations, team and school emails, new dates). Emails to many people go as one email, so these addresses get one copy. Sign-in link emails come from Firebase and are not copied.</p>
        <label className="mpmb-label" htmlFor="st-copy">
          Email addresses, one per line
        </label>
        <textarea id="st-copy" className="mpmb-input" rows={2} value={form.alwaysCopy.join('\n')} onChange={(e) => setForm({ ...form, alwaysCopy: e.target.value.split('\n').map((x) => x.trim()) })} />
      </section>
      <section>
        <h2 className="mpmb-h2">Jobs on the day</h2>
        <p className="mpmb-hint">How many people each new visit needs per day; each visit, and each day, can say otherwise.</p>
        <div className="mpmb-tools__grid">
          <TextField id="st-eeg" label="EEG" type="number" min={0} max={30} value={form.roleNeeds.eeg} onChange={(e) => setForm({ ...form, roleNeeds: { ...form.roleNeeds, eeg: Number(e.target.value) } })} />
          <TextField id="st-copro" label="Co-production" type="number" min={0} max={30} value={form.roleNeeds.copro} onChange={(e) => setForm({ ...form, roleNeeds: { ...form.roleNeeds, copro: Number(e.target.value) } })} />
        </div>
      </section>
      <section>
        <h2 className="mpmb-h2">Status tags</h2>
        <p className="mpmb-hint">The statuses the team can give people. Research assistants only ever see “Ready” or “On hold”. Retire a tag to stop using it without taking it off anyone.</p>
        {form.tags.map((t, i) => (
          <div key={t.id} className="mpmb-actions">
            <input className="mpmb-input" aria-label={`Tag ${t.id}`} value={t.label} onChange={(e) => setForm({ ...form, tags: form.tags.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
            <label className="mpmb-portal__inline">
              <input type="checkbox" checked={t.retired === true} onChange={(e) => setForm({ ...form, tags: form.tags.map((x, j) => (j === i ? { ...x, retired: e.target.checked || undefined } : x)) })} /> Retired
            </label>
          </div>
        ))}
        <Button variant="ghost" onClick={() => setForm({ ...form, tags: [...form.tags, { id: `tag-${form.tags.length + 1}`, label: 'New status' }] })}>
          Add a status
        </Button>
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
