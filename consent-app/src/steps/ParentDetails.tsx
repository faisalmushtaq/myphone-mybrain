import { useState } from 'react';
import { GuardianFields } from '../components/GuardianFields';
import { StepShell } from '../components/StepShell';
import { OTHER_SCHOOL_ID, schools } from '../config/schools';
import { formatParts } from '../lib/dates';
import { validateGuardian, type FieldError } from '../lib/validation';
import { useStore } from '../state/context';

/** Young person's route: the parent checks the child's details and adds their own. */
export function ParentDetails() {
  const { state, dispatch } = useStore();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [attempted, setAttempted] = useState(false);
  const errs = Object.fromEntries(errors.map((e) => [e.field, e.message]));
  const guardian = state.guardian;
  const identity = state.identity;
  const childName = identity.firstName.trim() || 'the young person';
  const update = (patch: Partial<typeof guardian>) => {
    dispatch({ type: 'update-guardian', patch });
    if (attempted) setErrors((prev) => validateGuardian({ ...guardian, ...patch }).filter((e) => prev.some((p) => p.field === e.field)));
  };
  const schoolName = identity.schoolId === OTHER_SCHOOL_ID ? identity.schoolOther : schools.find((s) => s.id === identity.schoolId)?.name ?? '';

  const next = () => {
    const found = validateGuardian(guardian);
    setAttempted(true);
    setErrors(found);
    if (!found.length) dispatch({ type: 'next' });
  };

  return (
    <StepShell kicker="Parent or carer" title="Your details." intro={<p>We record who gave permission for {childName}’s screen time and answered the questions, and how to reach you if we need to.</p>} errors={errors} onContinue={next}>
      <div className="mpmb-card mpmb-card--mist mpmb-check-details">
        <p className="mpmb-check-details__title">
          {childName} entered: <strong>{identity.firstName} {identity.lastName}</strong>, born {formatParts(identity.dateOfBirth)}, {schoolName}
          {identity.yearGroup ? ` (${identity.yearGroup})` : ''}.
        </p>
        <button type="button" className="mpmb-textlink" onClick={() => dispatch({ type: 'go-to', stepId: 'child-details', returnTo: 'parent-details' })}>
          Something is wrong — change it
        </button>
      </div>
      <GuardianFields guardian={guardian} update={update} errors={errs} childName={childName} />
    </StepShell>
  );
}
