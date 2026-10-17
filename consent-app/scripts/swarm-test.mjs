// Swarm test of the family form: many parents at once, each in their own
// browser (their own session, as on their own phone), against the Firebase
// emulator suite, never the live site. Then every record is checked.
//
//   node scripts/swarm-test.mjs                 # 120 families, 20 at a time
//   SWARM_FAMILIES=300 SWARM_AT_ONCE=30 node scripts/swarm-test.mjs
//
// Each family takes one of the real journeys, in the proportions below, on
// a slow, uneven mobile connection (every request delayed 50 ms to 1.5 s).
// Some misbehave on purpose: tap Send twice, refresh the page half-way, or
// add screenshots and switch away without sending. Afterwards it checks, for
// every family, that exactly one record was made with what they did, that
// no two families share a reference or a participant, that every screenshot
// is stored, that the staff dashboard counts match, and that the export has
// every screenshot. The report (timings, failures, checks) is printed and
// written to SWARM_REPORT (default swarm-report.json beside this script's
// working folder).
//
// The emulator runs every function in one process on this machine, so the
// timings show how the app behaves under a crowd, not how fast Google's
// servers are: the live functions run many copies at once.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
/**
 * SWARM_PROJECT=<id>: run against a separate Firebase test project instead of the emulators, to see real Google servers
 * under the crowd (docs/test-project.md). It needs the test project's web settings (VITE_FIREBASE_API_KEY and
 * VITE_FIREBASE_APP_ID) and a key for it (GOOGLE_APPLICATION_CREDENTIALS). Never the live project.
 */
const TARGET = process.env.SWARM_PROJECT ?? null;
if (TARGET === 'myphone-mybrain') {
  console.error('SWARM_PROJECT is the live project. The swarm makes hundreds of test records: run it against a separate test project (docs/test-project.md).');
  process.exit(2);
}
const PROJECT = TARGET ?? 'demo-mpmb';
const BUCKET = TARGET ? (process.env.SWARM_BUCKET ?? process.env.VITE_FIREBASE_STORAGE_BUCKET ?? `${TARGET}.firebasestorage.app`) : `${PROJECT}.appspot.com`;
/** The requests to the backend: the emulators here, Google's servers for a test project. */
const BACKEND = TARGET ? /(cloudfunctions\.net|\.run\.app|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebasestorage\.googleapis\.com|firestore\.googleapis\.com)/ : /127\.0\.0\.1:(5001|9099|9199|8080)/;
const isFunction = (url) => (TARGET ? /cloudfunctions\.net|\.run\.app/.test(url) : url.includes(':5001/'));
const SITE = TARGET ? 'dist-swarm' : 'dist-emulator';
const PORT = 8440;
const FAMILIES = Number(process.env.SWARM_FAMILIES ?? 120);
const AT_ONCE = Number(process.env.SWARM_AT_ONCE ?? 20);
const REPORT = process.env.SWARM_REPORT ?? path.join(process.cwd(), 'swarm-report.json');
/**
 * SWARM_CHAOS=1: things go wrong, as on real phones. Of the requests to the backend, about 8% are dropped before they
 * arrive, 5% reach the server but the answer never comes back (the server did the work; the phone doesn't know), and 5%
 * get a server error. Some families lose their connection for a few seconds while sending screenshots, and some close the
 * page straight after pressing Send. The parents do what parents do: when the page says something went wrong and offers
 * "Try again", they tap it. Then the same strict checks: one record each, holding everything that got through.
 */
const CHAOS = process.env.SWARM_CHAOS === '1';

/** The journeys, and how often each happens (out of 100). */
const JOURNEYS = [
  ['parent-phone', 30], // screenshots from the parent's own phone (Family Sharing / Family Link)
  ['child-phone', 20], // the young person is there: pass the phone, they agree and send
  ['child-link', 10], // the young person isn't there: the parent sends their link, and they do their part on their own phone
  ['says-no', 15], // no to sharing
  ['stops-after-signing', 8], // signs, then closes the page during the questions
  ['leaves-unsent', 7], // adds screenshots, switches app, never presses Send
  ['comes-back', 10], // signs, stops, then days later opens the reminder's link on another device and sends the screenshots
];

if (process.env.MPMB_SWARM_INNER !== '1' && TARGET) {
  for (const name of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID', 'GOOGLE_APPLICATION_CREDENTIALS'])
    if (!process.env[name]) {
      console.error(`${name} is needed for a test-project run (docs/test-project.md).`);
      process.exit(2);
    }
  console.log(`Building the app against the test project ${TARGET}…`);
  const env = { ...process.env, VITE_MPMB_BACKEND: 'firebase', VITE_FIREBASE_EMULATOR_HOST: '', VITE_FIREBASE_PROJECT_ID: TARGET, VITE_FIREBASE_AUTH_DOMAIN: `${TARGET}.firebaseapp.com`, VITE_FIREBASE_STORAGE_BUCKET: BUCKET };
  execSync(`npx vite build --mode production --outDir ${SITE}`, { cwd: root, stdio: 'inherit', env });
  // Belt and braces: the build must not point at the live project.
  const built = fs.readdirSync(path.join(root, SITE)).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(root, SITE, f), 'utf8')).join('');
  if (built.includes('myphone-mybrain.firebaseapp.com') || built.includes('"myphone-mybrain"')) {
    console.error('The test build points at the live project. Stopping.');
    process.exit(2);
  }
  const result = spawn('node', [path.join(root, 'scripts/swarm-test.mjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, MPMB_SWARM_INNER: '1' } });
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
  const result = spawn('firebase', ['emulators:exec', '--project', PROJECT, '--only', 'auth,functions,firestore,storage', `MPMB_SWARM_INNER=1 node ${path.join(root, 'scripts/swarm-test.mjs')}`], {
    cwd: path.join(root, 'firebase'),
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199' },
  });
  // The functions' own log lines are many under a swarm: keep only the swarm's.
  result.stdout.on('data', (chunk) => {
    for (const line of String(chunk).split('\n')) if (line.startsWith('SWARM')) console.log(line.slice(6));
    else if (process.env.SWARM_VERBOSE && line.trim()) console.log(line);
  });
  result.on('exit', (code) => process.exit(code ?? 1));
} else {
  await inner();
}

function pick(i) {
  // Spread evenly, so each journey gets its share whatever the number of families.
  const slot = (i * 37) % 100;
  let acc = 0;
  for (const [name, share] of JOURNEYS) {
    acc += share;
    if (slot < acc) return name;
  }
  return JOURNEYS[0][0];
}

function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

async function inner() {
  const say = (...a) => (TARGET ? console.log(...a) : console.log('SWARM', ...a));
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright');
  const admin = createRequire(path.join(root, 'firebase/functions/node_modules/x.js'));
  const { initializeApp } = admin('firebase-admin/app');
  const { getFirestore } = admin('firebase-admin/firestore');
  const { getStorage } = admin('firebase-admin/storage');
  if (!TARGET) {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  }
  initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
  const db = getFirestore();
  const bucket = getStorage().bucket();
  const { dashboardOf } = await import(path.join(root, 'firebase/functions/lib/dashboard.js'));

  const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', path.join(root, SITE)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  // One screenshot-like PNG, made once and reused (each family sends its own copy).
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
        for (let i = 0; i < 8; i += 1) x.fillText(`App ${i + 1}   ${i + 1}h ${10 * i}m`, 60, 320 + i * 80);
        return c.toDataURL('image/png');
      })
    ).split(',')[1],
    'base64',
  );
  await shotPage.close();

  // SWARM_ONLY=<journey> runs every family on that journey (for looking into one).
  const families = Array.from({ length: FAMILIES }, (_, i) => {
    const journey = process.env.SWARM_ONLY ?? pick(i);
    const age = 12 + (i % 3);
    return {
      i,
      journey,
      first: `Swarm${i}`,
      last: `Family${String.fromCharCode(65 + (i % 26))}${i}`,
      age,
      dob: `${new Date().getFullYear() - age}-05-20`,
      yearGroup: `Year ${age - 5}`,
      school: i % 2 ? 'gsal' : 'dua',
      mobile: `07700 9${String(10000 + i).slice(-5)}`,
      // Misbehaviour on top of the journey.
      doubleTap: i % 7 === 3,
      refresh: i % 9 === 4,
      // Under SWARM_CHAOS: the connection drops for a few seconds while sending, or the page is closed straight after Send.
      offline: CHAOS && i % 6 === 1,
      closesMidSend: CHAOS && i % 11 === 5,
      closed: false,
      code: null,
      ok: false,
      error: null,
      steps: {},
      started: 0,
      finished: 0,
    };
  });

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

  /** A new phone (its own browser), on the same slow, unreliable connection; the parent's reflexes under SWARM_CHAOS. */
  async function phone(f, pageErrors) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    page.setDefaultTimeout(180_000);
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.route(BACKEND, (r) => slowRoute(f, r));
    const reflex = CHAOS ? setInterval(() => tapAgain(page), 1500) : null;
    return { context, page, close: async () => { if (reflex) clearInterval(reflex); await context.close().catch(() => undefined); } };
  }

  /** The young person's own link, opened on their own phone. */
  async function youngLater(f, pageErrors) {
    const { page, close } = await phone(f, pageErrors);
    try {
      await page.goto(f.youngLink);
      await page.getByRole('heading', { name: /Do you want to share your screen time/ }).waitFor();
      await draw(page, '#assent-signature');
      await page.getByRole('button', { name: 'Sign and continue' }).click();
      await page.getByRole('radio', { name: 'Android' }).check();
      await page.locator('input[type=file]').first().setInputFiles([{ name: 'own.png', mimeType: 'image/png', buffer: png }]);
      await page.waitForFunction(() => document.querySelectorAll('.mpmb-upload').length === 1);
      const send = page.getByRole('button', { name: /Send this screenshot/ });
      await send.click();
      if (f.doubleTap) await send.click({ timeout: 2000 }).catch(() => undefined);
      await page.getByRole('heading', { name: /^Thank you\.$/ }).waitFor();
    } catch (error) {
      await page.screenshot({ path: path.join(path.dirname(REPORT), `swarm-fail-${f.i}-young.png`), fullPage: true }).catch(() => undefined);
      throw error;
    } finally {
      await close();
    }
  }

  /** Days later, on another device, from the reminder's link: says where the screen time comes from and sends two screenshots. */
  async function comeBack(f, pageErrors) {
    let code = null;
    for (let k = 0; k < 120 && !code; k += 1) {
      const people = await db.collection('participants').where('firstName', '==', f.first).get();
      const sub = people.empty ? null : await db.collection('submissions').where('participantId', '==', people.docs[0].id).get();
      if (sub && !sub.empty) code = sub.docs[0].id;
      else await new Promise((r) => setTimeout(r, 500));
    }
    if (!code) {
      // Under SWARM_CHAOS the first save may never have arrived before the page was closed: there is nothing to come back to.
      f.nothingToComeBackTo = true;
      return;
    }
    f.code = code;
    const { page, close } = await phone(f, pageErrors);
    try {
      await page.goto(`http://127.0.0.1:${PORT}/index.html?finish=${code}`);
      await page.getByLabel('The young person’s date of birth').fill(f.dob);
      await page.getByRole('button', { name: 'Find my record' }).click();
      await page.getByRole('heading', { name: /Can we have .* screen time\?/ }).waitFor();
      await page.locator('#resume-source-parent').check();
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByRole('heading', { name: 'We found your record.' }).waitFor();
      await page.getByRole('button', { name: 'Add the screenshots' }).click();
      await page.getByRole('radio', { name: 'Android' }).check();
      await page.locator('input[type=file]').first().setInputFiles([0, 1].map((k) => ({ name: `later${k}.png`, mimeType: 'image/png', buffer: png })));
      await page.waitForFunction(() => document.querySelectorAll('.mpmb-upload').length === 2);
      const send = page.getByRole('button', { name: /Send these 2 screenshots/ });
      await send.click();
      if (f.doubleTap) await send.click({ timeout: 2000 }).catch(() => undefined);
      await page.getByRole('heading', { name: /^Thank you\.$/ }).waitFor();
    } catch (error) {
      await page.screenshot({ path: path.join(path.dirname(REPORT), `swarm-fail-${f.i}-back.png`), fullPage: true }).catch(() => undefined);
      throw error;
    } finally {
      await close();
    }
  }

  async function slowRoute(f, r) {
    await new Promise((res) => setTimeout(res, 50 + Math.random() * 1450));
    if (CHAOS && r.request().method() !== 'OPTIONS') {
      const x = Math.random();
      const fn = isFunction(r.request().url());
      f.chaos = f.chaos ?? { dropped: 0, lost: 0, failed: 0 };
      if (x < 0.08) {
        f.chaos.dropped += 1;
        return r.abort('failed').catch(() => undefined);
      }
      if (fn && x < 0.13) {
        // The server does the work; the answer is lost on the way back.
        f.chaos.lost += 1;
        await r.fetch().catch(() => undefined);
        return r.abort('failed').catch(() => undefined);
      }
      if (fn && x < 0.18) {
        f.chaos.failed += 1;
        return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { status: 'INTERNAL', message: 'Simulated server error' } }) }).catch(() => undefined);
      }
    }
    await r.continue().catch(() => undefined);
  }

  /** What a parent does when the page says something went wrong: taps "Try again", or presses Send again. */
  async function tapAgain(page) {
    try {
      const again = page.getByRole('button', { name: /^Try again/ });
      if ((await again.count()) && (await again.first().isVisible())) await again.first().click({ timeout: 1000 });
      const sendError = page.locator('.mpmb-error, [role=alert]', { hasText: /could not be sent|did not upload|didn’t save|not been saved|could not be saved|try again/i });
      const send = page.getByRole('button', { name: /^Send (this|these)/ });
      if ((await sendError.count()) && (await send.count()) && (await send.first().isEnabled())) await send.first().click({ timeout: 1000 });
    } catch {
      /* The page moved on. */
    }
  }

  async function run(f) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    page.setDefaultTimeout(180_000);
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
    // A slow, uneven mobile connection to the backend (and, under SWARM_CHAOS, an unreliable one).
    await page.route(BACKEND, (r) => slowRoute(f, r));
    const reflex = CHAOS ? setInterval(() => tapAgain(page), 1500) : null;
    const t = async (name, fn) => {
      const s = Date.now();
      await fn();
      f.steps[name] = Date.now() - s;
    };
    f.started = Date.now();
    try {
      await t('open', async () => {
        await page.goto(`http://127.0.0.1:${PORT}/index.html?who=parent&school=${f.school}`);
        await page.getByLabel('First name', { exact: true }).waitFor();
      });
      await t('details', async () => {
        await page.getByLabel('First name', { exact: true }).fill(f.first);
        await page.getByLabel('Last name', { exact: true }).fill(f.last);
        await page.getByLabel('Date of birth', { exact: true }).fill(f.dob);
        await page.getByLabel('Year group').selectOption(f.yearGroup);
        await page.getByLabel('Your relationship to the young person').selectOption(f.i % 4 ? 'mother' : 'father');
        await page.getByLabel('Your home address').fill(`${f.i + 1} Swarm Street, Leeds`);
        await page.getByLabel('Your mobile number').fill(f.mobile);
        await page.getByLabel('Postcode').fill('LS2 9JT');
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByLabel(/I confirm all of the above/).waitFor();
      });
      await t('sign', async () => {
        await page.getByLabel(/I confirm all of the above/).check();
        await draw(page, '#signature-pad');
        await page.getByLabel('Your full name', { exact: true }).fill(`Parent ${f.last}`);
        await page.getByRole('button', { name: 'Confirm and sign' }).click();
        await page.getByRole('heading', { name: /First: does .* have a phone of their own\?|Some questions about .*’s phone use/ }).waitFor();
        if (await page.getByRole('heading', { name: /First: does/ }).count()) await page.getByRole('button', { name: 'Yes', exact: true }).click();
        await page.getByRole('heading', { name: /Some questions about .*’s phone use/ }).waitFor();
      });
      if (f.journey === 'stops-after-signing' || f.journey === 'comes-back') {
        await page.locator('.mpmb-quiz__count', { hasText: 'Question 1 of 15' }).waitFor();
        // Reads the first question for a few seconds, then closes the page.
        await page.waitForTimeout(3000);
        if (f.journey === 'comes-back') {
          await context.close().catch(() => undefined);
          await t('comes-back', () => comeBack(f, pageErrors));
          f.ok = pageErrors.length === 0;
          if (pageErrors.length) f.error = `page errors: ${pageErrors.slice(0, 2).join(' | ')}`;
          return;
        }
        f.ok = true;
        return;
      }
      if (f.refresh) {
        // Half-way, the page is refreshed (a phone that reloads a tab): the form carries on where it was.
        await page.reload();
        await page.getByRole('heading', { name: /Some questions about .*’s phone use/ }).waitFor();
      }
      await t('questions', async () => {
        // Some answer a few questions first.
        if (f.i % 3 === 0) {
          await page.locator('.mpmb-quiz__count', { hasText: 'Question 1 of 15' }).waitFor();
          await page.locator('.mpmb-quiz__option').first().click();
          await page.locator('.mpmb-quiz__count', { hasText: 'Question 2 of 15' }).waitFor();
          await page.locator('.mpmb-quiz__option').first().click();
          await page.locator('.mpmb-quiz__count', { hasText: 'Question 3 of 15' }).waitFor();
        }
        await page.getByRole('button', { name: 'Skip these questions' }).click();
        await page.getByRole('heading', { name: /Can we have .* screen time/ }).waitFor();
      });
      const source = { 'parent-phone': 'parent', 'leaves-unsent': 'parent', 'child-phone': 'child', 'child-link': 'child', 'says-no': 'none' }[f.journey];
      await page.locator(`#phone-source-${source}`).check();
      await page.getByRole('button', { name: 'Continue' }).click();

      if (f.journey === 'says-no') {
        await t('finish', async () => {
          await page.getByRole('heading', { name: /Check what you’ve sent/ }).waitFor();
          await page.getByRole('button', { name: /Everything is right/ }).click();
          await page.getByRole('button', { name: 'No, finish' }).click();
          await page.getByRole('heading', { name: /^Thank you\.$/ }).waitFor();
        });
      } else if (f.journey === 'parent-phone' || f.journey === 'leaves-unsent') {
        await t('screenshots', async () => {
          await page.getByRole('heading', { name: /screen time from your phone/ }).waitFor();
          // A banner appearing as they tap can move the page: they tap again.
          await page.getByRole('radio', { name: 'Android' }).check().catch(() => page.getByRole('radio', { name: 'Android' }).check());
          const n = f.journey === 'leaves-unsent' ? 1 : 2;
          await page.locator('input[type=file]').first().setInputFiles(Array.from({ length: n }, (_, k) => ({ name: `s${k}.png`, mimeType: 'image/png', buffer: png })));
          await page.waitForFunction((n) => document.querySelectorAll('.mpmb-upload').length === n, n);
          if (f.journey === 'leaves-unsent') {
            // Switches to another app without pressing Send: the page saves them.
            await page.evaluate(() => {
              Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
              document.dispatchEvent(new Event('visibilitychange'));
            });
            await page.locator('.mpmb-upload__status', { hasText: 'Saved' }).waitFor();
            return;
          }
          const send = page.getByRole('button', { name: /Send these 2 screenshots/ });
          await send.click();
          // An impatient second tap on Send.
          if (f.doubleTap) await send.click({ timeout: 2000 }).catch(() => undefined);
          if (f.closesMidSend) {
            // Closes the page straight after pressing Send, without waiting to see it go.
            await page.waitForTimeout(400);
            f.closed = true;
            return;
          }
          if (f.offline) {
            await context.setOffline(true);
            await page.waitForTimeout(6000);
            await context.setOffline(false);
          }
          await page.getByRole('heading', { name: /Check what you’ve sent/ }).waitFor();
        });
        if (f.journey === 'parent-phone' && !f.closed)
          await t('finish', async () => {
            await page.getByRole('button', { name: /Everything is right/ }).click();
            await page.getByRole('heading', { name: /^Thank you\.$/ }).waitFor();
          });
      } else if (f.journey === 'child-phone') {
        await t('young-person', async () => {
          await page.getByRole('button', { name: `${f.first} is with me: pass them this phone` }).click();
          await page.getByRole('heading', { name: /Do you want to share your screen time/ }).waitFor();
          await draw(page, '#assent-signature');
          await page.getByRole('button', { name: 'Sign and continue' }).click();
          await page.getByRole('heading', { name: /Share your screen time/ }).waitFor();
          await page.getByRole('radio', { name: 'iPhone' }).check().catch(() => page.getByRole('radio', { name: 'iPhone' }).check());
          await page.locator('input[type=file]').first().setInputFiles([{ name: 'kid.png', mimeType: 'image/png', buffer: png }]);
          await page.waitForFunction(() => document.querySelectorAll('.mpmb-upload').length === 1);
          const send = page.getByRole('button', { name: /Send this screenshot/ });
          await send.click();
          if (f.doubleTap) await send.click({ timeout: 2000 }).catch(() => undefined);
          await page.getByRole('heading', { name: /Nearly done/ }).waitFor();
          await page.getByRole('button', { name: 'Finish', exact: true }).click();
          await page.getByRole('heading', { name: /^Thank you\.$/ }).waitFor();
        });
      } else if (f.journey === 'child-link') {
        await t('link', async () => {
          await page.getByRole('button', { name: `${f.first} isn’t with me: send them a link` }).click();
          await page.locator('.mpmb-carryon__url').waitFor();
          f.youngLink = (await page.locator('.mpmb-handover__link .mpmb-carryon__url').innerText()).trim();
          await page.getByRole('button', { name: 'I’ve sent it: finish my part' }).click();
          await page.getByRole('heading', { name: /Check what you’ve sent/ }).waitFor();
          await page.getByRole('button', { name: /Everything is right/ }).click();
          await page.getByRole('heading', { name: /^Thank you\.$/ }).waitFor();
        });
        const ref = page.locator('.mpmb-done__ref strong');
        if (await ref.count()) f.code = (await ref.innerText()).trim();
        await context.close().catch(() => undefined);
        // Later, on their own phone: the young person opens the link, agrees and sends their screenshot.
        await t('young-later', () => youngLater(f, pageErrors));
      }
      if (f.journey !== 'child-link') {
        const ref = page.locator('.mpmb-done__ref strong');
        if (await ref.count()) f.code = (await ref.innerText()).trim();
      }
      f.ok = pageErrors.length === 0;
      if (pageErrors.length) f.error = `page errors: ${pageErrors.slice(0, 2).join(' | ')}`;
    } catch (error) {
      f.error = String(error?.message ?? error).split('\n')[0];
      const shot = path.join(path.dirname(REPORT), `swarm-fail-${f.i}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
    } finally {
      if (reflex) clearInterval(reflex);
      f.finished = Date.now();
      await context.close().catch(() => undefined);
    }
  }

  // The swarm: AT_ONCE families at a time, each starting as another finishes.
  say(`${FAMILIES} families, ${AT_ONCE} at once…`);
  const t0 = Date.now();
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, FAMILIES) }, async () => {
      while (next < families.length) {
        const f = families[next++];
        await run(f);
        done += 1;
        if (done % 10 === 0 || done === FAMILIES) say(`  ${done}/${FAMILIES} done (${families.filter((x) => x.ok).length} without a problem)`);
      }
    }),
  );
  const elapsed = (Date.now() - t0) / 1000;
  await browser.close();
  server.kill();

  // Let any saves started as pages closed land.
  await new Promise((r) => setTimeout(r, 8000));

  // ---- Checks ------------------------------------------------------------
  const checks = [];
  const check = (name, cond, detail = '') => {
    checks.push({ name, ok: Boolean(cond), detail });
    say(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const subs = (await db.collection('submissions').where('kind', '==', 'consent').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const people = new Map((await db.collection('participants').get()).docs.map((d) => [d.id, d.data()]));
  const byName = new Map();
  for (const s of subs) {
    const p = people.get(String(s.participantId));
    if (p?.firstName?.startsWith('Swarm')) byName.set(p.firstName, [...(byName.get(p.firstName) ?? []), s]);
  }
  const assents = new Map((await db.collection('assents').get()).docs.map((d) => [d.id, d.data()]));
  const donations = new Map((await db.collection('donations').get()).docs.map((d) => [d.id, d.data()]));

  const problems = [];
  const neverArrived = [];
  for (const f of families) {
    const recs = byName.get(f.first) ?? [];
    const why = (m) => problems.push(`${f.first} (${f.journey}): ${m}`);
    // Under SWARM_CHAOS a parent who signs, has the save fail on their connection and closes the page seconds later has sent
    // nothing that reached us: not a loss the site could prevent, and counted apart.
    if (recs.length === 0 && CHAOS && (f.journey === 'stops-after-signing' || f.nothingToComeBackTo) && (f.chaos?.dropped || f.chaos?.failed)) {
      neverArrived.push(f.first);
      continue;
    }
    if (recs.length !== 1) {
      why(`${recs.length} records${recs.map((r) => ` [${r.id} uid=${String(r.sessionUid).slice(0, 6)} created=${r.createdAt?.toDate?.().toISOString?.() ?? r.createdAt} pid=${String(r.participantId).slice(0, 8)} ${people.get(String(r.participantId))?.lastName} v${r.version}]`).join('')}`);
      continue;
    }
    const s = recs[0];
    if (f.code && s.id !== f.code) why(`reference on screen ${f.code}, stored ${s.id}`);
    const ds = (s.donationIds ?? []).map((id) => donations.get(id)).filter(Boolean);
    const images = ds.reduce((n, d) => n + (d.images?.length ?? 0), 0);
    const expect = {
      'parent-phone': () => s.phoneSource === 'parent' && images === 2 && s.imageCount === 2 && ds.every((d) => d.sendPressed !== false),
      'child-phone': () => s.phoneSource === 'child' && images === 1 && s.imageCount === 1 && assents.get(String(s.assentId))?.status === 'completed',
      'child-link': () => s.phoneSource === 'child' && images === 1 && s.imageCount === 1 && Boolean(s.youngLinkHash) && assents.get(String(s.assentId))?.status === 'completed' && ds.every((d) => d.late === true),
      'comes-back': () => s.phoneSource === 'parent' && images === 2 && s.imageCount === 2 && ds.every((d) => d.late === true),
      'says-no': () => s.phoneSource === 'none' && images === 0,
      'stops-after-signing': () => s.phoneSource === null && Boolean(s.consentId) && Boolean(s.reminderDueAt),
      'leaves-unsent': () => s.phoneSource === 'parent' && images === 1 && ds.some((d) => d.sendPressed === false),
    }[f.journey];
    // Closed straight after Send: whatever arrived must be whole and consistent (checked for every record below); nothing more is owed.
    if (f.closed) {
      // On a failing connection the answer "from my phone" may not have arrived either; then nothing after it did, and the reminder (reminderDueAt) follows them up.
      const fine = (s.phoneSource === 'parent' && images <= 2) || (s.phoneSource === null && images === 0 && Boolean(s.reminderDueAt));
      if (!fine) why(`closed mid-send: phoneSource=${s.phoneSource} images=${images}`);
    } else if (!expect()) why(`stored phoneSource=${s.phoneSource} images=${images} imageCount=${s.imageCount}`);
    if (!people.get(String(s.participantId))?.guardian?.phone) why('no mobile stored');
  }
  check('every family has exactly one record, holding what they did', problems.length === 0, problems.slice(0, 8).join('; '));
  if (neverArrived.length) say(`note: ${neverArrived.length} famil${neverArrived.length === 1 ? 'y' : 'ies'} closed the page seconds after signing while their connection was failing, so nothing reached the server: ${neverArrived.join(', ')}`);
  const mismatched = subs.filter((s) => Number(s.imageCount ?? 0) !== (s.donationIds ?? []).reduce((n, id) => n + (donations.get(id)?.images?.length ?? 0), 0));
  check('every record’s screenshot count matches the screenshots it holds', mismatched.length === 0, mismatched.slice(0, 5).map((s) => `${s.id}: ${s.imageCount}`).join(', '));
  const uploadIds = [...donations.values()].flatMap((d) => (d.images ?? []).map((i) => i.uploadId));
  check('no screenshot is stored twice', new Set(uploadIds).size === uploadIds.length, `${uploadIds.length - new Set(uploadIds).size} twice`);
  const codes = subs.map((s) => s.id);
  check('no two families share a reference', new Set(codes).size === codes.length);
  const pids = subs.map((s) => String(s.participantId));
  check('no two families share a participant', new Set(pids).size === pids.length);

  let missing = 0;
  let stored = 0;
  for (const d of donations.values()) {
    for (const img of d.images ?? []) {
      stored += 1;
      const [exists] = await bucket.file(img.path).exists();
      if (!exists) missing += 1;
    }
  }
  check('every screenshot recorded is stored', missing === 0 && stored > 0, `${stored} stored, ${missing} missing`);
  const [quarantine] = await bucket.getFiles({ prefix: 'quarantine/' });
  check('nothing left half-uploaded, apart from screenshots never sent', quarantine.length <= families.filter((f) => !f.ok || f.closed || f.chaos?.lost).length * 2, `${quarantine.length} in quarantine`);

  const dash = await dashboardOf(db);
  const swarmSent = families.filter((f) => f.ok && !f.closed && !f.nothingToComeBackTo && ['parent-phone', 'child-phone', 'leaves-unsent', 'child-link', 'comes-back'].includes(f.journey)).length;
  check('the staff dashboard counts every form and every family that sent screen time', dash.schools.stages[0].n >= families.filter((f) => f.code).length && dash.schools.stages[2].n >= swarmSent, `forms ${dash.schools.stages[0].n}, sent ${dash.schools.stages[2].n}`);

  if (TARGET) {
    say('The export and the data health check run on the test project every hour: see DATA HEALTH.txt in its export bucket after the next run.');
  } else {
    const tx = Date.now();
    const exportRes = await fetch(`http://127.0.0.1:5001/${PROJECT}/europe-west2/exportNow`, { method: 'POST' });
    const exportSecs = (Date.now() - tx) / 1000;
    const [files] = await getStorage().bucket(`${PROJECT}-exports`).getFiles({ prefix: 'schools/donations/sourcedata/' });
    const exportedShots = files.filter((f) => /screenshot\.(png|jpe?g|webp)$/.test(f.name)).length;
    check('the export copies every screenshot', exportRes.ok && exportedShots === stored, `${exportedShots} of ${stored} in ${exportSecs.toFixed(1)} s`);
    const health = (await db.collection('health').doc('latest').get()).data();
    check('the data health check, run with the export, finds nothing wrong', health?.ok === true, health ? health.problems.map((x) => `${x.what}: ${x.count} (${x.examples.slice(0, 3).join('; ')})`).join(' | ') : 'no report');
  }

  // ---- Report ------------------------------------------------------------
  const ok = families.filter((f) => f.ok);
  const stepNames = ['open', 'details', 'sign', 'questions', 'screenshots', 'young-person', 'link', 'young-later', 'comes-back', 'finish'];
  const timings = Object.fromEntries(stepNames.map((n) => [n, families.map((f) => f.steps[n]).filter((x) => typeof x === 'number')]).filter(([, xs]) => xs.length).map(([n, xs]) => [n, { median_s: quantile(xs, 0.5) / 1000, p95_s: quantile(xs, 0.95) / 1000, max_s: Math.max(...xs) / 1000 }]));
  const report = {
    families: FAMILIES,
    atOnce: AT_ONCE,
    elapsed_s: Math.round(elapsed),
    familiesPerHour: Math.round((FAMILIES / elapsed) * 3600),
    finishedWithoutAProblem: ok.length,
    byJourney: Object.fromEntries(JOURNEYS.map(([j]) => [j, { families: families.filter((f) => f.journey === j).length, ok: ok.filter((f) => f.journey === j).length }])),
    chaos: CHAOS ? families.reduce((a, f) => ({ dropped: a.dropped + (f.chaos?.dropped ?? 0), lost: a.lost + (f.chaos?.lost ?? 0), failed: a.failed + (f.chaos?.failed ?? 0), offline: a.offline + (f.offline ? 1 : 0), closedMidSend: a.closedMidSend + (f.closed ? 1 : 0) }), { dropped: 0, lost: 0, failed: 0, offline: 0, closedMidSend: 0 }) : null,
    failures: families.filter((f) => !f.ok).map((f) => ({ family: f.first, journey: f.journey, doubleTap: f.doubleTap, refresh: f.refresh, offline: f.offline, error: f.error })),
    timings,
    wholeJourney: { median_s: quantile(ok.map((f) => f.finished - f.started), 0.5) / 1000, p95_s: quantile(ok.map((f) => f.finished - f.started), 0.95) / 1000 },
    checks,
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  say(`\n${ok.length}/${FAMILIES} families finished without a problem in ${Math.round(elapsed)} s (${report.familiesPerHour} an hour at ${AT_ONCE} at once).`);
  if (report.chaos) say(`Chaos: ${report.chaos.dropped} requests dropped, ${report.chaos.lost} answers lost after the server acted, ${report.chaos.failed} server errors, ${report.chaos.offline} families offline mid-send, ${report.chaos.closedMidSend} pages closed mid-send.`);
  say(`Whole journey: median ${report.wholeJourney.median_s} s, 95th percentile ${report.wholeJourney.p95_s} s.`);
  for (const [n, v] of Object.entries(timings)) say(`  ${n.padEnd(13)} median ${v.median_s.toFixed(1)} s · 95% ${v.p95_s.toFixed(1)} s · slowest ${v.max_s.toFixed(1)} s`);
  for (const x of report.failures.slice(0, 15)) say(`  problem: ${x.family} ${x.journey}${x.doubleTap ? ' (double tap)' : ''}${x.refresh ? ' (refresh)' : ''}: ${x.error}`);
  say(`Report: ${REPORT}`);
  process.exit(checks.every((c) => c.ok) && ok.length === FAMILIES ? 0 : 1);
}
