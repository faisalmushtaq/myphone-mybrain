// End-to-end test of the real backend: builds the app against the Firebase
// emulator suite, drives the whole journey in headless Chromium, then checks
// what the Cloud Function stored, and that the security rules refuse what
// they should.
//
//   node scripts/emulator-e2e.mjs
//
// Needs: firebase-tools on PATH, Java (Firestore emulator), the functions
// package installed and built (npm --prefix firebase/functions install && npm
// --prefix firebase/functions run build), and Playwright with Chromium.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PROJECT = 'demo-mpmb';
const BUCKET = `${PROJECT}.appspot.com`;
const PORT = 8420;

if (process.env.MPMB_E2E_INNER !== '1') {
  // Outer phase: build the app for the emulators, then run this script inside `emulators:exec`.
  console.log('Building the app against the emulators…');
  execSync('npx vite build --mode emulator --outDir dist-emulator', {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_MPMB_BACKEND: 'firebase',
      VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1:4000',
      VITE_FIREBASE_API_KEY: 'demo-key',
      VITE_FIREBASE_PROJECT_ID: PROJECT,
      VITE_FIREBASE_APP_ID: '1:demo:web:demo',
      VITE_FIREBASE_AUTH_DOMAIN: `${PROJECT}.firebaseapp.com`,
      VITE_FIREBASE_STORAGE_BUCKET: BUCKET,
    },
  });
  console.log('Starting the emulator suite…');
  const result = spawn('firebase', ['emulators:exec', '--project', PROJECT, '--only', 'auth,functions,firestore,storage', `MPMB_E2E_INNER=1 node ${path.join(root, 'scripts/emulator-e2e.mjs')}`], {
    cwd: path.join(root, 'firebase'),
    stdio: 'inherit',
    env: { ...process.env, FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199' },
  });
  result.on('exit', (code) => process.exit(code ?? 1));
} else {
  await inner();
}

async function inner() {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright');
  const functionsModules = path.join(root, 'firebase/functions/node_modules');
  const admin = createRequire(path.join(functionsModules, 'x.js'));
  const { initializeApp } = admin('firebase-admin/app');
  const { getFirestore } = admin('firebase-admin/firestore');
  const { getStorage } = admin('firebase-admin/storage');
  const sharp = admin('sharp');

  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
  const db = getFirestore();
  const bucket = getStorage().bucket();

  const failures = [];
  const ok = (name, cond, detail = '') => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!cond) failures.push(name);
  };

  // Serve the emulator build.
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', path.join(root, 'dist-emulator')], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));

  const draw = async (locator, points) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + points[0][0] * box.width, box.y + points[0][1] * box.height);
    await page.mouse.down();
    for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 5 });
    await page.mouse.up();
  };
  const png = async (label) =>
    Buffer.from(
      (
        await page.evaluate((label) => {
          const c = document.createElement('canvas');
          c.width = 900;
          c.height = 1600;
          const x = c.getContext('2d');
          x.fillStyle = '#f2f2f7';
          x.fillRect(0, 0, 900, 1600);
          x.fillStyle = '#111';
          x.font = 'bold 60px sans-serif';
          x.fillText('Screen Time', 60, 200);
          x.font = '40px sans-serif';
          x.fillText(label, 60, 280);
          return c.toDataURL('image/png');
        }, label)
      ).split(',')[1],
      'base64',
    );

  try {
    await page.goto(`http://127.0.0.1:${PORT}/index.html`);
    await page.getByRole('heading', { name: /Take part in MyPhone/ }).waitFor();
    await page.getByRole('button', { name: /I’m the young person/ }).click();
    await page.getByLabel('Your first name').fill('Kai');
    await page.getByLabel('Your last name').fill('Patel');
    await page.getByLabel('Your date of birth', { exact: true }).fill('2013-03-14');
    await page.getByLabel('Your school', { exact: true }).selectOption('DUA');
    await page.getByLabel('Your year group').selectOption('Year 8');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /I’m the parent or guardian/ }).click();
    await page.getByLabel('Your full name', { exact: true }).fill('Priya Patel');
    await page.getByLabel('Your relationship to the young person').selectOption('mother');
    await page.getByLabel(/parental responsibility for/).check();
    await page.getByLabel('Your email address').fill('priya@example.com');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: /Your permission for Kai/ }).waitFor();
    await page.getByLabel(/I confirm all of the above/).check();
    for (const [id, v] of [['phone-use', 'agreed'], ['link-records', 'declined'], ['recontact', 'declined']]) await page.locator(`#stmt-${id}-${v}`).check();
    await draw(page.locator('#signature-pad'), [[0.15, 0.6], [0.35, 0.3], [0.55, 0.7], [0.8, 0.4]]);
    await page.getByRole('button', { name: 'Confirm and sign' }).click();
    await page.getByRole('heading', { name: /A few quick questions/ }).waitFor();
    for (const [i, label] of ['Somewhat', 'About the same', 'Sometimes'].entries()) {
      await page.locator('.mpmb-quiz__count', { hasText: `Question ${i + 1} of 4` }).waitFor();
      await page.getByRole('button', { name: label, exact: true }).click();
    }
    await page.locator('.mpmb-quiz__count', { hasText: 'Question 4 of 4' }).waitFor();
    await page.getByRole('textbox').fill('Mostly YouTube, often late at night.');
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.getByRole('button', { name: /I’m Kai/ }).click();
    await page.getByRole('heading', { name: /Do you want to take part/ }).waitFor();
    await draw(page.locator('#assent-signature'), [[0.2, 0.6], [0.5, 0.35], [0.8, 0.6]]);
    await page.getByRole('button', { name: 'Sign and continue' }).click();

    // 1. The permission and agreement are saved as soon as the young person has signed.
    await page.getByRole('heading', { name: /Share your screen time/ }).waitFor();
    await page.locator('.mpmb-save', { hasText: 'Permission saved' }).waitFor({ timeout: 60000 });
    const code = (await page.locator('.mpmb-save strong').innerText()).trim();
    ok('reference code returned by submitConsent before any screenshot', /^MPMB-[A-Z2-9]{4}-[A-Z2-9]{3}$/.test(code), code);
    let submission = (await db.collection('submissions').doc(code).get()).data();
    ok('submission row written at version 1 with no images yet', Boolean(submission) && submission.kind === 'consent' && submission.version === 1 && submission.imageCount === 0);
    const firstConsentId = submission?.consentId;

    // 2. Screenshots are sent from the screen-time page and linked to the record.
    await page.getByRole('radio', { name: 'iPhone' }).check();
    const input = page.locator('input[type=file]').first();
    await input.setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: await png('Last 7 days') }, { name: 'b.png', mimeType: 'image/png', buffer: await png('Today') }]);
    await page.waitForFunction(() => document.querySelectorAll('.mpmb-upload').length === 2);
    await page.getByRole('button', { name: /Hide part of image 1/ }).click();
    await draw(page.locator('.mpmb-editor__canvas'), [[0.05, 0.05], [0.95, 0.15]]);
    await page.getByRole('button', { name: 'Apply changes' }).click();
    await page.getByText('Parts hidden').waitFor();
    await page.getByRole('button', { name: /Send these 2 screenshots/ }).click();
    await page.getByRole('heading', { name: /Check what you’ve sent/ }).waitFor({ timeout: 90000 });
    ok('browser uploaded both images and submitDonation accepted them', await page.getByText(/2 sent/).count() > 0);

    // 3. A change on the check page is saved as an amendment (new records, nothing overwritten).
    await page.getByRole('button', { name: /Change parent or guardian$/i }).click();
    await page.getByRole('heading', { name: /Your details/ }).waitFor();
    await page.getByRole('button', { name: /Add a phone number or home postcode/ }).click();
    await page.getByLabel('Your phone number').fill('07700 900123');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: /Check what you’ve sent/ }).waitFor();
    await page.locator('.mpmb-save', { hasText: 'Changes saved' }).waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: /Everything is right/ }).click();
    await page.getByRole('heading', { name: /Thank you for taking part/ }).waitFor({ timeout: 30000 });
    ok('thank-you page shows the same reference', (await page.locator('.mpmb-done__ref strong').innerText()).trim() === code);
    ok('no browser errors', errors.length === 0, errors.join(' | '));

    // What did the functions store?
    submission = (await db.collection('submissions').doc(code).get()).data();
    ok('submission row at version 2 with two images and one donation', submission.version === 2 && submission.imageCount === 2 && submission.donationIds?.length === 1 && submission.versions?.length === 2);
    ok('amendment points at a new consent record', submission.consentId && submission.consentId !== firstConsentId);
    const participant = (await db.collection('participants').doc(submission.participantId).get()).data();
    ok('participant record holds identity, updated by the amendment', participant?.firstName === 'Kai' && participant?.dateOfBirth === '2013-03-14' && participant?.guardian?.email === 'priya@example.com' && participant?.guardian?.phone === '07700 900123' && participant?.version === 2);
    const consents = await db.collection('consents').where('participantId', '==', submission.participantId).get();
    const consent = (await db.collection('consents').doc(submission.consentId).get()).data();
    ok('two consent records, the second superseding the first', consents.size === 2 && consent?.version === 2 && consent?.supersedes === firstConsentId);
    ok('consent record complete', consent?.responses?.['link-records']?.response === 'declined' && consent?.responses?.['take-part']?.via === 'group' && consent?.signature?.image?.path?.startsWith('signatures/'));
    ok('consent record has server receipt time', consent?.receivedAt && consent?.createdAt);
    const assent = (await db.collection('assents').doc(submission.assentId).get()).data();
    ok('assent record signed, screenshot agreement by action', assent?.status === 'completed' && assent?.responses?.['take-part']?.via === 'signature' && assent?.responses?.['phone-use']?.via === 'action');
    const survey = (await db.collection('surveys').doc(submission.surveyId).get()).data();
    ok('parent’s questions stored as research data without names, re-sent with the amendment', survey && !JSON.stringify(survey).includes('Patel') && survey.status === 'completed' && survey.responses?.concern?.value === 'somewhat' && survey.responses?.['anything-else']?.value === 'Mostly YouTube, often late at night.' && Object.keys(survey.responses).length === 4 && survey.version === 2 && survey.supersedes);
    const donation = (await db.collection('donations').doc(submission.donationIds[0]).get()).data();
    ok('donation record has no names, carries the agreement and quality checks', donation && !JSON.stringify(donation).includes('Patel') && donation.images.length === 2 && donation.images[0].redacted === true && donation.agreement?.via === 'action' && ['accepted', 'review'].includes(donation.images[0].quality?.verdict));
    const [quarantine] = await bucket.getFiles({ prefix: 'quarantine/' });
    ok('quarantine emptied after submit', quarantine.length === 0, `${quarantine.length} left`);
    const [donated] = await bucket.getFiles({ prefix: `donations/${submission.participantId}/` });
    ok('images stored under the participant id', donated.length === 2);
    const [buffer] = await donated[0].download();
    const meta = await sharp(buffer).metadata();
    ok('stored image is a clean PNG without metadata', meta.format === 'png' && !meta.exif && !meta.icc && !meta.xmp);
    const [sigs] = await bucket.getFiles({ prefix: `signatures/${submission.participantId}/` });
    ok('signatures stored for every version', sigs.length === 4, `${sigs.length} files`);
    const mail = await db.collection('mail').get();
    ok('nothing queued for email: families download their copy instead', mail.size === 0);

    // Website enquiry: stored, and nobody emailed because no SMTP password exists in the emulator.
    const enquiryUrl = `http://127.0.0.1:5001/${PROJECT}/europe-west2/enquiry`;
    const enquiryHeaders = { 'Content-Type': 'application/json', Origin: 'https://myphonemybrain.com' };
    const enquiryRes = await fetch(enquiryUrl, { method: 'POST', headers: enquiryHeaders, body: JSON.stringify({ kind: 'contact', name: 'Test Parent', email: 'parent@example.com', topic: 'The study', message: 'Is Year 7 included?', website: '' }) });
    const enquiry = await enquiryRes.json();
    const storedEnquiry = enquiry.id ? (await db.collection('enquiries').doc(enquiry.id).get()).data() : null;
    ok('website enquiry stored and marked as not emailed (no SMTP password here)', enquiryRes.status === 200 && enquiry.ok === true && enquiry.notified === 'not-configured' && storedEnquiry?.message === 'Is Year 7 included?' && storedEnquiry?.notified === 'not-configured', JSON.stringify(enquiry));
    const badEnquiry = await fetch(enquiryUrl, { method: 'POST', headers: enquiryHeaders, body: '{}' });
    ok('website enquiry without details is refused', badEnquiry.status === 400);

    // Hourly export: a BIDS dataset for researchers and a separate identifying folder, in the private exports bucket.
    const exportRes = await fetch(`http://127.0.0.1:5001/${PROJECT}/europe-west2/exportNow`, { method: 'POST' });
    const manifest = await exportRes.json();
    const exportsBucket = getStorage().bucket(`${PROJECT}-exports`);
    const [exportedFiles] = await exportsBucket.getFiles();
    const exportedNames = exportedFiles.map((f) => f.name);
    const readExport = async (name) => (await exportsBucket.file(name).download())[0].toString('utf8');
    const participantsTsv = await readExport('schools/donations/participants.tsv');
    const phenotypeTsv = await readExport('schools/donations/phenotype/parent_perceptions.tsv');
    const keyTsv = await readExport('schools/identifying/participants_key.tsv');
    const statementsTsv = await readExport('schools/identifying/consent_statements.tsv');
    const behTsv = await readExport('schools/donations/sub-00001/ses-01/beh/sub-00001_ses-01_task-screentime_beh.tsv');
    const description = JSON.parse(await readExport('schools/donations/dataset_description.json'));
    ok('export ran and counted the records', exportRes.status === 200 && manifest.counts?.participants === 1 && manifest.counts?.consents === 2 && manifest.counts?.sessions === 1 && manifest.counts?.screenshots === 2 && manifest.counts?.signatures === 4 && manifest.counts?.enquiries === 1, JSON.stringify(manifest.counts));
    ok('BIDS dataset is de-identified and labelled sub-00001', description.BIDSVersion && participantsTsv.startsWith('participant_id\tage\t') && participantsTsv.includes('sub-00001\t13\tYear 8\tDUA') && !participantsTsv.includes('Patel') && phenotypeTsv.includes('sub-00001\tsomewhat') && !phenotypeTsv.includes('Patel') && !behTsv.includes('Patel'));
    ok('identifying folder holds the key and the statements', keyTsv.includes('sub-00001\t') && keyTsv.includes('Kai\tPatel') && statementsTsv.includes('sub-00001\t2\tlink-records\t0.4-draft\tdeclined'));
    ok('screenshots sit under sourcedata and signatures under identifying, named by label and session', exportedNames.filter((n) => n.startsWith('schools/donations/sourcedata/sub-00001/ses-01/sub-00001_ses-01_task-screentime_run-0')).length === 2 && exportedNames.filter((n) => n.startsWith('schools/identifying/signatures/sub-00001/sub-00001_')).length === 4 && exportedNames.includes('schools/donations/sub-00001/sub-00001_sessions.tsv') && exportedNames.includes('schools/donations/README') && exportedNames.includes('schools/README.md') && exportedNames.includes('manifest.json') && exportedNames.every((n) => n === 'README.md' || n === 'manifest.json' || n.startsWith('schools/') || n.startsWith('social-media-break/')));
    const rerun = await (await fetch(`http://127.0.0.1:5001/${PROJECT}/europe-west2/exportNow`, { method: 'POST' })).json();
    ok('a second run copies nothing new and keeps the mirror as it is', rerun.counts?.filesCopiedThisRun === 0 && rerun.files?.length === manifest.files?.length);

    // Security rules: what a client must not be able to do.
    const web = createRequire(path.join(root, 'node_modules/x.js'));
    const { initializeApp: initWeb } = web('firebase/app');
    const { getAuth, signInAnonymously, connectAuthEmulator } = web('firebase/auth');
    const { getFirestore: getWebDb, doc, getDoc, setDoc, connectFirestoreEmulator } = web('firebase/firestore');
    const { getStorage: getWebStorage, ref, uploadBytes, getBytes, connectStorageEmulator } = web('firebase/storage');
    const webApp = initWeb({ apiKey: 'demo-key', projectId: PROJECT, appId: '1:demo:web:demo', storageBucket: BUCKET }, 'rules-check');
    const auth = getAuth(webApp);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const webDb = getWebDb(webApp);
    connectFirestoreEmulator(webDb, '127.0.0.1', 8080);
    const webStorage = getWebStorage(webApp);
    connectStorageEmulator(webStorage, '127.0.0.1', 9199);
    const { user } = await signInAnonymously(auth);
    const denied = async (fn) => {
      try {
        await fn();
        return false;
      } catch (e) {
        return /permission|unauthorized|denied/i.test(String(e.code ?? e.message));
      }
    };
    ok('client cannot read participants', await denied(() => getDoc(doc(webDb, 'participants', submission.participantId))));
    ok('client cannot write consents', await denied(() => setDoc(doc(webDb, 'consents', 'x'), { hacked: true })));
    ok('client cannot upload into another session', await denied(() => uploadBytes(ref(webStorage, 'quarantine/someone-else/123e4567-e89b-12d3-a456-426614174000'), new Uint8Array([1, 2, 3]), { contentType: 'image/png' })));
    ok('client cannot upload a non-image', await denied(() => uploadBytes(ref(webStorage, `quarantine/${user.uid}/123e4567-e89b-12d3-a456-426614174000`), new Uint8Array([1, 2, 3]), { contentType: 'text/plain' })));
    ok('client cannot read donated images', await denied(() => getBytes(ref(webStorage, donated[0].name))));
    const { getFunctions, httpsCallable, connectFunctionsEmulator } = web('firebase/functions');
    const fns = getFunctions(webApp, 'europe-west2');
    connectFunctionsEmulator(fns, '127.0.0.1', 5001);
    const stranger = async (fn) => {
      try {
        await fn();
        return false;
      } catch (e) {
        return /failed-precondition/.test(String(e.code));
      }
    };
    const client = { userAgent: 'rules-check', submittedAt: new Date().toISOString(), timezoneOffset: 0 };
    const agreement = { statementId: 'phone-use', version: '0.4-draft', response: 'agreed', respondedAt: new Date().toISOString(), via: 'action' };
    ok('another session cannot add screenshots to this reference', await stranger(() => httpsCallable(fns, 'submitDonation')({ referenceCode: code, platform: 'ios', uploads: [{ uploadId: '123e4567-e89b-12d3-a456-426614174000', redacted: false, cropped: false, acknowledgedWarning: false }], agreement, client })));
    // A parent completing everything while the young person is not there: the screenshot is held pending the young person's agreement.
    await page.getByRole('button', { name: /Finish and clear/ }).click();
    await page.getByRole('heading', { name: /Take part in MyPhone/ }).waitFor();
    await page.getByRole('button', { name: /I’m a parent or guardian/ }).click();
    await page.getByLabel('First name', { exact: true }).fill('Amira');
    await page.getByLabel('Last name', { exact: true }).fill('Khan');
    await page.getByLabel('Date of birth', { exact: true }).fill('2012-09-02');
    await page.getByLabel('School', { exact: true }).selectOption('DUA');
    await page.getByLabel('Your full name', { exact: true }).fill('Sara Khan');
    await page.getByLabel('Your relationship to the young person').selectOption('mother');
    await page.getByLabel(/parental responsibility for/).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel(/I confirm all of the above/).check();
    for (const [id, v] of [['phone-use', 'agreed'], ['link-records', 'agreed'], ['recontact', 'declined']]) await page.locator(`#stmt-${id}-${v}`).check();
    await page.getByRole('button', { name: /I can’t draw my signature/ }).click();
    await page.getByLabel(/Type your full name as your signature/).fill('Sara Khan');
    await page.getByRole('button', { name: 'Confirm and sign' }).click();
    await page.getByRole('button', { name: 'Skip these questions' }).click();
    await page.getByRole('button', { name: /isn’t here/ }).click();
    await page.getByRole('heading', { name: /Share the screen time/ }).waitFor();
    await page.locator('.mpmb-save', { hasText: 'Permission saved' }).waitFor({ timeout: 60000 });
    const code2 = (await page.locator('.mpmb-save strong').innerText()).trim();
    await page.getByRole('radio', { name: 'Android' }).check();
    await input.setInputFiles([{ name: 'c.png', mimeType: 'image/png', buffer: await png('Today') }]);
    await page.waitForFunction(() => document.querySelectorAll('.mpmb-upload').length === 1);
    await page.getByRole('button', { name: /Send this screenshot/ }).click();
    await page.getByRole('heading', { name: /Check what you’ve sent/ }).waitFor({ timeout: 90000 });
    const sub2 = (await db.collection('submissions').doc(code2).get()).data();
    const assent2 = (await db.collection('assents').doc(sub2.assentId).get()).data();
    const donation2 = (await db.collection('donations').doc(sub2.donationIds[0]).get()).data();
    ok('parent shared with the young person absent: agreement deferred, donation records no in-app agreement', assent2?.status === 'deferred' && assent2?.deferredBy === 'parent' && !assent2?.responses?.['phone-use'] && donation2?.agreement === null && donation2?.youngPersonAgreedInApp === false && donation2?.assentStatusAtSend === 'deferred' && donation2?.images.length === 1);
    ok('no questions record when they were skipped without an answer', sub2?.surveyId && (await db.collection('surveys').doc(sub2.surveyId).get()).data()?.status === 'skipped');

    // The social media break study: participant ID, consent, a cleaned TikTok export and a screenshot, then the export.
    const JSZip = admin('jszip');
    const snap = (name) => page.screenshot({ path: path.join(root, 'dist-emulator', `lab-${name}.png`), fullPage: true });
    const tiktokExport = {
      'Your Activity': {
        'Watch History': { VideoList: [{ Date: '2026-09-01 20:11:03', Link: 'https://www.tiktokv.com/share/video/1/' }, { Date: '2026-09-01 20:12:40', Link: 'https://www.tiktokv.com/share/video/2/' }] },
        Searches: { SearchList: [{ Date: '2026-09-02 08:00:00', SearchTerm: 'something private' }] },
        'Login History': { LoginHistoryList: [{ Date: '2026-09-01 20:10:00', IP: '10.0.0.1', DeviceModel: 'iPhone' }] },
      },
      'Direct Message': { 'Direct Messages': { ChatHistory: { 'Chat with Sam': [{ Date: '2026-09-01', From: 'Sam', Content: 'private words' }] } } },
      Profile: { 'Profile Information': { ProfileMap: { emailAddress: 'me@example.com' } } },
    };
    const rawZip = new JSZip();
    rawZip.file('user_data_tiktok.json', JSON.stringify(tiktokExport));
    const tiktokZip = await rawZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    // The team adds lab times through the staff service: two for first visits, two for the end of the break, and one too late for either.
    const refused = async (fn, code) => {
      try {
        await fn();
        return false;
      } catch (e) {
        return String(e.code).includes(code);
      }
    };
    const staffCall = (data) => httpsCallable(fns, 'staffApi')({ staffKey: 'emulator-staff-key', ...data });
    ok('the staff service refuses a wrong key', await refused(() => httpsCallable(fns, 'staffApi')({ staffKey: 'a guess', action: 'overview' }), 'permission-denied'));
    const DAY = 86400000;
    const nineUtc = (days) => {
      const d = new Date(Date.now() + days * DAY);
      d.setUTCHours(9, 0, 0, 0);
      return d;
    };
    const v1a = nineUtc(10);
    const v2a = nineUtc(41);
    const added = await staffCall({ action: 'add-slots', slots: [[v1a, null], [nineUtc(11), null], [v2a, 2], [nineUtc(42), 2], [nineUtc(50), 2]].map(([d, visit]) => ({ start: d.toISOString(), minutes: 120, capacity: 1, visit })) });
    ok('the team adds five lab times', added.data?.created === 5, JSON.stringify(added.data));
    const twice = await staffCall({ action: 'add-slots', slots: [{ start: v1a.toISOString(), minutes: 120, capacity: 1 }] });
    ok('adding the same time twice is skipped, not doubled', twice.data?.created === 0 && twice.data?.skipped === 1, JSON.stringify(twice.data));
    ok('a past time is refused', await refused(() => staffCall({ action: 'add-slots', slots: [{ start: new Date(Date.now() - DAY).toISOString() }] }), 'invalid-argument'));
    ok('nobody can book without consent on file', await stranger(() => httpsCallable(fns, 'bookLabSlot')({ participantCode: 'MP33CE17327FF2', visits: [{ visit: 1, slotId: 'abc' }, { visit: 2, slotId: 'def' }], email: 'x@example.com', mobile: null, smsReminders: false, client })));
    const icsStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

    await page.goto(`http://127.0.0.1:${PORT}/lab.html`);
    await page.getByRole('heading', { name: /Take part in the social media break study/ }).waitFor();
    await snap('welcome');
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    ok('four details are asked for the ID, as the survey platform asks: first name, last name, date of birth, postcode', (await page.getByLabel('First name').count()) === 1 && (await page.getByLabel('Last name').count()) === 1 && (await page.getByLabel('Date of birth').count()) === 1 && (await page.getByLabel('Postcode').count()) === 1 && (await page.getByLabel(/house number|mother/i).count()) === 0);
    await page.getByLabel('First name').fill('Jane');
    await page.getByLabel('Last name').fill('Smith');
    await page.getByLabel('Date of birth').fill('2010-03-14');
    await page.getByLabel('Postcode').fill('ls2');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText('Enter a full UK postcode, such as LS2 9JT.').first().waitFor();
    ok('half a postcode and an under-18 date of birth are refused', (await page.getByText(/you need to be 18 or over/).count()) >= 1);
    await page.getByLabel('Date of birth').fill('2005-03-14');
    await page.getByLabel('Postcode').fill('ls29jt');
    await page.getByLabel('Postcode').blur();
    ok('the postcode is tidied into its standard form', (await page.getByLabel('Postcode').inputValue()) === 'LS2 9JT');
    await snap('code');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: /What taking part involves/ }).waitFor({ timeout: 30000 });
    await snap('information');
    await page.getByRole('button', { name: 'I have read this' }).click();
    await page.getByRole('heading', { name: /Your consent to take part/ }).waitFor();
    for (const id of ['read-information', 'involves', 'voluntary', 'data-kept', 'donation-required', 'publication', 'data-protection', 'take-part']) await page.locator(`#lab-stmt-${id}`).check();
    await page.locator('#lab-stmt-link-records-declined').check();
    ok('the consent starts with the name already given', (await page.getByLabel('Your full name', { exact: true }).inputValue()) === 'Jane Smith');
    await draw(page.locator('#lab-signature'), [[0.15, 0.6], [0.4, 0.3], [0.7, 0.7]]);
    await snap('consent');
    await page.getByRole('button', { name: 'Confirm and sign' }).click();
    // Screenshots first: the phone's own steps, at least one image, then they go straight away, filed under "before my break".
    await page.getByRole('heading', { name: 'Send your screen-time screenshots.', level: 1 }).waitFor({ timeout: 60000 });
    ok('no phone steps and no phase question until there is something to choose', (await page.locator('#shots-iphone').count()) === 0 && (await page.locator('#shots-android').count()) === 0 && (await page.getByRole('radio', { name: 'Before my break' }).count()) === 0);
    await page.getByRole('radio', { name: 'iPhone' }).check();
    await page.locator('#shots-iphone').waitFor();
    ok('choosing iPhone shows its steps only', (await page.locator('#shots-android').count()) === 0);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByText(/Add at least one screenshot/).first().waitFor();
    ok('going on without a screenshot is held back with a reason', (await page.getByRole('heading', { name: 'Send your screen-time screenshots.', level: 1 }).count()) === 1);
    await page.locator('input[type=file]').first().setInputFiles([{ name: 'screen-time.png', mimeType: 'image/png', buffer: await png('Last 7 days') }]);
    await page.waitForFunction(() => document.querySelectorAll('.mpmb-shots li').length === 1);
    ok('nobody is asked whether it is before or after the break: the page decides', (await page.getByText(/before or after your/i).count()) === 0);
    await snap('screenshots');
    await page.getByRole('button', { name: 'Send my screenshot', exact: true }).click();
    await page.getByRole('heading', { name: 'Request your data download.', level: 1 }).waitFor({ timeout: 90000 });
    const labP1 = (await db.collection('labParticipants').doc('MP2670FF90A5F2').get()).data();
    ok('the screenshot is with the team before the app data is asked for', labP1?.screenshotCount === 1 && labP1?.archiveCount === 0 && labP1?.donationIds?.length === 1);
    ok('the guide shows no app steps until one is chosen', (await page.locator('#guide-tiktok').count()) === 0 && (await page.locator('#guide-youtube').count()) === 0 && (await page.locator('#guide-instagram').count()) === 0);
    ok('the guide lists every app as still to do, each with its own steps and a way to say it is not used', (await page.locator('.mpmb-apps__row.is-todo').count()) === 3 && (await page.getByRole('button', { name: 'I don’t use Instagram' }).count()) === 1);
    await page.getByRole('button', { name: 'Show me how to get my TikTok data' }).click();
    await page.locator('#guide-tiktok').waitFor();
    ok('choosing TikTok shows only its steps, with a link on to the file', (await page.locator('#guide-youtube').count()) === 0 && (await page.locator('#guide-instagram').count()) === 0 && (await page.getByRole('button', { name: /^Continue: I have my file/ }).count()) === 1);
    await snap('guide');
    // "I'll come back later": a progress email now and one follow-up booked for two days later.
    await page.getByRole('button', { name: /come back later/ }).click();
    await page.getByLabel('Your email address').fill('jane@example.com');
    await page.getByRole('button', { name: 'Email me my progress' }).click();
    await page.getByText(/could not send the email just now|Sent\. Check your inbox|found a problem with the email|went wrong/).waitFor({ timeout: 30000 });
    ok('asking for the email keeps the person on the guide', (await page.getByRole('heading', { name: 'Request your data download.', level: 1 }).count()) === 1);
    const reminder = (await db.collection('labReminders').doc('MP2670FF90A5F2').get()).data();
    const hoursAhead = reminder ? (reminder.followUpDueAt.toDate().getTime() - reminder.requestedAt.toDate().getTime()) / 3600000 : 0;
    ok('progress email requested: address kept with the code, follow-up booked for 48 hours later (no SMTP password here, so marked not-configured)', reminder?.email === 'jane@example.com' && reminder?.statusOutcome === 'not-configured' && Math.round(hoursAhead) === 48 && reminder?.completedAt === null && reminder?.followUpSentAt === null);
    const labParticipant = (await db.collection('labParticipants').doc('MP2670FF90A5F2').get()).data();
    ok('lab consent recorded against the participant code', Boolean(labParticipant?.consentId) && labParticipant?.consentVersion === 1 && labParticipant?.archiveCount === 0);
    const labConsent = labParticipant?.consentId ? (await db.collection('labConsents').doc(labParticipant.consentId).get()).data() : null;
    ok('lab consent record complete, every statement agreed, drawn signature under signatures/lab/', labConsent?.typedName === 'Jane Smith' && Object.keys(labConsent?.responses ?? {}).length === 9 && labConsent?.responses?.['data-kept']?.response === 'agreed' && labConsent?.responses?.['link-records']?.response === 'declined' && labConsent?.signature?.image?.path?.startsWith('signatures/lab/MP2670FF90A5F2/') && labConsent?.formVersion === '2.0-draft' && labConsent?.informationVersion === '2.0');
    ok('the four details are kept with the consent, tidied, and the ID is the documented one', labConsent?.codeParts?.firstName === 'Jane' && labConsent?.codeParts?.lastName === 'Smith' && labConsent?.codeParts?.dateOfBirth === '2005-03-14' && labConsent?.codeParts?.postcode === 'LS2 9JT' && labConsent?.participantCode === 'MP2670FF90A5F2', JSON.stringify(labConsent?.codeParts));
    ok('the participant row carries no name', !JSON.stringify(labParticipant).includes('Jane'));

    // Back with the download: clean it on the device, then the review page sends it under the phase already chosen.
    await page.getByRole('button', { name: /^I have my file/ }).click();
    await page.getByRole('heading', { name: /Choose what to share from your data/ }).waitFor();
    await page.locator('#lab-zip').setInputFiles({ name: 'TikTok_Data.zip', mimeType: 'application/zip', buffer: tiktokZip });
    await page.getByRole('heading', { name: /Found: TikTok data/ }).waitFor({ timeout: 30000 });
    await page.locator('#cat-tt_search').uncheck();
    await snap('clean');
    const previewText = await page.locator('.mpmb-card').innerText();
    ok('the cleaning preview shows links and dates only', previewText.includes('tiktokv.com/share/video/1/') && !previewText.includes('something private') && !previewText.includes('private words'));
    await page.getByRole('button', { name: 'Keep these choices' }).click();
    await page.locator('.mpmb-apps__row.is-ready[data-platform="tiktok"]').waitFor();
    await page.getByRole('button', { name: /Next: check and send/ }).click();
    await page.getByRole('heading', { name: /Check and send/ }).waitFor();
    ok('the send step asks nothing about before or after', (await page.getByRole('radio', { name: 'Before my break' }).count()) === 0);
    await snap('send');
    await page.getByRole('button', { name: 'Send my data' }).click();
    await page.getByRole('heading', { name: /Thank you. Your data has been sent/ }).waitFor({ timeout: 90000 });
    const appRow = (p) => page.locator(`.mpmb-apps__row[data-platform="${p}"]`);
    ok('TikTok is ticked off; YouTube and Instagram stay outstanding', (await appRow('tiktok').getAttribute('class')).includes('is-sent') && (await appRow('youtube').getAttribute('class')).includes('is-todo') && (await appRow('instagram').getAttribute('class')).includes('is-todo') && (await page.getByText(/Still to do: YouTube and Instagram/).count()) === 1);
    await snap('done');
    // Saying an app is not used greys it out; it can be undone; the server keeps the answer.
    await page.getByRole('button', { name: 'I don’t use YouTube' }).click();
    await page.getByRole('button', { name: 'I do use YouTube' }).waitFor();
    await page.getByRole('button', { name: 'I don’t use Instagram' }).click();
    await page.getByRole('button', { name: 'I do use Instagram' }).waitFor();
    await page.getByRole('button', { name: 'I do use Instagram' }).click();
    await page.getByRole('button', { name: 'I don’t use Instagram' }).waitFor();
    ok('undoing puts the app back on the list', (await appRow('instagram').getAttribute('class')).includes('is-todo'));
    await page.getByRole('button', { name: 'I don’t use Instagram' }).click();
    await page.getByText('Every app you use is ticked off. Thank you.').waitFor({ timeout: 30000 });
    ok('apps not used are greyed out, and the page says everything is in', (await appRow('youtube').getAttribute('class')).includes('is-not-used') && (await appRow('instagram').getAttribute('class')).includes('is-not-used'));
    let notUsedRow = null;
    for (let i = 0; i < 40; i += 1) {
      notUsedRow = (await db.collection('labParticipants').doc('MP2670FF90A5F2').get()).data();
      if (JSON.stringify(notUsedRow?.platformsNotUsed) === JSON.stringify(['instagram', 'youtube'])) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    ok('the apps not used are kept against the code', JSON.stringify(notUsedRow?.platformsNotUsed) === JSON.stringify(['instagram', 'youtube']), JSON.stringify(notUsedRow?.platformsNotUsed));
    await snap('done-apps');
    ok('no browser errors in the lab flow', errors.length === 0, errors.join(' | '));

    // With the data in, the summary offers the lab visits: both are booked together, with an email and text reminders.
    ok('the summary offers both lab visits once the data is in', (await page.getByRole('heading', { name: 'Book your two lab visits.' }).count()) === 1);
    await page.getByRole('button', { name: 'Choose the times' }).click();
    await page.getByRole('heading', { name: 'Book your two lab visits.', level: 1 }).waitFor({ timeout: 30000 });
    await page.locator('#lab-slot-1 .mpmb-slots__time').first().waitFor({ timeout: 30000 });
    ok('only the times for a first visit are offered first, by day; the second waits for it', (await page.locator('#lab-slot-1 .mpmb-slots__time').count()) === 2 && (await page.locator('#lab-slot-1 .mpmb-slots__day').count()) === 2 && (await page.getByText('Choose your first visit, and the times for your second appear here.').count()) === 1);
    await page.getByRole('button', { name: 'Book both visits' }).click();
    await page.getByText('Choose a time for your first visit.').first().waitFor();
    ok('booking without times or an email is held back with reasons', (await page.getByText(/Enter your email address, so we can send you the details/).count()) >= 1 && (await page.getByText(/Choose your first visit, then a time for your second/).count()) >= 1);
    await page.locator('#lab-slot-1 .mpmb-slots__time').first().click();
    await page.locator('#lab-slot-2 .mpmb-slots__time').first().waitFor({ timeout: 30000 });
    ok('the second visit offers only the times 28 to 35 days after the first chosen', (await page.locator('#lab-slot-2 .mpmb-slots__time').count()) === 2 && (await page.getByText(/It is 28 to 35 days after the first: between/).count()) === 1);
    await page.locator('#lab-slot-2 .mpmb-slots__time').first().click();
    await page.getByLabel('Email address').fill('jane@example.com');
    await page.getByLabel(/Mobile number/).fill('07700 900123');
    ok('giving a mobile number ticks text reminders', await page.locator('#lab-sms').isChecked());
    await snap('book');
    await page.getByRole('button', { name: 'Book both visits' }).click();
    await page.getByText(/Booked: your two lab visits/).first().waitFor({ timeout: 30000 });
    await snap('booked');
    const bookingsOf = async () => (await db.collection('labBookings').where('participantCode', '==', 'MP2670FF90A5F2').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    const firstBooked = await bookingsOf();
    let v1 = firstBooked.find((b) => b.visit === 1);
    const v2 = firstBooked.find((b) => b.visit === 2);
    ok('both visits are booked against the code in the chosen times, with the confirmation recorded (no email or texts set up here)', firstBooked.length === 2 && v1?.status === 'booked' && v1?.start?.toDate().getTime() === v1a.getTime() && v2?.status === 'booked' && v2?.start?.toDate().getTime() === v2a.getTime() && v1?.confirmation?.email === 'not-configured' && v1?.confirmation?.sms === 'not-configured' && v2?.confirmation?.email === 'not-configured' && v1?.sequence === 0 && v2?.sequence === 0 && v1?.bookedBy === 'participant', JSON.stringify(v1?.confirmation));
    const contact = (await db.collection('labContacts').doc('MP2670FF90A5F2').get()).data();
    ok('the contact details are kept apart from the research data, the mobile in international form', contact?.email === 'jane@example.com' && contact?.mobile === '+447700900123' && contact?.smsReminders === true);
    ok('each time counts its booking', (await db.collection('labSlots').doc(v1.slotId).get()).data()?.booked === 1 && (await db.collection('labSlots').doc(v2.slotId).get()).data()?.booked === 1);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Add to my calendar' }).first().click()]);
    const icsText = fs.readFileSync(await download.path(), 'utf8');
    ok('the calendar file is an iCalendar event for the visit, in UTC', download.suggestedFilename() === 'myphone-mybrain-visit-1.ics' && icsText.startsWith('BEGIN:VCALENDAR') && icsText.includes('UID:MP2670FF90A5F2-visit-1@myphonemybrain.com') && icsText.includes(`DTSTART:${icsStamp(v1a)}`) && icsText.includes('\r\n'));
    await page.getByRole('button', { name: 'Back to my summary' }).click();
    await page.getByText(/The details are in your email/).waitFor();
    const visitsCard = await page.locator('.mpmb-visits-card').innerText();
    ok('the summary shows both booked visits', visitsCard.includes('First lab visit') && visitsCard.includes('Second lab visit'));
    ok('the summary before the break no longer offers MyStory: it is told at the first visit', (await page.locator('.mpmb-mystory').count()) === 0);

    const labP2 = (await db.collection('labParticipants').doc('MP2670FF90A5F2').get()).data();
    ok('participant row counts one screenshot and one archive over two sends', labP2?.archiveCount === 1 && labP2?.screenshotCount === 1 && labP2?.donationIds?.length === 2);
    ok('the send settles the reminder, so no follow-up will go', Boolean((await db.collection('labReminders').doc('MP2670FF90A5F2').get()).data()?.completedAt));
    const [shotDonation, fileDonation] = labP2?.donationIds?.length === 2 ? await Promise.all(labP2.donationIds.map(async (id) => (await db.collection('labDonations').doc(id).get()).data())) : [null, null];
    const archive = fileDonation?.files?.find((f) => f.kind === 'archive');
    const shot = shotDonation?.files?.find((f) => f.kind === 'screenshot');
    ok('archive recorded from its manifest: TikTok, searches left out, two watched videos', archive?.platforms?.[0] === 'tiktok' && !archive?.categories?.includes('tt_search') && archive?.categories?.includes('tt_watch') && archive?.kept?.tt_watch === 2 && archive?.entries?.includes('tiktok_cleaned.json') && archive?.path === `lab/MP2670FF90A5F2/${archive?.uploadId}.zip`);
    ok('screenshot cleaned and checked', shot?.width > 0 && ['accepted', 'review'].includes(shot?.quality?.verdict) && shot?.path?.startsWith('lab/MP2670FF90A5F2/'));
    ok('each send carries one file, the phone chosen with the screenshots and the phase', shotDonation?.files?.length === 1 && fileDonation?.files?.length === 1 && shotDonation?.phone === 'iphone' && fileDonation?.phone === 'iphone' && labP2?.phone === 'iphone' && shotDonation?.phase === 'pre' && fileDonation?.phase === 'pre');
    const [labFiles] = await bucket.getFiles({ prefix: 'lab/MP2670FF90A5F2/' });
    ok('lab files stored under the code', labFiles.length === 2 && labFiles.some((f) => f.name.endsWith('.zip')) && labFiles.some((f) => f.name.endsWith('.png')), labFiles.map((f) => f.name).join(', '));
    const storedZip = labFiles.find((f) => f.name.endsWith('.zip'));
    if (storedZip) {
      const [zipBytes] = await storedZip.download();
      const stored = await JSZip.loadAsync(zipBytes);
      const names = Object.keys(stored.files).filter((n) => !stored.files[n].dir).sort();
      const contents = (await Promise.all(names.map((n) => stored.file(n).async('string')))).join('\n');
      ok('stored archive holds only the cleaner’s files, without the private content', names.join(',') === 'manifest.json,tiktok_cleaned.json' && !contents.includes('private words') && !contents.includes('me@example.com') && !contents.includes('something private') && !contents.includes('10.0.0.1'), names.join(','));
    }
    const [labQuarantine] = await bucket.getFiles({ prefix: 'labquarantine/' });
    ok('lab quarantine emptied after submit', labQuarantine.length === 0, `${labQuarantine.length} left`);

    // Another device, with nothing saved: the emailed link carries the ID, and the server says what has arrived.
    const other = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const elsewhere = await other.newPage();
    elsewhere.on('pageerror', (e) => errors.push(e.message));
    await elsewhere.goto(`http://127.0.0.1:${PORT}/lab.html?code=MP2670FF90A5F2`);
    await elsewhere.locator('.mpmb-code-line').waitFor();
    ok('a link with the ID opens the first step with it filled in, and the ID leaves the address bar', (await elsewhere.locator('.mpmb-code-line').innerText()).includes('MP2670FF90A5F2') && !elsewhere.url().includes('code='));
    await elsewhere.getByRole('button', { name: 'Continue' }).click();
    await elsewhere.getByRole('heading', { name: 'Welcome back.' }).waitFor({ timeout: 30000 });
    const welcomeText = await elsewhere.locator('.mpmb-step').innerText();
    ok('on another device the person carries on where they left off: the server says what has arrived', welcomeText.includes('1 screen-time screenshot and 1 cleaned app-data file') && welcomeText.includes('Everything the study needs from before your break is in') && welcomeText.includes('MP2670FF90A5F2'), welcomeText.slice(0, 300));
    await elsewhere.screenshot({ path: path.join(root, 'dist-emulator', 'lab-welcome-back.png'), fullPage: true });
    await other.close();
    // A third device, no link: the same four details, typed differently, find the same record.
    const third = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const again = await third.newPage();
    again.on('pageerror', (e) => errors.push(e.message));
    await again.goto(`http://127.0.0.1:${PORT}/lab.html`);
    await again.getByRole('button', { name: 'Start', exact: true }).click();
    await again.getByLabel('First name').fill(' jane');
    await again.getByLabel('Last name').fill('SMITH ');
    await again.getByLabel('Date of birth').fill('2005-03-14');
    await again.getByLabel('Postcode').fill('ls2 9jt');
    await again.getByRole('button', { name: 'Continue' }).click();
    await again.getByRole('heading', { name: 'Welcome back.' }).waitFor({ timeout: 30000 });
    ok('the same details, in any case or spacing, find the same participant on a new device', (await again.locator('.mpmb-step').innerText()).includes('MP2670FF90A5F2'));
    await third.close();

    // During the break: the check-in page recognises the ID saved on this device; nothing to sign.
    await page.goto(`http://127.0.0.1:${PORT}/lab.html?flow=checkin`);
    await page.getByRole('heading', { name: 'Your mid-break check-in.', level: 1 }).waitFor();
    ok('the check-in page fills in the ID remembered on this device', (await page.locator('.mpmb-code-line').innerText()).includes('MP2670FF90A5F2'));
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'How is your break going?', level: 1 }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Send my check-in' }).click();
    await page.getByText(/Please answer: Which week/).first().waitFor();
    for (const [q, v] of [['week', '2'], ['apps-used', 'once-or-twice'], ['mood', '4'], ['difficulty', '3'], ['missed', '2']]) await page.locator(`#lab-q-${q}-${v}`).check();
    await page.locator('#lab-q-notes').fill('Brick held up fine.');
    await page.locator('input[type=file]').first().setInputFiles([{ name: 'week2.png', mimeType: 'image/png', buffer: await png('This week') }]);
    await page.waitForFunction(() => document.querySelectorAll('.mpmb-shots li').length === 1);
    await snap('checkin');
    await page.getByRole('button', { name: 'Send my check-in' }).click();
    await page.getByRole('heading', { name: 'Your story this week', level: 1 }).waitFor({ timeout: 90000 });
    ok('MyStory follows the check-in, with the mid-break questions and a way to skip it', (await page.getByText(/wanted to open one of your apps/).count()) === 1 && (await page.getByRole('button', { name: 'Skip this time' }).count()) === 1);
    await page.getByRole('button', { name: 'Send my story' }).click();
    await page.getByText('Choose one of the questions to answer.').first().waitFor();
    await page.locator('#story-prompt-pull').check();
    await page.locator('#story-text').fill('I reached for TikTok on the bus out of habit, then read my book instead.');
    await page.locator('#story-title').fill('The bus');
    await page.locator('#story-pull').scrollIntoViewIfNeeded();
    const pad = await page.locator('#story-pull svg').boundingBox();
    await page.mouse.click(pad.x + pad.width * 0.5, pad.y + pad.height * 0.22);
    await page.locator('#story-hard').focus();
    for (let i = 0; i < 20; i += 1) await page.keyboard.press('ArrowRight');
    await page.locator('#story-where-travelling').check();
    await page.locator('fieldset.mpmb-dyad', { has: page.locator('#story-afterwards') }).getByLabel(/Not sure/).check();
    await snap('mystory');
    await page.getByRole('button', { name: 'Send my story' }).click();
    await page.getByRole('heading', { name: 'Thank you. Your story is in.' }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: /Your check-in has been sent/ }).waitFor({ timeout: 30000 });
    ok('after the check-in, support is signposted and the visits still to come are shown', (await page.getByText(/Samaritans/).count()) === 1 && (await page.locator('.mpmb-visits-card').innerText()).includes('Second lab visit'));
    await snap('checkin-done');
    const midStory = (await db.collection('labStories').where('participantCode', '==', 'MP2670FF90A5F2').get()).docs.map((d) => d.data())[0];
    const pull = midStory?.answers?.pull;
    ok('the story is filed under the code and phase: prompt, title, the triangle leaning to Habit, the slider moved, a "not sure", a choice', midStory?.phase === 'mid' && midStory?.structureId === 'mystory-mid' && midStory?.promptId === 'pull' && midStory?.title === 'The bus' && midStory?.source === 'checkin' && typeof midStory?.checkInId === 'string' && pull && pull.a > 0.5 && Math.abs(pull.a + pull.b + pull.c - 1) < 0.002 && midStory?.answers?.hard === 70 && midStory?.answers?.afterwards === 'na' && midStory?.answers?.where === 'travelling' && !('feeling' in (midStory?.answers ?? {})), JSON.stringify(midStory?.answers));
    const labP3 = (await db.collection('labParticipants').doc('MP2670FF90A5F2').get()).data();
    const checkIn = labP3?.checkInIds?.length ? (await db.collection('labCheckIns').doc(labP3.checkInIds[0]).get()).data() : null;
    ok('the check-in is filed under the code with its answers', checkIn?.participantCode === 'MP2670FF90A5F2' && checkIn?.number === 1 && checkIn?.answers?.week === '2' && checkIn?.answers?.['apps-used'] === 'once-or-twice' && checkIn?.answers?.notes === 'Brick held up fine.' && checkIn?.formVersion === '0.1-draft' && labP3?.checkInCount === 1, JSON.stringify(checkIn?.answers));
    const midDonation = (await db.collection('labDonations').where('participantCode', '==', 'MP2670FF90A5F2').where('phase', '==', 'mid').get()).docs[0]?.data();
    ok('its screenshot goes with it, in the mid-break phase, linked to the check-in', midDonation?.checkInId === labP3?.checkInIds?.[0] && midDonation?.files?.length === 1 && midDonation?.files?.[0]?.kind === 'screenshot' && labP3?.phaseCounts?.mid?.screenshots === 1 && labP3?.phaseCounts?.pre?.screenshots === 1 && labP3?.phaseCounts?.pre?.archives === 1, JSON.stringify(labP3?.phaseCounts));

    // After the break: the code again, a reminder instead of a new consent, then the same two donations, filed as post.
    await page.goto(`http://127.0.0.1:${PORT}/lab.html?flow=after`);
    await page.getByRole('heading', { name: 'Welcome back after your break.', level: 1 }).waitFor();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Before you start: a reminder.', level: 1 }).waitFor({ timeout: 30000 });
    const reminderText = await page.locator('.mpmb-step').innerText();
    ok('after the break there is nothing to sign: a reminder of the consent, of what is kept, and of withdrawing', (await page.locator('#lab-signature').count()) === 0 && reminderText.includes('nothing to sign again') && reminderText.includes('ask to withdraw') && reminderText.includes('1 screen-time screenshot and 1 cleaned app-data file'));
    await snap('after-reminder');
    await page.getByRole('button', { name: /Continue: my screenshots/ }).click();
    await page.getByRole('heading', { name: 'Send your screen-time screenshots from after your break.', level: 1 }).waitFor();
    await page.getByRole('radio', { name: 'Android' }).check();
    await page.locator('input[type=file]').first().setInputFiles([{ name: 'after.png', mimeType: 'image/png', buffer: await png('After the break') }]);
    await page.waitForFunction(() => document.querySelectorAll('.mpmb-shots li').length === 1);
    await page.getByRole('button', { name: 'Send my screenshot', exact: true }).click();
    await page.getByRole('heading', { name: 'Request a new data download.', level: 1 }).waitFor({ timeout: 90000 });
    ok('after the break, the apps set aside before stay greyed out and only TikTok is asked for', (await page.locator('.mpmb-apps__row[data-platform="tiktok"]').getAttribute('class')).includes('is-todo') && (await page.locator('.mpmb-apps__row[data-platform="youtube"]').getAttribute('class')).includes('is-not-used') && (await page.locator('.mpmb-apps__row[data-platform="instagram"]').getAttribute('class')).includes('is-not-used'));
    await page.getByRole('button', { name: /come back later/ }).click();
    await page.getByLabel('Your email address').fill('jane@example.com');
    await page.getByRole('button', { name: 'Email me my progress' }).click();
    await page.getByText(/could not send the email just now|Sent\. Check your inbox/).waitFor({ timeout: 30000 });
    const postReminder = (await db.collection('labReminders').doc('MP2670FF90A5F2').get()).data();
    ok('the after-break reminder is about the after-break files and waits for them', postReminder?.phase === 'post' && postReminder?.completedAt === null);
    await page.getByRole('button', { name: /^I have my file/ }).click();
    await page.getByRole('heading', { name: /Choose what to share from your data/ }).waitFor();
    await page.locator('#lab-zip').setInputFiles({ name: 'TikTok_Data.zip', mimeType: 'application/zip', buffer: tiktokZip });
    await page.getByRole('heading', { name: /Found: TikTok data/ }).waitFor({ timeout: 30000 });
    await page.locator('#cat-tt_search').uncheck();
    await page.getByRole('button', { name: 'Keep these choices' }).click();
    await page.locator('.mpmb-apps__row.is-ready[data-platform="tiktok"]').waitFor();
    await page.getByRole('button', { name: /Next: check and send/ }).click();
    await page.getByRole('heading', { name: /Check and send/ }).waitFor();
    await page.getByRole('button', { name: 'Send my data' }).click();
    await page.getByRole('heading', { name: /after-break data is in/ }).waitFor({ timeout: 90000 });
    ok('after the break, TikTok is ticked off and nothing is left to do', (await page.getByText('Every app you use is ticked off. Thank you.').count()) === 1);
    await snap('after-done');
    const labP4 = (await db.collection('labParticipants').doc('MP2670FF90A5F2').get()).data();
    ok('after the break the files are filed as post, and the participant row counts each phase', labP4?.phaseCounts?.post?.screenshots === 1 && labP4?.phaseCounts?.post?.archives === 1 && labP4?.phaseCounts?.pre?.screenshots === 1 && labP4?.phaseCounts?.pre?.archives === 1 && labP4?.donationIds?.length === 5 && labP4?.phone === 'android', JSON.stringify(labP4?.phaseCounts));
    ok('the after-break send settles that reminder', Boolean((await db.collection('labReminders').doc('MP2670FF90A5F2').get()).data()?.completedAt));
    // An ID without consent cannot use the later pages; nor can details nobody signed up with.
    await page.goto(`http://127.0.0.1:${PORT}/lab.html?flow=after&code=MP33CE17327FF2`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText(/We have no consent on file for participant ID/).waitFor({ timeout: 30000 });
    await page.getByLabel('First name').fill('Yasmin');
    await page.getByLabel('Last name').fill('Khan');
    await page.getByLabel('Date of birth').fill('2004-07-09');
    await page.getByLabel('Postcode').fill('BD1 1AA');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText('We could not find anyone who signed up with these details.').waitFor({ timeout: 30000 });
    ok('details without consent are sent to the first page', (await page.getByRole('link', { name: 'start on the first page' }).count()) === 1);
    ok('no browser errors on the check-in and after-break pages', errors.length === 0, errors.join(' | '));

    const lookup = await httpsCallable(fns, 'lookupLabParticipant')({ participantCode: 'mp2670ff90a5f2' });
    ok('another session can see that the code has consent and what was sent, phase by phase', lookup.data?.exists === true && lookup.data?.archives === 2 && lookup.data?.screenshots === 3 && typeof lookup.data?.consentedAt === 'string' && lookup.data?.phases?.pre?.archives === 1 && lookup.data?.phases?.pre?.screenshots === 1 && lookup.data?.phases?.mid?.screenshots === 1 && lookup.data?.phases?.post?.archives === 1 && lookup.data?.phases?.post?.screenshots === 1 && lookup.data?.checkIns === 1 && JSON.stringify(lookup.data?.phases?.pre?.platforms) === '["tiktok"]' && JSON.stringify(lookup.data?.phases?.post?.platforms) === '["tiktok"]' && JSON.stringify(lookup.data?.platformsNotUsed) === '["instagram","youtube"]', JSON.stringify(lookup.data));
    const unknown = await httpsCallable(fns, 'lookupLabParticipant')({ participantCode: 'MP33CE17327FF2' });
    ok('an unknown code is reported as not on file', unknown.data?.exists === false);
    ok('files for a code without consent are refused', await stranger(() => httpsCallable(fns, 'submitLabDonation')({ participantCode: 'MP33CE17327FF2', uploads: [{ uploadId: '423e4567-e89b-12d3-a456-426614174000', kind: 'screenshot', name: 'x.png', contentType: 'image/png', size: 10 }], phase: 'pre', client })));
    ok('client cannot upload a text file into the lab quarantine', await denied(() => uploadBytes(ref(webStorage, `labquarantine/${user.uid}/523e4567-e89b-12d3-a456-426614174000`), new Uint8Array([1, 2, 3]), { contentType: 'text/plain' })));
    ok('client cannot read stored lab files', await denied(() => getBytes(ref(webStorage, labFiles[0].name))));
    ok('client cannot read lab participants or consents', (await denied(() => getDoc(doc(webDb, 'labParticipants', 'MP2670FF90A5F2')))) && (await denied(() => getDoc(doc(webDb, 'labConsents', labParticipant.consentId)))));

    const labManifest = await (await fetch(`http://127.0.0.1:5001/${PROJECT}/europe-west2/exportNow`, { method: 'POST' })).json();
    const labParticipantsTsv = await readExport('social-media-break/donations/participants.tsv');
    const labConsentsTsv = await readExport('social-media-break/identifying/consents.tsv');
    const remindersTsv = await readExport('social-media-break/identifying/reminders.tsv');
    const labBeh = await readExport('social-media-break/donations/sub-MP2670FF90A5F2/ses-pre/beh/sub-MP2670FF90A5F2_ses-pre_task-donation_beh.tsv');
    const watchTsv = await readExport('social-media-break/donations/sub-MP2670FF90A5F2/ses-pre/beh/sub-MP2670FF90A5F2_ses-pre_task-tiktokwatch_run-02_beh.tsv');
    const checkinTsv = await readExport('social-media-break/donations/phenotype/checkin.tsv');
    ok('the check-ins are exported, one row each, with their mid-break screenshot in ses-mid and the after-break files in ses-post', checkinTsv.startsWith('participant_id\tsession_id\tcheck_in_id\tcheck_in_n\tsubmitted_at\tform_version\tweek\tapps_used\tmood\tdifficulty\tmissed\tnotes\n') && checkinTsv.includes('sub-MP2670FF90A5F2\tses-mid\t') && checkinTsv.includes('\t2\tonce-or-twice\t4\t3\t2\tBrick held up fine.') && labManifest.counts?.labCheckIns === 1 && labManifest.files?.includes('social-media-break/donations/sourcedata/sub-MP2670FF90A5F2/ses-mid/sub-MP2670FF90A5F2_ses-mid_run-01_screenshot.png') && labManifest.files?.includes('social-media-break/donations/sourcedata/sub-MP2670FF90A5F2/ses-post/sub-MP2670FF90A5F2_ses-post_run-01_screenshot.png') && labManifest.files?.includes('social-media-break/donations/sourcedata/sub-MP2670FF90A5F2/ses-post/sub-MP2670FF90A5F2_ses-post_run-02_archive.zip') && labManifest.files?.includes('social-media-break/donations/sub-MP2670FF90A5F2/ses-post/beh/sub-MP2670FF90A5F2_ses-post_task-tiktokwatch_run-02_beh.tsv'), JSON.stringify(labManifest.counts));
    ok('the lab study has its own folder: a pre session with unpacked tables under donations/, names only under identifying/', labManifest.counts?.labParticipants === 1 && labManifest.counts?.labArchives === 2 && labManifest.counts?.labScreenshots === 3 && labManifest.counts?.labSignatures === 1 && labParticipantsTsv.includes('sub-MP2670FF90A5F2\t') && labParticipantsTsv.includes('\ttiktok\tinstagram; youtube\tandroid\t') && labParticipantsTsv.includes('pre; mid; post') && !labParticipantsTsv.includes('Jane') && !labParticipantsTsv.includes('LS2 9JT') && !labParticipantsTsv.includes('2005-03-14') && labParticipantsTsv.includes('\t21\t') && labConsentsTsv.includes('Jane Smith') && labConsentsTsv.includes('LS2 9JT') && labConsentsTsv.includes('2005-03-14') && remindersTsv.includes('MP2670FF90A5F2\tsub-MP2670FF90A5F2\tjane@example.com') && !labParticipantsTsv.includes('jane@') && labBeh.includes('archive\tsourcedata/sub-MP2670FF90A5F2/ses-pre/sub-MP2670FF90A5F2_ses-pre_run-02_archive.zip') && watchTsv === 'time\tlink\n2026-09-01 20:11:03\thttps://www.tiktokv.com/share/video/1/\n2026-09-01 20:12:40\thttps://www.tiktokv.com/share/video/2/\n' && !labManifest.files?.some((n) => n.includes('tiktoksearch')) && labManifest.files?.includes('social-media-break/donations/sourcedata/sub-MP2670FF90A5F2/ses-pre/sub-MP2670FF90A5F2_ses-pre_run-02_archive.zip') && labManifest.files?.includes('social-media-break/donations/sourcedata/sub-MP2670FF90A5F2/ses-pre/sub-MP2670FF90A5F2_ses-pre_run-01_screenshot.png') && labManifest.files?.some((n) => n.startsWith('social-media-break/identifying/signatures/sub-MP2670FF90A5F2/')) && !labManifest.files?.some((n) => n.startsWith('schools/') && n.includes('MP2670FF90A5F2')), JSON.stringify(labManifest.counts));

    // The booking page on its own: both visits; move the second, cancel both, then book both again.
    await page.goto(`http://127.0.0.1:${PORT}/lab.html?flow=book`);
    await page.getByRole('heading', { name: 'Book your lab visits.', level: 1 }).waitFor();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Your lab visits.', level: 1 }).waitFor({ timeout: 30000 });
    await page.locator('.mpmb-visit').nth(1).waitFor({ timeout: 30000 });
    ok('the booking page lists both visits, with one way to change them and one to cancel', (await page.locator('.mpmb-visit').count()) === 2 && (await page.getByRole('button', { name: 'Change my times' }).count()) === 1 && (await page.getByRole('button', { name: 'Cancel your visits' }).count()) === 1);
    await snap('book-page');
    await page.getByRole('button', { name: 'Change my times' }).click();
    await page.getByRole('heading', { name: 'Change your lab visit times.', level: 1 }).waitFor();
    ok('changing starts from the current times, kept', (await page.locator('#lab-slot-1 input[value="keep"]').isChecked()) && (await page.locator('#lab-slot-2 input[value="keep"]').isChecked()) && (await page.getByLabel('Email address').inputValue()) === 'jane@example.com');
    await page.getByRole('button', { name: 'Save my times' }).click();
    await page.getByText('Choose a new time for at least one visit, or keep your current times.').first().waitFor();
    ok('the second visit can move to the other time in its window, not the one too late', (await page.locator('#lab-slot-2 .mpmb-slots__time').count()) === 2);
    await page.locator('#lab-slot-2 .mpmb-slots__time').nth(1).click();
    await page.getByRole('button', { name: 'Save my times' }).click();
    await page.getByText(/Changed: your second lab visit/).first().waitFor({ timeout: 30000 });
    const afterMove = await bookingsOf();
    const moved = afterMove.find((b) => b.visit === 2 && b.status === 'booked');
    const old2 = afterMove.find((b) => b.id === v2.id);
    ok('a move cancels the old booking, points it at the new one, frees its time, and leaves the first visit alone', old2?.status === 'cancelled' && old2?.replacedBy === moved?.id && moved?.replaces === v2.id && moved?.sequence === 1 && (await db.collection('labSlots').doc(v2.slotId).get()).data()?.booked === 0 && afterMove.find((b) => b.id === v1.id)?.status === 'booked');
    await page.getByRole('button', { name: 'Cancel your visits' }).click();
    await page.getByRole('button', { name: 'Yes, cancel them' }).click();
    await page.getByText(/Your lab visits are cancelled\. We have emailed you to confirm/).first().waitFor({ timeout: 30000 });
    const afterCancel = await bookingsOf();
    ok('cancelling cancels both, frees the times and records who cancelled', afterCancel.every((b) => b.status === 'cancelled') && afterCancel.find((b) => b.id === moved.id)?.cancelledBy === 'participant' && afterCancel.find((b) => b.id === v1.id)?.cancellation?.email === 'not-configured' && (await db.collection('labSlots').doc(moved.slotId).get()).data()?.booked === 0 && (await db.collection('labSlots').doc(v1.slotId).get()).data()?.booked === 0);
    await page.getByRole('heading', { name: 'Book your two lab visits.', level: 1 }).waitFor({ timeout: 30000 });
    await page.locator('#lab-slot-1 .mpmb-slots__time').first().click();
    await page.locator('#lab-slot-2 .mpmb-slots__time').first().click();
    await page.getByRole('button', { name: 'Book both visits' }).click();
    await page.getByText(/Booked: your two lab visits/).first().waitFor({ timeout: 30000 });
    v1 = (await bookingsOf()).find((b) => b.visit === 1 && b.status === 'booked');
    ok('booking again gives each visit a newer calendar entry, so calendars update the same event', v1?.start?.toDate().getTime() === v1a.getTime() && v1?.sequence === 2, String(v1?.sequence));

    // The quarter-hourly messages, run at chosen moments: the reminders the day before, then the first weekly check-in.
    const runMessages = async (at) => (await fetch(`http://127.0.0.1:5001/${PROJECT}/europe-west2/labMessagesNow?at=${encodeURIComponent(at.toISOString())}`, { method: 'POST' })).json();
    await runMessages(new Date(v1a.getTime() - 23 * 3600000));
    const reminded = (await db.collection('labBookings').doc(v1.id).get()).data()?.reminders ?? {};
    ok('the day before the visit, the email and text reminders go (recorded as not-configured here), and the same-day text waits', reminded['day-before-email']?.outcome === 'not-configured' && reminded['day-before-sms']?.outcome === 'not-configured' && !reminded['same-day-sms'], JSON.stringify(reminded));
    await runMessages(new Date(v1a.getTime() - 23 * 3600000 + 60000));
    ok('a second run sends nothing twice', Object.keys((await db.collection('labBookings').doc(v1.id).get()).data()?.reminders ?? {}).length === 2);
    await runMessages(new Date(v1a.getTime() + 7 * DAY + 30 * 60000));
    const sentMessages = (await db.collection('labParticipants').doc('MP2670FF90A5F2').get()).data()?.messages ?? {};
    ok('a week into the break the check-in reminder goes, and nothing else yet', sentMessages['check-in-1']?.email === 'not-configured' && sentMessages['check-in-1']?.sms === 'not-configured' && Object.keys(sentMessages).length === 1, JSON.stringify(sentMessages));

    // MyStory on its own page, from a personal link, for after the break.
    await page.goto(`http://127.0.0.1:${PORT}/lab.html?flow=story&phase=post&code=MP2670FF90A5F2`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Looking back on your break', level: 1 }).waitFor({ timeout: 30000 });
    await page.locator('#story-prompt-mattered').check();
    await page.locator('#story-text').fill('The quiet evenings mattered most: I slept better and talked to my flatmates.');
    await page.locator('#story-title').fill('Quiet evenings');
    await page.getByRole('button', { name: 'Send my story' }).click();
    await page.getByRole('heading', { name: 'Thank you. Your story is in.' }).waitFor({ timeout: 30000 });
    const postStory = (await db.collection('labStories').where('phase', '==', 'post').get()).docs.map((d) => d.data())[0];
    ok('a story from MyStory’s own page is filed under the after-break phase', postStory?.participantCode === 'MP2670FF90A5F2' && postStory?.source === 'story' && postStory?.structureId === 'mystory-post' && postStory?.title === 'Quiet evenings');
    // MyStory at the first visit, on the lab computer: the page forgets the participant once it is sent.
    await page.goto(`http://127.0.0.1:${PORT}/lab.html?flow=story&phase=pre&at=lab&code=MP2670FF90A5F2`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Your phone, before the break', level: 1 }).waitFor({ timeout: 30000 });
    await page.locator('#story-prompt-evening').check();
    await page.locator('#story-text').fill('Most evenings I scroll in bed until late, then feel tired the next day.');
    await page.locator('#story-title').fill('Late nights');
    await page.getByRole('button', { name: 'Send my story' }).click();
    await page.getByText(/Please hand the computer back to the researcher/).waitFor({ timeout: 30000 });
    ok('at the lab, nothing about the participant is kept on the computer while they tell it', !(await page.evaluate(() => window.localStorage.getItem('mpmb-lab-story:v1') ?? '')).includes('Late nights'));
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.getByRole('heading', { name: 'MyStory.', level: 1 }).waitFor({ timeout: 30000 });
    const leftOver = await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith('mpmb-lab')));
    ok('Finish clears the lab computer for the next person: no ID, nothing stored', leftOver.length === 0 && page.url().endsWith('phase=pre&at=lab') && !page.url().includes('code=') && (await page.getByLabel('First name').count()) === 1, JSON.stringify(leftOver));
    const preStory = (await db.collection('labStories').where('phase', '==', 'pre').get()).docs.map((d) => d.data())[0];
    ok('the story told at the lab is filed under the before-break phase', preStory?.participantCode === 'MP2670FF90A5F2' && preStory?.structureId === 'mystory-pre' && preStory?.title === 'Late nights');
    ok('no browser errors on the booking and MyStory pages', errors.length === 0, errors.join(' | '));

    // The staff page: the key, the times, a participant's links, a school's password.
    const toolsSnap = (name) => page.screenshot({ path: path.join(root, 'dist-emulator', `tools-${name}.png`), fullPage: true });
    await page.goto(`http://127.0.0.1:${PORT}/tools.html?tool=staff`);
    await page.getByLabel('Staff key').fill('wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText('That staff key is not right.').waitFor({ timeout: 30000 });
    await page.getByLabel('Staff key').fill('emulator-staff-key');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('heading', { name: 'Add lab times' }).waitFor({ timeout: 30000 });
    ok('the staff page lists the times with their bookings', (await page.locator('.mpmb-tools__row').count()) === 5 && (await page.getByText(/1 of 1 booked/).count()) === 2);
    await toolsSnap('times');
    await page.getByRole('button', { name: 'Bookings', exact: true }).click();
    await page.getByRole('heading', { name: 'Bookings from a fortnight ago' }).waitFor();
    ok('the bookings show who is coming, their contact details and what was sent', (await page.locator('.mpmb-tools__row').count()) === 2 && (await page.locator('.mpmb-tools__row').first().innerText()).includes('jane@example.com') && (await page.locator('.mpmb-tools__row').first().innerText()).includes('day-before email: not set up'));
    await page.getByRole('button', { name: 'Participants', exact: true }).click();
    await page.getByLabel('Find a participant').fill('mp2670ff90a5f2');
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await page.getByRole('heading', { name: 'Personal links' }).waitFor({ timeout: 30000 });
    const detailText = await page.locator('.mpmb-tools__detail').innerText();
    ok('a participant’s detail shows the messages sent, every personal link and the links for the lab computer', detailText.includes('https://myphonemybrain.com/break/check-in/?code=MP2670FF90A5F2') && detailText.includes('https://myphonemybrain.com/break/mystory/?phase=mid&code=MP2670FF90A5F2') && detailText.includes('https://myphonemybrain.com/break/mystory/?phase=pre&at=lab&code=MP2670FF90A5F2') && detailText.includes('check-in-1: email not-configured') && detailText.includes('Both visits booked.'));
    await toolsSnap('participant');
    await page.getByRole('button', { name: 'School uploads', exact: true }).click();
    const duaCard = page.locator('section.mpmb-card', { has: page.getByRole('heading', { name: 'Dixons Unity Academy' }) });
    await duaCard.getByRole('button', { name: 'Make a password' }).click();
    await duaCard.locator('.mpmb-tools__password').waitFor({ timeout: 30000 });
    const schoolPassword = (await duaCard.locator('.mpmb-tools__password').innerText()).trim();
    const access = (await db.collection('schoolUploadAccess').doc('dua').get()).data();
    ok('a school password is made, shown once, and only its hash is kept', /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(schoolPassword) && access?.active === true && typeof access?.hash === 'string' && !JSON.stringify(access).includes(schoolPassword.replace(/-/g, '')));
    await toolsSnap('schools');

    // The school's upload page: the password, the file read back for checking, then sent.
    await page.goto(`http://127.0.0.1:${PORT}/tools.html?tool=school-upload&school=dua`);
    await page.getByLabel('Password').fill('AAAA-BBBB-CCCC');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText(/That password is not right/).waitFor({ timeout: 30000 });
    await page.getByLabel('Password').fill(schoolPassword.toLowerCase().replace(/-/g, ' '));
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Send the class lists.' }).waitFor({ timeout: 30000 });
    const classCsv = 'UPN,Legal Forename,Legal Surname,DOB,Year,Reg Group,SEN\nA123456789012,Kai,Patel,14/03/2013,8,8K,No\nA123456789013,Ola,Nowak,01/02/2013,8,8K,No\nB12,Bad,Row,01/02/2013,8,8K,No\n';
    await page.locator('#school-file').setInputFiles({ name: 'Year 8.csv', mimeType: 'text/csv', buffer: Buffer.from(classCsv) });
    await page.getByRole('heading', { name: 'Check what we read' }).waitFor({ timeout: 30000 });
    const checkText = await page.locator('.mpmb-card').innerText();
    ok('the school sees what was read before sending: pupils, usable UPNs, columns not read, a row to check', checkText.includes('3 pupils') && checkText.includes('2 with a UPN we can use') && checkText.includes('Not read: SEN') && checkText.includes('1 row to check'), checkText.slice(0, 300));
    await toolsSnap('school-check');
    await page.getByLabel('Your name').fill('Ms Teacher');
    await page.getByLabel(/Your role/).fill('Head of Year 8');
    await page.getByLabel('Your school email').fill('teacher@dua.example.org');
    await page.getByRole('button', { name: 'Send to the research team' }).click();
    await page.getByRole('heading', { name: 'Thank you. We have your file.' }).waitFor({ timeout: 30000 });
    const upload = (await db.collection('schoolUploads').get()).docs.map((d) => d.data())[0];
    ok('the upload is recorded: the school, what was read, who sent it', upload?.schoolId === 'DUA' && upload?.pupilCount === 3 && upload?.validUpns === 2 && upload?.uploader?.name === 'Ms Teacher' && upload?.pupils?.[0]?.upn === 'A123456789012' && upload?.pupils?.[0]?.dateOfBirth === '2013-03-14' && upload?.notified?.team === 'not-configured');
    const [schoolFiles] = await bucket.getFiles({ prefix: 'schoolupns/dua/' });
    ok('the file is kept exactly as sent, in its own place', schoolFiles.length === 1 && (await schoolFiles[0].download())[0].toString('utf8') === classCsv);
    ok('a client cannot read the school files or the password hashes', (await denied(() => getBytes(ref(webStorage, schoolFiles[0].name)))) && (await denied(() => getDoc(doc(webDb, 'schoolUploadAccess', 'dua')))));
    // The wrong staff key and the wrong school password, tried on purpose above, are refused by the server (403, 400): the only errors allowed.
    ok('no browser errors on the staff and school pages beyond the two refusals tried on purpose', errors.length === 2 && errors.some((e) => /status of 403/.test(e)) && errors.some((e) => /status of 400/.test(e)), errors.join(' | '));

    // Everything new reaches the export: MyStory by phase, the visits and contacts, the school's file and the UPN match.
    const finalManifest = await (await fetch(`http://127.0.0.1:5001/${PROJECT}/europe-west2/exportNow`, { method: 'POST' })).json();
    const midTsv = await readExport('social-media-break/donations/phenotype/mystory_mid.tsv');
    const postTsv = await readExport('social-media-break/donations/phenotype/mystory_post.tsv');
    const preTsv = await readExport('social-media-break/donations/phenotype/mystory_pre.tsv');
    const visitsTsv = await readExport('social-media-break/identifying/visits.tsv');
    const contactsTsv = await readExport('social-media-break/identifying/contacts.tsv');
    const labPeople = await readExport('social-media-break/donations/participants.tsv');
    const matchesTsv = await readExport('schools/upn-uploads/upn_matches.tsv');
    const unmatchedTsv = await readExport('schools/upn-uploads/upn_unmatched.tsv');
    ok('MyStory is exported by phase, the triangle over three columns', midTsv.split('\n')[0].includes('pull_habit\tpull_people_and_connection\tpull_boredom_or_stress\tpull_status') && midTsv.includes('sub-MP2670FF90A5F2\tses-mid\t') && midTsv.includes('\tThe bus\t') && midTsv.includes('\tnot-sure\t') && postTsv.includes('\tQuiet evenings\t') && preTsv.includes('sub-MP2670FF90A5F2\tses-pre\t') && preTsv.includes('\tLate nights\t') && finalManifest.counts?.labStories === 3, JSON.stringify(finalManifest.counts));
    ok('the visits and contact details are exported to identifying/, the visit date to the research table', visitsTsv.includes('MP2670FF90A5F2\tsub-MP2670FF90A5F2\t1\t') && visitsTsv.includes('\tmoved\t') && visitsTsv.includes('day-before-email:not-configured') && contactsTsv.includes('jane@example.com\t+447700900123\ttrue') && labPeople.includes(`\t${v1a.toISOString().slice(0, 10)}\tbooked\t`) && !labPeople.includes('jane@'));
    ok('the school’s file and what was read sit in schools/upn-uploads/, and the UPN is matched to the family’s record', finalManifest.files?.some((n) => /^schools\/upn-uploads\/dua\/\d{4}-\d{2}-\d{2}_[0-9a-f]{8}_Year 8\.csv$/.test(n)) && finalManifest.files?.some((n) => /^schools\/upn-uploads\/dua\/.*_pupils\.tsv$/.test(n)) && matchesTsv.includes('\tKai\tPatel\t2013-03-14\t') && matchesTsv.includes('\tA123456789012\tname-and-dob\t') && unmatchedTsv.includes('DUA\tA123456789013\tOla\tNowak') && finalManifest.counts?.upnUploads === 1 && finalManifest.counts?.upnMatched === 1, JSON.stringify(finalManifest.counts));

    ok('client cannot read its own quarantine upload', await denied(async () => {
      await uploadBytes(ref(webStorage, `quarantine/${user.uid}/223e4567-e89b-12d3-a456-426614174000`), buffer, { contentType: 'image/png' });
      await getBytes(ref(webStorage, `quarantine/${user.uid}/223e4567-e89b-12d3-a456-426614174000`));
    }));
  } catch (e) {
    console.log('E2E ERROR', e.message);
    await page.screenshot({ path: path.join(root, 'dist-emulator', 'failure.png'), fullPage: true }).catch(() => {});
    failures.push('journey');
  } finally {
    await browser.close();
    server.kill();
  }
  fs.writeFileSync(path.join(root, 'dist-emulator', 'e2e-result.json'), JSON.stringify({ failures }, null, 2));
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll emulator checks passed');
  process.exit(failures.length ? 1 : 0);
}
