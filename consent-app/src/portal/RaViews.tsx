import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { ACCEPT, ask, messageOf, uploadDocument } from './api';
import { ASSIGNMENT_LABEL, AVAILABILITY_LABEL, dayLines, daysOn, DOC_STATE_LABEL, longDate, todayIso, visitWhen, type Availability, type Contact, type DocRow, type MySummary, type Visit } from './types';

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
    { done: summary.counts.training >= minTraining, title: 'Training', text: `${summary.counts.training} of ${minTraining} sessions. The team records these after each one.`, hash: '#training', link: 'See your sessions' },
    { done: summary.counts.pilots >= minPilots, title: 'Pilots', text: `${summary.counts.pilots} of ${minPilots}. The team records these after each one.`, hash: '#training', link: 'See your sessions' },
    { done: summary.availability.length > 0, title: 'Your availability', text: summary.availability.length ? `${summary.availability.filter((a) => a.value !== 'no').length} days marked available ahead.` : 'Mark the days you can help at schools.', hash: '#availability' },
  ];
  return (
    <div className="mpmb-tools__section">
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
                {i.done ? '✓' : ''}
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
function VisitDetails({ v }: { v: Pick<Visit, 'days' | 'location' | 'notes'> }) {
  return (
    <>
      <span>Where: {v.location}</span>
      {dayLines(v).map((l) => (
        <span key={l}>{l}</span>
      ))}
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

function VisitList({ visits, contact }: { visits: Omit<Visit, 'status'>[]; contact: Contact }) {
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
        <DocCard key={`${d.typeId}|`} doc={d} reload={reload} />
      ))}
      {bySchool.map(([name, docs]) => (
        <section key={name}>
          <h2 className="mpmb-h2">{name} also asks for</h2>
          {docs.map((d) => (
            <DocCard key={`${d.typeId}|${d.schoolId}`} doc={d} reload={reload} />
          ))}
        </section>
      ))}
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
  const [open, setOpen] = useState<(Visit & { interested: boolean })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const loadOpen = async () => setOpen((await ask<{ visits: (Visit & { interested: boolean })[] }>('open-visits')).visits);
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
  return (
    <div className="mpmb-tools__section">
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
        ) : !open.filter((v) => !mine.has(v.visitId)).length ? (
          <p>Nothing else coming up yet.</p>
        ) : (
          <ul className="mpmb-tools__list">
            {open
              .filter((v) => !mine.has(v.visitId))
              .map((v) => (
                <li key={v.visitId} className="mpmb-tools__row">
                  <span>
                    <strong>{v.schoolName}</strong>
                    <br />
                    {visitWhen(v)} · {v.location}
                  </span>
                  <Button variant={v.interested ? 'secondary' : 'ghost'} onClick={() => void interest(v.visitId, !v.interested)} aria-pressed={v.interested}>
                    {v.interested ? 'Interested ✓' : 'I’m interested'}
                  </Button>
                </li>
              ))}
          </ul>
        )}
      </section>
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
            </span>
            {v.status === 'confirmed' && <WithdrawNote v={v} contact={summary.settings.withdrawalContact} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Training({ summary }: { summary: MySummary }) {
  return (
    <div className="mpmb-tools__section">
      <p className="mpmb-lead">
        You have done {summary.counts.training} training session{summary.counts.training === 1 ? '' : 's'} (of {summary.settings.minTraining} needed) and {summary.counts.pilots} pilot{summary.counts.pilots === 1 ? '' : 's'} (of {summary.settings.minPilots}). The team records these after each session.
      </p>
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
    </div>
  );
}
