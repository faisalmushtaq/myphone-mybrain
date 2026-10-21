import { createDocument, downloadBlob, PDF_MUTED, Writer } from '../lib/consentPdf';
import { formatIsoDate, formatTimestamp } from '../lib/dates';
import { labForms, labStudy } from './config';
import type { LabState } from './model';

/** The participant's copy of their consent to the social media break study, built on the device. */
export async function buildLabConsentCopy(state: LabState): Promise<{ blob: Blob; fileName: string }> {
  const doc = await createDocument();
  const { consent, submission } = state;
  doc.setProperties({ title: `MyPhone/MyBrain – your consent (${state.code})`, subject: 'Copy of the consent recorded for the MyPhone/MyBrain lab study', author: labStudy.contact.team, creator: 'MyPhone/MyBrain consent form' });
  const w = new Writer(doc);
  w.paragraph('MyPhone/MyBrain', { size: 10, style: 'bold', color: PDF_MUTED, after: 1 });
  w.paragraph('Your copy of your consent', { size: 21, style: 'bold', after: 1.5 });
  w.paragraph(`${labStudy.formalName} · Participant ID ${state.code}${submission.consentSentAt ? ` · Recorded ${formatTimestamp(submission.consentSentAt)}` : ''}`, { size: 10.5, color: PDF_MUTED, after: 4 });
  w.paragraph(`This is a copy of the consent you gave to take part in the ${labStudy.name.toLowerCase()}. Keep it somewhere safe. To withdraw, or to ask anything, email ${labStudy.contact.email} and quote your participant ID.`);

  const forms = labForms[consent.formId === labForms.control.consent.id ? 'control' : 'break'];
  w.heading(forms.consent.title);
  for (const s of forms.consent.statements) w.statement(s.text, consent.responses[s.id]?.response);
  w.row('Signed by', consent.typedName);
  await w.signature(consent.signature);
  w.row('Date', consent.confirmedDate ? formatIsoDate(consent.confirmedDate) : '');
  w.row('Recorded', consent.completedAt ? formatTimestamp(consent.completedAt) : '');
  w.row('Form version', `${consent.formId} ${consent.formVersion}`);
  w.row('Information', `${forms.informationVersion.label} (${consent.informationVersion})`);

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

const PHASE_WORDS: Record<string, string> = { pre: 'Before your break', mid: 'During your break', post: 'After your break' };
/** The control group's (no break). */
const PHASE_WORDS_CONTROL: Record<string, string> = { pre: 'Before your first visit', mid: 'Between your visits', post: 'Before your second visit' };

/** A participant's copy of a MyStory story (19 October 2026), built on the device: the story, when, and how to have it removed. */
export async function buildStoryCopy(story: { code: string; phase: string; title: string | null; text: string; receivedAt: string | null; group?: 'break' | 'control' }): Promise<{ blob: Blob; fileName: string }> {
  const doc = await createDocument();
  doc.setProperties({ title: `MyPhone/MyBrain – your MyStory story (${story.code})`, subject: 'Copy of a MyStory story', author: labStudy.contact.team, creator: 'MyPhone/MyBrain MyStory' });
  const w = new Writer(doc);
  w.paragraph('MyPhone/MyBrain · MyStory', { size: 10, style: 'bold', color: PDF_MUTED, after: 1 });
  w.paragraph(story.title || 'Your story', { size: 21, style: 'bold', after: 1.5 });
  w.paragraph(`${(story.group === 'control' ? PHASE_WORDS_CONTROL : PHASE_WORDS)[story.phase] ?? ''} · Participant ID ${story.code}${story.receivedAt ? ` · Sent ${formatTimestamp(story.receivedAt)}` : ''}`, { size: 10.5, color: PDF_MUTED, after: 4 });
  for (const para of story.text.split(/\n\s*\n/)) w.paragraph(para.trim(), { size: 12, after: 3 });
  w.heading('About your story');
  w.paragraph(`It is saved for the research under your participant ID, never your name. If you ever want it removed, email ${labStudy.contact.name} at ${labStudy.contact.email} and quote your participant ID.`);
  w.paragraph('If you need to talk to someone about how you are feeling: in an emergency, call 999 or go to A&E. To talk to someone now: Leeds Crisis Assessment Centre 0800 183 1485, Samaritans 116 123, or text SHOUT to 85258 (all 24 hours). For support that isn’t urgent: the University Student Counselling and Wellbeing Service, 0113 343 4107 or scw@leeds.ac.uk.');
  w.footer(story.code);
  return { blob: doc.output('blob'), fileName: `MyPhone-MyBrain-MyStory-${story.phase}-${story.code}.pdf` };
}
