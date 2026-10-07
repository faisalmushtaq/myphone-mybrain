import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { SelectField, TextField } from '../../components/ui/Field';
import { labBooking } from '../../lab/booking';
import { addDays, atUkTime, byDay, ukDateWords, ukHours, ukIsoDay } from '../../lab/calendar';
import { messageOf, type StaffSlot } from '../api';
import type { Staff } from '../StaffApp';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const today = () => ukIsoDay(new Date().toISOString());

/** The start times typed as "10:00, 14:00" (or "10, 2pm"), as [hour, minute] pairs; null when one cannot be read. */
export function readTimes(text: string): [number, number][] | null {
  const parts = text
    .split(/[,;\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const out: [number, number][] = [];
  for (const t of parts) {
    const m = t.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    if (m[3] === 'pm' && h < 12) h += 12;
    if (m[3] === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    out.push([h, min]);
  }
  return out.length ? out : null;
}

/** Every start the form describes: each chosen weekday from the first date to the last, at each time, in UK time. */
export function startsFor(from: string, to: string, days: boolean[], times: [number, number][]): Date[] {
  const out: Date[] = [];
  for (let d = from, n = 0; d <= to && n < 400; d = addDays(d, 1), n += 1) {
    const weekday = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
    if (!days[weekday]) continue;
    for (const [h, m] of times) out.push(atUkTime(d, h, m));
  }
  return out;
}

/** Adding lab times (one or a pattern of many), and opening, closing or removing them. */
export function Times({ staff }: { staff: Staff }) {
  const [from, setFrom] = useState(addDays(today(), 7));
  const [to, setTo] = useState('');
  const [days, setDays] = useState([true, true, true, true, true, false, false]);
  const [timesText, setTimesText] = useState('10:00, 14:00');
  const [minutes, setMinutes] = useState(String(labBooking.minutes));
  const [capacity, setCapacity] = useState('1');
  const [visit, setVisit] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'important'; text: string } | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [testMobile, setTestMobile] = useState('');

  const times = readTimes(timesText);
  const starts = useMemo(() => (times && from ? startsFor(from, to || from, days, times).filter((d) => d.getTime() > Date.now()) : []), [times, from, to, days]);
  const slots = (staff.overview?.slots ?? []).filter((s) => new Date(s.end).getTime() > Date.now() - 86_400_000);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setMessage(null);
    try {
      const text = await fn();
      await staff.reload();
      setMessage({ tone: 'success', text });
    } catch (e) {
      setMessage({ tone: 'important', text: messageOf(e) });
    } finally {
      setBusy(null);
    }
  };

  const add = () =>
    run('add', async () => {
      if (!times) throw new Error('Type the start times like 10:00, 14:00.');
      if (!starts.length) throw new Error('Those dates and days give no times in the future.');
      const r = await staff.ask<{ created: number; skipped: number }>('add-slots', { slots: starts.map((d) => ({ start: d.toISOString(), minutes: Number(minutes), capacity: Number(capacity), visit: visit === '1' ? 1 : visit === '2' ? 2 : null, location: location.trim() || null })) });
      return `Added ${r.created} time${r.created === 1 ? '' : 's'}${r.skipped ? `; ${r.skipped} already existed` : ''}.`;
    });

  const update = (s: StaffSlot, patch: Record<string, unknown>, label: string) => run(s.slotId, async () => (await staff.ask('update-slot', { slotId: s.slotId, ...patch }), label));
  const remove = (s: StaffSlot) => run(s.slotId, async () => (await staff.ask('delete-slot', { slotId: s.slotId }), 'Time removed.'));

  const test = () =>
    run('test', async () => {
      const r = await staff.ask<{ email: string | null; sms: string | null }>('test-message', { email: testEmail, mobile: testMobile });
      return [r.email ? `Email: ${r.email}.` : '', r.sms ? `Text: ${r.sms}.` : ''].filter(Boolean).join(' ');
    });

  return (
    <div className="mpmb-tools__section">
      {message && (
        <Callout tone={message.tone} role={message.tone === 'important' ? 'alert' : 'status'}>
          <p>{message.text}</p>
        </Callout>
      )}
      <section className="mpmb-card" aria-labelledby="times-add">
        <h2 className="mpmb-h3" id="times-add">
          Add lab times
        </h2>
        <p className="mpmb-hint">Participants see open times from {labBooking.minNoticeHours} hours ahead. All times are UK times.</p>
        <div className="mpmb-tools__grid">
          <TextField id="times-from" label="First date" type="date" value={from} min={today()} onChange={(e) => setFrom(e.target.value)} />
          <TextField id="times-to" label="Last date" required={false} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} hint="Leave empty for one day." />
          <TextField id="times-times" label="Start times" value={timesText} onChange={(e) => setTimesText(e.target.value)} hint="For example 10:00, 14:00" error={times ? undefined : 'Type the start times like 10:00, 14:00.'} />
          <TextField id="times-minutes" label="Length (minutes)" type="number" min={15} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          <TextField id="times-capacity" label="Places" type="number" min={1} max={20} value={capacity} onChange={(e) => setCapacity(e.target.value)} hint="People at once." />
          <SelectField id="times-visit" label="For" value={visit} onChange={(e) => setVisit(e.target.value)} placeholder="Either visit" options={[{ value: '1', label: 'First visits only' }, { value: '2', label: 'Second visits only' }]} />
        </div>
        <fieldset className="mpmb-tools__days">
          <legend className="mpmb-label">On these days</legend>
          {WEEKDAYS.map((d, i) => (
            <label key={d} className="mpmb-notsure">
              <input type="checkbox" checked={days[i]} onChange={(e) => setDays(days.map((x, j) => (j === i ? e.target.checked : x)))} /> {d}
            </label>
          ))}
        </fieldset>
        <TextField id="times-location" label="Place" required={false} value={location} onChange={(e) => setLocation(e.target.value)} hint={`Leave empty for the usual place (${labBooking.location.name}).`} />
        <div className="mpmb-actions">
          <Button variant="primary" loading={busy === 'add'} onClick={() => void add()} disabled={!starts.length}>
            {starts.length ? `Add ${starts.length} time${starts.length === 1 ? '' : 's'}` : 'Add times'}
          </Button>
        </div>
      </section>

      <section aria-labelledby="times-list">
        <h2 className="mpmb-h2" id="times-list">
          Times from today
        </h2>
        {!slots.length && <p className="mpmb-hint">No times yet. Add some above; participants can book as soon as they are added.</p>}
        {byDay(slots).map(({ day, slots: list }) => (
          <div key={day} className="mpmb-tools__day">
            <h3 className="mpmb-h3">{ukDateWords(day)}</h3>
            <ul className="mpmb-tools__list" role="list">
              {list.map((s) => (
                <li key={s.slotId} className={`mpmb-tools__row${s.status === 'closed' ? ' is-closed' : ''}`}>
                  <span className="mpmb-tools__main">
                    <strong>{ukHours(s.start, s.end)}</strong> · {s.visit ? `visit ${s.visit} only` : 'either visit'} · {s.booked} of {s.capacity} booked{s.status === 'closed' ? ' · closed' : ''}
                    {s.location ? ` · ${s.location}` : ''}
                  </span>
                  <span className="mpmb-tools__actions">
                    {s.status === 'open' ? (
                      <Button variant="link" disabled={busy === s.slotId} onClick={() => void update(s, { status: 'closed' }, 'Time closed: nobody new can book it.')}>
                        Close
                      </Button>
                    ) : (
                      <Button variant="link" disabled={busy === s.slotId} onClick={() => void update(s, { status: 'open' }, 'Time open again.')}>
                        Reopen
                      </Button>
                    )}
                    {s.booked === 0 && (
                      <Button variant="link" disabled={busy === s.slotId} onClick={() => void remove(s)}>
                        Remove
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="mpmb-card mpmb-card--mist" aria-labelledby="times-test">
        <h2 className="mpmb-h3" id="times-test">
          Check emails and texts arrive
        </h2>
        <p className="mpmb-hint">Sends one test email and one test text, as participants will get them.</p>
        <div className="mpmb-tools__grid">
          <TextField id="test-email" label="Email" required={false} type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
          <TextField id="test-mobile" label="UK mobile" required={false} type="tel" value={testMobile} onChange={(e) => setTestMobile(e.target.value)} />
        </div>
        <Button variant="secondary" loading={busy === 'test'} onClick={() => void test()} disabled={!testEmail.trim() && !testMobile.trim()}>
          Send a test
        </Button>
      </section>
    </div>
  );
}
