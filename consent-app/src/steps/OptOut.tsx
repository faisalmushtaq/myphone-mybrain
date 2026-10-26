import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { schoolFromLink } from '../config/schools';
import { study } from '../config/study';
import { takeEntryLink } from '../lib/entryLink';
import { useStore } from '../state/context';

type Stage = 'first' | 'choose' | 'second' | 'email';
/** What the parent wants (19 October 2026): out of the workshop and the study, or in the workshop with the data not used. */
type Kind = 'workshop-and-data' | 'data-only';

/** The email to the team, ready to fill in, saying which kind, with the school already in when the page came from a school's link. */
function mailtoLink(kind: Kind): string {
  const school = schoolFromLink();
  const body = [
    kind === 'data-only'
      ? 'My child can take part in the MyPhone/MyBrain workshop at school, but please do not keep or use any of their information for the study, and do not link it with their records.'
      : 'Please opt my child out of the MyPhone/MyBrain workshop at school and out of the study: none of their information is to be used.',
    '',
    'My child’s full name: ',
    `Their school: ${school?.name ?? ''}`,
    'Their class or year group: ',
    'My name: ',
    'I am their (parent or carer): ',
  ].join('\n');
  return `mailto:${study.optOut.email}?subject=${encodeURIComponent(study.optOut.subjects[kind])}&body=${encodeURIComponent(body)}`;
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
  const [kind, setKind] = useState<Kind | null>(null);
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
            <p className="mpmb-lead">You can opt your child out of the whole study, or let them take part in the workshop with their class while none of their information is used.</p>
            <p>In the workshop, young people learn how the brain works and wear a lightweight headset that records brain activity (EEG) while they do simple tasks on a computer. It doesn’t hurt, two researchers are there throughout, and your child can still say no or stop at any time on the day.</p>
            <p>Either way, nothing about your child is linked with health or school records for the study.</p>
            <Callout tone="info">
              <p>
                <strong>Only worried about the phone part?</strong> You don’t need to opt out for that. Sharing screen time is separate and optional: if you would rather not, simply don’t fill in the form on this website.
              </p>
            </Callout>
            <div className="mpmb-actions">
              <Button variant="primary" onClick={stay}>
                Keep my child in the workshop
              </Button>
              <Button variant="secondary" onClick={() => setStage('choose')}>
                I still want to opt out
              </Button>
            </div>
            <p className="mpmb-hint">
              Questions first? Read the <a href={`${study.contact.informationSheetUrl}#taking-part`}>information sheet</a>, which explains how taking part and opting out work.
            </p>
          </div>
        </>
      )}
      {stage === 'choose' && (
        <>
          {heading('What would you like?')}
          <div className="mpmb-step__body">
            <fieldset className="mpmb-choice mpmb-choice--stack">
              <legend className="mpmb-sr-only">What would you like?</legend>
              <div className="mpmb-choice__options">
                {(
                  [
                    ['data-only', 'My child takes part in the workshop, but their information is not used', 'They join in with their class as normal. Nothing recorded about them in the workshop is kept or used for the study, and nothing is linked with their school or health records.'],
                    ['workshop-and-data', 'My child does not take part in the workshop, and none of their information is used', 'They do something else at school while their class does the workshop. Nothing about them is used in the study or linked with their records.'],
                  ] as [Kind, string, string][]
                ).map(([value, label, hint]) => (
                  <label key={value} className={`mpmb-choice__option${kind === value ? ' is-selected' : ''}`} htmlFor={`optout-kind-${value}`}>
                    <input id={`optout-kind-${value}`} type="radio" name="optout-kind" className="mpmb-choice__input" checked={kind === value} onChange={() => setKind(value)} />
                    <span className="mpmb-choice__dot" aria-hidden="true" />
                    <span>
                      <strong>{label}</strong>
                      <span className="mpmb-hint" style={{ display: 'block' }}>
                        {hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="mpmb-actions">
              <Button variant="primary" onClick={stay}>
                Keep my child in the workshop and the study
              </Button>
              <Button variant="secondary" disabled={!kind} onClick={() => setStage('second')}>
                Continue
              </Button>
            </div>
          </div>
        </>
      )}
      {stage === 'second' && (
        <>
          {heading('Are you sure?')}
          <div className="mpmb-step__body">
            {kind === 'data-only' ? (
              <>
                <p className="mpmb-lead">Your child will take part in the workshop with their class, but none of their information will be kept or used in the study.</p>
                <p>If the workshop has already happened at their school, their information is withdrawn from the study, as far as that is still possible.</p>
              </>
            ) : (
              <>
                <p className="mpmb-lead">Your child will not take part in the workshop with their class, and none of their information will be used in the study.</p>
                <p>If the workshop has already happened at their school, opting out withdraws your child’s information from the study too, as far as that is still possible.</p>
              </>
            )}
            <div className="mpmb-actions">
              <Button variant="primary" onClick={stay}>
                Keep my child in the workshop
              </Button>
              <Button variant="secondary" onClick={() => setStage('email')}>
                {kind === 'data-only' ? 'Yes, don’t use their information' : 'Yes, opt my child out'}
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
              Email {study.optOut.name} at <strong>{study.optOut.email}</strong>, from your own email address, with:
            </p>
            <ul className="mpmb-list">
              <li>{kind === 'data-only' ? 'that your child can take part in the workshop, but their information is not to be used;' : 'that you are opting your child out of the workshop and the study;'}</li>
              <li>your child’s full name;</li>
              <li>their school, and their class or year group;</li>
              <li>your name, and that you are their parent or carer.</li>
            </ul>
            <div className="mpmb-actions">
              <a className="mpmb-btn mpmb-btn--primary" href={mailtoLink(kind ?? 'workshop-and-data')}>
                <span>Write the email</span>
              </a>
              <Button variant="secondary" onClick={() => void copy()}>
                {copied ? 'Address copied' : 'Copy the address'}
              </Button>
            </div>
            {copied === false && <p className="mpmb-hint">Copying did not work on this device: the address is {study.optOut.email}.</p>}
            <p>We reply to confirm. Only a parent or carer can opt a child out.</p>
            <p className="mpmb-hint">
              Changed your mind? You don’t need to do anything: your child stays in the workshop and the study.{' '}
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
