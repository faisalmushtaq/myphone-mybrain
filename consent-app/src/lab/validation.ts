import type { LabConsentRecord } from '../api/types';
import type { FieldError } from '../lib/validation';
import { labConsentForm, labStudy } from './config';

export type { FieldError };

export function validateLabConsent(consent: LabConsentRecord): FieldError[] {
  const errors: FieldError[] = [];
  for (const s of labConsentForm.statements) {
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

/** Why a chosen file cannot be used, or null when it can. */
export function checkArchiveFile(file: File): string | null {
  if (/\.txt$/i.test(file.name)) return 'This is a TXT file. Please request your TikTok data again and choose the JSON format.';
  if (!/\.zip$/i.test(file.name)) return 'Please choose the .zip file you downloaded from TikTok, Google Takeout (YouTube) or Instagram.';
  if (file.size > labStudy.maxArchiveBytes) return `This download is over ${Math.round(labStudy.maxArchiveBytes / 1024 / 1024)} MB, usually because it includes your photos or videos. Request it again with only the items the guide lists (it will be much smaller), or email ${labStudy.contact.name} at ${labStudy.contact.email}.`;
  return null;
}
