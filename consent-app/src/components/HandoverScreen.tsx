import { useEffect, useRef, useState } from 'react';
import { study } from '../config/study';
import { decidesAlone, stepDefs } from '../model/journey';
import { useStore } from '../state/context';
import { CarryOnLink } from './CarryOnLink';
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
  const [notHere, setNotHere] = useState(false);
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
        {toParent ? 'Please ask your parent or carer to complete the next part.' : `Please pass this to ${childName}.`}
      </h1>

      {toParent ? (
        <div className="mpmb-handover__body">
          {phase === 'details' || handover.nextStep === 'parent-details' ? (
            <p>
              <strong>For the parent or carer:</strong> {childName} has started the MyPhone/MyBrain form about phone use. The next part asks for your details, your permission and a few quick questions. It takes about five minutes.
            </p>
          ) : handover.nextStep === 'parent-more' ? (
            <p>
              <strong>For the parent or carer:</strong> {childName}’s screen time won’t be shared from this form, so the next part has some more questions for you about {childName}’s phone use. About two minutes.
            </p>
          ) : (
            <p>
              <strong>For the parent or carer:</strong> the next part is your section: the information, your permission for sharing {childName}’s screen time, and a few quick questions.
            </p>
          )}
          {handover.nextStep !== 'parent-more' && <p>You will be asked to answer each permission separately and to sign with your finger.</p>}
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
              {decidesAlone(state) ? (
                <p>
                  <strong>For {childName}:</strong> at 16 or over, you decide for yourself whether to share your screen time. Your parent or carer has answered their questions; this part is yours.
                </p>
              ) : (
                <p>
                  <strong>For {childName}:</strong> your parent or carer has said it is okay with them for you to share your screen time. It is still your choice: you can say no even though they said yes.
                </p>
              )}
              <p>Signing your name means yes. Saying no won’t change anything at school.</p>
              <p className="mpmb-handover__note">
                <strong>For the parent or carer:</strong> please let {childName} read and answer this part themselves.
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
          {toParent ? 'I’m the parent or carer — continue' : `I’m ${childName} — continue`}
        </Button>
        {toParent && state.route === 'young' && !noParent && (
          <Button variant="ghost" onClick={() => setNoParent(true)}>
            My parent or carer isn’t here
          </Button>
        )}
        {parentRouteChoice && !notHere && (
          <Button variant="ghost" onClick={() => setNotHere(true)}>
            {childName} isn’t here
          </Button>
        )}
        {parentRouteChoice && notHere && (
          <div className="mpmb-handover__link">
            <p>
              <strong>Send {childName} a link</strong> to do their part on their own phone. It asks for their date of birth.
            </p>
            {state.submission.referenceCode ? <CarryOnLink referenceCode={state.submission.referenceCode} childName={childName} /> : <p className="mpmb-hint">Saving your answers: the link appears in a moment.</p>}
            <Button
              variant="primary"
              onClick={() => {
                dispatch({ type: 'set-child-present', present: false });
                dispatch({ type: 'cancel-handover' });
                dispatch({ type: 'next' });
              }}
            >
              Finish my part
            </Button>
          </div>
        )}
        <Button variant="link" className="mpmb-btn--onhandover" onClick={() => dispatch({ type: 'cancel-handover' })}>
          ← Go back
        </Button>
      </div>
    </section>
  );
}
