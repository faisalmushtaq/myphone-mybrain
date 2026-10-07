import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { schoolFromLink } from '../config/schools';
import { study } from '../config/study';
import { takeEntryLink } from '../lib/entryLink';
import { useStore } from '../state/context';

type Stage = 'first' | 'second' | 'email';

/** The email to the team, ready to fill in, with the school already in when the page came from a school's link. */
function mailtoLink(): string {
  const school = schoolFromLink();
  const body = [
    'Please opt my child out of the MyPhone/MyBrain workshop at school.',
    '',
    'My child’s full name: ',
    `Their school: ${school?.name ?? ''}`,
    'Their class or year group: ',
    'My name: ',
    'I am their (parent or carer): ',
  ].join('\n');
  return `mailto:${study.optOut.email}?subject=${encodeURIComponent(study.optOut.subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Opting a young person out of the workshop at school (and so out of the
 * study, record linkage included), for parents and carers. Deliberately not
 * one click (decided 7 October 2026): two warnings saying what the young
 * person will miss, then how to email the team. No form, nothing recorded
 * here; the team logs each email on the staff page.
 */
export function OptOut() {
  const { dispatch } = useStore();
  const [stage, setStage] = useState<Stage>('first');
  const [copied, setCopied] = useState<boolean | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = 'Opting out of the workshop – MyPhone/MyBrain';
    window.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [stage]);

  // Back to the start: any ?optout=1 still in the address is dropped, so the welcome screen does not send them straight back here.
  const stay = () => {
    takeEntryLink();
    dispatch({ type: 'go-to', stepId: 'welcome', returnTo: null });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(study.optOut.email);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const heading = (text: string) => (
    <h1 className="mpmb-h1" tabIndex={-1} ref={headingRef}>
      {text}
    </h1>
  );

  return (
    <div className="mpmb-step mpmb-optout">
      <p className="mpmb-kicker">For parents and carers</p>
      {stage === 'first' && (
        <>
          {heading('Before you opt out.')}
          <div className="mpmb-step__body">
            <p className="mpmb-lead">If you opt your child out, they will not take part in the MyPhone/MyBrain workshop when it comes to their school.</p>
            <p>In the workshop, young people wear a lightweight headset that records brain activity (EEG) while they do simple tasks on a computer. It doesn’t hurt, two researchers are there throughout, and your child can still say no or stop at any time on the day.</p>
            <p>Opting out also means that nothing about your child is linked with health or school records for the study.</p>
            <Callout tone="info">
              <p>
                <strong>Only worried about the phone part?</strong> You don’t need to opt out for that. Sharing screen time is separate and optional: if you would rather not, simply don’t fill in the form on this website.
              </p>
            </Callout>
            <div className="mpmb-actions">
              <Button variant="primary" onClick={stay}>
                Keep my child in the workshop
              </Button>
              <Button variant="secondary" onClick={() => setStage('second')}>
                I still want to opt out
              </Button>
            </div>
            <p className="mpmb-hint">
              Questions first? Read the <a href={`${study.contact.informationSheetUrl}#taking-part`}>information sheet</a>, which explains how taking part and opting out work.
            </p>
          </div>
        </>
      )}
      {stage === 'second' && (
        <>
          {heading('Are you sure?')}
          <div className="mpmb-step__body">
            <p className="mpmb-lead">Your child will not take part in the workshop with their class, and none of their information will be used in the study.</p>
            <p>If the workshop has already happened at their school, opting out withdraws your child’s information from the study too, as far as that is still possible.</p>
            <div className="mpmb-actions">
              <Button variant="primary" onClick={stay}>
                Keep my child in the workshop
              </Button>
              <Button variant="secondary" onClick={() => setStage('email')}>
                Yes, opt my child out
              </Button>
            </div>
          </div>
        </>
      )}
      {stage === 'email' && (
        <>
          {heading('How to opt out.')}
          <div className="mpmb-step__body">
            <p className="mpmb-lead">
              Email us at <strong>{study.optOut.email}</strong>, from your own email address, with:
            </p>
            <ul className="mpmb-list">
              <li>your child’s full name;</li>
              <li>their school, and their class or year group;</li>
              <li>your name, and that you are their parent or carer.</li>
            </ul>
            <div className="mpmb-actions">
              <a className="mpmb-btn mpmb-btn--primary" href={mailtoLink()}>
                <span>Write the email</span>
              </a>
              <Button variant="secondary" onClick={() => void copy()}>
                {copied ? 'Address copied' : 'Copy the address'}
              </Button>
            </div>
            {copied === false && <p className="mpmb-hint">Copying did not work on this device: the address is {study.optOut.email}.</p>}
            <p>We reply to confirm. Only a parent or carer can opt a child out.</p>
            <p className="mpmb-hint">
              Changed your mind? You don’t need to do anything: your child stays in the workshop.{' '}
              <Button variant="link" onClick={stay}>
                Back to the start
              </Button>
            </p>
          </div>
        </>
      )}
    </div>
  );
}
