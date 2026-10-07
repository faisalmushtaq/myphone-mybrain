import { useCallback, useEffect, useRef, useState } from 'react';
import { getApi } from '../../api';
import { ApiError, type LabBooking, type LabSlot, type LabVisit } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { CheckboxField, TextField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import { describeError, labClientInfo, labSession } from '../api';
import { labBooking } from '../booking';
import { byDay, downloadIcs, googleCalendarUrl, placeLine, ukDateWords, ukDay, ukDayYear, ukHours, visitName, visitTitle } from '../calendar';
import { labPages, labStudy } from '../config';
import { LabShell } from '../LabShell';
import { useLab } from '../store';
import { EMAIL, ukMobile, type FieldError } from '../validation';

/** Days of times shown before "Show later dates". */
const FIRST_DAYS = 8;

/** Times grouped by day, as large radio buttons: one tap to choose. */
function SlotPicker({ slots, chosen, onChoose, error }: { slots: LabSlot[]; chosen: string | null; onChoose: (slotId: string) => void; error?: string }) {
  const [all, setAll] = useState(false);
  const days = byDay(slots);
  const shown = all ? days : days.slice(0, FIRST_DAYS);
  return (
    <div className={`mpmb-slots${error ? ' has-error' : ''}`} id="lab-slot" tabIndex={-1}>
      {error && (
        <p className="mpmb-error" id="lab-slot-error">
          <span className="mpmb-sr-only">Error: </span>
          {error}
        </p>
      )}
      {shown.map(({ day, slots: times }) => (
        <fieldset className="mpmb-slots__day" key={day}>
          <legend className="mpmb-slots__legend">{ukDateWords(day).replace(/ \d{4}$/, '')}</legend>
          <div className="mpmb-chips">
            {times.map((s) => (
              <label key={s.slotId} className={`mpmb-chip mpmb-slots__time${chosen === s.slotId ? ' is-selected' : ''}`}>
                <input type="radio" name="lab-slot" className="mpmb-choice__input" value={s.slotId} checked={chosen === s.slotId} onChange={() => onChoose(s.slotId)} aria-describedby={error ? 'lab-slot-error' : undefined} />
                <span className="mpmb-choice__dot" aria-hidden="true" />
                <span>{ukHours(s.start, s.end)}</span>
                {s.place.name !== labBooking.location.name && <span className="mpmb-slots__place">{s.place.name}</span>}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {days.length > FIRST_DAYS && (
        <Button variant="link" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer dates' : `Show later dates (${days.length - FIRST_DAYS} more)`}
        </Button>
      )}
    </div>
  );
}

/** One booked visit: when and where, the calendar, and changing or cancelling it while that is still allowed online. */
function VisitCard({ booking, code, onChange, onCancel, canMove, busy }: { booking: LabBooking; code: string; onChange: () => void; onCancel: () => void; canMove: boolean; busy: boolean }) {
  const [saved, setSaved] = useState<string | null>(null);
  const done = booking.status === 'attended';
  return (
    <div className={`mpmb-card mpmb-visit${done ? ' mpmb-visit--done' : ''}`}>
      <p className="mpmb-kicker">{visitTitle(booking.visit)}</p>
      <p className="mpmb-visit__when">
        <strong>{ukDayYear(booking.start)}</strong>
        <span>{ukHours(booking.start, booking.end)}</span>
      </p>
      <p className="mpmb-visit__where">
        {placeLine(booking.place)}
        {booking.place.directions && (
          <>
            <br />
            <span className="mpmb-hint">{booking.place.directions}</span>
          </>
        )}
      </p>
      {done ? (
        <p className="mpmb-hint">Done. Thank you for coming.</p>
      ) : (
        <>
          <div className="mpmb-visit__actions">
            <Button variant="secondary" onClick={() => setSaved(downloadIcs(booking))}>
              Add to my calendar
            </Button>
            <a className="mpmb-btn mpmb-btn--ghost" href={googleCalendarUrl(booking, code)} target="_blank" rel="noopener noreferrer">
              <span>Google Calendar</span>
            </a>
          </div>
          {saved && <p className="mpmb-hint">Saved as {saved}. Open it to add the visit to your calendar.</p>}
          {booking.canChange ? (
            <>
              <p className="mpmb-visit__change">
                {canMove && (
                  <Button variant="link" onClick={onChange} disabled={busy}>
                    Change the time
                  </Button>
                )}
                <Button variant="link" onClick={onCancel} disabled={busy}>
                  Cancel this visit
                </Button>
              </p>
              {!canMove && booking.visit === 1 && (
                <p className="mpmb-hint">
                  Your second visit is booked around this one, so to move it, contact {labStudy.contact.name} at <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a>.
                </p>
              )}
            </>
          ) : (
            <p className="mpmb-hint">
              It is less than {labBooking.changeUntilHours} hours away, so it can no longer be changed here. To change it, contact {labStudy.contact.name} at <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a>.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Booking the two lab visits. The first opens once the data from before the
 * break has arrived; the second once the first is booked, in the days that
 * end the 30-day break. A booking is emailed with a calendar file and copied
 * to the study's contact; reminders follow by email and, if wanted, by text.
 * The page is its own (/break/book/) and also opens from the other pages'
 * summaries.
 */
export function LabBook() {
  const { state, dispatch } = useLab();
  const { options, confirmed } = state.booking;
  const [load, setLoad] = useState<{ kind: 'idle' | 'loading' } | { kind: 'failed'; message: string }>({ kind: 'idle' });
  const [chosen, setChosen] = useState<string | null>(null);
  const [changing, setChanging] = useState<LabBooking | null>(null);
  const [cancelling, setCancelling] = useState<LabBooking | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const ready = state.codeConfirmed && state.submission.consentStage === 'sent';
  const inline = state.flow !== 'book';

  const refresh = useCallback(async () => {
    setLoad({ kind: 'loading' });
    try {
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      const result = await getApi().labBookingOptions(session, state.code);
      dispatch({ type: 'booking-options', options: result });
      setLoad({ kind: 'idle' });
    } catch (error) {
      setLoad({ kind: 'failed', message: describeError(error, 'the times') });
    }
  }, [dispatch, state.code, state.session]);

  useEffect(() => {
    if (ready) void refresh();
    // Once per visit to this step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, state.code]);

  const visit: LabVisit | null = changing ? changing.visit : (options?.next ?? null);
  const slots = changing ? (options?.changing[changing.visit] ?? []) : (options?.slots ?? []);
  const { email, mobile, smsReminders } = state.booking;

  const validate = (): FieldError[] => {
    const found: FieldError[] = [];
    if (!chosen || !slots.some((s) => s.slotId === chosen)) found.push({ field: 'lab-slot', message: 'Choose a time.' });
    if (!email.trim()) found.push({ field: 'lab-email', message: 'Enter your email address, so we can send you the details.' });
    else if (!EMAIL.test(email.trim())) found.push({ field: 'lab-email', message: 'Enter an email address in the format name@example.com.' });
    if (mobile.trim() && !ukMobile(mobile)) found.push({ field: 'lab-mobile', message: 'Enter a UK mobile number, such as 07700 900123, or leave it empty.' });
    else if (smsReminders && !mobile.trim()) found.push({ field: 'lab-mobile', message: 'Enter your mobile number for text reminders, or untick them.' });
    return found;
  };

  const toTop = () => window.setTimeout(() => topRef.current?.scrollIntoView({ block: 'start' }), 50);

  const book = async () => {
    setNotice(null);
    const found = validate();
    setErrors(found);
    if (found.length || !visit || !chosen) return;
    setBusy(true);
    try {
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      const texts = Boolean(options?.smsAvailable && smsReminders && mobile.trim());
      const result = await getApi().bookLabSlot(session, { participantCode: state.code, slotId: chosen, visit, email: email.trim(), mobile: mobile.trim() || null, smsReminders: texts, replaces: changing?.bookingId ?? null, client: labClientInfo() });
      dispatch({ type: 'booking-confirmed', confirmed: { booking: result.booking, kind: changing ? 'moved' : 'booked', email: result.email, sms: result.sms } });
      announce(`${changing ? 'Moved' : 'Booked'}: your ${visitName(visit)}, ${ukDay(result.booking.start)}, ${ukHours(result.booking.start, result.booking.end)}.`);
      setChanging(null);
      setChosen(null);
      toTop();
      await refresh();
    } catch (error) {
      setErrors([{ field: 'lab-slot', message: describeError(error, 'your booking') }]);
      // A time someone else has just taken: show what is open now.
      if (error instanceof ApiError && error.code === 'validation') void refresh();
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (b: LabBooking) => {
    setBusy(true);
    setNotice(null);
    try {
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      await getApi().cancelLabBooking(session, { participantCode: state.code, bookingId: b.bookingId });
      dispatch({ type: 'booking-confirmed', confirmed: null });
      setCancelling(null);
      setNotice(`Your ${visitName(b.visit)} on ${ukDay(b.start)} is cancelled. We have emailed you to confirm${b.visit === 1 ? '. Choose another time below when you are ready.' : '.'}`);
      announce('Visit cancelled.');
      toTop();
      await refresh();
    } catch (error) {
      setErrors([{ field: 'lab-slot', message: describeError(error, 'the cancellation') }]);
    } finally {
      setBusy(false);
    }
  };

  const backToSummary = inline ? (
    <Button variant="ghost" onClick={() => dispatch({ type: 'go-to', stepId: 'done' })}>
      Back to my summary
    </Button>
  ) : null;

  if (!ready) {
    return (
      <LabShell kicker="Your lab visits" title="First, tell us who you are." intro={<p>Your details find your record, so we can show your visits and the times you can book.</p>} hideContinue hideBack>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => dispatch({ type: 'go-to', stepId: 'participant-id' })}>
            Enter my details
          </Button>
        </div>
      </LabShell>
    );
  }

  const bookings = (options?.bookings ?? []).filter((b) => b.status === 'booked' || b.status === 'attended');
  const title = changing ? `Change your ${visitName(changing.visit)}.` : visit === 1 ? 'Book your first lab visit.' : visit === 2 ? 'Book your second lab visit.' : bookings.length ? 'Your lab visits.' : 'Book your lab visits.';

  return (
    <LabShell kicker="Your lab visits" title={title} errors={errors} hideContinue hideBack width="wide">
      <div ref={topRef} />
      {confirmed && !changing && (
        <Callout tone="success" role="status">
          <p>
            <strong>
              {confirmed.kind === 'moved' ? 'Moved' : 'Booked'}: your {visitName(confirmed.booking.visit)}, {ukDayYear(confirmed.booking.start)}, {ukHours(confirmed.booking.start, confirmed.booking.end)}.
            </strong>{' '}
            {confirmed.email === 'sent'
              ? `We have emailed the details and a calendar file to ${email.trim() || 'you'}, with a copy to ${labStudy.contact.name} in the research team.`
              : 'Your booking is made, but we could not email you just now. Add it to your calendar below, and the team will be in touch.'}{' '}
            {confirmed.sms === 'sent' ? 'We have also sent you a text, and will text you reminders.' : ''}
          </p>
        </Callout>
      )}
      {notice && (
        <Callout tone="info" role="status">
          <p>{notice}</p>
        </Callout>
      )}
      {load.kind === 'failed' && (
        <Callout tone="important" role="alert">
          <p>{load.message}</p>
          <Button variant="secondary" onClick={() => void refresh()}>
            Try again
          </Button>
        </Callout>
      )}
      {!options && load.kind !== 'failed' && (
        <p className="mpmb-hint" role="status">
          <span className="mpmb-spinner" aria-hidden="true" /> Finding your visits and the open times…
        </p>
      )}

      {options && bookings.length > 0 && (
        <section aria-labelledby="lab-visits" className="mpmb-visits">
          <h2 className={visit ? 'mpmb-h2' : 'mpmb-sr-only'} id="lab-visits">
            Your visits
          </h2>
          {bookings.map((b) => (
            <div key={b.bookingId}>
              <VisitCard
                booking={b}
                code={state.code}
                busy={busy}
                canMove={Boolean(options.changing[b.visit])}
                onChange={() => {
                  setChanging(b);
                  setChosen(null);
                  setErrors([]);
                  setNotice(null);
                }}
                onCancel={() => {
                  setCancelling(b);
                  setErrors([]);
                }}
              />
              {cancelling?.bookingId === b.bookingId && (
                <Callout tone="important" role="alert">
                  <p>
                    Cancel your {visitName(b.visit)} on {ukDay(b.start)} at {ukHours(b.start, b.end)}?{b.visit === 1 && bookings.some((x) => x.visit === 2) ? ' Your second visit stays booked; the team will be in touch about it.' : ''}
                  </p>
                  <div className="mpmb-actions">
                    <Button variant="danger" loading={busy} onClick={() => void cancel(b)}>
                      Yes, cancel it
                    </Button>
                    <Button variant="ghost" onClick={() => setCancelling(null)}>
                      No, keep it
                    </Button>
                  </div>
                </Callout>
              )}
            </div>
          ))}
        </section>
      )}

      {options && !visit && !bookings.length && (
        <Callout tone="important">
          <p>
            <strong>You can book your first lab visit once {options.missing.join(' and ')} {options.missing.length === 1 ? 'has' : 'have'} arrived.</strong> The team needs them before the visit, so it can use the time with you.
          </p>
          {!options.consent ? null : inline && state.flow === 'baseline' ? (
            <Button variant="primary" arrow onClick={() => dispatch({ type: 'go-to', stepId: 'screenshots' })}>
              Send my data
            </Button>
          ) : (
            <a className="mpmb-btn mpmb-btn--primary" href={labPages.baseline.path}>
              <span>Send my data</span>
              <span className="mpmb-btn__arrow" aria-hidden="true">
                →
              </span>
            </a>
          )}
        </Callout>
      )}

      {options && visit && (
        <section aria-labelledby="lab-times" className="mpmb-booking">
          <h2 className="mpmb-h2" id="lab-times">
            {changing ? `Choose a new time for your ${visitName(changing.visit)}` : `Choose a time for your ${visitName(visit)}`}
          </h2>
          <p>
            {labBooking.visits.find((v) => v.visit === visit)?.what}{' '}
            {visit === 2 && options.window && !changing ? `It ends your break, so it is between ${ukDateWords(options.window.from)} and ${ukDateWords(options.window.to)}. Book it now, or later: we will remind you.` : ''}
          </p>
          <p className="mpmb-hint">
            At {placeLine(labBooking.location)}. Times are UK times; each visit lasts about {Math.round(labBooking.minutes / 60)} hours.
            {__PROTOTYPE__ && <span className="mpmb-draft mpmb-draft--text">{labBooking.location.draft}</span>}
          </p>
          {slots.length ? (
            <SlotPicker
              slots={slots}
              chosen={chosen}
              onChoose={(id) => {
                setChosen(id);
                setErrors((e) => e.filter((x) => x.field !== 'lab-slot'));
              }}
              error={errs['lab-slot']}
            />
          ) : (
            <Callout tone="info">
              <p>
                No times are open {visit === 2 && options.window ? 'in those days ' : ''}right now. The team adds times every week, so please look again in a few days, or contact {labStudy.contact.name} at <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a> to arrange one.
              </p>
            </Callout>
          )}

          {slots.length > 0 && (
            <div className="mpmb-fields mpmb-booking__contact">
              <h3 className="mpmb-h3">Where to send the confirmation</h3>
              <TextField id="lab-email" label="Email address" type="email" required autoComplete="email" inputMode="email" maxLength={254} value={email} onChange={(e) => {
                  dispatch({ type: 'booking-contact', patch: { email: e.target.value } });
                  if (errs['lab-email'] && EMAIL.test(e.target.value.trim())) setErrors((x) => x.filter((f) => f.field !== 'lab-email'));
                }}
                error={errs['lab-email']} hint="The details and a calendar file go here. We email a reminder the day before." />
              {options.smsAvailable && (
                <>
                  <TextField id="lab-mobile" label="Mobile number" required={false} type="tel" autoComplete="tel" inputMode="tel" maxLength={30} width="half" value={mobile} onChange={(e) => dispatch({ type: 'booking-contact', patch: { mobile: e.target.value, ...(e.target.value.trim() && !mobile.trim() ? { smsReminders: true } : {}) } })} error={errs['lab-mobile']} hint="A UK mobile, for text reminders." />
                  <CheckboxField id="lab-sms" checked={smsReminders} onChange={(checked) => dispatch({ type: 'booking-contact', patch: { smsReminders: checked } })} label="Text me reminders" hint="The day before and on the day of each visit, and a nudge for each weekly check-in during the break." />
                </>
              )}
              <p className="mpmb-hint">Used only to send you your bookings and reminders for this study, and kept with your consent record, not with your data.</p>
            </div>
          )}
          <div className="mpmb-actions">
            {slots.length > 0 && (
              <Button variant="primary" arrow loading={busy} onClick={() => void book()}>
                {changing ? 'Move my visit to this time' : 'Book this time'}
              </Button>
            )}
            {changing && (
              <Button
                variant="ghost"
                onClick={() => {
                  setChanging(null);
                  setChosen(null);
                  setErrors([]);
                }}
              >
                Keep my current time
              </Button>
            )}
            {!changing && backToSummary}
          </div>
        </section>
      )}

      {options && !visit && (bookings.length > 0 || inline) && (
        <div className="mpmb-actions">
          {backToSummary}
          {!inline && bookings.length > 0 && (
            <p className="mpmb-hint">
              During your break, check in each week on the <a href={labPages.checkin.path}>mid-break check-in</a>; when it ends, send your data again on the <a href={labPages.after.path}>after-break page</a>.
            </p>
          )}
        </div>
      )}
    </LabShell>
  );
}
