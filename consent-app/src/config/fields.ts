/**
 * Field configuration for the identifying-information screens.
 *
 * Each field can be enabled/disabled and made required/optional here without
 * changing any component. Labels and hints are also here so the wording can be
 * reviewed in one place.
 */
export interface FieldConfig {
  enabled: boolean;
  required: boolean;
  label: string;
  hint?: string;
  autocomplete?: string;
}

export const childFields = {
  firstName: { enabled: true, required: true, label: 'First name', autocomplete: 'given-name' },
  lastName: { enabled: true, required: true, label: 'Last name', autocomplete: 'family-name' },
  dateOfBirth: {
    enabled: true,
    required: true,
    label: 'Date of birth',
    hint: 'Tap to choose the date.',
  },
  school: { enabled: true, required: true, label: 'School' },
  yearGroup: { enabled: true, required: false, label: 'Year group' },
} satisfies Record<string, FieldConfig>;

export const guardianFields = {
  fullName: { enabled: true, required: true, label: 'Your full name', autocomplete: 'name' },
  relationship: { enabled: true, required: true, label: 'Your relationship to the young person' },
  /** Optional. Nothing is emailed to families; this is only for contact about the study. */
  email: {
    enabled: true,
    required: false,
    label: 'Your email address',
    hint: 'Only if you are happy for us to email you about the study.',
    autocomplete: 'email',
  },
  phone: {
    enabled: true,
    required: false,
    label: 'Your phone number',
    hint: 'Only if you are happy for us to call or text about the study.',
    autocomplete: 'tel',
  },
  postcode: {
    enabled: true,
    required: false,
    label: 'Home postcode',
    hint: 'This helps us match your child’s records correctly if you later agree to link with health or school records. Leave it blank if you prefer.',
    autocomplete: 'postal-code',
  },
} satisfies Record<string, FieldConfig>;

export const yearGroups = ['Year 7', 'Year 8', 'Year 9', 'Year 10', 'Year 11', 'Year 12', 'Year 13'] as const;

export const relationships = [
  { id: 'mother', label: 'Mother' },
  { id: 'father', label: 'Father' },
  { id: 'step-parent', label: 'Step-parent' },
  { id: 'grandparent', label: 'Grandparent' },
  { id: 'foster-carer', label: 'Foster carer' },
  { id: 'legal-guardian', label: 'Legal guardian' },
  { id: 'other', label: 'Other (please say)' },
] as const;

export type RelationshipId = (typeof relationships)[number]['id'];
