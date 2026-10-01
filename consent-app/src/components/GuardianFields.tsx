import { useState } from 'react';
import { guardianFields, relationships } from '../config/fields';
import { study } from '../config/study';
import { limits } from '../lib/validation';
import type { GuardianIdentity } from '../model/types';
import { Callout } from './ui/Callout';
import { CheckboxField, SelectField, TextField } from './ui/Field';

interface Props {
  guardian: GuardianIdentity;
  update: (patch: Partial<GuardianIdentity>) => void;
  errors: Record<string, string>;
  childName: string;
}

/**
 * The parent/guardian's own details. Used on the combined details screen
 * (parent route) and on the parent-details screen (young person route).
 * Phone and postcode are optional and start folded away to keep the screen short.
 */
export function GuardianFields({ guardian, update, errors: errs, childName }: Props) {
  const [showOptional, setShowOptional] = useState(Boolean(guardian.phone || guardian.postcode || errs['guardian-phone'] || errs['guardian-postcode']));
  const needsCareNote = guardian.relationship === 'foster-carer';
  const unsureNote = guardian.relationship === 'step-parent' || guardian.relationship === 'grandparent' || guardian.relationship === 'other';
  // Open when something is already there (coming back to change it), or when one of the fields is in error.
  const optionalOpen = showOptional || Boolean(guardian.phone || guardian.postcode) || Boolean(errs['guardian-phone'] || errs['guardian-postcode']);

  return (
    <div className="mpmb-fields">
      <TextField id="guardian-name" label={guardianFields.fullName.label} required autoComplete="name" maxLength={limits.name} value={guardian.fullName} onChange={(e) => update({ fullName: e.target.value })} error={errs['guardian-name']} />
      <SelectField
        id="guardian-relationship"
        label={guardianFields.relationship.label}
        required
        options={relationships.map((r) => ({ value: r.id, label: r.label }))}
        value={guardian.relationship}
        onChange={(e) => update({ relationship: e.target.value as GuardianIdentity['relationship'] })}
        error={errs['guardian-relationship']}
      />
      {guardian.relationship === 'other' && (
        <TextField id="guardian-relationship-other" label="Your relationship to the young person" required maxLength={limits.relationship} value={guardian.relationshipOther} onChange={(e) => update({ relationshipOther: e.target.value })} error={errs['guardian-relationship-other']} />
      )}
      {needsCareNote && (
        <Callout tone="important" role="status">
          <p>
            Foster carers do not usually hold parental responsibility. If {childName} is in the care of a local authority, permission needs to come from the local authority or from someone who holds parental
            responsibility. Please <a href={study.contact.contactPageUrl}>contact the team</a> before continuing.
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
        label={<>I hold parental responsibility for {childName}.</>}
        hint="Usually the child’s mother, a father named on the birth certificate, an adoptive parent, or someone with a court order giving them parental responsibility. Not sure? Ask the team first."
        error={errs['guardian-responsibility']}
        emphasis
      />
      {guardianFields.email.enabled && (
        <TextField id="guardian-email" type="email" inputMode="email" label={guardianFields.email.label} hint={guardianFields.email.hint} required={guardianFields.email.required} autoComplete="email" maxLength={limits.email} value={guardian.email} onChange={(e) => update({ email: e.target.value })} error={errs['guardian-email']} />
      )}
      {(guardianFields.phone.enabled || guardianFields.postcode.enabled) &&
        (optionalOpen ? (
          <>
            {guardianFields.phone.enabled && (
              <TextField id="guardian-phone" type="tel" inputMode="tel" label={guardianFields.phone.label} hint={guardianFields.phone.hint} required={guardianFields.phone.required} autoComplete="tel" maxLength={limits.phone} width="half" value={guardian.phone} onChange={(e) => update({ phone: e.target.value })} error={errs['guardian-phone']} />
            )}
            {guardianFields.postcode.enabled && (
              <TextField id="guardian-postcode" label={guardianFields.postcode.label} hint={guardianFields.postcode.hint} required={guardianFields.postcode.required} autoComplete="postal-code" maxLength={limits.postcode} width="short" className="mpmb-input--upper" value={guardian.postcode} onChange={(e) => update({ postcode: e.target.value })} error={errs['guardian-postcode']} />
            )}
          </>
        ) : (
          <button type="button" className="mpmb-textlink" onClick={() => setShowOptional(true)}>
            + Add a phone number or home postcode (optional)
          </button>
        ))}
    </div>
  );
}
