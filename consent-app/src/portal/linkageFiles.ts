import JSZip from 'jszip';

/**
 * Reading the linkage files in the browser (4 November 2026): the EEG
 * manifest (CSV or Excel) and, while MySelf cannot be read directly, MySelf's
 * participants.tsv and identifiers CSV. Only the columns the registry uses
 * are sent to the portal; the file itself never leaves the computer. The
 * server checks every row again (firebase/functions/src/linkage.ts).
 */

export type Table = string[][];

/** CSV or TSV, the delimiter taken from the first line. */
export function parseDelimited(text: string): Table {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.slice(0, clean.search(/\r?\n|$/));
  const delimiter = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const).sort((a, b) => b[1] - a[1])[0];
  const d = delimiter[1] > 0 ? delimiter[0] : ',';
  const rows: Table = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === d) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10));
    return ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[e] ?? '';
  });
const textOf = (xml: string) =>
  decodeXml(
    Array.from(xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g))
      .map((m) => m[1] ?? '')
      .join(''),
  );
const columnIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
/** Excel's day number as dd/mm/yyyy, the way the manifest writes dates. */
const excelDate = (serial: number) => {
  if (!Number.isFinite(serial) || serial < 1 || serial > 80_000) return null;
  const iso = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
};
const BUILTIN_DATES = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** The first worksheet of an .xlsx file; date cells become dd/mm/yyyy. */
export async function parseXlsx(data: ArrayBuffer | Uint8Array): Promise<Table> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error('This Excel file could not be opened. Save it as .xlsx or .csv and try again.');
  }
  const read = async (p: string) => (zip.file(p) ? await zip.file(p)!.async('string') : '');
  const workbook = await read('xl/workbook.xml');
  if (!workbook) throw new Error('This is not an Excel workbook. Save it as .xlsx or .csv and try again.');
  const rid = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const rels = await read('xl/_rels/workbook.xml.rels');
  const target = (rid && Array.from(rels.matchAll(/<Relationship\b[^>]*>/g)).find((m) => m[0].includes(`Id="${rid}"`))?.[0].match(/Target="([^"]+)"/)?.[1]) || 'worksheets/sheet1.xml';
  const sheet = await read(target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
  const shared = Array.from((await read('xl/sharedStrings.xml')).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)).map((m) => textOf(m[1]));
  const styles = await read('xl/styles.xml');
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom.set(Number(m[1]), decodeXml(m[2]));
  const dates = new Set<number>();
  Array.from((styles.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] ?? '').matchAll(/<xf\b[^>]*?(?:\/>|>)/g)).forEach((m, i) => {
    const id = Number(m[0].match(/numFmtId="(\d+)"/)?.[1] ?? 0);
    const code = (custom.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    if (BUILTIN_DATES.has(id) || (/[dy]/i.test(code) && !/h/i.test(code))) dates.add(i);
  });
  const rows: Table = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
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
      else if (type === 'str') value = decodeXml(v ?? '');
      else if (v !== undefined) value = dates.has(style) ? (excelDate(Number(v)) ?? v) : v;
      row[col] = value;
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export async function readTable(file: File): Promise<Table> {
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(await file.arrayBuffer());
  if (/\.(xls|ods|numbers)$/i.test(file.name)) throw new Error('Save the file as .xlsx or .csv, then choose it again.');
  return parseDelimited(await file.text());
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** The rows as objects, keyed by our field names; headings matched loosely (Recording ID, recording_id, DOB …). */
export function rowsBy<K extends string>(table: Table, fields: Record<K, string[]>): { rows: Record<K, string>[]; missing: K[] } {
  if (!table.length) return { rows: [], missing: Object.keys(fields) as K[] };
  const head = table[0].map(norm);
  const index = {} as Record<K, number>;
  const missing: K[] = [];
  for (const [k, names] of Object.entries(fields) as [K, string[]][]) {
    const i = head.findIndex((h) => names.map(norm).includes(h));
    index[k] = i;
    if (i < 0) missing.push(k);
  }
  const rows = table.slice(1).map((r) => Object.fromEntries((Object.keys(fields) as K[]).map((k) => [k, index[k] >= 0 ? String(r[index[k]] ?? '').trim() : ''])) as Record<K, string>);
  return { rows, missing };
}

export const EEG_FIELDS = {
  recordingId: ['recording_id', 'recording id', 'recording', 'eeg id', 'id'],
  firstName: ['first_name', 'first name', 'forename', 'given name'],
  lastName: ['last_name', 'last name', 'surname', 'family name'],
  dob: ['date_of_birth', 'date of birth', 'dob', 'birth date'],
  sex: ['sex', 'gender'],
  ethnicity: ['ethnicity', 'ethnic group'],
  recordingDate: ['recording_date', 'recording date', 'date', 'session date'],
  site: ['site', 'school', 'school/site', 'school_site'],
  task: ['task'],
  fileName: ['file_name', 'file name', 'file', 'filename'],
};
export type EegField = keyof typeof EEG_FIELDS;
const EEG_REQUIRED: EegField[] = ['recordingId', 'firstName', 'lastName', 'dob'];

/** The EEG manifest's rows, or what is missing from it. */
export function eegManifest(table: Table): { rows: Record<EegField, string>[]; problem: string | null } {
  const { rows, missing } = rowsBy(table, EEG_FIELDS);
  const need = missing.filter((m) => EEG_REQUIRED.includes(m));
  if (need.length) return { rows: [], problem: `The manifest needs these columns: ${need.map((m) => EEG_FIELDS[m][0]).join(', ')}. Download the template to see the layout.` };
  return { rows: rows.filter((r) => r.recordingId || r.firstName), problem: null };
}

export const EEG_TEMPLATE = 'recording_id,first_name,last_name,date_of_birth,sex,ethnicity,recording_date,site,task,file_name\nEEG-0001,Amara,Ahmed,04/05/2012,F,Asian or Asian British: Pakistani,12/11/2026,GSAL,rest,EEG-0001.bdf\n';

/** MySelf's BIDS participants.tsv: code, sites, first seen. */
export function myselfParticipants(table: Table): { rows: { code: string; sites: string; firstSeen: string }[]; problem: string | null } {
  const { rows, missing } = rowsBy(table, { code: ['participant_id'], sites: ['sites', 'site'], firstSeen: ['first_seen', 'first seen'] });
  if (missing.includes('code')) return { rows: [], problem: 'This is not MySelf’s participants.tsv (no participant_id column).' };
  return { rows, problem: null };
}

/** MySelf's identifiers export: code, names, date of birth, postcode, UPN. Used for one matching run, never stored. */
export function myselfIdentifiers(table: Table): { rows: { code: string; givenName: string; familyName: string; dob: string; postcode: string; upn: string }[]; problem: string | null } {
  const { rows, missing } = rowsBy(table, { code: ['participant_id', 'participant_code', 'code'], givenName: ['given_name', 'first_name'], familyName: ['family_name', 'last_name', 'surname'], dob: ['date_of_birth', 'dob'], address: ['home_address', 'address', 'postcode'], upn: ['upn'] });
  if (missing.includes('code')) return { rows: [], problem: 'This is not MySelf’s identifiers file (no participant_id column).' };
  return {
    rows: rows.map((r) => {
      const pc = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i.exec(r.address);
      return { code: r.code, givenName: r.givenName, familyName: r.familyName, dob: r.dob.slice(0, 10), postcode: pc ? `${pc[1]}${pc[2]}`.toUpperCase() : '', upn: r.upn };
    }),
    problem: null,
  };
}
