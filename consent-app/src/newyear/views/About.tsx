import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Icon } from '../../components/ui/Icon';
import { MIN_AGE } from '../config';
import { NyDraft, NyShell } from '../NyShell';
import { useNy } from '../store';

const STEPS = [
  'Join: a few questions about you, then choose what to take a break from: social media apps, AI tools, a daily limit for your phone, or any mix. You get a fun name, like Calm\u00a0Otter\u00a042.',
  'Save the study to your phone, so it can remind you to check in.',
  'Do your start visit: some questions about how you feel, a brain check (a memory game and an attention game, about 10 minutes), screenshots of your screen time, and your TikTok, YouTube and Instagram data downloads, read and cleaned on your own device.',
  'Take your break for as long as you like. Check in any time, even if you’ve slipped. Once a week, send a screen-time screenshot: it proves your days off, and validates your brain scores.',
  'When you’re ready, end your break with the same questions, brain check, screenshots and data downloads, and see what changed. We’ll check in again one and three months later.',
];

/** The landing page: what the online study is, how it works, what is kept. */
export function About() {
  const { state, dispatch } = useNy();
  const go = (view: 'join' | 'tracker') => dispatch({ type: 'go', route: { view } });

  return (
    <NyShell
      kicker="Online study · Preview"
      title="Want to stop the habit?"
      pageTitle="Online study"
      intro={
        <p>
          Contribute to this global study of phone abstinence. Join us, and help us better understand the impact of phone use on our brain health.
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
            <span>A break that you run yourself, for as long as you like: from social media apps, from AI tools, from too much phone time, or any mix.</span>
          </li>
          <li>
            <Icon name="young" />
            <span>For anyone aged {MIN_AGE} or over, anywhere in the world. A University of Leeds study.</span>
          </li>
          <li>
            <Icon name="refresh" />
            <span>A brain check at the start and end, and whenever you come back: see how your memory and attention change.</span>
          </li>
          <li>
            <Icon name="camera" />
            <span>A screen-time screenshot each week proves your days off and validates your scores.</span>
          </li>
          <li>
            <Icon name="check" />
            <span>A leaderboard of fun names, to keep each other going. It’s there for encouragement, not a contest.</span>
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
          <li>Your answers, brain check results, screen-time screenshots and the cleaned app data you choose to share, under a participant ID and a fun name, never your real name.</li>
          <li>Your month and year of birth and some questions about you (sex, gender, ethnicity, where you were born and live, education, languages and work). Each has “Prefer not to say”.</li>
          <li>The type of device you use and the country you use the study from, because they affect the brain check.</li>
          <li>Your email address (and phone number, if you want text reminders), kept apart from your answers.</li>
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
