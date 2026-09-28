import type { Walkthrough as WalkthroughData } from '../config/walkthroughs';
import { PhoneIllustration } from './PhoneIllustration';

/** Numbered, illustrated steps for finding the screen-time summary. */
export function Walkthrough({ data }: { data: WalkthroughData }) {
  return (
    <ol className="mpmb-walkthrough" role="list" aria-label={`How to find ${data.screenName} on ${data.name}`}>
      {data.steps.map((step, i) => (
        <li key={i} className="mpmb-walkthrough__step">
          <div className="mpmb-walkthrough__figure">
            <PhoneIllustration kind={step.illustration} />
          </div>
          <div className="mpmb-walkthrough__text">
            <span className="mpmb-walkthrough__number" aria-hidden="true">
              {i + 1}
            </span>
            <h2 className="mpmb-walkthrough__title">
              <span className="mpmb-sr-only">Step {i + 1}: </span>
              {step.title}
            </h2>
            <p>{step.detail}</p>
            {step.note && <p className="mpmb-walkthrough__note">{step.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
