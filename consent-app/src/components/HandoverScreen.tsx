import { useEffect, useRef, useState } from 'react';
import { study } from '../config/study';
import { stepDefs } from '../model/journey';
import { useStore } from '../state/context';
import { ParentLinkPanel } from './ParentLink';
import { Button } from './ui/Button';
import { Icon } from './ui/Icon';

/**
 * Full-width panel shown whenever the device needs to change hands. The
 * wording is addressed to the person who is about to receive the device, and
 * the primary button is worded from their perspective.
 */
export function HandoverScreen() {
  const { state, dispatch } = useStore();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [noParent, setNoParent] = useState(false);
  const handover = state.handover;

  useEffect(() => {
    document.title = 'Pass the phone – MyPhone/MyBrain';
    window.scrollTo({ top: 0, behavior: 'auto' });
    headingRef.current?.focus({ preventScroll: true });
  }, [handover]);

  if (!handover) return null;

  const childName = state.identity.firstName.trim() || 'the young person';
  const toParent = handover.to === 'parent';
  const phase = stepDefs[handover.nextStep].phase;
  const firstTime = handover.nextStep === 'child-assent' && !state.assent.completedAt && state.assent.status !== 'declined';
  const parentRouteChoice = state.route === 'parent' && !toParent && study.allowDeferredAssent && firstTime;

  return (
    <section className={`mpmb-handover mpmb-handover--${handover.to}`} aria-labelledby="mpmb-handover-title">
      <div className="mpmb-handover__icon" aria-hidden="true">
        <Icon name="hand" size={44} />
        <Icon name="phone" size={44} />
      </div>
      <p className="mpmb-kicker mpmb-kicker--onhandover">Pass the phone</p>
      <h1 className="mpmb-h1 mpmb-handover__title" id="mpmb-handover-title" tabIndex={-1} ref={headingRef}>
        {toParent ? 'Please ask your parent or guardian to complete the next part.' : `Please pass this to ${childName}.`}
      </h1>

      {toParent ? (
        <div className="mpmb-handover__body">
          {phase === 'details' || handover.nextStep === 'parent-details' ? (
            <p>
              <strong>For the parent or guardian:</strong> {childName} has started the MyPhone/MyBrain form. The next part asks for your details and your permission. It takes about three minutes.
            </p>
          ) : (
            <p>
              <strong>For the parent or guardian:</strong> the next part is your section — the information and your permission for {childName} to take part.
            </p>
          )}
          <p>You will be asked to tick each permission separately and to sign with your finger.</p>
          {state.route === 'young' && !noParent && (
            <p className="mpmb-handover__note">
              <strong>For {childName}:</strong> not with your parent or carer now? Please don’t fill in their part for them: tap “My parent or carer isn’t here”.
            </p>
          )}
          {state.route === 'young' && noParent && <ParentLinkPanel tone="dark" />}
        </div>
      ) : (
        <div className="mpmb-handover__body">
          {firstTime ? (
            <>
              <p>
                <strong>For {childName}:</strong> your parent or guardian has given their permission. Because you are under 18, research rules need their permission as well as yours — but your
                answer still counts, and you can say no even though they said yes.
              </p>
              <p>Signing your name means yes. Saying no won’t change anything at school.</p>
              <p className="mpmb-handover__note">
                <strong>For the parent or guardian:</strong> please let {childName} read and answer this part themselves.
              </p>
            </>
          ) : (
            <p>
              <strong>For {childName}:</strong> the next part is your section, so please read and answer it yourself.
            </p>
          )}
        </div>
      )}

      <div className="mpmb-handover__actions">
        <Button variant="primary" arrow onClick={() => dispatch({ type: 'confirm-handover' })}>
          {toParent ? 'I’m the parent or guardian — continue' : `I’m ${childName} — continue`}
        </Button>
        {toParent && state.route === 'young' && !noParent && (
          <Button variant="ghost" onClick={() => setNoParent(true)}>
            My parent or carer isn’t here
          </Button>
        )}
        {parentRouteChoice && (
          <>
            <Button
              variant="ghost"
              onClick={() => {
                dispatch({ type: 'set-child-present', present: false });
                dispatch({ type: 'cancel-handover' });
                dispatch({ type: 'next' });
              }}
            >
              {childName} isn’t here right now
            </Button>
            <p className="mpmb-handover__note">
              {study.screenshotsWaitForAssent
                ? `If ${childName} isn’t with you, we will ask for their agreement separately, for example at school. The phone-use part will wait until then.`
                : `If ${childName} isn’t with you, you can carry on and complete the rest yourself — including the screenshots, if you have their phone. We will ask ${childName} for their own agreement separately, for example at school.`}
            </p>
          </>
        )}
        <Button variant="link" className="mpmb-btn--onhandover" onClick={() => dispatch({ type: 'cancel-handover' })}>
          ← Go back
        </Button>
      </div>
    </section>
  );
}
