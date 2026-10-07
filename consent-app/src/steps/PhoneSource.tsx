import { useState } from 'react';
import { StepShell } from '../components/StepShell';
import { Disclosure } from '../components/ui/Disclosure';
import type { PhoneSource as Source } from '../model/types';
import { useStore } from '../state/context';
import type { FieldError } from '../lib/validation';

/**
 * Parent route, under 16, after a yes to sharing: where the screen time
 * comes from (decided 7 October 2026). From the parent's own phone when they
 * can see it there (Apple Family Sharing, Google Family Link): the parent's
 * permission is enough and the young person need not be there. Otherwise
 * from the young person's phone, if they want to. Or neither, and the parent
 * answers the longer questions instead.
 */
export function PhoneSource() {
  const { state, dispatch } = useStore();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [choice, setChoice] = useState<Source | null>(state.phoneSource);
  const childName = state.identity.firstName.trim() || 'your child';

  const options: { value: Source; title: string; body: string }[] = [
    { value: 'parent', title: 'From my phone', body: `I can see ${childName}’s screen time on my own phone, with Apple Family Sharing or Google Family Link. You send the screenshots now, in a few minutes; ${childName} doesn’t need to be here.` },
    { value: 'child', title: `From ${childName}’s phone`, body: `${childName} sends the screenshots from their own phone, if they want to: it is their choice. Do this when ${childName} is with you.` },
    { value: 'none', title: 'Neither of these', body: `We ask you some more questions about ${childName}’s phone use instead. About three minutes.` },
  ];

  const next = () => {
    if (!choice) {
      setErrors([{ field: 'phone-source-parent', message: 'Choose where the screen time can come from.' }]);
      return;
    }
    dispatch({ type: 'set-phone-source', source: choice });
    dispatch({ type: 'next' });
  };

  return (
    <StepShell kicker="Screen time" title={<>Where can {childName}’s screen time come from?</>} intro={<p>Thank you for saying yes. Choose whichever is easiest.</p>} errors={errors} onContinue={next}>
      <fieldset className={`mpmb-choice mpmb-choice--stack${errors.length ? ' has-error' : ''}`}>
        <legend className="mpmb-sr-only">Where the screen time comes from</legend>
        {errors.length > 0 && (
          <p className="mpmb-error">
            <span className="mpmb-sr-only">Error: </span>
            {errors[0].message}
          </p>
        )}
        <div className="mpmb-choice__options">
          {options.map((o) => (
            <label key={o.value} className={`mpmb-choice__option${choice === o.value ? ' is-selected' : ''}`} htmlFor={`phone-source-${o.value}`}>
              <input
                id={`phone-source-${o.value}`}
                type="radio"
                name="phone-source"
                className="mpmb-choice__input"
                checked={choice === o.value}
                onChange={() => {
                  setChoice(o.value);
                  setErrors([]);
                }}
              />
              <span className="mpmb-choice__dot" aria-hidden="true" />
              <span>
                <strong>{o.title}</strong>
                <br />
                <span className="mpmb-hint">{o.body}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Disclosure summary="How do I know if I can see it on my phone?">
        <p>
          <strong>iPhone, with Apple Family Sharing:</strong> open Settings, then Screen Time. If {childName}’s name is listed under Family, you can see their screen time.
        </p>
        <p>
          <strong>Google Family Link</strong> (for an Android phone, managed from an Android phone or an iPhone): open the Family Link app and choose {childName}. If you see their screen time and app activity, you can.
        </p>
        <p>Not sure? Choose “From {childName}’s phone” or “Neither of these”: both are fine.</p>
      </Disclosure>
    </StepShell>
  );
}
