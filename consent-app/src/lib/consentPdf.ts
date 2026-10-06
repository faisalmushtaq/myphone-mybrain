import { jsPDF } from 'jspdf';
import boldUrl from '../assets/fonts/AtkinsonHyperlegibleNext-Bold.ttf?url';
import regularUrl from '../assets/fonts/AtkinsonHyperlegibleNext-Regular.ttf?url';
import { covered } from '../assets/fonts/coverage';
import { relationships } from '../config/fields';
import { parentQuestionsForm } from '../config/questions';
import { OTHER_SCHOOL_ID, schools } from '../config/schools';
import { childAssentForm, parentConsentForm } from '../config/statements';
import { study } from '../config/study';
import { platforms } from '../config/walkthroughs';
import type { AppState, SignatureRecord, StatementResponse } from '../model/types';
import { formatIsoDate, formatParts, formatTimestamp } from './dates';

/**
 * The family's copy of the record, built on the device as a PDF from the
 * answers that were sent. Nothing is emailed; this is what they keep.
 *
 * Loaded only when "Download a copy" is pressed, so the PDF library and the
 * fonts are not part of the form itself. The content mirrors the detailed
 * "See what was recorded" summary on the thank-you page.
 */

const PAGE = { w: 210, h: 297, margin: 18 };
const CONTENT = PAGE.w - PAGE.margin * 2;
const TOP = 20;
const BOTTOM = PAGE.h - 24;
const LABEL_COL = 52;
const INK: Rgb = [17, 59, 63];
const MUTED: Rgb = [92, 110, 112];
const RULE: Rgb = [206, 218, 215];
type Rgb = [number, number, number];
type Style = 'normal' | 'bold';

const mm = (pt: number) => pt * 0.352778;
const lineHeight = (size: number) => mm(size) * 1.38;

interface Cursor {
  y: number;
}

let fonts: Promise<{ regular: string; bold: string }> | null = null;

async function fontBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the font (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function loadFonts() {
  fonts ??= Promise.all([fontBase64(regularUrl), fontBase64(boldUrl)]).then(([regular, bold]) => ({ regular, bold }));
  return fonts;
}

/** Draws a signature PNG onto white so the copy never depends on how a viewer treats transparency. */
function flatten(dataUrl: string): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('No canvas'));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      resolve({ dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
    };
    image.onerror = () => reject(new Error('Signature image could not be read'));
    image.src = dataUrl;
  });
}

export class Writer {
  readonly cursor: Cursor = { y: TOP };

  constructor(private readonly doc: jsPDF) {}

  private font(style: Style, size: number, color: Rgb = INK) {
    this.doc.setFont('Atkinson', style);
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
  }

  private ensure(height: number) {
    if (this.cursor.y + height > BOTTOM) {
      this.doc.addPage();
      this.cursor.y = TOP;
    }
  }

  /** Wrapped text, one line at a time so a long passage can cross a page. */
  paragraph(text: string, { size = 10.5, style = 'normal' as Style, color = INK, x = PAGE.margin, width = CONTENT, after = 2.6 } = {}) {
    this.font(style, size, color);
    const lines: string[] = this.doc.splitTextToSize(text, width);
    const lh = lineHeight(size);
    for (const line of lines) {
      this.ensure(lh);
      this.doc.text(line, x, this.cursor.y, { baseline: 'top' });
      this.cursor.y += lh;
    }
    this.cursor.y += after;
  }

  heading(title: string) {
    this.ensure(18);
    this.cursor.y += 3.5;
    this.font('bold', 13.5);
    this.doc.text(title, PAGE.margin, this.cursor.y, { baseline: 'top' });
    this.cursor.y += lineHeight(13.5) + 1;
    this.doc.setDrawColor(...RULE);
    this.doc.setLineWidth(0.3);
    this.doc.line(PAGE.margin, this.cursor.y, PAGE.margin + CONTENT, this.cursor.y);
    this.cursor.y += 3;
  }

  /** A label on the left and a value, wrapped, on the right. */
  row(label: string, value: string) {
    const size = 10.5;
    const lh = lineHeight(size);
    this.font('normal', size);
    const text = value.trim();
    const lines: string[] = text ? this.doc.splitTextToSize(text, CONTENT - LABEL_COL) : ['Not given'];
    const height = lines.length * lh;
    this.ensure(height);
    this.font('bold', 10, MUTED);
    this.doc.text(label, PAGE.margin, this.cursor.y, { baseline: 'top' });
    this.font('normal', size, text ? INK : MUTED);
    this.doc.text(lines, PAGE.margin + LABEL_COL, this.cursor.y, { baseline: 'top' });
    this.cursor.y += height + 1.8;
  }

  /** A statement with Yes / No on the right. */
  statement(text: string, response: StatementResponse | undefined) {
    const size = 10.5;
    const lh = lineHeight(size);
    const answerCol = 26;
    this.font('normal', size);
    const lines: string[] = this.doc.splitTextToSize(text, CONTENT - answerCol - 4);
    const height = lines.length * lh;
    this.ensure(height);
    this.doc.text(lines, PAGE.margin, this.cursor.y, { baseline: 'top' });
    const answer = response === 'agreed' ? 'Yes' : response === 'declined' ? 'No' : 'Not answered';
    this.font('bold', size, response ? INK : MUTED);
    this.doc.text(answer, PAGE.margin + CONTENT, this.cursor.y, { baseline: 'top', align: 'right' });
    this.cursor.y += height + 2.2;
  }

  async signature(signature: SignatureRecord | null) {
    if (!signature) return this.row('Signature', '');
    if (signature.method === 'typed' || !signature.imageDataUrl) return this.row('Signature', signature.typedName ? `${signature.typedName} (typed)` : '');
    const image = await flatten(signature.imageDataUrl);
    const maxW = 64;
    const maxH = 24;
    const scale = Math.min(maxW / image.width, maxH / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    this.ensure(h + 2);
    this.font('bold', 10, MUTED);
    this.doc.text('Signature', PAGE.margin, this.cursor.y, { baseline: 'top' });
    this.doc.setDrawColor(...RULE);
    this.doc.rect(PAGE.margin + LABEL_COL, this.cursor.y, w, h);
    this.doc.addImage(image.dataUrl, 'PNG', PAGE.margin + LABEL_COL, this.cursor.y, w, h);
    this.cursor.y += h + 3;
  }

  note(text: string) {
    this.paragraph(text, { size: 10, color: MUTED });
  }

  footer(reference: string) {
    const pages = this.doc.getNumberOfPages();
    for (let i = 1; i <= pages; i += 1) {
      this.doc.setPage(i);
      this.font('normal', 8.5, MUTED);
      this.doc.text(`MyPhone/MyBrain · Your copy of the record · Reference ${reference}`, PAGE.margin, PAGE.h - 13, { baseline: 'top' });
      this.doc.text(`Page ${i} of ${pages}`, PAGE.w - PAGE.margin, PAGE.h - 13, { baseline: 'top', align: 'right' });
    }
  }
}

function hasUncovered(...values: string[]): boolean {
  return values.some((value) => Array.from(value).some((ch) => !/\s/.test(ch) && !covered(ch)));
}

/** Builds the PDF and returns it with the file name to save it under. */
export async function buildConsentCopy(state: AppState): Promise<{ blob: Blob; fileName: string }> {
  const { identity, guardian, consent, assent, donation, survey, submission } = state;
  const { regular, bold } = await loadFonts();

  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('AtkinsonHyperlegibleNext-Regular.ttf', regular);
  doc.addFont('AtkinsonHyperlegibleNext-Regular.ttf', 'Atkinson', 'normal');
  doc.addFileToVFS('AtkinsonHyperlegibleNext-Bold.ttf', bold);
  doc.addFont('AtkinsonHyperlegibleNext-Bold.ttf', 'Atkinson', 'bold');

  const reference = submission.referenceCode ?? 'not yet issued';
  const recorded = submission.consentSentAt ? formatTimestamp(submission.consentSentAt) : null;
  const childName = identity.firstName.trim() || 'the young person';
  const fullName = `${identity.firstName} ${identity.lastName}`.trim();
  const guardianName = guardian.fullName.trim();
  const schoolName = identity.schoolId === OTHER_SCHOOL_ID ? identity.schoolOther : (schools.find((s) => s.id === identity.schoolId)?.name ?? '');
  const relationship = guardian.relationship === 'other' ? guardian.relationshipOther : (relationships.find((r) => r.id === guardian.relationship)?.label ?? '');
  const sent = donation.images.filter((i) => i.status === 'sent').length;
  const answered = parentQuestionsForm.questions.filter((q) => survey.responses[q.id]).length;

  doc.setProperties({
    title: `MyPhone/MyBrain – your copy of the record (${reference})`,
    subject: 'Copy of the permission and agreement recorded for the MyPhone/MyBrain study',
    author: study.contact.team,
    creator: 'MyPhone/MyBrain consent form',
  });

  const w = new Writer(doc);
  w.paragraph('MyPhone/MyBrain', { size: 10, style: 'bold', color: MUTED, after: 1 });
  w.paragraph('Your copy of what was agreed', { size: 21, style: 'bold', after: 1.5 });
  w.paragraph(`Reference ${reference}${recorded ? ` · Recorded ${recorded}` : ''}`, { size: 10.5, color: MUTED, after: 4 });
  w.paragraph(
    `This is a copy of the record made when ${guardianName || 'a parent or guardian'} gave permission for ${childName} to take part in MyPhone/MyBrain. Keep it somewhere safe. To change anything, or to stop taking part, email ${study.contact.email} and quote the reference. Nobody will ask why.`,
  );
  if (hasUncovered(fullName, guardianName, identity.schoolOther, guardian.relationshipOther, consent.typedName, consent.signature?.typedName ?? '', assent.signature?.typedName ?? '')) {
    w.note('Some letters in the names could not be shown in this document’s typeface. The record itself holds them exactly as they were typed.');
  }

  w.heading('Young person’s details');
  w.row('Name', fullName);
  w.row('Date of birth', formatParts(identity.dateOfBirth));
  w.row('School', schoolName);
  w.row('Year group', identity.yearGroup);

  w.heading('Parent or guardian');
  w.row('Name', guardianName);
  w.row('Relationship', relationship);
  w.row('Email', guardian.email);
  w.row('Phone', guardian.phone);
  w.row('Postcode', guardian.postcode.toUpperCase());

  w.heading('Parent or guardian’s permission');
  for (const s of parentConsentForm.statements) w.statement(s.text, consent.responses[s.id]?.response);
  w.row('Signed by', consent.typedName);
  await w.signature(consent.signature);
  w.row('Date', consent.confirmedDate ? formatIsoDate(consent.confirmedDate) : '');
  w.row('Recorded', consent.completedAt ? formatTimestamp(consent.completedAt) : '');
  w.row('Form version', `${consent.formId} ${consent.formVersion}`);
  w.row('Information version', consent.informationVersion ?? '');

  if (study.parentQuestions) {
    w.heading('Parent or guardian’s quick questions');
    const status = survey.status === 'not-started' ? 'Not answered.' : survey.status === 'skipped' && !answered ? 'Skipped; these questions are optional.' : `${answered} of ${parentQuestionsForm.questions.length} answered.`;
    w.paragraph(`${status} The answers are kept with ${childName}’s code and are not included in this copy.`);
  }

  w.heading(`${childName}’s agreement`);
  if (assent.status === 'deferred') {
    w.paragraph(assent.deferredBy === 'young' ? `${childName} would like to decide later. The team will ask again, for example at school.` : 'To be collected separately, for example at school.');
  } else if (assent.status === 'declined') {
    w.paragraph(`${childName} did not want to take part.`);
  } else if (assent.status === 'not-started') {
    w.paragraph('Not completed yet.');
  } else {
    for (const s of childAssentForm.statements) if (assent.responses[s.id]) w.statement(s.text, assent.responses[s.id]?.response);
    await w.signature(assent.signature);
    w.row('Recorded', assent.completedAt ? formatTimestamp(assent.completedAt) : '');
    w.row('Form version', `${assent.formId} ${assent.formVersion}`);
  }

  w.heading('Screen time and apps');
  if (donation.status === 'not-consented') w.paragraph('Not shared: you chose not to share screen-time information. You can change this later by contacting the team.');
  else if (donation.status === 'deferred') w.paragraph(`Waiting until ${childName} has given their agreement.`);
  else if (donation.status === 'skipped' || sent === 0) w.paragraph('No screenshots were added this time. The team can send a link to add them later.');
  else {
    w.row('Phone', platforms.find((p) => p.id === donation.platform)?.name ?? '');
    w.row('Screenshots', `${sent} sent`);
  }

  w.heading('Changing your mind');
  w.paragraph(`You can stop at any time, from the whole study or from one part such as linking to health or school records, by emailing ${study.contact.email}. Quote your reference if you have it. Nobody will ask why.`);
  w.paragraph(`If you have a concern about how the study is being run and would rather not raise it with the research team, contact ${study.contact.concerns.name} at ${study.contact.concerns.email}, who are independent of the study.`);
  w.note(`Produced on ${formatTimestamp(new Date().toISOString())} by the MyPhone/MyBrain consent form from the answers on this device. ${study.contact.team}.`);
  w.footer(reference);

  return { blob: doc.output('blob'), fileName: `MyPhone-MyBrain-${submission.referenceCode ?? 'record'}.pdf` };
}

/** Builds the copy and hands it to the browser to save. Resolves with the file name. */
export async function downloadConsentCopy(state: AppState): Promise<string> {
  const { blob, fileName } = await buildConsentCopy(state);
  downloadBlob(blob, fileName);
  return fileName;
}

/** Hands a file to the browser to save. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Not revoked straight away: some browsers (iOS Safari) read the URL after the click returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A new A4 document with the study's typeface registered. */
export async function createDocument(): Promise<jsPDF> {
  const { regular, bold } = await loadFonts();
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('AtkinsonHyperlegibleNext-Regular.ttf', regular);
  doc.addFont('AtkinsonHyperlegibleNext-Regular.ttf', 'Atkinson', 'normal');
  doc.addFileToVFS('AtkinsonHyperlegibleNext-Bold.ttf', bold);
  doc.addFont('AtkinsonHyperlegibleNext-Bold.ttf', 'Atkinson', 'bold');
  return doc;
}

export { MUTED as PDF_MUTED };
