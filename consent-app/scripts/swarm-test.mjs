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
const PROJECT = 'demo-mpmb';
const BUCKET = `${PROJECT}.appspot.com`;
const PORT = 8440;
const FAMILIES = Number(process.env.SWARM_FAMILIES ?? 120);
const AT_ONCE = Number(process.env.SWARM_AT_ONCE ?? 20);
const REPORT = process.env.SWARM_REPORT ?? path.join(process.cwd(), 'swarm-report.json');

/** The journeys, and how often each happens (out of 100). */
const JOURNEYS = [
  ['parent-phone', 35], // screenshots from the parent's own phone (Family Sharing / Family Link)
  ['child-phone', 20], // the young person is there: pass the phone, they agree and send
  ['child-link', 10], // the young person isn't there: send them their link
  ['says-no', 15], // no to sharing
  ['stops-after-signing', 10], // signs, then closes the page during the questions
  ['leaves-unsent', 10], // adds screenshots, switches app, never presses Send
];

if (process.env.MPMB_SWARM_INNER !== '1') {
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
  const say = (...a) => console.log('SWARM', ...a);
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright');
  const admin = createRequire(path.join(root, 'firebase/functions/node_modules/x.js'));
  const { initializeApp } = admin('firebase-admin/app');
  const { getFirestore } = admin('firebase-admin/firestore');
  const { getStorage } = admin('firebase-admin/storage');
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
  const db = getFirestore();
  const bucket = getStorage().bucket();
  const { dashboardOf } = await import(path.join(root, 'firebase/functions/lib/dashboard.js'));

  const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', path.join(root, 'dist-emulator')], { stdio: 'ignore' });
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

  async function run(f) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    page.setDefaultTimeout(180_000);
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
    // A slow, uneven mobile connection to the backend.
    await page.route(/127\.0\.0\.1:(5001|9099|9199|8080)/, async (r) => {
      await new Promise((res) => setTimeout(res, 50 + Math.random() * 1450));
      await r.continue().catch(() => undefined);
    });
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
      if (f.journey === 'stops-after-signing') {
        await page.locator('.mpmb-quiz__count', { hasText: 'Question 1 of 15' }).waitFor();
        // Reads the first question for a few seconds, then closes the page.
        await page.waitForTimeout(3000);
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
          await page.getByRole('radio', { name: 'Android' }).check();
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
          await page.getByRole('heading', { name: /Check what you’ve sent/ }).waitFor();
        });
        if (f.journey === 'parent-phone')
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
          await page.getByRole('radio', { name: 'iPhone' }).check();
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
          await page.getByRole('button', { name: 'I’ve sent it: finish my part' }).click();
          await page.getByRole('heading', { name: /Check what you’ve sent/ }).waitFor();
          await page.getByRole('button', { name: /Everything is right/ }).click();
          await page.getByRole('heading', { name: /^Thank you\.$/ }).waitFor();
        });
      }
      const ref = page.locator('.mpmb-done__ref strong');
      if (await ref.count()) f.code = (await ref.innerText()).trim();
      f.ok = pageErrors.length === 0;
      if (pageErrors.length) f.error = `page errors: ${pageErrors.slice(0, 2).join(' | ')}`;
    } catch (error) {
      f.error = String(error?.message ?? error).split('\n')[0];
      const shot = path.join(path.dirname(REPORT), `swarm-fail-${f.i}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
    } finally {
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
  for (const f of families) {
    const recs = byName.get(f.first) ?? [];
    const why = (m) => problems.push(`${f.first} (${f.journey}): ${m}`);
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
      'child-link': () => s.phoneSource === 'child' && images === 0 && Boolean(s.youngLinkHash),
      'says-no': () => s.phoneSource === 'none' && images === 0,
      'stops-after-signing': () => s.phoneSource === null && Boolean(s.consentId) && Boolean(s.reminderDueAt),
      'leaves-unsent': () => s.phoneSource === 'parent' && images === 1 && ds.some((d) => d.sendPressed === false),
    }[f.journey];
    if (!expect()) why(`stored phoneSource=${s.phoneSource} images=${images} imageCount=${s.imageCount}`);
    if (!people.get(String(s.participantId))?.guardian?.phone) why('no mobile stored');
  }
  check('every family has exactly one record, holding what they did', problems.length === 0, problems.slice(0, 8).join('; '));
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
  check('nothing left half-uploaded, apart from screenshots never sent', quarantine.length <= families.filter((f) => !f.ok).length * 2, `${quarantine.length} in quarantine`);

  const dash = await dashboardOf(db);
  const swarmSent = families.filter((f) => f.ok && ['parent-phone', 'child-phone', 'leaves-unsent'].includes(f.journey)).length;
  check('the staff dashboard counts every form and every family that sent screen time', dash.schools.stages[0].n >= families.filter((f) => f.code).length && dash.schools.stages[2].n >= swarmSent, `forms ${dash.schools.stages[0].n}, sent ${dash.schools.stages[2].n}`);

  const tx = Date.now();
  const exportRes = await fetch(`http://127.0.0.1:5001/${PROJECT}/europe-west2/exportNow`, { method: 'POST' });
  const exportSecs = (Date.now() - tx) / 1000;
  const [files] = await getStorage().bucket(`${PROJECT}-exports`).getFiles({ prefix: 'schools/donations/sourcedata/' });
  const exportedShots = files.filter((f) => /screenshot\.(png|jpe?g|webp)$/.test(f.name)).length;
  check('the export copies every screenshot', exportRes.ok && exportedShots === stored, `${exportedShots} of ${stored} in ${exportSecs.toFixed(1)} s`);

  // ---- Report ------------------------------------------------------------
  const ok = families.filter((f) => f.ok);
  const stepNames = ['open', 'details', 'sign', 'questions', 'screenshots', 'young-person', 'link', 'finish'];
  const timings = Object.fromEntries(stepNames.map((n) => [n, families.map((f) => f.steps[n]).filter((x) => typeof x === 'number')]).filter(([, xs]) => xs.length).map(([n, xs]) => [n, { median_s: quantile(xs, 0.5) / 1000, p95_s: quantile(xs, 0.95) / 1000, max_s: Math.max(...xs) / 1000 }]));
  const report = {
    families: FAMILIES,
    atOnce: AT_ONCE,
    elapsed_s: Math.round(elapsed),
    familiesPerHour: Math.round((FAMILIES / elapsed) * 3600),
    finishedWithoutAProblem: ok.length,
    byJourney: Object.fromEntries(JOURNEYS.map(([j]) => [j, { families: families.filter((f) => f.journey === j).length, ok: ok.filter((f) => f.journey === j).length }])),
    failures: families.filter((f) => !f.ok).map((f) => ({ family: f.first, journey: f.journey, doubleTap: f.doubleTap, refresh: f.refresh, error: f.error })),
    timings,
    wholeJourney: { median_s: quantile(ok.map((f) => f.finished - f.started), 0.5) / 1000, p95_s: quantile(ok.map((f) => f.finished - f.started), 0.95) / 1000 },
    checks,
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  say(`\n${ok.length}/${FAMILIES} families finished without a problem in ${Math.round(elapsed)} s (${report.familiesPerHour} an hour at ${AT_ONCE} at once).`);
  say(`Whole journey: median ${report.wholeJourney.median_s} s, 95th percentile ${report.wholeJourney.p95_s} s.`);
  for (const [n, v] of Object.entries(timings)) say(`  ${n.padEnd(13)} median ${v.median_s.toFixed(1)} s · 95% ${v.p95_s.toFixed(1)} s · slowest ${v.max_s.toFixed(1)} s`);
  for (const x of report.failures.slice(0, 15)) say(`  problem: ${x.family} ${x.journey}${x.doubleTap ? ' (double tap)' : ''}${x.refresh ? ' (refresh)' : ''}: ${x.error}`);
  say(`Report: ${REPORT}`);
  process.exit(checks.every((c) => c.ok) && ok.length === FAMILIES ? 0 : 1);
}
