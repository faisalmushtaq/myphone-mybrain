import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { TextField } from '../../components/ui/Field';
import { ukHours } from '../../lab/calendar';
import { copyText, messageOf, when, type ParticipantDetail, type ParticipantRow } from '../api';
import type { Staff } from '../StaffApp';

const files = (c: { archives: number; screenshots: number } | undefined) => (c ? `${c.screenshots} shots, ${c.archives} files` : 'n/a');

function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <li className="mpmb-tools__row">
      <span className="mpmb-tools__main">
        <strong>{label}</strong>
        <br />
        <span className="mpmb-mono mpmb-tools__link">{value}</span>
      </span>
      <span className="mpmb-tools__actions">
        <Button variant="link" onClick={() => void copyText(value).then(setCopied)}>
          {copied ? 'Copied' : copied === false ? 'Select and copy it' : 'Copy'}
        </Button>
      </span>
    </li>
  );
}

/** One participant: what has arrived, their visits, contact details, the messages sent, and their personal links. */
function Detail({ staff, code, onClose }: { staff: Staff; code: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ParticipantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError(null);
    try {
      setDetail(await staff.ask<ParticipantDetail>('participant', { participantCode: code }));
    } catch (e) {
      setError(messageOf(e));
    }
  };
  useEffect(() => {
    void load();
    // When the participant changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const pause = async (paused: boolean) => {
    setBusy(true);
    try {
      await staff.ask('pause-messages', { participantCode: code, paused });
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <Callout tone="important" role="alert">
        <p>{error}</p>
      </Callout>
    );
  }
  if (!detail) return <p className="mpmb-hint">Loading {code}…</p>;
  const messages = Object.entries(detail.messages).sort((a, b) => String(a[1].at ?? '').localeCompare(String(b[1].at ?? '')));
  return (
    <section className="mpmb-card mpmb-tools__detail" aria-labelledby="detail-title">
      <div className="mpmb-tools__bar">
        <h2 className="mpmb-h3" id="detail-title">
          <span className="mpmb-mono">{detail.participantCode}</span>
        </h2>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {!detail.exists ? (
        <p>No consent on file for this participant ID.</p>
      ) : (
        <>
          <p>
            Consent {when(detail.consentedAt)} · before the break: {files(detail.phases?.pre)} · during: {detail.checkIns} check-ins, {files(detail.phases?.mid)} · after: {files(detail.phases?.post)}
            {detail.platformsNotUsed.length ? ` · does not use ${detail.platformsNotUsed.join(', ')}` : ''} · stories: {['pre', 'mid', 'post'].map((p) => `${p} ${detail.stories[p] ?? 0}`).join(', ')}
          </p>
          <p>
            {detail.toBook.length === 2
              ? 'Can book both visits now.'
              : detail.toBook.length === 1
                ? `Visit ${detail.toBook[0]} to book again${detail.windows[detail.toBook[0]] ? ` (${detail.windows[detail.toBook[0]]!.from} to ${detail.windows[detail.toBook[0]]!.to}, to fit the other visit)` : ''}.`
                : detail.missing.length
                  ? `Before booking: ${detail.missing.join(', ')}.`
                  : 'Both visits booked.'}
          </p>
          <h3 className="mpmb-h3">Visits</h3>
          {detail.bookings.length ? (
            <ul className="mpmb-tools__list" role="list">
              {detail.bookings.map((b) => (
                <li key={b.bookingId} className={`mpmb-tools__row${b.status === 'cancelled' ? ' is-closed' : ''}`}>
                  <span className="mpmb-tools__main">
                    Visit {b.visit}: {when(b.start)} to {ukHours(b.start, b.end).split(' to ')[1]} · {b.status}
                    {b.cancelReason ? ` (${b.cancelReason})` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mpmb-hint">No visits booked.</p>
          )}
          <h3 className="mpmb-h3">Contact</h3>
          <p>
            {detail.contact.email ?? 'No booking email'}
            {detail.contact.mobile ? ` · ${detail.contact.mobile} (${detail.contact.smsReminders ? 'texts wanted' : 'no texts'})` : ''}
            {detail.progressEmail && detail.progressEmail !== detail.contact.email ? ` · progress emails to ${detail.progressEmail}` : ''}
          </p>
          <h3 className="mpmb-h3">Messages during the break</h3>
          {messages.length ? (
            <ul className="mpmb-tools__list" role="list">
              {messages.map(([id, m]) => (
                <li key={id} className="mpmb-tools__row">
                  <span className="mpmb-tools__main">
                    {id}: {m.skipped ? `skipped (${m.skipped.replace(/^skip-/, '')})` : `email ${m.email ?? 'n/a'}, text ${m.sms ?? 'n/a'}`} · {when(m.at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mpmb-hint">None sent yet. They start the day after the first visit.</p>
          )}
          <Button variant="secondary" loading={busy} onClick={() => void pause(!detail.messagesPaused)}>
            {detail.messagesPaused ? 'Restart the automatic reminders and messages' : 'Stop the automatic reminders and messages'}
          </Button>
          {detail.messagesPaused && <p className="mpmb-hint">Stopped: nothing is sent to this participant automatically until restarted.</p>}
        </>
      )}
      <h3 className="mpmb-h3">Personal links</h3>
      <p className="mpmb-hint">Each opens the page with this participant ID filled in, on any device. The same links go in the emails and texts.</p>
      <ul className="mpmb-tools__list" role="list">
        <CopyLine label="Before the break: consent and data" value={detail.links.takePart} />
        <CopyLine label="Book or change lab visits" value={detail.links.book} />
        <CopyLine label="Weekly check-in" value={detail.links.checkIn} />
        <CopyLine label="After the break: data again" value={detail.links.after} />
        <CopyLine label="MyStory during the break (also after each check-in)" value={detail.links.story.mid} />
      </ul>
      <h3 className="mpmb-h3">At the lab</h3>
      <p className="mpmb-hint">MyStory before and after the break is told at the visits. Open the link on the lab computer and hand it over; once the story is sent, the page forgets the participant, ready for the next person.</p>
      <ul className="mpmb-tools__list" role="list">
        <CopyLine label="MyStory at the first visit (before the break)" value={detail.links.atLab.pre} />
        <CopyLine label="MyStory at the second visit (after the break)" value={detail.links.atLab.post} />
      </ul>
    </section>
  );
}

/** Everyone in the break study, where they stand, and one participant in detail. */
export function Participants({ staff }: { staff: Staff }) {
  const [rows, setRows] = useState<ParticipantRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    staff
      .ask<{ participants: ParticipantRow[] }>('participants')
      .then((r) => setRows(r.participants))
      .catch((e) => setError(messageOf(e)));
    // Once, when the tab opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const find = (e: FormEvent) => {
    e.preventDefault();
    const code = lookup.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code) setOpen(code);
  };

  return (
    <div className="mpmb-tools__section">
      <form className="mpmb-tools__search" onSubmit={find}>
        <TextField id="find-code" label="Find a participant" value={lookup} onChange={(e) => setLookup(e.target.value)} hint="Their participant ID, such as MP2670FF90A5F2." className="mpmb-input--upper" />
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>
      {open && <Detail staff={staff} code={open} onClose={() => setOpen(null)} />}
      {error && (
        <Callout tone="important" role="alert">
          <p>{error}</p>
        </Callout>
      )}
      <section aria-labelledby="people">
        <h2 className="mpmb-h2" id="people">
          Everyone with consent ({rows?.length ?? '…'})
        </h2>
        {rows && !rows.length && <p className="mpmb-hint">Nobody yet.</p>}
        <ul className="mpmb-tools__list" role="list">
          {(rows ?? []).map((r) => (
            <li key={r.participantCode} className="mpmb-tools__row">
              <span className="mpmb-tools__main">
                <Button variant="link" onClick={() => setOpen(r.participantCode)}>
                  <span className="mpmb-mono">{r.participantCode}</span>
                </Button>{' '}
                consent {when(r.consentedAt)} · before: {files(r.pre)} · visit 1: {r.visit1 ? `${when(r.visit1.start)} (${r.visit1.status})` : r.toBook.includes(1) ? 'to book' : 'n/a'} · visit 2: {r.visit2 ? `${when(r.visit2.start)} (${r.visit2.status})` : r.toBook.includes(2) ? 'to book' : 'n/a'} · {r.checkIns} check-ins · after: {files(r.post)}
                {r.missing.length && !r.visit1 ? ` · waiting for ${r.missing.join(', ')}` : ''}
                {r.messagesPaused ? ' · messages stopped' : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
