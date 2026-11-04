// End-to-end test of the linkage registry (portal › School study › Linkage)
// against the Firebase emulators: website records seeded, a fake MySelf
// (linkFakeMyself, which the functions read in place of MySelf's projects in
// the emulator), an EEG manifest uploaded through the page; matching, the
// review queue walked with the keyboard, a person's page, an unlink, the
// roles that must NOT get in, and the hourly export's linkage/ files.
// Screenshots go to LINKAGE_SHOTS (default ./linkage-shots).
//
//   node scripts/linkage-e2e.mjs
//
// Needs what portal-e2e.mjs needs: firebase-tools, Java, the functions built,
// Playwright with Chromium.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PROJECT = 'demo-mpmb';
const BUCKET = `${PROJECT}.appspot.com`;
const PORT = 8441;
const AUTH = 'http://127.0.0.1:9099';
const FN = `http://127.0.0.1:5001/${PROJECT}/europe-west2/portalApi`;
const SHOTS = process.env.LINKAGE_SHOTS ?? path.join(root, 'linkage-shots');

if (process.env.MPMB_E2E_INNER !== '1') {
  if (!process.env.SKIP_BUILD) {
    console.log('Building the app against the emulators…');
    const env = { ...process.env, VITE_MPMB_BACKEND: 'firebase', VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1:4000', VITE_FIREBASE_API_KEY: 'demo-key', VITE_FIREBASE_PROJECT_ID: PROJECT, VITE_FIREBASE_APP_ID: '1:demo:web:demo', VITE_FIREBASE_AUTH_DOMAIN: `${PROJECT}.firebaseapp.com`, VITE_FIREBASE_STORAGE_BUCKET: BUCKET };
    execSync('npx vite build --mode emulator --outDir dist-portal-e2e', { cwd: root, stdio: 'inherit', env });
  }
  const result = spawn('firebase', ['emulators:exec', '--project', PROJECT, '--only', 'auth,functions,firestore,storage', `MPMB_E2E_INNER=1 LINKAGE_SHOTS="${SHOTS}" node ${path.join(root, 'scripts/linkage-e2e.mjs')}`], { cwd: path.join(root, 'firebase'), stdio: 'inherit', env: { ...process.env, FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199' } });
  result.on('exit', (code) => process.exit(code ?? 1));
} else {
  await inner();
}

async function inner() {
  const require = createRequire(import.meta.url);
  let playwright;
  try {
    playwright = require('playwright');
  } catch {
    playwright = require(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright');
  }
  const admin = createRequire(path.join(root, 'firebase/functions/node_modules/x.js'));
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  const { initializeApp } = admin('firebase-admin/app');
  const { getFirestore } = admin('firebase-admin/firestore');
  const { getAuth } = admin('firebase-admin/auth');
  const { getStorage } = admin('firebase-admin/storage');
  const { myselfId } = admin(path.join(root, 'firebase/functions/lib/myselfId.js'));
  initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
  const db = getFirestore();
  fs.mkdirSync(SHOTS, { recursive: true });

  const failures = [];
  const ok = (name, cond, detail = '') => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!cond) failures.push(name);
  };

  // People: a project manager, a member of the research team, a research assistant.
  const PM = 'pm@leeds.ac.uk';
  const TEAM = 'researcher@leeds.ac.uk';
  const RA = 'ra@example.org';
  execSync(`node ${path.join(root, 'firebase/scripts/set-portal-admin.mjs')} ${PROJECT} ${PM} "Priya Malik"`, { stdio: 'inherit', env: process.env });
  for (const [email, name, role] of [[TEAM, 'Rae Search', 'researcher'], [RA, 'Ash Assist', 'ra']]) {
    const u = await getAuth().createUser({ email, emailVerified: true });
    await getAuth().setCustomUserClaims(u.uid, { portalRole: role });
    await db.collection('portalUsers').doc(u.uid).set({ email, name, phone: '', requested: role === 'ra' ? 'ra' : 'team', role, status: 'active', smsOptIn: false, archivedAt: null });
  }

  // The website: eight young people at one school, the script's fixture (one opted out later).
  const KIDS = [
    ['w1', 1, 'Amara', 'Ahmed', '2012-05-04', 'LS6 1AB'],
    ['w2', 2, 'Tom', 'Baker', '2012-09-15', 'LS7 2CD'],
    ['w3', 3, 'Lily', 'Evans', '2012-03-07', 'LS8 3EF'],
    ['w4', 4, 'Noah', 'Fitzgerald', '2012-11-20', 'LS9 4GH'],
    ['w5', 5, 'Ella', 'Ward', '2012-06-02', 'BD7 1AB'],
    ['w6', 6, 'Emma', 'Ward', '2012-06-02', 'BD7 1AB'],
    ['w7', 7, 'Sam', 'Lee', '2012-01-25', 'LS1 1AA'],
    ['w8', 8, 'Zara', 'Hussain', '2012-10-10', 'LS2 2BB'],
  ];
  for (const [id, n, first, last, dob, pc] of KIDS) await db.collection('participants').doc(id).set({ kind: 'consent', studyNumber: n, referenceCode: `REF${n}`, firstName: first, lastName: last, dateOfBirth: dob, schoolId: 'GSAL', yearGroup: 'Year 8', guardian: { fullName: 'A Parent', postcode: pc }, createdAt: '2026-10-01T10:00:00Z' });
  await db.collection('meta').doc('counters').set({ participants: 8 }, { merge: true });
  // A class list gives Zara a UPN, which MySelf also has.
  await db.collection('schoolUploads').doc('u1').set({ schoolId: 'GSAL', receivedAt: '2026-10-02T09:00:00Z', pupils: [{ row: 1, upn: 'A123456789012', firstName: 'Zara', lastName: 'Hussain', dateOfBirth: '2012-10-10' }] });

  const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', path.join(root, 'dist-portal-e2e')], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  const BASE = `http://127.0.0.1:${PORT}/tools.html?tool=portal`;
  const browser = await playwright.chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const shot = async (page, name) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  };
  const codeFor = async (email) => {
    const r = await (await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`)).json();
    return (r.oobCodes ?? []).filter((c) => c.email === email && c.requestType === 'EMAIL_SIGNIN').at(-1)?.oobCode;
  };
  const signIn = async (page, email) => {
    await page.goto(BASE);
    await page.locator('#portal-email').fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await page.getByText('Check your email').waitFor();
    await page.goto(`${BASE}&mode=signIn&oobCode=${await codeFor(email)}&apiKey=demo-key&lang=en`);
  };
  const tokenFor = async (email) => {
    await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=demo-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestType: 'EMAIL_SIGNIN', email, continueUrl: BASE }) });
    const r = await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink?key=demo-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, oobCode: await codeFor(email) }) })).json();
    return r.idToken;
  };
  const call = async (token, action, data = {}) => (await fetch(FN, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ data: { ...data, action } }) })).json();
  // A run may find another (the ten-minute check) still going.
  const runNow = async (token) => {
    for (let i = 0; i < 20; i++) {
      const r = await call(token, 'link-run');
      if (r.result?.result) return r.result.result;
      await new Promise((res) => setTimeout(res, 1500));
    }
    return null;
  };

  try {
    const pmToken = await tokenFor(PM);
    const teamToken = await tokenFor(TEAM);
    const raToken = await tokenFor(RA);

    // Roles: a research assistant cannot see the registry; the team cannot unlink.
    ok('a research assistant cannot open the registry', (await call(raToken, 'link-summary')).error?.status === 'PERMISSION_DENIED');
    ok('a research assistant cannot upload EEG names', (await call(raToken, 'link-eeg-upload', { rows: [{ recordingId: 'X' }] })).error?.status === 'PERMISSION_DENIED');

    // MySelf not reachable yet: the page says so, with the command.
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await signIn(page, PM);
    await page.getByRole('link', { name: 'Linkage' }).first().waitFor();
    await page.goto(`${BASE}#linkage/myself`);
    await page.getByText('MySelf not connected').first().waitFor();
    ok('MySelf not connected: the grant command is shown', await page.getByText('grant-myself-read.sh').first().isVisible());
    await shot(page, '01-myself-not-connected');

    // The fake MySelf: nine codes (the script's fixture), with sittings and one UPN.
    const MYS = [
      ['Amara', 'Ahmed', '2012-05-04', 'LS6 1AB', ''],
      ['Thomas', 'Baker', '2012-09-15', '', ''],
      ['Lily', 'Evans', '2012-07-03', '', ''],
      ['Noah', 'Fitzgerlad', '2012-11-20', 'LS9 4GH', ''],
      ['Ema', 'Ward', '2012-06-02', 'BD7 1AB', ''],
      ['Samuel', 'Lee', '2012-01-25', '', ''],
      ['Samantha', 'Lee', '2012-01-25', '', ''],
      ['Zahra', 'Husain', '2012-10-01', '', 'A123456789012'],
      ['Oscar', 'Nobody', '2012-02-02', '', ''],
    ];
    for (const [g, f, d, pc, upn] of MYS) await db.collection('linkFakeMyself').doc(myselfId(g, f, d)).set({ sittings: [{ date: '2026-11-10', release: 'r8.0.0', site: 'GSAL' }], upn: upn || null, givenName: g, familyName: f, dateOfBirth: d, postcode: pc });
    ok('the project manager maps MySelf site GSAL to the school', !(await call(pmToken, 'link-save-settings', { siteMap: { GSAL: 'GSAL' } })).error);
    ok('the team cannot change the settings', (await call(teamToken, 'link-save-settings', { siteMap: {} })).error?.status === 'PERMISSION_DENIED');

    const first = await runNow(teamToken);
    ok('the research team runs matching, MySelf read', first?.myself?.synced === true, JSON.stringify(first));
    const people = (await db.collection('linkPeople').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    const holder = (key) => people.find((p) => p.keys.includes(key))?.id;
    const mk = (g, f, d) => `m:${myselfId(g, f, d)}`;
    ok('every website record has a study ID, in order', KIDS.every(([id]) => holder(`w:${id}`)) && holder('w:w1') === 'sub-0001', people.map((p) => p.id).join(','));
    ok('exact: Amara’s MySelf code joins her website record', holder(mk('Amara', 'Ahmed', '2012-05-04')) === holder('w:w1'));
    ok('variant: Thomas joins Tom', holder(mk('Thomas', 'Baker', '2012-09-15')) === holder('w:w2'));
    ok('variant: Lily with day and month swapped', holder(mk('Lily', 'Evans', '2012-07-03')) === holder('w:w3'));
    ok('UPN: Zahra joins Zara through the class list', holder(mk('Zahra', 'Husain', '2012-10-01')) === holder('w:w8'));
    ok('a typo is not linked on its own', !holder(mk('Noah', 'Fitzgerlad', '2012-11-20')));
    ok('the twins’ MySelf code is not linked on its own', !holder(mk('Ema', 'Ward', '2012-06-02')));
    ok('a MySelf code with no website record gets its own study ID', Boolean(holder(mk('Oscar', 'Nobody', '2012-02-02'))));
    ok('MySelf names are not stored', (await db.collection('linkMyself').get()).docs.every((d) => !('givenName' in d.data()) && !('familyName' in d.data())));

    // The EEG manifest, uploaded through the page (dd/mm/yyyy dates).
    const manifest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eeg-')), 'eeg-manifest.csv');
    fs.writeFileSync(manifest, 'recording_id,first_name,last_name,date_of_birth,sex,ethnicity,recording_date,site,task,file_name\nEEG-0001,Amara,Ahmed,04/05/2012,F,Asian,12/11/2026,GSAL,rest,EEG-0001.bdf\nEEG-0002,Tom,Baker,15/09/2012,M,White,12/11/2026,The Grammar School at Leeds,rest,EEG-0002.bdf\nEEG-0003,Noa,Fitzgerald,20/11/2012,M,White,13/11/2026,GSAL,rest,EEG-0003.bdf\nEEG-0004,Ella,Ward,02/06/2012,F,White,13/11/2026,GSAL,rest,EEG-0004.bdf\nEEG-0005,Kit,Unknown,31/02/2012,M,,13/11/2026,GSAL,rest,\n');
    await page.goto(`${BASE}#linkage/eeg`);
    await page.getByRole('button', { name: 'Download the template' }).waitFor();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download the template' }).click()]);
    ok('the manifest template downloads', download.suggestedFilename() === 'eeg-manifest-template.csv');
    await page.getByTestId('eeg-file').setInputFiles(manifest);
    await page.getByRole('button', { name: 'Add them and match' }).click();
    await page.getByText('4 added, 0 updated').waitFor({ timeout: 30000 });
    ok('a bad date of birth is reported, not stored', await page.getByText(/31\/02\/2012/).first().isVisible());
    await page.waitForTimeout(1500);
    await page.reload();
    await page.getByText('EEG-0001').first().waitFor();
    await shot(page, '02-eeg-recordings');
    const eeg1 = (await db.collection('linkEeg').doc('EEG-0001').get()).data();
    ok('EEG: names kept, date of birth read as dd/mm/yyyy', eeg1?.firstName === 'Amara' && eeg1?.dob === '2012-05-04');
    const after = (await db.collection('linkPeople').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    const holder2 = (key) => after.find((p) => p.keys.includes(key))?.id;
    ok('EEG: Amara’s recording joins her study ID on its own', holder2('e:EEG-0001') === holder2('w:w1'));
    ok('EEG: Tom’s recording joins his (site given by school name)', holder2('e:EEG-0002') === holder2('w:w2'));
    ok('EEG: a twin’s recording is never linked on its own', !holder2('e:EEG-0004'));

    // The overview.
    await page.goto(`${BASE}#linkage`);
    await page.getByText('suggestions to review').waitFor();
    await shot(page, '03-overview');

    // The review queue, walked with the keyboard.
    await page.goto(`${BASE}#linkage/review`);
    await page.getByText('Record without a study ID').waitFor();
    await shot(page, '04-review');
    const queue = (await call(pmToken, 'link-queue')).result.items;
    ok('the queue: twins, the typo and the ambiguous Lees', queue.length >= 5, String(queue.length));
    const firstCard = queue[0];
    // S: same person for the first.
    await page.keyboard.press('s');
    await page.waitForTimeout(2500);
    const decided = (await db.collection('linkDecisions').get()).docs.map((d) => d.data());
    ok('S records "same" and links', decided.some((d) => d.recordKey === firstCard.record.key && d.decision === 'same'));
    // K skips, D says different.
    const shown = await page.locator('.mpmb-link__side').first().innerText();
    await page.keyboard.press('k');
    await page.waitForTimeout(300);
    ok('K skips to the next', (await page.locator('.mpmb-link__side').first().innerText()) !== shown || queue.length < 3);
    await page.keyboard.press('d');
    await page.waitForTimeout(3000);
    ok('D records "different"', (await db.collection('linkDecisions').where('decision', '==', 'different').get()).size >= 1);
    // A "different" is never suggested again.
    const diff = (await db.collection('linkDecisions').where('decision', '==', 'different').get()).docs[0].data();
    await runNow(pmToken);
    const again = (await call(pmToken, 'link-queue')).result.items;
    ok('a "different" pair is never suggested again', !again.some((x) => x.record.key === diff.recordKey && x.person.studyId === diff.studyId));
    // Noah: the fuzzy typo, decided by the team through the API.
    const noahKey = mk('Noah', 'Fitzgerlad', '2012-11-20');
    const noah = again.find((x) => x.record.key === noahKey && x.tier === 'fuzzy');
    if (noah) {
      ok('fuzzy: what it rests on is shown', noah.matchedOn.includes('same postcode'));
      ok('the team can decide', !(await call(teamToken, 'link-decide', { id: noah.id, decision: 'same' })).error);
    } else ok('fuzzy: the typo was offered', queue.some((x) => x.record.key === noahKey), 'it may already have been decided by S');

    // A person's page, with history; the project manager unlinks.
    const amara = holder('w:w1');
    await page.goto(`${BASE}#linkage/person/${amara}`);
    await page.getByRole('heading', { name: amara }).waitFor();
    await shot(page, '05-person');
    ok('the team cannot unlink', (await call(teamToken, 'link-unlink', { studyId: amara, recordKey: 'e:EEG-0001', reason: 'test' })).error?.status === 'PERMISSION_DENIED');
    await page.getByRole('button', { name: 'Unlink…' }).last().click();
    await page.getByLabel('Why is this not them?').fill('Wrong child: the recording was swapped');
    await page.getByRole('button', { name: 'Take it off this study ID' }).click();
    await page.waitForTimeout(3000);
    const amaraNow = (await db.collection('linkPeople').doc(amara).get()).data();
    ok('unlink: the record comes off, with the reason in the history', !amaraNow.keys.includes('e:EEG-0001') && (await db.collection('linkAudit').where('action', '==', 'link-unlink').get()).docs[0]?.data().details.reason.startsWith('Wrong child'));
    ok('unlink: the pair is never suggested again', (await db.collection('linkDecisions').doc((await db.collection('linkDecisions').where('recordKey', '==', 'e:EEG-0001').get()).docs[0].id).get()).data().decision === 'different');

    // Search.
    await page.goto(`${BASE}#linkage`);
    await page.getByLabel(/Study ID, name/).fill('zara');
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByText(holder('w:w8')).first().waitFor();
    ok('search finds by name', true);

    // MySelf, connected now; names shown on request, and logged.
    await page.goto(`${BASE}#linkage/myself`);
    await page.getByText('MySelf connected').waitFor();
    await shot(page, '06-myself-connected');
    const names = await call(teamToken, 'link-myself-names', { code: myselfId('Oscar', 'Nobody', '2012-02-02') });
    ok('a MySelf name on request, logged', names.result?.names?.givenName === 'Oscar' && (await db.collection('linkAudit').where('action', '==', 'link-myself-names').get()).size === 1);

    // A website opt-out withdraws the study ID.
    await db.collection('optOuts').doc('o1').set({ firstName: 'Tom', lastName: 'Baker', dateOfBirth: '2012-09-15', schoolId: 'GSAL', kind: 'data-only', status: 'active', receivedOn: '2026-11-14' });
    await runNow(pmToken);
    const tom = holder('w:w2');
    ok('an opt-out withdraws the study ID', (await db.collection('linkPeople').doc(tom).get()).data().status === 'withdrawn');

    // Stable: another run hands out nothing new.
    const before = (await db.collection('linkPeople').get()).size;
    const quiet = await runNow(pmToken);
    ok('a run with nothing new changes nothing', quiet?.newPeople === 0 && quiet?.autoLinks === 0 && (await db.collection('linkPeople').get()).size === before);

    // The hourly export: linkage/ and the study ID in the website's table.
    const manifestOut = await (await fetch(`http://127.0.0.1:5001/${PROJECT}/europe-west2/exportNow`, { method: 'POST' })).json();
    const files = manifestOut.files ?? [];
    ok('export: linkage files written', ['linkage/participants.tsv', 'linkage/participants.json', 'linkage/eeg_map.tsv', 'linkage/README.md', 'linkage/identifying/crosswalk.tsv'].every((f) => files.includes(f)), files.filter((f) => f.startsWith('linkage')).join(','));
    const out = getStorage().bucket(`${PROJECT}-exports`);
    const read = async (p) => (await out.file(p).download())[0].toString('utf8');
    const lp = await read('linkage/participants.tsv');
    ok('participants.tsv: no names, no withdrawn', !/Amara|Ahmed|Baker/.test(lp) && !lp.includes(`${tom}\t`), lp.split('\n')[0]);
    const map = await read('linkage/eeg_map.tsv');
    ok('eeg_map.tsv: a suggested BIDS path, and withdrawn marked', /sub-\d{4}\/ses-01\/eeg\/sub-\d{4}_ses-01_task-rest_eeg\.bdf/.test(map) && /EEG-0002\t.*\twithdrawn\t/.test(map), map);
    const cw = await read('linkage/identifying/crosswalk.tsv');
    ok('crosswalk.tsv: study ID to website label, MySelf code, EEG id', cw.includes('sub-00001') && cw.includes(myselfId('Amara', 'Ahmed', '2012-05-04')));
    const website = await read('schools/donations/participants.tsv');
    ok('the website’s participants.tsv carries the study ID', website.split('\n')[0].split('\t').includes('linkage_id') && website.includes(`\t${holder('w:w1')}\t`));

    // History, on a phone.
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
    await signIn(phone, TEAM);
    await phone.getByRole('link', { name: 'Linkage' }).first().waitFor();
    await phone.goto(`${BASE}#linkage/review`);
    await phone.waitForTimeout(2500);
    await shot(phone, '07-review-phone');
    await phone.goto(`${BASE}#linkage/audit`);
    await phone.getByText('link-unlink').first().waitFor();
    await shot(phone, '08-history-phone');
  } catch (error) {
    failures.push(String(error?.stack ?? error));
    console.error(error);
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures.length ? `\n${failures.length} FAILED:\n${failures.join('\n')}` : '\nAll linkage checks passed.');
  process.exit(failures.length ? 1 : 0);
}
