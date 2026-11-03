import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allocationsTab,
  buildWorkbook,
  dataTables,
  newSheetId,
  overviewAlerts,
  overviewTab,
  safeDetails,
  schoolDays,
  schoolShort,
  sessionsTab,
  sheetErrorText,
  sheetRequests,
  spreadsheetIdOf,
  staffingLine,
  type Cell,
  type CellX,
  type Tab,
} from './portalSheets.js';
import { sampleSheetData } from './portalSheets.fixture.js';
import { documentTargets, staffPortalExport } from './exportStaff.js';
import { DEFAULT_SETTINGS, dbsStatusOf, eligibilityFor, healthFormMove, latestDocs, mayDo, requirementsFor, roleNeedsOf, settingsOf, type PortalDoc } from './portalCore.js';

const x = (c: Cell): CellX => (c !== null && typeof c === 'object' ? c : { v: c });
const text = (t: Tab) => t.rows.map((r) => r.map((c) => x(c).v ?? '').join('|')).join('\n');
const rowOf = (t: Tab, first: string, col = 1) => t.rows.find((r) => x(r[col] ?? null).v === first)!;
const GSAL = () => sampleSheetData().schools[0];

test('sheet: tabs in order, a pair for each school with visit days, then the tables; notes only when turned on', () => {
  const d = sampleSheetData();
  const titles = buildWorkbook(d).map((t) => t.title);
  assert.deepEqual(titles, ['Overview', 'GSAL sessions', 'GSAL allocations', 'ALLERTON sessions', 'ALLERTON allocations', 'People', 'Documents', 'Availability', 'Visits', 'Staffing', 'Coverage', 'Attendance', 'Training and pilots', 'Report — per person', 'Emails sent', 'Audit log']);
  d.notes = [{ uid: 'ra1', at: '2026-11-01T10:00:00.000Z', byName: 'Sam Lead', text: 'Great with the Year 8s' }];
  assert.equal(buildWorkbook(d).at(-1)!.title, 'Notes');
  // A school with only cancelled days gets no tabs.
  d.visits = d.visits.filter((v) => v.visitId !== 'v-allerton');
  assert.ok(!buildWorkbook(d).some((t) => t.title.startsWith('ALLERTON')));
});

test('school days: visit days in a window, needs and places added up, cancelled visits left out', () => {
  const d = sampleSheetData();
  const days = schoolDays(d.visits, 'GSAL', '2026-11-01', '2026-11-30');
  assert.deepEqual(days.map((x) => x.date), ['2026-11-03', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']);
  const mon = days[1];
  assert.deepEqual(mon.need, { eeg: 3, copro: 1, lead: 2 });
  assert.deepEqual(mon.confirmed, { eeg: 2, copro: 0, lead: 2 });
  assert.deepEqual(mon.offered, { eeg: 1, copro: 1, lead: 0 });
  assert.equal(days[3].need.eeg, 2, 'a day keeps its own number');
  assert.equal(staffingLine(mon), 'Short: EEG 1, Co-pro 1');
  assert.equal(staffingLine({ need: { eeg: 1, copro: 0, lead: 1 }, confirmed: { eeg: 1, copro: 0, lead: 1 } }), 'Fully staffed');
  assert.deepEqual(schoolDays(d.visits, 'ALLERTON', '2026-11-01', '2026-11-30').map((x) => x.date), ['2026-11-24']);
});

test('overview: title, sync time and portal link; counts; the next six weeks with what is short; alerts', () => {
  const d = sampleSheetData();
  const t = overviewTab(d);
  assert.equal(x(t.rows[0][0]).v, 'MyPhone/MyBrain staff portal');
  assert.match(String(x(t.rows[1][0]).v), /Last synced 5 Nov 2026 14:05/);
  assert.equal(x(t.rows[2][0]).link, 'https://myphonemybrain.com/portal/');
  assert.equal(x(rowOf(t, 'Research assistants (active)', 0)[1]).v, 6);
  assert.equal(x(rowOf(t, 'Ready to book today', 0)[1]).v, 3);
  assert.equal(x(rowOf(t, 'Research leads (the team)', 0)[1]).v, 2);
  const mon = rowOf(t, 'Mon 9 Nov', 0);
  assert.deepEqual(mon.slice(1, 8).map((c) => x(c).v), ['Grammar School at Leeds', '08:30–15:00', 'staffing', '2/3', '0/1', '2/2', 2]);
  assert.equal(x(mon[8]).v, 2);
  assert.equal(x(mon[8]).bg, '#bb1e50');
  const thu = rowOf(t, 'Thu 12 Nov', 0);
  assert.equal(x(thu[6]).v, '1/2');
  // The past day is not "coming up"; the cancelled one is not anywhere.
  assert.ok(!text(t).includes('Tue 3 Nov|'));
  assert.ok(!text(t).includes('Tue 17 Nov'));
  assert.ok(t.merges.some((m) => m.row === 0 && m.cols === 9));
});

test('overview alerts: days short, offers over two days unanswered, booked without a confirmed DBS, unmarked attendance', () => {
  const alerts = overviewAlerts(sampleSheetData());
  const of = (k: string) => alerts.filter((a) => a.kind === k).map((a) => a.text);
  assert.ok(of('Short').some((t) => t === 'Mon 9 Nov, Grammar School at Leeds: short of EEG 1, Co-pro 1'));
  // Dev was offered on 1 November (over two days before the sync); Chloe this morning.
  assert.deepEqual(of('No answer').map((t) => t.split(':')[0]), ['Dev Patel']);
  assert.ok(of('DBS').some((t) => t.startsWith('Finn Murphy is booked for Grammar School at Leeds (Thu 12 Nov) but their DBS is expired')));
  assert.ok(of('DBS').some((t) => t.startsWith('Chloe Price is offered')));
  assert.deepEqual(of('Attendance'), ['Grammar School at Leeds, Tue 3 Nov: 2 not marked (Ben Okafor, Sam Lead)']);
});

test('sessions tab: RAs then research leads; colour per day; not-ready names in red with why; totals per day', () => {
  const d = sampleSheetData();
  const t = sessionsTab(d, GSAL());
  assert.equal(t.title, 'GSAL sessions');
  const head = t.rows[t.frozenRows - 1].map((c) => x(c).v);
  assert.deepEqual(head.slice(0, 8), ['#', 'Name', 'Email', 'Level', 'Jobs', 'DBS status', 'Training sign-off', 'Approved by GSAL']);
  assert.deepEqual(head.slice(8), ['Tue 3 Nov', 'Mon 9 Nov', 'Tue 10 Nov', 'Wed 11 Nov', 'Thu 12 Nov', 'Days available', 'Days booked']);
  assert.equal(t.frozenCols, 2);
  const all = text(t);
  assert.ok(all.indexOf('Research assistants') < all.indexOf('Amira Khan') && all.indexOf('Research leads') < all.indexOf('Sam Lead') && all.indexOf('Amira Khan') < all.indexOf('Research leads'));
  const amira = rowOf(t, 'Amira Khan');
  assert.deepEqual([x(amira[3]).v, x(amira[4]).v, x(amira[5]).v, x(amira[6]).v], ['3 Experienced', 'EEG, Co-pro', 'Confirmed', 'Signed off']);
  assert.equal(x(amira[7]).v, 'Yes, 2026-10-28');
  // Confirmed dark teal, offered amber, available light green, maybe pale yellow, can't grey.
  assert.equal(x(amira[9]).v, 'EEG ✓');
  assert.equal(x(amira[9]).bg, '#00545b');
  const dev = rowOf(t, 'Dev Patel');
  assert.equal(x(dev[9]).v, 'EEG?');
  assert.equal(x(dev[9]).bg, '#f5a300');
  assert.equal(x(dev[10]).v, 'AM only');
  const chloe = rowOf(t, 'Chloe Price');
  assert.equal(x(chloe[1]).fg, '#bb1e50');
  assert.match(x(chloe[1]).note!, /Not yet approved by Grammar School at Leeds/);
  assert.equal(x(chloe[11]).v, 'Maybe');
  assert.equal(x(chloe[11]).bg, '#fff3c4');
  assert.equal(x(rowOf(t, 'Ben Okafor')[12]).v, 'Can’t');
  assert.equal(x(rowOf(t, 'Ben Okafor')[12]).bg, '#e3e6e6');
  assert.equal(x(chloe[7]).v, 'Not yet');
  // Days available counts days booked too; days booked counts confirmed days.
  assert.deepEqual([x(amira.at(-2)!).v, x(amira.at(-1)!).v], [5, 4]);
  const sam = rowOf(t, 'Sam Lead');
  assert.equal(x(sam[4]).v, 'Lead');
  assert.equal(x(sam[10]).v, 'Lead ✓');
  // Totals.
  const mon = 9;
  assert.equal(x(rowOf(t, 'RAs available')[mon]).v, 4);
  assert.equal(x(rowOf(t, 'Leads available')[mon]).v, 2);
  assert.equal(x(rowOf(t, 'Total available')[mon]).v, 6);
  assert.equal(x(rowOf(t, 'EEG confirmed / needed')[mon]).v, '2/3');
  assert.equal(x(rowOf(t, 'Co-pro confirmed / needed')[mon]).v, '0/1');
  assert.equal(x(rowOf(t, 'Leads confirmed / needed')[mon]).v, '2/2');
  assert.equal(x(rowOf(t, 'Fully staffed')[mon]).v, 'No');
  assert.equal(x(rowOf(t, 'Fully staffed')[8]).v, 'Yes');
  assert.equal(t.merges.length, 0, 'no merges across the frozen columns');
});

test('allocations tab: a block per week, names by job, offered in italics, red for no confirmed DBS, a status line, and who the school approved', () => {
  const t = allocationsTab(sampleSheetData(), GSAL());
  const all = text(t);
  assert.ok(all.includes('Week of Mon 2 Nov 2026') && all.includes('Week of Mon 9 Nov 2026'));
  const dev = t.rows.flat().map(x).find((c) => c.v === 'Dev Patel (offered)')!;
  assert.equal(dev.italic, true);
  const finn = t.rows.flat().map(x).find((c) => c.v === 'Finn Murphy')!;
  assert.equal(finn.fg, '#bb1e50');
  assert.match(finn.note!, /Expired/);
  const statuses = t.rows.filter((r) => x(r[0] ?? null).v === 'Status').flatMap((r) => r.slice(1).map((c) => x(c).v));
  assert.ok(statuses.includes('Short: EEG 1, Co-pro 1'));
  assert.ok(statuses.includes('Fully staffed'));
  assert.ok(t.rows.flat().some((c) => x(c).v === 'needed'), 'empty places show as needed');
  assert.ok(t.rows.flat().some((c) => x(c).v === 'No visit'), 'Friday 13th is off');
  assert.ok(all.includes('Approved by Grammar School at Leeds'));
  const approved = t.rows.slice(t.rows.findIndex((r) => x(r[0] ?? null).v === 'Approved by Grammar School at Leeds')).map((r) => x(r[0] ?? null).v);
  assert.deepEqual(approved.slice(2), ['Amira Khan', 'Ben Okafor', 'Dev Patel', 'Finn Murphy', 'Sam Lead']);
  const leadRow = t.rows.findIndex((r) => x(r[0] ?? null).v === 'Leads');
  assert.ok(leadRow > 0 && leadRow < t.rows.findIndex((r) => x(r[0] ?? null).v === 'EEG'), 'leads first');
});

test('tables: no certificate numbers, no message bodies, availability 4 weeks back and 12 ahead', () => {
  const d = sampleSheetData();
  d.availability.push({ uid: 'ra1', date: '2027-03-01', value: 'all', note: '' }, { uid: 'ra1', date: '2026-09-01', value: 'all', note: '' });
  const tables = dataTables(d);
  const flat = JSON.stringify(tables);
  assert.ok(!flat.includes('001234567890') && !flat.includes('001234567891'));
  assert.ok(!/certificateNumber/.test(flat));
  const people = tables.find((t) => t.file === 'people')!;
  const chloe = people.rows.find((r) => r[0] === 'Chloe Price')!;
  assert.equal(chloe[people.header.indexOf('DBS status')], 'Processing');
  assert.equal(chloe[people.header.indexOf('Said they applied for DBS on')], '2026-10-30');
  assert.equal(people.rows.find((r) => r[0] === 'Amira Khan')![people.header.indexOf('Approved by schools')], 'Grammar School at Leeds (2026-10-28)');
  const avail = tables.find((t) => t.file === 'availability')!;
  assert.ok(avail.rows.every((r) => String(r[2]) >= '2026-10-08' && String(r[2]) <= '2027-01-28'));
  const coverage = tables.find((t) => t.file === 'coverage')!;
  assert.ok(!coverage.rows.some((r) => r[2] === 'v-off'));
  const report = tables.find((t) => t.file === 'report_per_person')!;
  assert.deepEqual(report.header.slice(-3), ['EEG days', 'Co-pro days', 'Lead days']);
  assert.equal(safeDetails({ before: { certificateNumber: '1', issueDate: '2025-06-01' }, password: 'x', note: 'ok' }), '{"before":{"issueDate":"2025-06-01"},"note":"ok"}');
  assert.ok(!tables.some((t) => t.file === 'notes'));
});

test('sheet requests: our tabs added, cleared and rewritten in order; tabs the team added left alone', () => {
  const tabs = buildWorkbook(sampleSheetData());
  const reqs = sheetRequests(tabs, [{ sheetId: 0, title: 'Sheet1', bandIds: [] }, { sheetId: 55, title: 'Overview', bandIds: [] }, { sheetId: 77, title: 'People', bandIds: [9] }]);
  const kinds = (k: string) => reqs.filter((r) => k in r).map((r) => r[k] as Record<string, unknown>);
  const added = kinds('addSheet').map((r) => (r.properties as { title: string }).title);
  assert.equal(added.length, tabs.length - 2);
  assert.ok(!added.includes('Overview') && !added.includes('People'));
  assert.deepEqual(kinds('deleteBanding'), [{ bandedRangeId: 9 }]);
  const touched = new Set(reqs.flatMap((r) => Object.values(r).map((v) => JSON.stringify(v).match(/"sheetId":(\d+)/)?.[1]).filter(Boolean)));
  assert.ok(!touched.has('0'), 'Sheet1 is never touched');
  const props = kinds('updateSheetProperties').map((r) => r.properties as { sheetId: number; index: number; gridProperties: { frozenRowCount: number } });
  assert.equal(props[0].sheetId, 55);
  assert.equal(props[0].index, 0);
  assert.deepEqual(props.map((p) => p.index), tabs.map((_, i) => i));
  assert.ok(kinds('addBanding').length >= 10);
  // Every tab is cleared before it is written.
  const firstWrite = reqs.findIndex((r) => 'updateCells' in r && (r.updateCells as { rows?: unknown }).rows);
  const firstClear = reqs.findIndex((r) => 'updateCells' in r && (r.updateCells as { fields: string }).fields === '*');
  assert.ok(firstClear >= 0 && firstClear < firstWrite);
  const ids = new Set<number>([1]);
  assert.equal(newSheetId('People', ids), newSheetId('People', new Set()));
  assert.notEqual(newSheetId('People', ids), newSheetId('People', ids), 'taken ids are skipped');
});

test('sheet address, errors and short names', () => {
  assert.equal(spreadsheetIdOf('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0'), '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
  assert.equal(spreadsheetIdOf('https://example.com/sheet'), null);
  assert.equal(spreadsheetIdOf(''), null);
  assert.match(sheetErrorText(403, 'PERMISSION_DENIED SERVICE_DISABLED Google Sheets API has not been used in project 1 before or it is disabled', 'sa@x', 'myphone-mybrain'), /https:\/\/console\.cloud\.google\.com\/apis\/library\/sheets\.googleapis\.com\?project=myphone-mybrain/);
  assert.match(sheetErrorText(403, 'PERMISSION_DENIED The caller does not have permission', '123-compute@developer.gserviceaccount.com', 'p'), /Share it with 123-compute@developer\.gserviceaccount\.com as an Editor/);
  assert.match(sheetErrorText(404, 'NOT_FOUND', '', 'p'), /No spreadsheet at that address/);
  assert.equal(schoolShort({ id: 'GSAL', name: 'Grammar School at Leeds' }), 'GSAL');
  assert.equal(schoolShort({ id: 'ABCDEFGHIJ', name: 'Allerton Bywater Community High' }), 'ABCH');
});

test('staff export: tables as CSV and TSV with a README and dictionary; documents by person and date; nothing secret', () => {
  const d = sampleSheetData();
  const copies = [
    { uid: 'ra1', person: 'Amira Khan', document: 'Enhanced DBS certificate', uploadedAt: '2026-10-02T10:00:00.000Z', path: 'portal/docs/ra1/u1', fileName: 'dbs.PDF' },
    { uid: 'ra1', person: 'Amira Khan', document: 'Enhanced DBS certificate', uploadedAt: '2026-10-02T11:00:00.000Z', path: 'portal/docs/ra1/u2', fileName: 'dbs.jpeg' },
    { uid: 'ra1', person: 'Amira Khan', document: 'Health form', uploadedAt: '2026-10-02T12:00:00.000Z', path: 'portal/docs/ra1/u3', fileName: 'form.pdf' },
    { uid: 'zz9', person: 'Amira Khan', document: 'Health form', uploadedAt: '2026-10-05T12:00:00.000Z', path: 'portal/docs/zz9/u4', fileName: 'x.png' },
  ];
  assert.deepEqual(documentTargets(copies).map((c) => c.target), [
    'staff-portal/documents/Amira_Khan/enhanced_dbs_certificate_2026-10-02.pdf',
    'staff-portal/documents/Amira_Khan/enhanced_dbs_certificate_2026-10-02.jpg',
    'staff-portal/documents/Amira_Khan/health_form_2026-10-02.pdf',
    'staff-portal/documents/Amira_Khan_zz9/health_form_2026-10-05.png',
  ]);
  const out = staffPortalExport(d, copies);
  const paths = out.files.map((f) => f.path);
  for (const p of ['staff-portal/README.md', 'staff-portal/tables/data_dictionary.md', 'staff-portal/tables/people.csv', 'staff-portal/tables/people.tsv', 'staff-portal/tables/audit_log.csv']) assert.ok(paths.includes(p), p);
  assert.ok(!paths.some((p) => p.includes('notes')));
  assert.ok(!out.files.some((f) => f.body.includes('001234567890')));
  assert.equal(out.copies.length, 4);
  assert.match(out.files.find((f) => f.path.endsWith('people.csv'))!.body.split('\n')[0], /^Name,Email,Phone,Role/);
  assert.match(out.files.find((f) => f.path === 'staff-portal/README.md')!.body, /no-documents/);
});

test('health form: off everyone’s list and onto GSAL’s, once', () => {
  const health = { id: 'health', label: 'Health form', hint: 'x' };
  const dbs = { id: 'dbs', label: 'DBS', hint: '', dbs: true };
  assert.deepEqual(healthFormMove({ docTypes: [dbs, health] }, []), { docTypes: [dbs], gsalDocs: [health] });
  // Stored before any change of the defaults: GSAL gains it, the list is the new default already.
  assert.deepEqual(healthFormMove(undefined, [])?.docTypes, null);
  assert.equal(healthFormMove(undefined, [])?.gsalDocs?.[0].id, 'health');
  // Already moved, or the project manager took it off before: nothing for GSAL.
  assert.equal(healthFormMove({ docTypes: [dbs] }, [])?.gsalDocs, null);
  assert.equal(healthFormMove({ docTypes: [dbs, health] }, [health])?.gsalDocs, null);
  assert.equal(healthFormMove({ docTypes: [dbs, health], migrations: { healthToGsal: true } }, []), null);
  assert.ok(!DEFAULT_SETTINGS.docTypes.some((t) => t.id === 'health'));
});

test('eligibility: leads skip training and pilots; sign-off when required; a school that approves its own', () => {
  const S = settingsOf({ docTypes: [{ id: 'dbs', label: 'DBS', hint: '', dbs: true }], minTraining: 2, minPilots: 1 });
  const docs = latestDocs([{ id: 'd', uid: 'u', typeId: 'dbs', schoolId: null, status: 'verified', uploadedAt: '2026-10-01', details: { issueDate: '2026-01-01' } } as PortalDoc]);
  const req = requirementsFor(S, null);
  const none = { training: 0, pilots: 0 };
  assert.deepEqual(eligibilityFor('u', docs, req, none, S, '2026-11-10', { lead: true }), { eligible: true, reasons: [] });
  assert.equal(eligibilityFor('u', docs, req, none, S, '2026-11-10').reasons.length, 2);
  const enough = { training: 2, pilots: 1 };
  assert.equal(eligibilityFor('u', docs, req, enough, S, '2026-11-10', { signOff: 'assess' }).eligible, true, 'sign-off not required by default');
  const strict = { ...S, requireSignOff: true };
  assert.deepEqual(eligibilityFor('u', docs, req, enough, strict, '2026-11-10', { signOff: 'assess' }).reasons, ['Training sign-off: will assess in pilot']);
  assert.equal(eligibilityFor('u', docs, req, enough, strict, '2026-11-10', { signOff: 'signed-off' }).eligible, true);
  assert.deepEqual(eligibilityFor('u', docs, req, enough, S, '2026-11-10', { schoolApproval: { required: true, approved: false, schoolName: 'GSAL' } }).reasons, ['Not yet approved by GSAL']);
  assert.equal(eligibilityFor('u', docs, req, enough, S, '2026-11-10', { schoolApproval: { required: false, approved: false, schoolName: 'GSAL' } }).eligible, true);
  // Leads still need their documents.
  assert.equal(eligibilityFor('nobody', docs, req, none, S, '2026-11-10', { lead: true }).eligible, false);
});

test('DBS status: confirmed, processing (uploaded, or they say they applied), starting, expired', () => {
  const S = settingsOf({ docTypes: [{ id: 'dbs', label: 'DBS', hint: '', dbs: true }], dbsValidYears: 3 });
  const doc = (status: PortalDoc['status'], issueDate = '2026-01-01') => latestDocs([{ id: 'd', uid: 'u', typeId: 'dbs', schoolId: null, status, uploadedAt: '2026-10-01', details: { issueDate } } as PortalDoc]);
  assert.equal(dbsStatusOf('u', doc('verified'), S, '2026-11-05', false), 'confirmed');
  assert.equal(dbsStatusOf('u', doc('verified', '2020-01-01'), S, '2026-11-05', false), 'expired');
  assert.equal(dbsStatusOf('u', doc('uploaded'), S, '2026-11-05', false), 'processing');
  assert.equal(dbsStatusOf('u', new Map(), S, '2026-11-05', true), 'processing');
  assert.equal(dbsStatusOf('u', new Map(), S, '2026-11-05', false), 'starting');
  assert.equal(dbsStatusOf('u', doc('rejected'), S, '2026-11-05', false), 'starting');
});

test('leads: two a day by default, a setting, a visit or a day can say otherwise; new actions are only for who should have them', () => {
  assert.deepEqual(settingsOf({}).roleNeeds, { eeg: 6, copro: 2, lead: 2 });
  assert.deepEqual(roleNeedsOf({ eeg: 1, copro: 0 }, 3), { eeg: 1, copro: 0, lead: 3 });
  assert.deepEqual(roleNeedsOf({ eeg: 0, copro: 0, lead: 1 }), { eeg: 0, copro: 0, lead: 1 });
  assert.equal(settingsOf({}).requireSignOff, false);
  assert.equal(settingsOf({ requireSignOff: true }).requireSignOff, true);
  assert.equal(mayDo('set-dbs-applied', 'ra', 'active'), true);
  assert.equal(mayDo('approve-for-school', 'researcher', 'active'), false);
  assert.equal(mayDo('approve-for-school', 'pm', 'active'), true);
  assert.equal(mayDo('sheet-status', 'researcher', 'active'), true);
  assert.equal(mayDo('sheet-status', 'ra', 'active'), false);
  assert.equal(mayDo('save-sheet', 'researcher', 'active'), false);
  assert.equal(mayDo('sync-sheet', 'pm', 'active'), true);
});
