import { useEffect, useRef, useState } from 'react';
import { CarryOnLink } from '../components/CarryOnLink';
import { ConsentSummary } from '../components/ConsentSummary';
import { Button } from '../components/ui/Button';
import { Disclosure } from '../components/ui/Disclosure';
import { Draft } from '../components/ui/Draft';
import { Icon } from '../components/ui/Icon';
import { thankYou } from '../config/copy';
import { study } from '../config/study';
import { announce } from '../lib/announce';
import { formatTimestamp } from '../lib/dates';
import { forgetFinishReference, takeEntryLink } from '../lib/entryLink';
import { parentInvolved, phoneSourceOf } from '../model/journey';
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
  const childName = state.identity.firstName.trim() || 'the young person';
  const { submission } = state;
  const sentImages = state.donation.images.filter((i) => i.status === 'sent').length;

  useEffect(() => {
    document.title = 'Thank you – MyPhone/MyBrain';
    window.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  // The next person on the device starts from the welcome screen, whatever link this one came in by.
  const finish = () => {
    takeEntryLink();
    forgetFinishReference();
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

  // Carrying on later: a short thank-you for what was added; the record itself was sent before.
  if (state.resume) {
    const resume = state.resume;
    const said = resume.canAgree ? state.assent.status : null;
    const own = state.route === 'young';
    return (
      <div className="mpmb-step mpmb-step--wide mpmb-done">
        <div className="mpmb-done__hero">
          <span className="mpmb-done__tick" aria-hidden="true">
            <Icon name="check" size={34} />
          </span>
          <p className="mpmb-kicker">All done</p>
          <h1 className="mpmb-h1" tabIndex={-1} ref={headingRef}>
            {said === 'declined' ? 'Thanks for telling us.' : thankYou.heading}
          </h1>
          <p className="mpmb-done__ref">
            Added to reference <strong>{resume.referenceCode}</strong>
          </p>
        </div>
        <div className="mpmb-done__why">
          {said === 'declined' ? (
            <p>{own ? 'Nothing from your phone will be shared, and that is completely fine. Nobody will ask why.' : `Nothing from ${childName}’s phone will be shared.`}</p>
          ) : sentImages > 0 ? (
            <p>
              <strong>
                {sentImages === 1 ? 'One screenshot was' : `${sentImages} screenshots were`} added to the record. Thank you.
              </strong>
            </p>
          ) : (
            <p>
              {said === 'completed' ? `${own ? 'Your' : `${childName}’s`} answer is saved. ` : ''}No screenshots were added this time. You can come back with the same reference and date of birth at any time, before or after the workshop.
            </p>
          )}
          <p>There is nothing to do for the workshop at school: it is separate from this form. To change your mind about anything, email <a href={`mailto:${study.contact.email}`}>{study.contact.email}</a> quoting the reference.</p>
        </div>
        <div className="mpmb-done__actions">
          <Button variant="primary" onClick={finish}>
            Finish and clear this device
          </Button>
        </div>
        <p className="mpmb-hint">This screen clears itself after 10 minutes without activity.</p>
      </div>
    );
  }

  // The young person chose to decide later: nothing from their phone was sent.
  const later = state.assent.status === 'deferred' && state.assent.deferredBy === 'young';
  const youngHolding = state.route === 'young';
  const withParent = parentInvolved(state);
  const source = phoneSourceOf(state);
  const steps: string[] = [];
  steps.push(
    !withParent
      ? 'Keep a copy of what you agreed to: tap “Download a copy”, or take a screenshot of this page. We do not email it to you.'
      : youngHolding
        ? 'Give your parent or carer a copy of what you both agreed to: tap “Download a copy” and send it to them, or take a screenshot of this page. We do not email it.'
        : 'Keep a copy of what you agreed to: tap “Download a copy”, or take a screenshot of this page. We do not email it to you.',
  );
  // What can still be added later, with the reference: the young person's part when it was put off, or the screenshots.
  const partLater = source === 'child' && state.assent.status === 'deferred';
  const shotsLater = (source === 'parent' || (source === 'child' && state.assent.status === 'completed')) && sentImages === 0;
  if (partLater) steps.push(`${later ? `${childName} wanted to decide later.` : `${childName} can do their part later.`} Nothing from ${childName}’s phone has been sent. When they are ready, before or after the workshop, they can say yes or no, and share their screen time if they want to, with the link below and their date of birth.`);
  if (shotsLater) steps.push(`No screenshots were added. To add them later, before or after the workshop, use the link below with ${childName}’s date of birth.`);
  steps.push('There is nothing to do for the workshop at school: it is separate from this form.');

  return (
    <div className="mpmb-step mpmb-step--wide mpmb-done">
      <div className="mpmb-done__hero">
        <span className="mpmb-done__tick" aria-hidden="true">
          <Icon name="check" size={34} />
        </span>
        <p className="mpmb-kicker">{later ? 'Saved' : 'All done'}</p>
        <h1 className="mpmb-h1" tabIndex={-1} ref={headingRef}>
          {later ? 'Thanks. You can decide later.' : thankYou.heading}
        </h1>
        {submission.referenceCode && (
          <p className="mpmb-done__ref">
            Your reference: <strong>{submission.referenceCode}</strong>
            {submission.consentSentAt && <span> · recorded {formatTimestamp(submission.consentSentAt)}</span>}
          </p>
        )}
      </div>

      {youngHolding && (
        <div className="mpmb-card mpmb-card--mist">
          <h2 className="mpmb-h3">For you, {state.identity.firstName.trim() || 'the young person'}</h2>
          <ul className="mpmb-list">
            <li>You can still change your mind about your screenshots. Just tell the researcher or your teacher, or email the team at {study.contact.email}. You don’t have to say why.</li>
            <li>If the workshop at school is still to come, the researchers will explain it again on the day.</li>
          </ul>
        </div>
      )}
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

      {(partLater || shotsLater) && submission.referenceCode && <CarryOnLink referenceCode={submission.referenceCode} childName={childName} />}

      <div className="mpmb-card mpmb-card--mist">
        <h2 className="mpmb-h3">Changing your mind</h2>
        <p>
          You can change your mind at any time, about the screenshots or the answers, by emailing <a href={`mailto:${study.contact.email}`}>{study.contact.email}</a>. Quote your reference if you have it. Nobody will ask why.
        </p>
        {study.contact.concerns.email && (
          <p>
            If you have a concern about how the study is being run and would rather not raise it with the research team, contact {study.contact.concerns.name} at{' '}
            <a href={`mailto:${study.contact.concerns.email}`}>{study.contact.concerns.email}</a>, who are independent of the study.
          </p>
        )}
      </div>

      <Disclosure summary="See what was recorded">
        <ConsentSummary detailed />
      </Disclosure>

      <div className="mpmb-done__actions">
        <Button variant="primary" onClick={download} loading={copy.kind === 'working'}>
          Download a copy (PDF)
        </Button>
        <Button variant="secondary" onClick={finish}>
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
