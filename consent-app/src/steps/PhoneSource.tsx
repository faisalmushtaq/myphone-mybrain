import { useState } from 'react';
import { StepShell } from '../components/StepShell';
import { Disclosure } from '../components/ui/Disclosure';
import type { PhoneSource as Source } from '../model/types';
import { useStore } from '../state/context';
import type { FieldError } from '../lib/validation';

/**
 * Under 16, after the parent's permission: whether the screen time can be
 * shared, and where from (decided 7 October 2026). This is the parent's yes
 * or no: the permission itself has no screenshots question. From the
 * parent's own phone when they can see it there (Apple Family Sharing, Google
 * Family Link): the parent's permission is enough and the young person need
 * not be there. Otherwise from the young person's phone, if they want to. Or
 * not at all, and the parent answers the longer questions instead. On the
 * young person's route they are holding their own phone, so the choice is
 * theirs or none.
 */
export function PhoneSource() {
  const { state, dispatch } = useStore();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [choice, setChoice] = useState<Source | null>(state.phoneSource);
  const childName = state.identity.firstName.trim() || 'your child';
  const parentRoute = state.route === 'parent';

  const options: { value: Source; title: string; body: string }[] = [
    ...(parentRoute
      ? [
          {
            value: 'parent' as Source,
            title: 'Yes, from my phone',
            body: `I can see ${childName}’s screen time on my own phone, with Apple Family Sharing or Google Family Link (apps that show you your child’s phone use). You send the screenshots now; ${childName} doesn’t need to be here.`,
          },
        ]
      : []),
    {
      value: 'child',
      title: `Yes, from ${childName}’s phone`,
      body: parentRoute
        ? `${childName} sends the screenshots from their own phone, if they want to: it is their choice. Do this when ${childName} is with you.`
        : `${childName} sends the screenshots from this phone next, if they want to: it is their choice.`,
    },
    {
      value: 'none',
      title: 'No',
      body: `We ask you some more questions about ${childName}’s phone use instead. About two minutes.`,
    },
  ];

  const next = () => {
    if (!choice) {
      setErrors([
        {
          field: parentRoute ? 'phone-source-parent' : 'phone-source-child',
          message: 'Choose an answer.',
        },
      ]);
      return;
    }
    dispatch({ type: 'set-phone-source', source: choice });
    dispatch({ type: 'next' });
  };

  return (
    <StepShell
      kicker="Screen time"
      title={<>Can we have {childName}’s screen time?</>}
      intro={
        <p>
          Screenshots of the phone’s screen-time summary: <strong>which apps {childName} uses and for how long</strong>. Not messages, photos or posts, and any part can be hidden before it is sent. It is the one thing
          nobody else can tell us.
        </p>
      }
      errors={errors}
      onContinue={next}
    >
      <fieldset className={`mpmb-choice mpmb-choice--stack${errors.length ? ' has-error' : ''}`}>
        <legend className="mpmb-sr-only">Whether, and where from, the screen time can be shared</legend>
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
      <Disclosure summary="What the screenshots show">
        <p>
          The Screen Time page (iPhone) or the Digital Wellbeing page (Android), with the list of apps. We ask for the apps as well as the total because how a phone is used matters as much as how long. The images are
          stored with a code rather than a name.
        </p>
      </Disclosure>
      {parentRoute && (
        <Disclosure summary="How do I know if I can see it on my phone?">
          <p>
            <strong>iPhone, with Apple Family Sharing:</strong> open Settings, then Screen Time. If {childName}’s name is listed under Family, you can see their screen time.
          </p>
          <p>
            <strong>Google Family Link</strong> (for an Android phone, managed from an Android phone or an iPhone): open the Family Link app and choose {childName}. If you see their screen time and app activity, you can.
          </p>
          <p>Not sure? Choose “Yes, from {childName}’s phone”.</p>
        </Disclosure>
      )}
    </StepShell>
  );
}
