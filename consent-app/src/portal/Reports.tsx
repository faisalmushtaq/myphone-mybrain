import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { SelectField, TextField } from '../components/ui/Field';
import { TeamEmail } from './EmailViews';
import { Loading, useLoad } from './TeamViews';
import { saveFile, shortDate, todayIso } from './types';

interface PersonRow {
  uid: string;
  name: string;
  offeredDays: number;
  confirmedDays: number;
  attended: number;
  absent: number;
  late: number;
  leftEarly: number;
  hours: number;
  eegDays: number;
  coproDays: number;
}

interface DayRow {
  visitId: string;
  schoolName: string;
  date: string;
  start: string;
  end: string;
  eegNeed: number;
  coproNeed: number;
  eegConfirmed: number;
  coproConfirmed: number;
  attended: string[];
  absent: string[];
  notMarked: string[];
}

interface Report {
  from: string;
  to: string;
  people: PersonRow[];
  days: DayRow[];
  totals: { visits: number; days: number; offeredDays: number; confirmedDays: number; attended: number; absent: number; hours: number; notMarked: number };
  schools: { id: string; name: string }[];
  everyone: { uid: string; name: string }[];
}

/** A table as CSV, for spreadsheets. */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

const monthsBack = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
};

/**
 * Who was offered, confirmed and turned up, between two dates, for a school or
 * a person if chosen: per person and per visit day, with CSV downloads.
 */
export function Reports() {
  const today = todayIso();
  const [filters, setFilters] = useState({ from: monthsBack(today, 3), to: today, schoolId: '', uid: '' });
  const [applied, setApplied] = useState(filters);
  const { value, error } = useLoad<Report>('report', applied);
  const stamp = `${applied.from}-to-${applied.to}`;
  const peopleCsv = () =>
    value &&
    saveFile(
      `attendance-by-person-${stamp}.csv`,
      toCsv(
        ['Name', 'Days offered', 'Days confirmed', 'Days attended', 'Absent', 'Late', 'Left early', 'Hours', 'EEG days', 'Co-production days'],
        value.people.map((p) => [p.name, p.offeredDays, p.confirmedDays, p.attended, p.absent, p.late, p.leftEarly, p.hours, p.eegDays, p.coproDays]),
      ),
      'text/csv;charset=utf-8',
    );
  const daysCsv = () =>
    value &&
    saveFile(
      `attendance-by-day-${stamp}.csv`,
      toCsv(
        ['Date', 'School', 'Times', 'EEG confirmed', 'EEG needed', 'Co-production confirmed', 'Co-production needed', 'Attended', 'Absent', 'Not marked'],
        value.days.map((d) => [d.date, d.schoolName, `${d.start}-${d.end}`, d.eegConfirmed, d.eegNeed, d.coproConfirmed, d.coproNeed, d.attended.join('; '), d.absent.join('; '), d.notMarked.join('; ')]),
      ),
      'text/csv;charset=utf-8',
    );
  return (
    <div className="mpmb-tools__section">
      <form
        className="mpmb-card"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(filters);
        }}
      >
        <div className="mpmb-tools__grid">
          <TextField id="r-from" label="From" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          <TextField id="r-to" label="To" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          <SelectField id="r-school" label="School" placeholder="Every school" options={(value?.schools ?? []).map((s) => ({ value: s.id, label: s.name }))} value={filters.schoolId} onChange={(e) => setFilters({ ...filters, schoolId: e.target.value })} />
          <SelectField id="r-person" label="Person" placeholder="Everyone" options={(value?.everyone ?? []).map((p) => ({ value: p.uid, label: p.name }))} value={filters.uid} onChange={(e) => setFilters({ ...filters, uid: e.target.value })} />
        </div>
        <Button type="submit" variant="primary">
          Show
        </Button>
      </form>
      <Loading error={error}>
        {!value ? (
          <p>Loading…</p>
        ) : (
          <>
            <div className="mpmb-portal__stats">
              <div className="mpmb-portal__stat">
                <span className="mpmb-portal__statn">{value.totals.days}</span> visit days
              </div>
              <div className="mpmb-portal__stat">
                <span className="mpmb-portal__statn">{value.totals.attended}</span> person-days attended
              </div>
              <div className="mpmb-portal__stat">
                <span className="mpmb-portal__statn">{value.totals.absent}</span> absent
              </div>
              <div className="mpmb-portal__stat">
                <span className="mpmb-portal__statn">{value.totals.hours}</span> hours
              </div>
              <div className="mpmb-portal__stat">
                <span className="mpmb-portal__statn">{value.totals.notMarked}</span> not marked
              </div>
            </div>
            <section aria-labelledby="rp-h">
              <h2 className="mpmb-h2" id="rp-h">
                By person
              </h2>
              <div className="mpmb-portal__tablewrap">
                <table className="mpmb-portal__table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Offered</th>
                      <th scope="col">Confirmed</th>
                      <th scope="col">Attended</th>
                      <th scope="col">Absent</th>
                      <th scope="col">Hours</th>
                      <th scope="col">Jobs (days)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {value.people.map((p) => (
                      <tr key={p.uid}>
                        <th scope="row">{p.name}</th>
                        <td>{p.offeredDays}</td>
                        <td>{p.confirmedDays}</td>
                        <td>
                          {p.attended}
                          {p.late || p.leftEarly ? <span className="mpmb-hint"> ({[p.late ? `${p.late} late` : '', p.leftEarly ? `${p.leftEarly} left early` : ''].filter(Boolean).join(', ')})</span> : null}
                        </td>
                        <td>{p.absent}</td>
                        <td>{p.hours}</td>
                        <td className="mpmb-hint">
                          EEG {p.eegDays} · Co-production {p.coproDays}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button variant="secondary" disabled={!value.people.length} onClick={peopleCsv}>
                Download (CSV)
              </Button>
            </section>
            <section aria-labelledby="rd-h">
              <h2 className="mpmb-h2" id="rd-h">
                By visit day
              </h2>
              <div className="mpmb-portal__tablewrap">
                <table className="mpmb-portal__table">
                  <thead>
                    <tr>
                      <th scope="col">Day</th>
                      <th scope="col">Cover (EEG, co-production)</th>
                      <th scope="col">Attended</th>
                      <th scope="col">Absent or not marked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {value.days.map((d) => (
                      <tr key={`${d.visitId}-${d.date}`}>
                        <th scope="row">
                          {shortDate(d.date)}
                          <br />
                          <span className="mpmb-hint">{d.schoolName}</span>
                        </th>
                        <td>
                          {d.eegConfirmed}/{d.eegNeed}, {d.coproConfirmed}/{d.coproNeed}
                        </td>
                        <td className="mpmb-hint">{d.attended.join(', ') || '—'}</td>
                        <td className="mpmb-hint">
                          {d.absent.length ? `Absent: ${d.absent.join(', ')}` : ''}
                          {d.absent.length && d.notMarked.length ? '; ' : ''}
                          {d.notMarked.length ? `Not marked: ${d.notMarked.join(', ')}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button variant="secondary" disabled={!value.days.length} onClick={daysCsv}>
                Download (CSV)
              </Button>
            </section>
          </>
        )}
      </Loading>
    </div>
  );
}

/** The team's allocations email for every visit day at one school between two dates. */
export function TeamEmailRange({ schools }: { schools: { id: string; name: string }[] }) {
  const today = todayIso();
  const [form, setForm] = useState({ schoolId: '', from: today, to: today });
  const [open, setOpen] = useState<typeof form | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <section aria-labelledby="rt-h">
      <h2 className="mpmb-h2" id="rt-h">
        Email the team about a school’s dates
      </h2>
      <p className="mpmb-hint">The allocations email for every visit day at one school between two dates.</p>
      <div className="mpmb-tools__grid">
        <SelectField id="rt-school" label="School" placeholder="Choose" options={schools.map((s) => ({ value: s.id, label: s.name }))} value={form.schoolId} onChange={(e) => setForm({ ...form, schoolId: e.target.value })} />
        <TextField id="rt-from" label="First date" type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value, to: form.to < e.target.value ? e.target.value : form.to })} />
        <TextField id="rt-to" label="Last date" type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
      </div>
      <Button variant="secondary" disabled={!form.schoolId} onClick={() => (setMessage(null), setOpen({ ...form }))}>
        Email the team
      </Button>
      {message && <p role="status">{message}</p>}
      {open && (
        <TeamEmail
          key={JSON.stringify(open)}
          target={open}
          update={false}
          close={() => setOpen(null)}
          onSent={(m) => {
            setOpen(null);
            setMessage(m);
          }}
        />
      )}
    </section>
  );
}
