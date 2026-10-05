import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { ageAt, agreementTables, behTable, exportBucketName, participantsKey, participantsTable, phenotypeDictionary, phenotypeTable, plain, screenshotFile, sessionsOf, subjectLabel, toTsv, type Snapshot } from './export.js';

const empty = (): Snapshot => ({ participants: [], consents: [], assents: [], submissions: [], enquiries: [], surveys: [], donations: [], labels: new Map() });

test('TSV follows BIDS conventions: tabs, n/a for missing, no byte-order mark, no line breaks inside cells', () => {
  const tsv = toTsv([
    { participant_id: 'sub-00001', note: 'has\ttab and\nnewline', list: ['a', 'b'], empty: '', missing: null, n: 0 },
    { participant_id: 'sub-00002', note: 'plain', list: [], empty: 'x', missing: undefined, n: 3 },
  ]);
  assert.equal(tsv, 'participant_id\tnote\tlist\tempty\tmissing\tn\nsub-00001\thas tab and newline\ta; b\tn/a\tn/a\t0\nsub-00002\tplain\tn/a\tx\tn/a\t3\n');
  assert.ok(!tsv.startsWith('﻿'));
});

test('timestamps become ISO strings everywhere', () => {
  const when = new Date('2026-10-01T06:00:00.000Z');
  const out = plain({ a: Timestamp.fromDate(when), nested: [{ b: Timestamp.fromDate(when) }], keep: 'x' }) as Record<string, unknown>;
  assert.equal(out.a, '2026-10-01T06:00:00.000Z');
  assert.deepEqual(out.nested, [{ b: '2026-10-01T06:00:00.000Z' }]);
});

test('labels, ages and file names follow the BIDS pattern', () => {
  assert.equal(subjectLabel(7), 'sub-00007');
  assert.equal(ageAt('2013-03-14', '2026-03-13'), 12);
  assert.equal(ageAt('2013-03-14', '2026-03-14'), 13);
  assert.equal(ageAt(null, '2026-03-14'), null);
  const session = { participantId: 'p1', label: 'sub-00001', session: 'ses-02', donation: { id: 'd', data: {} }, images: [] };
  assert.equal(screenshotFile(session, 3, 'donations/p1/x.jpg'), 'sourcedata/sub-00001/ses-02/sub-00001_ses-02_task-screentime_run-03_screenshot.jpg');
  assert.equal(exportBucketName({ GCLOUD_PROJECT: 'myphone-mybrain' }), 'myphone-mybrain-exports');
});

test('participants.tsv holds only consenting participants, de-identified, with age at consent and screenshot counts', () => {
  const snap = empty();
  snap.participants = [
    { id: 'p1', data: { kind: 'consent', firstName: 'Kai', lastName: 'Patel', dateOfBirth: '2013-03-14', schoolId: 'BRD-001', yearGroup: 'Year 8', studyNumber: 1 } },
    { id: 'p2', data: { kind: 'declined', firstName: 'Sam', lastName: 'Lee' } },
  ];
  snap.labels = new Map([['p1', 'sub-00001']]);
  snap.submissions = [{ id: 'MPMB-AAAA-AAA', data: { participantId: 'p1', consentId: 'c1', assentId: 'a1', route: 'young' } }];
  snap.consents = [{ id: 'c1', data: { participantId: 'p1', confirmedDate: '2026-10-01', formVersion: '0.5-draft', route: 'young' } }];
  snap.assents = [{ id: 'a1', data: { participantId: 'p1', status: 'completed' } }];
  snap.donations = [
    { id: 'd2', data: { participantId: 'p1', platform: 'android', receivedAt: '2026-10-02T10:00:00.000Z', images: [{ path: 'donations/p1/b.png' }] } },
    { id: 'd1', data: { participantId: 'p1', platform: 'ios', receivedAt: '2026-10-01T10:00:00.000Z', images: [{ path: 'donations/p1/a.png' }, { path: 'donations/p1/c.png' }] } },
  ];
  const rows = participantsTable(snap);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { participant_id: 'sub-00001', age: 13, year_group: 'Year 8', site: 'BRD-001', route: 'young', consented_on: '2026-10-01', consent_version: '0.5-draft', assent_status: 'completed', questions_status: 'not-started', sessions_n: 2, screenshots_n: 3, platform: 'android' });
  assert.ok(!JSON.stringify(rows).includes('Patel'));
  const sessions = sessionsOf(snap);
  assert.deepEqual(sessions.map((s) => [s.session, s.donation.id]), [['ses-01', 'd1'], ['ses-02', 'd2']], 'sessions are numbered in time order');
  assert.equal(behTable(sessions[0])[1].filename, 'sourcedata/sub-00001/ses-01/sub-00001_ses-01_task-screentime_run-02_screenshot.png');
  const key = participantsKey(snap);
  assert.equal(key[0].participant_id, 'sub-00001');
  assert.equal(key[0].first_name, 'Kai');
  assert.equal(key[1].participant_id, null, 'declined families have no label');
});

test('the phenotype file keeps the latest answers per participant and its dictionary carries the wording', () => {
  const snap = empty();
  snap.labels = new Map([['p1', 'sub-00001']]);
  snap.surveys = [
    { id: 's1', data: { participantId: 'p1', version: 1, status: 'completed', formVersion: '0.2-draft', responses: { concern: { value: 'a-little', version: '0.1-draft' } } } },
    { id: 's2', data: { participantId: 'p1', version: 2, status: 'completed', formVersion: '0.2-draft', responses: { concern: { value: 'somewhat', version: '0.1-draft' }, 'anything-else': { value: 'Mostly YouTube,\nlate at night.', version: '0.1-draft' } } } },
  ];
  const rows = phenotypeTable(snap);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].concern, 'somewhat');
  assert.equal(rows[0].compared_peers, '');
  assert.equal(rows[0].anything_else, 'Mostly YouTube,\nlate at night.');
  assert.ok(toTsv(rows).includes('Mostly YouTube, late at night.'), 'line breaks are flattened in the file');
  const dict = phenotypeDictionary() as Record<string, { Description: string; Levels?: Record<string, string> }>;
  assert.ok(dict.concern.Description.includes('concerned'));
  assert.equal(dict.concern.Levels?.somewhat, 'Somewhat');
  assert.equal(dict.gets_in_the_way.Levels?.['almost-always'], 'Almost always');
});

test('consent records flatten to one row per record and one per statement, with the exported signature path', () => {
  const labels = new Map([['p1', 'sub-00001']]);
  const docs = [
    {
      id: 'c1',
      data: {
        participantId: 'p1',
        referenceCode: 'MPMB-AAAA-AAA',
        version: 2,
        supersedes: 'c0',
        formId: 'mpmb-parent-consent',
        formVersion: '0.5-draft',
        typedName: 'Priya Patel',
        signature: { method: 'drawn', image: { path: 'signatures/p1/c1.png' } },
        responses: { 'take-part': { version: '0.4-draft', response: 'agreed', respondedAt: 't1', via: 'group' }, 'link-records': { version: '0.4-draft', response: 'declined', respondedAt: 't2', via: 'individual' } },
      },
    },
  ];
  const { records, statements } = agreementTables('consent', docs, labels);
  assert.equal(records[0].participant_id, 'sub-00001');
  assert.equal(records[0].signature_file, 'signatures/sub-00001/sub-00001_consent-v2_signature.png');
  assert.equal(statements.length, 2);
  assert.deepEqual(statements[1], { consent_id: 'c1', participant_id: 'sub-00001', version: 2, statement_id: 'link-records', statement_version: '0.4-draft', response: 'declined', responded_at: 't2', via: 'individual' });
});
