import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { announce } from '../../lib/announce';
import { formatTimestamp } from '../../lib/dates';
import { labBooking } from '../booking';
import { ukDayYear, ukHours, visitName, visitTitle } from '../calendar';
import { labPages, labStudy } from '../config';
import { labFileStore } from '../fileStore';
import { labMyStory, storySurveyUrl, type StoryPhase } from '../mystory';
import { clearLabState } from '../persistence';
import { namesOf, PlatformChecklist } from '../PlatformChecklist';
import { phaseHave, platformsToDo, readyToBook } from '../reducer';
import { useLab } from '../store';
import { filesPhrase } from '../words';

type CopyStatus = { kind: 'idle' } | { kind: 'working' } | { kind: 'done'; fileName: string } | { kind: 'failed' };

const STORY_WORDS: Record<StoryPhase, string> = {
  pre: 'A few minutes, in your own words: a moment with your phone, before your break.',
  mid: 'A few minutes, in your own words: a moment from your week without social media.',
  post: 'A few minutes, in your own words: looking back on your break.',
};

/** MyStory, offered after each page's main part: this site's own form or another survey, filed under the same participant ID. */
function StoryCard({ phase, code, sent, onOpen }: { phase: StoryPhase; code: string; sent: number; onOpen: () => void }) {
  const mode = labMyStory.phases[phase];
  const url = storySurveyUrl(phase, code);
  return (
    <div className="mpmb-card mpmb-card--mist mpmb-mystory">
      <p className="mpmb-kicker">{sent ? 'Thank you for your story' : 'If you have a few minutes'}</p>
      <h2 className="mpmb-h3">{sent ? `Another story for ${labMyStory.name}?` : `Tell ${labMyStory.name} your story.`}</h2>
      <p>{STORY_WORDS[phase]} Then a few quick questions about it. It is labelled with your participant ID, never your name. Optional.</p>
      {mode.mode === 'link' && url ? (
        <a className="mpmb-btn mpmb-btn--secondary" href={url} target="_blank" rel="noopener noreferrer">
          <span>Open {mode.name}</span>
          <span className="mpmb-btn__arrow" aria-hidden="true">
            →
          </span>
        </a>
      ) : (
        <Button variant="secondary" arrow onClick={onOpen}>
          {sent ? 'Tell another story' : 'Tell my story'}
        </Button>
      )}
    </div>
  );
}

/** The lab visits from this page: booked ones with their time, or the next one to book once it can be. */
function VisitsCard({ onBook }: { onBook: () => void }) {
  const { state } = useLab();
  const booked = state.booking.options ? state.booking.options.bookings.filter((b) => b.status === 'booked' || b.status === 'attended').map((b) => ({ visit: b.visit, start: b.start, end: b.end })) : (state.progress?.visits ?? []).map((v) => ({ visit: v.visit, start: v.start, end: null as string | null }));
  const first = booked.find((b) => b.visit === 1);
  const second = booked.find((b) => b.visit === 2);
  const wanted: 1 | 2 | null = state.flow === 'baseline' ? (first ? null : readyToBook(state, labBooking.requires) ? 1 : null) : first && !second ? 2 : null;
  const shown = state.flow === 'baseline' ? first : (second ?? null);
  if (!wanted && !shown) return null;
  return (
    <div className={`mpmb-card${wanted ? ' mpmb-card--next' : ' mpmb-card--mist'} mpmb-visits-card`}>
      {wanted ? (
        <>
          <p className="mpmb-kicker">Next</p>
          <h2 className="mpmb-h3">Book your {visitName(wanted)}.</h2>
          <p>{wanted === 1 ? 'Your data from before the break is in, so you can choose a time for your first visit now. It takes about two hours, and your 30-day break starts after it.' : 'Your second visit ends your 30-day break. Choose a time for it now, so it is in your calendar.'}</p>
          <Button variant="primary" arrow onClick={onBook}>
            Choose a time
          </Button>
        </>
      ) : (
        shown && (
          <>
            <p className="mpmb-kicker">{visitTitle(shown.visit)}</p>
            <p>
              <strong>{ukDayYear(shown.start)}</strong>
              {shown.end ? `, ${ukHours(shown.start, shown.end)}` : ''}. The details are in your email.
            </p>
            <Button variant="link" onClick={onBook}>
              See it, add it to your calendar, or change it
            </Button>
          </>
        )
      )}
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
      ? ['Carry on with your break. Check in again in about a week, on this same page.', 'If anything goes wrong with Brick or the break, contact the team; it is useful to know.', 'On the last day of your break, before you unlock your apps, take your screen-time screenshots on the after-break page; once your apps are unlocked, request your new data downloads.']
      : flow === 'after'
        ? ['Bring your phone to your second lab visit. The team will be able to see that your files have arrived.', 'If a data download arrives later, come back to this page, enter your details and add it.']
        : [
            canCopy ? 'Download a copy of your consent and keep it somewhere safe. Nothing is emailed to you.' : 'Your consent was recorded earlier; the team holds the record.',
            'Bring your phone to your first lab visit. The team will be able to see that your files have arrived.',
            'During your break, check in once a week on the mid-break check-in page; afterwards, send your data again on the after-break page. Both find you from the same details you gave today; there is nothing to sign again.',
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
        <VisitsCard onBook={() => dispatch({ type: 'go-to', stepId: 'book' })} />
        {flow === 'checkin' ? (
          <StoryCard phase="mid" code={state.code} sent={state.story.sent.length} onOpen={() => dispatch({ type: 'go-to', stepId: 'mystory' })} />
        ) : (
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
            {(flow === 'baseline' || flow === 'after') && <StoryCard phase={flow === 'after' ? 'post' : 'pre'} code={state.code} sent={state.story.sent.length} onOpen={() => dispatch({ type: 'go-to', stepId: 'mystory' })} />}
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
          {flow === 'checkin' ? (
            <Button variant="secondary" onClick={() => dispatch({ type: 'checkin-new' })}>
              Start another check-in
            </Button>
          ) : toDo.length ? (
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
