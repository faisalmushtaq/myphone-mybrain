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
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PROJECT = 'demo-mpmb';
const BUCKET = `${PROJECT}.appspot.com`;
const PORT = 8420;
/** The app again with the address finder switched on (it is off on the live site until the Ideal Postcodes key is stored). */
const FINDER_PORT = 8421;
/** A stand-in for Ideal Postcodes, so nothing is asked of the real one. */
const ADDRESS_PORT = 8431;

if (process.env.MPMB_E2E_INNER !== '1') {
  // Outer phase: build the app for the emulators, then run this script inside `emulators:exec`.
  console.log('Building the app against the emulators…');
  const env = {
    ...process.env,
    VITE_MPMB_BACKEND: 'firebase',
    VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1:4000',
    VITE_FIREBASE_API_KEY: 'demo-key',
    VITE_FIREBASE_PROJECT_ID: PROJECT,
    VITE_FIREBASE_APP_ID: '1:demo:web:demo',
    VITE_FIREBASE_AUTH_DOMAIN: `${PROJECT}.firebaseapp.com`,
    VITE_FIREBASE_STORAGE_BUCKET: BUCKET,
  };
  execSync('npx vite build --mode emulator --outDir dist-emulator', { cwd: root, stdio: 'inherit', env });
  execSync('npx vite build --mode emulator --outDir dist-emulator-finder', { cwd: root, stdio: 'inherit', env: { ...env, VITE_MPMB_ADDRESS_LOOKUP: 'on' } });
  const addresses = fakeIdealPostcodes(ADDRESS_PORT);
  console.log('Starting the emulator suite…');
  const result = spawn('firebase', ['emulators:exec', '--project', PROJECT, '--only', 'auth,functions,firestore,storage', `MPMB_E2E_INNER=1 node ${path.join(root, 'scripts/emulator-e2e.mjs')}`], {
    cwd: path.join(root, 'firebase'),
    stdio: 'inherit',
    // The functions emulator passes its environment on, so the address finder asks the stand-in.
    env: { ...process.env, FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199', MPMB_ADDRESS_API: `http://127.0.0.1:${ADDRESS_PORT}` },
  });
  result.on('exit', (code) => {
    addresses.close();
    process.exit(code ?? 1);
  });
} else {
  await inner();
}

/**
 * Ideal Postcodes, as far as the address finder uses it: three addresses at
 * LS6 1AB, suggestions from them, the full address for a suggestion's id, an
 * empty account for ZZ2 0ZZ, and /__seen, what it has been asked (for the checks).
 */
function fakeIdealPostcodes(port) {
  const street = [
    { id: 'paf_12', line_1: '12 Long Lane', line_2: '', uprn: '72000012' },
    { id: 'paf_14', line_1: '14 Long Lane', line_2: '', uprn: '72000014' },
    { id: 'paf_16', line_1: 'Flat 1', line_2: '16 Long Lane', uprn: '' },
  ];
  const record = (a) => ({ id: a.id, line_1: a.line_1, line_2: a.line_2, line_3: '', post_town: 'LEEDS', postcode: 'LS6 1AB', uprn: a.uprn, udprn: Number(a.id.slice(4)) });
  const seen = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/__seen') return send(200, seen);
    const { api_key: key, ...params } = Object.fromEntries(url.searchParams);
    seen.push({ path: url.pathname, params, key });
    if (key !== 'emulator-address-key') return send(401, { code: 4010, message: 'Invalid Key' });
    let m = url.pathname.match(/^\/v1\/postcodes\/([A-Z0-9]+)$/);
    if (m) {
      if (m[1] === 'LS61AB') return send(200, { code: 2000, message: 'Success', result: street.map(record) });
      if (m[1] === 'ZZ20ZZ') return send(402, { code: 4020, message: 'Token balance depleted' });
      return send(404, { code: 4040, message: 'Postcode Not Found' });
    }
    if (url.pathname === '/v1/autocomplete/addresses') {
      const words = (params.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const label = (a) => [a.line_1, a.line_2].filter(Boolean).join(', ');
      const hits = street.filter((a) => words.every((w) => `${label(a)} leeds`.toLowerCase().includes(w))).map((a) => ({ id: a.id, suggestion: `${label(a)}, Leeds, LS6`, udprn: Number(a.id.slice(4)), urls: { udprn: `/v1/udprn/${a.id.slice(4)}` } }));
      return send(200, { code: 2000, message: 'Success', result: { hits } });
    }
    m = url.pathname.match(/^\/v1\/autocomplete\/addresses\/([^/]+)\/gbr$/);
    if (m) {
      const a = street.find((s) => s.id === decodeURIComponent(m[1]));
      return a ? send(200, { code: 2000, message: 'Success', result: record(a) }) : send(404, { code: 4044, message: 'Address Not Found' });
    }
    return send(404, { code: 4040, message: 'Not Found' });
  });
  server.listen(port, '127.0.0.1');
  return server;
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

  // Serve the emulator builds.
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', path.join(root, 'dist-emulator')], { stdio: 'ignore' });
  const finderServer = spawn('python3', ['-m', 'http.server', String(FINDER_PORT), '-d', path.join(root, 'dist-emulator-finder')], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  // A fake microphone (a test tone), for MyStory's spoken answers.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: ['microphone'] });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__usageCalls = [];
    const record = (m) => (...args) => window.__usageCalls.push([m, ...args]);
    window.mpmbUsage = { app: record('app'), variant: record('variant'), part: record('part'), event: record('event') };
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));

  // Draws on the page the locator belongs to (a second device has its own mouse).
  /** Under 16, the parent is first asked whether the young person has a phone of their own (9 October 2026): "Yes" for these journeys. */
  const hasOwnPhone = async (page) => {
    await page.getByRole('heading', { name: /First: does .* have a phone of their own\?|Some questions about .*’s phone use/ }).waitFor();
    if (await page.getByRole('heading', { name: /First: does/ }).count()) await page.getByRole('button', { name: 'Yes', exact: true }).click();
    await page.getByRole('heading', { name: /Some questions about .*’s phone use/ }).waitFor();
  };
  const draw = async (locator, points) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    const { mouse } = locator.page();
    await mouse.move(box.x + points[0][0] * box.width, box.y + points[0][1] * box.height);
    await mouse.down();
    for (const [x, y] of points.slice(1)) await mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 5 });
    await mouse.up();
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
    await page.getByRole('heading', { name: /Share screen time with MyPhone/ }).waitFor();
    ok('the form says the workshop is separate and offers the opt-out to parents', (await page.getByText(/The workshop at school is separate/).count()) === 1 && (await page.getByRole('button', { name: 'Opt out of the workshop' }).count()) === 1);
    await page.getByRole('button', { name: /I’m the young person/ }).click();
    await page.getByLabel('Your first name').fill('Kai');
    await page.getByLabel('Your last name').fill('Patel');
    await page.getByLabel('Your date of birth', { exact: true }).fill('2013-03-14');
    await page.getByLabel('Your school', { exact: true }).selectOption('DUA');
    // England's school years: the year group is set by age on 31 August, before the school year starts on 1 September.
    const today = new Date();
    const startYear = today.getMonth() >= 8 ? today.getFullYear() : today.getFullYear() - 1;
    // Born 14 March 2013: by 31 August they have had that year's birthday.
    const expectedYear = `Year ${startYear - 2013 - 4}`;
    ok('the year group is filled in from the date of birth, and says so', (await page.getByLabel('Your year group').inputValue()) === expectedYear && (await page.getByText('From your date of birth. Change it if it’s not right.').count()) === 1);
    await page.getByLabel('Your year group').selectOption('');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText('Choose the year group.').first().waitFor();
    ok('the year group is required, and not marked optional', !(await page.locator('label[for="child-year-group"]').textContent()).includes('optional'));
    await page.getByLabel('Your year group').selectOption('Year 8');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: /Now your parent or carer does their part/ }).waitFor();
    const parentLink = page.getByRole('region', { name: 'Send your parent or carer a link' });
    const parentWhatsApp = decodeURIComponent((await parentLink.getByRole('link', { name: 'WhatsApp' }).getAttribute('href')) ?? '');
    ok('a young person under 16 can pass this phone to their parent or send them a link, both shown at once', (await page.getByRole('button', { name: /They’re with me: pass them this phone/ }).count()) === 1 && /\?who=parent/.test(parentWhatsApp) && parentWhatsApp.includes('University of Leeds') && (await parentLink.getByRole('link', { name: 'Text message' }).count()) === 1 && (await parentLink.getByRole('link', { name: 'Email' }).count()) === 1, parentWhatsApp);
    await page.getByRole('button', { name: /They’re with me: pass them this phone/ }).click();
    await page.getByRole('button', { name: /I’m the parent or carer/ }).click();
    await page.getByLabel('Your relationship to the young person').selectOption('mother');
    ok('no parental-responsibility tick: only a parent or carer fills this in', (await page.getByLabel(/parental responsibility for/).count()) === 0);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText('Enter your home address.').first().waitFor();
    ok('a mobile or an email is asked for, at least one, with why', (await page.getByText(/Enter your mobile number or your email address/).count()) >= 1 && (await page.getByText(/Only to remind you if the form isn’t finished/).count()) === 1);
    await page.getByLabel('Your email address').fill('priya@example.com');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText('Enter your home address.').first().waitFor();
    ok('the home address and postcode are required; with an email, a mobile is not', (await page.getByText('Enter your postcode.').count()) >= 1 && (await page.getByText(/Enter your mobile number or your email/).count()) === 0);
    await page.getByLabel('Your home address').fill('1 Long Lane, Leeds');
    await page.getByLabel('Postcode').fill('ls6 1ab');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: /Your permission: Kai’s phone use/ }).waitFor();
    ok('the permission asks nothing about the workshop, record linkage, the screenshots or future contact: no choices to make', (await page.locator('#stmt-link-records-agreed, #stmt-phone-use-agreed, #stmt-recontact-agreed').count()) === 0 && (await page.getByText(/agree to my child taking part/).count()) === 0 && (await page.getByRole('heading', { name: 'Your choices' }).count()) === 0);
    await page.getByLabel(/I confirm all of the above/).check();
    await draw(page.locator('#signature-pad'), [[0.15, 0.6], [0.35, 0.3], [0.55, 0.7], [0.8, 0.4]]);
    // The parent's name is the one they sign with (it is no longer asked on the details page).
    await page.getByLabel('Your full name', { exact: true }).fill('Priya Patel');
    await page.getByRole('button', { name: 'Confirm and sign' }).click();
    await hasOwnPhone(page);
    await page.getByRole('heading', { name: /Some questions about .*’s phone use/ }).waitFor();
    const usageCalls = await page.evaluate(() => window.__usageCalls);
    ok(
      'the form tells the usage counter its steps and the fields it asked to be fixed, and nothing anyone typed',
      usageCalls.some(([m, v]) => m === 'app' && v === 'family') &&
        ['welcome', 'child-details', 'parent-consent'].every((step) => usageCalls.some(([m, v]) => m === 'part' && v === step)) &&
        usageCalls.some(([m, type, data]) => m === 'event' && type === 'errors' && data.fields.includes('child-year-group')) &&
        !/Kai|Patel|Priya|LS6/i.test(JSON.stringify(usageCalls)),
    );

    // 1. The record is saved the moment the parent signs (decided 7 October 2026), before anything else is answered, and the answers as they come in.
    const recordOf = async (firstName) => {
      for (let i = 0; i < 40; i += 1) {
        const found = await db.collection('participants').where('firstName', '==', firstName).get();
        if (!found.empty) {
          const sub = await db.collection('submissions').where('participantId', '==', found.docs[0].id).get();
          if (!sub.empty) return { participantId: found.docs[0].id, code: sub.docs[0].id, submission: sub.docs[0].data() };
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      return null;
    };
    const signedOnly = await recordOf('Kai');
    const signedAssent = signedOnly ? (await db.collection('assents').doc(signedOnly.submission.assentId).get()).data() : null;
    ok('saved as soon as the parent signs: the permission, with where the screen time comes from and the young person’s answer still to come', signedOnly?.submission.version === 1 && Boolean(signedOnly?.submission.consentId) && signedOnly?.submission.phoneSource === null && signedAssent?.status === 'not-started' && signedAssent?.signature === null && signedOnly?.submission.surveyId === null, JSON.stringify(signedOnly?.submission ?? null).slice(0, 300));
    const code = signedOnly?.code ?? '';
    const firstConsentId = signedOnly?.submission.consentId;
    // One set, facts first (15 October 2026): when Kai got a phone and started on social media, then time and apps, sleep, effects, and the
    // open question last. Ages older than Kai is now are not offered.
    const step = async (n, act) => {
      await page.locator('.mpmb-quiz__count', { hasText: `Question ${n} of 15` }).waitFor();
      await act();
    };
    const tap = (label) => page.getByRole('button', { name: label, exact: true }).click();
    const pass = () => page.getByRole('button', { name: 'Skip this question' }).click();
    await page.locator('.mpmb-quiz__count', { hasText: 'Question 1 of 15' }).waitFor();
    ok('the set starts with when Kai got their own smartphone, under “Getting started”, and offers no age older than Kai (13)', (await page.locator('.mpmb-quiz__count').textContent()).startsWith('Getting started') && (await page.getByRole('heading', { name: /How old was Kai when they got their own smartphone\?/ }).count()) === 1 && (await page.getByRole('button', { name: '13', exact: true }).count()) === 1 && (await page.getByRole('button', { name: '14', exact: true }).count()) === 0 && (await page.getByRole('button', { name: '15 or older', exact: true }).count()) === 0 && (await page.locator('.mpmb-quiz__em').textContent()) === 'their own smartphone');
    await tap('12');
    await step(2, async () => ok('then when Kai started on social media, with the apps named and “social media” marked out from the phone question', (await page.getByRole('heading', { name: /How old was Kai when they started using social media, like TikTok, Snapchat, Instagram or YouTube\?/ }).count()) === 1 && (await page.locator('.mpmb-quiz__em').textContent()) === 'social media' && (await page.getByRole('button', { name: '14', exact: true }).count()) === 0));
    await tap('11');
    await step(3, async () => ok('then time and apps, with “on their phone” marked', (await page.locator('.mpmb-quiz__count').textContent()).startsWith('Time and apps') && (await page.locator('.mpmb-quiz__em').textContent()) === 'on their phone'));
    await pass();
    await step(4, pass);
    await step(5, () => tap('More than 1, up to 2 hours'));
    await step(6, async () => undefined);
    let partWay = null;
    let partWayId = null;
    for (let i = 0; i < 30 && !partWay?.responses?.['social-media-time']; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      partWayId = (await db.collection('submissions').doc(code).get()).data()?.surveyId ?? null;
      partWay = partWayId ? (await db.collection('surveys').doc(partWayId).get()).data() : null;
    }
    ok('an answer is saved as soon as it is given, before the questions are finished', partWay?.status === 'in-progress' && partWay?.responses?.['social-media-time']?.value === '1-2' && (await db.collection('submissions').doc(code).get()).data()?.version === 1, JSON.stringify(partWay?.responses ?? null));
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await step(7, async () => ok('and how often Kai uses AI chatbots, with examples, after the apps', (await page.getByRole('heading', { name: /How often does Kai use AI chatbots, like ChatGPT/ }).count()) === 1 && (await page.locator('.mpmb-quiz__em').textContent()) === 'AI chatbots'));
    await tap('Once or a few times a week');
    await step(8, () => tap('About the same'));
    await step(9, pass);
    await step(10, pass);
    await step(11, pass);
    await step(12, pass);
    await step(13, () => tap('Sometimes'));
    await step(14, async () => ok('how concerned the parent is comes near the end, after the facts', (await page.getByRole('heading', { name: /How concerned are you about Kai’s phone use\?/ }).count()) === 1));
    await tap('Somewhat');
    await page.locator('.mpmb-quiz__count', { hasText: 'Question 15 of 15' }).waitFor();
    ok('the last question is the open one, and only it says Continue', (await page.getByRole('heading', { name: /Is there anything else you’d like to tell us about Kai’s phone use\?/ }).count()) === 1 && (await page.getByRole('button', { name: 'Continue', exact: true }).count()) === 1 && (await page.getByRole('heading', { name: /Some more questions/ }).count()) === 0);
    await page.getByRole('textbox').fill('Mostly YouTube, often late at night.');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('heading', { name: /Can we have Kai’s screen time/ }).waitFor();
    ok('on the young person’s route the parent says yes from Kai’s phone, or no; never from the parent’s own phone', (await page.locator('#phone-source-child').count()) === 1 && (await page.locator('#phone-source-none').count()) === 1 && (await page.locator('#phone-source-parent').count()) === 0);
    await page.locator('#phone-source-child').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    // Back to Kai, who started the form (14 October 2026): passing the phone, or sending Kai their own link, with nothing to sign in.
    await page.locator('.mpmb-handover__link .mpmb-carryon__url').waitFor({ timeout: 60000 });
    ok('handing back to the young person also offers their own link, which needs no birthday', /\?finish=MPMB-.*&for=young&k=[A-Za-z0-9_-]{22}$/.test((await page.locator('.mpmb-handover__link .mpmb-carryon__url').innerText()).trim()) && (await page.getByText(/Kai not with you\?/).count()) === 1 && (await page.getByRole('button', { name: 'I’ve sent it: finish my part' }).count()) === 1);
    await page.getByRole('button', { name: /I’m Kai/ }).click();
    await page.getByRole('heading', { name: /Do you want to share your screen time/ }).waitFor();
    await draw(page.locator('#assent-signature'), [[0.2, 0.6], [0.5, 0.35], [0.8, 0.6]]);
    await page.getByRole('button', { name: 'Sign and continue' }).click();

    await page.getByRole('heading', { name: /Share your screen time/ }).waitFor();
    await page.locator('.mpmb-save', { hasText: 'Everything so far is saved.' }).waitFor({ timeout: 60000 });
    ok('reference code returned by submitConsent before any screenshot', /^MPMB-[A-Z2-9]{4}-[A-Z2-9]{3}$/.test(code) && (await page.locator('.mpmb-save strong').innerText()).trim() === code, code);
    let submission = (await db.collection('submissions').doc(code).get()).data();
    const kaiYes = submission ? (await db.collection('assents').doc(submission.assentId).get()).data() : null;
    // Signed (1), then where the screen time comes from and Kai's yes: one version each, or one for both when they come within the same second.
    const atScreenshots = submission?.version ?? 0;
    ok('a new version only for changes to the record (where the screen time comes from, Kai’s yes), never for answers', Boolean(submission) && submission.kind === 'consent' && atScreenshots >= 2 && atScreenshots <= 3 && submission.versions?.length === atScreenshots && submission.imageCount === 0 && submission.phoneSource === 'child' && kaiYes?.status === 'completed', String(atScreenshots));

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
    // 3. Once the phone is with the young person, they finish it: no check page with the parent's details, and no handing back.
    await page.getByRole('heading', { name: /Nearly done, Kai\./ }).waitFor({ timeout: 90000 });
    ok('after their part, the young person finishes and sends it: no handing the phone back, no parent’s details shown', (await page.getByText(/send your answer and your screenshots/).count()) === 1 && (await page.getByRole('button', { name: /Change parent or carer/i }).count()) === 0 && (await page.getByText('1 Long Lane').count()) === 0);
    await page.locator('.mpmb-save', { hasText: 'Everything so far is saved.' }).waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.getByRole('heading', { name: /^Thank you\.$/ }).waitFor({ timeout: 30000 });
    ok('thank-you page shows the same reference', (await page.locator('.mpmb-done__ref strong').innerText()).trim() === code);
    ok('no browser errors', errors.length === 0, errors.join(' | '));

    // What did the functions store?
    submission = (await db.collection('submissions').doc(code).get()).data();
    ok('browser uploaded both images and submitDonation accepted them: two images and one donation, with no new version for the screenshots', submission.version === atScreenshots && submission.imageCount === 2 && submission.donationIds?.length === 1 && submission.versions?.length === submission.version, String(submission.version));
    ok('the permission is not copied for later saves: the record still points at the one signed', submission.consentId === firstConsentId);
    const participant = (await db.collection('participants').doc(submission.participantId).get()).data();
    ok('participant record holds identity, with the home address and postcode', participant?.firstName === 'Kai' && participant?.dateOfBirth === '2013-03-14' && participant?.guardian?.email === 'priya@example.com' && participant?.guardian?.phone === null && participant?.guardian?.address === '1 Long Lane, Leeds' && participant?.guardian?.postcode === 'LS6 1AB' && participant?.guardian?.hasParentalResponsibility === undefined && participant?.version === submission.version, JSON.stringify({ guardian: participant?.guardian, version: participant?.version }));
    const consents = await db.collection('consents').where('participantId', '==', submission.participantId).get();
    const consent = (await db.collection('consents').doc(submission.consentId).get()).data();
    ok('one permission record, from the moment of signing', consents.size === 1 && consent?.version === 1 && consent?.supersedes === null);
    ok('permission record complete, with no choices in it; the screen time from the young person’s phone', !consent?.responses?.['phone-use'] && !consent?.responses?.recontact && consent?.responses?.answers?.via === 'group' && !consent?.responses?.['link-records'] && !consent?.responses?.['take-part'] && consent?.signature?.image?.path?.startsWith('signatures/') && submission.phoneSource === 'child' && submission.selfConsent === false);
    ok('consent record has server receipt time', consent?.receivedAt && consent?.createdAt);
    const assent = (await db.collection('assents').doc(submission.assentId).get()).data();
    ok('assent record signed, screenshot agreement by action', assent?.status === 'completed' && assent?.responses?.['take-part']?.via === 'signature' && assent?.responses?.['phone-use']?.via === 'action');
    const survey = (await db.collection('surveys').doc(submission.surveyId).get()).data();
    const surveys = await db.collection('surveys').where('participantId', '==', submission.participantId).get();
    const quick = surveys.docs.filter((doc) => doc.data().formId === 'mpmb-parent-perceptions');
    const more = surveys.docs.filter((doc) => doc.data().formId === 'mpmb-parent-phone-use');
    ok('parent’s longer questions kept in their own record, answered in the same set as the quick ones', more.length === 1 && more[0].id === submission.moreSurveyId && more[0].data().status === 'completed' && more[0].data().responses?.['own-phone-age']?.value === '12' && more[0].data().responses?.['social-media-age']?.value === '11' && more[0].data().formVersion === '0.8-draft' && more[0].data().responses?.['ai-use']?.value === 'weekly', JSON.stringify({ n: more.length, id: submission.moreSurveyId ?? null }));
    ok('parent’s questions stored as research data without names, in one record that the answers filled as they came', survey && !JSON.stringify(survey).includes('Patel') && survey.status === 'completed' && survey.responses?.concern?.value === 'somewhat' && survey.responses?.['anything-else']?.value === 'Mostly YouTube, often late at night.' && survey.responses?.['social-media-time']?.value === '1-2' && Object.keys(survey.responses).length === 5 && survey.version === submission.version && quick.length === 1 && submission.surveyId === partWayId && quick[0].id === submission.surveyId, JSON.stringify({ version: survey?.version, n: quick.length, same: submission.surveyId === partWayId }));
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
    ok('one signature image each, for the parent and the young person, however many saves', sigs.length === 2, `${sigs.length} files`);
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

    // The anonymous usage counter: a page view arrives as a text/plain beacon from the site, and nothing else gets in.
    const usageUrl = `http://127.0.0.1:5001/${PROJECT}/europe-west2/usage`;
    const beacon = { v: 1, view: 'e2etestview00001', seq: 0, final: true, page: '/information/', query: { who: 'parent', code: 'MP0123456789AB' }, ref: 'ext:www.google.com', device: 'phone', app: null, variant: null, active: 75, scroll: 80, parts: { about: 20, share: 15, 'taking-part': 40 }, order: ['about', 'share', 'taking-part'], events: [{ t: 30, type: 'click', part: 'share', to: '/take-part/consent/?who=parent', label: 'Share screen time online →' }] };
    const beaconHeaders = { 'Content-Type': 'text/plain;charset=UTF-8', Origin: 'https://myphonemybrain.com' };
    const sentBeacon = await fetch(usageUrl, { method: 'POST', headers: beaconHeaders, body: JSON.stringify(beacon) });
    const strangerBeacon = await fetch(usageUrl, { method: 'POST', headers: { ...beaconHeaders, Origin: 'https://elsewhere.example' }, body: JSON.stringify({ ...beacon, view: 'e2etestview00002' }) });
    const junkBeacon = await fetch(usageUrl, { method: 'POST', headers: beaconHeaders, body: '{"v":1,"view":"x"}' });
    const storedView = (await db.collection('usage').doc('e2etestview00001').get()).data();
    ok(
      'the usage counter stores a page view sent as a beacon (no codes, no address), and refuses other sites and junk',
      sentBeacon.status === 204 && strangerBeacon.status === 403 && junkBeacon.status === 400 && storedView?.page === '/information/' && storedView?.events?.length === 1 && JSON.stringify(storedView?.query) === '{"who":"parent"}' && !JSON.stringify(storedView).includes('MP0123') && !(await db.collection('usage').doc('e2etestview00002').get()).exists,
    );

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
    ok('export ran and counted the records', exportRes.status === 200 && manifest.counts?.participants === 1 && manifest.counts?.consents === 1 && manifest.counts?.sessions === 1 && manifest.counts?.screenshots === 2 && manifest.counts?.signatures === 2 && manifest.counts?.enquiries === 1, JSON.stringify(manifest.counts));
    ok('BIDS dataset is de-identified and labelled sub-00001', description.BIDSVersion && participantsTsv.startsWith('participant_id\tage\t') && participantsTsv.includes('sub-00001\t13\tYear 8\tDUA') && !participantsTsv.includes('Patel') && phenotypeTsv.includes('sub-00001\tsomewhat') && !phenotypeTsv.includes('Patel') && !behTsv.includes('Patel'));
    ok('identifying folder holds the key, with the address, and the statements, with no choices among them', keyTsv.includes('sub-00001\t') && keyTsv.includes('Kai\tPatel') && keyTsv.includes('1 Long Lane, Leeds') && statementsTsv.includes('sub-00001\t1\tanswers\t') && !statementsTsv.includes('\trecontact\t') && !statementsTsv.includes('\tphone-use\t'));
    ok('screenshots sit under sourcedata and signatures under identifying, named by label and session', exportedNames.filter((n) => n.startsWith('schools/donations/sourcedata/sub-00001/ses-01/sub-00001_ses-01_task-screentime_run-0')).length === 2 && exportedNames.filter((n) => n.startsWith('schools/identifying/signatures/sub-00001/sub-00001_')).length === 2 && exportedNames.includes('schools/donations/sub-00001/sub-00001_sessions.tsv') && exportedNames.includes('schools/donations/README') && exportedNames.includes('schools/README.md') && exportedNames.includes('manifest.json') && exportedNames.every((n) => n === 'README.md' || n === 'manifest.json' || n === 'DATA HEALTH.txt' || n === 'data-health.json' || n.startsWith('schools/') || n.startsWith('social-media-break/') || n.startsWith('website-usage/')));
    const healthNote = exportedNames.includes('DATA HEALTH.txt') ? String((await exportsBucket.file("DATA HEALTH.txt").download())[0]) : '';
    ok('the data health check is written beside the data and finds nothing wrong', healthNote.includes('Everything checks out') && (await db.collection('health').doc('latest').get()).data()?.ok === true, healthNote.slice(0, 400));
    ok('the manifest says the run is complete: nothing still to copy, nothing failed', manifest.status === 'complete' && manifest.binaryBacklog === 0 && Array.isArray(manifest.copyFailures) && manifest.copyFailures.length === 0 && manifest.unpackFailures?.length === 0 && manifest.writeFailures?.length === 0, JSON.stringify({ status: manifest.status, backlog: manifest.binaryBacklog, copyFailures: manifest.copyFailures, writeFailures: manifest.writeFailures }));
    const rerun = await (await fetch(`http://127.0.0.1:5001/${PROJECT}/europe-west2/exportNow`, { method: 'POST' })).json();
    ok('a second run copies nothing new, rewrites (almost) nothing unchanged, and keeps the mirror as it is', rerun.counts?.filesCopiedThisRun === 0 && rerun.files?.length === manifest.files?.length && rerun.counts?.filesUnchanged > 20 && rerun.counts?.filesWrittenThisRun <= 3, JSON.stringify(rerun.counts));
    const usageDaily = await readExport('website-usage/daily.tsv');
    ok('the website’s usage counts are exported in their own folder, by day and by month', usageDaily.includes('\t/information/\t') && exportedNames.some((n) => /^website-usage\/raw\/usage_\d{4}-\d{2}\.jsonl$/.test(n)) && exportedNames.includes('website-usage/README.md') && exportedNames.includes('website-usage/daily.json'), usageDaily.slice(0, 300));

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
    const agreement = { statementId: 'phone-use', version: '0.5-draft', response: 'agreed', respondedAt: new Date().toISOString(), via: 'action' };
    ok('another session cannot add screenshots to this reference', await stranger(() => httpsCallable(fns, 'submitDonation')({ referenceCode: code, platform: 'ios', uploads: [{ uploadId: '123e4567-e89b-12d3-a456-426614174000', redacted: false, cropped: false, acknowledgedWarning: false }], agreement, client })));
    // A parent who can see the young person's screen time on their own phone (Family Link): their permission is enough, and the young person is not asked.
    await page.getByRole('button', { name: /Finish and clear/ }).click();
    await page.getByRole('heading', { name: /Share screen time with MyPhone/ }).waitFor();
    await page.getByRole('button', { name: /I’m a parent or carer/ }).click();
    await page.getByLabel('First name', { exact: true }).fill('Amira');
    await page.getByLabel('Last name', { exact: true }).fill('Khan');
    await page.getByLabel('Date of birth', { exact: true }).fill('2012-09-02');
    await page.getByLabel('School', { exact: true }).selectOption('DUA');
    await page.getByLabel('Year group').selectOption('Year 9');
    await page.getByLabel('Your relationship to the young person').selectOption('mother');
    await page.getByLabel('Your home address').fill('22 Park Road, Bradford');
    await page.getByLabel('Your mobile number').fill('07700 900456');
    await page.getByLabel('Postcode').fill('BD7 1AB');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel(/I confirm all of the above/).check();
    await page.getByRole('button', { name: /I can’t draw my signature/ }).click();
    await page.getByLabel(/Type your full name as your signature/).fill('Sara Khan');
    // The parent's name is the one they sign with (it is no longer asked on the details page).
    await page.getByLabel('Your full name', { exact: true }).fill('Sara Khan');
    await page.getByRole('button', { name: 'Confirm and sign' }).click();
    await hasOwnPhone(page);
    await page.getByRole('button', { name: 'Skip these questions' }).click();
    await page.getByRole('heading', { name: /Can we have Amira’s screen time/ }).waitFor();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText('Choose an answer.').first().waitFor();
    await page.locator('#phone-source-parent').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: /Share Amira’s screen time from your phone/ }).waitFor();
    await page.locator('.mpmb-save', { hasText: 'Everything so far is saved.' }).waitFor({ timeout: 60000 });
    const code2 = (await page.locator('.mpmb-save strong').innerText()).trim();
    await page.getByRole('radio', { name: 'Android' }).check();
    ok('the instructions are for Google Family Link on the parent’s own phone', (await page.getByText(/How to find Amira’s screen time in Google Family Link/).count()) === 1);
    await page.getByRole('button', { name: 'The phone isn’t keeping track of screen time' }).click();
    ok('if the phone isn’t keeping track, it says how to turn it on and to come back in a week', (await page.getByText(/Turn it on now, and come back in a week/).count()) === 1 && (await page.getByRole('button', { name: 'I’ve turned it on: finish for now' }).count()) === 1);
    await page.getByRole('button', { name: 'The phone isn’t keeping track of screen time' }).click();
    await input.setInputFiles([{ name: 'c.png', mimeType: 'image/png', buffer: await png('Today') }]);
    await page.waitForFunction(() => document.querySelectorAll('.mpmb-upload').length === 1);
    // Left on the page without pressing Send (the page hidden: another app, the phone locked): saved anyway.
    const hidePage = () =>
      page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      });
    await hidePage();
    await page.locator('.mpmb-upload__status', { hasText: 'Saved' }).waitFor({ timeout: 90000 });
    const early = (await db.collection('submissions').doc(code2).get()).data();
    const autoRef = db.collection('donations').doc(early.donationIds[0]);
    const autoDonation = (await autoRef.get()).data();
    ok('a screenshot left on the page without pressing Send is saved on the server, marked as not sent, with no agreement', autoDonation?.savedAutomatically === true && autoDonation?.sendPressed === false && autoDonation?.images.length === 1 && autoDonation?.agreement === null && early.imageCount === 1);
    const [autoFileThere] = await getStorage().bucket().file(autoDonation.images[0].path).exists();
    // Removed after the page saved it, before Send: deleted from the server too.
    await page.getByRole('button', { name: 'Remove image 1' }).click();
    for (let i = 0; i < 60 && (await autoRef.get()).data()?.images.length; i += 1) await new Promise((r) => setTimeout(r, 500));
    const [autoFileLeft] = await getStorage().bucket().file(autoDonation.images[0].path).exists();
    ok('a saved screenshot removed before Send is deleted from the server', autoFileThere && !autoFileLeft && (await autoRef.get()).data()?.images.length === 0 && (await db.collection('submissions').doc(code2).get()).data()?.imageCount === 0);
    await input.setInputFiles([{ name: 'c.png', mimeType: 'image/png', buffer: await png('Today') }]);
    await page.waitForFunction(() => document.querySelectorAll('.mpmb-upload').length === 1);
    await page.getByRole('button', { name: /Send this screenshot/ }).click();
    await page.getByRole('heading', { name: /Check what you’ve sent/ }).waitFor({ timeout: 90000 });
    const sub2 = (await db.collection('submissions').doc(code2).get()).data();
    const assent2 = (await db.collection('assents').doc(sub2.assentId).get()).data();
    const donation2 = (await db.collection('donations').doc(sub2.donationIds.at(-1)).get()).data();
    ok('pressing Send confirms the earlier save, and the new screenshot is recorded as sent', donation2?.sendPressed === true && (await autoRef.get()).data()?.sendPressed === true && sub2.imageCount === 1);
    ok('from the parent’s own phone: no agreement asked of the young person, the screenshot recorded as from the parent’s phone', sub2?.phoneSource === 'parent' && assent2?.status === 'not-started' && donation2?.agreement === null && donation2?.from === 'parent-phone' && donation2?.youngPersonAgreedInApp === false && donation2?.images.length === 1);
    ok('no questions record when they were skipped without an answer', sub2?.surveyId && (await db.collection('surveys').doc(sub2.surveyId).get()).data()?.status === 'skipped');
    await page.getByRole('button', { name: /Everything is right/ }).click();
    await page.getByRole('heading', { name: /^Thank you\.$/ }).waitFor({ timeout: 30000 });

    // Carrying on later (often after the workshop): the parent says yes and chooses the young person's phone, but Noah isn't there;
    // later, on Noah's own phone, the link from the thank-you page and his date of birth find the record, and he adds his answer and a screenshot.
    await page.getByRole('button', { name: /Finish and clear/ }).click();
    await page.getByRole('button', { name: /I’m a parent or carer/ }).click();
    await page.getByLabel('First name', { exact: true }).fill('Noah');
    await page.getByLabel('Last name', { exact: true }).fill('Clarke');
    await page.getByLabel('Date of birth', { exact: true }).fill('2013-03-14');
    await page.getByLabel('School', { exact: true }).selectOption('GSAL');
    await page.getByLabel('Year group').selectOption('Year 9');
    await page.getByLabel('Your relationship to the young person').selectOption('father');
    await page.getByLabel('Your home address').fill('5 Mill Street, Leeds');
    await page.getByLabel('Your mobile number').fill('07700 900456');
    await page.getByLabel('Postcode').fill('LS9 8AB');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel(/I confirm all of the above/).check();
    await page.getByRole('button', { name: /I can’t draw my signature/ }).click();
    await page.getByLabel(/Type your full name as your signature/).fill('Jo Clarke');
    // The parent's name is the one they sign with (it is no longer asked on the details page).
    await page.getByLabel('Your full name', { exact: true }).fill('Jo Clarke');
    await page.getByRole('button', { name: 'Confirm and sign' }).click();
    await hasOwnPhone(page);
    await page.getByRole('button', { name: 'Skip these questions' }).click();
    await page.locator('#phone-source-child').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    // Passing the phone comes first (a link sent for later is the route most often left unfinished); the link is one tap away.
    await page.getByRole('heading', { name: 'Now it’s Noah’s turn.' }).waitFor({ timeout: 30000 });
    ok('after the parent’s part, passing the phone comes first, and no link is made until asked for', (await page.getByRole('button', { name: 'Noah is with me: pass them this phone' }).count()) === 1 && (await page.locator('.mpmb-carryon__url').count()) === 0);
    await page.getByRole('button', { name: 'Noah isn’t with me: send them a link' }).click();
    await page.locator('.mpmb-handover__link .mpmb-carryon__url').waitFor({ timeout: 60000 });
    const handoverLink = (await page.locator('.mpmb-handover__link .mpmb-carryon__url').innerText()).trim();
    ok('the handover gives a link to send Noah, to do his part on his own phone, by WhatsApp, text, email or copy', /\?finish=MPMB-.*&for=young&k=[A-Za-z0-9_-]{22}$/.test(handoverLink) && (await page.getByText(/It is just for Noah: please send it only to them/).count()) === 1 && (await page.getByRole('link', { name: 'WhatsApp' }).count()) === 1 && (await page.getByRole('link', { name: 'Text message' }).count()) === 1 && (await page.getByRole('button', { name: 'Copy the link' }).count()) === 1);
    await page.getByRole('button', { name: 'I’ve sent it: finish my part' }).click();
    await page.getByRole('heading', { name: /Check what you’ve sent/ }).waitFor();
    ok('after sending the link the parent finishes straight away: Noah can still do his part with it', (await page.getByText(/Some more questions about Noah/).count()) === 0);
    await page.locator('.mpmb-save', { hasText: 'Everything so far is saved.' }).waitFor({ timeout: 60000 });
    const noahCode = (await page.locator('.mpmb-save strong').innerText()).trim();
    ok('the link sent is Noah’s own, for this record, with a key only its hash is kept of', handoverLink.includes(`?finish=${noahCode}&for=young&k=`) && /^[0-9a-f]{64}$/.test((await db.collection('submissions').doc(noahCode).get()).data()?.youngLinkHash ?? '') && !JSON.stringify((await db.collection('submissions').doc(noahCode).get()).data()).includes(handoverLink.split('&k=')[1]));
    await page.getByRole('button', { name: /Everything is right/ }).click();
    await page.getByRole('heading', { name: /^Thank you\.$/ }).waitFor({ timeout: 30000 });
    const carryOnUrl = (await page.locator('.mpmb-carryon__url').innerText()).trim();
    ok('the thank-you page gives the link to finish, asking for it as soon as possible (never “later” or “after the workshop”)', carryOnUrl === handoverLink && (await page.getByText(/Noah still has their part to do\. Nothing from Noah’s phone has been sent yet\. Please ask them to do it as soon as possible/).count()) === 1 && (await page.getByText(/the team will send|after the workshop/).count()) === 0, carryOnUrl);
    const noahBefore = (await db.collection('submissions').doc(noahCode).get()).data();
    const laterDevice = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const noahPage = await laterDevice.newPage();
    noahPage.on('pageerror', (e) => errors.push(e.message));
    // The plain link (from the FAQ, or with the reference) still opens "Carry on" for a parent.
    await noahPage.goto(carryOnUrl.replace(/&for=young.*$/, ''));
    await noahPage.getByRole('heading', { name: 'Carry on with your reference.' }).waitFor({ timeout: 30000 });
    ok('the plain link opens “Carry on” with the reference filled in, and leaves the address bar', (await noahPage.getByLabel('Your reference').inputValue()) === noahCode && !noahPage.url().includes('finish='), noahPage.url());
    // Noah's own link, on his own phone, opens his part with nothing to type (14 October 2026), and the key leaves the address bar.
    await noahPage.goto(carryOnUrl);
    await noahPage.getByRole('heading', { name: /Do you want to share your screen time/ }).waitFor({ timeout: 30000 });
    ok('Noah’s own link opens his part straight away: no birthday, no reference, nothing to sign in, and the key gone from the address', (await noahPage.getByLabel('Your date of birth').count()) === 0 && !noahPage.url().includes('k=') && !noahPage.url().includes('finish='), noahPage.url());
    const opened = (await db.collection('submissions').doc(noahCode).get()).data();
    ok('opening Noah’s own link is recorded, and one reminder is due 48 hours after the record was first saved', Boolean(opened?.youngLinkFirstOpenedAt) && opened?.youngLinkOpens === 1 && Math.abs(opened?.reminderDueAt?.toMillis() - opened?.createdAt?.toMillis() - 48 * 3600_000) < 60_000);
    // A link whose key is not this record's asks for the birthday instead.
    await noahPage.goto(carryOnUrl.replace(/&k=.*$/, '&k=AAAAAAAAAAAAAAAAAAAAAA'));
    await noahPage.getByText(/This link didn’t open your part/).first().waitFor({ timeout: 30000 });
    ok('a link with the wrong key opens nothing, and falls back to the birthday', (await noahPage.getByLabel('Your date of birth').count()) === 1);
    await laterDevice.clearCookies();
    await noahPage.evaluate(() => localStorage.clear());
    await db.collection('submissions').doc(noahCode).set({ resumeFailures: 0 }, { merge: true });
    // The link with no key (as sent before 14 October): it speaks to him, asks only his birthday, and goes straight to his part.
    await noahPage.goto(carryOnUrl.replace(/&k=.*$/, ''));
    await noahPage.getByRole('heading', { name: 'Hi! It’s your turn.' }).waitFor({ timeout: 30000 });
    ok('Noah’s link opens his part: only his birthday asked, the reference already in', (await noahPage.getByLabel('Your reference').count()) === 0 && (await noahPage.getByText(`Reference ${noahCode}.`).count()) === 1 && !noahPage.url().includes('finish='));
    await noahPage.getByLabel('Your date of birth').fill('2013-03-15');
    await noahPage.getByRole('button', { name: 'Carry on' }).click();
    await noahPage.getByText(/That birthday doesn’t match/).first().waitFor({ timeout: 30000 });
    ok('a wrong birthday finds nothing, and counts against the reference', (await db.collection('submissions').doc(noahCode).get()).data()?.resumeFailures === 1);
    await noahPage.getByLabel('Your date of birth').fill('2013-03-14');
    await noahPage.getByRole('button', { name: 'Carry on' }).click();
    await noahPage.getByRole('heading', { name: /Do you want to share your screen time/ }).waitFor({ timeout: 30000 });
    ok('only Noah’s part is asked: his answer, with no “decide later” and nothing of the parent’s', (await noahPage.getByRole('button', { name: 'I’d like to decide later' }).count()) === 0 && (await noahPage.getByText(/Your parent or carer has said it’s okay with them/).count()) === 1);
    await draw(noahPage.locator('#assent-signature'), [[0.2, 0.6], [0.5, 0.35], [0.8, 0.6]]);
    await noahPage.getByRole('button', { name: 'Sign and continue' }).click();
    await noahPage.locator('.mpmb-save', { hasText: 'Your answer is saved.' }).waitFor({ timeout: 60000 });
    const noahMid = (await db.collection('submissions').doc(noahCode).get()).data();
    const lateAssent = (await db.collection('assents').doc(noahMid.assentId).get()).data();
    ok('his yes is a new agreement record on the same reference, superseding the one put off', noahMid.assentId !== noahBefore.assentId && lateAssent?.status === 'completed' && lateAssent?.late === true && lateAssent?.supersedes === noahBefore.assentId && lateAssent?.participantId === noahBefore.participantId && noahMid.version === noahBefore.version + 1 && noahMid.resumeUids?.length === 1 && noahMid.resumeFailures === 0 && Boolean(lateAssent?.signature?.image?.path));
    await noahPage.getByRole('radio', { name: 'Android' }).check();
    await noahPage.locator('input[type=file]').first().setInputFiles([{ name: 'noah.png', mimeType: 'image/png', buffer: await png('Digital Wellbeing') }]);
    await noahPage.waitForFunction(() => document.querySelectorAll('.mpmb-upload').length === 1);
    await noahPage.getByRole('button', { name: /Send this screenshot/ }).click();
    await noahPage.getByRole('heading', { name: /^Thank you\.$/ }).waitFor({ timeout: 90000 });
    const noahAfter = (await db.collection('submissions').doc(noahCode).get()).data();
    const lateDonation = (await db.collection('donations').doc(noahAfter.donationIds?.[0] ?? 'x').get()).data();
    ok('his screenshot is added to the same record, marked as sent later, with his agreement', noahAfter.imageCount === 1 && lateDonation?.late === true && lateDonation?.from === 'young-person-phone' && lateDonation?.agreement?.response === 'agreed' && lateDonation?.participantId === noahBefore.participantId && Boolean(noahAfter.resumedAt) && (await noahPage.getByText(`Added to reference ${noahCode}`).count()) === 1);
    await noahPage.getByRole('button', { name: 'Finish and clear this device' }).click();
    await noahPage.getByRole('heading', { name: /Share screen time with MyPhone/ }).waitFor();
    ok('no browser errors carrying on later', errors.length === 0, errors.join(' | '));
    await laterDevice.close();

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

    // A parent who signs, then stops before saying where the screen time comes from (16 October 2026): the reminder's link finishes it.
    const yearsAgo = (n, md = '05-20') => `${new Date().getFullYear() - n}-${md}`;
    await page.evaluate(() => window.sessionStorage.clear());
    await page.goto(`http://127.0.0.1:${PORT}/index.html?who=parent&school=dua`);
    await page.getByLabel('First name', { exact: true }).fill('Ruby');
    await page.getByLabel('Last name', { exact: true }).fill('Shaw');
    await page.getByLabel('Date of birth', { exact: true }).fill(yearsAgo(13, '02-11'));
    await page.getByLabel('Year group').selectOption('Year 8');
    await page.getByLabel('Your relationship to the young person').selectOption('father');
    await page.getByLabel('Your home address').fill('3 Elm Row, Leeds');
    await page.getByLabel('Your mobile number').fill('07700 900789');
    await page.getByLabel('Postcode').fill('LS2 9JT');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel(/I confirm all of the above/).check();
    await draw(page.locator('#signature-pad'), [[0.15, 0.6], [0.4, 0.3], [0.7, 0.6]]);
    await page.getByLabel('Your full name', { exact: true }).fill('Dan Shaw');
    await page.getByRole('button', { name: 'Confirm and sign' }).click();
    await hasOwnPhone(page);
    await page.locator('.mpmb-quiz__count', { hasText: 'Question 1 of 15' }).waitFor();
    let ruby = null;
    for (let i = 0; i < 40 && !ruby; i += 1) {
      const people = await db.collection('participants').where('firstName', '==', 'Ruby').get();
      const sub = people.empty ? null : await db.collection('submissions').where('participantId', '==', people.docs[0].id).get();
      if (sub && !sub.empty) ruby = { code: sub.docs[0].id, data: sub.docs[0].data(), person: people.docs[0].data() };
      else await new Promise((r) => setTimeout(r, 500));
    }
    ok('a parent who stops after signing has their mobile on the record, and a reminder due', ruby?.person.guardian?.phone === '07700 900789' && ruby?.data.phoneSource === null && Boolean(ruby?.data.reminderDueAt));
    // Days later, from the reminder's link: one question is left, then the screenshots.
    await page.evaluate(() => window.sessionStorage.clear());
    await page.goto(`http://127.0.0.1:${PORT}/index.html?finish=${ruby.code}`);
    await page.getByLabel('The young person’s date of birth').fill(yearsAgo(13, '02-11'));
    await page.getByRole('button', { name: 'Find my record' }).click();
    await page.getByRole('heading', { name: 'Can we have Ruby’s screen time?' }).waitFor({ timeout: 30000 });
    await page.locator('#resume-source-parent').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'We found your record.' }).waitFor({ timeout: 30000 });
    ok('the link finishes an unfinished record: where the screen time comes from is saved, and the screenshots come next', (await db.collection('submissions').doc(ruby.code).get()).data()?.phoneSource === 'parent' && (await page.getByRole('button', { name: 'Add the screenshots' }).count()) === 1);
    await page.getByRole('button', { name: 'Not your record? Start again' }).click();
    await page.waitForFunction(() => !document.body.textContent.includes('We found your record.'));

    // A parent who says no to the screenshots: the quick questions, then the longer ones instead; nothing is asked of the young person.
    await page.evaluate(() => window.sessionStorage.clear());
    await page.goto(`http://127.0.0.1:${PORT}/index.html?who=parent&school=dua`);
    await page.getByLabel('First name', { exact: true }).fill('Lily');
    await page.getByLabel('Last name', { exact: true }).fill('Brown');
    await page.getByLabel('Date of birth', { exact: true }).fill(yearsAgo(14));
    await page.getByLabel('Year group').selectOption('Year 9');
    await page.getByLabel('Your relationship to the young person').selectOption('mother');
    await page.getByLabel('Your home address').fill('9 Hill View, Leeds');
    await page.getByLabel('Your mobile number').fill('07700 900456');
    await page.getByLabel('Postcode').fill('LS2 9JT');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: /Your permission: Lily’s phone use/ }).waitFor();
    await page.getByLabel(/I confirm all of the above/).check();
    await draw(page.locator('#signature-pad'), [[0.15, 0.6], [0.4, 0.3], [0.7, 0.6]]);
    // The parent's name is the one they sign with (it is no longer asked on the details page).
    await page.getByLabel('Your full name', { exact: true }).fill('Grace Brown');
    await page.getByRole('button', { name: 'Confirm and sign' }).click();
    await hasOwnPhone(page);
    await page.getByRole('heading', { name: /Some questions about .*’s phone use/ }).waitFor();
    await page.locator('.mpmb-quiz__count', { hasText: 'Getting started · Question 1 of 15' }).waitFor();
    ok('the age at their own phone goes down to “Under 5”, year by year, up to Lily’s age now (14), with “I can’t remember / I don’t know”', (await page.locator('.mpmb-quiz__option').count()) === 12 && (await page.getByRole('button', { name: '15 or older', exact: true }).count()) === 0 && (await page.getByRole('button', { name: 'They don’t have their own' }).count()) === 0 && (await page.getByRole('button', { name: 'Under 5', exact: true }).count()) === 1 && (await page.getByRole('button', { name: '7', exact: true }).count()) === 1 && (await page.getByRole('button', { name: 'I can’t remember / I don’t know', exact: true }).count()) === 1);
    await page.getByRole('button', { name: '12', exact: true }).click();
    await page.locator('.mpmb-quiz__count', { hasText: 'Question 2 of 15' }).waitFor();
    ok('the longer questions ask when they started on social media, in plain words, naming the apps', (await page.getByRole('heading', { name: /How old was Lily when they started using social media, like TikTok/ }).count()) === 1);
    await page.getByRole('button', { name: '11', exact: true }).click();
    await page.locator('.mpmb-quiz__count', { hasText: 'Question 3 of 15' }).waitFor();
    await page.getByRole('button', { name: 'More than 3, up to 4 hours', exact: true }).click();
    await page.locator('.mpmb-quiz__count', { hasText: 'Question 4 of 15' }).waitFor();
    await page.getByRole('button', { name: 'Skip this question' }).click();
    await page.locator('.mpmb-quiz__count', { hasText: 'Question 5 of 15' }).waitFor();
    await page.getByRole('button', { name: 'Skip this question' }).click();
    await page.locator('.mpmb-quiz__count', { hasText: 'Question 6 of 15' }).waitFor();
    await page.getByRole('button', { name: 'TikTok', exact: true }).click();
    await page.getByRole('button', { name: 'YouTube', exact: true }).click();
    ok('more than one app can be chosen: both stay ticked, and the question waits for Next', (await page.locator('.mpmb-quiz__count', { hasText: 'Question 6 of 15' }).count()) === 1 && (await page.getByRole('button', { name: 'TikTok', exact: true }).getAttribute('aria-pressed')) === 'true' && (await page.getByRole('button', { name: 'YouTube', exact: true }).getAttribute('aria-pressed')) === 'true');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.locator('.mpmb-quiz__count', { hasText: 'Question 7 of 15' }).waitFor();
    await page.getByRole('button', { name: 'Skip these questions' }).click();
    await page.getByRole('heading', { name: /Can we have Lily’s screen time/ }).waitFor();
    await page.locator('#phone-source-none').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: /Check what you’ve sent/ }).waitFor();
    await page.locator('.mpmb-save', { hasText: 'Everything so far is saved.' }).waitFor({ timeout: 60000 });
    const noCode = (await page.locator('.mpmb-save strong').innerText()).trim();
    const no = (await db.collection('submissions').doc(noCode).get()).data();
    const noConsent = no?.consentId ? (await db.collection('consents').doc(no.consentId).get()).data() : null;
    const noMore = no?.moreSurveyId ? (await db.collection('surveys').doc(no.moreSurveyId).get()).data() : null;
    const noAssent = no?.assentId ? (await db.collection('assents').doc(no.assentId).get()).data() : null;
    ok('after the parent’s no: no screen time, no agreement asked of the young person, and the longer answers kept, apps and all', no?.phoneSource === 'none' && no?.selfConsent === false && !noConsent?.responses?.['phone-use'] && noAssent?.status === 'not-started' && noMore?.formId === 'mpmb-parent-phone-use' && noMore?.formVersion === '0.8-draft' && noMore?.responses?.['own-phone-age']?.value === '12' && noMore?.responses?.['social-media-age']?.value === '11' && noMore?.responses?.['school-day-time']?.value === '3-4' && noMore?.responses?.['top-app']?.value === 'tiktok;youtube' && !noMore?.responses?.['weekend-time'] && !JSON.stringify(noMore).includes('Brown'), JSON.stringify({ phoneSource: no?.phoneSource, more: noMore?.responses }));
    await page.getByRole('button', { name: /Everything is right/ }).click();
    await page.getByRole('heading', { name: 'Would you share Lily’s screen time after all?' }).waitFor();
    ok('one last prompt after the parent’s no, which can stay a no', (await page.getByRole('button', { name: 'Yes, share it' }).count()) === 1);
    await page.getByRole('button', { name: 'No, finish' }).click();
    await page.getByRole('heading', { name: /^Thank you\.$/ }).waitFor({ timeout: 30000 });

    // A young person with no phone of their own (team feedback, 9 October 2026): one box on the quick questions, then straight to the check.
    await page.getByRole('button', { name: 'Finish and clear this device' }).click();
    await page.getByRole('heading', { name: /Share screen time with MyPhone/ }).waitFor();
    await page.goto(`http://127.0.0.1:${PORT}/index.html?who=parent&school=dua`);
    await page.getByLabel('First name', { exact: true }).fill('Ivy');
    await page.getByLabel('Last name', { exact: true }).fill('Green');
    await page.getByLabel('Date of birth', { exact: true }).fill(yearsAgo(12));
    await page.getByLabel('Year group').selectOption('Year 7');
    await page.getByLabel('Your relationship to the young person').selectOption('father');
    await page.getByLabel('Your home address').fill('4 Park Road, Leeds');
    await page.getByLabel('Your mobile number').fill('07700 900456');
    await page.getByLabel('Postcode').fill('LS2 9JT');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: /Your permission: Ivy’s phone use/ }).waitFor();
    await page.getByLabel(/I confirm all of the above/).check();
    await draw(page.locator('#signature-pad'), [[0.15, 0.6], [0.4, 0.3], [0.7, 0.6]]);
    await page.getByLabel('Your full name', { exact: true }).fill('Tom Green');
    await page.getByRole('button', { name: 'Confirm and sign' }).click();
    await page.getByRole('heading', { name: /First: does Ivy have a phone of their own\?/ }).waitFor();
    ok('the first question is whether the young person has a phone of their own', (await page.getByRole('button', { name: 'No, not yet' }).count()) === 1 && (await page.getByRole('button', { name: 'Yes', exact: true }).count()) === 1);
    await page.getByRole('button', { name: 'No, not yet' }).click();
    await page.getByRole('heading', { name: /Some questions about phones and social media/ }).waitFor();
    ok('without a phone, their own questions instead of the quick and the longer ones', (await page.getByRole('heading', { name: /Why doesn’t Ivy have a phone of their own\?/ }).count()) === 1);
    await page.getByRole('button', { name: 'We think they’re too young' }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.locator('.mpmb-quiz__count', { hasText: 'Question 2 of 8' }).waitFor();
    ok('when Ivy (12) will get a phone offers no age younger than Ivy is now', (await page.getByRole('button', { name: '11', exact: true }).count()) === 0 && (await page.getByRole('button', { name: '12', exact: true }).count()) === 1 && (await page.getByRole('button', { name: '16 or older', exact: true }).count()) === 1);
    await page.getByRole('button', { name: '13', exact: true }).click();
    await page.locator('.mpmb-quiz__count', { hasText: 'Question 3 of 8' }).waitFor();
    await page.getByRole('button', { name: 'Skip these questions' }).click();
    await page.getByRole('heading', { name: /Check what you’ve sent/ }).waitFor();
    await page.locator('.mpmb-save', { hasText: 'Everything so far is saved.' }).waitFor({ timeout: 60000 });
    ok('no screen-time question when there is no phone; the check page says why', (await page.getByText('Ivy doesn’t have a phone of their own, so there is no screen time to share.').count()) === 1 && (await page.getByText('Parent or carer’s quick questions').count()) === 0);
    const noPhoneCode = (await page.locator('.mpmb-save strong').innerText()).trim();
    const noPhone = (await db.collection('submissions').doc(noPhoneCode).get()).data();
    const noPhoneAnswers = noPhone?.moreSurveyId ? (await db.collection('surveys').doc(noPhone.moreSurveyId).get()).data() : null;
    ok('stored as no phone, with the no-phone answers in their own form', noPhone?.phoneSource === 'no-phone' && !noPhone?.surveyId && noPhoneAnswers?.formId === 'mpmb-parent-no-phone' && noPhoneAnswers?.responses?.['why-no-phone']?.value === 'too-young' && noPhoneAnswers?.responses?.['expected-age']?.value === '13' && noPhoneAnswers?.status === 'skipped', JSON.stringify({ source: noPhone?.phoneSource, form: noPhoneAnswers?.formId ?? null, status: noPhoneAnswers?.status }));
    await page.getByRole('button', { name: /Everything is right/ }).click();
    await page.getByRole('heading', { name: /^Thank you\.$/ }).waitFor({ timeout: 30000 });
    ok('no last prompt to share screen time when there is no phone', (await page.getByRole('heading', { name: /after all/ }).count()) === 0);

    // A 16-year-old on their own: no parent at all, their own agreement, then their screenshots.
    await page.getByRole('button', { name: 'Finish and clear this device' }).click();
    await page.getByRole('heading', { name: /Share screen time with MyPhone/ }).waitFor();
    ok('after “Finish and clear this device” the next person starts at the welcome screen, not where the parent’s link went', !page.url().includes('who=') && (await page.getByLabel('First name', { exact: true }).count()) === 0, page.url());
    await page.goto(`http://127.0.0.1:${PORT}/index.html?who=young`);
    await page.getByRole('heading', { name: 'Before you start.' }).waitFor();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.getByLabel('Your first name').fill('Noor');
    await page.getByLabel('Your last name').fill('Ahmed');
    await page.getByLabel('Your date of birth', { exact: true }).fill(yearsAgo(16, '01-15'));
    await page.getByLabel('Your school', { exact: true }).selectOption('GSAL');
    await page.getByLabel('Your year group').selectOption('Year 12');
    ok('at 16 the young person is told no parent is needed', (await page.getByText(/You are 16 or over, so you can decide for yourself/).count()) === 1);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('#child-postcode-error').waitFor();
    ok('on their own, they must give their home postcode', (await page.locator('#child-postcode-error').innerText()).includes('Type your home postcode'));
    await page.getByLabel('Your home postcode').fill('ls6 1ab');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: /Do you want to share your screen time/ }).waitFor();
    ok('no parent steps, and no “decide later” on their own', (await page.getByText(/At 16 or over, you decide for yourself/).count()) === 1 && (await page.getByRole('button', { name: 'I’d like to decide later' }).count()) === 0);
    await draw(page.locator('#assent-signature'), [[0.2, 0.6], [0.5, 0.35], [0.8, 0.6]]);
    await page.getByRole('button', { name: 'Sign and continue' }).click();
    await page.getByRole('heading', { name: /Share your screen time/ }).waitFor();
    await page.locator('.mpmb-save', { hasText: 'Everything so far is saved.' }).waitFor({ timeout: 60000 });
    const aloneCode = (await page.locator('.mpmb-save strong').innerText()).trim();
    await page.getByRole('radio', { name: 'Android' }).check();
    await page.locator('input[type=file]').first().setInputFiles([{ name: 'n.png', mimeType: 'image/png', buffer: await png('Digital Wellbeing') }]);
    await page.waitForFunction(() => document.querySelectorAll('.mpmb-upload').length === 1);
    await page.getByRole('button', { name: /Send this screenshot/ }).click();
    await page.getByRole('heading', { name: /Check what you’ve sent/ }).waitFor({ timeout: 90000 });
    const alone = (await db.collection('submissions').doc(aloneCode).get()).data();
    const aloneParticipant = alone ? (await db.collection('participants').doc(alone.participantId).get()).data() : null;
    ok('16 on their own: their postcode kept, no parent, no permission record, their own agreement, and their screenshot accepted', alone?.selfConsent === true && alone?.consentId === null && alone?.phoneSource === 'child' && alone?.imageCount === 1 && aloneParticipant?.guardian === null && aloneParticipant?.selfConsent === true && aloneParticipant?.postcode === 'LS6 1AB', JSON.stringify({ selfConsent: alone?.selfConsent, consentId: alone?.consentId, imageCount: alone?.imageCount }));
    ok('the screenshot record says it came from the young person’s own phone', (await db.collection('donations').doc(alone?.donationIds?.[0] ?? 'x').get()).data()?.from === 'young-person-phone');
    await page.getByRole('button', { name: /Everything is right/ }).click();
    await page.getByRole('heading', { name: /^Thank you\.$/ }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Finish and clear this device' }).click();

    // Opting out: two warnings, then how to email the team, with the school already in the email; the form records nothing.
    await page.goto(`http://127.0.0.1:${PORT}/index.html?optout=1&school=dua`);
    await page.getByRole('heading', { name: 'Before you opt out.' }).waitFor();
    ok('the first warning says what the young person would miss, the two ways to opt out, and that the phone part needs no opt-out', (await page.getByText(/opt your child out of the whole study, or let them take part in the workshop/).count()) === 1 && (await page.getByText(/Only worried about the phone part/).count()) === 1);
    await page.getByRole('button', { name: 'I still want to opt out' }).click();
    // Two kinds (19 October 2026): out of both, or in the workshop with the data not used.
    await page.getByRole('heading', { name: 'What would you like?' }).waitFor();
    ok('the parent chooses: in the workshop with no information used, or out of both; nothing is chosen for them', (await page.getByRole('radio').count()) === 2 && (await page.getByRole('button', { name: 'Continue' }).isDisabled()));
    await page.getByRole('radio', { name: /takes part in the workshop, but their information is not used/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Are you sure?' }).waitFor();
    ok('the warning fits the choice: in the workshop, nothing kept or used', (await page.getByText(/will take part in the workshop with their class, but none of their information will be kept or used/).count()) === 1);
    await page.getByRole('button', { name: 'Yes, don’t use their information' }).click();
    await page.getByRole('heading', { name: 'How to opt out.' }).waitFor();
    const mailto = (await page.getByRole('link', { name: 'Write the email' }).getAttribute('href')) ?? '';
    ok('then how to email the team, saying which, with the school already in the email', mailto.startsWith('mailto:brainpop@leeds.ac.uk?subject=Opt%20out%20of%20data%20use') && decodeURIComponent(mailto).includes('can take part in the MyPhone/MyBrain workshop at school, but please do not keep or use any of their information') && decodeURIComponent(mailto).includes('Their school: Dixons Unity Academy'), mailto.slice(0, 80));
    ok('the opt-out pages record nothing', (await db.collection('optOuts').get()).size === 0);
    await page.getByRole('button', { name: 'Back to the start' }).click();
    await page.getByRole('heading', { name: /Share screen time with MyPhone/ }).waitFor();
    ok('no browser errors on the other routes and the opt-out pages', errors.length === 0, errors.join(' | '));

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
    const staffOverview = (await staffCall({ action: 'overview' })).data;
    ok('the staff overview says when the data export last ran, from its manifest', typeof staffOverview.lastExportAt === 'string' && Date.now() - Date.parse(staffOverview.lastExportAt) < 3600000, String(staffOverview.lastExportAt));
    const usageSummary = (await staffCall({ action: 'usage', days: 7 })).data;
    const infoUsage = usageSummary.pages.find((p) => p.page === '/information/');
    ok('the staff page sums up how the website is used: parts read in order, links followed', usageSummary.views >= 1 && infoUsage?.parts.map((p) => p.part).join() === 'about,share,taking-part' && infoUsage?.clicks[0]?.count === 1 && infoUsage?.sources[0]?.ref === 'ext:www.google.com');
    ok('a client cannot read the usage records', await denied(() => getDoc(doc(webDb, 'usage', 'e2etestview00001'))));
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
    ok('nobody can book without consent on file', await stranger(() => httpsCallable(fns, 'bookLabSlot')({ participantCode: 'MP33CE17327FF2', visits: [{ visit: 1, slotId: 'abc' }, { visit: 2, slotId: 'def' }], email: 'x@example.com', mobile: '07700 900123', smsReminders: false, client })));
    const icsStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

    await page.goto(`http://127.0.0.1:${PORT}/lab.html`);
    await page.getByRole('heading', { name: /Take part in the social media break study/ }).waitFor();
    await snap('welcome');
    ok('the first page has two equal ways in: new to the study, or already started', (await page.getByRole('button', { name: 'New to the study' }).count()) === 1 && (await page.getByRole('button', { name: 'Already started?' }).count()) === 1);
    await page.getByRole('button', { name: 'New to the study' }).click();
    ok('four details are asked for the ID, as the survey platform asks: first name, last name, date of birth, postcode', (await page.getByLabel('First name').count()) === 1 && (await page.getByLabel('Last name').count()) === 1 && (await page.getByLabel('Date of birth').count()) === 1 && (await page.getByLabel('Postcode').count()) === 1 && (await page.getByLabel(/house number|mother/i).count()) === 0);
    await page.getByLabel('First name').fill('Jane');
    await page.getByLabel('Last name').fill('Smith');
    await page.getByLabel('Date of birth').fill('2010-03-14');
    await page.getByLabel('Postcode').fill('ls2');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText('Enter a full UK postcode, such as LS2 9JT.').first().waitFor();
    ok('half a postcode and an under-18 date of birth are refused', (await page.getByText(/you need to be 18 or over/).count()) >= 1);
    ok('the mobile number is asked for with the four details, and is required', (await page.getByText('Enter your mobile number, so the team can contact you.').count()) >= 1);
    await page.getByLabel('Mobile number').fill('07700 900123');
    await page.getByLabel('Date of birth').fill('2005-03-14');
    await page.getByLabel('Postcode').fill('ls29jt');
    await page.getByLabel('Postcode').blur();
    ok('the postcode is tidied into its standard form', (await page.getByLabel('Postcode').inputValue()) === 'LS2 9JT');
    // Over 24: someone new is refused once the details show they are not signed up already.
    await page.getByLabel('Date of birth').fill('1999-05-01');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText(/This study is for people aged 18 to 24, so you can’t sign up/).first().waitFor({ timeout: 30000 });
    ok('a new sign-up older than 24 is refused from the date of birth', (await page.getByRole('heading', { name: /What taking part involves/ }).count()) === 0 && !(await db.collection('labParticipants').get()).docs.length);
    await page.getByLabel('Date of birth').fill('2005-03-14');
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
    const signUpContact = (await db.collection('labContacts').doc('MP2670FF90A5F2').get()).data();
    ok('the mobile number from sign-up is kept with the contact details (international form, texts on), not in the consent', signUpContact?.mobile === '+447700900123' && signUpContact?.smsReminders === true && !signUpContact?.email && !/7700 ?900 ?123/.test(JSON.stringify(labConsent ?? {})), JSON.stringify(signUpContact));
    ok('lab consent record complete, every statement agreed, drawn signature under signatures/lab/', labConsent?.typedName === 'Jane Smith' && Object.keys(labConsent?.responses ?? {}).length === 9 && labConsent?.responses?.['data-kept']?.response === 'agreed' && labConsent?.responses?.['link-records']?.response === 'declined' && labConsent?.signature?.image?.path?.startsWith('signatures/lab/MP2670FF90A5F2/') && labConsent?.formVersion === '2.1-draft' && labConsent?.informationVersion === '2.2');
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

    // With the data in, MyStory comes next (20 October 2026), then the lab visits: both are booked together.
    ok('the summary offers MyStory next once the data is in, before the lab visits', (await page.getByRole('heading', { name: 'Tell MyStory your story.' }).count()) === 1 && (await page.getByRole('heading', { name: 'Book your two lab visits.' }).count()) === 0);
    const bookingOptionsNow = await httpsCallable(fns, 'labBookingOptions')({ participantCode: 'MP2670FF90A5F2' }).then((r) => r.data, () => null);
    ok('the server holds booking back until MyStory is told', JSON.stringify(bookingOptionsNow?.missing) === JSON.stringify(['your MyStory']), JSON.stringify(bookingOptionsNow?.missing));
    await page.getByRole('button', { name: 'Tell my story' }).click();
    await page.getByRole('heading', { name: 'A short chat before your break.', level: 1 }).waitFor({ timeout: 30000 });
    ok('MyStory is a chat with Remi: no way to skip it, and no written form instead while the chat works', (await page.getByRole('button', { name: 'Start the chat' }).count()) === 1 && (await page.getByRole('button', { name: /Not now|Skip this time/ }).count()) === 0 && (await page.getByRole('button', { name: /Write your story yourself|rather write/ }).count()) === 0);
    // The written form, for when the chat cannot run: switched off here so the form is tested too.
    await db.collection('meta').doc('e2e').set({ storyChatOff: true });
    await page.getByRole('button', { name: 'Start the chat' }).click();
    await page.getByRole('heading', { name: 'Your phone, before the break', level: 1 }).waitFor({ timeout: 30000 });
    await page.locator('#story-prompt-evening').check();
    await page.locator('#story-text').fill('Most evenings I scroll in bed until late, then feel tired the next day.');
    await page.locator('#story-title').fill('Late nights');
    await page.getByRole('button', { name: 'Send my story' }).click();
    await page.getByRole('heading', { name: 'Thank you. Your story is saved.' }).waitFor({ timeout: 30000 });
    await db.collection('meta').doc('e2e').delete();
    const preStory = (await db.collection('labStories').where('phase', '==', 'pre').get()).docs.map((d) => d.data())[0];
    ok('MyStory before the break is filed under the before-break phase', preStory?.participantCode === 'MP2670FF90A5F2' && preStory?.structureId === 'mystory-pre' && preStory?.title === 'Late nights' && preStory?.source === 'baseline');
    await page.getByRole('button', { name: 'Book my lab visits' }).click();
    await page.getByRole('heading', { name: 'Book your two lab visits.', level: 1 }).waitFor({ timeout: 30000 });
    await page.locator('#lab-slot-1 .mpmb-slots__time').first().waitFor({ timeout: 30000 });
    ok('only the times for a first visit are offered first, by day; the second waits for it', (await page.locator('#lab-slot-1 .mpmb-slots__time').count()) === 2 && (await page.locator('#lab-slot-1 .mpmb-slots__day').count()) === 2 && (await page.getByText('Choose your first visit, and the times for your second appear here.').count()) === 1);
    await page.getByRole('button', { name: 'Book both visits' }).click();
    await page.getByText('Choose a time for your first visit.').first().waitFor();
    ok('booking without times or an email is held back with reasons; the mobile from sign-up is kept, not asked again', (await page.getByText(/Enter your email address, so we can send you the details/).count()) >= 1 && (await page.getByText(/Choose your first visit, then a time for your second/).count()) >= 1 && (await page.getByLabel(/Mobile number/).count()) === 0 && (await page.getByText(/Your mobile number ends in 123/).count()) === 1);
    await page.locator('#lab-slot-1 .mpmb-slots__time').first().click();
    await page.locator('#lab-slot-2 .mpmb-slots__time').first().waitFor({ timeout: 30000 });
    ok('the second visit offers only the times 30 to 35 days after the first chosen, once the break is over', (await page.locator('#lab-slot-2 .mpmb-slots__time').count()) === 2 && (await page.getByText(/It is once your 30-day break is over: 30 to 35 days after the first: between/).count()) === 1);
    await page.locator('#lab-slot-2 .mpmb-slots__time').first().click();
    await page.getByLabel('Email address').fill('jane@example.com');
    ok('no choice about texts: the page says what messages will come, the daily ones asking nothing except on day 15', (await page.locator('#lab-sms').count()) === 0 && (await page.getByText(/We will also send you a short message every day. No action is needed for these daily messages, except on day 15/).count()) === 1);
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
    ok('once told, the summary no longer offers MyStory', (await page.locator('.mpmb-mystory').count()) === 0);

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
    await again.getByRole('button', { name: 'Already started?' }).click();
    await again.getByRole('heading', { name: 'Carry on where you left off.' }).waitFor();
    ok('coming back, the mobile number is not asked again', (await again.getByLabel('Mobile number').count()) === 0);
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
    ok('the check-in needs a screenshot', (await page.getByText(/Add a screenshot of your screen time for the past week/).count()) >= 1);
    for (const [q, v] of [['week', '2'], ['apps-used', 'once-or-twice'], ['mood', '4'], ['difficulty', '3'], ['missed', '2']]) await page.locator(`#lab-q-${q}-${v}`).check();
    await page.locator('#lab-q-notes').fill('Brick held up fine.');
    await page.locator('input[type=file]').first().setInputFiles([{ name: 'week2.png', mimeType: 'image/png', buffer: await png('This week') }]);
    await page.waitForFunction(() => document.querySelectorAll('.mpmb-shots li').length === 1);
    await snap('checkin');
    await page.getByRole('button', { name: 'Send my check-in' }).click();
    // MyStory follows the check-in, required (20 October 2026): the chat with Remi, no skip.
    await page.getByRole('heading', { name: 'A short chat about your break.', level: 1 }).waitFor({ timeout: 90000 });
    ok('after the check-in, MyStory is the chat with Remi, with no way to skip it or write it instead', (await page.getByRole('button', { name: 'Start the chat' }).count()) === 1 && (await page.getByRole('button', { name: /rather write|Write your story yourself/ }).count()) === 0 && (await page.getByRole('button', { name: 'Skip this time' }).count()) === 0);
    await db.collection('meta').doc('e2e').set({ storyChatOff: true });
    await page.getByRole('button', { name: 'Start the chat' }).click();
    await page.getByRole('heading', { name: 'Your story this week', level: 1 }).waitFor({ timeout: 30000 });
    ok('when the chat cannot run, the written form has the mid-break questions, still with no skip', (await page.getByText(/wanted to open one of your apps/).count()) === 1 && (await page.getByRole('button', { name: 'Skip this time' }).count()) === 0);
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
    await page.getByRole('heading', { name: 'Thank you. Your story is saved.' }).waitFor({ timeout: 30000 });
    await db.collection('meta').doc('e2e').delete();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: /Your check-in has been sent/ }).waitFor({ timeout: 30000 });
    ok('after the check-in, support is signposted, the visits still to come are shown, and there is no second check-in', (await page.getByText(/Samaritans/).count()) === 1 && (await page.locator('.mpmb-visits-card').innerText()).includes('Second lab visit') && (await page.getByRole('button', { name: 'Start another check-in' }).count()) === 0);
    await snap('checkin-done');
    const midStory = (await db.collection('labStories').where('participantCode', '==', 'MP2670FF90A5F2').where('phase', '==', 'mid').get()).docs.map((d) => d.data())[0];
    const pull = midStory?.answers?.pull;
    ok('the story is filed under the code and phase: prompt, title, the triangle leaning to Habit, the slider moved, a "not sure", a choice', midStory?.phase === 'mid' && midStory?.structureId === 'mystory-mid' && midStory?.promptId === 'pull' && midStory?.title === 'The bus' && midStory?.source === 'checkin' && typeof midStory?.checkInId === 'string' && pull && pull.a > 0.5 && Math.abs(pull.a + pull.b + pull.c - 1) < 0.002 && midStory?.answers?.hard === 70 && midStory?.answers?.afterwards === 'na' && midStory?.answers?.where === 'travelling' && !('feeling' in (midStory?.answers ?? {})), JSON.stringify(midStory?.answers));
    const labP3 = (await db.collection('labParticipants').doc('MP2670FF90A5F2').get()).data();
    const checkIn = labP3?.checkInIds?.length ? (await db.collection('labCheckIns').doc(labP3.checkInIds[0]).get()).data() : null;
    ok('the check-in is filed under the code with its answers', checkIn?.participantCode === 'MP2670FF90A5F2' && checkIn?.number === 1 && checkIn?.answers?.week === '2' && checkIn?.answers?.['apps-used'] === 'once-or-twice' && checkIn?.answers?.notes === 'Brick held up fine.' && checkIn?.formVersion === '0.1-draft' && labP3?.checkInCount === 1, JSON.stringify(checkIn?.answers));
    // One check-in each: answers sent again join the first one.
    const againCheckIn = await httpsCallable(fns, 'submitLabCheckIn')({ participantCode: 'MP2670FF90A5F2', formId: checkIn?.formId, formVersion: checkIn?.formVersion, answers: { ...checkIn?.answers, week: '3' }, client }).then((r) => r.data, () => null);
    ok('a second check-in is not filed: it joins the first', againCheckIn?.checkInId === labP3?.checkInIds?.[0] && (await db.collection('labParticipants').doc('MP2670FF90A5F2').get()).data()?.checkInCount === 1, JSON.stringify(againCheckIn));
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
    ok('after the break, TikTok is ticked off, and MyStory comes next', (await page.getByText('Every app you use is ticked off. Thank you.').count()) === 1 && (await page.getByRole('heading', { name: 'Tell MyStory your story.' }).count()) === 1);
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

    // The booking page on its own, later, on a device that knows nothing: signing in with the participant ID typed from an email;
    // both visits; move the second without typing the email again, cancel both, then book both again with a new email address.
    const later = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const bookPage = await later.newPage();
    bookPage.on('pageerror', (e) => errors.push(e.message));
    await bookPage.goto(`http://127.0.0.1:${PORT}/lab.html?flow=book`);
    await bookPage.getByRole('heading', { name: 'Book or change your lab visits.', level: 1 }).waitFor();
    await bookPage.getByRole('button', { name: 'Use my participant ID instead' }).click();
    await bookPage.getByLabel('Participant ID').fill('MP0000000000AB');
    await bookPage.getByRole('button', { name: 'Continue' }).click();
    await bookPage.getByText(/We could not find anyone with participant ID MP0000000000AB/).waitFor({ timeout: 30000 });
    await bookPage.getByLabel('Participant ID').fill(' mp2670 ff90a5f2 ');
    await bookPage.screenshot({ path: path.join(root, 'dist-emulator', 'lab-id-signin.png'), fullPage: true });
    await bookPage.getByRole('button', { name: 'Continue' }).click();
    await bookPage.getByRole('heading', { name: 'Your lab visits.', level: 1 }).waitFor({ timeout: 30000 });
    await bookPage.locator('.mpmb-visit').nth(1).waitFor({ timeout: 30000 });
    ok('on a new device the typed participant ID (any case, spaces) finds the visits; a wrong one is refused', (await bookPage.locator('.mpmb-visit').count()) === 2 && (await bookPage.getByRole('button', { name: 'Change my times' }).count()) === 1 && (await bookPage.getByRole('button', { name: 'Cancel your visits' }).count()) === 1);
    await bookPage.screenshot({ path: path.join(root, 'dist-emulator', 'lab-book-page.png'), fullPage: true });
    await bookPage.getByRole('button', { name: 'Change my times' }).click();
    await bookPage.getByRole('heading', { name: 'Change your lab visit times.', level: 1 }).waitFor();
    ok('changing starts from the current times, kept, and the contact details on file are kept without typing them again', (await bookPage.locator('#lab-slot-1 input[value="keep"]').isChecked()) && (await bookPage.locator('#lab-slot-2 input[value="keep"]').isChecked()) && (await bookPage.getByLabel('Email address').count()) === 0 && (await bookPage.getByLabel(/Mobile number/).count()) === 0 && (await bookPage.getByText('We will email the new times to j•••@example.com, the address you gave before.').count()) === 1 && (await bookPage.getByText(/Your mobile number ends in 123/).count()) === 1);
    await bookPage.getByRole('button', { name: 'Save my times' }).click();
    await bookPage.getByText('Choose a new time for at least one visit, or keep your current times.').first().waitFor();
    ok('the second visit can move to the other time in its window, not the one too late', (await bookPage.locator('#lab-slot-2 .mpmb-slots__time').count()) === 2);
    await bookPage.locator('#lab-slot-2 .mpmb-slots__time').nth(1).click();
    await bookPage.getByRole('button', { name: 'Save my times' }).click();
    await bookPage.getByText(/Changed: your second lab visit/).first().waitFor({ timeout: 30000 });
    const afterMove = await bookingsOf();
    const moved = afterMove.find((b) => b.visit === 2 && b.status === 'booked');
    const old2 = afterMove.find((b) => b.id === v2.id);
    ok('a move cancels the old booking, points it at the new one, frees its time, and leaves the first visit alone', old2?.status === 'cancelled' && old2?.replacedBy === moved?.id && moved?.replaces === v2.id && moved?.sequence === 1 && (await db.collection('labSlots').doc(v2.slotId).get()).data()?.booked === 0 && afterMove.find((b) => b.id === v1.id)?.status === 'booked');
    const keptContact = (await db.collection('labContacts').doc('MP2670FF90A5F2').get()).data();
    ok('the move kept the contact on file as it was', keptContact?.email === 'jane@example.com' && keptContact?.mobile === '+447700900123' && keptContact?.smsReminders === true && !keptContact?.addressChanges, JSON.stringify(keptContact));
    ok('the change was confirmed by email to the address on file', (await bookPage.getByText(/We have emailed the details|we could not email you just now/).count()) >= 1 && moved?.confirmation?.email === 'not-configured');
    await bookPage.getByRole('button', { name: 'Cancel your visits' }).click();
    await bookPage.getByRole('button', { name: 'Yes, cancel them' }).click();
    await bookPage.getByText(/Your lab visits are cancelled\. We have emailed you to confirm/).first().waitFor({ timeout: 30000 });
    const afterCancel = await bookingsOf();
    ok('cancelling cancels both, frees the times and records who cancelled', afterCancel.every((b) => b.status === 'cancelled') && afterCancel.find((b) => b.id === moved.id)?.cancelledBy === 'participant' && afterCancel.find((b) => b.id === v1.id)?.cancellation?.email === 'not-configured' && (await db.collection('labSlots').doc(moved.slotId).get()).data()?.booked === 0 && (await db.collection('labSlots').doc(v1.slotId).get()).data()?.booked === 0);
    await bookPage.getByRole('heading', { name: 'Book your two lab visits.', level: 1 }).waitFor({ timeout: 30000 });
    await bookPage.locator('#lab-slot-1 .mpmb-slots__time').first().click();
    await bookPage.locator('#lab-slot-2 .mpmb-slots__time').first().click();
    await bookPage.getByRole('button', { name: 'Use a different email address' }).click();
    await bookPage.getByLabel('Email address').fill('jane.smith@example.org');
    await bookPage.getByRole('button', { name: 'Book both visits' }).click();
    await bookPage.getByText(/Booked: your two lab visits/).first().waitFor({ timeout: 30000 });
    const newContact = (await db.collection('labContacts').doc('MP2670FF90A5F2').get()).data();
    ok('a new email address replaces the old one, and the old one is told (not set up here)', newContact?.email === 'jane.smith@example.org' && newContact?.mobile === '+447700900123' && newContact?.addressChanges?.length === 1 && newContact.addressChanges[0].from === 'jane@example.com' && newContact.addressChanges[0].told === 'not-configured', JSON.stringify(newContact?.addressChanges));
    ok('no browser errors on the booking page signed in by ID', errors.length === 0, errors.join(' | '));
    await later.close();
    v1 = (await bookingsOf()).find((b) => b.visit === 1 && b.status === 'booked');
    ok('booking again gives each visit a newer calendar entry, so calendars update the same event', v1?.start?.toDate().getTime() === v1a.getTime() && v1?.sequence === 2, String(v1?.sequence));

    // The quarter-hourly messages, run at chosen moments: the reminders the day before, then the daily messages and the check-in on day 15.
    const runMessages = async (at) => (await fetch(`http://127.0.0.1:5001/${PROJECT}/europe-west2/labMessagesNow?at=${encodeURIComponent(at.toISOString())}`, { method: 'POST' })).json();
    await runMessages(new Date(v1a.getTime() - 23 * 3600000));
    const reminded = (await db.collection('labBookings').doc(v1.id).get()).data()?.reminders ?? {};
    ok('the day before the visit, the email and text reminders go (recorded as not-configured here), and the same-day text waits', reminded['day-before-email']?.outcome === 'not-configured' && reminded['day-before-sms']?.outcome === 'not-configured' && !reminded['same-day-sms'], JSON.stringify(reminded));
    await runMessages(new Date(v1a.getTime() - 23 * 3600000 + 60000));
    ok('a second run sends nothing twice', Object.keys((await db.collection('labBookings').doc(v1.id).get()).data()?.reminders ?? {}).length === 2);
    await runMessages(new Date(v1a.getTime() + 7 * DAY + 30 * 60000));
    const sentMessages = (await db.collection('labParticipants').doc('MP2670FF90A5F2').get()).data()?.messages ?? {};
    ok('a week into the break the day-7 message goes: a text first, and as the text could not go (the emulator sends none), an email instead; the days missed before are skipped, never sent late', sentMessages['day-7']?.sms === 'not-configured' && sentMessages['day-7']?.email === 'not-configured' && sentMessages['day-6']?.skipped === 'skip-stale' && !sentMessages['check-in'] && Object.keys(sentMessages).length === 7, JSON.stringify(sentMessages));
    await runMessages(new Date(v1a.getTime() + 15 * DAY + 30 * 60000));
    const day15 = (await db.collection('labParticipants').doc('MP2670FF90A5F2').get()).data()?.messages ?? {};
    ok('on day 15 the check-in message goes', day15['check-in']?.email === 'not-configured' && Boolean(day15['check-in']?.dueAt), JSON.stringify(day15['check-in']));

    // MyStory on its own page, from a personal link, for after the break: the whole chat with Remi, the team's protocol (the emulator's stand-in model).
    await page.goto(`http://127.0.0.1:${PORT}/lab.html?flow=story&phase=post&code=MP2670FF90A5F2`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'A short chat about your break.', level: 1 }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Start the chat' }).click();
    await page.getByRole('dialog', { name: 'Chat with Remi' }).waitFor({ timeout: 30000 });
    const openingNow = await page.locator('.mpmb-chat__bubble--bot').count();
    const dotsNow = await page.locator('.mpmb-chat__typing').count();
    await page.locator('.mpmb-chat__bubble--bot').nth(2).waitFor({ timeout: 30000 });
    ok('Remi’s opening messages arrive one at a time, after the “…”, not all at once', openingNow < 3 && dotsNow === 1, JSON.stringify({ openingNow, dotsNow }));
    ok('the chat fills the screen, like a messaging app, with Help in the bar', await page.evaluate(() => { const r = document.querySelector('.mpmb-chatapp')?.getBoundingClientRect(); return !!r && r.top === 0 && Math.abs(r.height - window.innerHeight) < 2 && Math.abs(r.width - window.innerWidth) < 2; }) && (await page.getByRole('button', { name: 'Help' }).count()) === 1);
    await page.getByRole('button', { name: 'Help' }).click();
    ok('Help shows the support numbers without leaving the chat', (await page.getByRole('note', { name: 'Where to get help' }).innerText()).includes('Samaritans 116 123'));
    await page.getByRole('button', { name: 'Back to the chat' }).click();
    const chatLog = page.getByRole('log', { name: 'Your chat with Remi' });
    ok('Remi introduces itself as an AI, from the team’s protocol file, with no {first_name} left over when the name is not known, then asks the first after-break question', (await chatLog.innerText()).includes('Hi, I\'m Remi. I\'m an AI bot') && !(await chatLog.innerText()).includes('{first_name}') && (await chatLog.innerText()).includes('How has the 30 days off social media been for you?'), (await chatLog.innerText()).slice(0, 300));
    await page.locator('#chat-input').fill('Mostly the quiet evenings, I think.');
    await snap('mystory-chat-interview');
    await page.locator('#chat-input').fill('');
    const chatAnswers = ['The quiet evenings stood out the most.', 'I slept better and talked to my flatmates more.', 'Going back on felt strange and a bit boring.', 'Easier than I expected, honestly.', 'I will keep my phone out of the bedroom.'];
    for (const [i, answer] of chatAnswers.entries()) {
      if (i === 2) {
        // The third answer spoken, as in MySelf: tap the microphone, talk, tap again; the words land in the box to check, then send.
        ok('an empty reply box offers the microphone', (await page.getByRole('button', { name: 'Speak your answer' }).count()) === 1);
        await page.getByRole('button', { name: 'Speak your answer' }).click();
        await page.getByRole('timer').waitFor({ timeout: 15000 });
        await page.waitForTimeout(1500);
        await snap('mystory-chat-recording');
        ok('while recording: a timer, a live waveform, a way to cancel, and a button to stop and send', (await page.locator('.mpmb-chat__rec-wave i').count()) > 0 && (await page.getByRole('button', { name: 'Cancel' }).count()) === 1 && (await page.getByRole('button', { name: 'Stop recording and send it' }).count()) === 1);
        await page.getByRole('button', { name: 'Stop and write it down' }).click();
        await page.waitForFunction((text) => document.querySelector('#chat-input')?.value === text, answer, { timeout: 30000 });
        ok('what was said is written into the reply box, to read and correct before sending', (await page.locator('#chat-input').inputValue()) === answer);
        await page.locator('#chat-input').press('Enter');
        await chatLog.locator('.mpmb-chat__voice').first().waitFor({ timeout: 15000 });
        ok('the sent answer shows the recording as a voice note that can be played back', (await chatLog.getByRole('button', { name: 'Play your recording' }).count()) === 1);
      } else {
        await page.locator('#chat-input').fill(answer);
        await page.locator('#chat-input').press('Enter');
      }
      // Sam's next question: two introductions and the first question, then one more per answer.
      if (i < chatAnswers.length - 1) await chatLog.locator('.mpmb-chat__bubble--bot').nth(3 + i).waitFor({ timeout: 30000 });
    }
    await chatLog.getByText(/See if one of them fits you/).waitFor({ timeout: 60000 });
    const versionsNow = await page.locator('.mpmb-chat__candidate').count();
    await page.locator('#chat-candidate-2').waitFor({ timeout: 30000 });
    ok('the three versions are handed over one after another, not all at once', versionsNow < 3, String(versionsNow));
    await snap('mystory-chat-choose');
    ok('after the questions, three retellings to choose from, one per persona', (await page.locator('.mpmb-chat__candidate').count()) === 3 && (await page.locator('.mpmb-chat__candidate').nth(1).innerText()).includes('(casual)'));
    await page.locator('#chat-candidate-1').click();
    await page.getByRole('button', { name: 'This one' }).click();
    await chatLog.getByText(/How close is this to what you want to say\?/).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: '7', exact: true }).click();
    await chatLog.getByText(/What would you change about it\?/).waitFor({ timeout: 30000 });
    await page.locator('#chat-request').fill('Say it was my flatmates in Leeds.');
    await page.getByRole('button', { name: 'Ask Remi' }).click();
    await page.getByText('Here it is, rewritten. Check it reads right.').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#chat-story')?.value.includes('Say it was my flatmates in Leeds.'), null, { timeout: 30000 });
    ok('asking Remi for a change rewrites the story, with the previous version a click away', (await page.locator('#chat-story').inputValue()).includes('Say it was my flatmates in Leeds.') && (await page.getByRole('button', { name: 'Put the previous version back' }).count()) === 1);
    await page.locator('#chat-story').fill('Off the apps the evenings were quiet: I slept better and talked to my flatmates in Leeds.');
    await snap('mystory-chat');
    await page.getByRole('button', { name: 'Keep this story' }).click();
    await page.getByRole('heading', { name: 'Thank you. Your story is saved.' }).waitFor({ timeout: 30000 });
    ok('the thank-you shows the story kept, the protocol’s debrief, and the support numbers the protocol points to', (await page.locator('.mpmb-chat__story').innerText()).includes('flatmates in Leeds') && (await page.getByText('Here\'s the story you made.').count()) === 1 && (await page.getByRole('note', { name: 'Where to get help' }).innerText()).includes('Leeds Crisis Assessment Centre 0800 183 1485'));
    const postStory = (await db.collection('labStories').where('phase', '==', 'post').get()).docs.map((d) => d.data())[0];
    const postChat = postStory?.chatId ? (await db.collection('labStoryChats').doc(postStory.chatId).get()).data() : null;
    ok('the chat’s story is filed under the after-break phase, as edited, with the persona chosen and the rating', postStory?.participantCode === 'MP2670FF90A5F2' && postStory?.mode === 'chat' && postStory?.structureId === 'np.sm_abstinence_post' && postStory?.chosenPersona === 'casual' && postStory?.rating === 7 && postStory?.ending === 'edited' && postStory?.story.includes('flatmates in Leeds'), JSON.stringify({ mode: postStory?.mode, persona: postStory?.chosenPersona, ending: postStory?.ending }));
    const clip = postChat?.voiceClips?.[0];
    const [clipStored] = clip?.path ? await bucket.file(clip.path).exists() : [false];
    ok('the spoken answer is kept: the recording in storage under the conversation, with what it was written down as', postChat?.voiceClips?.length === 1 && clip?.ok === true && clip?.transcript === chatAnswers[2] && clip?.stage === 'interview' && clipStored === true, JSON.stringify(clip ?? null));
    ok('the whole conversation is kept: every turn, the answers in their own words, each model call, the change asked for and the edit', postChat?.status === 'done' && postChat?.transcript?.filter((m) => m.role === 'user').length === 5 && postChat?.extraction?.expectations_vs_experience === 'I slept better and talked to my flatmates more.' && postChat?.extraction?.taking_forward === null && postChat?.candidates?.length === 3 && postChat?.requests?.length === 1 && postChat?.edits?.length === 1 && postChat?.calls?.every((c) => c.ok && c.model === 'mock') && postChat?.calls?.length === 6 + 1 + 3 + 3 + 1 + 1 + 1 + 1, JSON.stringify({ status: postChat?.status, calls: postChat?.calls?.length }));
    ok('each retelling is checked against what was said before it is shown, and how close it is to their words is measured', postChat?.calls?.filter((c) => c.stage === 'check').length === 4 && Array.isArray(postChat?.requests?.[0]?.added) && postChat?.candidates?.every((c) => Array.isArray(c.added) && c.added.length === 0 && typeof c.similarity === 'number' && c.similarity > 0) && typeof postChat?.finalSimilarity === 'number', JSON.stringify(postChat?.candidates?.map((c) => [c.added, c.similarity])));
    // Keeping a copy (19 October 2026, from the team's testing): download, print or email; and one story for each phase.
    ok('the thank-you offers a copy of the story: download as PDF, print, email', (await page.getByRole('button', { name: 'Download as PDF' }).count()) === 1 && (await page.getByRole('button', { name: 'Print' }).count()) === 1 && (await page.getByRole('button', { name: 'Email it to me' }).count()) === 1);
    const [storyPdf] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: 'Download as PDF' }).click()]);
    const storyPdfBytes = fs.readFileSync(await storyPdf.path());
    ok('the story downloads as a PDF, named for the phase and the participant ID', storyPdf.suggestedFilename() === 'MyPhone-MyBrain-MyStory-post-MP2670FF90A5F2.pdf' && storyPdfBytes.subarray(0, 5).toString() === '%PDF-');
    await page.getByRole('button', { name: 'Email it to me' }).click();
    await page.getByLabel('Your email address').fill('jane@example.com');
    await page.getByRole('button', { name: 'Send me my story' }).click();
    await page.getByText(/The email could not be sent just now/).waitFor({ timeout: 30000 });
    const emailedStory = (await db.collection('labStories').doc(postStory.chatId).get()).data();
    ok('asking for an email copy is recorded with how it went (no email is set up here), never with the address', emailedStory?.copiesEmailed?.[0]?.outcome === 'not-configured' && !JSON.stringify(emailedStory).includes('jane@example.com'));
    ok('a participant is not offered another story for the same phase', (await page.getByRole('button', { name: 'Tell another story' }).count()) === 0);
    await page.goto(`http://127.0.0.1:${PORT}/lab.html?flow=story&phase=post&code=MP2670FF90A5F2`);
    // This browser already knows the participant, so the page may go straight there; another asks them to continue first.
    const toldHeading = page.getByRole('heading', { name: 'Your story is already in.', level: 1 });
    await Promise.race([toldHeading.waitFor({ timeout: 30000 }), page.getByRole('button', { name: 'Continue' }).waitFor({ timeout: 30000 })]);
    if (!(await toldHeading.count())) await page.getByRole('button', { name: 'Continue' }).click();
    await toldHeading.waitFor({ timeout: 30000 });
    ok('coming back to a phase whose story is in says so, with the date, and offers no chat or form', (await page.getByText(/You have already sent your story for this part of the study, on/).count()) === 1 && (await page.getByRole('button', { name: 'Start the chat' }).count()) === 0 && (await page.locator('#story-text').count()) === 0);
    // MyStory on the lab computer, for someone whose before-break story is already in (told at home before booking): it says so,
    // and the server refuses a second story for the phase whatever the page does.
    await page.goto(`http://127.0.0.1:${PORT}/lab.html?flow=story&phase=pre&at=lab&code=MP2670FF90A5F2`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Your story is already in.', level: 1 }).waitFor({ timeout: 30000 });
    ok('at the lab too, a second before-break story is not offered', (await page.getByRole('button', { name: 'Finish' }).count()) === 1 && (await page.getByRole('button', { name: 'Download as PDF' }).count()) === 0);
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.getByRole('heading', { name: 'MyStory.', level: 1 }).waitFor({ timeout: 30000 });
    const leftOver = await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith('mpmb-lab')));
    ok('Finish clears the lab computer for the next person: no ID, nothing stored', leftOver.length === 0 && page.url().endsWith('phase=pre&at=lab') && !page.url().includes('code=') && (await page.getByLabel('First name').count()) === 1, JSON.stringify(leftOver));
    const secondPre = { participantCode: 'MP2670FF90A5F2', phase: 'pre', structureId: preStory.structureId, structureVersion: preStory.structureVersion, promptId: preStory.promptId, title: 'Another one', story: 'A second story for the same part of the study, which should be refused.', answers: {}, source: 'story', checkInId: null, client };
    ok('the server refuses a second story for a phase, whatever the page does', await refused(() => httpsCallable(fns, 'submitLabStory')(secondPre), 'failed-precondition'));
    // The team's demo account may tell more than one story a phase (for testing); nobody else can.
    await db.collection('labParticipants').doc('MP9C78C162BB9F').set({ participantCode: 'MP9C78C162BB9F', consentId: 'e2e-demo-consent', archiveCount: 0, screenshotCount: 0, storyCounts: {}, storyIds: [] });
    await db.collection('meta').doc('e2e').set({ storyChatOff: true });
    for (const title of ['Demo one', 'Demo two']) {
      await page.goto(`http://127.0.0.1:${PORT}/lab.html?flow=story&phase=mid&code=MP9C78C162BB9F`);
      const startChat = page.getByRole('button', { name: 'Start the chat' });
      await Promise.race([startChat.waitFor({ timeout: 30000 }), page.getByRole('button', { name: 'Continue' }).waitFor({ timeout: 30000 })]);
      if (!(await startChat.count())) await page.getByRole('button', { name: 'Continue' }).click();
      await startChat.click();
      await page.locator('#story-prompt-pull').check();
      await page.locator('#story-text').fill(`A demo story to check the team can tell more than one (${title}).`);
      await page.locator('#story-title').fill(title);
      await page.getByRole('button', { name: 'Send my story' }).click();
      await page.getByRole('heading', { name: 'Thank you. Your story is saved.' }).waitFor({ timeout: 30000 });
    }
    await db.collection('meta').doc('e2e').delete();
    const demoStories = (await db.collection('labStories').where('participantCode', '==', 'MP9C78C162BB9F').get()).docs.length;
    ok('the demo account can tell a second story in the same phase, and is offered another', demoStories === 2 && (await page.getByRole('button', { name: 'Tell another story' }).count()) === 1, String(demoStories));
    ok('no browser errors on the booking and MyStory pages', errors.length === 0, errors.join(' | '));

    // The staff page: the key, the times, a participant's links, a school's password.
    const toolsSnap = (name) => page.screenshot({ path: path.join(root, 'dist-emulator', `tools-${name}.png`), fullPage: true });
    await page.goto(`http://127.0.0.1:${PORT}/tools.html?tool=staff`);
    await page.getByLabel('Staff key').fill('wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText('That staff key is not right.').waitFor({ timeout: 30000 });
    await page.getByLabel('Staff key').fill('emulator-staff-key');
    await page.getByRole('button', { name: 'Sign in' }).click();
    // The first tab is the dashboard (16 October 2026): how both studies are going, counts only, test accounts left out.
    await page.getByRole('heading', { name: 'Schools study: families' }).waitFor({ timeout: 30000 });
    const tileOf = async (label) => Number((await page.locator('.mpmb-dash__tile', { has: page.locator('.mpmb-dash__label', { hasText: new RegExp(`^${label}$`) }) }).locator('.mpmb-dash__value').innerText()).trim());
    const formsSaved = await tileOf('Forms saved');
    const sentTile = await tileOf('Screen time sent');
    const consentRecords = (await db.collection('submissions').where('kind', '==', 'consent').get()).docs.map((d) => d.data());
    ok('the dashboard counts the forms saved and the screen time sent, as the records say', formsSaved === consentRecords.length && sentTile === consentRecords.filter((r) => Number(r.imageCount ?? 0) > 0).length && formsSaved > 0, `${formsSaved} ${sentTile} ${consentRecords.length}`);
    ok('the schools study’s dashboard shows that study only, per school, with a table for each chart', (await page.getByRole('heading', { name: 'Social media break study' }).count()) === 0 && (await page.locator('.mpmb-table tbody tr').count()) >= 1 && (await page.getByText('Show as a table').count()) === 2 && (await page.getByRole('button', { name: 'Lab times', exact: true }).count()) === 0);
    // To look at it: MPMB_E2E_SHOTS=<folder> saves a picture of the dashboard.
    if (process.env.MPMB_E2E_SHOTS) await page.screenshot({ path: `${process.env.MPMB_E2E_SHOTS}/staff-dashboard.png`, fullPage: true });
    // The break study apart (16 October 2026): its own dashboard and tabs.
    await page.getByRole('button', { name: 'Social media break study', exact: true }).click();
    await page.getByRole('heading', { name: 'Social media break study' }).waitFor({ timeout: 30000 });
    ok('the break study has its own dashboard and tabs, with none of the families’', (await page.getByRole('heading', { name: 'Schools study: families' }).count()) === 0 && (await page.getByRole('button', { name: 'Families not finished', exact: true }).count()) === 0 && (await page.getByRole('button', { name: 'Lab times', exact: true }).count()) === 1);
    await page.getByRole('button', { name: 'Lab times', exact: true }).click();
    await page.getByRole('heading', { name: 'Add lab times' }).waitFor({ timeout: 30000 });
    ok('the staff page says when the data export last ran, not as a warning while it is recent', (await page.locator('.mpmb-tools__export').innerText()).startsWith('Data export last ran: ') && (await page.locator('.mpmb-tools__export.is-stale').count()) === 0, await page.locator('.mpmb-tools__export').innerText().catch(() => 'missing'));
    ok('the staff page lists the times with their bookings', (await page.locator('.mpmb-tools__row').count()) === 5 && (await page.getByText(/1 of 1 booked/).count()) === 2);
    await toolsSnap('times');
    // As the team did (feedback, 14 October 2026): three start times over a week, then read the list back.
    const addFrom = new Date(Date.now() + 50 * 86400000).toISOString().slice(0, 10);
    const addTo = new Date(Date.now() + 56 * 86400000).toISOString().slice(0, 10);
    await page.getByLabel('First date').fill(addFrom);
    await page.getByLabel(/Last date/).fill(addTo);
    await page.getByLabel('Start times').fill('10:00, 13:00, 15:00');
    const addLabel = await page.getByRole('button', { name: /^Add \d+ times?$/ }).innerText();
    await page.getByRole('button', { name: /^Add \d+ times?$/ }).click();
    await page.getByText(/^Added \d+ times?/).waitFor({ timeout: 30000 });
    const addedRows = await page.locator('.mpmb-tools__row strong').allInnerTexts();
    // The slots made through the page in that week (December: UK time is UTC), leaving out the 09:00 one added earlier through the service.
    const addedHours = (await db.collection('labSlots').where('start', '>=', new Date(`${addFrom}T00:00:00Z`)).get()).docs.map((d) => d.data().start.toDate().getUTCHours()).filter((h) => h !== 9);
    ok('times added on the staff page are the times typed: 10:00, 13:00 and 15:00 on weekdays, nothing at midnight', addLabel === 'Add 15 times' && addedHours.length === 15 && addedHours.every((h) => [10, 13, 15].includes(h)) && !addedRows.some((r) => r.startsWith('00:')), `${addLabel} ${JSON.stringify(addedHours)}`);
    await page.getByLabel('Start times').fill('10:00, 00:00');
    ok('a start time outside lab hours, such as 00:00, is refused before anything is added', (await page.getByText(/00:00 is outside lab hours/).count()) === 1 && (await page.getByRole('button', { name: /^Add \d+ times?$/ }).count()) === 0);
    await page.getByLabel('Start times').fill('10:00, 14:00');
    await page.getByRole('button', { name: 'Bookings', exact: true }).click();
    await page.getByRole('heading', { name: 'Bookings from a fortnight ago' }).waitFor();
    ok('the bookings show who is coming, their contact details and what was sent', (await page.locator('.mpmb-tools__row').count()) === 2 && (await page.locator('.mpmb-tools__row').first().innerText()).includes('jane.smith@example.org') && (await page.locator('.mpmb-tools__row').first().innerText()).includes('day-before email: not set up'));
    await page.getByRole('button', { name: 'Participants', exact: true }).click();
    await page.getByLabel('Find a participant').fill('mp2670ff90a5f2');
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await page.getByRole('heading', { name: 'Personal links' }).waitFor({ timeout: 30000 });
    const detailText = await page.locator('.mpmb-tools__detail').innerText();
    ok('a participant’s detail shows the messages sent, every personal link and the links for the lab computer', detailText.includes('https://myphonemybrain.com/break/check-in/?code=MP2670FF90A5F2') && detailText.includes('https://myphonemybrain.com/break/mystory/?phase=mid&code=MP2670FF90A5F2') && detailText.includes('https://myphonemybrain.com/break/mystory/?phase=pre&at=lab&code=MP2670FF90A5F2') && detailText.includes('day-7: email not-configured') && detailText.includes('Both visits booked.'));
    await toolsSnap('participant');
    await page.getByRole('button', { name: 'Schools study (parents and young people)', exact: true }).click();
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
    ok('the school sees what was read before sending: pupils, usable UPNs, the template’s columns found, a row to check', checkText.includes('3 pupils') && checkText.includes('2 with a UPN we can use') && checkText.includes('SEN (“SEN”)') && !checkText.includes('Not read') && checkText.includes('1 row to check'), checkText.slice(0, 300));
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
    // 19 October 2026: the same list as a Word document with the class-list template's columns, then a file the page cannot read (an old .xls), sent anyway for the team.
    const JSZipForWord = admin('jszip');
    const wordZip = new JSZipForWord();
    const wcell = (t) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
    const wrow = (...c) => `<w:tr>${c.map(wcell).join('')}</w:tr>`;
    wordZip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>${wrow('UPN', 'First_Name', 'Last_Name', 'Date_Of_Birth', 'Gender', 'Ethnicity', 'Year_Group', 'Form_Tutor', 'Postcode', 'FSM (Y or N)', 'SEN (N = no SEN; S = statement; E = EHC plan; K = SEN support)')}${wrow('A123456789012', 'Kai', 'Patel', '14/03/2013', 'M', 'AIND', '8', 'Ms Lee', 'LS6 1AB', 'N', 'N')}${wrow('A123456789013', 'Ola', 'Nowak', '01/02/2013', 'F', 'WOTH', '8', 'Ms Lee', 'LS2 9JT', 'Y', 'K')}</w:tbl></w:body></w:document>`);
    await page.locator('#school-file').setInputFiles({ name: 'Year 8 class list.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await wordZip.generateAsync({ type: 'nodebuffer' }) });
    await page.getByRole('heading', { name: 'Check what we read' }).waitFor({ timeout: 30000 });
    const wordCheck = await page.locator('.mpmb-card').innerText();
    ok('a Word document’s table is read like a spreadsheet, with the template’s columns', wordCheck.includes('2 pupils') && wordCheck.includes('2 with a UPN we can use') && wordCheck.includes('FSM') && wordCheck.includes('Ethnicity'), wordCheck.slice(0, 300));
    await page.getByRole('button', { name: 'Send to the research team' }).click();
    await page.getByText(/2 pupils received/).waitFor({ timeout: 30000 });
    const wordUpload = (await db.collection('schoolUploads').where('fileKind', '==', 'docx').get()).docs[0]?.data();
    ok('the Word upload keeps every template column read, FSM and SEN as coded', wordUpload?.pupils?.[1]?.fsm === 'Y' && wordUpload?.pupils?.[1]?.sen === 'K' && wordUpload?.pupils?.[0]?.ethnicity === 'AIND' && wordUpload?.pupils?.[0]?.postcode === 'LS6 1AB' && wordUpload?.needsManualReading === false, JSON.stringify(wordUpload?.pupils?.[1] ?? null));
    await page.locator('#school-file').setInputFiles({ name: 'class list.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]) });
    await page.getByRole('heading', { name: /couldn’t read the pupils from this file automatically/ }).waitFor({ timeout: 30000 });
    ok('a file the page cannot read is not turned away: it says why, and offers to send it for the team to read', (await page.getByText(/older Excel file/).count()) >= 1 && (await page.getByRole('button', { name: 'Send it anyway' }).count()) === 1);
    await page.getByRole('button', { name: 'Send it anyway' }).click();
    await page.getByText(/The research team will read it themselves/).waitFor({ timeout: 30000 });
    const manualUpload = (await db.collection('schoolUploads').where('fileKind', '==', 'old-office').get()).docs[0]?.data();
    const [manualStored] = manualUpload?.path ? await bucket.file(manualUpload.path).exists() : [false];
    ok('it is kept as sent and marked to read by hand', manualUpload?.needsManualReading === true && manualUpload?.pupilCount === 0 && /older Excel file/.test(manualUpload?.unreadableReason ?? '') && manualStored === true);
    // 19 October 2026: files up to 50 MB. One over 7 MB goes to Storage first (schoolquarantine/), then the function reads it from there.
    const bigCsv = `UPN,Legal Forename,Legal Surname,DOB,Year,Reg Group,Notes\nA223456789012,Zed,Large,05/05/2013,8,8L,${'x'.repeat(4.5 * 1024 * 1024)}\nA223456789013,Amy,Large,06/06/2013,8,8L,${'y'.repeat(4.5 * 1024 * 1024)}\n`;
    await page.locator('#school-file').setInputFiles({ name: 'big list.csv', mimeType: 'text/csv', buffer: Buffer.from(bigCsv) });
    await page.getByRole('heading', { name: 'Check what we read' }).waitFor({ timeout: 60000 });
    const bigCheck = await page.locator('.mpmb-card').innerText();
    await page.getByRole('button', { name: 'Send to the research team' }).click();
    await page.getByText(/2 pupils received/).waitFor({ timeout: 60000 });
    const bigUpload = (await db.collection('schoolUploads').where('fileName', '==', 'big list.csv').get()).docs[0]?.data();
    const [bigStored] = bigUpload?.path ? await bucket.file(bigUpload.path).download() : [Buffer.alloc(0)];
    const [leftInQuarantine] = await bucket.getFiles({ prefix: 'schoolquarantine/' });
    ok('a 9 MB file goes through Storage: read, sent, kept exactly as sent, and its staging copy removed', bigCheck.includes('2 pupils') && bigUpload?.pupilCount === 2 && bigStored.length === Buffer.byteLength(bigCsv) && leftInQuarantine.length === 0, `${bigCheck.slice(0, 120)} | stored ${bigStored.length} | left ${leftInQuarantine.length}`);
    ok('no browser errors on the staff and school pages beyond the two refusals tried on purpose', errors.length === 2 && errors.some((e) => /status of 403/.test(e)) && errors.some((e) => /status of 400/.test(e)), errors.join(' | '));

    // Everything new reaches the export: MyStory by phase, the visits and contacts, the school's file and the UPN match.
    // The team logs an opt-out email on the staff page; the export flags the pupil on the school's list.
    await page.goto(`http://127.0.0.1:${PORT}/tools.html?tool=staff`);
    // The key is remembered in this tab, so the page signs itself in; sign in by hand only if it does not.
    const signedIn = await page.locator('.mpmb-tools__tab').first().waitFor({ timeout: 20000 }).then(() => true, () => false);
    if (!signedIn) {
      await page.getByLabel('Staff key').fill('emulator-staff-key');
      await page.getByRole('button', { name: 'Sign in' }).click();
    }
    await page.getByRole('button', { name: 'Schools study (parents and young people)', exact: true }).click();
    await page.getByRole('button', { name: 'Families not finished', exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Families not finished', exact: true }).click();
    const rubyRow = page.locator('.mpmb-tools__row', { hasText: 'Ruby Shaw' });
    await rubyRow.waitFor({ timeout: 30000 });
    ok('the staff page lists families who haven’t finished, with what is missing, their contact and a link to finish', (await rubyRow.getByText(/Screenshots from the parent’s phone/).count()) === 1 && (await rubyRow.getByRole('link', { name: '07700 900789' }).count()) === 1 && (await rubyRow.getByRole('button', { name: 'Copy link' }).count()) === 1 && (await page.locator('.mpmb-tools__row', { hasText: 'Noah' }).count()) === 0);
    await page.getByRole('button', { name: 'Opt-outs', exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Opt-outs', exact: true }).click();
    await page.getByLabel('Young person’s first name').fill('Ola');
    await page.getByLabel('Last name', { exact: true }).fill('Nowak');
    await page.getByLabel('School', { exact: true }).selectOption('DUA');
    await page.getByLabel('Parent or carer’s name').fill('Ewa Nowak');
    ok('logging needs the kind of opt-out chosen', await page.getByRole('button', { name: 'Log the opt-out' }).isDisabled());
    await page.getByLabel('Takes part in the workshop, but their data is not used').check();
    await page.getByRole('button', { name: 'Log the opt-out' }).click();
    await page.getByText(/Logged: Ola Nowak takes part in the workshop, but their data is not to be used/).waitFor({ timeout: 30000 });
    await page.locator('.mpmb-tools__row', { hasText: 'Ola Nowak' }).waitFor({ timeout: 30000 });
    const loggedOptOuts = (await db.collection('optOuts').get()).docs.map((d) => d.data());
    ok('the opt-out is logged with the school, the date and who sent it', loggedOptOuts.length === 1 && loggedOptOuts[0].schoolId === 'DUA' && loggedOptOuts[0].parentName === 'Ewa Nowak' && loggedOptOuts[0].status === 'active' && loggedOptOuts[0].kind === 'data-only' && /^\d{4}-\d{2}-\d{2}$/.test(loggedOptOuts[0].receivedOn));
    ok('the staff page lists it', (await page.locator('.mpmb-tools__row', { hasText: 'Ola Nowak' }).count()) === 1 && (await page.getByText(/Opted out \(1\)/).count()) === 1);
    await toolsSnap('opt-outs');
    await page.getByRole('button', { name: 'Website', exact: true }).click();
    await page.getByRole('button', { name: 'Website use', exact: true }).click();
    await page.getByRole('heading', { name: 'The online forms' }).waitFor({ timeout: 30000 });
    ok('the staff page’s “Website use” tab shows how each page is read', (await page.locator('.mpmb-usage__card summary', { hasText: '/information/' }).count()) === 1);
    await page.locator('.mpmb-usage__card summary', { hasText: '/information/' }).click();
    ok('…with the parts read, in order, and the links followed', (await page.locator('.mpmb-usage__table tbody th').allInnerTexts()).join('|') === 'about|share|taking part' && (await page.getByText('Share screen time online →').count()) === 1);
    await toolsSnap('website-use');

    // The address finder, switched on in this build: the addresses at a postcode, then suggestions as the address is typed.
    await page.evaluate(() => window.sessionStorage.clear());
    await page.goto(`http://127.0.0.1:${FINDER_PORT}/index.html?who=parent&school=dua`);
    await page.getByLabel('First name', { exact: true }).fill('Mia');
    await page.getByLabel('Last name', { exact: true }).fill('Hughes');
    await page.getByLabel('Date of birth', { exact: true }).fill(yearsAgo(13));
    await page.getByLabel('Year group').selectOption('Year 8');
    await page.getByLabel('Your relationship to the young person').selectOption('father');
    await page.getByLabel('Your postcode').fill('ls6 1ab');
    await page.getByRole('button', { name: 'Find your address' }).click();
    await page.getByLabel('Choose your address').waitFor({ timeout: 30000 });
    ok('the address finder lists the addresses at a postcode, through our own function', (await page.locator('#guardian-address-pick option').count()) === 5 && (await page.locator('.mpmb-address-finder__status', { hasText: '3 addresses at LS6 1AB: choose yours below.' }).count()) === 1);
    await page.getByLabel('Choose your address').selectOption({ label: '12 Long Lane' });
    ok('…and picking one fills in the address and the postcode', (await page.locator('#guardian-address').inputValue()) === '12 Long Lane, Leeds' && (await page.locator('#guardian-postcode').inputValue()) === 'LS6 1AB');
    const addressBox = page.locator('#guardian-address');
    await addressBox.fill('');
    await addressBox.pressSequentially('14 long', { delay: 50 });
    await page.locator('#guardian-address-suggestions').waitFor({ state: 'visible', timeout: 30000 });
    ok('typing the address lists the matching addresses', (await page.locator('#guardian-address-suggestions [role="option"]').allInnerTexts()).join('|') === '14 Long Lane, Leeds, LS6');
    await addressBox.press('ArrowDown');
    await addressBox.press('Enter');
    await page.waitForFunction(() => document.querySelector('#guardian-address').value === '14 Long Lane, Leeds', null, { timeout: 30000 });
    await page.getByLabel('Your mobile number').fill('07700 900456');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: /Your permission: Mia’s phone use/ }).waitFor();
    await page.getByLabel(/I confirm all of the above/).check();
    await draw(page.locator('#signature-pad'), [[0.15, 0.6], [0.4, 0.3], [0.7, 0.6]]);
    // The parent's name is the one they sign with (it is no longer asked on the details page).
    await page.getByLabel('Your full name', { exact: true }).fill('Sam Hughes');
    await page.getByRole('button', { name: 'Confirm and sign' }).click();
    await hasOwnPhone(page);
    await page.getByRole('heading', { name: /Some questions about .*’s phone use/ }).waitFor();
    await page.getByRole('button', { name: 'Skip these questions' }).click();
    await page.getByRole('heading', { name: /Can we have Mia’s screen time/ }).waitFor();
    await page.locator('#phone-source-none').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: /Check what you’ve sent/ }).waitFor();
    await page.locator('.mpmb-save', { hasText: 'Everything so far is saved.' }).waitFor({ timeout: 60000 });
    const miaCode = (await page.locator('.mpmb-save strong').innerText()).trim();
    const miaSubmission = (await db.collection('submissions').doc(miaCode).get()).data();
    const miaParent = miaSubmission ? (await db.collection('participants').doc(miaSubmission.participantId).get()).data()?.guardian : null;
    ok('the chosen address is stored with its postcode and the property’s UPRN', miaParent?.address === '14 Long Lane, Leeds' && miaParent?.postcode === 'LS6 1AB' && miaParent?.uprn === '72000014', JSON.stringify(miaParent));
    const asked = await (await fetch(`http://127.0.0.1:${ADDRESS_PORT}/__seen`)).json();
    ok(
      'Ideal Postcodes is asked only for the postcode, the words typed (near the postcode given) and the chosen address, with the key, never who is asking',
      asked.every((r) => r.key === 'emulator-address-key') && asked.some((r) => r.path === '/v1/postcodes/LS61AB') && asked.some((r) => r.path === '/v1/autocomplete/addresses' && r.params.query === '14 long' && r.params.bias_postcode === 'LS6 1AB' && r.params.limit === '8') && asked.some((r) => r.path === '/v1/autocomplete/addresses/paf_14/gbr') && !/Hughes|Mia|Sam/.test(JSON.stringify(asked)),
      JSON.stringify(asked),
    );
    await page.getByRole('button', { name: /Everything is right/ }).click();
    await page.getByRole('heading', { name: 'Would you share Mia’s screen time after all?' }).waitFor();
    await page.getByRole('button', { name: 'No, finish' }).click();
    await page.getByRole('heading', { name: /^Thank you\.$/ }).waitFor({ timeout: 30000 });
    // The limits, from a browser session of its own.
    const addressApp = initWeb({ apiKey: 'demo-key', projectId: PROJECT, appId: '1:demo:web:demo', storageBucket: BUCKET }, 'address-check');
    const addressAuth = getAuth(addressApp);
    connectAuthEmulator(addressAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    await signInAnonymously(addressAuth);
    const addressFns = getFunctions(addressApp, 'europe-west2');
    connectFunctionsEmulator(addressFns, '127.0.0.1', 5001);
    const finder = async (data) => (await httpsCallable(addressFns, 'findAddresses')(data)).data;
    ok('the finder refuses what is not a postcode, a search or an address id', (await refused(() => finder({ postcode: 'LS6' }), 'invalid-argument')) && (await refused(() => finder({ search: 'ab' }), 'invalid-argument')) && (await refused(() => finder({ pick: '../postcodes/LS61AB' }), 'invalid-argument')));
    const emptyAccount = await finder({ postcode: 'ZZ2 0ZZ' });
    const alert = (await db.collection('meta').doc('address-alert').get()).data();
    ok('when the account runs out of credit, families are asked to type and the team is told', emptyAccount.status === 'unavailable' && alert?.reason === 'no-credit');
    const answers = [];
    for (let i = 0; i < 5; i += 1) answers.push((await finder({ postcode: 'ZZ9 9ZZ' })).status);
    ok('one browser session gets five lookups an hour, then is asked to type', answers.slice(0, 4).every((a) => a === 'not-found') && answers[4] === 'unavailable', answers.join(','));
    const unknownPick = await finder({ pick: 'paf_99' });
    ok('…and a chosen address counts as a lookup too', unknownPick.status === 'unavailable');
    const suggestions = await finder({ search: 'flat 1 long', near: 'LS6' });
    ok('suggestions have their own allowance, and come back as the list shows them', suggestions.status === 'suggestions' && suggestions.suggestions.length === 1 && suggestions.suggestions[0].id === 'paf_16' && suggestions.suggestions[0].label === 'Flat 1, 16 Long Lane, Leeds, LS6', JSON.stringify(suggestions));
    const lastAsked = (await (await fetch(`http://127.0.0.1:${ADDRESS_PORT}/__seen`)).json()).at(-1);
    ok('a part postcode puts addresses in its area first', lastAsked.params.bias_postcode_outward === 'LS6' && !('bias_postcode' in lastAsked.params), JSON.stringify(lastAsked));

    const finalManifest = await (await fetch(`http://127.0.0.1:5001/${PROJECT}/europe-west2/exportNow`, { method: 'POST' })).json();
    const midTsv = await readExport('social-media-break/donations/phenotype/mystory_mid.tsv');
    const postTsv = await readExport('social-media-break/donations/phenotype/mystory_post.tsv');
    const preTsv = await readExport('social-media-break/donations/phenotype/mystory_pre.tsv');
    const postChatTsv = await readExport('social-media-break/donations/phenotype/mystory_chat_post.tsv');
    const visitsTsv = await readExport('social-media-break/identifying/visits.tsv');
    const contactsTsv = await readExport('social-media-break/identifying/contacts.tsv');
    const labPeople = await readExport('social-media-break/donations/participants.tsv');
    const matchesTsv = await readExport('schools/upn-uploads/upn_matches.tsv');
    const unmatchedTsv = await readExport('schools/upn-uploads/upn_unmatched.tsv');
    const optOutsTsv = await readExport('schools/identifying/opt_outs.tsv');
    const familiesTsv = await readExport('schools/donations/participants.tsv');
    const phoneUseTsv = await readExport('schools/donations/phenotype/parent_phone_use.tsv');
    const noPhoneTsv = await readExport('schools/donations/phenotype/parent_no_phone.tsv');
    ok('the no-phone answers have their own table, and the research table their own status column', noPhoneTsv.split('\n')[0].startsWith('participant_id\twhy_no_phone\texpected_age\t') && noPhoneTsv.includes('\ttoo-young\t13\t') && familiesTsv.split('\n')[0].includes('\tmore_questions_status\tno_phone_questions_status\t') && familiesTsv.includes('\tno-phone\t'), noPhoneTsv.slice(0, 300));
    ok('MyStory is exported by phase, the triangle over three columns', midTsv.split('\n')[0].includes('pull_habit\tpull_people_and_connection\tpull_boredom_or_stress\tpull_status') && midTsv.includes('sub-MP2670FF90A5F2\tses-mid\t') && midTsv.includes('\tThe bus\t') && midTsv.includes('\tnot-sure\t') && !postTsv.includes('flatmates') && postChatTsv.includes('sub-MP2670FF90A5F2\tses-post\t') && postChatTsv.includes('\tdone\tedited\t') && /\t0\t0\t0\tcasual\t0\.\d+\t7\t1\ttrue\t/.test(postChatTsv) && postChatTsv.split('\n')[0].includes('\tretellings_added\tretellings_still_added\tretellings_check_failed\tchosen_persona\tchosen_similarity\t') && finalManifest.counts?.labStoryChats === 1 && finalManifest.counts?.labStoryVoiceClips === 1 && postChatTsv.split('\n')[0].includes('\tvoice_clips\t') && preTsv.includes('sub-MP2670FF90A5F2\tses-pre\t') && preTsv.includes('\tLate nights\t') && finalManifest.counts?.labStories === 3, JSON.stringify(finalManifest.counts));
    // Every exported screenshot is stamped with the image it was copied from, and that image is still one a record holds: the one removed from the automatic save (and the images after it moving up) never leaves a file under the wrong name.
    const [shotFiles] = await exportsBucket.getFiles({ prefix: 'schools/donations/sourcedata/sub-' });
    const heldImages = new Set((await db.collection('donations').get()).docs.flatMap((d) => (d.data().images ?? []).map((i) => i.path)));
    const shotSources = shotFiles.map((f) => f.metadata.metadata?.mpmbSource);
    ok('each exported screenshot records its source, every source is an image a record holds, and the withdrawn image is not among them', shotFiles.length >= 3 && shotSources.every((src) => typeof src === 'string' && heldImages.has(src)) && new Set(shotSources).size === shotSources.length && !shotSources.includes(autoDonation.images[0].path) && finalManifest.binaryBacklog === 0 && finalManifest.copyFailures?.length === 0, JSON.stringify(shotSources));
    const rawSubmissions = await readExport('schools/identifying/raw/submissions.jsonl');
    const rawDonations = await readExport('schools/donations/sourcedata/raw/donations.jsonl');
    const rawLabChats = await readExport('social-media-break/donations/sourcedata/raw/labStoryChats.jsonl');
    ok('raw files hold no sign-in ids or link hashes; research raw files no device details, labelled by participant_id', !/"(sessionUid|sessionUids|resumeUids|hashes|youngLinkHash)"/.test(rawSubmissions + rawDonations + rawLabChats) && rawSubmissions.includes('"referenceCode"') && !rawDonations.includes('"client"') && !rawDonations.includes('"participantId"') && rawDonations.includes('"participant_id":"sub-0000') && !rawLabChats.includes('"client"'));
    const labTimesTsv = await readExport('social-media-break/identifying/lab_times.tsv');
    const accessTsv = await readExport('schools/identifying/school_upload_access.tsv');
    ok('the lab times, the schools’ upload access (no password hash or salt) and every problem in a school’s list are exported', labTimesTsv.startsWith('slot_id\tstart\tend\tvisit\tcapacity\tbooked\t') && labTimesTsv.split('\n').length > 3 && accessTsv.startsWith('slug\tschool_id\tactive\tset_at\trevoked_at\n') && accessTsv.includes('dua\tDUA\t') && !/[0-9a-f]{32}/.test(accessTsv) && finalManifest.files?.includes('schools/upn-uploads/problems.tsv') && finalManifest.files?.includes('schools/identifying/rejected_uploads.tsv') && finalManifest.files?.includes('social-media-break/identifying/rejected_uploads.tsv'), accessTsv);
    const voiceTsv = await readExport('social-media-break/identifying/mystory_voice/clips.tsv');
    const voiceFile = `social-media-break/identifying/mystory_voice/sub-MP2670FF90A5F2/ses-post/sub-MP2670FF90A5F2_ses-post_chat-${postStory?.chatId}_clip-01.`;
    const [voiceCopied] = await exportsBucket.file(finalManifest.files?.find((n) => n.startsWith(voiceFile)) ?? 'none').exists();
    ok('the chat table has every conversation’s own words, its number in the phase, the model and the questions covered', ['chat_n', 'model', 'questions_covered', 'own_words'].every((c) => postChatTsv.split('\n')[0].split('\t').includes(c)) && postChatTsv.includes(`\t${chatAnswers.join(' / ')}\t`) && postChatTsv.split('\n')[1].split('\t')[3] === '1' && postChatTsv.includes('\t1; 2; 3; 4; 5\t'), postChatTsv.split('\n').slice(0, 2).join(' || ').slice(0, 1500));
    ok('the spoken answer is exported to identifying/mystory_voice/, named by participant, session, chat and clip, and listed in clips.tsv; nothing of it in donations/', voiceCopied === true && voiceTsv.includes(`sub-MP2670FF90A5F2\tses-post\t${postStory?.chatId}\t`) && voiceTsv.includes('\tinterview\ttrue\t') && !finalManifest.files?.some((n) => n.startsWith('social-media-break/donations/') && /voice|\.(webm|m4a|mp4|ogg|wav|mp3|flac)$/.test(n)), JSON.stringify(finalManifest.files?.filter((n) => n.includes('voice'))));
    ok('the visits and contact details are exported to identifying/, the visit date to the research table', visitsTsv.includes('MP2670FF90A5F2\tsub-MP2670FF90A5F2\t1\t') && visitsTsv.includes('\tmoved\t') && visitsTsv.includes('day-before-email:not-configured') && contactsTsv.includes('jane.smith@example.org\t+447700900123\ttrue') && labPeople.includes(`\t${v1a.toISOString().slice(0, 10)}\tbooked\t`) && !labPeople.includes('jane@'));
    ok('the opt-out is flagged on the school’s list and listed in identifying/ with the UPN it names', unmatchedTsv.split('\n').some((l) => l.startsWith('DUA\tA123456789013\tOla\tNowak') && l.includes('\ttrue\tdata-only\t')) && optOutsTsv.includes('\tactive\tdata-only\t') && optOutsTsv.includes('\tOla\tNowak\t') && optOutsTsv.includes('\tEwa Nowak\t') && optOutsTsv.includes('\tA123456789013\tname-only'), optOutsTsv.split('\n')[1]);
    ok('the research table says who decided, where the screen time came from, and the longer answers have their own table', familiesTsv.split('\n')[0].includes('\tself_consent\tphone_source\t') && familiesTsv.split('\n')[0].endsWith('\tadded_later_on\tyoung_link_opened_on\tscreen_time_off_on\treminders_sent\topted_out\topt_out_kind') && new RegExp(`\t${new Date().toISOString().slice(0, 10)}\t${new Date().toISOString().slice(0, 10)}\t[^\t]*\t0\tfalse\t`).test(familiesTsv) && familiesTsv.includes('\ttrue\tchild\tcompleted\t') && familiesTsv.includes('\tfalse\tnone\tnot-started\t') && phoneUseTsv.split('\n')[0].startsWith('participant_id\town_phone_age\tsocial_media_age\tschool_day_time') && phoneUseTsv.includes('\t12\t11\t3-4\t'), familiesTsv);
    ok('the school’s file and what was read sit in schools/upn-uploads/, and the UPN is matched to the family’s record', finalManifest.files?.some((n) => /^schools\/upn-uploads\/dua\/\d{4}-\d{2}-\d{2}_[0-9a-f]{8}_Year 8\.csv$/.test(n)) && finalManifest.files?.some((n) => /^schools\/upn-uploads\/dua\/.*_pupils\.tsv$/.test(n)) && matchesTsv.includes('\tKai\tPatel\t2013-03-14\t') && matchesTsv.includes('\tA123456789012\tname-and-dob\t') && unmatchedTsv.includes('DUA\tA123456789013\tOla\tNowak') && finalManifest.counts?.upnUploads === 4 && finalManifest.counts?.upnMatched === 1, JSON.stringify(finalManifest.counts));

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
    finderServer.kill();
  }
  fs.writeFileSync(path.join(root, 'dist-emulator', 'e2e-result.json'), JSON.stringify({ failures }, null, 2));
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll emulator checks passed');
  process.exit(failures.length ? 1 : 0);
}
