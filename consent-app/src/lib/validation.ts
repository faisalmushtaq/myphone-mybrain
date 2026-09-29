import { childFields, guardianFields } from '../config/fields';
import { OTHER_SCHOOL_ID } from '../config/schools';
import type { StatementForm } from '../config/statements';
import { study } from '../config/study';
import type { AssentRecord, ConsentRecord, GuardianIdentity, ParticipantIdentity } from '../model/types';
import { ageOn, partsToDate, toInt } from './dates';

/**
 * Validation rules for each step. Messages are written for the person
 * filling in the form: specific, calm, and saying what to do next.
 *
 * The same rules are re-implemented server-side (firebase/functions).
 */
export interface FieldError {
  /** The id of the element to focus when the error is chosen from the summary. */
  field: string;
  message: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const PHONE = /^\+?[\d\s()-]{7,20}$/;

/** Maximum lengths, enforced here and as maxLength on the inputs. The server enforces them too. */
export const limits = { name: 100, email: 254, phone: 20, postcode: 10, school: 150, relationship: 60 } as const;

function blank(value: string): boolean {
  return value.trim().length === 0;
}

export function validateChildDetails(identity: ParticipantIdentity): FieldError[] {
  const errors: FieldError[] = [];

  if (childFields.firstName.enabled && childFields.firstName.required && blank(identity.firstName)) {
    errors.push({ field: 'child-first-name', message: 'Enter the young person’s first name.' });
  }
  if (childFields.lastName.enabled && childFields.lastName.required && blank(identity.lastName)) {
    errors.push({ field: 'child-last-name', message: 'Enter the young person’s last name.' });
  }

  if (childFields.dateOfBirth.enabled) {
    const { day, month, year } = identity.dateOfBirth;
    const allBlank = blank(day) && blank(month) && blank(year);
    if (allBlank) {
      if (childFields.dateOfBirth.required) errors.push({ field: 'child-dob-day', message: 'Enter the date of birth.' });
    } else if (toInt(day) === null || toInt(month) === null || toInt(year) === null || year.trim().length !== 4) {
      errors.push({ field: 'child-dob-day', message: 'Date of birth must be numbers, for example 14 3 2013. Use four numbers for the year.' });
    } else {
      const date = partsToDate(identity.dateOfBirth);
      if (!date) {
        errors.push({ field: 'child-dob-day', message: 'Date of birth must be a real date. Check the day and month.' });
      } else if (date.getTime() > Date.now()) {
        errors.push({ field: 'child-dob-day', message: 'Date of birth must be in the past.' });
      } else {
        const age = ageOn(date);
        if (age > study.maxAge) {
          errors.push({
            field: 'child-dob-day',
            message: `This form is for young people aged ${study.minAge} to ${study.maxAge}. Someone aged 18 or over gives their own consent — please contact the team and we will send the right form.`,
          });
        } else if (age < study.minAge) {
          errors.push({
            field: 'child-dob-day',
            message: `MyPhone/MyBrain is for young people aged ${study.minAge} to ${study.maxAge}. Check the date of birth, or contact us if you think this is wrong.`,
          });
        }
      }
    }
  }

  if (childFields.school.enabled && childFields.school.required) {
    if (blank(identity.schoolId)) {
      errors.push({ field: 'child-school', message: 'Choose the school. If it is not in the list, choose “My school is not in the list”.' });
    } else if (identity.schoolId === OTHER_SCHOOL_ID && blank(identity.schoolOther)) {
      errors.push({ field: 'child-school-other', message: 'Type the name of the school.' });
    }
  }

  if (childFields.yearGroup.enabled && childFields.yearGroup.required && blank(identity.yearGroup)) {
    errors.push({ field: 'child-year-group', message: 'Choose the year group.' });
  }

  return errors;
}

export function validateGuardian(guardian: GuardianIdentity): FieldError[] {
  const errors: FieldError[] = [];

  if (guardianFields.fullName.enabled && guardianFields.fullName.required && blank(guardian.fullName)) {
    errors.push({ field: 'guardian-name', message: 'Enter your full name.' });
  }
  if (guardianFields.relationship.enabled && guardianFields.relationship.required) {
    if (blank(guardian.relationship)) {
      errors.push({ field: 'guardian-relationship', message: 'Choose your relationship to the young person.' });
    } else if (guardian.relationship === 'other' && blank(guardian.relationshipOther)) {
      errors.push({ field: 'guardian-relationship-other', message: 'Tell us your relationship to the young person.' });
    }
  }
  if (!guardian.hasParentalResponsibility) {
    errors.push({
      field: 'guardian-responsibility',
      message: 'Tick the box to confirm you have parental responsibility. If you do not, please ask someone who does to complete this part.',
    });
  }
  if (guardianFields.email.enabled) {
    if (blank(guardian.email)) {
      if (guardianFields.email.required) errors.push({ field: 'guardian-email', message: 'Enter your email address so we can send you a copy.' });
    } else if (!EMAIL.test(guardian.email.trim())) {
      errors.push({ field: 'guardian-email', message: 'Enter an email address in the format name@example.com.' });
    }
  }
  if (guardianFields.phone.enabled && !blank(guardian.phone) && !PHONE.test(guardian.phone.trim())) {
    errors.push({ field: 'guardian-phone', message: 'Enter a phone number using numbers only, for example 07700 900123.' });
  }
  if (guardianFields.postcode.enabled) {
    if (blank(guardian.postcode)) {
      if (guardianFields.postcode.required) errors.push({ field: 'guardian-postcode', message: 'Enter your home postcode.' });
    } else if (!UK_POSTCODE.test(guardian.postcode.trim())) {
      errors.push({ field: 'guardian-postcode', message: 'Enter a full UK postcode, for example LS2 9JT.' });
    }
  }
  return errors;
}

/** Element id to focus for a statement: the checkbox, or the first radio of a Yes/No choice. */
export function statementField(statementId: string, kind: 'required' | 'optional'): string {
  return kind === 'required' ? `stmt-${statementId}` : `stmt-${statementId}-agreed`;
}

export function validateConsent(consent: ConsentRecord, form: StatementForm, groupedRequired = study.groupRequiredStatements): FieldError[] {
  const errors: FieldError[] = [];
  const required = form.statements.filter((s) => s.kind === 'required');
  const missingRequired = required.filter((s) => consent.responses[s.id]?.response !== 'agreed');
  if (groupedRequired) {
    if (missingRequired.length) errors.push({ field: 'stmt-required-group', message: 'Tick the box to confirm the statements needed to take part.' });
  } else {
    for (const s of missingRequired) errors.push({ field: statementField(s.id, 'required'), message: `Tick “${s.label}” to continue. This one is needed to take part.` });
  }
  for (const statement of form.statements) {
    if (statement.kind === 'optional' && !consent.responses[statement.id]) {
      errors.push({ field: statementField(statement.id, 'optional'), message: `Choose Yes or No for “${statement.label}”.` });
    }
  }
  if (blank(consent.typedName)) {
    errors.push({ field: 'consent-typed-name', message: 'Type your full name.' });
  }
  errors.push(...signatureErrors(consent.signature, 'signature-pad', 'Add your signature in the box. Use your finger or a stylus, or choose “I can’t draw my signature”.'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(consent.confirmedDate)) {
    errors.push({ field: 'consent-date', message: 'Check the date.' });
  }
  return errors;
}

/** The young person's agreement is their signature. */
export function validateAssent(assent: AssentRecord): FieldError[] {
  return signatureErrors(assent.signature, 'assent-signature', 'Sign your name in the box to say yes, or choose one of the other options below.');
}

function signatureErrors(signature: ConsentRecord['signature'], field: string, missing: string): FieldError[] {
  if (!signature) return [{ field, message: missing }];
  if (signature.method === 'drawn' && signature.strokeCount < 1) return [{ field, message: 'The signature looks empty. Please sign in the box.' }];
  if (signature.method === 'typed' && !signature.typedName?.trim()) return [{ field, message: 'Type your name to sign.' }];
  return [];
}

export const isValidChildDetails = (identity: ParticipantIdentity) => validateChildDetails(identity).length === 0;
export const isValidGuardian = (guardian: GuardianIdentity) => validateGuardian(guardian).length === 0;

/** Case- and whitespace-insensitive comparison used for the "does the typed name match" warning. */
export function namesLookDifferent(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return !(x.includes(y) || y.includes(x));
}
