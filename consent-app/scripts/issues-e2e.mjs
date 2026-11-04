// End-to-end test of the issue log ("Log a problem" and the Notebook) against
// the Firebase emulators: a research assistant on a phone logs a problem at
// today's visit, then another with no connection (queued, sent when back);
// the same entry sent twice is stored once; the team resolves the pupil the
// assistant typed, comments and marks it handled; the rules on who sees and
// changes what; the 6 pm email; the export's issues tables.
// Screenshots go to ISSUE_SHOTS (default ./issue-shots).
//
//   node scripts/issues-e2e.mjs
//
// Needs what portal-e2e.mjs needs: firebase-tools, Java, the functions built,
// Playwright with Chromium.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PROJECT = 'demo-mpmb';
const BUCKET = `${PROJECT}.appspot.com`;
const PORT = 8442;
const AUTH = 'http://127.0.0.1:9099';
const FN = `http://127.0.0.1:5001/${PROJECT}/europe-west2/portalApi`;
const SHOTS = process.env.ISSUE_SHOTS ?? path.join(root, 'issue-shots');

if (process.env.MPMB_E2E_INNER !== '1') {
  if (!process.env.SKIP_BUILD) {
    console.log('Building the app against the emulators…');
    const env = { ...process.env, VITE_MPMB_BACKEND: 'firebase', VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1:4000', VITE_FIREBASE_API_KEY: 'demo-key', VITE_FIREBASE_PROJECT_ID: PROJECT, VITE_FIREBASE_APP_ID: '1:demo:web:demo', VITE_FIREBASE_AUTH_DOMAIN: `${PROJECT}.firebaseapp.com`, VITE_FIREBASE_STORAGE_BUCKET: BUCKET };
    execSync('npx vite build --mode emulator --outDir dist-portal-e2e', { cwd: root, stdio: 'inherit', env });
  }
  const result = spawn('firebase', ['emulators:exec', '--project', PROJECT, '--only', 'auth,functions,firestore,storage', `MPMB_E2E_INNER=1 ISSUE_SHOTS="${SHOTS}" node ${path.join(root, 'scripts/issues-e2e.mjs')}`], { cwd: path.join(root, 'firebase'), stdio: 'inherit', env: { ...process.env, FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199' } });
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
  initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
  const db = getFirestore();
  fs.mkdirSync(SHOTS, { recursive: true });

  const failures = [];
  const ok = (name, cond, detail = '') => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!cond) failures.push(name);
  };

  const PM = 'pm@leeds.ac.uk';
  const TEAM = 'researcher@leeds.ac.uk';
  const RA = 'ra@example.org';
  const RA2 = 'ra2@example.org';
  execSync(`node ${path.join(root, 'firebase/scripts/set-portal-admin.mjs')} ${PROJECT} ${PM} "Priya Malik"`, { stdio: 'inherit', env: process.env });
  const uids = {};
  for (const [email, name, role] of [[TEAM, 'Rae Search', 'researcher'], [RA, 'Ash Assist', 'ra'], [RA2, 'Bo Other', 'ra']]) {
    const u = await getAuth().createUser({ email, emailVerified: true });
    uids[email] = u.uid;
    await getAuth().setCustomUserClaims(u.uid, { portalRole: role });
    await db.collection('portalUsers').doc(u.uid).set({ email, name, phone: '', requested: role === 'ra' ? 'ra' : 'team', role, status: 'active', smsOptIn: false, archivedAt: null });
  }

  // Today's visit to the Grammar School at Leeds, with the assistant confirmed on it.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  await db.collection('portalVisits').doc('v-today').set({ schoolId: 'GSAL', startDate: today, endDate: today, start: '08:30', end: '15:00', days: [{ date: today, start: '08:30', end: '15:00', on: true }], location: 'Sports hall', roleNeeds: { eeg: 2, copro: 1, lead: 1 }, travel: {}, status: 'confirmed', date: today, lastDate: today, version: 1 });
  await db.collection('portalAssignments').doc(`v-today_${uids[RA]}`).set({ visitId: 'v-today', uid: uids[RA], status: 'confirmed', role: 'eeg', dates: [today] });
  // Two young people in the registry (website records), and their EEG recordings today.
  for (const [id, n, first, last, dob] of [['w1', 1, 'Amara', 'Ahmed', '2012-05-04'], ['w2', 2, 'Tom', 'Baker', '2012-09-15']]) await db.collection('participants').doc(id).set({ kind: 'consent', studyNumber: n, referenceCode: `REF${n}`, firstName: first, lastName: last, dateOfBirth: dob, schoolId: 'GSAL', yearGroup: 'Year 8', guardian: { postcode: 'LS6 1AB' }, createdAt: '2026-10-01T10:00:00Z' });

  const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', path.join(root, 'dist-portal-e2e')], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  const BASE = `http://127.0.0.1:${PORT}/tools.html?tool=portal`;
  const browser = await playwright.chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const shot = async (page, name, full = true) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
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
  const issues = async () => (await db.collection('portalIssues').get()).docs.map((d) => ({ id: d.id, ...d.data() }));

  try {
    const pmToken = await tokenFor(PM);
    const teamToken = await tokenFor(TEAM);
    const raToken = await tokenFor(RA);
    const ra2Token = await tokenFor(RA2);
    // The registry: study IDs for the two, and today's recordings.
    for (let i = 0; i < 20 && !(await call(pmToken, 'link-run')).result; i++) await new Promise((r) => setTimeout(r, 1500));
    await call(pmToken, 'link-eeg-upload', { rows: [{ recordingId: 'EEG-0101', firstName: 'Amara', lastName: 'Ahmed', dob: '04/05/2012', recordingDate: today.split('-').reverse().join('/'), site: 'GSAL', task: 'rest' }, { recordingId: 'EEG-0102', firstName: 'Tom', lastName: 'Baker', dob: '15/09/2012', recordingDate: today.split('-').reverse().join('/'), site: 'GSAL', task: 'rest' }] });
    const amara = (await db.collection('linkPeople').where('keys', 'array-contains', 'w:w1').get()).docs[0]?.id;
    ok('the registry has study IDs', Boolean(amara), amara);

    // 1. The assistant, on a phone: the button on every screen, the form, today's visit chosen.
    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const phone = await phoneCtx.newPage();
    await signIn(phone, RA);
    await phone.getByTestId('log-problem').waitFor();
    await shot(phone, '01-button-phone', false);
    await phone.getByTestId('log-problem').click();
    await phone.getByRole('dialog').waitFor();
    await phone.waitForTimeout(1200);
    ok('the form opens on today’s visit', (await phone.locator('#issue-visit').inputValue()) === 'v-today');
    ok('the safeguarding line is on the form', await phone.getByText('Worried about a child’s safety or welfare?').isVisible());
    ok('there is no safeguarding type to choose', !(await phone.getByRole('button', { name: /safeguarding/i }).count()));
    await phone.getByLabel('Pupil’s first name and surname').fill('Amara Ahmed');
    await phone.getByRole('button', { name: 'Add', exact: true }).click();
    await phone.getByRole('button', { name: 'Headset/EEG signal' }).click();
    await phone.getByRole('button', { name: 'May affect data' }).click();
    await phone.locator('#issue-note').fill('Cap kept slipping on the left; re-gelled twice.');
    await phone.locator('#issue-note').scrollIntoViewIfNeeded();
    await shot(phone, '02-form-phone', false);
    await phone.locator('.mpmb-issue__panel').evaluate((el) => el.scrollTo(0, 0));
    await shot(phone, '02a-form-top-phone', false);
    await phone.getByRole('button', { name: 'Save', exact: true }).click();
    await phone.getByText(/^Logged at \d\d:\d\d\.$/).waitFor();
    await shot(phone, '03-logged-phone', false);
    let all = await issues();
    ok('logged online: stored with the device time and the server time', all.length === 1 && all[0].deviceAt && all[0].receivedAt && all[0].visitId === 'v-today' && all[0].schoolId === 'GSAL');
    ok('the typed name is kept for the team to resolve', all[0].about?.[0]?.kind === 'typed' && all[0].about[0].name === 'Amara Ahmed');

    // 2. No connection: queued on the phone, with its own time, and sent when back.
    await phoneCtx.setOffline(true);
    await phone.getByRole('button', { name: 'Noise/interruption' }).click();
    await phone.getByRole('button', { name: 'Minor' }).click();
    await phone.getByRole('button', { name: '+ Whole room/session' }).click();
    await phone.locator('#issue-note').fill('Fire alarm test at 10:40, two minutes.');
    await phone.getByRole('button', { name: 'Save', exact: true }).click();
    await phone.getByText(/Saved on this phone at/).waitFor({ timeout: 20000 });
    await phone.getByRole('button', { name: 'Close' }).click();
    await phone.getByText('1 waiting to send').first().waitFor();
    await shot(phone, '04-offline-badge-phone', false);
    ok('offline: nothing reached the server', (await issues()).length === 1);
    const queuedAt = Date.now();
    await new Promise((r) => setTimeout(r, 2000));
    await phoneCtx.setOffline(false);
    await phone.evaluate(() => window.dispatchEvent(new Event('online')));
    for (let i = 0; i < 30 && (await issues()).length < 2; i++) await new Promise((r) => setTimeout(r, 1000));
    all = await issues();
    const late = all.find((i) => i.type === 'noise');
    ok('back online: the queued entry is sent', Boolean(late));
    ok('…with the time it was logged, not when it arrived', late && Date.parse(late.deviceAt) < queuedAt && Date.parse(late.receivedAt) > Date.parse(late.deviceAt) + 1000, late ? `${late.deviceAt} / ${late.receivedAt}` : '');
    await phone.waitForTimeout(1500);
    ok('the badge goes', !(await phone.getByText('waiting to send').count()));

    // 3. Idempotent: the same id twice is one entry.
    const entry = { id: 'e2e-retry-00000001', deviceAt: new Date(Date.now() - 60_000).toISOString(), visitId: 'v-today', type: 'equipment', impact: 'unusable', note: 'Laptop crashed mid-task', about: [], recordings: ['EEG-0102'] };
    const first = await call(raToken, 'issue-log', { entry });
    const second = await call(raToken, 'issue-log', { entry: { ...entry, note: 'again' } });
    ok('a retry is one entry', first.result?.duplicate === false && second.result?.duplicate === true && (await issues()).length === 3);

    // 4. Who sees and changes what.
    const raList = (await call(raToken, 'issue-list')).result?.issues ?? [];
    const ra2List = (await call(ra2Token, 'issue-list')).result?.issues ?? [];
    ok('an assistant sees their own entries; another assistant sees none of them', raList.length === 3 && ra2List.length === 0);
    ok('an assistant cannot change the status', (await call(raToken, 'issue-status', { id: entry.id, status: 'handled' })).error?.status === 'PERMISSION_DENIED');
    ok('another assistant cannot comment', (await call(ra2Token, 'issue-comment', { id: entry.id, text: 'x' })).error?.status === 'PERMISSION_DENIED');
    ok('an assistant edits their own entry within 24 hours', !(await call(raToken, 'issue-edit', { id: entry.id, entry: { ...entry, note: 'Laptop crashed mid-task; restarted.' } })).error);
    await db.collection('portalIssues').doc(entry.id).update({ receivedAt: new Date(Date.now() - 25 * 3600_000).toISOString() });
    ok('…and not after', (await call(raToken, 'issue-edit', { id: entry.id, entry: { ...entry, note: 'later' } })).error?.status === 'PERMISSION_DENIED');
    const edited = (await db.collection('portalIssues').doc(entry.id).get()).data();
    ok('an edit keeps the original note in the history', edited.history?.[0]?.changes?.note?.from === 'Laptop crashed mid-task');

    // 5. The team: the notebook, resolving the typed pupil, a comment, handled.
    const desk = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await signIn(desk, TEAM);
    await desk.getByRole('link', { name: 'Notebook' }).first().waitFor();
    await desk.goto(`${BASE}#notebook`);
    await desk.getByText('Cap kept slipping').first().waitFor();
    await shot(desk, '05-notebook');
    const capId = all.find((i) => i.type === 'eeg').id;
    await desk.goto(`${BASE}#notebook/${capId}`);
    await desk.getByRole('button', { name: 'Resolve pupil' }).click();
    await desk.getByRole('button', { name: new RegExp(`Amara A\\. · ${amara}`) }).click();
    await desk.waitForTimeout(1500);
    const resolved = (await db.collection('portalIssues').doc(capId).get()).data();
    ok('the team resolves the typed pupil to a study ID', resolved.about[0].studyId === amara);
    await desk.getByPlaceholder('Add a comment').fill('Check channel T7 in this recording.');
    await desk.getByRole('button', { name: 'Comment' }).click();
    await desk.getByText('Check channel T7').waitFor();
    await desk.getByRole('button', { name: 'Handled in analysis' }).click();
    await desk.locator('#issue-resolution').fill('T7 interpolated for this pupil.');
    await desk.getByRole('button', { name: 'Save status' }).click();
    await desk.waitForTimeout(1500);
    const handled = (await db.collection('portalIssues').doc(capId).get()).data();
    ok('comment and status saved', handled.comments.length === 1 && handled.status === 'handled' && handled.resolution.startsWith('T7'));
    await shot(desk, '06-entry');

    // 6. The 6 pm email, sent now by the project manager; captured from its log.
    const dig = await call(pmToken, 'issue-digest-now', {});
    const sent = (await db.collection('portalDigests').get()).docs.map((d) => d.data());
    ok('the daily email goes to brainpop@ and the PI by default', dig.result?.sent === true && JSON.stringify(sent[0]?.to) === JSON.stringify(['brainpop@leeds.ac.uk', 'f.mushtaq@leeds.ac.uk']), JSON.stringify(dig));
    const text = sent[0]?.text ?? '';
    ok('…counts first, data unusable first, pupils as first name and initial', text.indexOf('in all') < text.indexOf('DATA UNUSABLE') && text.indexOf('Laptop crashed') < text.indexOf('Fire alarm') && text.includes('Amara A.'), text.slice(0, 400));
    const mail = (await db.collection('portalMail').where('kind', '==', 'issue-digest').get()).docs.map((d) => d.data());
    ok('…logged in the mail log, brainpop@ not copied twice', mail.length === 1 && !String(mail[0].cc ?? '').toLowerCase().includes('brainpop@'), JSON.stringify(mail[0]));
    ok('the team cannot send it', (await call(teamToken, 'issue-digest-now', {})).error?.status === 'PERMISSION_DENIED');

    // 7. The export: research rows with study IDs, never the typed name; the identifying rows with it.
    const manifest = await (await fetch(`http://127.0.0.1:5001/${PROJECT}/europe-west2/exportNow`, { method: 'POST' })).json();
    ok('export: the issues tables', ['linkage/issues.tsv', 'linkage/issues.json', 'linkage/identifying/issues.tsv'].every((f) => manifest.files?.includes(f)));
    const out = getStorage().bucket(`${PROJECT}-exports`);
    const research = (await out.file('linkage/issues.tsv').download())[0].toString('utf8');
    const identifying = (await out.file('linkage/identifying/issues.tsv').download())[0].toString('utf8');
    ok('research: study IDs and recordings, no names', research.includes(amara) && research.includes('EEG-0102') && !research.includes('Amara') && !research.includes('Ash Assist'), research.split('\n')[0]);
    ok('identifying: the typed name and the author', identifying.includes('Amara Ahmed') && identifying.includes('Ash Assist'));

    // 8. The notebook on the phone, as the assistant sees it.
    await phone.goto(`${BASE}#notebook`);
    await phone.getByText('Fire alarm').first().waitFor();
    await shot(phone, '07-notebook-phone');
  } catch (error) {
    failures.push(String(error?.stack ?? error));
    console.error(error);
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures.length ? `\n${failures.length} FAILED:\n${failures.join('\n')}` : '\nAll issue log checks passed.');
  process.exit(failures.length ? 1 : 0);
}
