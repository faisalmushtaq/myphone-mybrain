import { useEffect, useRef, useState } from 'react';
import { ParentLinkPanel } from '../components/ParentLink';
import { Button } from '../components/ui/Button';
import { Disclosure } from '../components/ui/Disclosure';
import { Draft } from '../components/ui/Draft';
import { Icon } from '../components/ui/Icon';
import { aboutStudy } from '../config/copy';
import { schoolFromLink } from '../config/schools';
import { study } from '../config/study';
import { takeEntryLink } from '../lib/entryLink';
import { useStore } from '../state/context';

/**
 * Entry screen: who is starting, what this form is for (sharing screen time
 * and answering questions, both opt-in), the separate opt-out from the
 * workshop at school, and three reassurances. A school page can link
 * straight to the opt-out (?optout=1).
 */
export function Welcome() {
  const { state, dispatch } = useStore();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // A young person arriving from "I'm a young person" sees what this is before typing any personal details.
  const [youngIntro, setYoungIntro] = useState(false);
  const [noParent, setNoParent] = useState(false);

  const choose = (route: 'parent' | 'young') => {
    dispatch({ type: 'set-route', route });
    dispatch({ type: 'go-to', stepId: 'child-details', returnTo: null });
  };

  useEffect(() => {
    document.title = 'Take part online – MyPhone/MyBrain';
    // A school's page links here with ?school=<slug>: that school is chosen already, and can be changed on the details step.
    const school = schoolFromLink();
    if (school && !state.identity.schoolId) dispatch({ type: 'update-identity', patch: { schoolId: school.id } });
    // The website's buttons link here with ?who=young, ?who=parent or ?optout=1, so the choice is already made: once, for the first person (see lib/entryLink.ts).
    // After the privacy clear, the welcome screen says why the form is empty instead.
    const link = takeEntryLink();
    if (state.route === null && !state.clearedReason) {
      if (link.finish !== null) {
        dispatch({ type: 'go-to', stepId: 'resume', returnTo: null });
        return;
      }
      if (link.optOut) {
        dispatch({ type: 'go-to', stepId: 'opt-out', returnTo: null });
        return;
      }
      if (link.who === 'young') {
        setYoungIntro(true);
        window.setTimeout(() => headingRef.current?.focus({ preventScroll: true }), 0);
        return;
      }
      if (link.who === 'parent') {
        choose('parent');
        return;
      }
    }
    headingRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resume = state.route !== null && state.stepId === 'welcome' && (state.identity.firstName || state.consent.completedAt);

  if (youngIntro) {
    return (
      <div className="mpmb-welcome">
        <p className="mpmb-kicker">Your screen time</p>
        <h1 className="mpmb-h1 mpmb-welcome__title" tabIndex={-1} ref={headingRef}>
          Before you start.
        </h1>
        <p className="mpmb-lead">MyPhone/MyBrain is a study run by the University of Leeds with schools in Bradford and Leeds. It is about how young people use their phones, and how that connects with how you feel, learn and grow. Here you can share your screen time with the study.</p>
        <ul className="mpmb-reassure mpmb-reassure--stack" aria-label="Good to know">
          <li>
            <Icon name="check" size={20} />
            <span>It’s your choice. You can say no, or stop at any time. Nobody will mind.</span>
          </li>
          <li>
            <Icon name="parent" size={20} />
            <span>16 or 17? You can do this on your own. Under 16? You need your parent or carer with you: they say yes first, then you decide for yourself.</span>
          </li>
          <li>
            <Icon name="phone" size={20} />
            <span>It takes about 5 minutes.</span>
          </li>
          <li>
            <Icon name="shield" size={20} />
            <span>We ask for your name, birthday and school, and keep them locked away, apart from your screenshots.</span>
          </li>
        </ul>
        <div className="mpmb-actions">
          <Button variant="primary" arrow onClick={() => choose('young')}>
            Start
          </Button>
          {!noParent && (
            <Button variant="ghost" onClick={() => setNoParent(true)}>
              I’m under 16 and my parent or carer isn’t here
            </Button>
          )}
        </div>
        {noParent && <ParentLinkPanel />}
        <p className="mpmb-hint">
          Want to know more first? Read the <a href="/young-people/">information for young people</a>, or ask your teacher.
        </p>
      </div>
    );
  }

  return (
    <div className="mpmb-welcome">
      <p className="mpmb-kicker">Phone use and screen time</p>
      <h1 className="mpmb-h1 mpmb-welcome__title" tabIndex={-1} ref={headingRef}>
        Share screen time with MyPhone/MyBrain.
      </h1>
      <p className="mpmb-lead">
        About five minutes. Choose whether to share screenshots of the young person’s screen-time summary (which apps they use, and for how long), and, for parents and carers, answer a few questions about their phone use. It is all optional.
      </p>
      <div className="mpmb-callout mpmb-callout--info">
        <p>
          <strong>The workshop at school is separate:</strong> you don’t need this form for it. Every young person in the classes taking part is invited, unless a parent or carer opts them out.
        </p>
      </div>

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
            I’m a parent or carer
          </span>
          <span className="mpmb-route__body" id="route-parent-body">
            You give your permission and answer a few questions. Then you, or your child, can share their screen time.
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
            16 or 17: you can do this on your own. Under 16: do it when your parent or carer is with you; they say yes first, then you decide.
          </span>
          <span className="mpmb-route__cta" aria-hidden="true">
            Start →
          </span>
        </button>
      </div>

      <p className="mpmb-welcome__resume">
        Started already and need to finish, or add screenshots?{' '}
        <Button variant="link" onClick={() => dispatch({ type: 'go-to', stepId: 'resume', returnTo: null })}>
          Carry on with your reference
        </Button>
      </p>

      <section className="mpmb-welcome__about" aria-labelledby="about-heading">
        <h2 className="mpmb-h3" id="about-heading">
          What the study is <Draft />
        </h2>
        <p>{aboutStudy.parent.intro}</p>
        <Disclosure summary="The workshop, this form, and what we don’t do">
          {aboutStudy.parent.cards.map((card) => (
            <p key={card.title}>
              <strong>{card.title}.</strong> {card.body}
            </p>
          ))}
          <p>
            Everything is in the <a href={study.contact.informationSheetUrl}>information sheet</a>, including how taking part and opting out work. More on the <a href={study.contact.familiesPageUrl}>information for families</a> and <a href={study.contact.privacyPageUrl}>data and privacy</a> pages.
          </p>
        </Disclosure>
      </section>

      <ul className="mpmb-reassure" aria-label="Good to know">
        <li>
          <Icon name="shield" size={20} />
          <span>Names and contact details are kept apart from research information, and stored by the {study.organisation}.</span>
        </li>
        <li>
          <Icon name="check" size={20} />
          <span>Every choice is separate. You can say no to any part.</span>
        </li>
        <li>
          <Icon name="refresh" size={20} />
          <span>You can change your mind later by contacting the team.</span>
        </li>
      </ul>

      <section className="mpmb-welcome__optout" aria-labelledby="optout-heading">
        <h2 className="mpmb-h3" id="optout-heading">
          Parents and carers: opting out of the workshop
        </h2>
        <p>If you don’t want your child to take part in the workshop at school, you can opt them out. That also means nothing about them is linked with health or school records.</p>
        <Button variant="secondary" onClick={() => dispatch({ type: 'go-to', stepId: 'opt-out', returnTo: null })}>
          Opt out of the workshop
        </Button>
      </section>
    </div>
  );
}
