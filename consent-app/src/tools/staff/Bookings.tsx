import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { SelectField, TextField } from '../../components/ui/Field';
import { ukHours } from '../../lab/calendar';
import { messageOf, when, type StaffBooking } from '../api';
import type { Staff } from '../StaffApp';

const OUTCOME: Record<string, string> = { sent: 'sent', 'not-configured': 'not set up', failed: 'failed', 'no-contact': 'no address', 'not-wanted': 'not wanted', 'invalid-number': 'bad number', paused: 'paused', 'not-asked': 'not sent' };
const outcome = (v: string | undefined) => (v ? (OUTCOME[v] ?? v.replace(/^skip-/, 'skipped: ')) : 'n/a');

function reminderLine(b: StaffBooking): string {
  const r = b.reminders ?? {};
  const keys = Object.keys(r).sort();
  return keys.length ? keys.map((k) => `${k.replace(/-(email|sms)$/, (_, c) => (c === 'sms' ? ' text' : ' email'))}: ${outcome(r[k].outcome ?? r[k].skipped ?? (r[k].claimedAt ? 'sending' : undefined))}`).join(' · ') : 'none yet';
}

/** The lab bookings: who is coming when, what was sent to them, and the team's own actions. */
export function Bookings({ staff }: { staff: Staff }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'important'; text: string } | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [form, setForm] = useState({ code: '', slotId: '', visit: '1', email: '', mobile: '' });
  const [formNotify, setFormNotify] = useState(true);

  const now = Date.now();
  const bookings = (staff.overview?.bookings ?? []).filter((b) => showCancelled || b.status !== 'cancelled');
  const open = (staff.overview?.slots ?? []).filter((s) => s.status === 'open' && s.booked < s.capacity && new Date(s.start).getTime() > now);

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

  const mark = (b: StaffBooking, status: string) => run(b.bookingId, async () => (await staff.ask('mark-booking', { bookingId: b.bookingId, status }), `Marked ${status}.`));
  const resend = (b: StaffBooking) =>
    run(b.bookingId, async () => {
      const r = await staff.ask<{ email: string; sms: string }>('resend', { bookingId: b.bookingId });
      return `Confirmation sent again: email ${outcome(r.email)}, text ${outcome(r.sms)}.`;
    });
  const cancel = (b: StaffBooking) =>
    run(b.bookingId, async () => {
      const r = await staff.ask<{ email: string }>('cancel-booking', { bookingId: b.bookingId, notify, reason });
      setCancelling(null);
      setReason('');
      return `Cancelled${notify ? `; the participant was emailed (${outcome(r.email)})` : ', without telling the participant'}.`;
    });
  const bookFor = () =>
    run('book-for', async () => {
      const r = await staff.ask<{ kind: 'booked' | 'moved'; email: string; sms: string }>('book-for', { participantCode: form.code.trim().toUpperCase(), slotId: form.slotId, visit: Number(form.visit), email: form.email.trim() || null, mobile: form.mobile.trim() || null, notify: formNotify });
      setForm({ code: '', slotId: '', visit: '1', email: '', mobile: '' });
      return `${r.kind === 'moved' ? 'Moved to the new time' : 'Booked'}. Confirmation email ${outcome(r.email)}, text ${outcome(r.sms)}.`;
    });

  return (
    <div className="mpmb-tools__section">
      {message && (
        <Callout tone={message.tone} role={message.tone === 'important' ? 'alert' : 'status'}>
          <p>{message.text}</p>
        </Callout>
      )}
      <section aria-labelledby="bookings-list">
        <div className="mpmb-tools__bar">
          <h2 className="mpmb-h2" id="bookings-list">
            Bookings from a fortnight ago
          </h2>
          <label className="mpmb-notsure">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Show cancelled and moved
          </label>
        </div>
        {!bookings.length && <p className="mpmb-hint">No bookings yet.</p>}
        <ul className="mpmb-tools__list" role="list">
          {bookings.map((b) => {
            const started = new Date(b.start).getTime() <= now;
            return (
              <li key={b.bookingId} className={`mpmb-tools__row mpmb-tools__row--stack${b.status === 'cancelled' ? ' is-closed' : ''}`}>
                <span className="mpmb-tools__main">
                  <strong>
                    {when(b.start)} to {ukHours(b.start, b.end).split(' to ')[1]}
                  </strong>{' '}
                  · visit {b.visit} · <span className="mpmb-mono">{b.participantCode}</span> · {b.status}
                  {b.status === 'cancelled' && b.cancelReason ? ` (${b.cancelReason})` : ''}
                  {b.bookedBy === 'staff' ? ' · booked by the team' : ''}
                </span>
                <span className="mpmb-hint">
                  {b.contact?.email ?? 'no email'}
                  {b.contact?.mobile ? ` · ${b.contact.mobile}${b.contact.smsReminders ? ' (texts)' : ''}` : ''} · confirmation: email {outcome(b.confirmation?.email)}, text {outcome(b.confirmation?.sms)} · reminders: {reminderLine(b)}
                </span>
                {b.status !== 'cancelled' && (
                  <span className="mpmb-tools__actions">
                    {started && b.status !== 'attended' && (
                      <Button variant="link" disabled={busy === b.bookingId} onClick={() => void mark(b, 'attended')}>
                        Attended
                      </Button>
                    )}
                    {started && b.status !== 'missed' && (
                      <Button variant="link" disabled={busy === b.bookingId} onClick={() => void mark(b, 'missed')}>
                        Missed
                      </Button>
                    )}
                    {b.status !== 'booked' && (
                      <Button variant="link" disabled={busy === b.bookingId} onClick={() => void mark(b, 'booked')}>
                        Undo mark
                      </Button>
                    )}
                    {b.status === 'booked' && !started && (
                      <>
                        <Button variant="link" disabled={busy === b.bookingId} onClick={() => void resend(b)}>
                          Send confirmation again
                        </Button>
                        <Button variant="link" disabled={busy === b.bookingId} onClick={() => setCancelling(cancelling === b.bookingId ? null : b.bookingId)}>
                          Cancel…
                        </Button>
                      </>
                    )}
                  </span>
                )}
                {cancelling === b.bookingId && (
                  <div className="mpmb-tools__inline">
                    <TextField id={`reason-${b.bookingId}`} label="Reason, for the participant" required={false} value={reason} onChange={(e) => setReason(e.target.value)} hint="For example: The lab is closed that day; please choose another time." />
                    <label className="mpmb-notsure">
                      <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email the participant (with a calendar cancellation)
                    </label>
                    <div className="mpmb-actions">
                      <Button variant="danger" loading={busy === b.bookingId} onClick={() => void cancel(b)}>
                        Cancel the booking
                      </Button>
                      <Button variant="ghost" onClick={() => setCancelling(null)}>
                        Keep it
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mpmb-card" aria-labelledby="bookings-for">
        <h2 className="mpmb-h3" id="bookings-for">
          Book someone in
        </h2>
        <p className="mpmb-hint">One visit at a time: for example, a visit arranged by email. If the participant already has that visit booked, it moves to the new time. The team can book at short notice and outside the 28 to 35 days; the participant needs consent on file. The confirmation lists both visits. Leave email and mobile empty to use the ones on file.</p>
        <div className="mpmb-tools__grid">
          <TextField id="for-code" label="Participant ID" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="mpmb-input--upper" />
          <SelectField id="for-visit" label="Visit" value={form.visit} onChange={(e) => setForm({ ...form, visit: e.target.value || '1' })} placeholder="First visit" options={[{ value: '2', label: 'Second visit' }]} />
          <SelectField id="for-slot" label="Time" value={form.slotId} onChange={(e) => setForm({ ...form, slotId: e.target.value })} placeholder="Choose a time" options={open.map((s) => ({ value: s.slotId, label: `${when(s.start)}${s.visit ? ` (visit ${s.visit} only)` : ''}${s.location ? `, ${s.location}` : ''}` }))} />
          <TextField id="for-email" label="Email" required={false} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <TextField id="for-mobile" label="UK mobile" required={false} type="tel" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
        </div>
        <label className="mpmb-notsure">
          <input type="checkbox" checked={formNotify} onChange={(e) => setFormNotify(e.target.checked)} /> Send the confirmation email (and text)
        </label>
        <div className="mpmb-actions">
          <Button variant="primary" loading={busy === 'book-for'} disabled={!form.code.trim() || !form.slotId} onClick={() => void bookFor()}>
            Book
          </Button>
        </div>
      </section>
    </div>
  );
}
