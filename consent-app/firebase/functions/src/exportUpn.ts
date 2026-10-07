import { textFile, tsvFile, type Doc, type OutFile, type Row } from './export.js';

/**
 * The schools' UPN lists in the hourly export: a folder of their own,
 * schools/upn-uploads/, beside the donations/ and identifying/ folders, for
 * study coordinators only (UPNs, names and dates of birth are identifying).
 *
 *   schools/upn-uploads/uploads.tsv          one row per file a school sent
 *   schools/upn-uploads/<school>/<date>_<id>_<file name>   each file exactly as sent
 *   schools/upn-uploads/<school>/<date>_<id>_pupils.tsv    what was read from it
 *   schools/upn-uploads/upn_matches.tsv      each family's record on the website with
 *                                            the UPN it matches, and how sure the match is
 *   schools/upn-uploads/upn_unmatched.tsv    pupils on a school's list with no record here
 *
 * Matching is by school, then the pupil's names and date of birth, compared
 * the way the participant ID compares them (accents, spaces, hyphens and
 * capitals ignored). Only a match that picks out exactly one pupil is used;
 * anything less certain is listed for a person to check.
 */

/** A literal, not built from export.ts's SCHOOLS: the two modules import each other, so neither may use the other's values while loading. */
export const UPN_ROOT = 'schools/upn-uploads';

/** A name as compared: NFKD, upper case, letters only ("Zoë O'Brien-Smith" and "ZOE OBRIENSMITH" match). */
export const nameKey = (s: unknown) =>
  Array.from(String(s ?? '').normalize('NFKD').toUpperCase())
    .filter((c) => /\p{L}/u.test(c))
    .join('');

export type MatchLevel = 'name-and-dob' | 'surname-and-dob' | 'name-only' | 'ambiguous' | 'none';

export interface SchoolPupil {
  upn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  yearGroup: string;
  className: string;
  uploadId: string;
  row: number;
}

/** How a website record matches a school's list: the best level that picks out exactly one pupil. */
export function matchPupil(person: { firstName: unknown; lastName: unknown; dateOfBirth: unknown }, pupils: SchoolPupil[]): { level: MatchLevel; pupil: SchoolPupil | null; candidates: number } {
  const first = nameKey(person.firstName);
  const last = nameKey(person.lastName);
  const dob = typeof person.dateOfBirth === 'string' ? person.dateOfBirth.slice(0, 10) : null;
  const levels: [MatchLevel, (p: SchoolPupil) => boolean][] = [
    ['name-and-dob', (p) => nameKey(p.firstName) === first && nameKey(p.lastName) === last && Boolean(dob) && p.dateOfBirth === dob],
    ['surname-and-dob', (p) => nameKey(p.lastName) === last && Boolean(dob) && p.dateOfBirth === dob],
    ['name-only', (p) => nameKey(p.firstName) === first && nameKey(p.lastName) === last],
  ];
  for (const [level, test] of levels) {
    const found = pupils.filter(test);
    if (found.length === 1) return { level, pupil: found[0], candidates: 1 };
    if (found.length > 1) return { level: 'ambiguous', pupil: null, candidates: found.length };
  }
  return { level: 'none', pupil: null, candidates: 0 };
}

const day = (v: unknown) => String(v ?? '').slice(0, 10);
const short = (id: string) => id.replace(/-/g, '').slice(0, 8);
const safe = (s: unknown) => String(s ?? 'upload').replace(/[^A-Za-z0-9 ._()-]/g, '').trim() || 'upload';

/** Each school's pupils across its uploads; when a UPN appears in more than one, the latest file wins. */
export function pupilsBySchool(uploads: Doc[]): Map<string, SchoolPupil[]> {
  const out = new Map<string, Map<string, SchoolPupil>>();
  const sorted = [...uploads].sort((a, b) => String(a.data.receivedAt ?? '').localeCompare(String(b.data.receivedAt ?? '')));
  for (const u of sorted) {
    const school = String(u.data.schoolId ?? '');
    if (!out.has(school)) out.set(school, new Map());
    for (const p of (u.data.pupils ?? []) as Record<string, unknown>[]) {
      const upn = String(p.upn ?? '');
      if (!/^[A-Z]\d{11}[0-9A-Z]$/.test(upn)) continue;
      out.get(school)!.set(upn, { upn, firstName: String(p.firstName ?? ''), lastName: String(p.lastName ?? ''), dateOfBirth: typeof p.dateOfBirth === 'string' ? p.dateOfBirth : null, yearGroup: String(p.yearGroup ?? ''), className: String(p.className ?? ''), uploadId: u.id, row: Number(p.row ?? 0) });
    }
  }
  return new Map(Array.from(out, ([k, v]) => [k, Array.from(v.values())]));
}

export function upnExport(uploads: Doc[], participants: Doc[], labels: Map<string, string>): { files: OutFile[]; copies: Map<string, string>; counts: Record<string, number> } {
  const files: OutFile[] = [textFile(`${UPN_ROOT}/README.md`, UPN_README, 'text/markdown; charset=utf-8')];
  const copies = new Map<string, string>();
  const sorted = [...uploads].sort((a, b) => String(a.data.receivedAt ?? '').localeCompare(String(b.data.receivedAt ?? '')));
  const uploadRows: Row[] = [];
  for (const u of sorted) {
    const d = u.data;
    const slug = String(d.schoolSlug ?? d.schoolId ?? 'school').toLowerCase();
    const base = `${UPN_ROOT}/${slug}/${day(d.receivedAt)}_${short(u.id)}`;
    const original = `${base}_${safe(d.fileName)}`;
    if (typeof d.path === 'string') copies.set(d.path, original);
    files.push(
      tsvFile(
        `${base}_pupils.tsv`,
        ((d.pupils ?? []) as Record<string, unknown>[]).map((p) => ({ row: p.row, upn: p.upn, first_name: p.firstName, last_name: p.lastName, date_of_birth: p.dateOfBirth, year_group: p.yearGroup, class: p.className })),
        ['row', 'upn', 'first_name', 'last_name', 'date_of_birth', 'year_group', 'class'],
      ),
    );
    uploadRows.push({ upload_id: u.id, school_id: d.schoolId, school_name: d.schoolName, received_at: d.receivedAt, file_name: d.fileName, stored_as: original.slice(UPN_ROOT.length + 1), pupils_n: d.pupilCount, valid_upns_n: d.validUpns, problems_n: Array.isArray(d.problems) ? d.problems.length : 0, uploader_name: d.uploader?.name, uploader_role: d.uploader?.role, uploader_email: d.uploader?.email, note: d.note, sha256: d.sha256 });
  }
  files.push(tsvFile(`${UPN_ROOT}/uploads.tsv`, uploadRows, ['upload_id', 'school_id', 'school_name', 'received_at', 'file_name', 'stored_as', 'pupils_n', 'valid_upns_n', 'problems_n', 'uploader_name', 'uploader_role', 'uploader_email', 'note', 'sha256']));

  const bySchool = pupilsBySchool(uploads);
  const matched = new Map<string, Set<string>>();
  const matchRows: Row[] = [];
  for (const { id, data: d } of participants) {
    const school = String(d.schoolId ?? '');
    const pupils = bySchool.get(school);
    if (!pupils) continue;
    const m = matchPupil({ firstName: d.firstName, lastName: d.lastName, dateOfBirth: d.dateOfBirth }, pupils);
    if (m.pupil) {
      if (!matched.has(school)) matched.set(school, new Set());
      matched.get(school)!.add(m.pupil.upn);
    }
    matchRows.push({ participant_id: labels.get(id) ?? null, firestore_id: id, kind: d.kind, school_id: school, first_name: d.firstName, last_name: d.lastName, date_of_birth: d.dateOfBirth, year_group: d.yearGroup, upn: m.pupil?.upn ?? null, match: m.level, candidates_n: m.candidates, school_first_name: m.pupil?.firstName ?? null, school_last_name: m.pupil?.lastName ?? null, school_date_of_birth: m.pupil?.dateOfBirth ?? null, school_class: m.pupil ? [m.pupil.yearGroup, m.pupil.className].filter(Boolean).join(' ') : null, upload_id: m.pupil?.uploadId ?? null });
  }
  matchRows.sort((a, b) => String(a.school_id).localeCompare(String(b.school_id)) || String(a.participant_id ?? 'zzz').localeCompare(String(b.participant_id ?? 'zzz')));
  files.push(tsvFile(`${UPN_ROOT}/upn_matches.tsv`, matchRows, ['participant_id', 'firestore_id', 'kind', 'school_id', 'first_name', 'last_name', 'date_of_birth', 'year_group', 'upn', 'match', 'candidates_n', 'school_first_name', 'school_last_name', 'school_date_of_birth', 'school_class', 'upload_id']));
  const unmatched: Row[] = [];
  for (const [school, pupils] of bySchool) for (const p of pupils) if (!matched.get(school)?.has(p.upn)) unmatched.push({ school_id: school, upn: p.upn, first_name: p.firstName, last_name: p.lastName, date_of_birth: p.dateOfBirth, year_group: p.yearGroup, class: p.className, upload_id: p.uploadId, row: p.row });
  files.push(tsvFile(`${UPN_ROOT}/upn_unmatched.tsv`, unmatched, ['school_id', 'upn', 'first_name', 'last_name', 'date_of_birth', 'year_group', 'class', 'upload_id', 'row']));
  return { files, copies, counts: { upnUploads: uploads.length, upnPupils: Array.from(bySchool.values()).reduce((n, p) => n + p.length, 0), upnMatched: matchRows.filter((r) => r.upn).length } };
}

const UPN_README = `The UPN lists schools sent through their upload page
(myphonemybrain.com/schools/upload/?school=<school>). Study coordinators only:
UPNs, names and dates of birth are identifying. Regenerated every hour as a
mirror of the database; do not edit files here.

uploads.tsv            one row per file: which school, who sent it and when,
                       how many pupils, and where the file is kept below
<school>/              each file exactly as the school sent it, and beside it
                       <date>_<id>_pupils.tsv: the UPN, names, date of birth,
                       year group and class read from it (no other column is read)
upn_matches.tsv        each family's record on the website (participant_id is
                       the label in ../donations/) with the UPN it matches:
                         name-and-dob     first name, last name and date of birth agree
                         surname-and-dob  last name and date of birth agree, the first
                                          name differs (a short name, perhaps): check
                         name-only        both names agree, the date of birth does not
                                          or is missing: check
                         ambiguous        more than one pupil fits: check by hand
                         none             no pupil on the school's lists fits
                       Names are compared ignoring accents, spaces, hyphens and
                       capitals. When a UPN appears in more than one file from a
                       school, the latest file is used.
upn_unmatched.tsv      pupils on a school's lists with no record on the website

Files are tab-separated UTF-8 with n/a for missing values; timestamps are
ISO 8601 in UTC.
`;
