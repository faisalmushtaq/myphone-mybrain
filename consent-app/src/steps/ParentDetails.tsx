import { useState } from 'react';
import { StepShell } from '../components/StepShell';
import { Callout } from '../components/ui/Callout';
import { CheckboxField, SelectField, TextField } from '../components/ui/Field';
import { Icon } from '../components/ui/Icon';
import { guardianFields, relationships } from '../config/fields';
import { OTHER_SCHOOL_ID, schools } from '../config/schools';
import { study } from '../config/study';
import { formatParts } from '../lib/dates';
import { limits, validateGuardian, type FieldError } from '../lib/validation';
import { useStore } from '../state/context';

/** The parent/guardian confirms who they are and their relationship to the young person. */
export function ParentDetails() {
  const { state, dispatch } = useStore();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const guardian = state.guardian;
  const identity = state.identity;
  const childName = identity.firstName.trim() || 'the young person';
  const update = (patch: Partial<typeof guardian>) => {
    dispatch({ type: 'update-guardian', patch });
    if (errors.length) setErrors(validateGuardian({ ...guardian, ...patch }));
  };
  const schoolName = identity.schoolId === OTHER_SCHOOL_ID ? identity.schoolOther : schools.find((s) => s.id === identity.schoolId)?.name ?? '';
  const needsCareNote = guardian.relationship === 'foster-carer';
  const unsureNote = guardian.relationship === 'step-parent' || guardian.relationship === 'grandparent' || guardian.relationship === 'other';

  const next = () => {
    const found = validateGuardian(guardian);
    setErrors(found);
    if (!found.length) dispatch({ type: 'next' });
  };

  return (
    <StepShell
      kicker="Parent or guardian"
      title="Now some details about you."
      intro={<p>We record who gave permission for {childName} to take part, and how to contact you about the study.</p>}
      errors={errors}
      onContinue={next}
    >
      {state.route === 'young' && (
        <div className="mpmb-card mpmb-card--mist mpmb-check-details">
          <h2 className="mpmb-h3">Please check {childName}’s details</h2>
          <dl className="mpmb-summary__list">
            <div className="mpmb-summary__row">
              <dt>Name</dt>
              <dd>
                {identity.firstName} {identity.lastName}
              </dd>
            </div>
            <div className="mpmb-summary__row">
              <dt>Date of birth</dt>
              <dd>{formatParts(identity.dateOfBirth)}</dd>
            </div>
            <div className="mpmb-summary__row">
              <dt>School</dt>
              <dd>
                {schoolName}
                {identity.yearGroup ? `, ${identity.yearGroup}` : ''}
              </dd>
            </div>
          </dl>
          <button type="button" className="mpmb-summary__change" onClick={() => dispatch({ type: 'go-to', stepId: 'child-details', returnTo: 'parent-details' })}>
            Something is wrong — change it
          </button>
        </div>
      )}

      <Callout tone="info" className="mpmb-identity-note">
        <p>
          <Icon name="lock" size={18} />
          <span>
            <strong>Identifying details.</strong> Kept separately from research information, and used only to run the study and to contact you.
          </span>
        </p>
      </Callout>

      <div className="mpmb-fields">
        <TextField id="guardian-name" label={guardianFields.fullName.label} required autoComplete="name" maxLength={limits.name} value={guardian.fullName} onChange={(e) => update({ fullName: e.target.value })} error={errs['guardian-name']} />
        <SelectField
          id="guardian-relationship"
          label={guardianFields.relationship.label}
          required
          options={relationships.map((r) => ({ value: r.id, label: r.label }))}
          value={guardian.relationship}
          onChange={(e) => update({ relationship: e.target.value as typeof guardian.relationship })}
          error={errs['guardian-relationship']}
        />
        {guardian.relationship === 'other' && (
          <TextField id="guardian-relationship-other" label="Your relationship to the young person" required maxLength={limits.relationship} value={guardian.relationshipOther} onChange={(e) => update({ relationshipOther: e.target.value })} error={errs['guardian-relationship-other']} />
        )}
        {needsCareNote && (
          <Callout tone="important" role="status">
            <p>
              Foster carers do not usually hold parental responsibility. If {childName} is in the care of a local authority, permission needs to come from the local authority or from someone who holds
              parental responsibility. Please <a href={study.contact.contactPageUrl}>contact the team</a> before continuing.
            </p>
          </Callout>
        )}
        {unsureNote && (
          <Callout tone="info" role="status">
            <p>If you are not sure whether you hold parental responsibility for {childName}, please check with the team before continuing. It only takes a quick email.</p>
          </Callout>
        )}
        <CheckboxField
          id="guardian-responsibility"
          checked={guardian.hasParentalResponsibility}
          onChange={(checked) => update({ hasParentalResponsibility: checked })}
          label={<>I confirm that I hold parental responsibility for {childName}.</>}
          hint="Parental responsibility usually means you are the child’s mother, a father named on the birth certificate, an adoptive parent, or you hold a court order that gives you parental responsibility. If you are not sure, please ask the team before continuing."
          error={errs['guardian-responsibility']}
          emphasis
        />
        {guardianFields.email.enabled && (
          <TextField id="guardian-email" type="email" inputMode="email" label={guardianFields.email.label} hint={guardianFields.email.hint} required={guardianFields.email.required} autoComplete="email" maxLength={limits.email} value={guardian.email} onChange={(e) => update({ email: e.target.value })} error={errs['guardian-email']} />
        )}
        {guardianFields.phone.enabled && (
          <TextField id="guardian-phone" type="tel" inputMode="tel" label={guardianFields.phone.label} hint={guardianFields.phone.hint} required={guardianFields.phone.required} autoComplete="tel" maxLength={limits.phone} width="half" value={guardian.phone} onChange={(e) => update({ phone: e.target.value })} error={errs['guardian-phone']} />
        )}
        {guardianFields.postcode.enabled && (
          <TextField id="guardian-postcode" label={guardianFields.postcode.label} hint={guardianFields.postcode.hint} required={guardianFields.postcode.required} autoComplete="postal-code" maxLength={limits.postcode} width="short" className="mpmb-input--upper" value={guardian.postcode} onChange={(e) => update({ postcode: e.target.value })} error={errs['guardian-postcode']} />
        )}
      </div>
    </StepShell>
  );
}
