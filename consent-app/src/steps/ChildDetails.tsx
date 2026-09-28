import { useState } from 'react';
import { StepShell } from '../components/StepShell';
import { Callout } from '../components/ui/Callout';
import { DateField, SelectField, TextField } from '../components/ui/Field';
import { Icon } from '../components/ui/Icon';
import { childFields, yearGroups } from '../config/fields';
import { OTHER_SCHOOL_ID, schools } from '../config/schools';
import { useStore } from '../state/context';
import { limits, validateChildDetails, type FieldError } from '../lib/validation';

/** Identifying details about the young person. Wording adapts to who is typing. */
export function ChildDetails() {
  const { state, dispatch } = useStore();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const young = state.route === 'young';
  const identity = state.identity;
  const update = (patch: Partial<typeof identity>) => {
    dispatch({ type: 'update-identity', patch });
    // Once someone has tried to continue, re-check as they fix things so corrected errors disappear.
    if (errors.length) setErrors(validateChildDetails({ ...identity, ...patch }));
  };
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));

  const next = () => {
    const found = validateChildDetails(identity);
    setErrors(found);
    if (!found.length) dispatch({ type: 'next' });
  };

  const schoolOptions = [...schools.map((s) => ({ value: s.id, label: s.name })), { value: OTHER_SCHOOL_ID, label: 'My school is not in the list' }];

  return (
    <StepShell
      kicker={young ? 'About you' : 'About your child'}
      title={young ? 'First, a few details about you.' : 'First, a few details about your child.'}
      intro={
        <p>
          {young
            ? 'These details let the team match you with your school and your answers. They are kept in a separate, locked-away list from the research information.'
            : 'These details let the team match your child with their school and their answers. They are kept in a separate, restricted list from the research information.'}
        </p>
      }
      errors={errors}
      onContinue={next}
    >
      <Callout tone="info" className="mpmb-identity-note">
        <p>
          <Icon name="lock" size={18} />
          <span>
            <strong>Identifying details.</strong>{' '}
            {young
              ? 'We keep your name and date of birth separately. Your answers and screenshots get a code number instead of your name, so the researchers looking at them do not see who you are.'
              : 'Used only to run the study and match records correctly. Research information is labelled with a code instead of a name.'}
          </span>
        </p>
      </Callout>

      <div className="mpmb-fields">
        {childFields.firstName.enabled && (
          <TextField id="child-first-name" label={young ? 'Your first name' : childFields.firstName.label} required={childFields.firstName.required} autoComplete={young ? 'given-name' : 'off'} maxLength={limits.name} value={identity.firstName} onChange={(e) => update({ firstName: e.target.value })} error={errs['child-first-name']} />
        )}
        {childFields.lastName.enabled && (
          <TextField id="child-last-name" label={young ? 'Your last name' : childFields.lastName.label} required={childFields.lastName.required} autoComplete={young ? 'family-name' : 'off'} maxLength={limits.name} value={identity.lastName} onChange={(e) => update({ lastName: e.target.value })} error={errs['child-last-name']} />
        )}
        {childFields.dateOfBirth.enabled && (
          <DateField id="child-dob" label={young ? 'Your date of birth' : childFields.dateOfBirth.label} hint={childFields.dateOfBirth.hint} value={identity.dateOfBirth} onChange={(dateOfBirth) => update({ dateOfBirth })} error={errs['child-dob-day']} autofill={young ? 'self' : 'off'} />
        )}
        {childFields.school.enabled && (
          <SelectField id="child-school" label={young ? 'Your school' : childFields.school.label} required={childFields.school.required} options={schoolOptions} placeholder="Choose a school" value={identity.schoolId} onChange={(e) => update({ schoolId: e.target.value })} error={errs['child-school']} />
        )}
        {identity.schoolId === OTHER_SCHOOL_ID && (
          <TextField id="child-school-other" label="Name of the school" required maxLength={limits.school} value={identity.schoolOther} onChange={(e) => update({ schoolOther: e.target.value })} error={errs['child-school-other']} />
        )}
        {childFields.yearGroup.enabled && (
          <SelectField id="child-year-group" label={young ? 'Your year group' : childFields.yearGroup.label} required={childFields.yearGroup.required} options={yearGroups.map((y) => ({ value: y, label: y }))} placeholder="Choose a year group" value={identity.yearGroup} onChange={(e) => update({ yearGroup: e.target.value })} error={errs['child-year-group']} />
        )}
      </div>
    </StepShell>
  );
}
