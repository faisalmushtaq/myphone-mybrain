import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { consentRows, donationRows, exportBucketName, exportImagePath, plain, surveyRows, toCsv } from './export.js';

test('CSV is Excel-friendly: byte-order mark, CRLF, quoting only where needed, lists joined', () => {
  const csv = toCsv([
    { a: 'plain', b: 'has, comma', c: 'has "quotes"', d: ['Year 8', 'Year 9'], e: null, f: 3 },
    { a: 'line\nbreak', b: '', c: undefined, d: [], e: true, f: 0 },
  ]);
  assert.ok(csv.startsWith('﻿a,b,c,d,e,f\r\n'));
  assert.ok(csv.includes('plain,"has, comma","has ""quotes""",Year 8; Year 9,,3\r\n'));
  assert.ok(csv.includes('"line\nbreak",,,,true,0\r\n'));
});

test('timestamps become ISO strings everywhere', () => {
  const when = new Date('2026-10-01T06:00:00.000Z');
  const out = plain({ a: Timestamp.fromDate(when), nested: [{ b: Timestamp.fromDate(when) }], keep: 'x' }) as Record<string, unknown>;
  assert.equal(out.a, '2026-10-01T06:00:00.000Z');
  assert.deepEqual(out.nested, [{ b: '2026-10-01T06:00:00.000Z' }]);
  assert.equal(out.keep, 'x');
});

test('consent records flatten to one row per record and one per statement, with the exported signature path', () => {
  const docs = [
    {
      id: 'c1',
      data: {
        participantId: 'p1',
        referenceCode: 'MPMB-AAAA-AAA',
        version: 1,
        supersedes: null,
        formId: 'mpmb-parent-consent',
        formVersion: '0.5-draft',
        typedName: 'Priya Patel',
        signature: { method: 'drawn', image: { path: 'signatures/p1/c1.png' } },
        responses: { 'take-part': { version: '0.4-draft', response: 'agreed', respondedAt: 't1', via: 'group' }, 'link-records': { version: '0.4-draft', response: 'declined', respondedAt: 't2', via: 'individual' } },
      },
    },
  ];
  const { records, statements } = consentRows(docs);
  assert.equal(records.length, 1);
  assert.equal(records[0].signatureFile, 'identifying/signatures/p1/c1.png');
  assert.equal(statements.length, 2);
  assert.deepEqual(statements[1], { consentId: 'c1', participantId: 'p1', version: 1, statementId: 'link-records', statementVersion: '0.4-draft', response: 'declined', respondedAt: 't2', via: 'individual' });
});

test('surveys come out wide (a column per question) and long (a row per answer)', () => {
  const docs = [{ id: 's1', data: { participantId: 'p1', version: 2, status: 'completed', responses: { concern: { version: '0.2-draft', value: 'somewhat', answeredAt: 't' } } } }];
  const { wide, long } = surveyRows(docs, ['concern', 'compared-peers']);
  assert.equal(wide[0].concern, 'somewhat');
  assert.equal(wide[0]['compared-peers'], '');
  assert.deepEqual(long, [{ surveyId: 's1', participantId: 'p1', version: 2, questionId: 'concern', questionVersion: '0.2-draft', value: 'somewhat', answeredAt: 't' }]);
});

test('images are listed with their export path and quality verdict, and never with names', () => {
  const docs = [{ id: 'd1', data: { participantId: 'p1', platform: 'ios', images: [{ uploadId: 'u1', path: 'donations/p1/u1.png', contentType: 'image/png', width: 1170, height: 2532, bytes: 1000, sha256: 'abc', redacted: true, cropped: false, quality: { verdict: 'review', reasons: ['Vision checks not enabled.'], appsVisible: false } }] } }];
  const { records, images } = donationRows(docs);
  assert.equal(records[0].imageCount, 1);
  assert.equal(images[0].file, 'research/images/p1/u1.png');
  assert.equal(images[0].verdict, 'review');
  assert.equal(exportImagePath('donations/p9/x.jpg'), 'research/images/p9/x.jpg');
  assert.ok(!JSON.stringify(images).includes('Patel'));
});

test('the export bucket is named after the project unless configured', () => {
  assert.equal(exportBucketName({ GCLOUD_PROJECT: 'myphone-mybrain' }), 'myphone-mybrain-exports');
  assert.equal(exportBucketName({ GCLOUD_PROJECT: 'x', MPMB_EXPORT_BUCKET: 'custom' }), 'custom');
});
