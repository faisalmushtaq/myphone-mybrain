import { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { TextField } from '../components/ui/Field';
import { ask, messageOf } from './api';
import { SchoolEmail, TeamEmail } from './EmailViews';
import { CanvassSummary, downloadIcs, ErrorLine, levelLine, Loading, TagBadges, useLoad, VisitForm, visitFormFrom, type CanvassDay } from './TeamViews';
import { ASSIGNMENT_LABEL, ATTENDANCE_LABEL, AVAILABILITY_LABEL, clock, DAY_ROLE_LABEL, DAY_ROLES, DBS_STATUS_LABEL, RA_ROLES, type DbsStatus, daysOn, shortDate, stamp, todayIso, travelOn, VISIT_STATUS_LABEL, type AssignmentStatus, type AttendanceMark, type Availability, type Counts, type DayCoverage, type DayRole, type School, type TeamExtras, type Visit, type VisitStatus } from './types';

interface Place {
  uid: string;
  status: AssignmentStatus;
  role: DayRole;
  dates: string[];
  timeNotes?: Record<string, string>;
  note: string;
  override: { reason: string; byName: string } | null;
  removedReason: string;
}

interface Candidate extends TeamExtras {
  uid: string;
  name: string;
  email: string;
  perDay: { date: string; value: Availability | null; covers: 'yes' | 'no' | 'unknown' }[];
  coverage: 'all' | 'some' | 'none' | 'unknown';
  availableDates: string[];
  interested: boolean;
  counts: Counts;
  eligible: boolean;
  reasons: string[];
  assignment: Place | null;
  /** A member of the research team: they lead, and are booked straight away. */
  team?: boolean;
  dbsStatus?: DbsStatus;
}

interface OfferItem {
  uid: string;
  role: DayRole;
  dates: string[];
}

interface VisitData {
  visit: Visit & { requiredDocs: string[]; schoolEmails: string[] };
  candidates: Candidate[];
  canvass: CanvassDay[] | null;
  coverage: DayCoverage[];
  suggestion: OfferItem[];
  attendance: { uid: string; date: string; mark: AttendanceMark; note: string }[];
  teamEmail: { lastAt: string | null; lastBy: string; changedSince: boolean } | null;
  schoolEmail: { lastAt: string | null; lastBy: string; lastTo: string[]; lastIncludedDbs: boolean; changedSince: boolean } | null;
  mayOverride: boolean;
  mayRemove: boolean;
}

const COVERAGE: Record<Candidate['coverage'], { label: (c: Candidate) => string; tone: string }> = {
  all: { label: (c) => (c.perDay.length === 1 ? AVAILABILITY_LABEL[c.perDay[0].value ?? 'all'] : 'Available every day'), tone: 'ok' },
  some: { label: (c) => `Available ${c.availableDates.length} of ${c.perDay.length} days`, tone: 'wait' },
  none: { label: () => 'Not available', tone: 'todo' },
  unknown: { label: () => 'No availability given', tone: 'wait' },
};

const holds = (p: Place | null) => !!p && (p.status === 'offered' || p.status === 'confirmed');

/** One job's numbers on a day: "4 of 6 confirmed, 1 offered". */
function Cell({ c }: { c: { need: number; offered: number; confirmed: number } }) {
  const tone = c.need === 0 ? 'wait' : c.confirmed >= c.need ? 'ok' : c.confirmed + c.offered >= c.need ? 'wait' : 'todo';
  return (
    <td>
      <span className={`mpmb-portal__badge mpmb-portal__badge--${tone}`}>
        {c.confirmed} of {c.need}
      </span>
      {c.offered > 0 && <span className="mpmb-hint"> +{c.offered} offered</span>}
    </td>
  );
}

/**
 * A visit's staffing page: each day's numbers for both jobs (offered and
 * confirmed apart), who has a place, the strongest team suggested and ticked
 * ready to change, attendance once a day is past, and the emails to the school
 * and the team.
 */
export function VisitView({ visitId, role, go }: { visitId: string; role: 'pm' | 'researcher'; go: (hash: string) => void }) {
  const { value, error, load } = useLoad<VisitData>('visit', { visitId });
  const schools = useLoad<{ schools: School[] }>('schools');
  const [picks, setPicks] = useState<Record<string, { role: DayRole; dates: string[] }>>({});
  const [seeded, setSeeded] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<{ uid: string; name: string; dates: string[] } | null>(null);
  const [reason, setReason] = useState('');
  const [panel, setPanel] = useState<null | 'school' | 'school-update' | 'team' | 'team-update'>(null);
  // The suggestion arrives ticked; change it as you like before locking in.
  useEffect(() => {
    if (!value || seeded) return;
    setPicks(Object.fromEntries(value.suggestion.map((s) => [s.uid, { role: s.role, dates: s.dates }])));
    setSeeded(true);
  }, [value, seeded]);
  if (!value) return <Loading error={error}>Loading…</Loading>;
  const v = value.visit;
  const on = daysOn(v);
  const placed = value.candidates.filter((c) => holds(c.assignment));
  const free = value.candidates.filter((c) => !holds(c.assignment));
  const confirmedCount = placed.filter((c) => c.assignment!.status === 'confirmed').length;
  const full = value.coverage.length > 0 && value.coverage.every((d) => DAY_ROLES.every((r) => (d[r]?.confirmed ?? 0) >= (d[r]?.need ?? 0)));
  const chosen = Object.entries(picks).filter(([, p]) => p.dates.length);
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
  const suggest = () => setPicks(Object.fromEntries(value.suggestion.map((s) => [s.uid, { role: s.role, dates: s.dates }])));
  const offer = async () => {
    setBusy(true);
    const ok = await run('offer', { offers: chosen.map(([uid, p]) => ({ uid, role: p.role, dates: p.dates })), overrides }, `Done: ${chosen.length} chosen. Research assistants have an offer to confirm; research leads are booked straight away. Each has a notification and an email naming their job and days.`);
    setBusy(false);
    if (ok) {
      setPicks({});
      setOverrides({});
      setSeeded(false);
    }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    const ok = await run('remove-confirmed', { uid: removing.uid, reason, dates: removing.dates }, `${removing.name} removed from ${removing.dates.length} day${removing.dates.length === 1 ? '' : 's'}. They have been notified and emailed, and the place is open again.`);
    setBusy(false);
    if (ok) {
      setRemoving(null);
      setReason('');
    }
  };
  const pick = (c: Candidate, patch: Partial<{ role: DayRole; dates: string[] }> | null) => {
    const next = { ...picks };
    if (patch === null) delete next[c.uid];
    else {
      const base = (picks[c.uid] as { role: DayRole; dates: string[] } | undefined) ?? { role: c.capabilities[0] ?? 'eeg', dates: c.availableDates.length ? c.availableDates : on.map((d) => d.date) };
      next[c.uid] = { ...base, ...patch };
    }
    setPicks(next);
  };
  const lastDay = on.at(-1)?.date ?? '';
  const past = on.filter((d) => d.date <= todayIso());
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
        <p>
          EEG {v.roleNeeds.eeg} · Co-production {v.roleNeeds.copro} · Leads {v.roleNeeds.lead ?? 0} a day{' '}
          <span className={`mpmb-portal__badge mpmb-portal__badge--${full ? 'ok' : 'wait'}`}>{full ? 'Fully staffed' : VISIT_STATUS_LABEL[v.status]}</span>
        </p>
        {(v.travel.arrival || v.travel.taxiTime || v.travel.direct) && (
          <p className="mpmb-hint">
            Travel: {v.travel.taxiTime ? `taxi from ${v.travel.taxiFrom} at ${clock(v.travel.taxiTime)}` : ''}
            {v.travel.taxiTime && v.travel.arrival ? '; ' : ''}
            {v.travel.arrival ? `at the school by ${clock(v.travel.arrival)}` : ''}
            {v.travel.direct ? `. ${v.travel.direct}` : ''}
          </p>
        )}
        <p className="mpmb-hint">Needs: {v.requiredDocs.join(', ')}. Documents must be in date on every day.</p>
        <div className="mpmb-actions">
          <select
            className="mpmb-select"
            aria-label="Visit status"
            value={v.status}
            onChange={(e) => {
              const next = e.target.value as VisitStatus;
              const note = next === 'provisional' ? 'Every research assistant is told about these possible dates (push and email, as they choose).' : next === 'staffing' && v.status === 'provisional' ? 'Those who said they could do it are told the dates are confirmed; everyone else hears about new dates.' : next === 'staffing' && v.status === 'draft' ? 'Every research assistant is told about the new dates.' : next === 'cancelled' && v.status === 'provisional' ? 'Everyone who answered is told the dates won’t go ahead.' : '';
              if (note && !window.confirm(`${VISIT_STATUS_LABEL[next]}: ${note} Go ahead?`)) return;
              void run('set-visit-status', { status: next }, note ? `Status changed. ${note}` : undefined);
            }}
          >
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
            {editing ? 'Close' : 'Change days, numbers, travel or place'}
          </Button>
        </div>
      </div>
      {editing && schools.value && (
        <section aria-label="Change the visit">
          {confirmedCount > 0 && <p className="mpmb-hint">{confirmedCount} confirmed: they will be notified and emailed an updated calendar invitation if their days, times or the place change.</p>}
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

      <section aria-labelledby="cover-h">
        <h3 className="mpmb-h3" id="cover-h">
          Each day
        </h3>
        <p className="mpmb-hint">Confirmed against what is needed; offers still waiting are shown apart. Fully staffed when every day has every job confirmed.</p>
        <div className="mpmb-portal__tablewrap">
          <table className="mpmb-portal__table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">EEG</th>
                <th scope="col">Co-production</th>
                <th scope="col">Leads</th>
                <th scope="col">Confirmed</th>
              </tr>
            </thead>
            <tbody>
              {value.coverage.map((d) => {
                const day = on.find((x) => x.date === d.date)!;
                const t = travelOn(day, v.travel);
                return (
                  <tr key={d.date}>
                    <th scope="row">
                      {shortDate(d.date)}
                      <br />
                      <span className="mpmb-hint">
                        {d.start}–{d.end}
                        {t.taxiTime ? ` · taxi ${clock(t.taxiTime)}` : ''}
                      </span>
                    </th>
                    <Cell c={d.eeg} />
                    <Cell c={d.copro} />
                    <Cell c={d.lead ?? { need: 0, offered: 0, confirmed: 0 }} />
                    <td className="mpmb-hint">
                      {DAY_ROLES.map((r) => {
                        const names = placed.filter((c) => c.assignment!.status === 'confirmed' && c.assignment!.role === r && c.assignment!.dates.includes(d.date)).map((c) => `${c.name}${c.assignment!.timeNotes?.[d.date] ? ` (${c.assignment!.timeNotes[d.date]})` : ''}`);
                        return names.length ? (
                          <span key={r}>
                            {DAY_ROLE_LABEL[r]}: {names.join(', ')}
                            <br />
                          </span>
                        ) : null;
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="placed-h">
        <h3 className="mpmb-h3" id="placed-h">
          Placed
        </h3>
        {!placed.length ? (
          <p>Nobody yet.</p>
        ) : (
          <ul className="mpmb-tools__list">
            {placed.map((c) => {
              const a = c.assignment!;
              return (
                <li key={c.uid} className="mpmb-tools__row mpmb-tools__row--stack">
                  <span>
                    <strong>{c.name}</strong> · {DAY_ROLE_LABEL[a.role]} · {ASSIGNMENT_LABEL[a.status]}
                    <br />
                    <span className="mpmb-hint">
                      {a.dates.length === on.length ? 'Every day' : a.dates.map(shortDate).join(', ')}
                      {a.override ? ` · booked without being ready: ${a.override.reason}` : ''}
                      {a.note ? ` · “${a.note}”` : ''}
                    </span>
                  </span>
                  {a.status === 'confirmed' && (
                    <span className="mpmb-portal__times">
                      {a.dates.map((d) => (
                        <TimeNote key={d} date={d} initial={a.timeNotes?.[d] ?? ''} name={c.name} save={(note) => run('set-time-note', { uid: c.uid, date: d, note })} />
                      ))}
                    </span>
                  )}
                  <div className="mpmb-actions">
                    {a.status === 'offered' && (
                      <Button variant="ghost" onClick={() => window.confirm(`Withdraw the offer to ${c.name}?`) && void run('withdraw-offer', { uid: c.uid }, `Offer to ${c.name} withdrawn.`)}>
                        Withdraw offer
                      </Button>
                    )}
                    {a.status === 'confirmed' &&
                      (value.mayRemove ? (
                        <Button variant="ghost" onClick={() => (setRemoving({ uid: c.uid, name: c.name, dates: a.dates }), setReason(''))}>
                          Remove…
                        </Button>
                      ) : (
                        <span className="mpmb-hint">Only the project manager can remove</span>
                      ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {removing && (
          <div className="mpmb-card mpmb-portal__dialog" role="dialog" aria-modal="false" aria-labelledby="remove-h">
            <h3 className="mpmb-h3" id="remove-h">
              Remove {removing.name}?
            </h3>
            <p>They have confirmed. They get a notification and an email with the reason, the calendar entries for those days are cancelled, and the places open again.</p>
            <fieldset className="mpmb-tools__days">
              <legend className="mpmb-label">From which days</legend>
              {(placed.find((c) => c.uid === removing.uid)?.assignment?.dates ?? []).map((d) => (
                <label key={d} className="mpmb-portal__inline">
                  <input type="checkbox" checked={removing.dates.includes(d)} onChange={(e) => setRemoving({ ...removing, dates: e.target.checked ? [...removing.dates, d].sort() : removing.dates.filter((x) => x !== d) })} /> {shortDate(d)}
                </label>
              ))}
            </fieldset>
            <TextField id="remove-reason" label="Reason (recorded and sent to them)" value={reason} onChange={(e) => setReason(e.target.value)} hint="For example: emailed on 3 November to withdraw, unwell." />
            <div className="mpmb-actions">
              <Button variant="primary" loading={busy} disabled={!reason.trim() || !removing.dates.length} onClick={() => void remove()}>
                Remove {removing.name}
              </Button>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Keep them
              </Button>
            </div>
          </div>
        )}
      </section>

      {v.status !== 'cancelled' && lastDay >= todayIso() && (
        <section aria-labelledby="choose-h">
          <h3 className="mpmb-h3" id="choose-h">
            Choose who to ask
          </h3>
          <p className="mpmb-hint">
            The strongest team is ticked for you: the most experienced first, filling the job fewer people can do first, each on the days they are free. Change the job or days, untick or add people, then lock them in: each gets a notification and an email naming their job and days.
          </p>
          <div className="mpmb-actions">
            <Button variant="secondary" onClick={suggest}>
              Suggest the strongest team
            </Button>
            <Button variant="ghost" onClick={() => setPicks({})}>
              Untick everyone
            </Button>
          </div>
          <ul className="mpmb-tools__list">
            {free.map((c) => {
              const p = picks[c.uid];
              const roleChoices: DayRole[] = c.team ? ['lead'] : [...c.capabilities, ...RA_ROLES.filter((r) => !c.capabilities.includes(r))];
              const blocked = !c.eligible || (p && !c.capabilities.includes(p.role));
              return (
                <li key={c.uid} className={`mpmb-tools__row mpmb-tools__row--stack mpmb-portal__candidate${c.eligible ? '' : ' is-blocked'}`}>
                  <label className="mpmb-portal__inline">
                    <input type="checkbox" checked={!!p} disabled={!c.eligible && !value.mayOverride} onChange={(e) => pick(c, e.target.checked ? {} : null)} />
                    <span>
                      <strong>{c.name}</strong> <span className={`mpmb-portal__badge mpmb-portal__badge--${COVERAGE[c.coverage].tone}`}>{COVERAGE[c.coverage].label(c)}</span> <TagBadges tags={c.tags} />
                      {c.team && <span className="mpmb-portal__badge mpmb-portal__badge--ok">Research lead</span>}
                      {c.dbsStatus && c.dbsStatus !== 'confirmed' && <span className="mpmb-portal__badge mpmb-portal__badge--todo">DBS: {DBS_STATUS_LABEL[c.dbsStatus]}</span>}
                      {c.interested && <span className="mpmb-portal__badge mpmb-portal__badge--ok">Interested</span>}
                      {c.assignment?.status === 'declined' && <span className="mpmb-portal__badge mpmb-portal__badge--todo">Declined before</span>}
                      {c.assignment?.status === 'removed' && <span className="mpmb-portal__badge mpmb-portal__badge--todo">Removed before</span>}
                      <br />
                      <span className="mpmb-hint">
                        {levelLine(c)} · Training {c.counts.training} · Pilots {c.counts.pilots}
                        {c.availabilityNote ? ` · “${c.availabilityNote}”` : ''}
                        {!c.eligible ? ` · Not ready: ${c.reasons.join('; ')}` : ''}
                      </span>
                    </span>
                  </label>
                  {p && (
                    <span className="mpmb-portal__times">
                      <select className="mpmb-select" aria-label={`Job for ${c.name}`} value={p.role} onChange={(e) => pick(c, { role: e.target.value as DayRole })}>
                        {roleChoices.map((r) => (
                          <option key={r} value={r}>
                            {DAY_ROLE_LABEL[r]}
                            {c.capabilities.includes(r) ? '' : ' (not one of their jobs)'}
                          </option>
                        ))}
                      </select>
                      {on.length > 1 &&
                        c.perDay.map((d) => (
                          <label key={d.date} className={`mpmb-portal__dayChip mpmb-portal__dayChip--${d.covers}`} title={d.value ? AVAILABILITY_LABEL[d.value] : 'Not given'}>
                            <input type="checkbox" checked={p.dates.includes(d.date)} onChange={(e) => pick(c, { dates: e.target.checked ? [...p.dates, d.date].sort() : p.dates.filter((x) => x !== d.date) })} /> {shortDate(d.date)} <span className={`mpmb-portal__mark mpmb-portal__mark--${d.covers === 'yes' ? 'yes' : d.covers === 'no' ? 'no' : 'maybe'}`}>{d.covers === 'yes' ? 'free' : d.covers === 'no' ? 'not free' : 'not sure'}</span>
                          </label>
                        ))}
                    </span>
                  )}
                  {p && blocked && value.mayOverride && <input className="mpmb-input" aria-label={`Why book ${c.name} anyway`} placeholder="Why book them anyway? (recorded)" value={overrides[c.uid] ?? ''} onChange={(e) => setOverrides({ ...overrides, [c.uid]: e.target.value })} />}
                </li>
              );
            })}
          </ul>
          {v.status === 'provisional' && (
            <Callout tone="important" title="Provisional dates">
              <p>Places can’t be offered until the dates are confirmed. Once the school confirms, set the status to Staffing.</p>
            </Callout>
          )}
          <div className="mpmb-actions">
            <Button variant="primary" loading={busy} disabled={!chosen.length || v.status === 'provisional'} onClick={() => void offer()}>
              Lock in and notify {chosen.length ? `(${chosen.length})` : ''}
            </Button>
          </div>
        </section>
      )}

      {past.length > 0 && <Attendance visitId={visitId} days={past.map((d) => d.date)} placed={placed} marks={value.attendance} reload={load} />}

      <section aria-labelledby="emails-h">
        <h3 className="mpmb-h3" id="emails-h">
          Emails
        </h3>
        <p className="mpmb-hint">
          School: {value.schoolEmail ? `last told ${stamp(value.schoolEmail.lastAt)} by ${value.schoolEmail.lastBy} (${value.schoolEmail.lastTo.join(', ')})` : 'not told yet'}. Team: {value.teamEmail ? `last told ${stamp(value.teamEmail.lastAt)} by ${value.teamEmail.lastBy}` : 'not told yet'}.
        </p>
        {value.schoolEmail?.changedSince && (
          <Callout tone="important" title="Changes since the school was last told">
            <Button variant="secondary" onClick={() => setPanel('school-update')}>
              Send an update
            </Button>
          </Callout>
        )}
        {value.teamEmail?.changedSince && (
          <Callout tone="important" title="Changes since the team was last told">
            <Button variant="secondary" onClick={() => setPanel('team-update')}>
              Send the team an update
            </Button>
          </Callout>
        )}
        <div className="mpmb-actions">
          <Button variant="secondary" onClick={() => setPanel('school')}>
            Email the school
          </Button>
          <Button variant="secondary" onClick={() => setPanel('team')}>
            Email the team
          </Button>
        </div>
        {(panel === 'school' || panel === 'school-update') && (
          <SchoolEmail
            visitId={visitId}
            update={panel === 'school-update'}
            pm={role === 'pm'}
            close={() => setPanel(null)}
            onSent={(m) => {
              setPanel(null);
              setMessage(m);
              void load();
            }}
          />
        )}
        {(panel === 'team' || panel === 'team-update') && (
          <TeamEmail
            target={{ visitId }}
            update={panel === 'team-update'}
            close={() => setPanel(null)}
            onSent={(m) => {
              setPanel(null);
              setMessage(m);
              void load();
            }}
          />
        )}
      </section>
    </div>
  );
}

/** A note on someone's times on a day, shown in brackets after their name: "until 1:00 pm". */
function TimeNote({ date, initial, name, save }: { date: string; initial: string; name: string; save: (note: string) => Promise<boolean> }) {
  const [note, setNote] = useState(initial);
  return (
    <label className="mpmb-hint">
      {shortDate(date)}{' '}
      <input className="mpmb-input mpmb-portal__timenote" aria-label={`${name}, ${shortDate(date)}: time note`} placeholder="all day" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== initial && void save(note)} />
    </label>
  );
}

/** After each day: who came (late or leaving early still counts), who did not. */
function Attendance({ visitId, days, placed, marks, reload }: { visitId: string; days: string[]; placed: Candidate[]; marks: VisitData['attendance']; reload: () => Promise<void> }) {
  const [date, setDate] = useState(days.find((d) => placed.some((c) => c.assignment!.status === 'confirmed' && c.assignment!.dates.includes(d) && !marks.some((m) => m.uid === c.uid && m.date === d))) ?? days.at(-1)!);
  const people = placed.filter((c) => c.assignment!.status === 'confirmed' && c.assignment!.dates.includes(date));
  const initial = () => Object.fromEntries(people.map((c) => {
    const m = marks.find((x) => x.uid === c.uid && x.date === date);
    return [c.uid, { mark: (m?.mark ?? '') as AttendanceMark | '', note: m?.note ?? '' }];
  }));
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setForm(initial()), [date, marks]);
  const unmarked = (d: string) => placed.filter((c) => c.assignment!.status === 'confirmed' && c.assignment!.dates.includes(d) && !marks.some((m) => m.uid === c.uid && m.date === d)).length;
  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await ask('mark-attendance', { visitId, date, marks: Object.entries(form).filter(([, f]) => f.mark).map(([uid, f]) => ({ uid, mark: f.mark, note: f.note })) });
      setSaved(true);
      await reload();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="att-h" className="mpmb-card">
      <h3 className="mpmb-h3" id="att-h">
        Attendance
      </h3>
      <div className="mpmb-actions">
        {days.map((d) => (
          <Button key={d} variant={d === date ? 'primary' : 'ghost'} onClick={() => setDate(d)}>
            {shortDate(d)}
            {unmarked(d) ? ` (${unmarked(d)} to mark)` : ''}
          </Button>
        ))}
      </div>
      {!people.length ? (
        <p>Nobody was confirmed that day.</p>
      ) : (
        <ul className="mpmb-tools__list">
          {people.map((c) => (
            <li key={c.uid} className="mpmb-tools__row">
              <span>
                <strong>{c.name}</strong> · {DAY_ROLE_LABEL[c.assignment!.role]}
              </span>
              <span className="mpmb-portal__times">
                <select className="mpmb-select" aria-label={`${c.name}, ${shortDate(date)}`} value={form[c.uid]?.mark ?? ''} onChange={(e) => setForm({ ...form, [c.uid]: { ...form[c.uid], mark: e.target.value as AttendanceMark } })}>
                  <option value="">Not marked</option>
                  {(Object.keys(ATTENDANCE_LABEL) as AttendanceMark[]).map((m) => (
                    <option key={m} value={m}>
                      {ATTENDANCE_LABEL[m]}
                    </option>
                  ))}
                </select>
                <input className="mpmb-input" aria-label={`${c.name}: note`} placeholder="Note (optional)" value={form[c.uid]?.note ?? ''} onChange={(e) => setForm({ ...form, [c.uid]: { ...form[c.uid], note: e.target.value } })} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <ErrorLine error={error} />
      {saved && <p role="status">Saved.</p>}
      {people.length > 0 && (
        <Button variant="primary" loading={busy} onClick={() => void save()}>
          Save attendance for {shortDate(date)}
        </Button>
      )}
    </section>
  );
}
