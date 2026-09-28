import { StepShell } from '../components/StepShell';
import { Disclosure } from '../components/ui/Disclosure';
import { Draft } from '../components/ui/Draft';
import { aboutStudy } from '../config/copy';
import { study } from '../config/study';
import { useStore } from '../state/context';

/** Short orientation, with audience-specific wording. */
export function About() {
  const { state, dispatch } = useStore();
  const copy = state.route === 'young' ? aboutStudy.young : aboutStudy.parent;

  return (
    <StepShell
      kicker={copy.kicker}
      title={
        <>
          {copy.heading}
          {copy.draft && <Draft />}
        </>
      }
      intro={<p>{copy.intro}</p>}
      onContinue={() => dispatch({ type: 'next' })}
    >
      <div className="mpmb-cards">
        {copy.cards.map((card) => (
          <div key={card.title} className="mpmb-card">
            <h2 className="mpmb-h3">{card.title}</h2>
            <p>{card.body}</p>
          </div>
        ))}
      </div>
      <Disclosure summary="Find out more about the study">
        <p>
          {study.name} is led by the {study.organisation} with partners in Bradford and Leeds. The full participant information explains what happens, how information is
          protected and who to contact. Parents and guardians will read it on the next screens before deciding.
        </p>
        <p>
          You can also read about the study on the <a href={study.contact.familiesPageUrl}>information for families</a> and <a href={study.contact.privacyPageUrl}>data and privacy</a> pages.
        </p>
      </Disclosure>
    </StepShell>
  );
}
