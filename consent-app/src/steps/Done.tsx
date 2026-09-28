import { useEffect, useRef } from 'react';
import { ConsentSummary } from '../components/ConsentSummary';
import { Button } from '../components/ui/Button';
import { Disclosure } from '../components/ui/Disclosure';
import { Icon } from '../components/ui/Icon';
import { study } from '../config/study';
import { formatTimestamp } from '../lib/dates';
import { useStore } from '../state/context';
import { clearState } from '../state/persistence';

/** Confirmation: reference code, what happens next, how to withdraw, and a way to clear the device. */
export function Done() {
  const { state, dispatch } = useStore();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const declined = state.assent.status === 'declined';
  const childName = state.identity.firstName.trim() || 'the young person';

  useEffect(() => {
    document.title = 'Thank you – MyPhone/MyBrain';
    window.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const finish = () => {
    clearState();
    dispatch({ type: 'reset' });
  };

  const steps: string[] = [];
  if (!declined) {
    steps.push(`A copy of the consent summary is emailed to ${state.guardian.email || 'the parent or guardian'}. Keep it somewhere safe.`);
    if (state.assent.status === 'deferred') steps.push(`The team will ask ${childName} for their own agreement separately, for example at school, before any phone-use information is requested.`);
    if (state.donation.status === 'skipped') steps.push('You skipped the phone-use part for now. The team can send a link to add it later.');
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
          {declined ? 'Thank you for letting us know.' : 'Thank you. Everything has been sent.'}
        </h1>
        {state.submission.referenceCode && (
          <p className="mpmb-done__ref">
            Your reference: <strong>{state.submission.referenceCode}</strong>
            {state.submission.receivedAt && <span> · received {formatTimestamp(state.submission.receivedAt)}</span>}
          </p>
        )}
      </div>

      {declined ? (
        <p className="mpmb-lead">{childName} will not be included in the study. If anyone changes their mind, contact the team using the details below.</p>
      ) : (
        <>
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
        {!__STANDALONE__ && (
          <Button variant="secondary" onClick={() => window.print()}>
            Print or save a copy
          </Button>
        )}
        <Button variant="primary" onClick={finish}>
          Finish and clear this device
        </Button>
      </div>
      <p className="mpmb-hint">
        “Finish and clear this device” removes the answers from this phone or computer; the record has already been sent. If you print, use a printer you trust, because the copy includes personal
        details. This screen clears itself after 10 minutes without activity.
      </p>
    </div>
  );
}
