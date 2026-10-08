import { guardianFields } from '../config/fields';
import { useState } from 'react';
import { SignaturePad } from '../components/SignaturePad';
import { StepShell } from '../components/StepShell';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { CheckboxField, TextField } from '../components/ui/Field';
import { Disclosure } from '../components/ui/Disclosure';
import { Draft } from '../components/ui/Draft';
import { parentInformation, parentInformationVersion } from '../config/copy';
import { parentConsentForm, statementsFor } from '../config/statements';
import { study } from '../config/study';
import { formatIsoDate, todayIso } from '../lib/dates';
import { limits, namesLookDifferent, validateConsent, type FieldError } from '../lib/validation';
import { childAge, decidesAlone } from '../model/journey';
import { useStore } from '../state/context';

/**
 * One screen: the information, the statements, and the signature. Since the
 * workshop became opt-out (7 October 2026) this is the parent's permission
 * for the opt-in part: their answers, and, for an under-16, sharing the
 * screen time (from 16 the young person decides that themselves).
 *
 * The information sits at the top as two plain sentences, with the summaries
 * (each opening to the full wording) behind one "Read more" (8 October 2026),
 * so it is all available without a separate page or a long scroll. The
 * required statements are listed under one confirmation tick (each still
 * recorded individually); the optional permissions are compact Yes/No rows.
 */
export function ParentConsent() {
  const { state, dispatch } = useStore();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [editDate, setEditDate] = useState(false);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const consent = state.consent;
  const childName = state.identity.firstName.trim() || 'the young person';
  const nameWarning = guardianFields.fullName.enabled && consent.typedName && namesLookDifferent(consent.typedName, state.guardian.fullName);
  const age = childAge(state);
  const asked = statementsFor(parentConsentForm, age, study.selfConsentAge);
  const required = asked.filter((s) => s.kind === 'required');
  const allRequiredAgreed = required.every((s) => consent.responses[s.id]?.response === 'agreed');
  const grouped = study.groupRequiredStatements;

  const next = () => {
    const found = validateConsent(consent, parentConsentForm, grouped, age);
    setErrors(found);
    if (found.length) return;
    dispatch({ type: 'consent-complete', informationVersion: parentInformationVersion.version });
    dispatch({ type: 'next' });
  };

  return (
    <StepShell
      kicker="Parent or carer"
      title={<>Your permission: {childName}’s phone use.</>}
      intro={<p>Read the summary, tick the box and sign. About two minutes.</p>}
      errors={errors}
      onContinue={next}
      continueLabel="Confirm and sign"
      width="wide"
    >
      {consent.revisedAt && !consent.signature && (
        <Callout tone="important" role="status">
          <p>You changed one of your answers after signing, so please sign again at the bottom to confirm the new answers.</p>
        </Callout>
      )}

      <section className="mpmb-info-compact" aria-labelledby="info-heading">
        <h2 className="mpmb-h3" id="info-heading">
          In short <Draft />
        </h2>
        <p>This is to share {childName}’s screen time, if you agree, and to answer a few questions. It is all optional, and you can stop at any time. It is separate from the workshop at school.</p>
        <details className="mpmb-info-compact__more">
          <summary>Read more</summary>
        <ul role="list">
          {parentInformation.map((section) => (
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
                </div>
              </details>
            </li>
          ))}
        </ul>
        </details>
        <p className="mpmb-hint">
          Full documents:{' '}
          <a href={study.contact.informationSheetUrl} target="_blank" rel="noopener">
            participant information sheet
          </a>{' '}
          and{' '}
          <a href={study.contact.privacyPageUrl} target="_blank" rel="noopener">
            privacy notice
          </a>
          . Questions: <a href={`mailto:${study.contact.email}`}>{study.contact.email}</a>. Version {parentInformationVersion.version}, {formatIsoDate(parentInformationVersion.date)}.
        </p>
      </section>

      <section className="mpmb-required" aria-labelledby="required-heading">
        <h2 className="mpmb-h3" id="required-heading">
          To continue <Draft />
        </h2>
        {grouped ? (
          <div className={`mpmb-required__group${errs['stmt-required-group'] ? ' has-error' : ''}`}>
            <ul className="mpmb-required__list" role="list">
              {required.map((s) => (
                <li key={s.id}>{s.text}</li>
              ))}
            </ul>
            <CheckboxField id="stmt-required-group" checked={allRequiredAgreed} onChange={(checked) => dispatch({ type: 'consent-required-group', agreed: checked })} label={<strong>I confirm all of the above.</strong>} error={errs['stmt-required-group']} emphasis />
          </div>
        ) : (
          <div className="mpmb-fields">
            {required.map((s) => (
              <CheckboxField key={s.id} id={`stmt-${s.id}`} checked={consent.responses[s.id]?.response === 'agreed'} onChange={(checked) => dispatch({ type: 'consent-response', statementId: s.id, version: s.version, response: checked ? 'agreed' : 'declined' })} label={s.text} error={errs[`stmt-${s.id}`]} emphasis />
            ))}
          </div>
        )}
      </section>

      {decidesAlone(state) && <p className="mpmb-hint">{childName} is 16 or over, so they decide for themselves about sharing their screen time: we ask them after your part.</p>}

      <section className="mpmb-sign" aria-labelledby="sign-heading">
        <h2 className="mpmb-h3" id="sign-heading">
          Sign to confirm
        </h2>
        <div className="mpmb-fields">
          <TextField id="consent-typed-name" label="Your full name" required autoComplete="name" maxLength={limits.name} width="half" value={consent.typedName} onChange={(e) => dispatch({ type: 'consent-typed-name', name: e.target.value })} error={errs['consent-typed-name']} />
          {nameWarning && (
            <Callout tone="warning" role="status">
              <p>
                This name looks different from the name you gave earlier (<strong>{state.guardian.fullName}</strong>). That is fine if you write your name differently, but please check.
              </p>
            </Callout>
          )}
          <div className={`mpmb-field${errs['signature-pad'] ? ' has-error' : ''}`}>
            <p className="mpmb-label">Your signature</p>
            {errs['signature-pad'] && (
              <p className="mpmb-error" id="signature-pad-error">
                <span className="mpmb-sr-only">Error: </span>
                {errs['signature-pad']}
              </p>
            )}
            <SignaturePad id="signature-pad" value={consent.signature} onChange={(signature) => dispatch({ type: 'consent-signature', signature })} error={errs['signature-pad']} />
          </div>
          <div className={`mpmb-field mpmb-field--date${errs['consent-date'] ? ' has-error' : ''}`} id="consent-date" tabIndex={-1}>
            {errs['consent-date'] && (
              <p className="mpmb-error">
                <span className="mpmb-sr-only">Error: </span>
                {errs['consent-date']}
              </p>
            )}
            {editDate ? (
              <div className="mpmb-inline">
                <label className="mpmb-label" htmlFor="consent-date-input">
                  Date
                </label>
                <input id="consent-date-input" type="date" className="mpmb-input mpmb-input--short" value={consent.confirmedDate} max={todayIso()} onChange={(e) => dispatch({ type: 'consent-date', date: e.target.value })} />
                <Button variant="link" onClick={() => setEditDate(false)}>
                  Done
                </Button>
              </div>
            ) : (
              <p className="mpmb-inline mpmb-date-line">
                Date: <strong>{formatIsoDate(consent.confirmedDate)}</strong>
                <Button variant="link" onClick={() => setEditDate(true)}>
                  Change
                </Button>
              </p>
            )}
          </div>
          <Disclosure summary="What happens with this record">
            <p>Your name, signature and the version of the information you read are stored as the record of your permission. The time you confirm is also recorded. You can change your mind at any time by contacting the team.</p>
          </Disclosure>
        </div>
      </section>
    </StepShell>
  );
}
