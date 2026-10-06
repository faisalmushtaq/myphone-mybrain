import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { announce } from '../../lib/announce';
import { formatTimestamp } from '../../lib/dates';
import { labMyStory, labPages, labStudy } from '../config';
import { labFileStore } from '../fileStore';
import { clearLabState } from '../persistence';
import { phaseHave } from '../reducer';
import { useLab } from '../store';
import { filesPhrase } from '../words';

type CopyStatus = { kind: 'idle' } | { kind: 'working' } | { kind: 'done'; fileName: string } | { kind: 'failed' };

/** MyStory: a conversation in the person's own words, filed under the same participant code. Not live yet; see labMyStory in config.ts. */
function MyStoryCard({ code }: { code: string }) {
  const href = labMyStory.url ? `${labMyStory.url}${labMyStory.url.includes('?') ? '&' : '?'}${encodeURIComponent(labMyStory.codeParam)}=${encodeURIComponent(code)}` : null;
  return (
    <div className="mpmb-card mpmb-card--mist mpmb-mystory">
      <p className="mpmb-kicker">Next, if you have a few minutes</p>
      <h2 className="mpmb-h3">Tell {labMyStory.name} how it is going.</h2>
      <p>{labMyStory.name} is a short conversation about your week without social media, in your own words: what you missed, what you did instead, what surprised you. It is linked to your check-in by your participant code, never your name.</p>
      {href ? (
        <a className="mpmb-btn mpmb-btn--primary" href={href} target="_blank" rel="noopener noreferrer">
          <span>Open {labMyStory.name}</span>
          <span className="mpmb-btn__arrow" aria-hidden="true">
            →
          </span>
        </a>
      ) : (
        <p className="mpmb-hint">{labMyStory.name} is not open yet. When it is, a button here will take you straight to it, already set up with your code.</p>
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
      ? ['Carry on with your break. Check in again in about a week, on this same page.', 'If anything goes wrong with Brick or the break, contact the team; it is useful to know.', 'When the 30 days are up, send your screenshots and app data again on the after-break page.']
      : flow === 'after'
        ? ['Bring your phone to your second lab visit. The team will be able to see that your files have arrived.', 'If a data download arrives later, come back to this page with your participant code and add it.']
        : [
            canCopy ? 'Download a copy of your consent and keep it somewhere safe. Nothing is emailed to you.' : 'Your consent was recorded earlier; the team holds the record.',
            'Bring your phone to your first lab visit. The team will be able to see that your files have arrived.',
            'During your break, check in once a week on the mid-break check-in page; afterwards, send your data again on the after-break page. Both use your participant code; there is nothing to sign again.',
          ];

  return (
    <div className="mpmb-step mpmb-step--wide mpmb-done">
      <div className="mpmb-done__hero">
        <span className="mpmb-done__tick" aria-hidden="true">
          <Icon name="check" size={34} />
        </span>
        <p className="mpmb-kicker">{flow === 'checkin' ? `Check-in ${state.checkIn.count || ''}`.trim() : 'All done'}</p>
        <h1 className="mpmb-h1" tabIndex={-1} ref={headingRef}>
          {title}
        </h1>
        <p className="mpmb-done__ref">
          Participant code: <strong className="mpmb-mono">{state.code}</strong>
          {when && <span> · sent {formatTimestamp(when)}</span>}
        </p>
      </div>
      <div className="mpmb-step__body">
        {flow === 'checkin' ? (
          <MyStoryCard code={state.code} />
        ) : (
          <div className="mpmb-done__why">
            <p>
              <strong>Received {flow === 'after' ? 'from after your break' : 'from before your break'}: {filesPhrase(have)}.</strong> This is the part of the study no one else can provide: what you actually did on your phone, with your own choices about what to share.
            </p>
          </div>
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
        <div className="mpmb-card mpmb-card--mist">
          <h2 className="mpmb-h3">Changing your mind</h2>
          <p>
            You can withdraw from the study at any time, without giving a reason, by emailing {labStudy.contact.name} at <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a>. Quote your participant code. What you have sent is kept and used unless you ask for it to be withdrawn, which you can do up to one month after your final session.
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
          ) : (
            <Button variant="secondary" onClick={() => dispatch({ type: 'go-to', stepId: 'screenshots' })}>
              Add more files
            </Button>
          )}
          <Button variant="primary" onClick={finish}>
            Finish and clear this device
          </Button>
        </div>
        {copy.kind === 'done' && <p className="mpmb-hint">Saved as {copy.fileName}. It includes your name and signature, so keep it somewhere safe.</p>}
        {copy.kind === 'failed' && <p className="mpmb-hint">The copy could not be made on this device. Contact the team quoting your participant code and they will send one.</p>}
        <p className="mpmb-hint">“Finish and clear this device” removes your code and progress from this browser; everything sent is already with the team. Leave it if you will use this device for the check-ins or after your break.</p>
      </div>
    </div>
  );
}
