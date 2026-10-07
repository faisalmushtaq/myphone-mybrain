import { useCallback, useEffect, useRef, useState } from 'react';
import { getApi } from '../../api';
import { ApiError, type LabBooking, type LabSlot, type LabVisit } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { CheckboxField, TextField } from '../../components/ui/Field';
import { announce } from '../../lib/announce';
import { describeError, labClientInfo, labSession } from '../api';
import { labBooking } from '../booking';
import { byDay, downloadIcs, firstVisitDays, googleCalendarUrl, onDays, placeLine, secondVisitDays, ukDateWords, ukDay, ukDayYear, ukHours, visitName, visitTitle } from '../calendar';
import { labPages, labStudy } from '../config';
import { LabShell } from '../LabShell';
import { useLab } from '../store';
import { EMAIL, ukMobile, type FieldError } from '../validation';

/** Days of times shown before "Show later dates". */
const FIRST_DAYS = 8;
/** The choice that keeps a visit's current time when changing. */
const KEEP = 'keep';
const VISITS: LabVisit[] = [1, 2];

/** Times grouped by day, as large radio buttons: one tap to choose. When changing, the current time comes first, to keep it. */
function SlotPicker({ visit, slots, chosen, onChoose, error, keep }: { visit: LabVisit; slots: LabSlot[]; chosen: string | null; onChoose: (slotId: string) => void; error?: string; keep?: LabBooking | null }) {
  const [all, setAll] = useState(false);
  const days = byDay(slots);
  const shown = all ? days : days.slice(0, FIRST_DAYS);
  const name = `lab-slot-${visit}`;
  const describedBy = error ? `${name}-error` : undefined;
  const option = (value: string, label: string, place?: string) => (
    <label key={value} className={`mpmb-chip mpmb-slots__time${chosen === value ? ' is-selected' : ''}`}>
      <input type="radio" name={name} className="mpmb-choice__input" value={value} checked={chosen === value} onChange={() => onChoose(value)} aria-describedby={describedBy} />
      <span className="mpmb-choice__dot" aria-hidden="true" />
      <span>{label}</span>
      {place && <span className="mpmb-slots__place">{place}</span>}
    </label>
  );
  return (
    <div className={`mpmb-slots${error ? ' has-error' : ''}`} id={name} tabIndex={-1}>
      {error && (
        <p className="mpmb-error" id={`${name}-error`}>
          <span className="mpmb-sr-only">Error: </span>
          {error}
        </p>
      )}
      {keep && (
        <fieldset className="mpmb-slots__day">
          <legend className="mpmb-slots__legend">Your current time</legend>
          <div className="mpmb-chips">{option(KEEP, `Keep ${ukDay(keep.start)}, ${ukHours(keep.start, keep.end)}`)}</div>
        </fieldset>
      )}
      {shown.map(({ day, slots: times }) => (
        <fieldset className="mpmb-slots__day" key={day}>
          <legend className="mpmb-slots__legend">{ukDateWords(day).replace(/ \d{4}$/, '')}</legend>
          <div className="mpmb-chips">{times.map((s) => option(s.slotId, ukHours(s.start, s.end), s.place.name !== labBooking.location.name ? s.place.name : undefined))}</div>
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

/** One booked visit: when and where, and adding it to a calendar. */
function VisitCard({ booking, code }: { booking: LabBooking; code: string }) {
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
        </>
      )}
    </div>
  );
}

const both = (xs: { start: string; end: string }[]) => xs.map((b) => `${ukDayYear(b.start)}, ${ukHours(b.start, b.end)}`).join(', and ');

/**
 * Booking the two lab visits, together: the first starts the 30-day break
 * and the second, 28 to 35 days later, ends it, and taking part means coming
 * to both. Nothing can be booked until the data from before the break has
 * arrived. People choose the first visit, then the second from the times that
 * fit; the booking is emailed with a calendar file per visit and copied to
 * the research team; reminders follow by email and, if wanted, by text.
 * Changing keeps either time or moves it; cancelling cancels the visits
 * still to come. People come back to change on any device, with their
 * participant ID (it is in every email), their four details or the link in
 * an email; the confirmation goes to the address on file unless they choose
 * another, and then the old address is told too. The page is its own
 * (/break/book/) and also opens from the other pages' summaries.
 */
export function LabBook() {
  const { state, dispatch } = useLab();
  const { options, confirmed } = state.booking;
  const [load, setLoad] = useState<{ kind: 'idle' | 'loading' } | { kind: 'failed'; message: string }>({ kind: 'idle' });
  const [choice, setChoice] = useState<Record<LabVisit, string | null>>({ 1: null, 2: null });
  const [changing, setChanging] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // A different email address from the one on file (only asked for when someone chooses it).
  const [newAddress, setNewAddress] = useState(false);
  // Where the last confirmation went, for the message after booking.
  const [sentTo, setSentTo] = useState<string | null>(null);
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

  const { email, mobile, smsReminders } = state.booking;
  const gap = options?.gap ?? labBooking.visit2AfterDays;
  const standing = (options?.bookings ?? []).filter((b) => b.status === 'booked' || b.status === 'attended');
  const current = (v: LabVisit): LabBooking | null => standing.filter((b) => b.visit === v).at(-1) ?? null;
  const toBook = options?.toBook ?? [];
  const planning = Boolean(options) && (toBook.length > 0 || changing);
  // Changing visits, or booking again, keeps the contact details on file (an email address and, since 7 October 2026, a mobile number) unless the person chooses others: nothing to type again on a new device.
  const onFile = options?.contact ?? null;
  const keepContact = Boolean(onFile?.mobileEnding) && !newAddress;

  /** Each visit in the planner: still to book, booked and movable (when changing), or staying as it is. */
  const role = (v: LabVisit): 'open' | 'keep' | 'fixed' => {
    const b = current(v);
    if (!b) return 'open';
    return changing && b.canChange ? 'keep' : 'fixed';
  };
  const slotOf = (v: LabVisit, id: string | null) => (id && id !== KEEP ? (options?.slots[v].find((s) => s.slotId === id) ?? null) : null);

  // The first visit's times: any, unless the second stays where it is, when 28 to 35 days before it.
  const fixed2 = role(2) === 'fixed' ? current(2) : null;
  const list1 = !options ? [] : fixed2 ? options.slots[1].filter((s) => onDays(s.start, firstVisitDays(fixed2.start, gap))) : options.slots[1];
  const valid1 = role(1) === 'fixed' || (choice[1] === KEEP ? role(1) === 'keep' : list1.some((s) => s.slotId === choice[1]));
  const firstStart = role(1) === 'fixed' ? current(1)!.start : !valid1 ? null : choice[1] === KEEP ? current(1)!.start : slotOf(1, choice[1])!.start;
  // The second visit's times: 28 to 35 days after the first, chosen or kept.
  const days2 = firstStart ? secondVisitDays(firstStart, gap) : null;
  const list2 = days2 && options ? options.slots[2].filter((s) => onDays(s.start, days2)) : [];
  const keep2 = role(2) === 'keep' && days2 && onDays(current(2)!.start, days2) ? current(2) : null;
  const valid2 = role(2) === 'fixed' || (choice[2] === KEEP ? Boolean(keep2) : list2.some((s) => s.slotId === choice[2]));
  const picks = VISITS.filter((v) => role(v) !== 'fixed' && choice[v] && choice[v] !== KEEP).map((v) => ({ visit: v, slotId: choice[v]! }));
  const anyTimes = role(1) === 'fixed' ? list2.length > 0 || Boolean(keep2) : list1.length > 0 || role(1) === 'keep';

  const choose = (v: LabVisit, id: string) => {
    setChoice((c) => ({ ...c, [v]: id }));
    setErrors((e) => e.filter((x) => x.field !== `lab-slot-${v}`));
  };

  const validate = (): FieldError[] => {
    const found: FieldError[] = [];
    if (role(1) !== 'fixed' && !valid1) found.push({ field: 'lab-slot-1', message: 'Choose a time for your first visit.' });
    if (role(2) !== 'fixed' && !valid2) {
      const message = !firstStart ? 'Choose your first visit, then a time for your second.' : list2.length || keep2 ? 'Choose a time for your second visit.' : `No times are open ${gap.min} to ${gap.max} days after that first visit yet. Choose another time for your first visit, or contact ${labStudy.contact.name}.`;
      found.push({ field: 'lab-slot-2', message });
    }
    if (!found.length && !picks.length) found.push({ field: `lab-slot-${role(1) === 'fixed' ? 2 : 1}`, message: 'Choose a new time for at least one visit, or keep your current times.' });
    if (keepContact) return found;
    if (!email.trim()) found.push({ field: 'lab-email', message: 'Enter your email address, so we can send you the details.' });
    else if (!EMAIL.test(email.trim())) found.push({ field: 'lab-email', message: 'Enter an email address in the format name@example.com.' });
    // The mobile number is required: the team needs it to contact people about their visits (decided 7 October 2026).
    if (!mobile.trim()) found.push({ field: 'lab-mobile', message: 'Enter your mobile number, so the team can contact you about your visits.' });
    else if (!ukMobile(mobile)) found.push({ field: 'lab-mobile', message: 'Enter a UK mobile number, such as 07700 900123.' });
    return found;
  };

  const toTop = () => window.setTimeout(() => topRef.current?.scrollIntoView({ block: 'start' }), 50);

  const startChanging = () => {
    setChanging(true);
    setCancelling(false);
    setChoice({ 1: current(1)?.canChange ? KEEP : null, 2: current(2)?.canChange ? KEEP : null });
    setErrors([]);
    setNotice(null);
    dispatch({ type: 'booking-confirmed', confirmed: null });
  };

  const stopChanging = () => {
    setChanging(false);
    setChoice({ 1: null, 2: null });
    setErrors([]);
  };

  const book = async () => {
    setNotice(null);
    const found = validate();
    setErrors(found);
    if (found.length) return;
    setBusy(true);
    try {
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      // Text reminders are kept as chosen even before texts are set up, so they start once they are.
      const contact = keepContact ? { email: null, mobile: null, smsReminders: false } : { email: email.trim(), mobile: mobile.trim(), smsReminders };
      const result = await getApi().bookLabSlot(session, { participantCode: state.code, visits: picks, ...contact, client: labClientInfo() });
      setSentTo(keepContact ? onFile!.email : email.trim());
      setNewAddress(false);
      dispatch({ type: 'booking-confirmed', confirmed: { booked: result.booked, kind: result.kind, email: result.email, sms: result.sms } });
      announce(`${result.kind === 'moved' ? 'Changed' : 'Booked'}: ${result.booked.map((b) => `your ${visitName(b.visit)}, ${ukDay(b.start)}, ${ukHours(b.start, b.end)}`).join('; ')}.`);
      setChanging(false);
      setChoice({ 1: null, 2: null });
      toTop();
      await refresh();
    } catch (error) {
      setErrors([{ field: `lab-slot-${picks.some((p) => p.visit === 2) ? 2 : 1}`, message: describeError(error, 'your booking') }]);
      // A time someone else has just taken: show what is open now.
      if (error instanceof ApiError && error.code === 'validation') void refresh();
    } finally {
      setBusy(false);
    }
  };

  const toCome = standing.filter((b) => b.status === 'booked' && Date.parse(b.start) > Date.now());
  const canCancel = toCome.length > 0 && toCome.every((b) => b.canChange);
  const canMove = standing.some((b) => b.canChange);
  const visitsWord = toCome.length > 1 ? 'your visits' : toCome.length ? `your ${visitName(toCome[0].visit)}` : 'your visits';

  const cancel = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const session = await labSession(state.session, (s) => dispatch({ type: 'session', session: s }));
      await getApi().cancelLabBooking(session, { participantCode: state.code, bookingIds: null });
      dispatch({ type: 'booking-confirmed', confirmed: null });
      setCancelling(false);
      setNotice(`${toCome.length > 1 ? 'Your lab visits are' : `Your ${visitName(toCome[0]?.visit ?? 1)} is`} cancelled. We have emailed you to confirm. To take part, book again below when you are ready.`);
      announce('Visits cancelled.');
      toTop();
      await refresh();
    } catch (error) {
      setErrors([{ field: 'lab-visits', message: describeError(error, 'the cancellation') }]);
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
      <LabShell kicker="Your lab visits" title="First, tell us who you are." intro={<p>Your participant ID, or your details, find your record, so we can show your visits and the times you can book.</p>} hideContinue hideBack>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => dispatch({ type: 'go-to', stepId: 'participant-id' })}>
            Find my visits
          </Button>
        </div>
      </LabShell>
    );
  }

  const title = changing ? 'Change your lab visit times.' : planning ? (toBook.length === 2 ? 'Book your two lab visits.' : `Book your ${visitName(toBook[0])}.`) : standing.length ? 'Your lab visits.' : 'Book your lab visits.';
  const contactThem = (
    <>
      contact {labStudy.contact.name} at <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a>
    </>
  );

  const visitBlock = (v: LabVisit) => {
    const r = role(v);
    const heading = `${toBook.length === 1 && !changing ? '' : `${v}. `}Your ${v === 1 ? 'first' : 'second'} visit`;
    if (r === 'fixed') {
      const b = current(v)!;
      return (
        <div className="mpmb-booking__visit" key={v}>
          <h3 className="mpmb-h3">{heading}</h3>
          <p>
            <strong>{ukDayYear(b.start)}</strong>, {ukHours(b.start, b.end)}
            {b.status === 'attended' ? ' (done)' : changing ? ` (less than ${labBooking.changeUntilHours} hours away, so it stays as it is)` : ' (booked)'}.
          </p>
        </div>
      );
    }
    const info = labBooking.visits.find((x) => x.visit === v)?.what;
    if (v === 1) {
      return (
        <div className="mpmb-booking__visit" key={v}>
          <h3 className="mpmb-h3">{heading}</h3>
          <p>
            {info}
            {fixed2 ? ` It needs to be ${gap.min} to ${gap.max} days before your second visit.` : ''}
          </p>
          {list1.length || r === 'keep' ? (
            <SlotPicker visit={1} slots={list1} chosen={choice[1]} onChoose={(id) => choose(1, id)} error={errs['lab-slot-1']} keep={r === 'keep' ? current(1) : null} />
          ) : (
            <Callout tone="info">
              <p>
                No times are open {fixed2 ? 'in those days ' : ''}right now. The team adds times every week, so please look again in a few days, or {contactThem} to arrange one.
              </p>
            </Callout>
          )}
        </div>
      );
    }
    return (
      <div className="mpmb-booking__visit" key={v}>
        <h3 className="mpmb-h3">{heading}</h3>
        <p>
          {info} It is {gap.min} to {gap.max} days after the first{days2 ? `: between ${ukDateWords(days2.from)} and ${ukDateWords(days2.to)}` : ''}.
        </p>
        {!days2 ? (
          <p className="mpmb-hint" id="lab-slot-2" tabIndex={-1}>
            {errs['lab-slot-2'] ? <span className="mpmb-error">{errs['lab-slot-2']}</span> : 'Choose your first visit, and the times for your second appear here.'}
          </p>
        ) : list2.length || keep2 ? (
          <>
            {role(2) === 'keep' && !keep2 && <p className="mpmb-hint">Your current second visit is not {gap.min} to {gap.max} days after that first time, so please choose a new one.</p>}
            <SlotPicker key={days2.from} visit={2} slots={list2} chosen={choice[2]} onChoose={(id) => choose(2, id)} error={errs['lab-slot-2']} keep={keep2} />
          </>
        ) : (
          <Callout tone="important">
            <p id="lab-slot-2" tabIndex={-1}>
              No times are open between {ukDateWords(days2.from)} and {ukDateWords(days2.to)} yet. {role(1) === 'fixed' ? <>Please look again in a few days, or {contactThem} to arrange one.</> : <>Choose another time for your first visit, or {contactThem} to arrange your visits.</>}
            </p>
          </Callout>
        )}
      </div>
    );
  };

  return (
    <LabShell kicker="Your lab visits" title={title} errors={errors} hideContinue hideBack width="wide">
      <div ref={topRef} />
      {confirmed && !planning && (
        <Callout tone="success" role="status">
          <p>
            <strong>
              {confirmed.kind === 'moved' ? 'Changed' : 'Booked'}: {confirmed.booked.length > 1 ? 'your two lab visits' : `your ${visitName(confirmed.booked[0].visit)}`}, {both(confirmed.booked)}.
            </strong>{' '}
            {confirmed.email === 'sent'
              ? `We have emailed the details and ${confirmed.booked.length > 1 ? 'calendar files' : 'a calendar file'} to ${sentTo || email.trim() || 'you'}, with a copy to the research team.`
              : 'Your booking is made, but we could not email you just now. Add your visits to your calendar below, and the team will be in touch.'}{' '}
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

      {options && standing.length > 0 && !changing && (
        <section aria-labelledby="lab-visits-title" className="mpmb-visits" id="lab-visits" tabIndex={-1}>
          <h2 className={planning ? 'mpmb-h2' : 'mpmb-sr-only'} id="lab-visits-title">
            Your visits
          </h2>
          {standing.map((b) => (
            <VisitCard key={b.bookingId} booking={b} code={state.code} />
          ))}
          {!planning && (
            <>
              <div className="mpmb-actions">
                {canMove && (
                  <Button variant="secondary" onClick={startChanging} disabled={busy}>
                    Change my times
                  </Button>
                )}
                {canCancel && (
                  <Button variant="ghost" onClick={() => setCancelling(true)} disabled={busy}>
                    Cancel {visitsWord}
                  </Button>
                )}
              </div>
              {toCome.some((b) => !b.canChange) && (
                <p className="mpmb-hint">
                  A visit less than {labBooking.changeUntilHours} hours away can no longer be changed here. To change it, {contactThem}.
                </p>
              )}
              {cancelling && (
                <Callout tone="important" role="alert">
                  <p>
                    Cancel {visitsWord}? {toCome.length > 1 ? 'Both are cancelled: taking part means coming to both, so to take part you would book both again.' : 'You can book it again afterwards, while there are times.'}
                  </p>
                  <div className="mpmb-actions">
                    <Button variant="danger" loading={busy} onClick={() => void cancel()}>
                      Yes, cancel {toCome.length > 1 ? 'them' : 'it'}
                    </Button>
                    <Button variant="ghost" onClick={() => setCancelling(false)}>
                      No, keep {toCome.length > 1 ? 'them' : 'it'}
                    </Button>
                  </div>
                </Callout>
              )}
            </>
          )}
        </section>
      )}

      {options && !planning && !standing.length && (
        <Callout tone="important">
          <p>
            <strong>You can book your lab visits once {options.missing.join(' and ')} {options.missing.length === 1 ? 'has' : 'have'} arrived.</strong> The team needs them before the first visit, so it can use the time with you.
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

      {options && planning && (
        <section aria-labelledby="lab-times" className="mpmb-booking">
          <h2 className={changing || toBook.length === 2 ? 'mpmb-sr-only' : 'mpmb-h2'} id="lab-times">
            Choose a time
          </h2>
          {toBook.length === 2 && !changing && (
            <p>
              Your first visit starts your 30-day social media break; your second, {gap.min} to {gap.max} days later, ends it. Please book both now: taking part means coming to both.
            </p>
          )}
          {changing && <p>Keep either time or choose a new one. The second visit needs to be {gap.min} to {gap.max} days after the first.</p>}
          <p className="mpmb-hint">
            At {placeLine(labBooking.location)}. Times are UK times; each visit lasts about {Math.round(labBooking.minutes / 60)} hours.
            {__PROTOTYPE__ && <span className="mpmb-draft mpmb-draft--text">{labBooking.location.draft}</span>}
          </p>
          {VISITS.filter((v) => changing || toBook.length === 2 || toBook.includes(v) || role(v) === 'fixed').map(visitBlock)}

          {anyTimes && keepContact && onFile && (
            <div className="mpmb-fields mpmb-booking__contact">
              <h3 className="mpmb-h3">How we contact you</h3>
              <p>
                We will email the {changing ? 'new times' : 'details'} to <strong>{onFile.email}</strong>, the address you gave before{onFile.smsReminders ? `, and text the mobile number ending ${onFile.mobileEnding}` : `. We have your mobile number ending ${onFile.mobileEnding} to contact you about your visits`}.
              </p>
              <Button variant="link" onClick={() => setNewAddress(true)}>
                Use a different email address or mobile number
              </Button>
            </div>
          )}
          {anyTimes && !keepContact && (
            <div className="mpmb-fields mpmb-booking__contact">
              <h3 className="mpmb-h3">How we contact you</h3>
              <TextField
                id="lab-email"
                label="Email address"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                maxLength={254}
                value={email}
                onChange={(e) => {
                  dispatch({ type: 'booking-contact', patch: { email: e.target.value } });
                  if (errs['lab-email'] && EMAIL.test(e.target.value.trim())) setErrors((x) => x.filter((f) => f.field !== 'lab-email'));
                }}
                error={errs['lab-email']}
                hint="The details and a calendar file for each visit go here. We email a reminder the day before each visit."
              />
              <TextField
                id="lab-mobile"
                label="Mobile number"
                required
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                maxLength={30}
                width="half"
                value={mobile}
                onChange={(e) => {
                  dispatch({ type: 'booking-contact', patch: { mobile: e.target.value } });
                  if (errs['lab-mobile'] && ukMobile(e.target.value)) setErrors((x) => x.filter((f) => f.field !== 'lab-mobile'));
                }}
                error={errs['lab-mobile']}
                hint="A UK mobile. The team uses it to contact you about your visits."
              />
              <CheckboxField id="lab-sms" checked={smsReminders} onChange={(checked) => dispatch({ type: 'booking-contact', patch: { smsReminders: checked } })} label="Text me reminders" hint="The day before and on the day of each visit, and a nudge for each weekly check-in during the break." />
              <p className="mpmb-hint">Used to send you your bookings and reminders, and for the research team to contact you about the study. Kept with your consent record, not with your data.{onFile ? ' We will also let the email address you gave before know that it has changed.' : ''}</p>
              {onFile?.mobileEnding && (
                <Button
                  variant="link"
                  onClick={() => {
                    setNewAddress(false);
                    setErrors((x) => x.filter((f) => f.field !== 'lab-email' && f.field !== 'lab-mobile'));
                  }}
                >
                  Keep sending to {onFile.email}
                </Button>
              )}
            </div>
          )}
          <div className="mpmb-actions">
            {anyTimes && (
              <Button variant="primary" arrow loading={busy} onClick={() => void book()}>
                {changing ? 'Save my times' : toBook.length === 2 ? 'Book both visits' : 'Book this time'}
              </Button>
            )}
            {changing && (
              <Button variant="ghost" onClick={stopChanging}>
                Keep my current times
              </Button>
            )}
            {!changing && backToSummary}
          </div>
        </section>
      )}

      {options && !planning && (standing.length > 0 || inline) && (
        <div className="mpmb-actions">
          {backToSummary}
          {!inline && standing.length > 0 && (
            <p className="mpmb-hint">
              During your break, check in each week on the <a href={labPages.checkin.path}>mid-break check-in</a>; when it ends, send your data again on the <a href={labPages.after.path}>after-break page</a>.
            </p>
          )}
        </div>
      )}
    </LabShell>
  );
}
