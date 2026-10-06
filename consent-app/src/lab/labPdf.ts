import { createDocument, downloadBlob, PDF_MUTED, Writer } from '../lib/consentPdf';
import { formatIsoDate, formatTimestamp } from '../lib/dates';
import { labConsentForm, labInformationVersion, labStudy } from './config';
import type { LabState } from './model';

/** The participant's copy of their consent to the social media break study, built on the device. */
export async function buildLabConsentCopy(state: LabState): Promise<{ blob: Blob; fileName: string }> {
  const doc = await createDocument();
  const { consent, submission } = state;
  doc.setProperties({ title: `MyPhone/MyBrain – your consent (${state.code})`, subject: 'Copy of the consent recorded for the social media break study', author: labStudy.contact.team, creator: 'MyPhone/MyBrain consent form' });
  const w = new Writer(doc);
  w.paragraph('MyPhone/MyBrain', { size: 10, style: 'bold', color: PDF_MUTED, after: 1 });
  w.paragraph('Your copy of your consent', { size: 21, style: 'bold', after: 1.5 });
  w.paragraph(`${labStudy.formalName} · Participant ID ${state.code}${submission.consentSentAt ? ` · Recorded ${formatTimestamp(submission.consentSentAt)}` : ''}`, { size: 10.5, color: PDF_MUTED, after: 4 });
  w.paragraph(`This is a copy of the consent you gave to take part in the ${labStudy.name.toLowerCase()}. Keep it somewhere safe. To withdraw, or to ask anything, email ${labStudy.contact.email} and quote your participant ID.`);

  w.heading(labConsentForm.title);
  for (const s of labConsentForm.statements) w.statement(s.text, consent.responses[s.id]?.response);
  w.row('Signed by', consent.typedName);
  await w.signature(consent.signature);
  w.row('Date', consent.confirmedDate ? formatIsoDate(consent.confirmedDate) : '');
  w.row('Recorded', consent.completedAt ? formatTimestamp(consent.completedAt) : '');
  w.row('Form version', `${consent.formId} ${consent.formVersion}`);
  w.row('Information', `${labInformationVersion.label} (${consent.informationVersion})`);

  w.heading('Changing your mind');
  w.paragraph(`You can withdraw from the study at any time, without giving a reason, by emailing ${labStudy.contact.name} at ${labStudy.contact.email}. You may ask for your identifiable data to be withdrawn up to one month after your final session; after that, data may be de-identified and no longer retrievable.`);
  w.paragraph(`Study lead: ${labStudy.contact.lead}, ${labStudy.contact.leadEmail}. ${labStudy.contact.team}. Ethics reference ${labStudy.ethicsReference}, approved ${labStudy.ethicsApproved}.`);
  w.note(`Produced on ${formatTimestamp(new Date().toISOString())} from the answers on this device.`);
  w.footer(state.code);
  return { blob: doc.output('blob'), fileName: `MyPhone-MyBrain-consent-${state.code}.pdf` };
}

export async function downloadLabConsentCopy(state: LabState): Promise<string> {
  const { blob, fileName } = await buildLabConsentCopy(state);
  downloadBlob(blob, fileName);
  return fileName;
}
