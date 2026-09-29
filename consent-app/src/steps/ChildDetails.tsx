import { useState } from 'react';
import { GuardianFields } from '../components/GuardianFields';
import { StepShell } from '../components/StepShell';
import { Callout } from '../components/ui/Callout';
import { DateField, SelectField, TextField } from '../components/ui/Field';
import { Icon } from '../components/ui/Icon';
import { childFields, yearGroups } from '../config/fields';
import { OTHER_SCHOOL_ID, schools } from '../config/schools';
import { useStore } from '../state/context';
import { limits, validateChildDetails, validateGuardian, type FieldError } from '../lib/validation';

/**
 * Identifying details. On the parent route the parent enters the young
 * person's details and their own on this one screen; on the young person's
 * route they enter their own details and the parent's come after the handover.
 */
export function ChildDetails() {
  const { state, dispatch } = useStore();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [attempted, setAttempted] = useState(false);
  const young = state.route === 'young';
  const withGuardian = state.route === 'parent';
  const identity = state.identity;
  const guardian = state.guardian;
  const childName = identity.firstName.trim() || 'your child';
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));

  const validate = (nextIdentity = identity, nextGuardian = guardian) => [...validateChildDetails(nextIdentity), ...(withGuardian ? validateGuardian(nextGuardian) : [])];

  const updateIdentity = (patch: Partial<typeof identity>) => {
    dispatch({ type: 'update-identity', patch });
    if (attempted) setErrors(validate({ ...identity, ...patch }, guardian));
  };
  const updateGuardian = (patch: Partial<typeof guardian>) => {
    dispatch({ type: 'update-guardian', patch });
    if (attempted) setErrors(validate(identity, { ...guardian, ...patch }));
  };

  const next = () => {
    const found = validate();
    setAttempted(true);
    setErrors(found);
    if (!found.length) dispatch({ type: 'next' });
  };

  const schoolOptions = [...schools.map((s) => ({ value: s.id, label: s.name })), { value: OTHER_SCHOOL_ID, label: 'My school is not in the list' }];

  return (
    <StepShell
      kicker={young ? 'About you' : 'Details'}
      title={young ? 'A few details about you.' : 'A few details about your child, and you.'}
      intro={
        <p>
          {young
            ? 'So the team can match you with your school and your answers. Your name and date of birth are kept in a separate, locked-away list; your answers get a code number instead.'
            : 'So the team can match your child with their school and their answers, and record who gave permission. Names and contact details are kept apart from research information, which is labelled with a code.'}
        </p>
      }
      errors={errors}
      onContinue={next}
    >
      {withGuardian && (
        <h2 className="mpmb-h3 mpmb-section-title">
          <Icon name="young" size={20} /> Your child
        </h2>
      )}
      <div className="mpmb-fields">
        {childFields.firstName.enabled && (
          <div className="mpmb-fields__row">
            <TextField id="child-first-name" label={young ? 'Your first name' : childFields.firstName.label} required={childFields.firstName.required} autoComplete={young ? 'given-name' : 'off'} maxLength={limits.name} value={identity.firstName} onChange={(e) => updateIdentity({ firstName: e.target.value })} error={errs['child-first-name']} />
            {childFields.lastName.enabled && (
              <TextField id="child-last-name" label={young ? 'Your last name' : childFields.lastName.label} required={childFields.lastName.required} autoComplete={young ? 'family-name' : 'off'} maxLength={limits.name} value={identity.lastName} onChange={(e) => updateIdentity({ lastName: e.target.value })} error={errs['child-last-name']} />
            )}
          </div>
        )}
        {childFields.dateOfBirth.enabled && (
          <DateField id="child-dob" label={young ? 'Your date of birth' : childFields.dateOfBirth.label} hint={childFields.dateOfBirth.hint} value={identity.dateOfBirth} onChange={(dateOfBirth) => updateIdentity({ dateOfBirth })} error={errs['child-dob-day']} autofill={young ? 'self' : 'off'} />
        )}
        <div className="mpmb-fields__row">
          {childFields.school.enabled && (
            <SelectField id="child-school" label={young ? 'Your school' : childFields.school.label} required={childFields.school.required} options={schoolOptions} placeholder="Choose a school" value={identity.schoolId} onChange={(e) => updateIdentity({ schoolId: e.target.value })} error={errs['child-school']} />
          )}
          {childFields.yearGroup.enabled && (
            <SelectField id="child-year-group" label={young ? 'Your year group' : childFields.yearGroup.label} required={childFields.yearGroup.required} options={yearGroups.map((y) => ({ value: y, label: y }))} placeholder="Choose" value={identity.yearGroup} onChange={(e) => updateIdentity({ yearGroup: e.target.value })} error={errs['child-year-group']} />
          )}
        </div>
        {identity.schoolId === OTHER_SCHOOL_ID && (
          <TextField id="child-school-other" label="Name of the school" required maxLength={limits.school} value={identity.schoolOther} onChange={(e) => updateIdentity({ schoolOther: e.target.value })} error={errs['child-school-other']} />
        )}
      </div>

      {withGuardian && (
        <>
          <h2 className="mpmb-h3 mpmb-section-title mpmb-section-title--spaced">
            <Icon name="parent" size={20} /> You
          </h2>
          <GuardianFields guardian={guardian} update={updateGuardian} errors={errs} childName={childName} />
        </>
      )}

      {young && (
        <Callout tone="info">
          <p>
            <Icon name="hand" size={18} /> After this, you will hand the phone to your parent or guardian for their part. Then it comes back to you.
          </p>
        </Callout>
      )}
    </StepShell>
  );
}
