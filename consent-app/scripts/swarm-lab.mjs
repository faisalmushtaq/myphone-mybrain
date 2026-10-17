// Swarm test of the social media break study: many participants at once,
// each in their own browser, against the Firebase emulator suite, never the
// live site. Then every record is checked.
//
//   node scripts/swarm-lab.mjs                    # 40 participants, 10 at a time
//   SWARM_PEOPLE=80 SWARM_AT_ONCE=20 SWARM_CHAOS=1 node scripts/swarm-lab.mjs
//
// Each participant signs up, consents, sends a screen-time screenshot and a
// cleaned TikTok download, says they don't use YouTube or Instagram, then
// tries to book both lab visits. There are fewer times than people, and they
// all go for the first time offered, so most bookings race each other. Then
// half tell their MyStory on the form (at the lab) and half in the chat with
// Remi (the emulator's stand-in model). SWARM_CHAOS=1 adds the same failures
// as the family swarm: dropped requests, answers lost after the server acted,
// server errors. Afterwards: one record each holding everything they sent,
// no file stored twice, no time booked past its spaces, both visits or
// neither, one story each, and the export complete.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
/**
 * SWARM_PROJECT=<id>: against a separate Firebase test project instead of the emulators (docs/test-project.md), with
 * VITE_FIREBASE_API_KEY, VITE_FIREBASE_APP_ID, GOOGLE_APPLICATION_CREDENTIALS and SWARM_STAFF_KEY (the test project's
 * staff key). The chat then talks to the real model and costs a little: everyone writes their story on the form unless
 * SWARM_CHAT=1. Never the live project.
 */
const TARGET = process.env.SWARM_PROJECT ?? null;
if (TARGET === 'myphone-mybrain') {
  console.error('SWARM_PROJECT is the live project. The swarm makes test records and bookings: run it against a separate test project (docs/test-project.md).');
  process.exit(2);
}
const PROJECT = TARGET ?? 'demo-mpmb';
const BUCKET = TARGET ? (process.env.SWARM_BUCKET ?? process.env.VITE_FIREBASE_STORAGE_BUCKET ?? `${TARGET}.firebasestorage.app`) : `${PROJECT}.appspot.com`;
const BACKEND = TARGET ? /(cloudfunctions\.net|\.run\.app|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebasestorage\.googleapis\.com|firestore\.googleapis\.com)/ : /127\.0\.0\.1:(5001|9099|9199|8080)/;
const isFunction = (url) => (TARGET ? /cloudfunctions\.net|\.run\.app/.test(url) : url.includes(':5001/'));
const SITE = TARGET ? 'dist-swarm' : 'dist-emulator';
const CHATS = !TARGET || process.env.SWARM_CHAT === '1';
const PORT = 8441;
const PEOPLE = Number(process.env.SWARM_PEOPLE ?? 40);
const AT_ONCE = Number(process.env.SWARM_AT_ONCE ?? 10);
const REPORT = process.env.SWARM_REPORT ?? path.join(process.cwd(), 'swarm-lab-report.json');
const CHAOS = process.env.SWARM_CHAOS === '1';
/** The lab times: three for first visits and three for second visits, three spaces each (nine people can book). */
const SLOTS_PER_VISIT = 3;
const SPACES = 3;

if (process.env.MPMB_SWARM_INNER !== '1' && TARGET) {
  for (const name of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID', 'GOOGLE_APPLICATION_CREDENTIALS', 'SWARM_STAFF_KEY'])
    if (!process.env[name]) {
      console.error(`${name} is needed for a test-project run (docs/test-project.md).`);
      process.exit(2);
    }
  console.log(`Building the app against the test project ${TARGET}…`);
  const env = { ...process.env, VITE_MPMB_BACKEND: 'firebase', VITE_FIREBASE_EMULATOR_HOST: '', VITE_FIREBASE_PROJECT_ID: TARGET, VITE_FIREBASE_AUTH_DOMAIN: `${TARGET}.firebaseapp.com`, VITE_FIREBASE_STORAGE_BUCKET: BUCKET };
  execSync(`npx vite build --mode production --outDir ${SITE}`, { cwd: root, stdio: 'inherit', env });
  const built = fs.readdirSync(path.join(root, SITE)).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(root, SITE, f), 'utf8')).join('');
  if (built.includes('myphone-mybrain.firebaseapp.com') || built.includes('"myphone-mybrain"')) {
    console.error('The test build points at the live project. Stopping.');
    process.exit(2);
  }
  const result = spawn('node', [path.join(root, 'scripts/swarm-lab.mjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, MPMB_SWARM_INNER: '1' } });
  result.on('exit', (code) => process.exit(code ?? 1));
} else if (process.env.MPMB_SWARM_INNER !== '1') {
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
  console.log('Starting the emulator suite…');
  const result = spawn('firebase', ['emulators:exec', '--project', PROJECT, '--only', 'auth,functions,firestore,storage', `MPMB_SWARM_INNER=1 node ${path.join(root, 'scripts/swarm-lab.mjs')}`], {
    cwd: path.join(root, 'firebase'),
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199' },
  });
  result.stdout.on('data', (chunk) => {
    for (const line of String(chunk).split('\n')) if (line.startsWith('SWARM')) console.log(line.slice(6));
    else if (process.env.SWARM_VERBOSE && line.trim()) console.log(line);
  });
  result.on('exit', (code) => process.exit(code ?? 1));
} else {
  await inner();
}

function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

/** 0 → "A", 27 → "Bb": names are letters only. */
function letters(n) {
  let out = '';
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out[0].toUpperCase() + out.slice(1);
}

async function inner() {
  const say = (...a) => (TARGET ? console.log(...a) : console.log('SWARM', ...a));
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright');
  const admin = createRequire(path.join(root, 'firebase/functions/node_modules/x.js'));
  const { initializeApp } = admin('firebase-admin/app');
  const { getFirestore } = admin('firebase-admin/firestore');
  const { getStorage } = admin('firebase-admin/storage');
  const JSZip = admin('jszip');
  if (!TARGET) {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  }
  initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
  const db = getFirestore();
  const bucket = getStorage().bucket();

  // The team adds the lab times through the staff service, signed in as anyone (the staff key is what counts).
  const authBase = TARGET ? 'https://identitytoolkit.googleapis.com' : 'http://127.0.0.1:9099/identitytoolkit.googleapis.com';
  const signUp = await (await fetch(`${authBase}/v1/accounts:signUp?key=${TARGET ? process.env.VITE_FIREBASE_API_KEY : 'demo-key'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"returnSecureToken":true}' })).json();
  const staffCall = async (data) => {
    const url = TARGET ? `https://europe-west2-${TARGET}.cloudfunctions.net/staffApi` : `http://127.0.0.1:5001/${PROJECT}/europe-west2/staffApi`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signUp.idToken}` }, body: JSON.stringify({ data: { staffKey: TARGET ? process.env.SWARM_STAFF_KEY : 'emulator-staff-key', ...data } }) });
    return res.json();
  };
  const DAY = 86400000;
  const nineUtc = (days, hour = 9) => {
    const d = new Date(Date.now() + days * DAY);
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  };
  const slots = [
    ...Array.from({ length: SLOTS_PER_VISIT }, (_, k) => ({ start: nineUtc(10 + k).toISOString(), minutes: 120, capacity: SPACES, visit: 1 })),
    ...Array.from({ length: SLOTS_PER_VISIT }, (_, k) => ({ start: nineUtc(42 + k).toISOString(), minutes: 120, capacity: SPACES, visit: 2 })),
  ];
  const added = await staffCall({ action: 'add-slots', slots });
  if (added.result?.created !== slots.length) throw new Error(`Could not add the lab times: ${JSON.stringify(added)}`);

  const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', path.join(root, SITE)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

  const shotPage = await browser.newPage();
  const png = Buffer.from(
    (
      await shotPage.evaluate(() => {
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
        x.fillText('Last 7 days', 60, 280);
        for (let i = 0; i < 8; i += 1) x.fillText(`App ${i + 1}   ${i + 1}h ${10 * i}m`, 60, 380 + i * 80);
        return c.toDataURL('image/png');
      })
    ).split(',')[1],
    'base64',
  );
  await shotPage.close();
  const zip = new JSZip();
  zip.file(
    'user_data_tiktok.json',
    JSON.stringify({
      'Your Activity': {
        'Watch History': { VideoList: [{ Date: '2026-09-01 20:11:03', Link: 'https://www.tiktokv.com/share/video/1/' }, { Date: '2026-09-01 20:12:40', Link: 'https://www.tiktokv.com/share/video/2/' }] },
        Searches: { SearchList: [{ Date: '2026-09-02 08:00:00', SearchTerm: 'something' }] },
      },
    }),
  );
  const tiktokZip = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  const year = new Date().getFullYear();
  const people = Array.from({ length: PEOPLE }, (_, i) => ({
    i,
    first: `Lab${letters(i)}`,
    last: `Swarm${letters(i * 7 + 3)}`,
    dob: `${year - 19 - (i % 4)}-0${1 + (i % 9)}-1${i % 9}`,
    mobile: `07700 8${String(10000 + i).slice(-5)}`,
    story: i % 2 && CHATS ? 'chat' : 'form',
    doubleTap: i % 7 === 3,
    code: null,
    booking: null,
    ok: false,
    error: null,
    steps: {},
    started: 0,
    finished: 0,
  }));

  const draw = async (page, selector) => {
    const loc = page.locator(selector);
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.3, { steps: 5 });
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.6, { steps: 5 });
    await page.mouse.up();
  };

  async function slowRoute(p, r) {
    await new Promise((res) => setTimeout(res, 50 + Math.random() * 1450));
    if (CHAOS && r.request().method() !== 'OPTIONS') {
      const x = Math.random();
      const fn = isFunction(r.request().url());
      p.chaos = p.chaos ?? { dropped: 0, lost: 0, failed: 0 };
      if (x < 0.08) {
        p.chaos.dropped += 1;
        return r.abort('failed').catch(() => undefined);
      }
      if (fn && x < 0.13) {
        p.chaos.lost += 1;
        await r.fetch().catch(() => undefined);
        return r.abort('failed').catch(() => undefined);
      }
      if (fn && x < 0.18) {
        p.chaos.failed += 1;
        return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { status: 'INTERNAL', message: 'Simulated server error' } }) }).catch(() => undefined);
      }
    }
    await r.continue().catch(() => undefined);
  }

  /** What a participant does when the page says something went wrong: taps "Try again", or the button they just pressed. */
  async function tapAgain(page) {
    try {
      const again = page.getByRole('button', { name: /^Try again/ });
      if ((await again.count()) && (await again.first().isVisible())) await again.first().click({ timeout: 1000 });
      const problem = page.locator('.mpmb-error, [role=alert]', { hasText: /could not|didn’t|did not|not been|went wrong|try again|connection/i });
      if (!(await problem.count())) return;
      for (const name of ['Send my screenshot', 'Send my data', 'Send my story', 'Confirm and sign', 'Keep this story', 'Continue']) {
        const b = page.getByRole('button', { name, exact: true });
        if ((await b.count()) && (await b.first().isVisible()) && (await b.first().isEnabled())) {
          await b.first().click({ timeout: 1000 });
          return;
        }
      }
    } catch {
      /* The page moved on. */
    }
  }

  async function browserFor(p, errors) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: ['microphone'] });
    const page = await context.newPage();
    page.setDefaultTimeout(180_000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.route(BACKEND, (r) => slowRoute(p, r));
    const reflex = CHAOS ? setInterval(() => tapAgain(page), 1500) : null;
    return { page, close: async () => { if (reflex) clearInterval(reflex); await context.close().catch(() => undefined); } };
  }

  async function codeOf(p) {
    for (let k = 0; k < 60; k += 1) {
      const q = await db.collection('labConsents').where('codeParts.firstName', '==', p.first).get();
      if (!q.empty) return String(q.docs[0].data().participantCode);
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  }

  async function run(p) {
    const errors = [];
    const { page, close } = await browserFor(p, errors);
    const t = async (name, fn) => {
      const s = Date.now();
      await fn();
      p.steps[name] = Date.now() - s;
    };
    p.started = Date.now();
    try {
      await t('sign-up', async () => {
        await page.goto(`http://127.0.0.1:${PORT}/lab.html`);
        await page.getByRole('button', { name: 'New to the study' }).click();
        await page.getByLabel('First name').fill(p.first);
        await page.getByLabel('Last name').fill(p.last);
        await page.getByLabel('Date of birth').fill(p.dob);
        await page.getByLabel('Postcode').fill('LS2 9JT');
        await page.getByLabel('Mobile number').fill(p.mobile);
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByRole('heading', { name: /What taking part involves/ }).waitFor();
        await page.getByRole('button', { name: 'I have read this' }).click();
      });
      await t('consent', async () => {
        await page.getByRole('heading', { name: /Your consent to take part/ }).waitFor();
        for (const id of ['read-information', 'involves', 'voluntary', 'data-kept', 'donation-required', 'publication', 'data-protection', 'take-part']) await page.locator(`#lab-stmt-${id}`).check();
        await page.locator(p.i % 3 ? '#lab-stmt-link-records-declined' : '#lab-stmt-link-records-agreed').check();
        await draw(page, '#lab-signature');
        const sign = page.getByRole('button', { name: 'Confirm and sign' });
        await sign.click();
        if (p.doubleTap) await sign.click({ timeout: 1500 }).catch(() => undefined);
        await page.getByRole('heading', { name: 'Send your screen-time screenshots.', level: 1 }).waitFor();
      });
      await t('screenshot', async () => {
        await page.getByRole('radio', { name: 'iPhone' }).check();
        await page.locator('input[type=file]').first().setInputFiles([{ name: 'screen-time.png', mimeType: 'image/png', buffer: png }]);
        await page.waitForFunction(() => document.querySelectorAll('.mpmb-shots li').length === 1);
        const send = page.getByRole('button', { name: 'Send my screenshot', exact: true });
        await send.click();
        if (p.doubleTap) await send.click({ timeout: 1500 }).catch(() => undefined);
        await page.getByRole('heading', { name: 'Request your data download.', level: 1 }).waitFor();
      });
      await t('app-data', async () => {
        await page.getByRole('button', { name: /^I have my file/ }).click();
        await page.locator('#lab-zip').setInputFiles({ name: 'TikTok_Data.zip', mimeType: 'application/zip', buffer: tiktokZip });
        await page.getByRole('heading', { name: /Found: TikTok data/ }).waitFor();
        await page.getByRole('button', { name: 'Keep these choices' }).click();
        await page.getByRole('button', { name: /Next: check and send/ }).click();
        const send = page.getByRole('button', { name: 'Send my data' });
        await send.click();
        if (p.doubleTap) await send.click({ timeout: 1500 }).catch(() => undefined);
        await page.getByRole('heading', { name: /Thank you. Your data has been sent/ }).waitFor();
        await page.getByRole('button', { name: 'I don’t use YouTube' }).click();
        await page.getByRole('button', { name: 'I do use YouTube' }).waitFor();
        await page.getByRole('button', { name: 'I don’t use Instagram' }).click();
        await page.getByText('Every app you use is ticked off. Thank you.').waitFor();
        // The page shows the answer at once and saves it behind: wait for the save, and note any problem it reports.
        await page.waitForFunction(() => !document.querySelector('.mpmb-apps [aria-busy="true"], .mpmb-apps .is-loading'), null, { timeout: 60000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        const appProblem = page.locator('.mpmb-apps [role=alert], .mpmb-apps .mpmb-error');
        if (await appProblem.count()) p.appsProblem = (await appProblem.first().innerText()).trim();
        if (!(await page.getByText('Every app you use is ticked off. Thank you.').count())) p.appsProblem = p.appsProblem ?? 'the apps list went back after the save';
      });
      p.code = await codeOf(p);
      await t('book', async () => {
        await page.getByRole('button', { name: 'Choose the times' }).click();
        await page.getByRole('heading', { name: 'Book your two lab visits.', level: 1 }).waitFor();
        const firstTimes = page.locator('#lab-slot-1 .mpmb-slots__time');
        const none = page.getByText(/No times are open/).first();
        await Promise.race([firstTimes.first().waitFor(), none.waitFor()]);
        let filledEmail = false;
        for (let attempt = 0; attempt < 12 && !p.booking; attempt += 1) {
          if (await page.getByText(/Booked: your two lab visits/).count()) {
            p.booking = 'booked';
            break;
          }
          if (!(await firstTimes.count())) {
            p.booking = 'no-times';
            break;
          }
          // Everyone goes for the first time offered: the races are the point.
          // The time may go between seeing it and tapping it (someone quicker): look again.
          if (!(await firstTimes.first().click({ timeout: 10000 }).then(() => true, () => false))) continue;
          const secondTimes = page.locator('#lab-slot-2 .mpmb-slots__time');
          await Promise.race([secondTimes.first().waitFor({ timeout: 30000 }), page.getByText(/No times are open .* days after that first visit|No times are open between/).first().waitFor({ timeout: 30000 })]).catch(() => undefined);
          if (!(await secondTimes.count())) {
            p.booking = 'no-times';
            break;
          }
          if (!(await secondTimes.first().click({ timeout: 10000 }).then(() => true, () => false))) continue;
          if (!filledEmail) {
            await page.getByLabel('Email address').fill(`${p.first.toLowerCase()}@example.com`);
            filledEmail = true;
          }
          const book = page.getByRole('button', { name: 'Book both visits' });
          await book.click();
          if (p.doubleTap) await book.click({ timeout: 1500 }).catch(() => undefined);
          const booked = page.getByText(/Booked: your two lab visits/).first();
          const problem = page.locator('.mpmb-slots .mpmb-error, .mpmb-error-summary, [role=alert]').first();
          await Promise.race([booked.waitFor({ timeout: 90000 }), problem.waitFor({ timeout: 90000 })]).catch(() => undefined);
          if (await booked.isVisible().catch(() => false)) p.booking = 'booked';
          else {
            p.bookingErrors = [...(p.bookingErrors ?? []), (await problem.innerText().catch(() => '')).slice(0, 140)];
            // The page fetches the times again; wait a moment before choosing again.
            await page.waitForTimeout(2500);
          }
        }
        if (!p.booking) throw new Error(`could not book: ${(p.bookingErrors ?? []).join(' / ')}`);
      });
      await close();
      await t('story', () => (p.story === 'chat' ? chatStory(p, errors) : formStory(p, errors)));
      p.ok = errors.length === 0;
      if (errors.length) p.error = `page errors: ${errors.slice(0, 2).join(' | ')}`;
    } catch (error) {
      p.error = String(error?.message ?? error).split('\n')[0];
      await page.screenshot({ path: path.join(path.dirname(REPORT), `swarm-lab-fail-${p.i}.png`), fullPage: true }).catch(() => undefined);
    } finally {
      p.finished = Date.now();
      await close();
    }
  }

  /** MyStory on the form, on the lab computer at the first visit. */
  async function formStory(p, errors) {
    const { page, close } = await browserFor(p, errors);
    try {
      await page.goto(`http://127.0.0.1:${PORT}/lab.html?flow=story&phase=pre&at=lab&code=${p.code}`);
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByRole('button', { name: 'I’d rather write my story myself' }).click();
      await page.getByRole('heading', { name: 'Your phone, before the break', level: 1 }).waitFor();
      await page.locator('#story-prompt-evening').check();
      await page.locator('#story-text').fill(`Most evenings I scroll in bed until late (${p.first}).`);
      await page.locator('#story-title').fill('Late nights');
      const send = page.getByRole('button', { name: 'Send my story' });
      await send.click();
      if (p.doubleTap) await send.click({ timeout: 1500 }).catch(() => undefined);
      await page.getByText(/Please hand the computer back to the researcher/).waitFor();
    } catch (error) {
      await page.screenshot({ path: path.join(path.dirname(REPORT), `swarm-lab-fail-${p.i}-story.png`), fullPage: true }).catch(() => undefined);
      throw error;
    } finally {
      await close();
    }
  }

  /** MyStory in the chat with Remi, after the break, from the personal link. */
  async function chatStory(p, errors) {
    const { page, close } = await browserFor(p, errors);
    try {
      await page.goto(`http://127.0.0.1:${PORT}/lab.html?flow=story&phase=post&code=${p.code}`);
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByRole('heading', { name: 'A short chat about your break.', level: 1 }).waitFor();
      await page.getByRole('button', { name: 'Start the chat' }).click();
      const log = page.getByRole('log', { name: 'Your chat with Remi' });
      await log.locator('.mpmb-chat__bubble--bot').nth(2).waitFor();
      const answers = ['The quiet evenings stood out the most.', 'I slept better and talked to my flatmates more.', 'Going back on felt strange.', 'Easier than I expected.', 'I will keep my phone out of the bedroom.'];
      for (const [k, answer] of answers.entries()) {
        await page.locator('#chat-input').fill(answer);
        await page.locator('#chat-input').press('Enter');
        if (k < answers.length - 1) await log.locator('.mpmb-chat__bubble--bot').nth(3 + k).waitFor();
      }
      await log.getByText(/See if one of them fits you/).waitFor();
      await page.locator('#chat-candidate-2').waitFor();
      await page.locator('#chat-candidate-1').click();
      await page.getByRole('button', { name: 'This one' }).click();
      await log.getByText(/How close is this to what you want to say\?/).waitFor();
      await page.getByRole('button', { name: '7', exact: true }).click();
      await log.getByText(/What would you change about it\?/).waitFor();
      await page.locator('#chat-request').fill('Say it was my flatmates.');
      await page.getByRole('button', { name: 'Ask Remi' }).click();
      await page.getByText('Here it is, rewritten. Check it reads right.').waitFor();
      const keep = page.getByRole('button', { name: 'Keep this story' });
      await keep.click();
      if (p.doubleTap) await keep.click({ timeout: 1500 }).catch(() => undefined);
      await page.getByRole('heading', { name: 'Thank you. Your story is saved.' }).waitFor();
    } catch (error) {
      await page.screenshot({ path: path.join(path.dirname(REPORT), `swarm-lab-fail-${p.i}-chat.png`), fullPage: true }).catch(() => undefined);
      throw error;
    } finally {
      await close();
    }
  }

  say(`${PEOPLE} participants, ${AT_ONCE} at once, ${SLOTS_PER_VISIT * SPACES} places to book…`);
  const t0 = Date.now();
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, PEOPLE) }, async () => {
      while (next < people.length) {
        const p = people[next++];
        await run(p);
        done += 1;
        if (done % 10 === 0 || done === PEOPLE) say(`  ${done}/${PEOPLE} done (${people.filter((x) => x.ok).length} without a problem)`);
      }
    }),
  );
  const elapsed = (Date.now() - t0) / 1000;
  await browser.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 5000));

  // ---- Checks ------------------------------------------------------------
  const checks = [];
  const check = (name, cond, detail = '') => {
    checks.push({ name, ok: Boolean(cond), detail });
    say(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const consents = (await db.collection('labConsents').get()).docs.map((d) => d.data());
  const parts = new Map((await db.collection('labParticipants').get()).docs.map((d) => [d.id, d.data()]));
  const donations = (await db.collection('labDonations').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const bookings = (await db.collection('labBookings').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const slotDocs = (await db.collection('labSlots').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const stories = (await db.collection('labStories').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const chats = (await db.collection('labStoryChats').get()).docs.map((d) => ({ id: d.id, ...d.data() }));

  const problems = [];
  for (const p of people) {
    const why = (m) => problems.push(`${p.first}: ${m}`);
    const mine = consents.filter((c) => c.codeParts?.firstName === p.first);
    if (mine.length !== 1) {
      why(`${mine.length} consent records`);
      continue;
    }
    const code = String(mine[0].participantCode);
    const row = parts.get(code);
    if (!row?.consentId) why('no participant row with the consent');
    if (!p.ok) continue;
    const files = donations.filter((d) => d.participantCode === code).flatMap((d) => d.files ?? []);
    if (row?.screenshotCount !== 1 || row?.archiveCount !== 1 || files.length !== 2) why(`screenshots ${row?.screenshotCount}, archives ${row?.archiveCount}, files ${files.length}`);
    if (JSON.stringify(row?.platformsNotUsed) !== JSON.stringify(['instagram', 'youtube'])) why(`apps not used ${JSON.stringify(row?.platformsNotUsed)}${p.appsProblem ? ` (the page said: ${p.appsProblem})` : ' (the page showed both)'}`);
    const active = bookings.filter((b) => b.participantCode === code && (b.status === 'booked' || b.status === 'attended'));
    if (p.booking === 'booked' && (active.length !== 2 || active.map((b) => b.visit).sort().join() !== '1,2')) why(`booked on screen, ${active.length} bookings stored`);
    if (p.booking === 'no-times' && active.length) why(`told no times, but ${active.length} bookings stored`);
    const phase = p.story === 'chat' ? 'post' : 'pre';
    const told = stories.filter((s) => s.participantCode === code && s.phase === phase);
    if (told.length !== 1) why(`${told.length} ${phase} stories`);
    if (Number(row?.storyCounts?.[phase] ?? 0) !== told.length) why(`story count ${row?.storyCounts?.[phase]} for ${told.length} stories`);
    if (p.story === 'chat' && chats.filter((c) => c.participantCode === code && c.status === 'done').length !== 1) why(`${chats.filter((c) => c.participantCode === code && c.status === 'done').length} finished chats`);
  }
  check('every participant has one record holding everything they sent, booked and told', problems.length === 0, problems.slice(0, 8).join('; '));
  const ids = donations.flatMap((d) => (d.files ?? []).map((f) => f.uploadId));
  check('no file is stored twice', new Set(ids).size === ids.length, `${ids.length - new Set(ids).size} twice`);
  let missing = 0;
  for (const f of donations.flatMap((d) => d.files ?? [])) if (!(await bucket.file(f.path).exists())[0]) missing += 1;
  check('every file recorded is stored', missing === 0 && ids.length > 0, `${ids.length} stored, ${missing} missing`);
  const over = slotDocs.filter((s) => Number(s.booked ?? 0) > Number(s.capacity ?? 1));
  check('no lab time is booked past its spaces', over.length === 0, over.map((s) => `${s.id} ${s.booked}/${s.capacity}`).join(', '));
  const drift = slotDocs.filter((s) => Number(s.booked ?? 0) !== bookings.filter((b) => b.slotId === s.id && (b.status === 'booked' || b.status === 'attended')).length);
  check('every time’s count matches the bookings in it', drift.length === 0, drift.map((s) => `${s.id} says ${s.booked}`).join(', '));
  const byCode = new Map();
  for (const b of bookings.filter((x) => x.status === 'booked')) byCode.set(b.participantCode, [...(byCode.get(b.participantCode) ?? []), b.visit]);
  const odd = [...byCode.entries()].filter(([, v]) => v.sort().join() !== '1,2');
  check('everyone booked has both visits, once each', odd.length === 0, odd.map(([c, v]) => `${c}: ${v.join()}`).join('; '));
  const places = SLOTS_PER_VISIT * SPACES;
  const bookedPeople = byCode.size;
  check('every place that could be taken was taken', bookedPeople === Math.min(places, people.filter((p) => p.ok || p.booking).length), `${bookedPeople} booked of ${places} places`);
  const storyIds = [...parts.values()].flatMap((r) => r.storyIds ?? []);
  check('every story is on its participant’s record once', storyIds.length === stories.length && new Set(storyIds).size === storyIds.length, `${stories.length} stories, ${storyIds.length} on records`);

  if (TARGET) {
    say('The export and the data health check run on the test project every hour: see DATA HEALTH.txt in its export bucket after the next run.');
  } else {
    const exportRes = await fetch(`http://127.0.0.1:5001/${PROJECT}/europe-west2/exportNow`, { method: 'POST' });
    const [exported] = await getStorage().bucket(`${PROJECT}-exports`).getFiles({ prefix: 'social-media-break/donations/sourcedata/sub-' });
    check('the export copies every file', exportRes.ok && exported.length === ids.length, `${exported.length} of ${ids.length}`);
    const health = (await db.collection('health').doc('latest').get()).data();
    check('the data health check, run with the export, finds nothing wrong', health?.ok === true, health ? health.problems.map((x) => `${x.what}: ${x.count} (${x.examples.slice(0, 3).join('; ')})`).join(' | ') : 'no report');
    const [tsvs] = await getStorage().bucket(`${PROJECT}-exports`).getFiles({ prefix: 'social-media-break/donations/phenotype/mystory' });
    let storyRows = 0;
    for (const f of tsvs.filter((x) => /mystory_(pre|post)\.tsv$/.test(x.name))) storyRows += String((await f.download())[0]).trim().split('\n').length - 1;
    let chatRows = 0;
    for (const f of tsvs.filter((x) => /mystory_chat_(pre|post)\.tsv$/.test(x.name))) chatRows += String((await f.download())[0]).trim().split('\n').length - 1;
    const formStories = stories.filter((s) => s.mode !== 'chat').length;
    check('the export has a row for every story on the form and every chat', storyRows === formStories && chatRows === chats.length, `${storyRows} rows for ${formStories} form stories, ${chatRows} rows for ${chats.length} chats`);
  }

  const ok = people.filter((p) => p.ok);
  const stepNames = ['sign-up', 'consent', 'screenshot', 'app-data', 'book', 'story'];
  const timings = Object.fromEntries(stepNames.map((n) => [n, people.map((p) => p.steps[n]).filter((x) => typeof x === 'number')]).filter(([, xs]) => xs.length).map(([n, xs]) => [n, { median_s: quantile(xs, 0.5) / 1000, p95_s: quantile(xs, 0.95) / 1000, max_s: Math.max(...xs) / 1000 }]));
  const report = {
    people: PEOPLE,
    atOnce: AT_ONCE,
    elapsed_s: Math.round(elapsed),
    finishedWithoutAProblem: ok.length,
    booked: people.filter((p) => p.booking === 'booked').length,
    toldNoTimes: people.filter((p) => p.booking === 'no-times').length,
    bookingRaces: people.reduce((n, p) => n + (p.bookingErrors?.length ?? 0), 0),
    chaos: CHAOS ? people.reduce((a, p) => ({ dropped: a.dropped + (p.chaos?.dropped ?? 0), lost: a.lost + (p.chaos?.lost ?? 0), failed: a.failed + (p.chaos?.failed ?? 0) }), { dropped: 0, lost: 0, failed: 0 }) : null,
    failures: people.filter((p) => !p.ok).map((p) => ({ person: p.first, story: p.story, doubleTap: p.doubleTap, error: p.error, bookingErrors: p.bookingErrors })),
    timings,
    checks,
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  say(`\n${ok.length}/${PEOPLE} participants finished without a problem in ${Math.round(elapsed)} s. ${report.booked} booked, ${report.toldNoTimes} told no times were left, ${report.bookingRaces} times lost to someone quicker.`);
  if (report.chaos) say(`Chaos: ${report.chaos.dropped} requests dropped, ${report.chaos.lost} answers lost after the server acted, ${report.chaos.failed} server errors.`);
  for (const [n, v] of Object.entries(timings)) say(`  ${n.padEnd(11)} median ${v.median_s.toFixed(1)} s · 95% ${v.p95_s.toFixed(1)} s · slowest ${v.max_s.toFixed(1)} s`);
  for (const x of report.failures.slice(0, 15)) say(`  problem: ${x.person} (${x.story}${x.doubleTap ? ', double tap' : ''}): ${x.error}`);
  say(`Report: ${REPORT}`);
  process.exit(checks.every((c) => c.ok) && ok.length === PEOPLE ? 0 : 1);
}
