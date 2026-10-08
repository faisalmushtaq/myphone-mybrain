import { useState } from 'react';
import { addressFinder } from '../config/features';
import { guardianFields, relationships } from '../config/fields';
import { study } from '../config/study';
import { limits } from '../lib/validation';
import type { GuardianIdentity } from '../model/types';
import { AddressFinder, AddressSearch } from './AddressFinder';
import { Callout } from './ui/Callout';
import { SelectField, TextField } from './ui/Field';

interface Props {
  guardian: GuardianIdentity;
  update: (patch: Partial<GuardianIdentity>) => void;
  errors: Record<string, string>;
  childName: string;
}

/**
 * The parent or carer's own details. Used on the combined details screen
 * (parent route) and on the parent-details screen (young person route). The
 * home address and postcode are required (decided 7 October 2026, for
 * linking the young person's records); email and phone are optional. There
 * is no parental-responsibility tick: only a parent or carer fills this in.
 */
export function GuardianFields({ guardian, update, errors: errs, childName }: Props) {
  const needsCareNote = guardian.relationship === 'foster-carer';
  // Email and phone are optional, so they stay folded away (fewer boxes for a busy parent) unless one is given or asked for (8 October 2026).
  const [showContact, setShowContact] = useState(Boolean(guardian.email || guardian.phone || errs['guardian-email'] || errs['guardian-phone']));
  const contactShown = showContact || Boolean(errs['guardian-email'] || errs['guardian-phone']);

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
      {addressFinder ? (
        // The postcode first, with the addresses it finds; then the address, with suggestions as it is typed.
        <>
          <AddressFinder guardian={guardian} update={update} errors={errs} />
          <AddressSearch guardian={guardian} update={update} errors={errs} />
        </>
      ) : (
        <>
          <TextField id="guardian-address" label={guardianFields.address.label} hint={guardianFields.address.hint} required autoComplete="street-address" maxLength={limits.address} value={guardian.address} onChange={(e) => update({ address: e.target.value })} error={errs['guardian-address']} />
          <TextField
            id="guardian-postcode"
            label={guardianFields.postcode.label}
            hint={guardianFields.postcode.hint}
            required
            autoComplete="postal-code"
            autoCapitalize="characters"
            maxLength={limits.postcode}
            width="short"
            className="mpmb-input--upper"
            value={guardian.postcode}
            onChange={(e) => update({ postcode: e.target.value })}
            error={errs['guardian-postcode']}
          />
        </>
      )}
      {(guardianFields.email.enabled || guardianFields.phone.enabled) && !contactShown && (
        <button type="button" className="mpmb-linkbutton" onClick={() => setShowContact(true)}>
          + Add an email or phone number (optional)
        </button>
      )}
      {guardianFields.email.enabled && contactShown && (
        <TextField id="guardian-email" type="email" inputMode="email" label={guardianFields.email.label} hint={guardianFields.email.hint} required={guardianFields.email.required} autoComplete="email" maxLength={limits.email} value={guardian.email} onChange={(e) => update({ email: e.target.value })} error={errs['guardian-email']} />
      )}
      {guardianFields.phone.enabled && contactShown && (
        <TextField id="guardian-phone" type="tel" inputMode="tel" label={guardianFields.phone.label} hint={guardianFields.phone.hint} required={guardianFields.phone.required} autoComplete="tel" maxLength={limits.phone} width="half" value={guardian.phone} onChange={(e) => update({ phone: e.target.value })} error={errs['guardian-phone']} />
      )}
    </div>
  );
}
