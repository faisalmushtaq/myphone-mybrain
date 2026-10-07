import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { hashPassword, newSchoolPassword, normalisePassword, passwordMatches, previewOf, validateSchoolUploadPayload } from './schoolUpload.js';
import { columnIndex, decodeText, excelDate, parseCsv, parseXlsx, pupilsFrom, readDate, readTable, TableError } from './tables.js';
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

test('a class list: the study’s columns found, legal names first, every other column left alone', () => {
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
  assert.deepEqual(list.ignored, ['Preferred Forename', 'SEN']);
  assert.equal(list.pupils.length, 5);
  assert.deepEqual(list.pupils[0], { row: 3, upn: 'A123456789012', firstName: 'Jane', lastName: 'Smith', dateOfBirth: '2012-03-14', yearGroup: '9', className: '9X' });
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
  assert.match(validateSchoolUploadPayload({ ...ok, file: { ...ok.file, data: 'A'.repeat(8 * 1024 * 1024) } }).join(' '), /larger than 5 MB/);
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
});
