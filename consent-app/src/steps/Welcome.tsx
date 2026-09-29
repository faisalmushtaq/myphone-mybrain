import { useEffect, useRef } from 'react';
import family from '../assets/family.jpg';
import { Button } from '../components/ui/Button';
import { Disclosure } from '../components/ui/Disclosure';
import { Draft } from '../components/ui/Draft';
import { Icon } from '../components/ui/Icon';
import { aboutStudy } from '../config/copy';
import { study } from '../config/study';
import { useStore } from '../state/context';

/** Entry screen: who is starting, what this involves, and three reassurances. */
export function Welcome() {
  const { state, dispatch } = useStore();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = 'Take part online – MyPhone/MyBrain';
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const choose = (route: 'parent' | 'young') => {
    dispatch({ type: 'set-route', route });
    dispatch({ type: 'go-to', stepId: 'child-details', returnTo: null });
  };

  const resume = state.route !== null && state.stepId === 'welcome' && (state.identity.firstName || state.consent.completedAt);

  return (
    <div className="mpmb-welcome">
      <p className="mpmb-kicker">Take part online</p>
      <h1 className="mpmb-h1 mpmb-welcome__title" tabIndex={-1} ref={headingRef}>
        Take part in MyPhone/MyBrain.
      </h1>
      <p className="mpmb-lead">
        About five minutes, done together: a parent or guardian gives permission, the young person signs to say yes, and, if you both want to, you share a screenshot of the phone’s screen-time summary.
      </p>

      {state.clearedReason && (
        <div className="mpmb-callout mpmb-callout--info" role="status">
          <p>
            {state.clearedReason === 'inactivity'
              ? 'For privacy, the form was cleared after a while without any activity. You can start again below.'
              : 'For privacy, the answers saved on this device were cleared because they were more than two hours old. You can start again below.'}
          </p>
        </div>
      )}

      {resume && (
        <div className="mpmb-callout mpmb-callout--info" role="status">
          <p className="mpmb-callout__title">You have already started</p>
          <p>Your answers from earlier are still here on this device.</p>
          <div className="mpmb-callout__actions">
            <Button variant="primary" arrow onClick={() => dispatch({ type: 'next' })}>
              Carry on where you left off
            </Button>
            <Button variant="link" onClick={() => dispatch({ type: 'reset' })}>
              Start again
            </Button>
          </div>
        </div>
      )}

      <h2 className="mpmb-h3 mpmb-welcome__prompt">Who is starting?</h2>
      <div className="mpmb-routes">
        <button type="button" className="mpmb-route mpmb-route--parent" onClick={() => choose('parent')} aria-labelledby="route-parent-title" aria-describedby="route-parent-body">
          <span className="mpmb-route__icon" aria-hidden="true">
            <Icon name="parent" size={30} />
          </span>
          <span className="mpmb-route__title" id="route-parent-title">
            I’m a parent or guardian
          </span>
          <span className="mpmb-route__body" id="route-parent-body">
            You enter the details and give your permission, then hand the phone to your child to sign.
          </span>
          <span className="mpmb-route__cta" aria-hidden="true">
            Start →
          </span>
        </button>
        <button type="button" className="mpmb-route mpmb-route--young" onClick={() => choose('young')} aria-labelledby="route-young-title" aria-describedby="route-young-body">
          <span className="mpmb-route__icon" aria-hidden="true">
            <Icon name="young" size={30} />
          </span>
          <span className="mpmb-route__title" id="route-young-title">
            I’m the young person
          </span>
          <span className="mpmb-route__body" id="route-young-body">
            Do this when your parent or guardian is with you: you enter your details, they give permission, then you sign.
          </span>
          <span className="mpmb-route__cta" aria-hidden="true">
            Start →
          </span>
        </button>
      </div>

      <section className="mpmb-welcome__about" aria-labelledby="about-heading">
        <h2 className="mpmb-h3" id="about-heading">
          What the study is <Draft />
        </h2>
        <p>{aboutStudy.parent.intro}</p>
        <Disclosure summary="What taking part involves">
          {aboutStudy.parent.cards.map((card) => (
            <p key={card.title}>
              <strong>{card.title}.</strong> {card.body}
            </p>
          ))}
          <p>
            More on the <a href={study.contact.familiesPageUrl}>information for families</a> and <a href={study.contact.privacyPageUrl}>data and privacy</a> pages.
          </p>
        </Disclosure>
      </section>

      <figure className="mpmb-welcome__figure">
        <img src={family} alt="Simple silhouettes of a parent or carer and a young person looking at study information together" loading="lazy" width="1280" height="720" />
      </figure>

      <ul className="mpmb-reassure" aria-label="Good to know">
        <li>
          <Icon name="shield" size={20} />
          <span>Names and contact details are kept apart from research information, and stored by the {study.organisation}.</span>
        </li>
        <li>
          <Icon name="check" size={20} />
          <span>Every permission is a separate choice. You can say no to any part.</span>
        </li>
        <li>
          <Icon name="refresh" size={20} />
          <span>You can change your mind later by contacting the team.</span>
        </li>
      </ul>
    </div>
  );
}
