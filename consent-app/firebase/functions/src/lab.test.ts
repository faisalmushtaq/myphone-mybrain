import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { cleaner, labConsentForm, labInformationVersion } from './forms.js';
import { RejectedUpload } from './images.js';
import { buildParticipantCode, inspectCleanedArchive, normaliseCode, normaliseCodeParts, validateLabConsentPayload, validateLabDonationPayload } from './lab.js';

const now = new Date().toISOString();
const client = { userAgent: 'test', submittedAt: now, timezoneOffset: 0 };
const agreed = () => Object.fromEntries(labConsentForm.statements.map((s) => [s.id, { statementId: s.id, version: s.version, response: 'agreed', respondedAt: now, via: 'individual' }]));
const consent = () => ({
  participantCode: 'ja101cd',
  consent: {
    formId: labConsentForm.id as string,
    formVersion: labConsentForm.version as string,
    informationVersion: labInformationVersion as string,
    responses: agreed() as Record<string, { statementId: string; version: string; response: string; respondedAt: string; via: string }>,
    typedName: 'Jane Doe',
    signature: { method: 'typed', imageDataUrl: null, typedName: 'Jane Doe', strokeCount: 0, pointerType: null, capturedAt: now } as Record<string, unknown> | null,
    confirmedDate: now.slice(0, 10),
    completedAt: now as string | null,
  },
  codeParts: { mother: 'Jane', house: '123', month: '01', postcode: 'ab1 2cd' } as Record<string, string> | null,
  client,
});

test('participant codes follow the questionnaire’s shape and are normalised', () => {
  assert.equal(normaliseCode('ja101cd'), 'JA101CD');
  assert.equal(normaliseCode(' JA-101-CD '), 'JA101CD');
  assert.equal(normaliseCode('JA113CD'), null, 'month 13');
  assert.equal(normaliseCode('JA100CD'), null, 'month 00');
  assert.equal(normaliseCode('J1101CD'), null);
  assert.equal(normaliseCode('JA101CDE'), null);
  assert.equal(normaliseCode(42), null);
});

test('a complete lab consent is accepted; missing statements, old versions, bad codes and no signature are not', () => {
  assert.deepEqual(validateLabConsentPayload(consent()), []);
  const missing = consent();
  delete missing.consent.responses['take-part'];
  assert.ok(validateLabConsentPayload(missing).some((p) => p.includes('"take-part" was not agreed')));
  const declined = consent();
  declined.consent.responses['publication'].response = 'declined';
  assert.ok(validateLabConsentPayload(declined).some((p) => p.includes('"publication" was not agreed')));
  const noLinking = consent();
  noLinking.consent.responses['link-records'].response = 'declined';
  assert.deepEqual(validateLabConsentPayload(noLinking), [], 'saying no to record linking is fine');
  const unanswered = consent();
  delete unanswered.consent.responses['link-records'];
  assert.ok(validateLabConsentPayload(unanswered).some((p) => p.includes('"link-records" was not answered')));
  const old = consent();
  old.consent.formVersion = '0.1';
  assert.ok(validateLabConsentPayload(old).some((p) => p.includes('consent form must be')));
  const info = consent();
  info.consent.informationVersion = '0.9';
  assert.ok(validateLabConsentPayload(info).some((p) => p.includes('information shown must be')));
  const code = consent();
  code.participantCode = 'JA1301CD';
  assert.ok(validateLabConsentPayload(code).includes('The participant code is malformed.'));
  const unsigned = consent();
  unsigned.consent.signature = null;
  assert.ok(validateLabConsentPayload(unsigned).some((p) => p.includes('signature is missing')));
  const unfinished = consent();
  unfinished.consent.completedAt = null;
  assert.ok(validateLabConsentPayload(unfinished).some((p) => p.includes('completion time')));
  const typedCode = consent();
  typedCode.codeParts = null;
  assert.deepEqual(validateLabConsentPayload(typedCode), [], 'a typed code comes without the answers');
  const mismatch = consent();
  mismatch.codeParts = { mother: 'Sam', house: '9', month: '01', postcode: 'AB1 2CD' };
  assert.ok(validateLabConsentPayload(mismatch).some((p) => p.includes('does not match the answers')));
});

test('the code is rebuilt from the answers exactly as the questionnaire does, and the answers are kept tidied', () => {
  assert.equal(buildParticipantCode({ mother: 'jane', house: '123a', month: '1', postcode: 'ab1 2cd' }), 'JA101CD');
  assert.equal(buildParticipantCode({ mother: 'Zoë', house: '7', month: '12', postcode: 'LS2 9JT' }), 'ZO712JT');
  assert.deepEqual(normaliseCodeParts({ mother: ' Jane ', house: '123', month: '1', postcode: 'ab1  2cd' }), { mother: 'Jane', house: '123', month: '01', postcode: 'AB1 2CD' });
});

test('donation payloads: kinds, sizes, duplicates and categories are checked', () => {
  const upload = { uploadId: '123e4567-e89b-12d3-a456-426614174000', kind: 'archive', name: 'tiktok_cleaned_donation.zip', contentType: 'application/zip', size: 1234, platforms: ['tiktok'], categories: ['tt_watch'], kept: { tt_watch: 2 } };
  const shot = { uploadId: '223e4567-e89b-12d3-a456-426614174000', kind: 'screenshot', name: 'IMG_1.png', contentType: 'image/png', size: 5000 };
  assert.deepEqual(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [upload, shot], phase: 'pre', client }), []);
  assert.ok(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [shot], client }).includes('Say whether this is before or after the break.'));
  assert.ok(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [shot], phase: 'during', client }).includes('Say whether this is before or after the break.'));
  assert.ok(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [], client }).includes('No files were sent.'));
  assert.ok(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [upload, upload], client }).includes('A file was listed twice.'));
  assert.ok(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [{ ...upload, categories: ['dms'] }], client }).includes('An upload names an unknown category.'));
  assert.ok(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [{ ...upload, platforms: ['instagram'] }], client }).includes('An upload names an unknown platform.'));
  assert.ok(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [{ ...upload, size: 200 * 1024 * 1024 }], client }).some((p) => p.includes('larger than')));
  assert.ok(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [{ ...upload, kind: 'video' }], client }).includes('An upload reference is malformed.'));
  assert.ok(validateLabDonationPayload({ participantCode: 'nope', uploads: [upload], client }).includes('The participant code is malformed.'));
  assert.deepEqual(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [shot], phase: 'post', phone: 'android', client }), []);
  assert.ok(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [shot], phase: 'post', phone: 'blackberry', client }).includes('Unknown phone type.'));
});

const manifest = (over: Record<string, unknown> = {}) => ({ cleanedAt: now, cleaner: `MyPhone/MyBrain data donation cleaner ${cleaner.version}`, platforms: ['tiktok'], categories: ['tt_watch'], kept: { tt_watch: 1 }, removed: ['Direct messages'], ...over });
async function cleanedZip(extra?: (zip: JSZip) => void, m: Record<string, unknown> = manifest()): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('tiktok_cleaned.json', JSON.stringify({ _note: 'cleaned', Activity: { WatchHistory: [{ Date: '2026-09-01 20:11:03', Link: 'https://www.tiktokv.com/share/video/1/' }] } }));
  zip.file('manifest.json', JSON.stringify(m));
  extra?.(zip);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
const rejects = (buffer: Buffer, text: RegExp) => assert.rejects(inspectCleanedArchive(buffer), (e: unknown) => e instanceof RejectedUpload && text.test(e.reason));

test('a cleaned archive is recognised and described from its manifest', async () => {
  const facts = await inspectCleanedArchive(await cleanedZip());
  assert.deepEqual(facts.entries, ['manifest.json', 'tiktok_cleaned.json']);
  assert.deepEqual(facts.manifest.platforms, ['tiktok']);
  assert.deepEqual(facts.manifest.categories, ['tt_watch']);
  assert.deepEqual(facts.manifest.kept, { tt_watch: 1 });
  assert.equal(facts.manifest.cleanedAt, now);
  assert.ok(facts.unpackedBytes > 50);
});

test('a YouTube archive with its folders is fine; unknown manifest fields are dropped', async () => {
  const zip = new JSZip();
  zip.file('youtube/history/watch-history.json', JSON.stringify([{ header: 'YouTube', title: 'Watched x', time: now }]));
  zip.file('youtube/subscriptions/subscriptions.csv', 'Channel Id,Channel Url,Channel Title\nUC1,https://www.youtube.com/channel/UC1,Brain Channel\n');
  zip.file('manifest.json', JSON.stringify(manifest({ platforms: ['youtube', 'instagram'], categories: ['yt_watch', 'yt_subs', 'dms'], kept: { yt_watch: 1, yt_subs: 1, dms: 9 }, extra: 'ignored' })));
  const facts = await inspectCleanedArchive(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.deepEqual(facts.entries, ['manifest.json', 'youtube/history/watch-history.json', 'youtube/subscriptions/subscriptions.csv']);
  assert.deepEqual(facts.manifest.platforms, ['youtube']);
  assert.deepEqual(facts.manifest.categories, ['yt_watch', 'yt_subs']);
  assert.deepEqual(facts.manifest.kept, { yt_watch: 1, yt_subs: 1 });
});

test('archives that are not the cleaner’s are refused with a reason', async () => {
  await rejects(Buffer.from('not a zip at all, just some text that is long enough to pass the length check'), /not a ZIP archive/);
  await rejects(await cleanedZip((zip) => zip.file('Direct Messages.json', '{}')), /not a cleaned export/);
  await rejects(await cleanedZip((zip) => zip.file('youtube/history/other.json', '[]')), /not a cleaned export/);
  await rejects(await cleanedZip((zip) => zip.folder('photos')!.file('me.jpg', 'xx')), /not a cleaned export/);
  await rejects(await cleanedZip(undefined, manifest({ cleaner: 'something else' })), /not a cleaned export/);
  await rejects(await cleanedZip(undefined, manifest({ platforms: [] })), /not a cleaned export/);
  const onlyManifest = new JSZip();
  onlyManifest.file('manifest.json', JSON.stringify(manifest()));
  await rejects(await onlyManifest.generateAsync({ type: 'nodebuffer' }), /only a manifest/);
  const badJson = new JSZip();
  badJson.file('manifest.json', JSON.stringify(manifest()));
  badJson.file('tiktok_cleaned.json', '{not json');
  await rejects(await badJson.generateAsync({ type: 'nodebuffer' }), /not valid JSON/);
  const noManifest = new JSZip();
  noManifest.file('tiktok_cleaned.json', '{}');
  await rejects(await noManifest.generateAsync({ type: 'nodebuffer' }), /not a cleaned export/);
});
