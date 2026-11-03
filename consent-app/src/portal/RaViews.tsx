import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/ui/Icon';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { ACCEPT, ask, messageOf, uploadDocument } from './api';
import { SelectField, TextField } from '../components/ui/Field';
import { ASSIGNMENT_LABEL, AVAILABILITY_LABEL, CANVASS_LABEL, clock, DAY_ROLE_LABEL, DBS_STATUS_LABEL, dayLines, daysOn, DOC_STATE_LABEL, longDate, todayIso, travelOn, visitWhen, type Availability, type CanvassAnswer, type Contact, type DayRole, type DocRow, type MySummary, type TrainingClaim, type Visit } from './types';

/** A badge for a document's state, coloured by how much it needs doing. */
export function StateBadge({ state }: { state: DocRow['state'] }) {
  const tone = state === 'verified' ? 'ok' : state === 'uploaded' || state === 'expiring-soon' ? 'wait' : 'todo';
  return <span className={`mpmb-portal__badge mpmb-portal__badge--${tone}`}>{DOC_STATE_LABEL[state]}</span>;
}

/* ── The checklist ────────────────────────────────────────────────────── */

export function RaHome({ summary, go }: { summary: MySummary; go: (hash: string) => void }) {
  const general = summary.documents.filter((d) => d.schoolId === null);
  const docsDone = general.filter((d) => d.state === 'verified' || d.state === 'expiring-soon').length;
  const waiting = summary.assignments.filter((a) => a.status === 'offered');
  const upcoming = summary.assignments.filter((a) => a.status === 'confirmed');
  const { minTraining, minPilots } = summary.settings;
  const items = [
    { done: Boolean(summary.user.name && summary.user.phone), title: 'Your details', text: summary.user.phone ? `${summary.user.name}, ${summary.user.phone}` : 'Add a mobile number so the team can reach you on the day.', hash: '#profile' },
    { done: docsDone === general.length, title: 'Your documents', text: `${docsDone} of ${general.length} checked${general.some((d) => d.state === 'rejected' || d.state === 'expired') ? ': one needs uploading again' : general.some((d) => d.state === 'uploaded') ? ': waiting for the project manager to check' : ''}.`, hash: '#documents' },
    { done: summary.counts.training >= minTraining, title: 'Training', text: `${summary.counts.training} of ${minTraining} sessions confirmed${summary.waiting?.training ? `, ${summary.waiting.training} waiting for the team` : ''}. Log each one you attend.`, hash: '#training', link: 'Log training' },
    { done: summary.counts.pilots >= minPilots, title: 'Pilots', text: `${summary.counts.pilots} of ${minPilots} confirmed${summary.waiting?.pilots ? `, ${summary.waiting.pilots} waiting for the team` : ''}. Log each one you do.`, hash: '#training', link: 'Log a pilot' },
    { done: summary.availability.length > 0, title: 'Your availability', text: summary.availability.length ? `${summary.availability.filter((a) => a.value !== 'no').length} days marked available ahead.` : 'Mark the days you can help at schools.', hash: '#availability' },
  ];
  return (
    <div className="mpmb-tools__section">
      {(summary.standing || summary.daysAttended > 0) && (
        <p>
          {summary.standing && <span className={`mpmb-portal__badge mpmb-portal__badge--${summary.standing === 'Ready' ? 'ok' : 'todo'}`}>{summary.standing}</span>} {summary.daysAttended > 0 ? `You have helped on ${summary.daysAttended} school day${summary.daysAttended === 1 ? '' : 's'}. Thank you!` : ''}
        </p>
      )}
      {waiting.length > 0 && (
        <Callout tone="important" title={waiting.length === 1 ? 'You have been selected for a visit' : `You have been selected for ${waiting.length} visits`}>
          <p>Please confirm or decline as soon as you can.</p>
          <Button variant="primary" onClick={() => go('#offers')}>
            See the offer{waiting.length === 1 ? '' : 's'}
          </Button>
        </Callout>
      )}
      <section aria-labelledby="checklist">
        <h2 className="mpmb-h2" id="checklist">
          Getting ready for school visits
        </h2>
        <ul className="mpmb-portal__checklist">
          {items.map((i) => (
            <li key={i.title} className={i.done ? 'is-done' : ''}>
              <span className="mpmb-portal__tick" aria-hidden="true">
                {i.done ? <Icon name="check" size={18} /> : null}
              </span>
              <span>
                <strong>{i.title}</strong>
                <span className="mpmb-sr-only">{i.done ? ': done' : ': to do'}</span>
                <br />
                {i.text}{' '}
                <a href={i.hash} onClick={(e) => (e.preventDefault(), go(i.hash))}>
                  {'link' in i && i.link ? i.link : i.done ? 'View' : 'Do this now'}
                </a>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="next-visits">
        <h2 className="mpmb-h2" id="next-visits">
          Your next visits
        </h2>
        {upcoming.length ? <VisitList visits={upcoming} contact={summary.settings.withdrawalContact} /> : <p>None confirmed yet.</p>}
      </section>
    </div>
  );
}

/** Where and when: the place, then each day it runs. */
type Place = Pick<Visit, 'days' | 'location' | 'notes'> & Partial<Pick<Visit, 'travel'>> & { role?: DayRole; timeNotes?: Record<string, string> };

/** Where and when: the place, your job, each of your days (with any note on your times), and how to get there. */
function VisitDetails({ v }: { v: Place }) {
  const on = daysOn(v);
  return (
    <>
      {v.role && (
        <span>
          <strong>Your job: {DAY_ROLE_LABEL[v.role]}</strong>
        </span>
      )}
      <span>Where: {v.location}</span>
      {on.map((d) => {
        const t = v.travel ? travelOn(d, v.travel) : null;
        return (
          <span key={d.date}>
            {longDate(d.date)}, {d.start} to {d.end}
            {v.timeNotes?.[d.date] ? ` (${v.timeNotes[d.date]})` : ''}
            {t && (t.taxiTime || t.arrival) ? <span className="mpmb-hint"> · {[t.taxiTime ? `taxi from ${t.taxiFrom} at ${clock(t.taxiTime)}` : '', t.arrival ? `at the school by ${clock(t.arrival)}` : ''].filter(Boolean).join(', ')}</span> : null}
          </span>
        );
      })}
      {v.travel?.direct && <span className="mpmb-hint">{v.travel.direct}</span>}
      {v.notes && <span className="mpmb-hint">{v.notes}</span>}
    </>
  );
}

/** Confirmed places are not cancelled in the portal: the research assistant emails the project manager, who removes them. */
function WithdrawNote({ v, contact }: { v: Pick<Visit, 'schoolName' | 'days'>; contact: Contact }) {
  const subject = `Withdrawing from ${v.schoolName}, ${visitWhen(v)}`;
  const body = `Hello ${contact.name.replace(/^Dr\s+/, '')},\n\nI need to withdraw from the MyPhone/MyBrain school visit to ${v.schoolName} (${dayLines(v).join('; ')}).\n\nReason: \n\nThank you,\n`;
  return (
    <span className="mpmb-hint mpmb-portal__withdraw">
      To withdraw, email {contact.name} at{' '}
      <a href={`mailto:${contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>{contact.email}</a>. Confirmed places can’t be cancelled here.
    </span>
  );
}

function VisitList({ visits, contact }: { visits: (Omit<Visit, 'status'> & { role?: DayRole; timeNotes?: Record<string, string> })[]; contact: Contact }) {
  return (
    <ul className="mpmb-tools__list">
      {visits.map((v) => (
        <li key={v.visitId} className="mpmb-tools__row mpmb-tools__row--stack">
          <strong>{v.schoolName}</strong>
          <VisitDetails v={v} />
          <WithdrawNote v={v} contact={contact} />
        </li>
      ))}
    </ul>
  );
}

/* ── Documents ────────────────────────────────────────────────────────── */

export function Documents({ summary, reload }: { summary: MySummary; reload: () => Promise<void> }) {
  const general = summary.documents.filter((d) => d.schoolId === null);
  const bySchool = useMemo(() => {
    const m = new Map<string, DocRow[]>();
    for (const d of summary.documents.filter((x) => x.schoolId)) m.set(d.schoolName ?? '', [...(m.get(d.schoolName ?? '') ?? []), d]);
    return [...m.entries()];
  }, [summary.documents]);
  return (
    <div className="mpmb-tools__section">
      <p className="mpmb-lead">Upload a clear photo or scan of each document. The project manager checks it, and only they can open your copies. They are kept while you work on the study.</p>
      <h2 className="mpmb-h2">Everyone needs</h2>
      {general.map((d) => (
        <div key={`${d.typeId}|`}>
          <DocCard doc={d} reload={reload} />
          {d.dbs && (d.state === 'missing' || d.state === 'rejected' || d.state === 'expired') && <DbsApplied summary={summary} reload={reload} />}
        </div>
      ))}
      {bySchool.length > 0 && <p className="mpmb-hint">Some schools ask for their own forms as well. You need these only if you go to that school.</p>}
      {bySchool.map(([name, docs]) => (
        <section key={name}>
          <h2 className="mpmb-h2">Only if you go to {name}</h2>
          {docs.map((d) => (
            <DocCard key={`${d.typeId}|${d.schoolId}`} doc={d} reload={reload} />
          ))}
        </section>
      ))}
    </div>
  );
}

/** "I've applied for my DBS", with the date if they know it: their DBS shows as Processing to the team. */
function DbsApplied({ summary, reload }: { summary: MySummary; reload: () => Promise<void> }) {
  const [applied, setApplied] = useState(summary.dbsApplied === true);
  const [date, setDate] = useState(summary.dbsAppliedOn ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = async (nextApplied: boolean, nextDate: string) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await ask('set-dbs-applied', { applied: nextApplied, date: nextDate });
      setSaved(true);
      await reload();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mpmb-card">
      <label className="mpmb-portal__inline">
        <input
          type="checkbox"
          checked={applied}
          disabled={busy}
          onChange={(e) => {
            setApplied(e.target.checked);
            void save(e.target.checked, e.target.checked ? date : '');
          }}
        />{' '}
        I’ve applied for my DBS and am waiting for the certificate
      </label>
      {applied && (
        <div className="mpmb-actions">
          <TextField id="dbs-applied-on" label="When you applied" required={false} type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} hint="Optional." />
          <Button variant="secondary" loading={busy} onClick={() => void save(true, date)}>
            Save the date
          </Button>
        </div>
      )}
      {summary.dbsStatus && <p className="mpmb-hint">The team sees your DBS as: {DBS_STATUS_LABEL[summary.dbsStatus]}. Upload the certificate when it arrives.</p>}
      {saved && <p role="status">Saved.</p>}
      {error && (
        <p className="mpmb-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function DocCard({ doc, reload }: { doc: DocRow; reload: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const uploadId = await uploadDocument(file, setProgress);
      await ask('register-document', { uploadId, typeId: doc.typeId, schoolId: doc.schoolId, fileName: file.name });
      await reload();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  };
  const open = async () => {
    if (!doc.docId) return;
    try {
      const { url } = await ask<{ url: string }>('document-url', { docId: doc.docId });
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(messageOf(e));
    }
  };
  const needsUpload = doc.state === 'missing' || doc.state === 'rejected' || doc.state === 'expired' || doc.state === 'expiring-soon';
  const id = `doc-${doc.typeId}-${doc.schoolId ?? 'all'}`;
  return (
    <div className="mpmb-card mpmb-portal__doc">
      <div className="mpmb-portal__doc-head">
        <h3 className="mpmb-h3">{doc.label}</h3>
        <StateBadge state={doc.state} />
      </div>
      {doc.hint && <p className="mpmb-hint">{doc.hint}</p>}
      {doc.state === 'rejected' && doc.note && <Callout tone="warning">Not accepted: {doc.note}</Callout>}
      {doc.validUntil && <p>Valid until {longDate(doc.validUntil)}.</p>}
      {doc.details?.certificateNumber && <p>Certificate {doc.details.certificateNumber}, issued {doc.details.issueDate ? longDate(doc.details.issueDate) : ''}{doc.details.updateService ? ', on the Update Service' : ''}.</p>}
      <div className="mpmb-actions">
        <label className={`mpmb-btn mpmb-btn--${needsUpload ? 'primary' : 'secondary'}`} htmlFor={id}>
          <span>{doc.state === 'missing' ? 'Upload' : 'Upload a new one'}</span>
        </label>
        <input ref={input} id={id} type="file" accept={ACCEPT} className="mpmb-sr-only" onChange={(e) => void choose(e.target.files?.[0])} />
        {doc.hasCopy && (
          <Button variant="link" onClick={() => void open()}>
            Open my copy
          </Button>
        )}
      </div>
      {progress !== null && (
        <p className="mpmb-hint" role="status">
          Uploading… {Math.round(progress * 100)}%
        </p>
      )}
      {error && (
        <p className="mpmb-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ── Availability ─────────────────────────────────────────────────────── */

const OPTIONS: (Availability | null)[] = ['all', 'am', 'pm', 'no', null];

function monthDays(year: number, month: number): string[] {
  const days: string[] = [];
  const d = new Date(Date.UTC(year, month, 1));
  while (d.getUTCMonth() === month) {
    days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

export function AvailabilityView({ summary, reload }: { summary: MySummary; reload: () => Promise<void> }) {
  const today = todayIso();
  const [offset, setOffset] = useState(0);
  const base = new Date(`${today}T00:00:00Z`);
  const year = base.getUTCFullYear() + Math.floor((base.getUTCMonth() + offset) / 12);
  const month = (base.getUTCMonth() + offset) % 12;
  const days = monthDays(year, month);
  const saved = useMemo(() => new Map(summary.availability.map((a) => [a.date, a])), [summary.availability]);
  const [edits, setEdits] = useState<Map<string, Availability | null>>(new Map());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setEdits(new Map()), [summary]);
  const valueOf = (date: string) => (edits.has(date) ? edits.get(date)! : (saved.get(date)?.value ?? null));
  const cycle = (date: string) => {
    const now = valueOf(date);
    const next = OPTIONS[(OPTIONS.indexOf(now) + 1) % OPTIONS.length];
    setEdits(new Map(edits).set(date, next));
    setMessage(null);
  };
  const weekdays = (value: Availability) => {
    const next = new Map(edits);
    for (const d of days) {
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (d >= today && dow > 0 && dow < 6) next.set(d, value);
    }
    setEdits(next);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const changed = [...edits.entries()].filter(([d, v]) => (saved.get(d)?.value ?? null) !== v).map(([date, value]) => ({ date, value }));
      if (!changed.length) {
        setMessage('Nothing has changed.');
        return;
      }
      await ask('set-availability', { days: changed });
      await reload();
      setMessage(`Saved ${changed.length} day${changed.length === 1 ? '' : 's'}.`);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const lead = new Date(`${days[0]}T00:00:00Z`).getUTCDay();
  const blanks = (lead + 6) % 7;
  const title = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${days[0]}T00:00:00Z`));
  return (
    <div className="mpmb-tools__section">
      <p className="mpmb-lead">Tap a day to change it: all day, morning, afternoon, not available, or blank. Then save. The team sees this when choosing who to ask.</p>
      <div className="mpmb-tools__bar">
        <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(offset - 1)}>
          Previous month
        </Button>
        <h2 className="mpmb-h2" aria-live="polite">
          {title}
        </h2>
        <Button variant="secondary" disabled={offset >= 5} onClick={() => setOffset(offset + 1)}>
          Next month
        </Button>
      </div>
      <div className="mpmb-actions">
        <Button variant="ghost" onClick={() => weekdays('all')}>
          All weekdays: all day
        </Button>
        <Button variant="ghost" onClick={() => weekdays('no')}>
          All weekdays: not available
        </Button>
      </div>
      <div className="mpmb-portal__calendar" role="grid" aria-label={title}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <span key={d} className="mpmb-portal__dow" aria-hidden="true">
            {d}
          </span>
        ))}
        {Array.from({ length: blanks }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {days.map((d) => {
          const v = valueOf(d);
          const past = d < today;
          return (
            <button key={d} type="button" className={`mpmb-portal__day mpmb-portal__day--${v ?? 'none'}${edits.has(d) ? ' is-edited' : ''}`} disabled={past} onClick={() => cycle(d)} aria-label={`${longDate(d)}: ${v ? AVAILABILITY_LABEL[v] : 'not set'}`}>
              <span className="mpmb-portal__daynum">{Number(d.slice(8))}</span>
              <span className="mpmb-portal__dayval">{v ? AVAILABILITY_LABEL[v] : past ? '' : '–'}</span>
            </button>
          );
        })}
      </div>
      <div className="mpmb-actions">
        <Button variant="primary" loading={busy} onClick={() => void save()}>
          Save my availability
        </Button>
      </div>
      {message && (
        <p role="status" className="mpmb-hint">
          {message}
        </p>
      )}
      {error && (
        <p className="mpmb-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ── Offers and visits ────────────────────────────────────────────────── */

export function Offers({ summary, reload }: { summary: MySummary; reload: () => Promise<void> }) {
  const offers = summary.assignments.filter((a) => a.status === 'offered');
  const [open, setOpen] = useState<OpenVisit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const loadOpen = async () => setOpen((await ask<{ visits: OpenVisit[] }>('open-visits')).visits);
  useEffect(() => {
    void loadOpen().catch((e) => setError(messageOf(e)));
  }, []);
  const answer = async (visitId: string, response: 'confirm' | 'decline') => {
    setBusy(`${visitId}-${response}`);
    setError(null);
    try {
      await ask('respond-offer', { visitId, response, note: notes[visitId] ?? '' });
      await reload();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  };
  const interest = async (visitId: string, interested: boolean) => {
    try {
      await ask('set-interest', { visitId, interested });
      await loadOpen();
    } catch (e) {
      setError(messageOf(e));
    }
  };
  const mine = new Set(summary.assignments.map((a) => a.visitId));
  const provisional = (open ?? []).filter((v) => v.status === 'provisional');
  return (
    <div className="mpmb-tools__section">
      {provisional.length > 0 && (
        <section aria-labelledby="possible-h">
          <h2 className="mpmb-h2" id="possible-h">
            Possible dates: could you do them?
          </h2>
          <p className="mpmb-hint">These dates are not yet confirmed with the school. Tell us, day by day, whether you could do them. Your answers also count as your availability for those days.</p>
          {provisional.map((v) => (
            <ProvisionalCard key={v.visitId} v={v} onSaved={loadOpen} onError={setError} />
          ))}
        </section>
      )}
      {error && (
        <Callout tone="warning" role="alert">
          {error}
        </Callout>
      )}
      <section aria-labelledby="offers-h">
        <h2 className="mpmb-h2" id="offers-h">
          Waiting for your answer
        </h2>
        {!offers.length && <p>No offers waiting.</p>}
        {offers.map((v) => (
          <div key={v.visitId} className="mpmb-card mpmb-portal__offer">
            <h3 className="mpmb-h3">{v.schoolName}</h3>
            <p className="mpmb-tools__row--stack mpmb-portal__details">
              <VisitDetails v={v} />
            </p>
            {daysOn(v).length > 1 && <p className="mpmb-hint">Confirming books you for every day listed.</p>}
            <label className="mpmb-label" htmlFor={`note-${v.visitId}`}>
              A note for the team <span className="mpmb-label__tag">(optional)</span>
            </label>
            <input id={`note-${v.visitId}`} className="mpmb-input" value={notes[v.visitId] ?? ''} onChange={(e) => setNotes({ ...notes, [v.visitId]: e.target.value })} />
            <div className="mpmb-actions">
              <Button variant="primary" loading={busy === `${v.visitId}-confirm`} onClick={() => void answer(v.visitId, 'confirm')}>
                Confirm I can do it
              </Button>
              <Button variant="secondary" loading={busy === `${v.visitId}-decline`} onClick={() => void answer(v.visitId, 'decline')}>
                I can’t do it
              </Button>
            </div>
          </div>
        ))}
      </section>
      <section aria-labelledby="open-h">
        <h2 className="mpmb-h2" id="open-h">
          Coming up
        </h2>
        <p className="mpmb-hint">Let the team know which visits you would like. They choose from people who are available and ready.</p>
        {open === null ? (
          <p>Loading…</p>
        ) : !open.filter((v) => !mine.has(v.visitId) && v.status !== 'provisional').length ? (
          <p>Nothing else coming up yet.</p>
        ) : (
          <ul className="mpmb-tools__list">
            {open
              .filter((v) => !mine.has(v.visitId) && v.status !== 'provisional')
              .map((v) => (
                <li key={v.visitId} className="mpmb-tools__row">
                  <span>
                    <strong>{v.schoolName}</strong>
                    <br />
                    {visitWhen(v)} · {v.location}
                  </span>
                  <Button variant={v.interested ? 'secondary' : 'ghost'} onClick={() => void interest(v.visitId, !v.interested)} aria-pressed={v.interested}>
                    {v.interested ? 'Interested (tap to undo)' : 'I’m interested'}
                  </Button>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type OpenVisit = Visit & { interested: boolean; myAnswers: Record<string, CanvassAnswer> };

/** One provisional visit: clearly marked as not confirmed, with can do / maybe / can't do for each day. */
function ProvisionalCard({ v, onSaved, onError }: { v: OpenVisit; onSaved: () => Promise<void>; onError: (e: string | null) => void }) {
  const [answers, setAnswers] = useState<Record<string, CanvassAnswer>>(v.myAnswers);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const days = daysOn(v);
  const save = async () => {
    setBusy(true);
    onError(null);
    try {
      await ask('canvass-answer', { visitId: v.visitId, answers });
      setSaved(true);
      await onSaved();
    } catch (e) {
      onError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mpmb-card mpmb-portal__offer mpmb-portal__provisional">
      <p className="mpmb-portal__badge mpmb-portal__badge--wait">Provisional — not confirmed</p>
      <h3 className="mpmb-h3">{v.schoolName}</h3>
      <p>Where: {v.location}</p>
      <ul className="mpmb-tools__list">
        {days.map((d) => (
          <li key={d.date} className="mpmb-tools__row mpmb-portal__answer">
            <span>
              <strong>{longDate(d.date)}</strong>
              <br />
              <span className="mpmb-hint">
                {d.start} to {d.end}
              </span>
            </span>
            <span className="mpmb-portal__choices" role="radiogroup" aria-label={`${longDate(d.date)}: could you do it?`}>
              {(['yes', 'maybe', 'no'] as CanvassAnswer[]).map((a) => (
                <button key={a} type="button" role="radio" aria-checked={answers[d.date] === a} className={`mpmb-portal__choice mpmb-portal__choice--${a}${answers[d.date] === a ? ' is-on' : ''}`} onClick={() => (setAnswers({ ...answers, [d.date]: a }), setSaved(false))}>
                  {CANVASS_LABEL[a]}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <div className="mpmb-actions">
        <Button variant="primary" loading={busy} disabled={!Object.keys(answers).length} onClick={() => void save()}>
          Send my answers
        </Button>
        {saved && <span role="status">Thank you: sent.</span>}
      </div>
    </div>
  );
}

export function MyVisits({ summary }: { summary: MySummary }) {
  const rows = summary.assignments.filter((a) => a.status !== 'offered');
  return (
    <div className="mpmb-tools__section">
      {!rows.length && <p>No visits yet.</p>}
      <ul className="mpmb-tools__list">
        {rows.map((v) => (
          <li key={v.visitId} className="mpmb-tools__row mpmb-tools__row--stack">
            <strong>{v.schoolName}</strong>
            <VisitDetails v={v} />
            <span className="mpmb-hint">
              {ASSIGNMENT_LABEL[v.status]}
              {v.status === 'removed' && v.removedReason ? `: ${v.removedReason}` : ''}
              {v.status === 'confirmed' && v.removedReason ? ` (some of your days were taken off: ${v.removedReason})` : ''}
            </span>
            {v.status === 'confirmed' && <WithdrawNote v={v} contact={summary.settings.withdrawalContact} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

const CLAIM_LABEL: Record<TrainingClaim['status'], string> = { waiting: 'Waiting for the team', confirmed: 'Confirmed', declined: 'Not confirmed' };

/** Training and pilots: what counts, and logging the ones attended for the team to confirm (4 November 2026). */
export function Training({ summary, reload }: { summary: MySummary; reload: () => Promise<void> }) {
  const [data, setData] = useState<{ sessions: { id: string; kind: 'training' | 'pilot'; date: string; title: string; role: DayRole | null }[]; claims: TrainingClaim[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const blank = { kind: 'training' as 'training' | 'pilot', date: '', title: '', role: '' as DayRole | '', ranBy: '', notes: '' };
  const [form, setForm] = useState(blank);
  const load = async () => {
    try {
      setData(await ask('my-training'));
    } catch (e) {
      setError(messageOf(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const act = async (key: string, fn: () => Promise<unknown>, message: string) => {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(message);
      await Promise.all([load(), reload()]);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  };
  const w = summary.waiting ?? { training: 0, pilots: 0 };
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  return (
    <div className="mpmb-tools__section">
      <p className="mpmb-lead">
        Confirmed: {plural(summary.counts.training, 'training session')} (of {summary.settings.minTraining} needed) and {plural(summary.counts.pilots, 'pilot')} (of {summary.settings.minPilots}).
        {w.training + w.pilots > 0 ? ` Waiting for the team to confirm: ${[w.training ? plural(w.training, 'training session') : '', w.pilots ? plural(w.pilots, 'pilot') : ''].filter(Boolean).join(' and ')}.` : ''}
      </p>
      <p className="mpmb-hint">Log each training session and pilot you attend. The team checks it, and it counts towards school visits once they confirm it.</p>
      {done && (
        <Callout tone="success" role="status">
          {done}
        </Callout>
      )}
      {error && (
        <Callout tone="warning" role="alert">
          {error}
        </Callout>
      )}
      {data && data.sessions.length > 0 && (
        <section className="mpmb-card">
          <h2 className="mpmb-h2">Sessions the team recorded</h2>
          <p className="mpmb-hint">Were you at one of these? Say so and the team will confirm it.</p>
          <ul className="mpmb-tools__list">
            {data.sessions.map((s) => (
              <li key={s.id} className="mpmb-tools__row">
                <span>
                  <strong>{s.title}</strong>
                  <br />
                  {s.kind === 'pilot' ? 'Pilot' : 'Training'}
                  {s.role ? ` (${DAY_ROLE_LABEL[s.role]})` : ''} · {longDate(s.date)}
                </span>
                <Button variant="secondary" loading={busy === s.id} onClick={() => void act(s.id, () => ask('claim-session', { sessionId: s.id }), `Logged: ${s.title}. The team will confirm it.`)}>
                  I was there
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form
        className="mpmb-card"
        onSubmit={(e) => {
          e.preventDefault();
          void act('new', () => ask('claim-session', { ...form, role: form.role || null }), 'Logged. The team will confirm it.').then(() => setForm(blank));
        }}
      >
        <h2 className="mpmb-h2">Add a session you attended</h2>
        <p className="mpmb-hint">For one that is not in the list above.</p>
        <div className="mpmb-tools__grid">
          <SelectField id="claim-kind" label="What kind" options={[{ value: 'training', label: 'Training' }, { value: 'pilot', label: 'Pilot' }]} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'training' | 'pilot', role: e.target.value === 'pilot' ? '' : form.role })} />
          <TextField id="claim-date" label="Date" type="date" max={todayIso()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <TextField id="claim-title" label="What it was" placeholder={form.kind === 'pilot' ? 'Pilot at GSAL' : 'EEG set-up training'} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          {form.kind === 'training' && <SelectField id="claim-role" label="Training for" required={false} placeholder="General, or both jobs" options={[{ value: 'eeg', label: DAY_ROLE_LABEL.eeg }, { value: 'copro', label: DAY_ROLE_LABEL.copro }]} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as DayRole | '' })} />}
          <TextField id="claim-ranby" label="Who ran it" required={false} value={form.ranBy} onChange={(e) => setForm({ ...form, ranBy: e.target.value })} />
        </div>
        <TextField id="claim-notes" label="Anything else" required={false} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <div className="mpmb-actions">
          <Button type="submit" variant="primary" loading={busy === 'new'}>
            Log it
          </Button>
        </div>
      </form>
      <section>
        <h2 className="mpmb-h2">What you logged</h2>
        {!data ? (
          <p>Loading…</p>
        ) : !data.claims.length ? (
          <p className="mpmb-hint">Nothing yet.</p>
        ) : (
          <ul className="mpmb-tools__list">
            {data.claims.map((c) => (
              <li key={c.id} className="mpmb-tools__row">
                <span>
                  <strong>{c.title}</strong>
                  <br />
                  {c.kind === 'pilot' ? 'Pilot' : 'Training'} · {longDate(c.date)} · <span className={`mpmb-portal__claim mpmb-portal__claim--${c.status}`}>{CLAIM_LABEL[c.status]}</span>
                  {c.status === 'declined' && c.reason ? (
                    <>
                      <br />
                      <span className="mpmb-hint">Why: {c.reason}</span>
                    </>
                  ) : null}
                </span>
                {c.status === 'waiting' && (
                  <Button variant="ghost" loading={busy === c.id} onClick={() => window.confirm('Delete this entry?') && void act(c.id, () => ask('delete-claim', { id: c.id }), 'Deleted.')}>
                    Delete
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mpmb-h2">Confirmed sessions</h2>
        {!summary.sessions.length ? (
          <p className="mpmb-hint">None yet.</p>
        ) : (
          <ul className="mpmb-tools__list">
            {summary.sessions
              .slice()
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((s) => (
                <li key={s.id} className="mpmb-tools__row">
                  <span>
                    <strong>{s.title}</strong>
                    <br />
                    {longDate(s.date)}
                  </span>
                  <span className="mpmb-hint">{s.kind === 'pilot' ? 'Pilot' : 'Training'}</span>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}
