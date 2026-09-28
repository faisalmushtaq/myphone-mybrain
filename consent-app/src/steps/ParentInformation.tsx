import { StepShell } from '../components/StepShell';
import { Disclosure } from '../components/ui/Disclosure';
import { Draft } from '../components/ui/Draft';
import { parentInformation, parentInformationVersion } from '../config/copy';
import { study } from '../config/study';
import { formatIsoDate } from '../lib/dates';
import { useStore } from '../state/context';

/**
 * The participant information, one short summary per topic with the full
 * detail behind "Find out more". Complete information is available here; it
 * is just not all shown at once.
 */
export function ParentInformation() {
  const { state, dispatch } = useStore();
  const childName = state.identity.firstName.trim() || 'your child';

  return (
    <StepShell
      kicker="Information for parents and guardians"
      title={
        <>
          What you need to know before deciding. <Draft />
        </>
      }
      intro={
        <p>
          Please read this before giving your permission for {childName} to take part. Each heading has a short summary; open “Find out more” for the detail. You can also ask the team anything at{' '}
          <a href={`mailto:${study.contact.email}`}>{study.contact.email}</a>.
        </p>
      }
      onContinue={() => dispatch({ type: 'next' })}
      continueLabel="I’ve read this — continue to consent"
    >
      <ol className="mpmb-info-sections" role="list">
        {parentInformation.map((section, i) => (
          <li key={section.id} className="mpmb-info-section">
            <span className="mpmb-info-section__number" aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div>
              <h2 className="mpmb-h3">{section.title}</h2>
              <p className="mpmb-info-section__summary">{section.summary}</p>
              <Disclosure>
                {section.detail.map((para, j) => (
                  <p key={j}>{para}</p>
                ))}
              </Disclosure>
            </div>
          </li>
        ))}
      </ol>
      <p className="mpmb-hint">
        Full documents:{' '}
        <a href={study.contact.documentsPageUrl} target="_blank" rel="noopener">
          participant information sheet
        </a>{' '}
        and{' '}
        <a href={study.contact.privacyPageUrl} target="_blank" rel="noopener">
          privacy notice
        </a>{' '}
        (open in a new tab). A copy of both will be sent to your email address with your consent summary.
      </p>
      <p className="mpmb-hint mpmb-version">
        Information version {parentInformationVersion.version}, {formatIsoDate(parentInformationVersion.date)}. This version is recorded with your consent.
      </p>
    </StepShell>
  );
}
