import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { announce } from '../../lib/announce';
import { formatTimestamp } from '../../lib/dates';
import { labStudy } from '../config';
import { labFileStore } from '../fileStore';
import { clearLabState } from '../persistence';
import { useLab } from '../store';

type CopyStatus = { kind: 'idle' } | { kind: 'working' } | { kind: 'done'; fileName: string } | { kind: 'failed' };

export function LabDone() {
  const { state, dispatch } = useLab();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [copy, setCopy] = useState<CopyStatus>({ kind: 'idle' });
  const { submission } = state;
  const canCopy = Boolean(state.consent.completedAt && state.consent.signature);

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

  return (
    <div className="mpmb-step mpmb-step--wide mpmb-done">
      <div className="mpmb-done__hero">
        <span className="mpmb-done__tick" aria-hidden="true">
          <Icon name="check" size={34} />
        </span>
        <p className="mpmb-kicker">All done</p>
        <h1 className="mpmb-h1" tabIndex={-1} ref={headingRef}>
          Thank you. Your data has been sent.
        </h1>
        <p className="mpmb-done__ref">
          Participant code: <strong className="mpmb-mono">{state.code}</strong>
          {submission.lastDonationAt && <span> · sent {formatTimestamp(submission.lastDonationAt)}</span>}
        </p>
      </div>
      <div className="mpmb-done__why">
        <p>
          <strong>
            {submission.archivesSent ? `${submission.archivesSent} cleaned ${submission.archivesSent === 1 ? 'file' : 'files'}` : ''}
            {submission.archivesSent && submission.screenshotsSent ? ' and ' : ''}
            {submission.screenshotsSent ? `${submission.screenshotsSent} ${submission.screenshotsSent === 1 ? 'screenshot' : 'screenshots'}` : ''} received{state.phase ? (state.phase === 'pre' ? ', from before your break' : ', from after your break') : ''}.
          </strong>{' '}
          This is the part of the study no one else can provide: what you actually did on your phone, in your own words and your own choices about what to share.
        </p>
      </div>
      <h2 className="mpmb-h3">What happens next</h2>
      <ol className="mpmb-next-steps" role="list">
        {[
          canCopy ? 'Download a copy of your consent and keep it somewhere safe. Nothing is emailed to you.' : 'Your consent was recorded earlier; the team holds the record.',
          'Bring your phone to your first lab visit. The team will be able to see that your files have arrived.',
          'If more data arrives later, come back here with your participant code and add it.',
        ].map((text, i) => (
          <li key={text}>
            <span aria-hidden="true">{i + 1}</span>
            <p>{text}</p>
          </li>
        ))}
      </ol>
      <div className="mpmb-card mpmb-card--mist">
        <h2 className="mpmb-h3">Changing your mind</h2>
        <p>
          You can withdraw from the study at any time, without giving a reason, by emailing {labStudy.contact.name} at <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a>. Quote your participant code. You may ask for your identifiable data to be withdrawn up to one month after your final session.
        </p>
      </div>
      <div className="mpmb-done__actions">
        {canCopy && (
          <Button variant="secondary" onClick={() => void download()} loading={copy.kind === 'working'}>
            Download a copy of my consent (PDF)
          </Button>
        )}
        <Button variant="secondary" onClick={() => dispatch({ type: 'go-to', stepId: 'clean' })}>
          Add more files
        </Button>
        <Button variant="primary" onClick={finish}>
          Finish and clear this device
        </Button>
      </div>
      {copy.kind === 'done' && <p className="mpmb-hint">Saved as {copy.fileName}. It includes your name and signature, so keep it somewhere safe.</p>}
      {copy.kind === 'failed' && <p className="mpmb-hint">The copy could not be made on this device. Contact the team quoting your participant code and they will send one.</p>}
      <p className="mpmb-hint">“Finish and clear this device” removes your code and consent details from this browser; everything sent is already with the team. Leave it if you expect to add files from this device later.</p>
    </div>
  );
}
