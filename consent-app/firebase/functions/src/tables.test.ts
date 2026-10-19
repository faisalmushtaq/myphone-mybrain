import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { hashPassword, newSchoolPassword, normalisePassword, passwordMatches, previewOf, validateSchoolUploadPayload } from './schoolUpload.js';
import { columnIndex, decodeText, excelDate, fileKind, parseCsv, parseXlsx, pupilsFrom, readDate, readFsm, readSen, readTable, TableError } from './tables.js';
import { validateNewSlots } from './staff.js';

const client = { userAgent: 'test', submittedAt: new Date().toISOString(), timezoneOffset: 0 };

test('CSV: quotes, commas inside quotes, semicolons, tabs, CRLF, a byte order mark', () => {
  assert.deepEqual(parseCsv('UPN,Name\r\nA123,"Smith, Jane"\r\n'), [
    ['UPN', 'Name'],
    ['A123', 'Smith, Jane'],
  ]);
  assert.deepEqual(parseCsv('a;b;c\n1;"2;3";4'), [
    ['a', 'b', 'c'],
    ['1', '2;3', '4'],
  ]);
  assert.deepEqual(parseCsv('a\tb\n1\t2\n\n'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
  assert.deepEqual(parseCsv('"say ""hi""",x'), [['say "hi"', 'x']]);
  assert.equal(decodeText(Buffer.from('﻿UPN', 'utf8')), 'UPN');
  // Excel on Windows saves "CSV" in Windows-1252: é is one byte, 0xE9.
  assert.equal(decodeText(Buffer.from([0x52, 0xe9, 0x6d, 0x69])), 'Rémi');
});

test('dates of birth the way schools write them, and Excel’s numbers', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  assert.equal(readDate('14/03/2012', now), '2012-03-14');
  assert.equal(readDate('4/3/2012', now), '2012-03-04');
  assert.equal(readDate('14-03-2012', now), '2012-03-14');
  assert.equal(readDate('14.03.12', now), '2012-03-14');
  assert.equal(readDate('2012-03-14', now), '2012-03-14');
  assert.equal(readDate('2012-03-14T00:00:00', now), '2012-03-14');
  assert.equal(readDate('14 Mar 2012', now), '2012-03-14');
  assert.equal(readDate('14th March 2012', now), '2012-03-14');
  assert.equal(readDate('40982', now), '2012-03-14');
  assert.equal(excelDate(40982), '2012-03-14');
  assert.equal(readDate('31/02/2012', now), null);
  assert.equal(readDate('03/14/2012', now), null, 'month-first dates are not guessed at');
  assert.equal(readDate('soon', now), null);
  assert.equal(readDate('14/03/2030', now), null, 'not born yet');
  assert.equal(columnIndex('A'), 0);
  assert.equal(columnIndex('AB'), 27);
});

test('a class list: the study’s columns found, legal names first, columns outside the template left alone', () => {
  const table = parseCsv(
    [
      'Class list for Year 9,,,,,,,',
      'Legal Forename,Preferred Forename,Legal Surname,UPN,DOB,Year,Reg Group,SEN',
      'Jane,Janie,Smith,A123456789012,14/03/2012,9,9X,No',
      'Amir,,Khan,a 1234 5678 9013,2012-07-01,9,9Y,Yes',
      'Ola,,Nowak,B12345,01/01/2012,9,9Y,No',
      'Sam,,Lee,A123456789012,15/03/2012,9,9X,No',
      'Kit,,,,,9,9X,',
      ',,,,,,,',
    ].join('\n'),
  );
  const list = pupilsFrom(table);
  assert.equal(list.columns.upn, 'UPN');
  assert.equal(list.columns.firstName, 'Legal Forename');
  assert.equal(list.columns.lastName, 'Legal Surname');
  assert.equal(list.columns.dateOfBirth, 'DOB');
  assert.equal(list.columns.yearGroup, 'Year');
  assert.equal(list.columns.className, 'Reg Group');
  assert.deepEqual(list.ignored, ['Preferred Forename']);
  assert.equal(list.pupils.length, 5);
  const { row, upn, firstName, lastName, dateOfBirth, yearGroup, className, sen } = list.pupils[0];
  assert.deepEqual({ row, upn, firstName, lastName, dateOfBirth, yearGroup, className, sen }, { row: 3, upn: 'A123456789012', firstName: 'Jane', lastName: 'Smith', dateOfBirth: '2012-03-14', yearGroup: '9', className: '9X', sen: 'N' });
  assert.equal(list.pupils[1].upn, 'A123456789013', 'spaces and lower case are tidied');
  assert.equal(list.valid, 2);
  const messages = list.problems.map((p) => `${p.row}: ${p.message}`);
  assert.ok(messages.some((m) => m.startsWith('5:') && m.includes('is not a UPN')), messages.join(' | '));
  assert.ok(messages.some((m) => m.startsWith('6:') && m.includes('same UPN as row 3')), messages.join(' | '));
  assert.ok(messages.some((m) => m.startsWith('7:') && m.includes('No UPN')), messages.join(' | '));
  assert.ok(messages.some((m) => m.startsWith('7:') && m.includes('A name is missing')), messages.join(' | '));
  const preview = previewOf(list);
  assert.deepEqual(preview.classes, ['9X (Year 9)', '9Y (Year 9)']);
  assert.equal(preview.sample.length, 5);
});

test('a single name column: "Surname, Forename", or the last word as the surname', () => {
  const list = pupilsFrom(parseCsv('UPN,Name,Date of Birth\nA123456789012,"Smith, Jane",14/03/2012\nA123456789013,Mary Jane Brown,14/03/2012'));
  assert.deepEqual([list.pupils[0].firstName, list.pupils[0].lastName], ['Jane', 'Smith']);
  assert.deepEqual([list.pupils[1].firstName, list.pupils[1].lastName], ['Mary Jane', 'Brown']);
});

test('files that are not class lists are refused with a reason', async () => {
  assert.throws(() => pupilsFrom(parseCsv('Name,DOB\nJane,1/1/2012')), (e: unknown) => e instanceof TableError && /No UPN column/.test(e.message));
  assert.throws(() => pupilsFrom(parseCsv('UPN,DOB\nA123456789012,1/1/2012')), /No name columns/);
  assert.throws(() => pupilsFrom(parseCsv('UPN,Forename,Surname')), /no pupils/);
  await assert.rejects(readTable(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), 'list.xls'), /older Excel file/);
  await assert.rejects(readTable(Buffer.from('PK\u0003\u0004 not really a zip'), 'list.xlsx'), /could not be opened/);
});

/** A minimal .xlsx, as Excel writes one: shared strings, an inline string, a date-formatted number. */
async function workbook(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Pupils" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="styles" Target="styles.xml"/></Relationships>');
  zip.file('xl/sharedStrings.xml', '<sst><si><t>UPN</t></si><si><t>Forename</t></si><si><r><t>Sur</t></r><r><t>name</t></r></si><si><t>Date of birth</t></si><si><t>Jane</t></si><si><t>O&apos;Brien &amp; Co</t></si></sst>');
  zip.file('xl/styles.xml', '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy;@"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>');
  zip.file(
    'xl/worksheets/sheet1.xml',
    '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>A123456789012</t></is></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c><c r="D2" s="1"><v>40982</v></c></row>' +
      '<row r="4"><c r="A4" t="str"><v>A123456789013</v></c><c r="C4" t="s"><v>5</v></c><c r="B4" t="inlineStr"><is><t>Amir</t></is></c><c r="D4" t="str"><v>01/07/2012</v></c></row>' +
      '</sheetData></worksheet>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('Excel workbooks: the first sheet, shared and inline strings, date cells, gaps between rows', async () => {
  const table = await parseXlsx(await workbook());
  assert.deepEqual(table, [
    ['UPN', 'Forename', 'Surname', 'Date of birth'],
    ['A123456789012', 'Jane', 'O’Brien & Co'.replace('’', "'"), '2012-03-14'],
    ['A123456789013', 'Amir', "O'Brien & Co", '01/07/2012'],
  ]);
  const list = pupilsFrom(await readTable(await workbook(), 'pupils.xlsx'));
  assert.equal(list.valid, 2);
  assert.equal(list.pupils[1].dateOfBirth, '2012-07-01');
});

test('school passwords: easy to read out, case and dashes do not matter, only a hash is kept', async () => {
  const password = newSchoolPassword();
  assert.match(password, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  assert.equal(normalisePassword(' abcd-efgh ijkm '), 'ABCDEFGHIJKM');
  const stored = await hashPassword(password);
  assert.ok(!stored.hash.includes(password));
  assert.equal(await passwordMatches(password.toLowerCase().replace(/-/g, ' '), stored), true);
  assert.equal(await passwordMatches('AAAA-BBBB-CCCC', stored), false);
});

test('school upload requests: a known school, a password, a small file, who sent it', () => {
  const ok = { school: 'dua', password: 'AAAA-BBBB-CCCC', action: 'send', file: { name: 'list.csv', contentType: 'text/csv', data: Buffer.from('UPN').toString('base64') }, uploader: { name: 'Ms Teacher', role: 'Head of Year 9', email: 'teacher@school.org.uk' }, client };
  assert.deepEqual(validateSchoolUploadPayload(ok), []);
  assert.deepEqual(validateSchoolUploadPayload({ school: 'GSAL', password: 'x', action: 'check', client }), []);
  assert.match(validateSchoolUploadPayload({ ...ok, school: 'nowhere' }).join(' '), /does not name a school/);
  assert.match(validateSchoolUploadPayload({ ...ok, uploader: { ...ok.uploader, email: 'nope' } }).join(' '), /school email address/);
  assert.match(validateSchoolUploadPayload({ ...ok, file: undefined }).join(' '), /Choose a file/);
  assert.match(validateSchoolUploadPayload({ ...ok, file: { ...ok.file, data: 'A'.repeat(11 * 1024 * 1024) } }).join(' '), /larger than 7 MB/);
});

test('new lab times from the staff page: in the future, sensible lengths and places', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  const { slots, problems } = validateNewSlots([{ start: '2026-10-14T09:00:00.000Z', minutes: 120, capacity: 1, visit: null, location: ' ', note: 'Room 2' }], now);
  assert.deepEqual(problems, []);
  assert.deepEqual(slots, [{ start: '2026-10-14T09:00:00.000Z', minutes: 120, capacity: 1, visit: null, location: null, note: 'Room 2' }]);
  assert.match(validateNewSlots([{ start: '2026-10-01T09:00:00Z' }], now).problems.join(' '), /in the past/);
  assert.match(validateNewSlots([{ start: '2026-10-14T09:00:00Z', minutes: 5 }], now).problems.join(' '), /length/);
  assert.match(validateNewSlots([{ start: '2026-10-14T09:00:00Z', capacity: 0 }], now).problems.join(' '), /places/);
  assert.match(validateNewSlots([{ start: '2026-10-14T09:00:00Z', visit: 3 }], now).problems.join(' '), /unknown visit/);
  assert.match(validateNewSlots([], now).problems.join(' '), /No times/);
  // Lab hours, in UK time: 23:00 UTC on 13 October is midnight in Leeds (BST), a typing slip, refused.
  assert.match(validateNewSlots([{ start: '2026-10-13T23:00:00Z' }], now).problems.join(' '), /outside lab hours/);
  assert.match(validateNewSlots([{ start: '2026-12-14T00:00:00Z' }], now).problems.join(' '), /00:00 UK time/);
  // 09:00 to 17:00: a two-hour visit starts between 09:00 and 15:00 (December, so UK time is UTC).
  assert.deepEqual(validateNewSlots([{ start: '2026-12-14T09:00:00Z' }, { start: '2026-12-14T15:00:00Z' }, { start: '2026-12-14T16:00:00Z', minutes: 60 }], now).problems, [], '09:00, 15:00, and an hour at 16:00, are fine');
  assert.match(validateNewSlots([{ start: '2026-12-14T08:30:00Z' }], now).problems.join(' '), /outside lab hours/, '08:30 is too early');
  assert.match(validateNewSlots([{ start: '2026-12-14T15:30:00Z' }], now).problems.join(' '), /outside lab hours/, 'a two-hour visit at 15:30 runs past 17:00');
  assert.deepEqual(validateNewSlots([{ start: '2026-10-14T08:00:00Z' }], now).problems, [], '08:00 UTC in October is 09:00 BST: fine');
});


/* ── 19 October 2026: the class-list template, Word, PDF, text and lists without headings ── */

const TEMPLATE_HEAD = 'UPN,First_Name,Middle_Name,Last_Name,Date_Of_Birth,Gender,Ethnicity,School_Name,Year_Group,Form_Tutor,Address_Line_1,Address_Line_2,Address_Line_3,Address_Line_4,Postcode,School_Email,FSM (Y or N),SEN (N = no SEN; S = statement; E = EHC plan; K = SEN support)';

test('the class-list template: every column read, FSM and SEN as the template codes them', async () => {
  const csv = `${TEMPLATE_HEAD}\nA123456789012,Jane,Ann,Smith,14/03/2012,F,WBRI,Dixons Unity Academy,8,Mr Khan,1 Long Lane,Flat 2,Leeds,West Yorkshire,ls6 1ab,j.smith@school.org.uk,Yes,EHC plan\nA123456789013,Amir,,Khan,01/07/2012,M,APKN,Dixons Unity Academy,8,Mr Khan,3 Elm Row,,Leeds,,LS2 9JT,a.khan@school.org.uk,N,K`;
  const list = pupilsFrom(await readTable(Buffer.from(csv), 'AoW - Class List Request.csv'));
  assert.equal(list.valid, 2);
  assert.deepEqual(list.ignored, [], 'no template column is left unread');
  const [a, b] = list.pupils;
  assert.deepEqual(
    { first: a.firstName, middle: a.middleName, last: a.lastName, dob: a.dateOfBirth, gender: a.gender, ethnicity: a.ethnicity, school: a.schoolName, year: a.yearGroup, tutor: a.formTutor, address: a.address, postcode: a.postcode, email: a.email, fsm: a.fsm, sen: a.sen },
    { first: 'Jane', middle: 'Ann', last: 'Smith', dob: '2012-03-14', gender: 'F', ethnicity: 'WBRI', school: 'Dixons Unity Academy', year: '8', tutor: 'Mr Khan', address: '1 Long Lane, Flat 2, Leeds, West Yorkshire', postcode: 'LS6 1AB', email: 'j.smith@school.org.uk', fsm: 'Y', sen: 'E' },
  );
  assert.deepEqual([b.fsm, b.sen, b.address], ['N', 'K', '3 Elm Row, Leeds']);
  assert.deepEqual([readFsm('true'), readFsm('0'), readFsm('?'), readSen('Statement'), readSen('SEN Support'), readSen('none')], ['Y', 'N', '?', 'S', 'K', 'N']);
});

test('Excel: every sheet read (one per class), each with its own headings', async () => {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="8K" sheetId="1" r:id="rId1"/><sheet name="8L" sheetId="2" r:id="rId2"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>');
  const sheet = (upn: string, name: string) => `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>UPN</t></is></c><c r="B1" t="inlineStr"><is><t>Forename</t></is></c><c r="C1" t="inlineStr"><is><t>Surname</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>${upn}</t></is></c><c r="B2" t="inlineStr"><is><t>${name}</t></is></c><c r="C2" t="inlineStr"><is><t>Smith</t></is></c></row></sheetData></worksheet>`;
  zip.file('xl/worksheets/sheet1.xml', sheet('A123456789012', 'Jane'));
  zip.file('xl/worksheets/sheet2.xml', sheet('A123456789013', 'Amir'));
  const list = pupilsFrom(await readTable(await zip.generateAsync({ type: 'nodebuffer' }), 'classes.xlsx'));
  assert.deepEqual(list.pupils.map((x) => x.firstName), ['Jane', 'Amir']);
  assert.equal(list.problems.length, 0, 'the second sheet\'s headings are not read as a pupil');
});

/** A minimal .docx: a heading paragraph and a table, as Word writes one. */
async function wordFile(withTable: boolean): Promise<Buffer> {
  const zip = new JSZip();
  const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
  const row = (...cells: string[]) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
  const body = withTable
    ? `<w:p><w:r><w:t>Class list 8K</w:t></w:r></w:p><w:tbl>${row('UPN', 'Forename', 'Surname', 'DOB')}${row('A123456789012', 'Jane', 'O&apos;Brien', '14/03/2012')}${row('A123456789013', 'Amir', 'Khan', '01/07/2012')}</w:tbl>`
    : '<w:p><w:r><w:t>Year 8 pupils</w:t></w:r></w:p><w:p><w:r><w:t>A123456789012 Jane Smith 14/03/2012</w:t></w:r></w:p><w:p><w:r><w:t>A123456789013  Khan, Amir  01/07/2012</w:t></w:r></w:p>';
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('Word: a table in the document is read as the class list; a list without a table, line by line', async () => {
  const fromTable = pupilsFrom(await readTable(await wordFile(true), 'Class list.docx'));
  assert.deepEqual(fromTable.pupils.map((x) => [x.upn, x.firstName, x.lastName, x.dateOfBirth]), [['A123456789012', 'Jane', "O'Brien", '2012-03-14'], ['A123456789013', 'Amir', 'Khan', '2012-07-01']]);
  const fromLines = pupilsFrom(await readTable(await wordFile(false), 'list.docx'));
  assert.equal(fromLines.noHeadings, true);
  assert.deepEqual(fromLines.pupils.map((x) => [x.upn, x.firstName, x.lastName, x.dateOfBirth]), [['A123456789012', 'Jane', 'Smith', '2012-03-14'], ['A123456789013', 'Amir', 'Khan', '2012-07-01']]);
});

/** A one-page PDF with text placed at the given points, as a table printed to PDF has it. */
function pdfFile(texts: [number, number, string][]): Buffer {
  const stream = texts.map(([x, y, t]) => `BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm (${t}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

test('PDF: a table printed to PDF comes back as rows and cells, and is read like a spreadsheet', async () => {
  const pdf = pdfFile([
    [50, 800, 'UPN'], [160, 800, 'Forename'], [260, 800, 'Surname'], [360, 800, 'Date of birth'],
    [50, 780, 'A123456789012'], [160, 780, 'Jane'], [260, 780, 'Smith'], [360, 780, '14/03/2012'],
    [50, 760, 'A123456789013'], [160, 760, 'Mary Ann'], [260, 760, 'Khan'], [360, 760, '01/07/2012'],
  ]);
  assert.equal(await fileKind(pdf, 'list.pdf'), 'pdf');
  const list = pupilsFrom(await readTable(pdf, 'list.pdf'));
  assert.deepEqual(list.pupils.map((x) => [x.upn, x.firstName, x.lastName, x.dateOfBirth]), [['A123456789012', 'Jane', 'Smith', '2012-03-14'], ['A123456789013', 'Mary Ann', 'Khan', '2012-07-01']]);
});

test('plain text without headings, line by line; anything else is not read, with a reason to send it anyway', async () => {
  const list = pupilsFrom(await readTable(Buffer.from('Pupils for the workshop\nA123456789012 Jane Smith 14/03/2012\nA123456789013 Amir Khan 01/07/2012\n'), 'list.txt'));
  assert.deepEqual(list.pupils.map((x) => [x.firstName, x.lastName]), [['Jane', 'Smith'], ['Amir', 'Khan']]);
  await assert.rejects(readTable(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), 'list.doc'), /older Word file.*send it anyway/);
  await assert.rejects(readTable(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), 'photo.jpg'), /picture of the list.*send it anyway/);
  assert.throws(() => pupilsFrom([['Dear parents,'], ['The trip is on Friday.']]), /No UPN column was found, and no UPNs on the lines/);
});
