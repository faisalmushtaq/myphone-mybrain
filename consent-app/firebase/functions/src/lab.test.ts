import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { cleaner, labCheckInForm, labConsentForm, labInformationVersion } from './forms.js';
import { RejectedUpload } from './images.js';
import { appsToCome, buildParticipantCode, inspectCleanedArchive, labFollowUpEmail, labStatusEmail, normaliseCode, normaliseCodeParts, notUsedOf, outstanding, phaseCountsOf, validateLabCheckInPayload, validateLabConsentPayload, validateLabDonationPayload, validateLabPlatformsPayload, validateLabReminderPayload, type LabProgress } from './lab.js';

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
  codeParts: { firstName: 'Jane', house: '123', month: '01', postcode: 'ab1 2cd' } as Record<string, string> | null,
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
  mismatch.codeParts = { firstName: 'Sam', house: '9', month: '01', postcode: 'AB1 2CD' };
  assert.ok(validateLabConsentPayload(mismatch).some((p) => p.includes('does not match the answers')));
  for (const postcode of ['LS2 9JT', 'ls29jt', 'M1 1AE', 'B33 8TH', 'CR2 6XH', 'DN55 1PT', 'W1A 0AX', 'EC1A 1BB', 'GIR 0AA', 'ab1 2cd']) {
    const good = consent();
    good.codeParts = { firstName: 'Jane', house: '123', month: '01', postcode };
    good.participantCode = buildParticipantCode(good.codeParts as never);
    assert.deepEqual(validateLabConsentPayload(good), [], `${postcode} is a UK postcode`);
  }
  for (const postcode of ['LS2', 'LS2 9J', '12345', 'LS2 JT9', 'L 9JT', 'XX XX', 'SW1A1AAA']) {
    const bad = consent();
    bad.codeParts = { firstName: 'Jane', house: '123', month: '01', postcode };
    assert.ok(validateLabConsentPayload(bad).includes('The postcode is not a full UK postcode.'), `${postcode} is refused`);
  }
});

test('the code is rebuilt from the answers exactly as the questionnaire does, and the answers are kept tidied', () => {
  assert.equal(buildParticipantCode({ firstName: 'jane', house: '123a', month: '1', postcode: 'ab1 2cd' }), 'JA101CD');
  assert.equal(buildParticipantCode({ firstName: 'Zoë', house: '7', month: '12', postcode: 'LS2 9JT' }), 'ZO712JT');
  assert.equal(buildParticipantCode({ firstName: 'Élodie', house: '14', month: '03', postcode: 'LS6 1AB' }), 'EL103AB', 'accents dropped, as the app does');
  assert.notEqual(buildParticipantCode({ firstName: 'Amira', house: '14', month: '03', postcode: 'LS6 1AB' }), buildParticipantCode({ firstName: 'Yasmin', house: '14', month: '03', postcode: 'LS6 1AB' }), 'twins get different codes');
  assert.deepEqual(normaliseCodeParts({ firstName: ' Jane ', house: '123', month: '1', postcode: 'ab1  2cd' }), { firstName: 'Jane', house: '123', month: '01', postcode: 'AB1 2CD' });
  assert.equal(normaliseCodeParts({ firstName: 'Jane', house: '1', month: '01', postcode: 'ls29jt' }).postcode, 'LS2 9JT', 'the space goes before the inward code');
});

test('donation payloads: kinds, sizes, duplicates and categories are checked', () => {
  const upload = { uploadId: '123e4567-e89b-12d3-a456-426614174000', kind: 'archive', name: 'tiktok_cleaned_donation.zip', contentType: 'application/zip', size: 1234, platforms: ['tiktok'], categories: ['tt_watch'], kept: { tt_watch: 2 } };
  const shot = { uploadId: '223e4567-e89b-12d3-a456-426614174000', kind: 'screenshot', name: 'IMG_1.png', contentType: 'image/png', size: 5000 };
  assert.deepEqual(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [upload, shot], phase: 'pre', client }), []);
  assert.ok(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [shot], client }).includes('The phase of the study is missing or unknown.'));
  assert.ok(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [shot], phase: 'during', client }).includes('The phase of the study is missing or unknown.'));
  assert.deepEqual(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [shot], phase: 'mid', checkInId: 'abcDEF123', client }), [], 'a check-in screenshot, linked to its check-in');
  assert.ok(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [upload], phase: 'mid', client }).includes('Only screenshots can be sent with a check-in.'));
  assert.ok(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [shot], phase: 'mid', checkInId: '../x', client }).includes('The check-in reference is malformed.'));
  assert.ok(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [], client }).includes('No files were sent.'));
  assert.ok(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [upload, upload], client }).includes('A file was listed twice.'));
  assert.ok(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [{ ...upload, categories: ['dms'] }], client }).includes('An upload names an unknown category.'));
  assert.ok(validateLabDonationPayload({ participantCode: 'JA101CD', uploads: [{ ...upload, platforms: ['snapchat'] }], client }).includes('An upload names an unknown platform.'));
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
  zip.file('manifest.json', JSON.stringify(manifest({ platforms: ['youtube', 'snapchat'], categories: ['yt_watch', 'yt_subs', 'dms'], kept: { yt_watch: 1, yt_subs: 1, dms: 9 }, extra: 'ignored' })));
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

test('the apps someone does not use: a list of known apps, each once', () => {
  assert.deepEqual(validateLabPlatformsPayload({ participantCode: 'ja101cd', notUsed: ['instagram', 'youtube'] }), []);
  assert.deepEqual(validateLabPlatformsPayload({ participantCode: 'JA101CD', notUsed: [] }), [], 'undoing the last one');
  assert.ok(validateLabPlatformsPayload({ participantCode: 'JA101CD', notUsed: ['snapchat'] }).includes('The list of apps is malformed.'));
  assert.ok(validateLabPlatformsPayload({ participantCode: 'JA101CD', notUsed: ['youtube', 'youtube'] }).includes('The list of apps is malformed.'));
  assert.ok(validateLabPlatformsPayload({ participantCode: 'JA101CD', notUsed: 'youtube' }).includes('The list of apps is malformed.'));
  assert.ok(validateLabPlatformsPayload({ participantCode: 'nope', notUsed: [] }).includes('The participant code is malformed.'));
  assert.deepEqual(notUsedOf({ platformsNotUsed: ['youtube', 'snapchat', 'instagram'] }), ['instagram', 'youtube'], 'unknown apps are dropped');
  assert.deepEqual(notUsedOf({}), []);
});

test('files are counted by phase; rows from before phases were counted are read as the first page’s', () => {
  assert.deepEqual(phaseCountsOf({ archiveCount: 1, screenshotCount: 3 }), { pre: { archives: 1, screenshots: 3 }, mid: { archives: 0, screenshots: 0 }, post: { archives: 0, screenshots: 0 } });
  assert.deepEqual(phaseCountsOf({ archiveCount: 2, screenshotCount: 5, phaseCounts: { pre: { archives: 1, screenshots: 2 }, mid: { screenshots: 1 }, post: { archives: 1, screenshots: 2 } } }), { pre: { archives: 1, screenshots: 2 }, mid: { archives: 0, screenshots: 1 }, post: { archives: 1, screenshots: 2 } });
});

test('a check-in carries the current questions: required ones answered with their options, text within its limit', () => {
  const answers = Object.fromEntries(labCheckInForm.questions.filter((q) => q.type === 'choice').map((q) => [q.id, q.type === 'choice' ? q.options[0].value : '']));
  const good = { participantCode: 'ja101cd', formId: labCheckInForm.id, formVersion: labCheckInForm.version, answers, client };
  assert.deepEqual(validateLabCheckInPayload(good), []);
  assert.deepEqual(validateLabCheckInPayload({ ...good, answers: { ...answers, notes: 'Brick stopped working on day 3.' } }), [], 'the optional note');
  const missing = { ...answers };
  delete missing.mood;
  assert.ok(validateLabCheckInPayload({ ...good, answers: missing }).includes('Question "mood" was not answered.'));
  assert.ok(validateLabCheckInPayload({ ...good, answers: { ...answers, week: '9' } }).includes('The answer to "week" is not one of its options.'));
  assert.ok(validateLabCheckInPayload({ ...good, answers: { ...answers, notes: 'x'.repeat(1001) } }).some((p) => p.includes('longer than')));
  assert.ok(validateLabCheckInPayload({ ...good, answers: { ...answers, extra: 'y' } }).includes('Unknown question "extra".'));
  assert.ok(validateLabCheckInPayload({ ...good, formVersion: '0.0' }).some((p) => p.includes('The check-in must be')));
  assert.ok(validateLabCheckInPayload({ ...good, participantCode: 'nope' }).includes('The participant code is malformed.'));
});

test('the progress email says what is in and what is still to come; the follow-up names only what is missing', () => {
  const nothing: LabProgress = { participantCode: 'JA101CD', consentedAt: '2026-10-05T09:00:00.000Z', phase: 'pre', screenshots: 0, archives: 0, platforms: [], notUsed: [] };
  assert.deepEqual(outstanding(nothing), ['screenshots of your phone’s screen-time summary', 'your TikTok, YouTube and Instagram data']);
  const status = labStatusEmail(nothing);
  assert.equal(status.subject, 'MyPhone/MyBrain: your data donation so far (JA101CD)');
  assert.ok(status.text.includes('Consent: recorded on 2026-10-05') && status.text.includes('Received so far: nothing yet') && status.text.includes('Still to come: screenshots of your phone’s screen-time summary and your TikTok, YouTube and Instagram data.') && status.text.includes('press “I don’t use it”') && status.text.includes('https://myphonemybrain.com/break/take-part/?code=JA101CD') && status.text.includes('one reminder') && status.text.includes('before your break') && status.text.includes('unless you contact us to withdraw'));
  const afterBreak = labStatusEmail({ ...nothing, phase: 'post' });
  assert.ok(afterBreak.text.includes('https://myphonemybrain.com/break/after/?code=JA101CD') && afterBreak.text.includes('after your break'), 'after the break, the link opens the after-break page');
  const partial = { ...nothing, screenshots: 2, archives: 1, platforms: ['tiktok'] };
  assert.deepEqual(outstanding(partial), ['your YouTube and Instagram data'], 'one app in, the others still to come');
  assert.deepEqual(appsToCome({ ...partial, notUsed: ['instagram'] }), ['youtube']);
  const complete = { ...partial, notUsed: ['youtube', 'instagram'] };
  assert.deepEqual(outstanding(complete), [], 'every app sent or set aside');
  assert.ok(labStatusEmail(complete).text.includes('Received so far: 2 screen-time screenshots and 1 cleaned file (TikTok)') && labStatusEmail(complete).text.includes('Everything the study needs is in') && !labStatusEmail(complete).text.includes('I don’t use it'));
  const followUp = labFollowUpEmail({ ...nothing, screenshots: 1 });
  assert.ok(followUp.text.includes('we have not yet received your TikTok, YouTube and Instagram data from before your break for participant code JA101CD') && followUp.text.includes('only reminder') && followUp.text.includes('/break/take-part/?code=JA101CD') && followUp.text.includes('press “I don’t use it”'), followUp.text);
  assert.ok(!followUp.text.includes('screenshots of your phone'));
  assert.deepEqual(validateLabReminderPayload({ participantCode: 'ja101cd', email: 'jane@example.com' }), []);
  assert.ok(validateLabReminderPayload({ participantCode: 'JA101CD', email: 'not-an-email' }).some((p) => p.includes('email address')));
  assert.ok(validateLabReminderPayload({ participantCode: 'nope', email: 'jane@example.com' }).includes('The participant code is malformed.'));
  assert.deepEqual(validateLabReminderPayload({ participantCode: 'JA101CD', email: 'jane@example.com', phase: 'post' }), []);
  assert.ok(validateLabReminderPayload({ participantCode: 'JA101CD', email: 'jane@example.com', phase: 'mid' }).some((p) => p.includes('before or after the break')));
});
