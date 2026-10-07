import JSZip from 'jszip';

/**
 * Reading the pupil lists schools upload (UPNs for the classes taking part):
 * a CSV or Excel (.xlsx) file, as their management information system
 * exports it. Only the columns the study needs are read (UPN, first name,
 * last name, date of birth, year group, class); every other column is left
 * alone. Dates are read the UK way (day first), and Excel's own dates too.
 */

export type Table = string[][];

export class TableError extends Error {}

const MAX_CELLS = 200_000;
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
    if ((cells += 1) > MAX_CELLS * 40) throw new TableError('The file is too large to be a class list.');
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
  const firstSheet = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1] ?? workbook.match(/<sheet\b[^>]*\bid="([^"]+)"/)?.[1];
  const rels = (await entryText(zip, 'xl/_rels/workbook.xml.rels')) ?? '';
  let target = 'worksheets/sheet1.xml';
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    if (firstSheet && m[0].includes(`Id="${firstSheet}"`)) target = m[0].match(/Target="([^"]+)"/)?.[1] ?? target;
  }
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const sheet = await entryText(zip, sheetPath);
  if (!sheet) throw new TableError('The first sheet of this workbook could not be read. Save it as .csv and try again.');
  const shared = Array.from(((await entryText(zip, 'xl/sharedStrings.xml')) ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)).map((m) => textOf(m[1]));
  const dates = dateStyles((await entryText(zip, 'xl/styles.xml')) ?? '');
  const rows: Table = [];
  let cells = 0;
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
  return Array.from(rows, (x) => x ?? []).filter((r) => r.some((c) => c.trim() !== ''));
}

/** A class list from an upload: Excel by its contents, otherwise text. */
export async function readTable(buffer: Buffer, name: string): Promise<Table> {
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) return parseXlsx(buffer);
  if (buffer.length >= 4 && buffer.readUInt32BE(0) === 0xd0cf11e0) throw new TableError('This is an older Excel file (.xls). Save it as .xlsx or .csv and try again.');
  if (/\.(xlsx|xlsm)$/i.test(name)) throw new TableError('This Excel file could not be opened. Save it again as .xlsx or .csv and try again.');
  const text = decodeText(buffer);
  if (/\u0000/.test(text.slice(0, 2000))) throw new TableError('This file is not a CSV or Excel file. Save the class list as .csv or .xlsx and try again.');
  return parseCsv(text);
}

/* ── The pupil list ────────────────────────────────────────────────────── */

export type PupilField = 'upn' | 'firstName' | 'lastName' | 'fullName' | 'dateOfBirth' | 'yearGroup' | 'className';

/** Column headings the study recognises, most specific first (legal names before preferred ones). */
const HEADINGS: Record<PupilField, string[]> = {
  upn: ['upn', 'uniquepupilnumber', 'pupilupn', 'upnnumber', 'pupilnumber'],
  firstName: ['legalforename', 'legalfirstname', 'forename', 'firstname', 'forenames', 'givenname', 'givennames', 'firstnames', 'preferredforename', 'preferredfirstname', 'chosenforename'],
  lastName: ['legalsurname', 'legallastname', 'surname', 'lastname', 'familyname', 'preferredsurname', 'preferredlastname', 'chosensurname'],
  fullName: ['name', 'fullname', 'pupilname', 'studentname', 'pupil', 'student', 'legalname'],
  dateOfBirth: ['dob', 'dateofbirth', 'birthdate', 'dateofbirthddmmyyyy', 'birthday', 'dobddmmyyyy'],
  yearGroup: ['yeargroup', 'ncyear', 'ncyearactual', 'nationalcurriculumyear', 'year', 'yeargrp', 'yr', 'curriculumyear'],
  className: ['class', 'classname', 'form', 'formgroup', 'tutorgroup', 'reggroup', 'registrationgroup', 'reg', 'tutor', 'set', 'teachinggroup'],
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
}

/** The pupils in a table: finds the heading row, the study's columns, and checks each row. */
export function pupilsFrom(table: Table): PupilList {
  const headerIndex = table.slice(0, 15).findIndex((r) => r.some((c) => HEADINGS.upn.includes(norm(c))));
  if (headerIndex < 0) throw new TableError('No UPN column was found. The first row should be headings, one of them “UPN”.');
  const header = table[headerIndex];
  const used = new Set<number>();
  const columns = {} as Record<PupilField, string | null>;
  const at = {} as Record<PupilField, number>;
  for (const field of Object.keys(HEADINGS) as PupilField[]) {
    let found = -1;
    for (const want of HEADINGS[field]) {
      found = header.findIndex((c, i) => !used.has(i) && norm(c) === want);
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
    const dobText = cell(r, at.dateOfBirth);
    const dateOfBirth = dobText ? readDate(dobText) : null;
    if (!upn) problems.push({ row, message: 'No UPN.' });
    else if (!UPN.test(upn)) problems.push({ row, message: `“${cell(r, at.upn)}” is not a UPN (a letter and twelve more characters, such as A123456789012).` });
    else if (seen.has(upn)) problems.push({ row, message: `The same UPN as row ${seen.get(upn)}.` });
    if (!firstName || !lastName) problems.push({ row, message: 'A name is missing.' });
    if (dobText && !dateOfBirth) problems.push({ row, message: `The date of birth “${dobText}” could not be read; please write it as 14/03/2012.` });
    if (upn && UPN.test(upn) && !seen.has(upn)) seen.set(upn, row);
    pupils.push({ row, upn, firstName, lastName, dateOfBirth, yearGroup: cell(r, at.yearGroup), className: cell(r, at.className) });
  });
  if (!pupils.length) throw new TableError('The file has headings but no pupils under them.');
  return { columns, pupils, problems, ignored, valid: seen.size };
}
