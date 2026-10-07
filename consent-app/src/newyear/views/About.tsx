import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Icon } from '../../components/ui/Icon';
import { NyDraft, NyShell } from '../NyShell';
import { useNy } from '../store';

const STEPS = [
  'Choose the apps to take a break from, for how long, and a start day. You get a fun name, like Calm\u00a0Otter\u00a042.',
  'Do a short brain check before you start: a memory game and an attention game. It takes about 5 minutes.',
  'Check in each day: did you stay off your apps yesterday? Slips happen. Just be honest.',
  'Do the brain check again halfway and at the end, and see how your memory and attention changed.',
];

/** The landing page: what the New Year break is, how it works, what is kept. */
export function About() {
  const { state, dispatch } = useNy();
  const go = (view: 'join' | 'tracker') => dispatch({ type: 'go', route: { view } });

  return (
    <NyShell
      kicker="New Year break · Preview"
      title="A New Year break from social media."
      pageTitle="A New Year break from social media"
      intro={
        <p>
          Take a break from the social media apps you choose, for 7, 14 or 30 days. Start on 1&nbsp;January, or any day you like. Short brain checks along the way show how your memory and attention change.
        </p>
      }
    >
      {state.flash?.kind === 'deleted' && (
        <Callout tone="success" role="status">
          <p>Everything has been deleted from this device.</p>
        </Callout>
      )}
      {state.participant && (
        <Callout tone="info">
          <p>
            Welcome back, <strong>{state.participant.name}</strong>.{' '}
            <Button variant="link" onClick={() => go('tracker')}>
              Go to my tracker
            </Button>
          </p>
        </Callout>
      )}

      <section aria-labelledby="ny-what" className="ny-section">
        <h2 className="mpmb-h3" id="ny-what">
          What it is
        </h2>
        <ul className="ny-points" role="list">
          <li>
            <Icon name="sparkle" />
            <span>A break you run yourself. You choose the apps, you keep track, and you check in each day.</span>
          </li>
          <li>
            <Icon name="young" />
            <span>For adults aged 18 or over, anywhere in the world.</span>
          </li>
          <li>
            <Icon name="refresh" />
            <span>Brain checks before you start, halfway and at the end, with an optional one a month later: about 5 minutes each.</span>
          </li>
          <li>
            <Icon name="check" />
            <span>A leaderboard of fun names, to keep each other going. It is there for encouragement, not a contest.</span>
          </li>
        </ul>
      </section>

      <section aria-labelledby="ny-how" className="ny-section">
        <h2 className="mpmb-h3" id="ny-how">
          How it works
        </h2>
        <ol className="mpmb-next-steps" role="list">
          {STEPS.map((text, i) => (
            <li key={text}>
              <span aria-hidden="true">{i + 1}</span>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="ny-kept" className="ny-section">
        <h2 className="mpmb-h3" id="ny-kept">
          What is kept <NyDraft />
        </h2>
        <ul className="mpmb-list" role="list">
          <li>A fun name, never your real name.</li>
          <li>Your daily answers and your brain check scores.</li>
          <li>In the real study, these would go to the research team at the University of Leeds, and only with your consent.</li>
          <li>
            <strong>In this preview, nothing leaves this device.</strong> You can delete it all at any time.
          </li>
        </ul>
      </section>

      <div className="ny-cta">
        {state.participant ? (
          <Button variant="primary" arrow onClick={() => go('tracker')}>
            Go to my tracker
          </Button>
        ) : (
          <Button variant="primary" arrow onClick={() => go('join')}>
            Try the preview
          </Button>
        )}
        <p className="mpmb-hint">Not open yet: this is a preview for the research team. It is not a medical test, and the scores are for interest only.</p>
      </div>
    </NyShell>
  );
}
