import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDigest, canComment, canEdit, canSee, canTriage, changesBetween, deviceInput, deviceSummary, digestSettingsOf, entriesForDay, HEADSET_LIST, headsetListEntryId, issueInput, issueRows, shortName, statusAfterFault, statusFromList, ukDay, type DigestEntry, type Issue } from './issues.js';
import { mayDo } from './portalCore.js';

const base: Issue = { id: 'i-0000000001', uid: 'ra1', authorName: 'Ash Assist', authorRole: 'ra', deviceAt: '2026-11-12T10:42:00.000Z', receivedAt: '2026-11-12T10:42:05.000Z', visitId: 'v1', schoolId: 'GSAL', about: [], type: 'eeg', impact: 'minor', note: 'Cap kept slipping', recordings: [], device: null, faults: [], channels: [], severity: null, fixedAt: null, fixedBy: '', importedFrom: '', status: 'open', resolution: '', comments: [], actions: [], history: [] };
const ra = { uid: 'ra1', role: 'ra' as const };
const otherRa = { uid: 'ra2', role: 'ra' as const };
const team = { uid: 't1', role: 'researcher' as const };

test('permissions: everyone sees and comments on every entry; the team triages; an assistant edits only their own, for 24 hours', () => {
  assert.ok(canSee(base, team) && canSee(base, ra) && canSee(base, otherRa), 'all of the team see all, so nothing is logged twice');
  assert.ok(!canSee(base, { uid: 'x', role: null }), 'not without a role');
  assert.ok(canComment(base, ra) && canComment(base, otherRa));
  const received = Date.parse(base.receivedAt);
  assert.ok(canEdit(base, ra, received + 23 * 3600_000));
  assert.ok(!canEdit(base, ra, received + 25 * 3600_000));
  assert.ok(canEdit(base, team, received + 400 * 86_400_000));
  assert.ok(!canEdit(base, otherRa, received));
  assert.ok(canTriage(team) && !canTriage(ra));
  // Every active user can log; only the team changes status; only the PM sets the email.
  assert.ok(mayDo('issue-log', 'ra', 'active') && mayDo('issue-list', 'ra', 'active'));
  assert.ok(!mayDo('issue-log', 'ra', 'pending'));
  assert.ok(!mayDo('issue-status', 'ra', 'active') && mayDo('issue-status', 'researcher', 'active'));
  assert.ok(!mayDo('issue-save-digest', 'researcher', 'active') && mayDo('issue-save-digest', 'pm', 'active'));
});

test('input: checked, the device time kept (offline entries arrive late), names only through About', () => {
  const now = new Date('2026-11-12T18:00:00Z');
  const ok = issueInput({ id: 'abc-12345678', deviceAt: '2026-11-12T09:15:00Z', type: 'noise', impact: 'may-affect', note: 'Fire alarm test', about: [{ kind: 'room' }, { kind: 'typed', name: 'Amara Ahmed' }, { kind: 'typed', name: 'amara ahmed' }, { kind: 'person', studyId: 'nope' }], recordings: ['EEG-1', 'EEG-1', 'bad id!'] }, ra, now);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.deviceAt, '2026-11-12T09:15:00.000Z');
    assert.deepEqual(ok.value.about, [{ kind: 'room' }, { kind: 'typed', name: 'Amara Ahmed', studyId: null }]);
    assert.deepEqual(ok.value.recordings, ['EEG-1']);
  }
  assert.ok(!issueInput({ id: 'abc-12345678', deviceAt: '2026-11-13T09:00:00Z', type: 'eeg', impact: 'minor', note: 'x' }, ra, now).ok, 'a clock in the future');
  assert.ok(!issueInput({ id: 'abc-12345678', deviceAt: '2026-11-12T09:00:00Z', type: 'safeguarding', impact: 'minor', note: 'x' }, ra, now).ok, 'no safeguarding type');
  assert.ok(!issueInput({ id: 'x', deviceAt: '2026-11-12T09:00:00Z', type: 'eeg', impact: 'minor', note: 'x' }, ra, now).ok, 'needs the client id');
});

test('offline queue: the same id twice is one entry (the store refuses the second write); edits keep the original', () => {
  // The store creates portalIssues/{id} in a transaction and returns duplicate: true when it is there; the id is the client's.
  const stored = new Map<string, Issue>();
  const log = (i: Issue) => (stored.has(i.id) ? { duplicate: true } : (stored.set(i.id, i), { duplicate: false }));
  assert.deepEqual(log(base), { duplicate: false });
  assert.deepEqual(log({ ...base, note: 'retry' }), { duplicate: true });
  assert.equal(stored.size, 1);
  assert.equal(stored.get(base.id)!.note, 'Cap kept slipping');
  assert.deepEqual(changesBetween(base as unknown as Record<string, unknown>, { note: 'Cap slipped twice', impact: 'minor' }), { note: { from: 'Cap kept slipping', to: 'Cap slipped twice' } });
});

test('export: research rows carry study IDs and recordings, never a typed name; the identifying rows add them', () => {
  const issue: Issue = { ...base, about: [{ kind: 'person', studyId: 'sub-0001' }, { kind: 'typed', name: 'Zara Hussain', studyId: null }, { kind: 'typed', name: 'Tom Baker', studyId: 'sub-0002' }, { kind: 'room' }], recordings: ['EEG-0001'] };
  const { research, identifying } = issueRows([issue]);
  assert.equal(research[0].participant_ids, 'sub-0001,sub-0002');
  assert.equal(research[0].unresolved_pupils, 1);
  assert.equal(research[0].whole_room, 'yes');
  assert.equal(research[0].recording_ids, 'EEG-0001');
  assert.ok(!JSON.stringify(research).includes('Zara') && !JSON.stringify(research).includes('Tom Baker') && !JSON.stringify(research).includes('Ash'));
  assert.equal(identifying[0].typed_names, 'Zara Hussain; Tom Baker');
  assert.equal(identifying[0].author_name, 'Ash Assist');
});

const entry = (over: Partial<DigestEntry>): DigestEntry => ({ ...base, schoolName: 'The Grammar School at Leeds', visitLabel: 'visit 2026-11-12', pupils: [], link: 'https://myphonemybrain.com/portal/#notebook/x', ...over });

test('digest: counts first, unusable first and highlighted, then by school and time; late arrivals marked', () => {
  const entries = [
    entry({ id: 'a', deviceAt: '2026-11-12T14:00:00Z', receivedAt: '2026-11-12T14:00:01Z', impact: 'minor', note: 'Afternoon' }),
    entry({ id: 'b', deviceAt: '2026-11-12T09:30:00Z', receivedAt: '2026-11-12T09:30:01Z', impact: 'unusable', note: 'Headset dead', pupils: [shortName('Amara', 'Ahmed')] }),
    entry({ id: 'c', deviceAt: '2026-11-12T10:00:00Z', receivedAt: '2026-11-12T10:00:01Z', impact: 'may-affect', note: 'Morning', schoolName: '', visitLabel: '' }),
    entry({ id: 'd', deviceAt: '2026-11-11T15:00:00Z', receivedAt: '2026-11-12T08:00:00Z', impact: 'may-affect', note: 'From the queue' }),
    entry({ id: 'e', deviceAt: '2026-11-11T15:00:00Z', receivedAt: '2026-11-11T15:00:01Z', impact: 'minor', note: 'Yesterday' }),
  ];
  const d = buildDigest({ day: '2026-11-12', entries, openEarlier: 3, notebookLink: 'https://myphonemybrain.com/portal/#notebook', sendEmpty: false })!;
  assert.equal(d.entries, 4);
  assert.deepEqual(d.counts, { unusable: 1, 'may-affect': 2, minor: 1 });
  assert.match(d.subject, /4 \(1 data unusable\)/);
  const t = d.text;
  assert.ok(t.indexOf('1 data unusable, 2 may affect data, 1 minor') < t.indexOf('DATA UNUSABLE'));
  assert.ok(t.indexOf('Headset dead') < t.indexOf('== The Grammar School'));
  assert.ok(t.indexOf('From the queue') < t.indexOf('Afternoon'), 'by time within the school');
  assert.match(t, /11\/11 15:00 .*\[logged earlier, arrived today\]/);
  assert.ok(t.indexOf('== Not at a visit ==') > t.indexOf('Afternoon'), 'not at a visit last');
  assert.ok(!t.includes('Yesterday'));
  assert.match(t, /Amara A\./);
  assert.match(t, /Still open from earlier days: 3/);
  assert.match(d.html, /background:#fdecef/);
  assert.match(d.html, /Data unusable \(1\)/);
});

test('digest: an empty day sends nothing unless asked', () => {
  assert.equal(buildDigest({ day: '2026-11-13', entries: [], openEarlier: 0, notebookLink: 'x', sendEmpty: false }), null);
  assert.match(buildDigest({ day: '2026-11-13', entries: [], openEarlier: 0, notebookLink: 'x', sendEmpty: true })!.text, /Nothing was logged today/);
  assert.deepEqual(digestSettingsOf(undefined), { to: ['brainpop@leeds.ac.uk', 'f.mushtaq@leeds.ac.uk'], sendEmpty: false });
  assert.deepEqual(digestSettingsOf({ to: ['a@x.org', 'A@x.org', 'bad'], sendEmpty: true }), { to: ['a@x.org'], sendEmpty: true });
});

test('digest days are UK days, through the clock changes', () => {
  // British Summer Time: 23:30 UTC on 30 June is 00:30 on 1 July in the UK.
  assert.equal(ukDay('2026-06-30T23:30:00Z'), '2026-07-01');
  // GMT: 23:30 UTC on 30 November is still 30 November.
  assert.equal(ukDay('2026-11-30T23:30:00Z'), '2026-11-30');
  // The night the clocks go back (25 October 2026, 02:00 BST -> 01:00 GMT): 23:30 UTC on the 24th is 00:30 BST on the 25th.
  assert.equal(ukDay('2026-10-24T23:30:00Z'), '2026-10-25');
  const e = [{ deviceAt: '2026-06-30T23:30:00Z', receivedAt: '2026-06-30T23:30:00Z' }];
  assert.equal(entriesForDay(e, '2026-07-01').length, 1);
  assert.equal(entriesForDay(e, '2026-06-30').length, 0);
});

test('equipment: a device fault is checked against the kind of device; channels only for a headset', () => {
  const now = new Date('2026-11-22T18:00:00Z');
  const r = issueInput({ id: 'abc-12345678', deviceAt: '2026-11-22T09:15:00Z', type: 'eeg', impact: 'may-affect', note: '', device: { kind: 'headset', code: ' e50211f7 ' }, faults: ['bluetooth', 'channels', 'crash', 'nonsense'], channels: ['P8', 'O2', 'Cz'], severity: 'medium' }, ra, now);
  assert.ok(r.ok, 'faults alone are enough to log');
  if (r.ok) {
    assert.deepEqual(r.value.device, { kind: 'headset', code: 'E50211F7' });
    assert.deepEqual(r.value.faults, ['bluetooth', 'channels'], 'a laptop fault is not a headset fault');
    assert.deepEqual(r.value.channels, ['O2', 'P8'], 'in montage order; Cz is not on the headset');
    assert.equal(r.value.severity, 'medium');
  }
  const laptop = issueInput({ id: 'abc-12345679', deviceAt: '2026-11-22T09:15:00Z', type: 'equipment', impact: 'minor', note: 'x', device: { kind: 'laptop', code: 'LT-03' }, faults: ['crash'], channels: ['O1'] }, ra, now);
  assert.ok(laptop.ok && laptop.value.channels.length === 0 && laptop.value.faults[0] === 'crash' && laptop.value.severity === null);
  assert.ok(!issueInput({ id: 'abc-12345670', deviceAt: '2026-11-22T09:15:00Z', type: 'eeg', impact: 'minor', note: '', device: { kind: 'headset', code: 'E5' } }, ra, now).ok, 'a device and no fault or note is not an entry');
  assert.ok(!deviceInput({ code: '!', kind: 'headset' }).ok && deviceInput({ code: 'ipad 4', kind: 'ipad' }).ok);
  // Logging a fault: a high one takes the device out of service; nothing brings one back but marking it fixed.
  assert.equal(statusAfterFault('ok', 'low'), 'care');
  assert.equal(statusAfterFault('care', 'high'), 'out');
  assert.equal(statusAfterFault('repair', 'low'), 'repair');
  assert.equal(statusAfterFault('out', 'low'), 'out');
});

test('equipment: a device shows its open faults, the worst first, and what is still wrong', () => {
  const e = (id: string, at: string, sev: Issue['severity'], faults: string[], channels: string[], fixedAt: string | null = null) => ({ ...base, id, deviceAt: at, device: { kind: 'headset' as const, code: 'E1' }, faults, channels, severity: sev, fixedAt });
  const s = deviceSummary('E1', [e('a', '2026-11-01T10:00:00Z', 'high', ['no-signal'], [], '2026-11-05T10:00:00Z'), e('b', '2026-11-10T10:00:00Z', 'low', ['channels'], ['P8']), e('c', '2026-11-12T10:00:00Z', 'medium', ['bluetooth', 'channels'], ['O1']), { ...base, id: 'd' }]);
  assert.deepEqual(s.open, ['c', 'b']);
  assert.equal(s.worst, 'medium', 'the fixed high fault no longer counts');
  assert.deepEqual(s.faults, ['bluetooth', 'channels']);
  assert.deepEqual(s.channels, ['O1', 'P8']);
  assert.equal(s.lastReported, '2026-11-12T10:00:00Z');
  assert.equal(s.all, 3);
});

test('the headset list of 14 November 2026: every headset, the sheet’s words, faults that the form offers', () => {
  assert.equal(HEADSET_LIST.length, 16);
  assert.equal(new Set(HEADSET_LIST.map((h) => h.code)).size, 16);
  assert.equal(HEADSET_LIST.filter((h) => h.faults.length).length, 15, 'E50211EE had no issue');
  for (const h of HEADSET_LIST) {
    const r = issueInput({ id: headsetListEntryId(h.code), deviceAt: '2026-11-14T12:00:00Z', type: 'eeg', impact: 'may-affect', note: h.issue, device: { kind: 'headset', code: h.code }, faults: h.faults, channels: h.channels, severity: h.severity }, team, new Date('2026-11-22T12:00:00Z'));
    assert.ok(r.ok, h.code);
    if (r.ok) assert.deepEqual([...r.value.faults].sort(), [...h.faults].sort(), `${h.code}: every fault is one the form has`);
    if (r.ok) assert.deepEqual([...r.value.channels].sort(), [...h.channels].sort(), `${h.code}: channels`);
    if (h.channels.length) assert.ok(h.faults.includes('channels'), `${h.code}: channels go with the channels fault`);
  }
  assert.equal(statusFromList('high'), 'out');
  assert.equal(statusFromList(null), 'ok');
  const rows = issueRows([{ ...base, device: { kind: 'headset', code: 'E50211F7' }, faults: ['bluetooth', 'channels'], channels: ['O2', 'P8'], severity: 'medium', importedFrom: 'Headset list, 14 November 2026' }]).research[0];
  assert.equal(rows.device_code, 'E50211F7');
  assert.equal(rows.faults, 'bluetooth,channels');
  assert.equal(rows.channels, 'O2,P8');
  assert.equal(rows.imported_from, 'Headset list, 14 November 2026');
});

test('actions and clearing; the register: unique names, a list pasted in', async () => {
  const { bulkDevices, deviceInput, isDone, nameKey } = await import('./issues.js');
  assert.ok(!isDone('open') && !isDone('actioned') && isDone('cleared') && isDone('handled') && isDone('not-relevant'));
  assert.ok(mayDo('issue-action', 'researcher', 'active') && !mayDo('issue-action', 'ra', 'active'), 'the team log actions and clear entries');
  assert.ok(mayDo('issue-equipment-bulk', 'pm', 'active') && !mayDo('issue-equipment-bulk', 'ra', 'active'));
  assert.equal(nameKey('  Laptop   3 '), nameKey('laptop 3'));
  const d = deviceInput({ code: 'lt 01', name: ' Laptop  1 ', kind: 'laptop', model: 'Dell Latitude 5440', serial: 'ABC123', location: 'Lab cupboard' });
  assert.ok(d.ok && d.value.code === 'LT-01' && d.value.name === 'Laptop 1' && d.value.location === 'Lab cupboard');
  const pasted = bulkDevices('code,name,kind,model,serial,where\nLT-01,Laptop 1,laptop,Dell,SN1,Lab\nLT-02\tLaptop 2\t\tDell\tSN2\nIP-01,Blue iPad,iPad,iPad 9th gen,,Office\n', 'laptop');
  assert.deepEqual(pasted.problems, []);
  assert.deepEqual(pasted.devices.map((x) => `${x.code}/${x.kind}/${x.name}`), ['LT-01/laptop/Laptop 1', 'LT-02/laptop/Laptop 2', 'IP-01/ipad/Blue iPad']);
  assert.equal(bulkDevices('LT-01,Laptop 1\nLT-02,laptop 1', 'laptop').problems.length, 1, 'a name twice');
  assert.equal(bulkDevices('LT-01,Laptop 1,toaster', 'laptop').problems.length, 1, 'an unknown kind');
  const row = issueRows([{ ...base, status: 'cleared', actions: [{ id: 'a', at: '2026-11-13T10:00:00Z', by: 't1', byName: 'Rae', text: 'Swapped the felts', status: 'cleared' }] }]).research[0];
  assert.equal(row.actions, '2026-11-13: Swapped the felts');
  assert.equal(row.status, 'cleared');
});
