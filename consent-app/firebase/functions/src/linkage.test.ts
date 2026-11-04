import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dobAgreement, eegRecord, eegRowOf, fuzzyScore, jaroWinkler, linkageTables, myselfRecord, nameAgreement, plan, recordKey, sexOf, ukDate, websiteRecord, type Decision, type EegRow, type Person, type SourceRecord } from './linkage.js';
import { assemble, siteOfCode } from './linkageMyself.js';
import { myselfId } from './myselfId.js';

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The local script (ES module), loaded as itself: this file builds to CommonJS, where import() would become require(). */
const loadScript = () => (new Function('u', 'return import(u)') as (u: string) => Promise<unknown>)(pathToFileURL(resolve(__dirname, '../../../scripts/match-myself.mjs')).href);

const id = (f: string, l: string, d: string) => myselfId(f, l, d)!;

/** The local script's own fixture (scripts/match-myself.test.mjs): one school, the website and MySelf. */
const KIDS: [string, string, string, string, string, string][] = [
  ['w1', 'sub-00001', 'Amara', 'Ahmed', '2012-05-04', 'LS6 1AB'],
  ['w2', 'sub-00002', 'Tom', 'Baker', '2012-09-15', 'LS7 2CD'],
  ['w3', 'sub-00003', 'Lily', 'Evans', '2012-03-07', 'LS8 3EF'],
  ['w4', 'sub-00004', 'Noah', 'Fitzgerald', '2012-11-20', 'LS9 4GH'],
  ['w5', 'sub-00005', 'Ella', 'Ward', '2012-06-02', 'BD7 1AB'],
  ['w6', 'sub-00006', 'Emma', 'Ward', '2012-06-02', 'BD7 1AB'],
  ['w7', 'sub-00007', 'Sam', 'Lee', '2012-01-25', 'LS1 1AA'],
  ['w8', 'sub-00008', 'Zara', 'Hussain', '2012-10-10', 'LS2 2BB'],
];
const MYS: [string, string, string, string, string][] = [
  ['Amara', 'Ahmed', '2012-05-04', 'LS6 1AB', ''],
  ['Thomas', 'Baker', '2012-09-15', '', ''],
  ['Lily', 'Evans', '2012-07-03', '', ''],
  ['Noah', 'Fitzgerlad', '2012-11-20', 'LS9 4GH', ''],
  ['Ema', 'Ward', '2012-06-02', 'BD7 1AB', ''],
  ['Samuel', 'Lee', '2012-01-25', '', ''],
  ['Samantha', 'Lee', '2012-01-25', '', ''],
  ['Zahra', 'Husain', '2012-10-01', '', 'A123456789012'],
  ['Oscar', 'Nobody', '2012-02-02', '', ''],
];
const UPNS: Record<string, string> = { w8: 'A123456789012' };

function website(extra: Record<string, { withdrawn?: boolean }> = {}): SourceRecord[] {
  return KIDS.map(([f, label, first, last, dob, pc]) => websiteRecord(f, { firstName: first, lastName: last, dateOfBirth: dob, schoolId: 'GSAL', yearGroup: 'Year 8', postcode: pc, createdAt: '2026-10-01T10:00:00Z' }, { label, upn: UPNS[f] ?? null, withdrawn: extra[f]?.withdrawn }));
}
function myself(withNames = true): SourceRecord[] {
  return MYS.map(([g, f, d, pc, upn]) => myselfRecord({ code: id(g, f, d), sites: ['GSAL'], sittings: [{ date: '2026-11-10', release: 'r8.0.0' }], upn: upn || null }, { GSAL: 'GSAL' }, withNames ? { givenName: g, familyName: f, dateOfBirth: d, postcode: pc } : null));
}

/** Runs the engine until nothing more happens, numbering new people sub-0001 … as the store does. */
function settle(records: SourceRecord[], people: Person[] = [], decisions: Decision[] = []) {
  const p = plan({ records, people, decisions });
  let n = people.length;
  const real = new Map(p.newPeople.map((t) => [t, `sub-${String(++n).padStart(4, '0')}`]));
  const next = new Map(people.map((x) => [x.studyId, { ...x, keys: [...x.keys] }]));
  for (const a of p.attachments) {
    const sid = real.get(a.studyId) ?? a.studyId;
    if (!next.has(sid)) next.set(sid, { studyId: sid, status: 'active', keys: [] });
    next.get(sid)!.keys.push(a.recordKey);
  }
  for (const [t, s] of p.statuses) next.get(real.get(t) ?? t)!.status = s;
  for (const c of p.candidates) c.studyId = real.get(c.studyId) ?? c.studyId;
  return { plan: p, people: [...next.values()], real };
}
const personOf = (people: Person[], key: string) => people.find((p) => p.keys.includes(key))?.studyId ?? null;
const w = (f: string) => recordKey('website', f);
const m = (g: string, f: string, d: string) => recordKey('myself', id(g, f, d));

test('parity: the scoring is the script’s', async () => {
  const script = (await loadScript()) as Record<string, (...a: unknown[]) => unknown>;
  for (const [a, b] of [['martha', 'marhta'], ['fitzgerald', 'fitzgerlad'], ['smith', 'patel'], ['', 'x'], ['dixon', 'dicksonx']]) assert.equal(jaroWinkler(a, b), script.jaroWinkler(a, b));
  for (const [a, b] of [['2012-03-07', '2012-07-03'], ['2012-03-07', '2012-03-08'], ['2012-03-07', '2011-04-07'], ['2012-03-07', '2012-03-07']]) assert.deepEqual(dobAgreement(a, b), script.dobAgreement(a, b));
  assert.deepEqual(nameAgreement('Ward', 'Ema', 'Emma', 'Ward'), script.nameAgreement('Ward', 'Ema', 'Emma', 'Ward'));
});

test('parity: the same pairs link on their own as the local script links', async () => {
  const script = (await loadScript()) as { match: (x: unknown) => { links: { website_firestore_id: string; myself_id: string }[] }; loadWebsite: (x: unknown) => unknown; loadMyself: (x: unknown) => unknown };
  const key = KIDS.map(([f, l, first, last, dob, pc]) => ({ participant_id: l, firestore_id: f, myself_id: id(first, last, dob), kind: 'consent', first_name: first, last_name: last, date_of_birth: dob, school_id: 'GSAL', postcode: pc }));
  const candidates = KIDS.flatMap(([f, l, first, last, dob]) => websiteRecord(f, { firstName: first, lastName: last, dateOfBirth: dob }, {}).variants.map((v) => ({ participant_id: l, firestore_id: f, myself_id: v.id, kind: v.kind })));
  const participants = MYS.map(([g, f, d]) => ({ participant_id: `sub-${id(g, f, d)}`, sites: 'GSAL01', n_sessions: '1', first_seen: '2026-11-10' }));
  const identifiers = MYS.map(([g, f, d, pc, upn]) => ({ participant_id: id(g, f, d), given_name: g, family_name: f, date_of_birth: d, home_address: pc, upn }));
  const theirs = script.match({ website: script.loadWebsite({ key, candidates, upnMatches: Object.entries(UPNS).map(([firestore_id, upn]) => ({ firestore_id, upn })) }), myself: script.loadMyself({ participants, identifiers }) });
  const scriptPairs = theirs.links.map((l) => `${l.website_firestore_id}|${l.myself_id}`).sort();
  const { people } = settle([...website(), ...myself()]);
  const ours: string[] = [];
  for (const p of people) {
    const ws = p.keys.filter((k) => k.startsWith('w:')).map((k) => k.slice(2));
    const ms = p.keys.filter((k) => k.startsWith('m:')).map((k) => k.slice(2));
    for (const a of ws) for (const b of ms) ours.push(`${a}|${b}`);
  }
  assert.deepEqual(ours.sort(), scriptPairs);
  assert.equal(scriptPairs.length, 4);
});

test('tiers: exact, variant (nickname, swapped day and month) and UPN link on their own', () => {
  const { plan: p, people } = settle([...website(), ...myself()]);
  const tierOf = (key: string) => p.attachments.find((a) => a.recordKey === key)!;
  assert.equal(personOf(people, m('Amara', 'Ahmed', '2012-05-04')), personOf(people, w('w1')));
  assert.equal(tierOf(m('Amara', 'Ahmed', '2012-05-04')).tier, 'exact');
  assert.equal(tierOf(m('Thomas', 'Baker', '2012-09-15')).tier, 'variant');
  assert.match(tierOf(m('Thomas', 'Baker', '2012-09-15')).matchedOn[0], /nickname/);
  assert.match(tierOf(m('Lily', 'Evans', '2012-07-03')).matchedOn[0], /day month swapped/);
  assert.equal(tierOf(m('Zahra', 'Husain', '2012-10-01')).tier, 'upn');
  assert.equal(personOf(people, m('Zahra', 'Husain', '2012-10-01')), personOf(people, w('w8')));
});

test('fuzzy: a typo is only ever suggested, with what it rests on', () => {
  const { plan: p, people } = settle([...website(), ...myself()]);
  const key = m('Noah', 'Fitzgerlad', '2012-11-20');
  assert.equal(personOf(people, key), null);
  assert.ok(p.awaiting.includes(key));
  const c = p.candidates.find((x) => x.recordKey === key)!;
  assert.equal(c.tier, 'fuzzy');
  assert.equal(c.studyId, personOf(people, w('w4')));
  assert.ok(c.matchedOn.includes('same postcode') && c.matchedOn.includes('same school'));
  // No names this run (MySelf not reachable): what was suggested before is kept, and no new ID is handed out.
  const again = plan({ records: [...website(), ...myself(false)], people, decisions: [], carry: p.candidates });
  assert.ok(again.candidates.some((x) => x.recordKey === key && x.studyId === c.studyId));
  assert.equal(again.newPeople.length, 0);
});

test('uniqueness: one record fitting two people, or two records one person, is never linked on its own', () => {
  const { plan: p, people } = settle([...website(), ...myself()]);
  for (const k of [m('Samuel', 'Lee', '2012-01-25'), m('Samantha', 'Lee', '2012-01-25')]) {
    assert.equal(personOf(people, k), null);
    const c = p.candidates.filter((x) => x.recordKey === k);
    assert.equal(c.length, 1);
    assert.match(c[0].reason, /ambiguous: 2 records fit this person|possible twin/);
  }
});

test('twins are never linked on their own, even on an exact ID', () => {
  const { plan: p, people } = settle([...website(), ...myself()]);
  assert.notEqual(personOf(people, w('w5')), personOf(people, w('w6')));
  const ema = p.candidates.filter((x) => x.recordKey === m('Ema', 'Ward', '2012-06-02'));
  assert.deepEqual(ema.map((c) => c.studyId).sort(), [personOf(people, w('w5')), personOf(people, w('w6'))].sort());
  const exactEmma = myselfRecord({ code: id('Emma', 'Ward', '2012-06-02') }, {}, null);
  const q = plan({ records: [...website(), exactEmma], people, decisions: [] });
  assert.equal(q.attachments.length, 0);
  assert.match(q.candidates[0].reason, /possible twin/);
});

test('decisions persist: a "different" is never suggested again, a "same" links', () => {
  const first = settle([...website(), ...myself()]);
  const key = m('Noah', 'Fitzgerlad', '2012-11-20');
  const noah = personOf(first.people, w('w4'))!;
  const diff = settle([...website(), ...myself()], first.people, [{ recordKey: key, studyId: noah, decision: 'different' }]);
  assert.ok(!diff.plan.candidates.some((c) => c.recordKey === key));
  assert.notEqual(personOf(diff.people, key), noah, 'nothing left to ask: it gets its own ID');
  const same = settle([...website(), ...myself()], first.people, [{ recordKey: key, studyId: noah, decision: 'same' }]);
  assert.equal(personOf(same.people, key), noah);
  assert.equal(same.plan.attachments.find((a) => a.recordKey === key)!.how, 'decision');
});

test('study IDs are stable: given in order, never changed or reused by a later run', () => {
  const first = settle([...website(), ...myself()]);
  assert.equal(personOf(first.people, w('w1')), 'sub-0001');
  assert.equal(personOf(first.people, w('w8')), 'sub-0008');
  const again = settle([...website(), ...myself()], first.people);
  assert.equal(again.plan.newPeople.length, 0);
  assert.equal(again.plan.attachments.length, 0);
  for (const p of first.people) assert.deepEqual(again.people.find((x) => x.studyId === p.studyId)!.keys, p.keys);
  // A retired ID stays retired: a record taken off it starts a new one.
  const retired = first.people.map((p) => (p.studyId === 'sub-0001' ? { ...p, status: 'retired' as const, keys: [] } : p));
  const after = settle([...website(), ...myself()], retired, [{ recordKey: w('w1'), studyId: 'sub-0001', decision: 'different' }]);
  assert.ok(!after.people.find((p) => p.studyId === 'sub-0001')!.keys.length);
  assert.ok(Number(personOf(after.people, w('w1'))!.slice(4)) > first.people.length);
});

test('EEG: the manifest’s UK dates, then linked by ID; two recordings of one child share an ID', () => {
  assert.equal(ukDate('04/05/2012'), '2012-05-04');
  assert.equal(ukDate('4.5.12'), '2012-05-04');
  assert.equal(ukDate('2012-05-04'), '2012-05-04');
  assert.equal(ukDate('4 May 2012'), '2012-05-04');
  assert.equal(ukDate('31/02/2012'), null);
  assert.equal(ukDate('13/13/2012'), null);
  const schools = [{ id: 'GSAL', name: 'Leeds Grammar School' }];
  const ok = eegRowOf({ recordingId: 'EEG-001', firstName: 'Amara', lastName: 'Ahmed', dob: '04/05/2012', sex: 'Female', ethnicity: 'Asian', recordingDate: '12/11/2026', site: 'Leeds Grammar School', task: 'rest', fileName: 'EEG-001.bdf' }, schools, {});
  assert.ok('row' in ok);
  const row = (ok as { row: EegRow }).row;
  assert.equal(row.dob, '2012-05-04');
  assert.equal(row.schoolId, 'GSAL');
  assert.ok('problem' in eegRowOf({ recordingId: 'EEG-002', firstName: 'A', lastName: 'B', dob: '31/31/2012' }, schools, {}));
  assert.ok('problem' in eegRowOf({ recordingId: 'bad id!', firstName: 'A', lastName: 'B', dob: '01/01/2012' }, schools, {}));
  assert.equal(sexOf('Female'), 'F');
  const second = { ...row, recordingId: 'EEG-009', recordingDate: '2027-03-01' };
  const { people } = settle([...website(), ...myself(), eegRecord(row), eegRecord(second)]);
  assert.equal(personOf(people, recordKey('eeg', 'EEG-001')), personOf(people, w('w1')));
  assert.equal(personOf(people, recordKey('eeg', 'EEG-009')), personOf(people, w('w1')));
  const alone = settle([eegRecord({ ...row, recordingId: 'X1', firstName: 'Nia', lastName: 'Jones' }), eegRecord({ ...row, recordingId: 'X2', firstName: 'Nia', lastName: 'Jones' })]);
  assert.equal(alone.people.length, 1);
  // Sex and ethnicity only order near-ties.
  const a = { firstName: 'Noah', lastName: 'Fitzgerald', dob: '2012-11-20', postcode: '', schoolId: '', sex: 'M', ethnicity: '' };
  const s1 = fuzzyScore(a, { ...a, lastName: 'Fitzgerlad', sex: 'M' })!;
  const s2 = fuzzyScore(a, { ...a, lastName: 'Fitzgerlad', sex: 'F' })!;
  assert.ok(s1.score > s2.score && s1.score - s2.score < 0.05);
});

test('withdrawn: an opt-out on the website withdraws the study ID, its EEG and its row in participants.tsv', () => {
  const eeg: EegRow = { recordingId: 'EEG-001', firstName: 'Amara', lastName: 'Ahmed', dob: '2012-05-04', sex: 'F', ethnicity: '', recordingDate: '2026-11-12', site: 'GSAL', schoolId: 'GSAL', task: 'rest', fileName: 'a.bdf' };
  const records = [...website({ w1: { withdrawn: true } }), ...myself(), eegRecord(eeg)];
  const { plan: p, people } = settle(records);
  const amara = personOf(people, w('w1'))!;
  assert.equal(p.statuses.get([...p.statuses.keys()].find((k) => k === 'new:1')!), 'withdrawn');
  const t = linkageTables({ people: people.map((x, i) => ({ ...x, number: i + 1, createdAt: null })), records: new Map(records.map((r) => [r.key, r])), eeg: [eeg], awaiting: new Set(p.awaiting) });
  assert.ok(!t.participants.some((r) => r.participant_id === amara));
  assert.equal(t.crosswalk.find((r) => r.participant_id === amara)!.status, 'withdrawn');
  assert.deepEqual(t.eegMap[0], { recording_id: 'EEG-001', participant_id: amara, session_id: 'ses-01', recording_date: '2026-11-12', task: 'rest', status: 'withdrawn', suggested_path: null });
  const ok = settle([...website(), ...myself(), eegRecord(eeg)]);
  const t2 = linkageTables({ people: ok.people.map((x, i) => ({ ...x, number: i + 1, createdAt: null })), records: new Map([...website(), ...myself(), eegRecord(eeg)].map((r) => [r.key, r])), eeg: [eeg], awaiting: new Set() });
  assert.equal(t2.eegMap[0].suggested_path, 'sub-0001/ses-01/eeg/sub-0001_ses-01_task-rest_eeg.bdf');
  const row = t2.participants.find((r) => r.participant_id === 'sub-0001')!;
  assert.deepEqual(row, { participant_id: 'sub-0001', sex: 'F', age: 14, school_id: 'GSAL', year_group: 'Year 8', first_contact_year: 2026, has_website: 'yes', has_myself: 'yes', has_eeg: 'yes', has_lab: 'no' });
  assert.ok(!JSON.stringify(t2.participants).includes('Amara'), 'no names in the research table');
});

test('MySelf: sittings joined to the codes their claims named, sites from the study code', () => {
  assert.equal(siteOfCode('GSAL01'), 'GSAL');
  const out = assemble([{ code: 'PAAA', upn: null }, { code: 'PBBB', upn: 'A123456789012' }], [{ sessionId: 's1', code: 'PAAA' }, { sessionId: 's2', code: 'PAAA' }, { sessionId: 's3', code: 'PBBB' }], [
    { sessionId: 's1', studyCode: 'GSAL01', releaseKey: 'r8.0.0', startedAt: '2026-11-10T09:00:00Z' },
    { sessionId: 's2', studyCode: 'GSAL02', releaseKey: 'r8.1.0', startedAt: '2027-03-01T09:00:00Z' },
    { sessionId: 's3', studyCode: 'BRD01', releaseKey: 'r8.0.0', startedAt: '2026-11-11T09:00:00Z', quarantined: true },
  ]);
  assert.deepEqual(out[0], { code: 'PAAA', sites: ['GSAL'], sittings: [{ date: '2026-11-10', release: 'r8.0.0', site: 'GSAL' }, { date: '2027-03-01', release: 'r8.1.0', site: 'GSAL' }], upn: null });
  assert.deepEqual(out[1].sittings, [], 'a quarantined sitting is left out');
});
