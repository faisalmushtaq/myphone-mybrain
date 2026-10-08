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
    { id: 'p1', data: { kind: 'consent', referenceCode: 'MPMB-AAAA-AAA', firstName: 'Kai', lastName: 'Patel', dateOfBirth: '2013-03-14', schoolId: 'BRD-001', yearGroup: 'Year 8', studyNumber: 1, guardian: { fullName: 'Asha Patel', relationship: 'mother', address: '14 Long Lane, Leeds', postcode: 'LS6 1AB', uprn: '72000014', email: null, phone: '07700 900123' } } },
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
  assert.deepEqual(rows[0], { participant_id: 'sub-00001', age: 13, year_group: 'Year 8', site: 'BRD-001', route: 'young', consented_on: '2026-10-01', consent_version: '0.5-draft', self_consent: false, phone_source: null, assent_status: 'completed', questions_status: 'not-started', more_questions_status: 'not-asked', sessions_n: 2, screenshots_n: 3, platform: 'android', added_later_on: null, opted_out: false });
  assert.ok(!JSON.stringify(rows).includes('Patel'));
  const sessions = sessionsOf(snap);
  assert.deepEqual(sessions.map((s) => [s.session, s.donation.id]), [['ses-01', 'd1'], ['ses-02', 'd2']], 'sessions are numbered in time order');
  assert.equal(behTable(sessions[0])[1].filename, 'sourcedata/sub-00001/ses-01/sub-00001_ses-01_task-screentime_run-02_screenshot.png');
  const key = participantsKey(snap);
  assert.equal(key[0].participant_id, 'sub-00001');
  assert.equal(key[0].first_name, 'Kai');
  // Everything needed to match a family to the workshop's records sits on one row, with the label that joins it to their answers.
  assert.deepEqual(
    [key[0].reference_code, key[0].last_name, key[0].date_of_birth, key[0].school_id, key[0].year_group, key[0].guardian_name, key[0].relationship, key[0].address, key[0].postcode, key[0].uprn, key[0].phone],
    ['MPMB-AAAA-AAA', 'Patel', '2013-03-14', 'BRD-001', 'Year 8', 'Asha Patel', 'mother', '14 Long Lane, Leeds', 'LS6 1AB', '72000014', '07700 900123'],
  );
  assert.ok(!JSON.stringify(rows).includes('Long Lane') && !JSON.stringify(rows).includes('72000014'), 'the address and UPRN stay out of the research dataset');
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

test('the lab dataset is labelled by participant ID, has one session per phase, names files by run, and keeps names in identifying/', async () => {
  const { labBehTable, labConsentTables, labExport, labFile, labParticipantsTable, labSessionsOf, labSessionsTable, labSignatureFile } = await import('./exportLab.js');
  const snap = {
    reminders: [{ id: 'MP2670FF90A5F2', data: { email: 'jane@example.com', requestedAt: '2026-10-05T11:00:00.000Z', statusOutcome: 'sent', followUpDueAt: '2026-10-07T11:00:00.000Z', followUpSentAt: null, completedAt: '2026-10-08T10:00:00.000Z' } }],
    checkIns: [{ id: 'k1', data: { participantCode: 'MP2670FF90A5F2', number: 1, formVersion: '0.1-draft', receivedAt: '2026-10-20T10:00:00.000Z', answers: { week: '2', 'apps-used': 'never', mood: '4', difficulty: '3', missed: '2', notes: 'Brick held up fine' } } }],
    participants: [{ id: 'MP2670FF90A5F2', data: { consentId: 'c1', consentVersion: 1, archiveCount: 1, screenshotCount: 2, platformsNotUsed: ['youtube', 'instagram'] } }, { id: 'MP33CE17327FF2', data: { consentId: 'c2', consentVersion: 1 } }],
    consents: [
      { id: 'c1', data: { participantCode: 'MP2670FF90A5F2', version: 1, formVersion: '1.0', informationVersion: '1.0', confirmedDate: '2026-10-05', typedName: 'Jane Doe', codeParts: { firstName: 'Jane', lastName: 'Doe', dateOfBirth: '2005-03-14', postcode: 'AB1 2CD' }, responses: { 'take-part': { version: '1.0', response: 'agreed', respondedAt: '2026-10-05T09:00:00.000Z', via: 'individual' } }, signature: { method: 'drawn', image: { path: 'signatures/lab/MP2670FF90A5F2/c1.png' } } } },
      { id: 'c2', data: { participantCode: 'MP33CE17327FF2', version: 1, formVersion: '1.0', informationVersion: '1.0', confirmedDate: '2026-10-06', typedName: 'Zed Zee', responses: {}, signature: { method: 'typed', typedName: 'Zed Zee', image: null } } },
    ],
    donations: [
      // Two sends before the break (the YouTube export arrived days after the TikTok one) and one after: two sessions.
      { id: 'd2', data: { participantCode: 'MP2670FF90A5F2', phase: 'pre', receivedAt: '2026-10-08T10:00:00.000Z', needsReview: false, phone: 'iphone', files: [{ kind: 'screenshot', path: 'lab/MP2670FF90A5F2/u3.png', bytes: 30, sha256: 'cc', width: 100, height: 200, quality: { verdict: 'accepted', reasons: [] } }] } },
      { id: 'd1', data: { participantCode: 'MP2670FF90A5F2', phase: 'pre', receivedAt: '2026-10-05T10:00:00.000Z', needsReview: true, phone: 'iphone', files: [{ kind: 'archive', path: 'lab/MP2670FF90A5F2/u1.zip', bytes: 10, sha256: 'aa', platforms: ['tiktok'], categories: ['tt_watch'], kept: { tt_watch: 3 }, manifest: { cleaner: 'MyPhone/MyBrain data donation cleaner 1.0', cleanedAt: '2026-10-05T09:50:00.000Z' }, entries: ['manifest.json', 'tiktok_cleaned.json'] }] } },
      { id: 'd3', data: { participantCode: 'MP2670FF90A5F2', phase: 'post', receivedAt: '2026-11-10T10:00:00.000Z', needsReview: false, phone: 'iphone', files: [{ kind: 'screenshot', path: 'lab/MP2670FF90A5F2/u4.jpg', bytes: 20, sha256: 'bb', width: 100, height: 200, quality: { verdict: 'review', reasons: ['Not portrait.'] } }] } },
      // A screenshot sent with the week-2 check-in.
      { id: 'd4', data: { participantCode: 'MP2670FF90A5F2', phase: 'mid', checkInId: 'k1', receivedAt: '2026-10-20T10:01:00.000Z', needsReview: false, phone: 'iphone', files: [{ kind: 'screenshot', path: 'lab/MP2670FF90A5F2/u5.png', bytes: 25, sha256: 'dd', width: 100, height: 200, quality: { verdict: 'accepted', reasons: [] } }] } },
    ],
  };
  const rows = labParticipantsTable(snap);
  assert.deepEqual(rows[0], { participant_id: 'sub-MP2670FF90A5F2', consented_on: '2026-10-05', consent_version: '1.0', information_version: '1.0', consent_n: 1, age: 21, phases: ['pre', 'mid', 'post'], sends_n: 4, checkins_n: 1, archives_n: 1, screenshots_n: 3, platforms: ['tiktok'], platforms_not_used: ['instagram', 'youtube'], phone: 'iphone', first_send_at: '2026-10-05T10:00:00.000Z', last_send_at: '2026-11-10T10:00:00.000Z', stories_n: 0, visit1_on: null, visit1_status: null, visit2_on: null, visit2_status: null });
  assert.equal(rows[1].sends_n, 0, 'consented but nothing sent yet');
  assert.ok(!JSON.stringify(rows).includes('Jane'));
  const sessions = labSessionsOf(snap);
  assert.deepEqual(sessions.map((s) => [s.session, s.donations.map((d) => d.id)]), [['ses-pre', ['d1', 'd2']], ['ses-mid', ['d4']], ['ses-post', ['d3']]], 'one session per phase, sends in time order, pre, mid, post');
  const [pre, mid, post] = sessions;
  assert.equal(labBehTable(mid)[0].check_in_id, 'k1', 'a check-in screenshot points at its check-in');
  assert.equal(labFile(pre, 1, pre.files[0].file), 'sourcedata/sub-MP2670FF90A5F2/ses-pre/sub-MP2670FF90A5F2_ses-pre_run-01_archive.zip');
  assert.equal(labFile(pre, 2, pre.files[1].file), 'sourcedata/sub-MP2670FF90A5F2/ses-pre/sub-MP2670FF90A5F2_ses-pre_run-02_screenshot.png');
  assert.equal(labFile(post, 1, post.files[0].file), 'sourcedata/sub-MP2670FF90A5F2/ses-post/sub-MP2670FF90A5F2_ses-post_run-01_screenshot.jpg');
  const beh = labBehTable(pre);
  assert.equal(beh[0].kept_tt_watch, 3);
  assert.equal(beh[0].kept_yt_watch, null);
  assert.equal(beh[1].send_id, 'd2');
  assert.equal(beh[1].received_at, '2026-10-08T10:00:00.000Z');
  assert.equal(labBehTable(post)[0].verdict, 'review');
  const sessionRows = labSessionsTable(sessions);
  assert.deepEqual(sessionRows[0], { session_id: 'ses-pre', phase: 'pre', acq_time: '2026-10-05T10:00:00.000Z', last_send_at: '2026-10-08T10:00:00.000Z', sends_n: 2, archives_n: 1, screenshots_n: 1, platforms: ['tiktok'], phone: 'iphone', needs_review: true });
  assert.equal(labSessionsOf({ ...snap, donations: [{ id: 'dx', data: { participantCode: 'MP2670FF90A5F2', receivedAt: '2026-10-05T10:00:00.000Z', files: [] } }] })[0].session, 'ses-unspecified', 'a send without a phase keeps its own session');
  assert.equal(labSignatureFile('MP2670FF90A5F2', 1), 'signatures/sub-MP2670FF90A5F2/sub-MP2670FF90A5F2_consent-v1_signature.png');
  const { records, statements } = labConsentTables(snap.consents);
  assert.equal(records[0].typed_name, 'Jane Doe');
  assert.equal(records[0].postcode, 'AB1 2CD');
  assert.equal(records[0].first_name, 'Jane');
  assert.equal(records[0].last_name, 'Doe');
  assert.equal(records[0].date_of_birth, '2005-03-14');
  assert.equal(rows[1].age, null, 'no age without a date of birth');
  assert.equal(records[0].signature_file, 'signatures/sub-MP2670FF90A5F2/sub-MP2670FF90A5F2_consent-v1_signature.png');
  assert.equal(records[1].signature_file, null);
  assert.equal(statements[0].statement_id, 'take-part');
  const out = labExport(snap, '2026-10-06T12:00:00.000Z');
  const paths = out.files.map((f) => f.path);
  assert.ok(paths.includes('social-media-break/README.md') && paths.includes('social-media-break/donations/participants.tsv') && paths.includes('social-media-break/donations/sub-MP2670FF90A5F2/sub-MP2670FF90A5F2_sessions.tsv') && paths.includes('social-media-break/donations/sub-MP2670FF90A5F2/ses-pre/beh/sub-MP2670FF90A5F2_ses-pre_task-donation_beh.tsv') && paths.includes('social-media-break/donations/sub-MP2670FF90A5F2/ses-post/beh/sub-MP2670FF90A5F2_ses-post_task-donation_beh.tsv') && paths.includes('social-media-break/identifying/consents.tsv') && paths.includes('social-media-break/identifying/README.md'));
  assert.ok(paths.every((p) => p.startsWith('social-media-break/')), 'everything of this study lives in its own folder');
  const reminders = out.files.find((f) => f.path === 'social-media-break/identifying/reminders.tsv')!.body;
  assert.ok(reminders.includes('MP2670FF90A5F2\tsub-MP2670FF90A5F2\tjane@example.com\t2026-10-05T11:00:00.000Z\tsent'));
  assert.ok(!paths.some((p) => p.includes('/sub-MP33CE17327FF2/')), 'no subject folder before anything is sent');
  assert.deepEqual(Array.from(out.copies.entries()), [
    ['lab/MP2670FF90A5F2/u1.zip', 'social-media-break/donations/sourcedata/sub-MP2670FF90A5F2/ses-pre/sub-MP2670FF90A5F2_ses-pre_run-01_archive.zip'],
    ['lab/MP2670FF90A5F2/u3.png', 'social-media-break/donations/sourcedata/sub-MP2670FF90A5F2/ses-pre/sub-MP2670FF90A5F2_ses-pre_run-02_screenshot.png'],
    ['lab/MP2670FF90A5F2/u5.png', 'social-media-break/donations/sourcedata/sub-MP2670FF90A5F2/ses-mid/sub-MP2670FF90A5F2_ses-mid_run-01_screenshot.png'],
    ['lab/MP2670FF90A5F2/u4.jpg', 'social-media-break/donations/sourcedata/sub-MP2670FF90A5F2/ses-post/sub-MP2670FF90A5F2_ses-post_run-01_screenshot.jpg'],
    ['signatures/lab/MP2670FF90A5F2/c1.png', 'social-media-break/identifying/signatures/sub-MP2670FF90A5F2/sub-MP2670FF90A5F2_consent-v1_signature.png'],
  ]);
  assert.deepEqual(out.counts, { labParticipants: 2, labConsents: 2, labDonations: 4, labArchives: 1, labScreenshots: 3, labSignatures: 1, labCheckIns: 1, labStories: 0, labBookings: 0 });
  const checkins = out.files.find((f) => f.path === 'social-media-break/donations/phenotype/checkin.tsv')!.body;
  assert.equal(checkins, 'participant_id\tsession_id\tcheck_in_id\tcheck_in_n\tsubmitted_at\tform_version\tweek\tapps_used\tmood\tdifficulty\tmissed\tnotes\nsub-MP2670FF90A5F2\tses-mid\tk1\t1\t2026-10-20T10:00:00.000Z\t0.1-draft\t2\tnever\t4\t3\t2\tBrick held up fine\n');
  const checkinDictionary = JSON.parse(out.files.find((f) => f.path === 'social-media-break/donations/phenotype/checkin.json')!.body);
  assert.equal(checkinDictionary.apps_used.Levels.never, 'Not at all', 'the data dictionary carries the answer labels');
  const labTsv = out.files.find((f) => f.path === 'social-media-break/donations/participants.tsv')!.body;
  assert.ok(!labTsv.includes('Jane') && !labTsv.includes('Zed') && !labTsv.includes('AB1') && !labTsv.includes('2005-03-14'), 'names, dates of birth and postcodes stay out of the research dataset');
  assert.ok(labTsv.includes('\tiphone\t') && labTsv.includes('pre; mid; post'));
});

test('a cleaned archive is unpacked into one BIDS behavioural table per kind of record', async () => {
  const JSZip = (await import('jszip')).default;
  const { ARCHIVE_TABLES, archiveTablePath, archiveTablesFor, buildArchiveTables } = await import('./exportLab.js');
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({ cleaner: 'MyPhone/MyBrain data donation cleaner 1.0', platforms: ['tiktok', 'youtube'] }));
  zip.file('tiktok_cleaned.json', JSON.stringify({ Activity: { WatchHistory: [{ Date: '2026-09-01 20:11:03', Link: 'https://t/1' }], Searches: [{ Date: '2026-09-02 08:00:00', SearchTerm: 'study tips' }], Likes: [{ date: '2026-09-01', link: 'https://t/5' }], Shares: [{ Date: '2026-09-03', Link: 'https://t/4', Method: 'copy_link' }], Reposts: [], LoginTimestamps: [{ Date: '2026-09-01 20:10:00' }] }, AggregateCounts: { 'Your Activity': 12, Profile: 3 } }));
  zip.file('youtube/history/watch-history.json', JSON.stringify([{ header: 'YouTube', title: 'Watched How brains work', titleUrl: 'https://y/abc', subtitles: [{ name: 'Brain Channel', url: 'https://y/c/1' }], time: '2026-10-01T14:01:48.000Z' }]));
  zip.file('youtube/subscriptions/subscriptions.csv', 'Channel Id,Channel Url,Channel Title\nUC1,https://y/c/1,"Brain, Channel"\n');
  const file = { kind: 'archive', entries: ['manifest.json', 'tiktok_cleaned.json', 'youtube/history/watch-history.json', 'youtube/subscriptions/subscriptions.csv'], categories: ['tt_watch', 'tt_search', 'tt_engage', 'tt_login', 'tt_counts', 'yt_watch', 'yt_subs'] };
  const tables = archiveTablesFor(file);
  assert.deepEqual(tables.map((t) => t.task), ['tiktokwatch', 'tiktoksearch', 'tiktokengage', 'tiktokapp', 'tiktoktotals', 'youtubewatch', 'youtubesubs'], 'no table for the search history that was not exported, nor for an unticked category');
  assert.equal(archiveTablesFor({ kind: 'archive', entries: ['manifest.json', 'tiktok_cleaned.json'], categories: ['tt_watch'] }).length, 1);
  const session = { code: 'MP2670FF90A5F2', label: 'sub-MP2670FF90A5F2', session: 'ses-pre', phase: 'pre', donations: [], files: [] };
  assert.equal(archiveTablePath(session, 1, 'tiktokwatch'), 'sub-MP2670FF90A5F2/ses-pre/beh/sub-MP2670FF90A5F2_ses-pre_task-tiktokwatch_run-01_beh');
  const out = await buildArchiveTables(await zip.generateAsync({ type: 'nodebuffer' }), tables.map((table) => ({ table, base: `x/${table.task}` })));
  const body = (task: string) => out.find((f) => f.path === `x/${task}.tsv`)!.body;
  assert.equal(body('tiktokwatch'), 'time\tlink\n2026-09-01 20:11:03\thttps://t/1\n');
  assert.equal(body('tiktokengage'), 'time\taction\tlink\tmethod\n2026-09-01\tlike\thttps://t/5\tn/a\n2026-09-03\tshare\thttps://t/4\tcopy_link\n');
  assert.equal(body('tiktoktotals'), 'section\titems\nYour Activity\t12\nProfile\t3\n');
  assert.equal(body('youtubewatch'), 'time\ttitle\turl\tchannel\tchannel_url\n2026-10-01T14:01:48.000Z\tWatched How brains work\thttps://y/abc\tBrain Channel\thttps://y/c/1\n');
  assert.equal(body('youtubesubs'), 'channel_id\tchannel_url\tchannel_title\nUC1\thttps://y/c/1\tBrain, Channel\n');
  assert.ok(JSON.parse(out.find((f) => f.path === 'x/tiktokwatch.json')!.body).TaskName === 'tiktokwatch');
  assert.equal(ARCHIVE_TABLES.length, 12);
  const ig = new JSZip();
  ig.file('manifest.json', '{}');
  ig.file('instagram/reels_watched.json', JSON.stringify([{ time: '2025-10-01T06:26:40.000Z', url: 'https://www.instagram.com/reel/abc/' }]));
  ig.file('instagram/searches.json', JSON.stringify([{ time: '2025-10-01T07:00:00.000Z', search: 'sleep tips' }]));
  const igTables = archiveTablesFor({ kind: 'archive', entries: ['manifest.json', 'instagram/reels_watched.json', 'instagram/searches.json'], categories: ['ig_watch', 'ig_search'] });
  assert.deepEqual(igTables.map((t) => t.task), ['instagramreels', 'instagramsearch']);
  const igOut = await buildArchiveTables(await ig.generateAsync({ type: 'nodebuffer' }), igTables.map((table) => ({ table, base: `y/${table.task}` })));
  assert.equal(igOut.find((f) => f.path === 'y/instagramreels.tsv')!.body, 'time\turl\n2025-10-01T06:26:40.000Z\thttps://www.instagram.com/reel/abc/\n');
  assert.equal(igOut.find((f) => f.path === 'y/instagramsearch.tsv')!.body, 'time\tsearch_term\n2025-10-01T07:00:00.000Z\tsleep tips\n');
});

test('MyStory: one table per phase, a triangle spread over its corners, every answer marked answered, not sure or left out', async () => {
  const { labStoryColumns, labStoryDictionary, labStoryTable, labExport, visitColumns, labVisitsTable } = await import('./exportLab.js');
  const stories = [
    { id: 's2', data: { participantCode: 'MP2670FF90A5F2', phase: 'mid', structureVersion: '0.1-draft', promptId: 'pull', title: 'Bus', story: 'Reached for my phone on the bus.', answers: { pull: { a: 0.5, b: 0.25, c: 0.25 }, hard: 80, where: 'travelling', afterwards: 'na' }, source: 'checkin', checkInId: 'k1', receivedAt: '2026-10-20T10:05:00.000Z' } },
    { id: 's1', data: { participantCode: 'MP2670FF90A5F2', phase: 'pre', structureVersion: '0.1-draft', promptId: 'evening', title: 'Evenings', story: 'Scrolling until late most nights.', answers: {}, source: 'story', receivedAt: '2026-10-06T10:05:00.000Z' } },
  ];
  const columns = labStoryColumns('mid');
  assert.deepEqual(columns.slice(0, 11), ['participant_id', 'session_id', 'story_id', 'story_n', 'submitted_at', 'structure_version', 'source', 'check_in_id', 'prompt_id', 'title', 'story']);
  assert.ok(columns.includes('pull_habit') && columns.includes('pull_people_and_connection') && columns.includes('pull_boredom_or_stress') && columns.includes('pull_status'));
  const [row] = labStoryTable('mid', stories);
  assert.equal(row.participant_id, 'sub-MP2670FF90A5F2');
  assert.equal(row.session_id, 'ses-mid');
  assert.equal(row.pull_habit, 0.5);
  assert.equal(row.pull_status, 'answered');
  assert.equal(row.hard, 80);
  assert.equal(row.afterwards, null);
  assert.equal(row.afterwards_status, 'not-sure');
  assert.equal(row.feeling_status, 'skipped');
  assert.equal(labStoryTable('pre', stories)[0].about_status, 'skipped');
  const dictionary = labStoryDictionary('mid');
  assert.match(String((dictionary.hard as { Description: string }).Description), /0 \(“Easy”\) to 100 \(“Very hard”\)/);
  assert.equal((dictionary.prompt_id as { Levels: Record<string, string> }).Levels.pull, 'Tell us about a moment this week when you wanted to open one of your apps. What happened?');
  const bookings = [
    { id: 'b1', data: { participantCode: 'MP2670FF90A5F2', visit: 1, start: '2026-10-14T09:00:00.000Z', end: '2026-10-14T11:00:00.000Z', status: 'cancelled', cancelReason: 'moved', place: { name: 'Lab' }, reminders: {} } },
    { id: 'b2', data: { participantCode: 'MP2670FF90A5F2', visit: 1, start: '2026-10-15T09:00:00.000Z', end: '2026-10-15T11:00:00.000Z', status: 'attended', replaces: 'b1', place: { name: 'Lab' }, confirmation: { email: 'sent', sms: 'not-wanted' }, reminders: { 'day-before-email': { outcome: 'sent' }, 'same-day-sms': { skipped: 'skip-booked-late' } } } },
  ];
  assert.deepEqual(visitColumns(bookings, 'MP2670FF90A5F2'), { visit1_on: '2026-10-15', visit1_status: 'attended', visit2_on: null, visit2_status: null });
  const visits = labVisitsTable(bookings);
  assert.equal(visits[1].confirmation_email, 'sent');
  assert.deepEqual(visits[1].reminders, ['day-before-email:sent', 'same-day-sms:skip-booked-late']);
  const out = labExport({ participants: [{ id: 'MP2670FF90A5F2', data: { consentId: 'c1' } }], consents: [], donations: [], reminders: [], checkIns: [], stories, bookings, contacts: [{ id: 'MP2670FF90A5F2', data: { email: 'jane@example.com', mobile: '+447700900123', smsReminders: true } }] }, '2026-10-21T12:00:00.000Z');
  const paths = out.files.map((f) => f.path);
  for (const p of ['phenotype/mystory_pre.tsv', 'phenotype/mystory_mid.json', 'phenotype/mystory_post.tsv']) assert.ok(paths.includes(`social-media-break/donations/${p}`), p);
  assert.ok(out.files.find((f) => f.path === 'social-media-break/identifying/contacts.tsv')!.body.includes('jane@example.com\t+447700900123\ttrue'));
  assert.ok(!out.files.filter((f) => f.path.startsWith('social-media-break/donations/')).some((f) => f.body.includes('jane@example.com') || f.body.includes('+447700900123')), 'contact details stay in identifying/');
  assert.equal(out.counts.labStories, 2);
  assert.equal(out.counts.labBookings, 1);
});

test('UPN lists: kept in their own folder, read rows beside each file, matched by school, names and date of birth', async () => {
  const { matchPupil, nameKey, upnExport } = await import('./exportUpn.js');
  assert.equal(nameKey("Zoë O'Brien-Smith"), 'ZOEOBRIENSMITH');
  const pupils = [
    { upn: 'A123456789012', firstName: 'Zoe', lastName: 'Obrien-Smith', dateOfBirth: '2012-03-14', yearGroup: '9', className: '9X', uploadId: 'u1', row: 2 },
    { upn: 'A123456789013', firstName: 'Samuel', lastName: 'Lee', dateOfBirth: '2012-05-01', yearGroup: '9', className: '9Y', uploadId: 'u1', row: 3 },
    { upn: 'A123456789014', firstName: 'Amir', lastName: 'Khan', dateOfBirth: '2012-01-01', yearGroup: '9', className: '9X', uploadId: 'u1', row: 4 },
    { upn: 'A123456789015', firstName: 'Amir', lastName: 'Khan', dateOfBirth: '2012-02-02', yearGroup: '9', className: '9Y', uploadId: 'u1', row: 5 },
  ];
  assert.equal(matchPupil({ firstName: "Zoë", lastName: "O'Brien Smith", dateOfBirth: '2012-03-14' }, pupils).level, 'name-and-dob');
  assert.equal(matchPupil({ firstName: 'Sam', lastName: 'Lee', dateOfBirth: '2012-05-01' }, pupils).level, 'surname-and-dob');
  assert.equal(matchPupil({ firstName: 'Samuel', lastName: 'Lee', dateOfBirth: '2012-05-02' }, pupils).level, 'name-only');
  assert.deepEqual(matchPupil({ firstName: 'Amir', lastName: 'Khan', dateOfBirth: '2012-03-03' }, pupils), { level: 'ambiguous', pupil: null, candidates: 2 });
  assert.equal(matchPupil({ firstName: 'Nobody', lastName: 'Here', dateOfBirth: '2012-03-03' }, pupils).level, 'none');
  const uploads = [
    { id: 'aaaaaaaa-1111-2222-3333-444444444444', data: { schoolId: 'DUA', schoolSlug: 'dua', schoolName: 'Dixons Unity Academy', fileName: 'Year 9.csv', path: 'schoolupns/dua/aaaaaaaa-1111-2222-3333-444444444444/Year 9.csv', receivedAt: '2026-10-07T09:00:00.000Z', pupilCount: 2, validUpns: 2, problems: [], uploader: { name: 'Ms T', role: 'Head of Year', email: 't@school.org.uk' }, pupils: pupils.slice(0, 2) } },
  ];
  const participants = [
    { id: 'p1', data: { kind: 'consent', schoolId: 'DUA', firstName: 'Zoë', lastName: "O'Brien-Smith", dateOfBirth: '2012-03-14', yearGroup: '9' } },
    { id: 'p2', data: { kind: 'declined', schoolId: 'DUA', firstName: 'Kit', lastName: 'Jones', dateOfBirth: '2012-04-04' } },
    { id: 'p3', data: { kind: 'consent', schoolId: 'GSAL', firstName: 'Ann', lastName: 'Other', dateOfBirth: '2012-04-04' } },
  ];
  const out = upnExport(uploads, participants, new Map([['p1', 'sub-00001'], ['p3', 'sub-00002']]));
  const paths = out.files.map((f) => f.path);
  assert.ok(paths.includes('schools/upn-uploads/README.md') && paths.includes('schools/upn-uploads/uploads.tsv') && paths.includes('schools/upn-uploads/dua/2026-10-07_aaaaaaaa_pupils.tsv') && paths.includes('schools/upn-uploads/upn_matches.tsv') && paths.includes('schools/upn-uploads/upn_unmatched.tsv'));
  assert.deepEqual(Array.from(out.copies.entries()), [['schoolupns/dua/aaaaaaaa-1111-2222-3333-444444444444/Year 9.csv', 'schools/upn-uploads/dua/2026-10-07_aaaaaaaa_Year 9.csv']]);
  const matches = out.files.find((f) => f.path === 'schools/upn-uploads/upn_matches.tsv')!.body.split('\n');
  assert.ok(matches[1].startsWith('sub-00001\tp1\tconsent\tDUA\tZoë\tO\'Brien-Smith\t2012-03-14\t9\tA123456789012\tname-and-dob'), matches[1]);
  assert.ok(matches[2].startsWith('n/a\tp2\tdeclined\tDUA\tKit\tJones\t2012-04-04\tn/a\tn/a\tnone'), matches[2]);
  assert.equal(matches.length, 4, 'a school with no list is not matched');
  const unmatched = out.files.find((f) => f.path === 'schools/upn-uploads/upn_unmatched.tsv')!.body;
  assert.ok(unmatched.includes('DUA\tA123456789013\tSamuel\tLee'));
  assert.ok(!unmatched.includes('A123456789012'));
  assert.deepEqual(out.counts, { upnUploads: 1, upnPupils: 2, upnMatched: 1, optOuts: 0 });

  // Opt-outs the team logged: flagged on the family's record and on the school's list, and listed with what they name.
  const optOuts = [
    { id: 'o1', data: { firstName: 'Samuel', lastName: 'Lee', schoolId: 'DUA', dateOfBirth: null, receivedOn: '2026-10-08', status: 'active', parentName: 'Mrs Lee' } },
    { id: 'o2', data: { firstName: 'Zoe', lastName: 'OBrien Smith', schoolId: 'DUA', dateOfBirth: '2012-03-14', receivedOn: '2026-10-09', status: 'active', afterWorkshop: true } },
    { id: 'o3', data: { firstName: 'Ann', lastName: 'Other', schoolId: 'GSAL', receivedOn: '2026-10-05', status: 'cancelled' } },
    { id: 'o4', data: { firstName: 'Zoe', lastName: 'OBrien Smith', schoolId: 'DUA', dateOfBirth: '2011-01-01', receivedOn: '2026-10-10', status: 'active' } },
  ];
  const flagged = upnExport(uploads, participants, new Map([['p1', 'sub-00001'], ['p3', 'sub-00002']]), optOuts);
  const flaggedMatches = flagged.files.find((f) => f.path === 'schools/upn-uploads/upn_matches.tsv')!.body.split('\n');
  assert.ok(flaggedMatches[0].endsWith('\topted_out\topt_out_id'));
  assert.ok(flaggedMatches[1].endsWith('\ttrue\to2'), `the opt-out names p1 (a different date of birth does not): ${flaggedMatches[1]}`);
  assert.ok(flaggedMatches[2].endsWith('\tfalse\tn/a'), 'no opt-out for this one');
  assert.ok(flagged.files.find((f) => f.path === 'schools/upn-uploads/upn_unmatched.tsv')!.body.includes('DUA\tA123456789013\tSamuel\tLee\t2012-05-01\t9\t9Y\taaaaaaaa-1111-2222-3333-444444444444\t3\ttrue\to1'));
  assert.equal(flagged.counts.optOuts, 3);
  assert.deepEqual(
    flagged.optOutTable.map((r) => [r.opt_out_id, r.status, r.website_participant_id, r.upn, r.upn_match]),
    [
      ['o3', 'cancelled', 'sub-00002', null, 'none'],
      ['o1', 'active', null, 'A123456789013', 'name-only'],
      ['o2', 'active', 'sub-00001', 'A123456789012', 'name-and-dob'],
      ['o4', 'active', null, 'A123456789012', 'name-only'],
    ],
  );
});
