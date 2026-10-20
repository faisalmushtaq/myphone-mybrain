import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { announce } from '../../lib/announce';
import { formatTimestamp } from '../../lib/dates';
import { labBooking } from '../booking';
import { ukDayYear, ukHours, visitName, visitTitle } from '../calendar';
import { labPages, labStudy } from '../config';
import { labFileStore } from '../fileStore';
import { labMyStory, storySurveyUrl } from '../mystory';
import { clearLabState } from '../persistence';
import { namesOf, PlatformChecklist } from '../PlatformChecklist';
import { phaseHave, platformsToDo, readyToBook, storyTold } from '../reducer';
import { useLab } from '../store';
import { filesPhrase } from '../words';

type CopyStatus = { kind: 'idle' } | { kind: 'working' } | { kind: 'done'; fileName: string } | { kind: 'failed' };

/**
 * MyStory, next (20 October 2026): required at each phase, straight after the data before and after the break (and before
 * booking the visits), and after the check-in. A chat with Remi, or another survey if that phase is run elsewhere.
 */
function StoryCard({ code, phase, onOpen }: { code: string; phase: 'pre' | 'mid' | 'post'; onOpen: () => void }) {
  const mode = labMyStory.phases[phase];
  const url = storySurveyUrl(phase, code);
  return (
    <div className="mpmb-card mpmb-card--next mpmb-mystory">
      <p className="mpmb-kicker">Next</p>
      <h2 className="mpmb-h3">Tell {labMyStory.name} your story.</h2>
      <p>
        {phase === 'pre'
          ? 'Before you book your lab visits: a short chat with Remi about your social media use, about fifteen minutes. It is labelled with your participant ID, never your name.'
          : phase === 'post'
            ? 'A short chat with Remi about your break and how it went, about fifteen minutes. It is labelled with your participant ID, never your name.'
            : 'A short chat with Remi about your break so far, about fifteen minutes. It is labelled with your participant ID, never your name.'}
      </p>
      {mode.mode === 'link' && url ? (
        <a className="mpmb-btn mpmb-btn--primary" href={url} target="_blank" rel="noopener noreferrer">
          <span>Open {mode.name}</span>
          <span className="mpmb-btn__arrow" aria-hidden="true">
            →
          </span>
        </a>
      ) : (
        <Button variant="primary" arrow onClick={onOpen}>
          Tell my story
        </Button>
      )}
    </div>
  );
}

/** The lab visits from this page: the ones still to come, or booking them (both together) once the data is in. */
function VisitsCard({ onBook }: { onBook: () => void }) {
  const { state } = useLab();
  const gap = state.booking.options?.gap ?? labBooking.visit2AfterDays;
  const standing = state.booking.options ? state.booking.options.bookings.filter((b) => b.status === 'booked' || b.status === 'attended').map((b) => ({ visit: b.visit, start: b.start, end: b.end as string | null })) : (state.progress?.visits ?? []).filter((v) => v.status === 'booked' || v.status === 'attended').map((v) => ({ visit: v.visit, start: v.start, end: null as string | null }));
  const has = (v: 1 | 2) => standing.some((b) => b.visit === v);
  const bookBoth = !standing.length && state.flow === 'baseline' && readyToBook(state, labBooking.requires) && storyTold(state, 'pre');
  // A missed or cancelled visit leaves that one to book again.
  const missing: 1 | 2 | null = has(1) && !has(2) ? 2 : !has(1) && has(2) ? 1 : null;
  const coming = standing.filter((b) => Date.parse(b.start) > Date.now()).sort((a, b) => a.start.localeCompare(b.start));
  if (bookBoth || missing) {
    return (
      <div className="mpmb-card mpmb-card--next mpmb-visits-card">
        <p className="mpmb-kicker">Next</p>
        <h2 className="mpmb-h3">{bookBoth ? 'Book your two lab visits.' : `Book your ${visitName(missing!)}.`}</h2>
        <p>
          {bookBoth
            ? `Your data from before the break is in, so you can book your visits now, both together: the first starts your 30-day break, and the second is once the break is over, ${gap.min} to ${gap.max} days after the first. Each takes about two hours.`
            : missing === 2
              ? `Your second visit is once your 30-day break is over, ${gap.min} to ${gap.max} days after the first. Choose a time for it now, so it is in your calendar.`
              : 'Choose a new time for your first visit.'}
        </p>
        <Button variant="primary" arrow onClick={onBook}>
          {bookBoth ? 'Choose the times' : 'Choose a time'}
        </Button>
      </div>
    );
  }
  if (!coming.length) return null;
  return (
    <div className="mpmb-card mpmb-card--mist mpmb-visits-card">
      <p className="mpmb-kicker">{coming.length > 1 ? 'Your lab visits' : visitTitle(coming[0].visit)}</p>
      {coming.map((b) => (
        <p key={b.visit}>
          {coming.length > 1 && <>{visitTitle(b.visit)}: </>}
          <strong>{ukDayYear(b.start)}</strong>
          {b.end ? `, ${ukHours(b.start, b.end)}` : ''}
        </p>
      ))}
      <p>The details are in your email.</p>
      <Button variant="link" onClick={onBook}>
        See {coming.length > 1 ? 'them' : 'it'}, add {coming.length > 1 ? 'them' : 'it'} to your calendar, or change {coming.length > 1 ? 'them' : 'it'}
      </Button>
    </div>
  );
}

export function LabDone() {
  const { state, dispatch } = useLab();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [copy, setCopy] = useState<CopyStatus>({ kind: 'idle' });
  const { submission, flow } = state;
  const canCopy = flow === 'baseline' && Boolean(state.consent.completedAt && state.consent.signature);
  const have = phaseHave(state);
  const toDo = flow === 'checkin' ? [] : platformsToDo(state);
  // MyStory comes next once this page's data is in (before the break, enough to book; after it, every app), or after the check-in.
  const dataIn = flow === 'baseline' ? readyToBook(state, labBooking.requires) : flow === 'after' ? have.screenshots > 0 && !toDo.length : flow === 'checkin';
  const storyNext = dataIn && !storyTold(state, state.phase);

  useEffect(() => {
    document.title = 'Thank you – MyPhone/MyBrain';
    window.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const download = async () => {
    setCopy({ kind: 'working' });
    try {
      const { downloadLabConsentCopy } = await import('../labPdf');
      const fileName = await downloadLabConsentCopy(state);
      setCopy({ kind: 'done', fileName });
      announce(`Your copy has been saved as ${fileName}.`);
    } catch (error) {
      console.error(error);
      setCopy({ kind: 'failed' });
    }
  };

  const finish = () => {
    clearLabState();
    labFileStore.clear();
    dispatch({ type: 'reset' });
  };

  const title = flow === 'checkin' ? 'Thank you. Your check-in has been sent.' : flow === 'after' ? 'Thank you. Your after-break data is in.' : 'Thank you. Your data has been sent.';
  const when = flow === 'checkin' ? state.checkIn.sentAt : submission.lastDonationAt;
  const steps =
    flow === 'checkin'
      ? ['Carry on with your break. There is one check-in, so you have nothing more to do here.', 'If anything goes wrong with Brick or the break, contact the team; it is useful to know.', 'On the last day of your break, before you unlock your apps, take your screen-time screenshots on the after-break page; once your apps are unlocked, request your new data downloads.']
      : flow === 'after'
        ? ['Bring your phone to your second lab visit. The team will be able to see that your files have arrived.', 'If a data download arrives later, come back to this page, enter your details and add it.']
        : [
            canCopy ? 'Download a copy of your consent and keep it somewhere safe. Nothing is emailed to you.' : 'Your consent was recorded earlier; the team holds the record.',
            'Bring your phone to your first lab visit. The team will be able to see that your files have arrived.',
            'On day 15 of your break, we send you a link to your mid-break check-in; afterwards, send your data again on the after-break page. Both find you from the same details you gave today; there is nothing to sign again.',
          ];

  return (
    <div className="mpmb-step mpmb-step--wide mpmb-done">
      <div className="mpmb-done__hero">
        <span className="mpmb-done__tick" aria-hidden="true">
          <Icon name="check" size={34} />
        </span>
        <p className="mpmb-kicker">{flow === 'checkin' ? `Check-in ${state.checkIn.count || ''}`.trim() : toDo.length ? 'Sent so far' : 'All done'}</p>
        <h1 className="mpmb-h1" tabIndex={-1} ref={headingRef}>
          {title}
        </h1>
        <p className="mpmb-done__ref">
          Participant ID: <strong className="mpmb-mono">{state.code}</strong>
          {when && <span> · sent {formatTimestamp(when)}</span>}
        </p>
      </div>
      <div className="mpmb-step__body">
        {storyNext && <StoryCard code={state.code} phase={state.phase as 'pre' | 'mid' | 'post'} onOpen={() => dispatch({ type: 'go-to', stepId: 'mystory' })} />}
        <VisitsCard onBook={() => dispatch({ type: 'go-to', stepId: 'book' })} />
        {flow === 'checkin' ? null : (
          <>
            <div className="mpmb-done__why">
              <p>
                <strong>Received {flow === 'after' ? 'from after your break' : 'from before your break'}: {filesPhrase(have)}.</strong> This is the part of the study no one else can provide: what you actually did on your phone, with your own choices about what to share.
              </p>
            </div>
            <section aria-labelledby="done-apps">
              <h2 className="mpmb-h3" id="done-apps">
                Your apps
              </h2>
              <PlatformChecklist />
              <p className="mpmb-hint">{toDo.length ? `Still to do: ${namesOf(toDo)}. Come back with ${toDo.length === 1 ? 'it' : 'them'} when the download arrives, on any device, or tell us above if you don’t use ${toDo.length === 1 ? 'it' : 'them'}.` : 'Every app you use is ticked off. Thank you.'}</p>
            </section>
          </>
        )}
        <section aria-labelledby="done-next">
          <h2 className="mpmb-h3" id="done-next">
            What happens next
          </h2>
          <ol className="mpmb-next-steps" role="list">
            {steps.map((text, i) => (
              <li key={text}>
                <span aria-hidden="true">{i + 1}</span>
                <p>{text}</p>
              </li>
            ))}
          </ol>
          {flow !== 'after' && (
            <p className="mpmb-hint">
              {flow === 'baseline' ? (
                <>
                  Pages for later: <a href={labPages.checkin.path}>mid-break check-in</a> · <a href={labPages.after.path}>after your break</a>.
                </>
              ) : (
                <>
                  When the break is over: <a href={labPages.after.path}>after your break</a>.
                </>
              )}
            </p>
          )}
        </section>
        {flow === 'checkin' && (
          <p className="mpmb-hint">The team does not read check-ins straight away. If you are finding things hard and need support now, call Samaritans free, any time, on <a href="tel:116123">116 123</a>, or speak to your GP.</p>
        )}
        <div className="mpmb-card mpmb-card--mist">
          <h2 className="mpmb-h3">Changing your mind</h2>
          <p>
            You can withdraw from the study at any time, without giving a reason, by emailing {labStudy.contact.name} at <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a>. Quote your participant ID. What you have sent is kept and used unless you ask for it to be withdrawn, which you can do up to one month after your final session.
          </p>
        </div>
        <div className="mpmb-done__actions">
          {canCopy && (
            <Button variant="secondary" onClick={() => void download()} loading={copy.kind === 'working'}>
              Download a copy of my consent (PDF)
            </Button>
          )}
          {flow === 'checkin' ? null : toDo.length ? (
            <Button variant="primary" arrow onClick={() => dispatch({ type: 'go-to', stepId: 'guide' })}>
              Get my {namesOf(toDo)} data
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => dispatch({ type: 'go-to', stepId: 'screenshots' })}>
              Add more files
            </Button>
          )}
        </div>
        {copy.kind === 'done' && <p className="mpmb-hint">Saved as {copy.fileName}. It includes your name and signature, so keep it somewhere safe.</p>}
        {copy.kind === 'failed' && <p className="mpmb-hint">The copy could not be made on this device. Contact the team quoting your participant ID and they will send one.</p>}
        <p className="mpmb-hint">
          Using a shared or borrowed device?{' '}
          <Button variant="link" onClick={finish}>
            Clear my details from this device
          </Button>{' '}
          Everything you sent is already with the team. On your own phone, leave it: the check-ins and the after-break page will recognise you.
        </p>
      </div>
    </div>
  );
}
