import { useEffect, useRef, useState } from 'react';
import { ConsentSummary } from '../components/ConsentSummary';
import { Button } from '../components/ui/Button';
import { Disclosure } from '../components/ui/Disclosure';
import { Draft } from '../components/ui/Draft';
import { Icon } from '../components/ui/Icon';
import { thankYou } from '../config/copy';
import { study } from '../config/study';
import { announce } from '../lib/announce';
import { formatTimestamp } from '../lib/dates';
import { useStore } from '../state/context';
import { clearState } from '../state/persistence';

type CopyStatus = { kind: 'idle' } | { kind: 'working' } | { kind: 'done'; fileName: string } | { kind: 'failed' };

/**
 * The thank-you screen: why taking part matters, the reference, what happens
 * next, a copy of the record to download, how to withdraw, and a way to clear
 * the device. Everything has already been sent by the time this is shown.
 * Nothing is emailed to families; the downloaded PDF is their copy.
 */
export function Done() {
  const { state, dispatch } = useStore();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [copy, setCopy] = useState<CopyStatus>({ kind: 'idle' });
  const declined = state.assent.status === 'declined';
  const childName = state.identity.firstName.trim() || 'the young person';
  const { submission } = state;
  const sentImages = state.donation.images.filter((i) => i.status === 'sent').length;

  useEffect(() => {
    document.title = 'Thank you – MyPhone/MyBrain';
    window.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const finish = () => {
    clearState();
    dispatch({ type: 'reset' });
  };

  /** Builds the PDF on the device (the code for it is only fetched when asked for) and hands it to the browser to save. */
  const download = async () => {
    setCopy({ kind: 'working' });
    try {
      const { downloadConsentCopy } = await import('../lib/consentPdf');
      const fileName = await downloadConsentCopy(state);
      setCopy({ kind: 'done', fileName });
      announce(`Your copy has been saved as ${fileName}.`);
    } catch (error) {
      console.error(error);
      setCopy({ kind: 'failed' });
      announce('The copy could not be made on this device.');
    }
  };

  const steps: string[] = [];
  if (!declined) {
    steps.push('Download a copy of what you agreed to and keep it somewhere safe. Nothing is emailed to you.');
    if (state.assent.status === 'deferred') steps.push(state.assent.deferredBy === 'young' ? `${childName} wanted to decide later. The team will ask again, for example at school.` : `The team will ask ${childName} for their own agreement separately, for example at school.`);
    if (state.assent.status === 'completed' && sentImages === 0) steps.push('No screenshots were added this time. The team can send a link to add them later — it takes about a minute and it really helps.');
    steps.push('The team will be in touch about the next parts of the study, such as the surveys and the school session.');
  }

  return (
    <div className="mpmb-step mpmb-step--wide mpmb-done">
      <div className="mpmb-done__hero">
        <span className="mpmb-done__tick" aria-hidden="true">
          <Icon name="check" size={34} />
        </span>
        <p className="mpmb-kicker">{declined ? 'Recorded' : 'All done'}</p>
        <h1 className="mpmb-h1" tabIndex={-1} ref={headingRef}>
          {declined ? 'Thank you for letting us know.' : thankYou.heading}
        </h1>
        {submission.referenceCode && (
          <p className="mpmb-done__ref">
            Your reference: <strong>{submission.referenceCode}</strong>
            {submission.consentSentAt && <span> · recorded {formatTimestamp(submission.consentSentAt)}</span>}
          </p>
        )}
      </div>

      {declined ? (
        <p className="mpmb-lead">{childName} will not be included in the study. If anyone changes their mind, contact the team using the details below.</p>
      ) : (
        <>
          <div className="mpmb-done__why">
            <h2 className="mpmb-h3">
              Why this matters {thankYou.draft && <Draft />}
            </h2>
            {thankYou.why.map((p) => (
              <p key={p}>{p}</p>
            ))}
            {sentImages > 0 && (
              <p>
                <strong>
                  {childName} shared {sentImages === 1 ? 'one screenshot' : `${sentImages} screenshots`}. Thank you.
                </strong>
              </p>
            )}
          </div>

          <h2 className="mpmb-h3">What happens next</h2>
          <ol className="mpmb-next-steps" role="list">
            {steps.map((text, i) => (
              <li key={text}>
                <span aria-hidden="true">{i + 1}</span>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </>
      )}

      <div className="mpmb-card mpmb-card--mist">
        <h2 className="mpmb-h3">Changing your mind</h2>
        <p>
          You can stop at any time, from the whole study or from one part such as linking to health or school records, by emailing <a href={`mailto:${study.contact.email}`}>{study.contact.email}</a>.
          Quote your reference if you have it. Nobody will ask why.
        </p>
        <p>
          If you have a concern about how the study is being run and would rather not raise it with the research team, contact {study.contact.concerns.name} at{' '}
          <a href={`mailto:${study.contact.concerns.email}`}>{study.contact.concerns.email}</a>, who are independent of the study.
        </p>
      </div>

      {!declined && (
        <Disclosure summary="See what was recorded">
          <ConsentSummary detailed />
        </Disclosure>
      )}

      <div className="mpmb-done__actions">
        {!declined && (
          <Button variant="secondary" onClick={download} loading={copy.kind === 'working'}>
            Download a copy (PDF)
          </Button>
        )}
        <Button variant="primary" onClick={finish}>
          Finish and clear this device
        </Button>
      </div>
      {copy.kind === 'done' && <p className="mpmb-hint">Saved as {copy.fileName}. It includes personal details, so keep it somewhere safe.</p>}
      {copy.kind === 'failed' && <p className="mpmb-hint">The copy could not be made on this device. You can print this page instead, or contact the team quoting your reference.</p>}
      <p className="mpmb-hint">
        “Finish and clear this device” removes the answers from this phone or computer; the record has already been sent. This screen clears itself after 10 minutes without activity.
      </p>
    </div>
  );
}
