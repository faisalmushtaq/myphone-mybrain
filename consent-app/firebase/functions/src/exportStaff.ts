import { toCsv } from './portalCore.js';
import { dataTables, ukStamp, type SheetData } from './portalSheets.js';

/**
 * The staff portal in the export bucket (5 November 2026), under
 * staff-portal/: tables/ holds the same tables as the Google Sheet (CSV and
 * TSV, with a README and a data dictionary), and documents/ a copy of each
 * document someone uploaded, by person, named <document>_<date>.<ext>.
 * Like the rest of the export it is a mirror: a copy deleted in the portal
 * (after someone leaves, say) is deleted here on the next run.
 *
 * The tables never hold certificate numbers or message bodies, and the
 * team's notes only when the project manager has turned them on for the
 * sheet. The copies are the documents themselves, DBS certificates included,
 * so the Mac copy sends documents/ only to the University's own storage (its
 * "no-documents" scope leaves them out; see mac-sync-install.sh).
 */

export const STAFF = 'staff-portal';

export interface StaffFile {
  path: string;
  body: string;
  contentType: string;
}
export interface StaffCopy {
  source: string;
  target: string;
}

/** A held copy of an uploaded document. */
export interface DocCopy {
  uid: string;
  person: string;
  document: string;
  uploadedAt: string;
  path: string;
  fileName: string;
}

const slug = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'unnamed';
const EXT = new Set(['pdf', 'jpg', 'jpeg', 'png']);
const extOf = (fileName: string) => {
  const e = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXT.has(e) ? (e === 'jpeg' ? 'jpg' : e) : 'pdf';
};

/** Where each copy goes: documents/<person>/<document>_<date>.<ext>, a number added when two would share a name. */
export function documentTargets(copies: DocCopy[]): StaffCopy[] {
  const folderOf = new Map<string, string>();
  const used = new Set<string>();
  for (const uid of [...new Set(copies.map((c) => c.uid))].sort()) {
    const base = slug(copies.find((c) => c.uid === uid)!.person);
    const folder = used.has(base) ? `${base}_${uid.slice(0, 6)}` : base;
    used.add(folder);
    folderOf.set(uid, folder);
  }
  const names = new Set<string>();
  return [...copies]
    .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt) || a.path.localeCompare(b.path))
    .map((c) => {
      const stem = `${STAFF}/documents/${folderOf.get(c.uid)}/${slug(c.document).toLowerCase()}_${c.uploadedAt.slice(0, 10) || 'undated'}`;
      const ext = extOf(c.fileName);
      let target = `${stem}.${ext}`;
      for (let n = 2; names.has(target); n += 1) target = `${stem}_${n}.${ext}`;
      names.add(target);
      return { source: c.path, target };
    });
}

const tsvCell = (v: string | number) => String(v).replace(/[\t\r\n]+/g, ' ');

const README = (d: SheetData, notes: boolean) => `# MyPhone/MyBrain staff portal

Written by the hourly export from the staff portal (${d.portalUrl}). Last
written ${ukStamp(d.syncedAt)} (UK time). A mirror: do not edit or add files
here; anything changed is replaced on the next run.

tables/       the portal's records, the same tables as the team's Google
              Sheet, each as CSV (for Excel) and TSV; data_dictionary.md
              says what each holds
documents/    a copy of each document people uploaded (DBS certificates,
              forms, training certificates), one folder per person, named
              <document>_<date uploaded>.<ext>; deleted here when the
              portal deletes them (for example after someone leaves)

Never included: DBS certificate numbers, the text of emails and texts, and
${notes ? 'nothing else (the team’s notes on people are included, because the project manager turned them on).' : 'the team’s notes on people (the project manager can turn these on in the portal’s Settings).'}

The documents identify people and include DBS certificates: keep them in
the University's own storage only. The Mac copy's "no-documents" scope
copies tables/ without documents/, for anywhere else (Google Drive).
`;

/** staff-portal/: the tables, their README and dictionary, and where each document copy goes. */
export function staffPortalExport(d: SheetData, copies: DocCopy[]): { files: StaffFile[]; copies: StaffCopy[]; counts: Record<string, number> } {
  const tables = dataTables(d);
  const files: StaffFile[] = [];
  for (const t of tables) {
    files.push({ path: `${STAFF}/tables/${t.file}.csv`, body: toCsv(t.header, t.rows), contentType: 'text/csv; charset=utf-8' });
    files.push({ path: `${STAFF}/tables/${t.file}.tsv`, body: `${[t.header, ...t.rows].map((r) => r.map(tsvCell).join('\t')).join('\n')}\n`, contentType: 'text/tab-separated-values; charset=utf-8' });
  }
  const dictionary = `# Data dictionary: staff portal tables\n\n${tables.map((t) => `## ${t.file} (“${t.name}” in the sheet)\n\n${t.describe}\n\nColumns: ${t.header.map((h) => `“${h}”`).join(', ')}.\n`).join('\n')}`;
  files.push({ path: `${STAFF}/tables/data_dictionary.md`, body: dictionary, contentType: 'text/markdown; charset=utf-8' });
  files.push({ path: `${STAFF}/README.md`, body: README(d, d.notes !== null), contentType: 'text/markdown; charset=utf-8' });
  const targets = documentTargets(copies);
  return { files, copies: targets, counts: { staffPeople: d.people.length, staffTables: tables.length, staffDocuments: targets.length } };
}
