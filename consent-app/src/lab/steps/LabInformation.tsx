import { labInformation, labInformationVersion, labStudy } from '../config';
import { LabShell } from '../LabShell';
import { useLab } from '../store';

/** The approved participant information sheet, one line per section with the full wording underneath. */
export function LabInformation() {
  const { dispatch } = useLab();
  return (
    <LabShell kicker="About the study" title="What taking part involves." intro={<p>The participant information sheet, section by section. Open any line for the full wording. Please read it before you consent.</p>} onContinue={() => dispatch({ type: 'next' })} continueLabel="I have read this" width="wide">
      <section className="mpmb-info-compact" aria-label="Participant information">
        <ul role="list">
          {labInformation.map((section) => (
            <li key={section.id}>
              <details className="mpmb-info-compact__item">
                <summary>
                  <span className="mpmb-info-compact__title">{section.title}</span>
                  <span className="mpmb-info-compact__summary">{section.summary}</span>
                  <span className="mpmb-disclosure__chevron" aria-hidden="true" />
                </summary>
                <div className="mpmb-info-compact__body">
                  {section.detail.map((para, j) => (
                    <p key={j}>{para}</p>
                  ))}
                  {section.note && <p className="mpmb-note">{section.note}</p>}
                </div>
              </details>
            </li>
          ))}
        </ul>
        <p className="mpmb-hint">
          {labInformationVersion.label}. Ethics reference {labStudy.ethicsReference}, approved {labStudy.ethicsApproved}. Questions: {labStudy.contact.name}, <a href={`mailto:${labStudy.contact.email}`}>{labStudy.contact.email}</a>, or {labStudy.contact.lead}, <a href={`mailto:${labStudy.contact.leadEmail}`}>{labStudy.contact.leadEmail}</a>.
        </p>
      </section>
    </LabShell>
  );
}
