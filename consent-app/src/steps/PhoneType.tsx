import { useState } from 'react';
import { StepShell } from '../components/StepShell';
import { Button } from '../components/ui/Button';
import { Draft } from '../components/ui/Draft';
import { Icon } from '../components/ui/Icon';
import { whyPhoneUse } from '../config/copy';
import { platforms, type PlatformId } from '../config/walkthroughs';
import { useStore } from '../state/context';

/** Why we ask for phone-use information, and which kind of phone it is. */
export function PhoneType() {
  const { state, dispatch } = useStore();
  const [error, setError] = useState<string | null>(null);
  const platform = state.donation.platform;
  const young = state.route === 'young' || state.assent.status === 'completed';

  const next = () => {
    if (!platform) {
      setError('Choose the kind of phone so we can show the right instructions.');
      return;
    }
    dispatch({ type: 'next' });
  };

  const skip = () => {
    dispatch({ type: 'donation-status', status: 'skipped' });
    dispatch({ type: 'go-to', stepId: 'review' });
  };

  return (
    <StepShell
      kicker="Phone-use information"
      title={
        <>
          {whyPhoneUse.heading} {whyPhoneUse.draft && <Draft />}
        </>
      }
      intro={<p>{whyPhoneUse.intro}</p>}
      errors={error ? [{ field: 'platform-ios', message: error }] : []}
      onContinue={next}
      continueLabel="Show me how"
      secondaryAction={
        <Button variant="link" onClick={skip}>
          Skip this for now
        </Button>
      }
    >
      <div className="mpmb-cards mpmb-cards--four">
        {whyPhoneUse.points.map((p) => (
          <div key={p.title} className="mpmb-card mpmb-card--compact">
            <h2 className="mpmb-h4">{p.title}</h2>
            <p>{p.body}</p>
          </div>
        ))}
      </div>

      <div className="mpmb-card mpmb-card--mist mpmb-not-interested">
        <h2 className="mpmb-h4">
          <Icon name="eye" size={20} /> What we do not want to see
        </h2>
        <ul role="list">
          {whyPhoneUse.notInterested.map((item) => (
            <li key={item}>
              <span className="mpmb-not-interested__no" aria-hidden="true">
                ✕
              </span>
              {item}
            </li>
          ))}
        </ul>
        <p>{whyPhoneUse.reassurance}</p>
      </div>

      <fieldset className={`mpmb-field${error ? ' has-error' : ''}`}>
        <legend className="mpmb-label mpmb-label--large">{young ? 'What kind of phone do you have?' : 'What kind of phone does the young person have?'}</legend>
        {error && (
          <p className="mpmb-error" id="platform-error">
            <span className="mpmb-sr-only">Error: </span>
            {error}
          </p>
        )}
        <div className="mpmb-platforms">
          {platforms.map((p) => (
            <label key={p.id} className={`mpmb-platform${platform === p.id ? ' is-selected' : ''}`} htmlFor={`platform-${p.id}`}>
              <input
                id={`platform-${p.id}`}
                type="radio"
                name="platform"
                value={p.id}
                className="mpmb-choice__input"
                checked={platform === p.id}
                onChange={() => {
                  setError(null);
                  dispatch({ type: 'set-platform', platform: p.id as PlatformId });
                }}
                aria-labelledby={`platform-${p.id}-name`}
                aria-describedby={[`platform-${p.id}-desc`, error ? 'platform-error' : null].filter(Boolean).join(' ')}
                aria-invalid={error ? true : undefined}
              />
              <span className="mpmb-platform__top">
                <span className="mpmb-platform__icon" aria-hidden="true">
                  <Icon name="phone" size={26} />
                </span>
                <span className="mpmb-choice__dot" aria-hidden="true" />
              </span>
              <span className="mpmb-platform__name" id={`platform-${p.id}-name`}>
                {p.name}
              </span>
              <span className="mpmb-platform__desc" id={`platform-${p.id}-desc`}>
                {p.description}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </StepShell>
  );
}
