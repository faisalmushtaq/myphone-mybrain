import JSZip from 'jszip';

/**
 * Reading the pupil lists schools upload (UPNs for the classes taking part):
 * a CSV or Excel (.xlsx, every sheet) file as their management information
 * system exports it, a Word document (its tables, or its lines), a PDF (its
 * text, laid out back into rows), or plain text (19 October 2026). The
 * study's class-list template is read in full (UPN, names, date of birth,
 * gender, ethnicity, school, year group, form tutor, class, address,
 * postcode, school email, FSM, SEN); other columns are left alone. Dates are
 * read the UK way (day first), and Excel's own dates too. A file with no
 * headings is read line by line, from the UPN on each line.
 */

export type Table = string[][];

export class TableError extends Error {}

const MAX_CELLS = 200_000;
/** Characters read from a text file: enough for the largest file accepted (50 MB, schoolUpload.ts). */
const MAX_TEXT_CHARS = 60_000_000;
const MAX_XML_BYTES = 40 * 1024 * 1024;

/* ── CSV ───────────────────────────────────────────────────────────────── */

/** Text from bytes: UTF-8 (with or without a byte order mark), or Windows-1252 as Excel on Windows saves "CSV". */
export function decodeText(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/** RFC 4180 CSV, with the delimiter (comma, semicolon or tab) taken from the first line. */
export function parseCsv(text: string): Table {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ',';
  const rows: Table = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let cells = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
    if ((cells += 1) > MAX_TEXT_CHARS) throw new TableError('The file is too large to be a class list.');
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/* ── Excel (.xlsx) ─────────────────────────────────────────────────────── */

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10));
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e as 'lt'] ?? '';
  });
}

/** All the text runs of a shared or inline string, without phonetic guides. */
function textOf(xml: string): string {
  return decodeXml(
    Array.from(xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g))
      .map((m) => m[1] ?? '')
      .join(''),
  );
}

/** Column letters to a zero-based index: A → 0, Z → 25, AA → 26. */
export function columnIndex(ref: string): number {
  const letters = ref.replace(/\d+$/, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel's date number (days since 30 December 1899) as YYYY-MM-DD. */
export function excelDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 80_000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** Which cell styles are dates, from xl/styles.xml. */
function dateStyles(stylesXml: string): Set<number> {
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom.set(Number(m[1]), decodeXml(m[2]));
  const xfs = stylesXml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] ?? '';
  const out = new Set<number>();
  Array.from(xfs.matchAll(/<xf\b[^>]*?(?:\/>|>)/g)).forEach((m, i) => {
    const id = Number(m[0].match(/numFmtId="(\d+)"/)?.[1] ?? 0);
    const code = (custom.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    if (BUILTIN_DATE_FORMATS.has(id) || (/[dy]/i.test(code) && !/[h]/i.test(code)) || /^m+$/i.test(code)) out.add(i);
  });
  return out;
}

async function entryText(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path);
  if (!entry) return null;
  const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  if (size > MAX_XML_BYTES) throw new TableError('The spreadsheet is too large to be a class list.');
  return entry.async('string');
}

/** The first worksheet of an .xlsx file, as text cells; date cells become YYYY-MM-DD. */
export async function parseXlsx(buffer: Buffer): Promise<Table> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new TableError('This Excel file could not be opened. Save it again as .xlsx or .csv and try again.');
  }
  const workbook = await entryText(zip, 'xl/workbook.xml');
  if (!workbook) throw new TableError('This file is not an Excel workbook. Save it as .xlsx or .csv and try again.');
  // Every sheet, in order (a school may put each class on its own sheet), each with its own headings.
  const sheetIds = Array.from(workbook.matchAll(/<sheet\b[^>]*>/g)).map((m) => m[0].match(/\br:id="([^"]+)"/)?.[1] ?? m[0].match(/\bid="([^"]+)"/)?.[1]).filter((x): x is string => Boolean(x));
  const rels = (await entryText(zip, 'xl/_rels/workbook.xml.rels')) ?? '';
  const targets = sheetIds.map((id) => Array.from(rels.matchAll(/<Relationship\b[^>]*>/g)).find((m) => m[0].includes(`Id="${id}"`))?.[0].match(/Target="([^"]+)"/)?.[1]).filter((x): x is string => Boolean(x));
  if (!targets.length) targets.push('worksheets/sheet1.xml');
  const shared = Array.from(((await entryText(zip, 'xl/sharedStrings.xml')) ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)).map((m) => textOf(m[1]));
  const dates = dateStyles((await entryText(zip, 'xl/styles.xml')) ?? '');
  const out: Table = [];
  let cells = 0;
  for (const target of targets) {
    const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const sheet = await entryText(zip, sheetPath);
    if (!sheet) continue;
    const rows: Table = [];
    for (const rowMatch of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const r = Number(rowMatch[1].match(/\br="(\d+)"/)?.[1] ?? rows.length + 1) - 1;
      const row: string[] = [];
      for (const c of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        if ((cells += 1) > MAX_CELLS) throw new TableError('The spreadsheet is too large to be a class list.');
        const attrs = c[1];
        const body = c[2] ?? '';
        const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
        const col = ref ? columnIndex(ref) : row.length;
        const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? 'n';
        const style = Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? 0);
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let value = '';
        if (type === 's') value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = textOf(body);
        else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else if (type === 'str' || type === 'e') value = decodeXml(v ?? '');
        else if (type === 'd') value = (v ?? '').slice(0, 10);
        else if (v !== undefined) value = dates.has(style) ? (excelDate(Number(v)) ?? v) : v;
        row[col] = value;
      }
      rows[r] = Array.from(row, (x) => x ?? '');
    }
    out.push(...Array.from(rows, (x) => x ?? []).filter((r) => r.some((c) => c.trim() !== '')));
  }
  if (!out.length) throw new TableError('The workbook has no rows. Check it is the class list, then try again.');
  return out;
}

/* ── Word (.docx) ──────────────────────────────────────────────────────── */

/** The tables of a Word document, one after another; a document with no table gives its lines, one cell each. */
export async function parseDocx(zip: JSZip): Promise<Table> {
  const xml = await entryText(zip, 'word/document.xml');
  if (!xml) throw new TableError('This Word document could not be opened. Save it again as .docx, or as .pdf, and try again.');
  const cellText = (x: string) =>
    Array.from(x.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g))
      .map((p) => decodeXml(Array.from(p[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>/g)).map((m) => m[1] ?? ' ').join('')))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  const rows: Table = [];
  let cells = 0;
  for (const tbl of xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)) {
    for (const tr of tbl[0].matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
      const row = Array.from(tr[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)).map((tc) => cellText(tc[0]));
      if ((cells += row.length) > MAX_CELLS) throw new TableError('The document is too large to be a class list.');
      if (row.some((c) => c)) rows.push(row);
    }
  }
  if (rows.length) return rows;
  // No table: its lines, to be read from the UPN on each (or as CSV when they hold commas or tabs).
  const lines = Array.from(xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '').matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)).map((p) => cellText(p[0])).filter(Boolean);
  return linesToTable(lines);
}

/* ── PDF ───────────────────────────────────────────────────────────────── */

const MAX_PDF_PAGES = 100;

/**
 * The text of a PDF laid back out into rows: words at the same height are a row, read left to right, and a wide gap
 * between them starts a new cell, so a table printed to PDF comes back as a table. PDF.js (Mozilla's reader) with
 * scripts and fonts off: only the text is taken.
 */
export async function parsePdf(buffer: Buffer): Promise<Table> {
  let doc: { numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }>; destroy: () => Promise<void> };
  try {
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as { getDocument: (o: Record<string, unknown>) => { promise: Promise<typeof doc> } };
    doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false, verbosity: 0 }).promise;
  } catch {
    throw new TableError('This PDF could not be opened. If it is password-protected, remove the password, or send the class list as Excel or CSV.');
  }
  const rows: Table = [];
  let cells = 0;
  try {
    if (doc.numPages > MAX_PDF_PAGES) throw new TableError('The PDF is too long to be a class list.');
    for (let n = 1; n <= doc.numPages; n += 1) {
      const content = await (await doc.getPage(n)).getTextContent();
      const items = (content.items as { str?: string; transform?: number[]; width?: number; height?: number }[])
        .filter((i) => typeof i.str === 'string' && i.str.trim() && Array.isArray(i.transform))
        .map((i) => ({ text: i.str!.trim(), x: i.transform![4], y: i.transform![5], w: i.width ?? 0, h: Math.abs(i.transform![3]) || i.height || 10 }));
      // Rows by height, top of the page first; within a row, left to right.
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines: (typeof items)[] = [];
      for (const it of items) {
        const line = lines.find((l) => Math.abs(l[0].y - it.y) <= Math.max(2, it.h * 0.35));
        if (line) line.push(it);
        else lines.push([it]);
      }
      for (const line of lines) {
        line.sort((a, b) => a.x - b.x);
        const row: string[] = [];
        let end = -Infinity;
        for (const it of line) {
          // A gap wider than about a space and a half starts a new cell.
          if (row.length && it.x - end < it.h * 0.8) row[row.length - 1] += `${it.x - end > it.h * 0.15 ? ' ' : ''}${it.text}`;
          else row.push(it.text);
          end = it.x + it.w;
        }
        if ((cells += row.length) > MAX_CELLS) throw new TableError('The PDF is too large to be a class list.');
        rows.push(row);
      }
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
  if (!rows.length) throw new TableError('No text was found in this PDF: it may be a scanned image. Please send the class list as Excel or CSV, or send it anyway and the team will read it.');
  return rows;
}

/** Lines of text as a table: CSV when they hold commas, semicolons or tabs; otherwise one cell each, to be read from the UPN. */
export function linesToTable(lines: string[]): Table {
  const delimited = lines.filter((l) => /[,;\t]/.test(l)).length > lines.length / 2;
  return delimited ? parseCsv(lines.join('\n')) : lines.map((l) => [l]);
}

/** What kind of file it is, from its contents (the name only breaks a tie). */
export type FileKind = 'xlsx' | 'docx' | 'pdf' | 'text' | 'old-office' | 'opendocument' | 'image' | 'other';

/** A class list from an upload: Excel, Word or OpenDocument by their contents, PDF, otherwise text. */
export async function readTable(buffer: Buffer, name: string): Promise<Table> {
  const kind = await fileKind(buffer, name);
  if (kind === 'xlsx') return parseXlsx(buffer);
  if (kind === 'docx') return parseDocx(await JSZip.loadAsync(buffer));
  if (kind === 'pdf') return parsePdf(buffer);
  if (kind === 'old-office') throw new TableError(/\.doc$/i.test(name) ? 'This is an older Word file (.doc), which cannot be read here. Save it as .docx or .pdf, or send it anyway and the team will read it.' : 'This is an older Excel file (.xls), which cannot be read here. Save it as .xlsx or .csv, or send it anyway and the team will read it.');
  if (kind === 'opendocument') throw new TableError('This OpenDocument file cannot be read here. Save it as .xlsx, .csv or .pdf, or send it anyway and the team will read it.');
  if (kind === 'image') throw new TableError('This is a picture of the list, which cannot be read here. Send the class list as Excel, CSV, Word or PDF if you can, or send it anyway and the team will read it.');
  if (kind === 'other') throw new TableError('This file could not be read. Save the class list as Excel (.xlsx), CSV, Word or PDF, or send it anyway and the team will read it.');
  const text = decodeText(buffer);
  // Rich text: the words only, without the formatting codes.
  const plain = text.startsWith('{\\rtf') ? text.replace(/\\par[d]?/g, '\n').replace(/\{\\\*[^{}]*\}|\\[a-z]+-?\d* ?|[{}]/g, '') : text;
  const lines = plain.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return /[,;\t]/.test(lines[0] ?? '') ? parseCsv(plain) : linesToTable(lines);
}

export async function fileKind(buffer: Buffer, name: string): Promise<FileKind> {
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    try {
      const zip = await JSZip.loadAsync(buffer);
      if (zip.file('xl/workbook.xml')) return 'xlsx';
      if (zip.file('word/document.xml')) return 'docx';
      if (zip.file('mimetype') || zip.file('content.xml')) return 'opendocument';
    } catch {
      /* not a zip after all */
    }
    return /\.(xlsx|xlsm)$/i.test(name) ? 'xlsx' : 'other';
  }
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buffer.length >= 4 && buffer.readUInt32BE(0) === 0xd0cf11e0) return 'old-office';
  if ((buffer[0] === 0xff && buffer[1] === 0xd8) || buffer.subarray(1, 4).toString('latin1') === 'PNG' || /^(GIF8|II\*|MM\0\*)/.test(buffer.subarray(0, 4).toString('latin1')) || buffer.subarray(4, 12).toString('latin1').startsWith('ftyphei')) return 'image';
  const head = decodeText(buffer.subarray(0, 4000));
  if (/\u0000/.test(head)) return 'other';
  return 'text';
}

/* ── The pupil list ────────────────────────────────────────────────────── */

export type PupilField =
  | 'upn'
  | 'firstName'
  | 'middleName'
  | 'lastName'
  | 'fullName'
  | 'dateOfBirth'
  | 'gender'
  | 'ethnicity'
  | 'schoolName'
  | 'yearGroup'
  | 'formTutor'
  | 'className'
  | 'address1'
  | 'address2'
  | 'address3'
  | 'address4'
  | 'postcode'
  | 'email'
  | 'fsm'
  | 'sen';

/**
 * Column headings the study recognises, most specific first (legal names before preferred ones); one ending in * is a
 * prefix, for headings that carry their own key, such as the template's "SEN (N = no SEN; S = statement; …)".
 */
const HEADINGS: Record<PupilField, string[]> = {
  upn: ['upn', 'uniquepupilnumber', 'pupilupn', 'upnnumber', 'pupilnumber'],
  firstName: ['legalforename', 'legalfirstname', 'forename', 'firstname', 'forenames', 'givenname', 'givennames', 'firstnames', 'preferredforename', 'preferredfirstname', 'chosenforename'],
  middleName: ['middlename', 'middlenames', 'middleforename', 'middleforenames', 'othernames', 'otherforenames'],
  lastName: ['legalsurname', 'legallastname', 'surname', 'lastname', 'familyname', 'preferredsurname', 'preferredlastname', 'chosensurname'],
  fullName: ['name', 'fullname', 'pupilname', 'studentname', 'pupil', 'student', 'legalname'],
  dateOfBirth: ['dob', 'dateofbirth', 'birthdate', 'dateofbirthddmmyyyy', 'birthday', 'dobddmmyyyy'],
  gender: ['gender', 'sex', 'legalsex', 'genderidentity'],
  ethnicity: ['ethnicity', 'ethnicgroup', 'ethnicorigin', 'ethnicitycode', 'ethnicitydescription', 'ethnicity*'],
  schoolName: ['schoolname', 'school', 'establishment', 'establishmentname', 'academy', 'academyname'],
  yearGroup: ['yeargroup', 'ncyear', 'ncyearactual', 'nationalcurriculumyear', 'year', 'yeargrp', 'yr', 'curriculumyear'],
  formTutor: ['formtutor', 'tutor', 'tutorname', 'formteacher', 'classteacher'],
  className: ['class', 'classname', 'form', 'formgroup', 'tutorgroup', 'reggroup', 'registrationgroup', 'reg', 'set', 'teachinggroup'],
  address1: ['addressline1', 'address1', 'addressl1', 'address', 'homeaddress', 'street'],
  address2: ['addressline2', 'address2', 'addressl2'],
  address3: ['addressline3', 'address3', 'addressl3', 'town', 'towncity', 'city'],
  address4: ['addressline4', 'address4', 'addressl4', 'county'],
  postcode: ['postcode', 'postalcode', 'homepostcode', 'addresspostcode'],
  email: ['schoolemail', 'pupilemail', 'studentemail', 'email', 'emailaddress', 'schoolemailaddress'],
  fsm: ['fsm', 'freeschoolmeals', 'fsmeligible', 'fsm*', 'freeschoolmeals*'],
  sen: ['sen', 'senstatus', 'senprovision', 'sencode', 'specialeducationalneeds', 'senn*', 'senstatus*', 'specialeducationalneeds*'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A UPN as written: 13 characters, a letter then twelve digits (a temporary UPN ends in a letter). */
export const UPN = /^[A-Z]\d{11}[0-9A-Z]$/;
export const normaliseUpn = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A date of birth as schools write it (UK order), or Excel's number for it, as YYYY-MM-DD; null when it cannot be read. */
export function readDate(input: string, now = new Date()): string | null {
  const s = input.trim();
  if (!s) return null;
  const real = (y: number, m: number, d: number) => {
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 1990 && y <= now.getUTCFullYear() ? date.toISOString().slice(0, 10) : null;
  };
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) return real(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})(?:\s.*)?$/);
  if (m) {
    let y = Number(m[3]);
    if (m[3].length === 2) y += y <= now.getUTCFullYear() % 100 ? 2000 : 1900;
    return real(y, Number(m[2]), Number(m[1]));
  }
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,9})\.?[\s\-,]+(\d{4})$/);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    return month ? real(Number(m[3]), month, Number(m[1])) : null;
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const iso = excelDate(Number(s));
    return iso ? real(...(iso.split('-').map(Number) as [number, number, number])) : null;
  }
  return null;
}

export interface Pupil {
  /** The row in the file, counting from 1 as a spreadsheet does. */
  row: number;
  upn: string;
  firstName: string;
  lastName: string;
  /** YYYY-MM-DD, or null when the file has none or it could not be read. */
  dateOfBirth: string | null;
  yearGroup: string;
  className: string;
  /** The rest of the class-list template, when the file has it ('' when not). */
  middleName?: string;
  gender?: string;
  ethnicity?: string;
  schoolName?: string;
  formTutor?: string;
  address?: string;
  postcode?: string;
  email?: string;
  /** Free school meals: Y or N as the template asks, or what the file said. */
  fsm?: string;
  /** SEN: N, S, E or K as the template asks, or what the file said. */
  sen?: string;
}

export interface PupilList {
  /** The heading found for each field, or null. */
  columns: Record<PupilField, string | null>;
  pupils: Pupil[];
  problems: { row: number; message: string }[];
  /** Other columns in the file, which are not read. */
  ignored: string[];
  /** Rows with a usable UPN. */
  valid: number;
  /** True when the file had no headings and each line was read from its UPN: the names especially need checking. */
  noHeadings?: boolean;
}

/** Free school meals as the template asks: Y or N (yes, true, 1 and the like too); anything else as written. */
export function readFsm(s: string): string {
  const v = s.trim().toLowerCase();
  if (['y', 'yes', 'true', '1', 'eligible', 'fsm'].includes(v)) return 'Y';
  if (['n', 'no', 'false', '0', 'not eligible', 'none'].includes(v)) return 'N';
  return s.trim();
}

/** SEN as the template asks: N (no SEN), S (statement), E (EHC plan) or K (SEN support); the words for them too. */
export function readSen(s: string): string {
  const v = s.trim().toLowerCase();
  if (!v) return '';
  if (['n', 'no', 'none', 'no sen', 'nil'].includes(v)) return 'N';
  if (v === 's' || v.startsWith('statement')) return 'S';
  if (v === 'e' || v.includes('ehc')) return 'E';
  if (v === 'k' || v.includes('sen support') || v === 'support') return 'K';
  return s.trim();
}

/** The pupils in a table: finds the heading row, the study's columns, and checks each row. */
export function pupilsFrom(table: Table): PupilList {
  const headerIndex = table.slice(0, 15).findIndex((r) => r.some((c) => HEADINGS.upn.includes(norm(c))));
  if (headerIndex < 0) {
    // No headings (a typed list, a Word document or a PDF): each line read from the UPN on it.
    const loose = pupilsFromLines(table);
    if (loose) return loose;
    throw new TableError('No UPN column was found, and no UPNs on the lines. The first row should be headings, one of them “UPN”.');
  }
  const header = table[headerIndex];
  const used = new Set<number>();
  const columns = {} as Record<PupilField, string | null>;
  const at = {} as Record<PupilField, number>;
  for (const field of Object.keys(HEADINGS) as PupilField[]) {
    let found = -1;
    for (const want of HEADINGS[field]) {
      const prefix = want.endsWith('*') ? norm(want) : null;
      found = header.findIndex((c, i) => !used.has(i) && (prefix ? norm(c).startsWith(prefix) && norm(c) !== prefix : norm(c) === want));
      if (found >= 0) break;
    }
    at[field] = found;
    columns[field] = found >= 0 ? header[found].trim() : null;
    if (found >= 0) used.add(found);
  }
  const hasNames = at.firstName >= 0 && at.lastName >= 0;
  if (!hasNames && at.fullName < 0) throw new TableError('No name columns were found. Please include the pupils’ first names and last names (Forename and Surname).');
  const ignored = header.map((c, i) => (used.has(i) || !c.trim() ? null : c.trim())).filter((c): c is string => Boolean(c));
  const pupils: Pupil[] = [];
  const problems: PupilList['problems'] = [];
  const seen = new Map<string, number>();
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  table.slice(headerIndex + 1).forEach((r, i) => {
    const row = headerIndex + i + 2;
    const upn = normaliseUpn(cell(r, at.upn));
    let firstName = cell(r, at.firstName);
    let lastName = cell(r, at.lastName);
    if (!hasNames) {
      // "Surname, Forename", as many systems write a single name column; otherwise the last word is the surname.
      const full = cell(r, at.fullName);
      const comma = full.indexOf(',');
      if (comma >= 0) [lastName, firstName] = [full.slice(0, comma).trim(), full.slice(comma + 1).trim()];
      else {
        const words = full.split(/\s+/).filter(Boolean);
        lastName = words.pop() ?? '';
        firstName = words.join(' ');
      }
    }
    if (!upn && !firstName && !lastName) return;
    // A heading row again (each sheet of a workbook has its own): not a pupil.
    if (HEADINGS.upn.includes(norm(cell(r, at.upn)))) return;
    const dobText = cell(r, at.dateOfBirth);
    const dateOfBirth = dobText ? readDate(dobText) : null;
    if (!upn) problems.push({ row, message: 'No UPN.' });
    else if (!UPN.test(upn)) problems.push({ row, message: `“${cell(r, at.upn)}” is not a UPN (a letter and twelve more characters, such as A123456789012).` });
    else if (seen.has(upn)) problems.push({ row, message: `The same UPN as row ${seen.get(upn)}.` });
    if (!firstName || !lastName) problems.push({ row, message: 'A name is missing.' });
    if (dobText && !dateOfBirth) problems.push({ row, message: `The date of birth “${dobText}” could not be read; please write it as 14/03/2012.` });
    if (upn && UPN.test(upn) && !seen.has(upn)) seen.set(upn, row);
    const address = [cell(r, at.address1), cell(r, at.address2), cell(r, at.address3), cell(r, at.address4)].filter(Boolean).join(', ');
    pupils.push({
      row,
      upn,
      firstName,
      lastName,
      dateOfBirth,
      yearGroup: cell(r, at.yearGroup),
      className: cell(r, at.className),
      middleName: cell(r, at.middleName),
      gender: cell(r, at.gender),
      ethnicity: cell(r, at.ethnicity),
      schoolName: cell(r, at.schoolName),
      formTutor: cell(r, at.formTutor),
      address,
      postcode: cell(r, at.postcode).toUpperCase(),
      email: cell(r, at.email),
      fsm: readFsm(cell(r, at.fsm)),
      sen: readSen(cell(r, at.sen)),
    });
  });
  if (!pupils.length) throw new TableError('The file has headings but no pupils under them.');
  return { columns, pupils, problems, ignored, valid: seen.size };
}


const UPN_IN_TEXT = /\b[A-Z]\d{11}[0-9A-Z]\b/;
const DATE_IN_TEXT = /\b(\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{4}|\d{2})|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?\s+\d{4})\b/;
const NOT_NAMES = new Set(['year', 'yr', 'form', 'class', 'group', 'tutor', 'reg', 'upn', 'dob', 'male', 'female', 'm', 'f']);

/**
 * A list without headings, read line by line: the UPN on each line, a date of birth if there is one, and the words
 * left as the name ("Surname, Forename" when written with a comma, otherwise the last word is the surname). Null when
 * fewer than half the lines with any text carry a UPN, so a file that is not a list is not read as one.
 */
export function pupilsFromLines(table: Table): PupilList | null {
  const lines = table.map((r) => r.map((c) => c.trim()).filter(Boolean).join(' \u2502 ')).map((l, i) => ({ l, row: i + 1 })).filter((x) => x.l);
  const withUpn = lines.filter((x) => UPN_IN_TEXT.test(x.l.toUpperCase()));
  if (!withUpn.length || withUpn.length < lines.length / 2) return null;
  const pupils: Pupil[] = [];
  const problems: PupilList['problems'] = [];
  const seen = new Map<string, number>();
  for (const { l, row } of withUpn) {
    const upn = l.toUpperCase().match(UPN_IN_TEXT)![0];
    const dateText = l.match(DATE_IN_TEXT)?.[0] ?? '';
    const dateOfBirth = dateText ? readDate(dateText) : null;
    const rest = l.replace(new RegExp(upn, 'i'), ' ').replace(dateText, ' ');
    // The cells (or words) that are names: letters, hyphens and apostrophes, not class or year words.
    const parts = rest.split('\u2502').map((c) => c.trim()).filter(Boolean);
    const nameCells = parts.filter((c) => /^[\p{L}][\p{L}' \-.,]*$/u.test(c) && !NOT_NAMES.has(c.toLowerCase()));
    let firstName = '';
    let lastName = '';
    if (nameCells.length >= 2 && parts.length > 1) [firstName, lastName] = [nameCells[0], nameCells[nameCells.length - 1]];
    else {
      const text = (nameCells[0] ?? rest).trim();
      const comma = text.indexOf(',');
      if (comma >= 0) [lastName, firstName] = [text.slice(0, comma).trim(), text.slice(comma + 1).trim()];
      else {
        const words = text.split(/\s+/).filter((w) => /^[\p{L}][\p{L}'\-.]*$/u.test(w) && !NOT_NAMES.has(w.toLowerCase()));
        lastName = words.pop() ?? '';
        firstName = words.join(' ');
      }
    }
    if (seen.has(upn)) problems.push({ row, message: `The same UPN as row ${seen.get(upn)}.` });
    else seen.set(upn, row);
    if (!firstName || !lastName) problems.push({ row, message: 'A name is missing.' });
    if (dateText && !dateOfBirth) problems.push({ row, message: `The date of birth “${dateText}” could not be read; please write it as 14/03/2012.` });
    pupils.push({ row, upn, firstName, lastName, dateOfBirth, yearGroup: '', className: '' });
  }
  const none = Object.fromEntries((Object.keys(HEADINGS) as PupilField[]).map((f) => [f, null])) as Record<PupilField, string | null>;
  return { columns: { ...none, upn: '(read from each line)', firstName: '(read from each line)', lastName: '(read from each line)', dateOfBirth: pupils.some((x) => x.dateOfBirth) ? '(read from each line)' : null }, pupils, problems, ignored: [], valid: seen.size, noHeadings: true };
}
