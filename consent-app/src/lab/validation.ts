import type { LabConsentRecord } from '../api/types';
import type { FieldError } from '../lib/validation';
import { labConsentForm, labConsentFormControl } from './config';

export type { FieldError };

export function validateLabConsent(consent: LabConsentRecord): FieldError[] {
  const errors: FieldError[] = [];
  const form = consent.formId === labConsentFormControl.id ? labConsentFormControl : labConsentForm;
  for (const s of form.statements) {
    if (s.kind === 'optional') {
      if (!consent.responses[s.id]) errors.push({ field: `lab-stmt-${s.id}-agreed`, message: `Choose Yes or No for “${s.label}”.` });
    } else if (consent.responses[s.id]?.response !== 'agreed') errors.push({ field: `lab-stmt-${s.id}`, message: `Tick to confirm “${s.label}”. This statement is needed to take part.` });
  }
  if (!consent.typedName.trim()) errors.push({ field: 'lab-typed-name', message: 'Enter your full name.' });
  if (!consent.signature) errors.push({ field: 'lab-signature', message: 'Add your signature in the box, or choose “I can’t draw my signature”.' });
  else if (consent.signature.method === 'drawn' && consent.signature.strokeCount < 1) errors.push({ field: 'lab-signature', message: 'The signature looks empty. Please sign in the box.' });
  else if (consent.signature.method === 'typed' && !consent.signature.typedName?.trim()) errors.push({ field: 'lab-signature', message: 'Type your name to sign.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(consent.confirmedDate)) errors.push({ field: 'lab-date', message: 'Choose the date.' });
  return errors;
}

/** A UK mobile number in international form (+447…), or null: the same rule as the server (firebase/functions/src/sms.ts). */
export function ukMobile(input: string): string | null {
  let n = input.replace(/[^\d+]/g, '');
  if (n.startsWith('+44')) n = `0${n.slice(3)}`;
  else if (n.startsWith('0044')) n = `0${n.slice(4)}`;
  else if (n.startsWith('44') && n.length === 12) n = `0${n.slice(2)}`;
  if (n.startsWith('00')) return null;
  if (!n.startsWith('07') && n.startsWith('7') && n.length === 10) n = `0${n}`;
  return /^07\d{9}$/.test(n) ? `+44${n.slice(1)}` : null;
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
