import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assignmentOf,
  attendanceDue,
  attendanceProblem,
  buildReport,
  changedSince,
  copyFor,
  confirmedSnapshot,
  coverageByDay,
  dbsPageRows,
  fullyStaffed,
  mayDo,
  needsOn,
  normaliseVisit,
  planOffers,
  removalProblem,
  respond,
  schoolEmail,
  settingsOf,
  standingOf,
  suggestTeam,
  tagsFor,
  toCsv,
  validateVisit,
  visitStatusAfter,
  type Assignment,
  type Eligibility,
} from './portalCore.js';

/**
 * Jobs on the day (EEG, co-production), places by day, the strongest team,
 * tags and experience, attendance, reports, emails to schools and the
 * school's DBS page (4 November 2026).
 */
const D1 = '2026-11-20';
const D2 = '2026-11-23';
const twoDays = [
  { date: D1, on: true, start: '08:30', end: '15:00' },
  { date: '2026-11-21', on: false, start: '08:30', end: '15:00' },
  { date: D2, on: true, start: '08:30', end: '15:00', copro: 1 },
];
const place = (uid: string, status: Assignment['status'], role: Assignment['role'], dates: string[]): Assignment => ({ uid, status, role, dates });

test('visits: numbers for each job; an old single number is all EEG; a day can have its own', () => {
  const old = validateVisit({ schoolId: 'GSAL', startDate: D1, endDate: D1, start: '08:30', end: '15:00', needed: 4, location: 'Hall' }, ['GSAL'], '2026-11-01');
  assert.deepEqual(old.visit?.roleNeeds, { eeg: 4, copro: 0, lead: 2 });
  const roles = validateVisit({ schoolId: 'GSAL', startDate: D1, endDate: D1, start: '08:30', end: '15:00', location: 'Hall', days: [{ date: D1, eeg: 3 }] }, ['GSAL'], '2026-11-01');
  assert.deepEqual(roles.visit?.roleNeeds, { eeg: 6, copro: 2, lead: 2 });
  assert.deepEqual(needsOn(roles.visit!.days[0], roles.visit!.roleNeeds), { eeg: 3, copro: 2, lead: 2 });
  assert.match(validateVisit({ schoolId: 'GSAL', startDate: D1, endDate: D1, start: '08:30', end: '15:00', location: 'Hall', roleNeeds: { eeg: 0, copro: 0, lead: 0 } }, ['GSAL'], '2026-11-01').problems.join(' '), /at least one in all/);
  assert.match(validateVisit({ schoolId: 'GSAL', startDate: D1, endDate: D1, start: '08:30', end: '15:00', location: 'Hall', days: [{ date: D1, eeg: 0, copro: 0, lead: 0 }] }, ['GSAL'], '2026-11-01').problems.join(' '), /nobody is needed that day/);
});

test('offers: a person, a job and days; eligible and set up for the job, within each day’s numbers; overrides only by the project manager, with a reason', () => {
  const eligible = new Map<string, Eligibility>([
    ['a', { eligible: true, reasons: [] }],
    ['b', { eligible: true, reasons: [] }],
    ['c', { eligible: false, reasons: ['Pilots: 0 of 1'] }],
  ]);
  const capabilities = new Map<string, ('eeg' | 'copro')[]>([['a', ['eeg']], ['b', ['eeg', 'copro']], ['c', ['eeg']]]);
  const base = { days: twoDays, roleNeeds: { eeg: 2, copro: 2, lead: 0 }, assignments: [] as Assignment[], active: new Set(['a', 'b', 'c']), eligible, capabilities, overrides: {}, mayOverride: false, visitStatus: 'staffing' as const };
  assert.deepEqual(planOffers([{ uid: 'a', role: 'eeg', dates: [D1, D2] }, { uid: 'b', role: 'copro', dates: [D2] }], base).problems, []);
  assert.match(planOffers([{ uid: 'a', role: 'copro', dates: [D1] }], base).problems.join(' '), /not set up for Co-production/);
  assert.match(planOffers([{ uid: 'a', role: 'eeg', dates: ['2026-11-21'] }], base).problems.join(' '), /choose days the visit runs/);
  assert.match(planOffers([{ uid: 'a', role: 'eeg', dates: [D1] }, { uid: 'a', role: 'copro', dates: [D2] }], base).problems.join(' '), /chosen twice/);
  // Monday needs one co-production person: a second is too many.
  assert.match(planOffers([{ uid: 'b', role: 'copro', dates: [D2] }], { ...base, assignments: [place('x', 'confirmed', 'copro', [D2])], active: new Set(['a', 'b', 'c', 'x']) }).problems.join(' '), /2026-11-23: 2 for Co-production, but only 1 needed/);
  assert.match(planOffers([{ uid: 'c', role: 'eeg', dates: [D1] }], base).problems.join(' '), /not eligible: Pilots: 0 of 1/);
  assert.match(planOffers([{ uid: 'c', role: 'eeg', dates: [D1] }], { ...base, overrides: { c: 'Piloted elsewhere' } }).problems.join(' '), /Only the project manager/);
  assert.equal(planOffers([{ uid: 'c', role: 'eeg', dates: [D1] }], { ...base, overrides: { c: 'Piloted elsewhere' }, mayOverride: true }).offer.length, 1);
  assert.match(planOffers([{ uid: 'a', role: 'eeg', dates: [D1] }], { ...base, assignments: [place('a', 'offered', 'eeg', [D1])] }).problems.join(' '), /already has this visit/);
  assert.equal(planOffers([{ uid: 'a', role: 'eeg', dates: [D1] }], { ...base, assignments: [place('a', 'declined', 'eeg', [D1])] }).offer.length, 1, 'offered again after declining');
  assert.match(planOffers([{ uid: 'a', role: 'eeg', dates: [D1] }], { ...base, visitStatus: 'cancelled' }).problems.join(' '), /closed/);
});

test('coverage: each day, each job, offered and confirmed against what is needed; staffed only when every day has every job confirmed', () => {
  const places = [place('a', 'confirmed', 'eeg', [D1, D2]), place('b', 'offered', 'eeg', [D1]), place('c', 'confirmed', 'copro', [D2]), place('d', 'declined', 'copro', [D1])];
  const cover = coverageByDay(twoDays, { eeg: 2, copro: 2, lead: 0 }, places);
  assert.deepEqual(
    cover.map((c) => [c.date, c.eeg, c.copro]),
    [
      [D1, { need: 2, offered: 1, confirmed: 1 }, { need: 2, offered: 0, confirmed: 0 }],
      [D2, { need: 2, offered: 0, confirmed: 1 }, { need: 1, offered: 0, confirmed: 1 }],
    ],
  );
  assert.equal(fullyStaffed(twoDays, { eeg: 1, copro: 1, lead: 0 }, places), false);
  const full = [place('a', 'confirmed', 'eeg', [D1, D2]), place('c', 'confirmed', 'copro', [D1, D2])];
  assert.equal(fullyStaffed(twoDays, { eeg: 1, copro: 1, lead: 0 }, full), true);
  assert.equal(visitStatusAfter('staffing', twoDays, { eeg: 1, copro: 1, lead: 0 }, full), 'locked');
  assert.equal(visitStatusAfter('locked', twoDays, { eeg: 1, copro: 1, lead: 0 }, [full[0], { ...full[1], status: 'removed' }]), 'staffing');
  assert.equal(visitStatusAfter('draft', twoDays, { eeg: 1, copro: 1, lead: 0 }, [place('a', 'offered', 'eeg', [D1])]), 'staffing');
  assert.equal(visitStatusAfter('cancelled', twoDays, { eeg: 1, copro: 1, lead: 0 }, full), 'cancelled');
});

test('migration: a place saved before jobs is EEG on every day the visit runs; an old visit needs its number on EEG', () => {
  assert.deepEqual(assignmentOf({ uid: 'a', status: 'confirmed' }, twoDays), { uid: 'a', status: 'confirmed', role: 'eeg', dates: [D1, D2] });
  assert.deepEqual(assignmentOf({ uid: 'a', status: 'offered', role: 'copro', dates: [D2, '2026-11-21'] }, twoDays), { uid: 'a', status: 'offered', role: 'copro', dates: [D2] });
  assert.deepEqual(normaliseVisit({ date: D1, start: '08:30', end: '15:00', needed: 3, meetingPoint: 'Hall' }).roleNeeds, { eeg: 3, copro: 0, lead: 2 });
});

test('the strongest team: most experienced first, by job, for the days they are free; the same people across days; nobody in two jobs; ties on training and pilots', () => {
  const c = (uid: string, level: 1 | 2 | 3 | 4 | null, capabilities: ('eeg' | 'copro')[], availableDates: string[], extra: Partial<{ eligible: boolean; training: number; pilots: number }> = {}) => ({ uid, name: uid, eligible: true, capabilities, level, training: 2, pilots: 1, availableDates, ...extra });
  const team = suggestTeam({
    days: twoDays,
    roleNeeds: { eeg: 2, copro: 1, lead: 0 },
    assignments: [],
    candidates: [
      c('lead', 4, ['eeg', 'copro'], [D1, D2]),
      c('exp', 3, ['eeg'], [D1, D2]),
      c('dev', 2, ['eeg'], [D1, D2], { training: 5 }),
      c('cop', 3, ['copro'], [D1]),
      c('cop2', 1, ['copro'], [D2]),
      c('unready', 4, ['eeg', 'copro'], [D1, D2], { eligible: false }),
      c('busy', 4, ['eeg'], []),
    ],
  });
  const by = new Map(team.map((t) => [t.uid, t]));
  // Co-production first (fewer can do it): the co-production-only people before the lead who does both.
  assert.deepEqual(by.get('cop'), { uid: 'cop', role: 'copro', dates: [D1] });
  assert.deepEqual(by.get('cop2'), { uid: 'cop2', role: 'copro', dates: [D2] });
  assert.deepEqual(by.get('lead'), { uid: 'lead', role: 'eeg', dates: [D1, D2] });
  assert.deepEqual(by.get('exp'), { uid: 'exp', role: 'eeg', dates: [D1, D2] });
  assert.equal(by.has('dev'), false, 'EEG already full on both days');
  assert.equal(by.has('unready'), false);
  assert.equal(by.has('busy'), false);
  assert.equal(new Set(team.map((t) => t.uid)).size, team.length, 'one job each');
  // With places already taken, only what is left is suggested; training breaks the tie between equals.
  const more = suggestTeam({
    days: twoDays,
    roleNeeds: { eeg: 3, copro: 1, lead: 0 },
    assignments: [place('lead', 'confirmed', 'eeg', [D1, D2]), place('exp', 'offered', 'eeg', [D1, D2]), place('cop', 'confirmed', 'copro', [D1, D2])],
    candidates: [c('dev2', 2, ['eeg'], [D1, D2], { training: 2 }), c('dev', 2, ['eeg'], [D1, D2], { training: 5 })],
  });
  assert.deepEqual(more, [{ uid: 'dev', role: 'eeg', dates: [D1, D2] }]);
});

test('answers and removals: only an open offer is answered; a confirmed place goes only by the project manager, with a reason, for all or some days', () => {
  assert.deepEqual(respond('offered', 'confirm'), { next: 'confirmed', problem: null });
  assert.match(String(respond('confirmed', 'decline').problem), /cannot be cancelled here/);
  assert.equal(removalProblem('offered', 'withdraw-offer', 'researcher', ''), null);
  assert.match(String(removalProblem('confirmed', 'withdraw-offer', 'researcher', '')), /only the project manager/);
  assert.match(String(removalProblem('confirmed', 'remove-confirmed', 'researcher', 'ill')), /Only the project manager/);
  assert.match(String(removalProblem('confirmed', 'remove-confirmed', 'pm', '  ')), /Give the reason/);
  assert.equal(removalProblem('confirmed', 'remove-confirmed', 'pm', 'Ill on Monday', { chosen: [D2], held: [D1, D2] }), null);
  assert.match(String(removalProblem('confirmed', 'remove-confirmed', 'pm', 'x', { chosen: ['2026-11-21'], held: [D1, D2] })), /Choose days they are booked for/);
});

test('tags and experience: only known tags; research assistants see only Ready or On hold; notes and edits are the team’s', () => {
  const settings = settingsOf({ tags: [{ id: 'new', label: 'New' }, { id: 'ready', label: 'Ready' }, { id: 'on-hold', label: 'On hold' }, { id: 'old', label: 'Old', retired: true }] });
  assert.deepEqual(settings.tags.map((t) => t.id), ['new', 'ready', 'on-hold', 'old']);
  assert.deepEqual(tagsFor(['ready', 'made-up', 'new'], settings), ['new', 'ready']);
  assert.equal(standingOf(['new']), null);
  assert.equal(standingOf(['ready']), 'Ready');
  assert.equal(standingOf(['ready', 'on-hold']), 'On hold');
  assert.deepEqual(settingsOf({}).tags.map((t) => t.label), ['New', 'In training', 'Ready', 'On hold', 'Left']);
  assert.deepEqual(settingsOf({}).roleNeeds, { eeg: 6, copro: 2, lead: 2 });
  assert.deepEqual(settingsOf({ roleNeeds: { eeg: 5, copro: 3, lead: 0 } }).roleNeeds, { eeg: 5, copro: 3, lead: 0 });
  assert.equal(mayDo('add-note', 'researcher', 'active'), true);
  assert.equal(mayDo('add-note', 'ra', 'active'), false);
  assert.equal(mayDo('save-person', 'ra', 'active'), false);
  assert.equal(mayDo('save-doc-details', 'researcher', 'active'), false);
  assert.equal(mayDo('person', 'ra', 'active'), false, 'notes come only with a person, for the team');
});

test('attendance: only the visit’s days, from the day itself, only people confirmed; past days not yet marked are listed', () => {
  const confirmed = new Set(['a', 'b']);
  assert.equal(attendanceProblem(twoDays[0], D1, confirmed, [{ uid: 'a', mark: 'attended' }]), null);
  assert.match(String(attendanceProblem(twoDays[0], '2026-11-19', confirmed, [{ uid: 'a', mark: 'attended' }])), /from the day itself/);
  assert.match(String(attendanceProblem(twoDays[1], '2026-11-30', confirmed, [{ uid: 'a', mark: 'attended' }])), /not one of the visit/);
  assert.match(String(attendanceProblem(twoDays[0], '2026-11-30', confirmed, [{ uid: 'z', mark: 'attended' }])), /only people confirmed/);
  assert.match(String(attendanceProblem(twoDays[0], '2026-11-30', confirmed, [{ uid: 'a', mark: 'present' }])), /attended, absent/);
  const due = attendanceDue([{ visitId: 'v', days: twoDays, assignments: [place('a', 'confirmed', 'eeg', [D1, D2]), place('b', 'confirmed', 'copro', [D1])] }], new Set(['v|a|2026-11-20']), D2);
  assert.deepEqual(due, [
    { visitId: 'v', date: D1, unmarked: 1 },
    { visitId: 'v', date: D2, unmarked: 1 },
  ]);
});

test('reports: per person and per day, offered, confirmed, attended, absent, hours and jobs; filtered by dates, school and person; CSV', () => {
  const visits = [{ visitId: 'v', schoolId: 'GSAL', schoolName: 'GSAL', days: twoDays, roleNeeds: { eeg: 1, copro: 1, lead: 0 }, assignments: [place('a', 'confirmed', 'eeg', [D1, D2]), place('b', 'confirmed', 'copro', [D1]), place('c', 'declined', 'eeg', [D1]), place('d', 'withdrawn', 'eeg', [D2])] }];
  const attendance = [
    { visitId: 'v', uid: 'a', date: D1, mark: 'attended' as const, note: '' },
    { visitId: 'v', uid: 'a', date: D2, mark: 'late' as const, note: '' },
    { visitId: 'v', uid: 'b', date: D1, mark: 'absent' as const, note: 'ill' },
  ];
  const people = [
    { uid: 'a', name: 'Alex' },
    { uid: 'b', name: 'Bea' },
    { uid: 'c', name: 'Cal' },
  ];
  const r = buildReport({ visits, attendance, people, from: '2026-11-01', to: '2026-11-30' });
  const alex = r.people.find((p) => p.uid === 'a')!;
  assert.deepEqual([alex.offeredDays, alex.confirmedDays, alex.attended, alex.late, alex.absent, alex.hours, alex.eegDays, alex.coproDays], [2, 2, 2, 1, 0, 13, 2, 0]);
  const bea = r.people.find((p) => p.uid === 'b')!;
  assert.deepEqual([bea.confirmedDays, bea.attended, bea.absent, bea.hours], [1, 0, 1, 0]);
  assert.equal(r.people.find((p) => p.uid === 'c')!.confirmedDays, 0);
  assert.equal(r.people.some((p) => p.uid === 'd'), false, 'withdrawn offers do not count');
  assert.deepEqual(
    r.days.map((d) => [d.date, d.eegConfirmed, d.coproConfirmed, d.attended, d.absent]),
    [
      [D1, 1, 1, ['Alex'], ['Bea']],
      [D2, 1, 0, ['Alex'], []],
    ],
  );
  assert.deepEqual(r.totals, { visits: 1, days: 2, offeredDays: 4, confirmedDays: 3, attended: 2, absent: 1, hours: 13, notMarked: 0 });
  assert.equal(buildReport({ visits, attendance, people, from: '2026-11-21', to: '2026-11-30' }).totals.days, 1);
  assert.equal(buildReport({ visits, attendance, people, from: '2026-11-01', to: '2026-11-30', schoolId: 'OTHER' }).totals.days, 0);
  assert.deepEqual(buildReport({ visits, attendance, people, from: '2026-11-01', to: '2026-11-30', uid: 'b' }).people.map((p) => p.uid), ['b']);
  const csv = toCsv(['Name', 'Note'], [['Alex, A', 'said "hi"'], ['Bea', 3]]);
  assert.equal(csv.split('\r\n')[1], '"Alex, A","said ""hi"""');
  assert.equal(csv.split('\r\n')[2], 'Bea,3');
});

test('school emails: names by day and no jobs; DBS only as a link to the school’s page, never the numbers; changes since the last email are noticed', () => {
  const places = [place('a', 'confirmed', 'eeg', [D1, D2]), place('b', 'confirmed', 'copro', [D1]), place('c', 'offered', 'eeg', [D2])];
  const snap = confirmedSnapshot(twoDays, places);
  assert.deepEqual(snap, { [D1]: ['a', 'b'], [D2]: ['a'] });
  const people = new Map([
    ['a', 'Alex Smith'],
    ['b', 'Bea Jones'],
    ['c', 'Cal Brown'],
  ]);
  const base = { schoolName: 'GSAL', contactName: 'Ms Eliza', location: 'Main reception', days: twoDays, people, snapshot: snap, intro: '', team: { name: 'Dr Sarmad Ali', email: 'S.A.Ali1@leeds.ac.uk' }, dbsChecked: new Set(['a']) };
  const off = schoolEmail({ ...base, dbsPage: null });
  assert.match(off.body, /Dear Ms Eliza,[\s\S]*Friday, 20 November 2026, 08:30 to 15:00\n {2}Alex Smith\n {2}Bea Jones\n\nMonday, 23 November 2026, 08:30 to 15:00\n {2}Alex Smith/);
  assert.doesNotMatch(off.body, /EEG|Co-production|Cal Brown|DBS/);
  const on = schoolEmail({ ...base, dbsPage: { url: 'https://myphonemybrain.com/schools/dbs/?school=gsal', contactName: 'Dr Sarmad Ali', contactEmail: 'S.A.Ali1@leeds.ac.uk' } });
  assert.match(on.body, /DBS details for everyone attending at https:\/\/myphonemybrain\.com\/schools\/dbs\/\?school=gsal[\s\S]*password is the one our project manager gave you by phone/);
  assert.doesNotMatch(on.body, /\d{12}/, 'never a certificate number');
  assert.deepEqual(on.dbsMissing, ['Bea Jones']);
  assert.equal(changedSince(null, snap), false);
  assert.equal(changedSince(snap, snap), false);
  assert.equal(changedSince(snap, confirmedSnapshot(twoDays, [...places, place('c', 'confirmed', 'eeg', [D2])])), true);
  assert.match(schoolEmail({ ...base, dbsPage: null, update: true }).subject, /\(updated\)/);
});

test('the school’s DBS page: only confirmed people on its visits, still to come or within 30 days; checked details or "being checked"; passwords are the project manager’s', () => {
  const visit = (visitId: string, status: 'staffing' | 'draft' | 'cancelled', date: string) => ({ visitId, status, location: 'Hall', days: [{ date, on: true, start: '08:30', end: '15:00' }], assignments: [place('a', 'confirmed', 'eeg', [date]), place('b', 'offered', 'eeg', [date]), place('c', 'confirmed', 'copro', [date])] });
  const rows = dbsPageRows({
    visits: [visit('soon', 'staffing', D1), visit('draft', 'draft', D1), visit('gone', 'cancelled', D1), visit('old', 'staffing', '2026-09-01')],
    today: '2026-11-04',
    names: new Map([
      ['a', 'Alex'],
      ['b', 'Bea'],
      ['c', 'Cal'],
    ]),
    dbs: new Map([['a', { certificateNumber: '001234567890', issueDate: '2025-01-10', updateService: true, docId: null }]]),
  });
  assert.deepEqual(rows.map((r) => r.visitId), ['soon']);
  assert.deepEqual(rows[0].days[0].people.map((p) => [p.name, p.dbs?.certificateNumber ?? 'being checked']), [
    ['Alex', '001234567890'],
    ['Cal', 'being checked'],
  ]);
  assert.equal(mayDo('make-dbs-password', 'researcher', 'active'), false);
  assert.equal(mayDo('make-dbs-password', 'pm', 'active'), true);
  assert.equal(mayDo('close-dbs-access', 'researcher', 'active'), false);
  assert.equal(mayDo('send-school-email', 'researcher', 'active'), true);
  assert.equal(mayDo('send-school-email', 'ra', 'active'), false);
  assert.equal(mayDo('report', 'ra', 'active'), false);
  assert.equal(mayDo('mark-attendance', 'researcher', 'active'), true);
});

test('team emails: names per day with time notes, jobs only if asked, first-day DBS reminders, update wording, travel; HTML with headings', async () => {
  const { teamEmail, teamEmailBody, firstDaysAt, andList, clock, dateRange, timeNoteFrom } = await import('./portalCore.js');
  const names = new Map([
    ['h', 'Hannah Meek'],
    ['k', 'Kate Hiley'],
    ['a', 'Ariana Williams'],
    ['g', 'Grace Lee'],
    ['o', 'Omar Ali'],
  ]);
  const travel = { arrival: '07:45', taxiFrom: 'School of Psychology, University of Leeds', taxiTime: '07:15', direct: '' };
  const days = [
    { date: '2026-11-04', travel, people: [{ uid: 'k', role: 'eeg' as const }, { uid: 'h', role: 'copro' as const }] },
    { date: '2026-11-05', travel, people: [{ uid: 'h', role: 'eeg' as const }, { uid: 'a', role: 'eeg' as const, note: 'until 1:00 pm' }, { uid: 'g', role: 'eeg' as const }, { uid: 'o', role: 'copro' as const }] },
    { date: '2026-11-06', travel, people: [{ uid: 'h', role: 'eeg' as const }] },
  ];
  // Grace and Omar first come on Thursday; Kate came to an earlier visit.
  const firstDays = new Map([
    ['k', '2026-10-20'],
    ['h', '2026-11-04'],
    ['g', '2026-11-05'],
    ['o', '2026-11-05'],
    ['a', '2026-10-21'],
  ]);
  const e = teamEmail({ schoolName: 'GSAL', days, names, showRoles: false, firstDays, update: true, sender: 'Sarmad Ali' });
  assert.equal(e.subject, 'GSAL team allocations (updated): 4–6 November');
  assert.match(e.intro, /updated team allocations for the GSAL sessions \(4–6 November\), following a few changes to availability/);
  assert.match(e.allocations, /^Wednesday 4 November\nHannah Meek\nKate Hiley\n\nThursday 5 November\nAriana Williams \(until 1:00 pm\)\nGrace Lee\nHannah Meek\nOmar Ali\n\nFriday 6 November\nHannah Meek$/);
  assert.doesNotMatch(e.allocations, /EEG|Co-production/);
  assert.match(e.travel, /Everyone should arrive at GSAL by 7:45 am\.\nThe taxi will leave from School of Psychology, University of Leeds, at 7:15 am[\s\S]*travelling directly to GSAL, please make sure you arrive by 7:45 am/);
  assert.equal(e.checks, "Hannah, as Wednesday will be your first day at GSAL, please make sure you bring your original Enhanced DBS certificate and ID for the school's checks.\nGrace and Omar, as Thursday will be your first day at GSAL, please make sure you bring your original Enhanced DBS certificate and ID for the school's checks.");
  assert.match(e.closing, /Best wishes,\nSarmad$/);
  const roles = teamEmail({ schoolName: 'GSAL', days, names, showRoles: true, firstDays, update: false, sender: 'Sarmad Ali' });
  assert.match(roles.allocations, /Kate Hiley – EEG\nHannah Meek – Co-production/);
  assert.match(roles.intro, /^Please see below the team allocations for the GSAL sessions \(4–6 November\)\.$/);
  const body = teamEmailBody(e);
  assert.match(body.text, /^Hi all,\n\nPlease see below the updated[\s\S]*Travel Arrangements\nEveryone[\s\S]*DBS and ID Checks\nHannah[\s\S]*Sarmad$/);
  assert.match(body.html, /<h3>Wednesday 4 November<\/h3><p>Hannah Meek<br>Kate Hiley<\/p>/);
  assert.match(body.html, /<h3>Travel Arrangements<\/h3>/);
  assert.equal(teamEmailBody({ ...e, travel: '', checks: '' }).text.includes('Travel Arrangements'), false);
  assert.deepEqual([...firstDaysAt([place('a', 'confirmed', 'eeg', ['2026-11-05', '2026-10-21']), place('b', 'offered', 'eeg', ['2026-10-01'])])], [['a', '2026-10-21']]);
  assert.equal(andList(['Grace', 'Omar', 'Sam']), 'Grace, Omar and Sam');
  assert.equal(clock('13:00'), '1:00 pm');
  assert.equal(clock('00:15'), '12:15 am');
  assert.equal(dateRange('2026-11-30', '2026-12-02'), '30 November–2 December');
  assert.equal(timeNoteFrom('am'), 'morning only');
  assert.equal(timeNoteFrom('all'), null);
  assert.deepEqual(assignmentOf({ uid: 'a', status: 'confirmed', dates: [D1], timeNotes: { [D1]: 'until 1:00 pm', '2026-12-01': 'x' } }, twoDays).timeNotes, { [D1]: 'until 1:00 pm' });
});

test('always copy in: the two addresses by default, never twice, none on an email only to them', () => {
  const always = settingsOf({}).alwaysCopy;
  assert.deepEqual(always, ['brainpop@leeds.ac.uk', 'S.A.Ali1@leeds.ac.uk']);
  assert.deepEqual(copyFor(always, { to: 'ra@example.com' }), always);
  // Already on it (any case, To, CC or BCC): not copied again.
  assert.deepEqual(copyFor(always, { to: 'school@example.org', cc: 's.a.ali1@leeds.ac.uk, me@leeds.ac.uk' }), ['brainpop@leeds.ac.uk']);
  assert.deepEqual(copyFor(always, { to: 'undisclosed-recipients:;', bcc: 'a@x.com, b@y.com' }), always);
  // A system email to Sarmad himself: no copy.
  assert.deepEqual(copyFor(always, { to: 'S.A.Ali1@leeds.ac.uk' }), []);
  // The project manager can change the list; bad addresses are dropped.
  assert.deepEqual(settingsOf({ alwaysCopy: ['team@leeds.ac.uk', 'not an email', 'TEAM@leeds.ac.uk'] }).alwaysCopy, ['TEAM@leeds.ac.uk']);
  assert.deepEqual(settingsOf({ alwaysCopy: [] }).alwaysCopy, []);
});

test('team email: no "the The" for a school whose name starts with The', async () => {
  const { teamEmail } = await import('./portalCore.js');
  const days = [{ date: '2026-11-23', travel: { arrival: '', taxiFrom: '', taxiTime: '', direct: '' }, people: [] }];
  const base = { days, names: new Map<string, string>(), showRoles: false, firstDays: new Map<string, string>(), sender: 'Robin Chen' };
  assert.match(teamEmail({ ...base, schoolName: 'The Grammar School at Leeds', update: false }).intro, /for The Grammar School at Leeds sessions/);
  assert.match(teamEmail({ ...base, schoolName: 'The Grammar School at Leeds', update: true }).intro, /updated team allocations for The Grammar/);
  assert.match(teamEmail({ ...base, schoolName: 'GSAL', update: false }).intro, /for the GSAL sessions/);
});
