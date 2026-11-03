// End-to-end test of the staff portal (/portal/) against the Firebase
// emulator suite: a project manager, a research team member and a research
// assistant sign in with email links, ask for accounts and are approved; the
// assistant uploads documents and marks availability; the project manager
// checks the documents; the team records training and pilots, adds a visit,
// chooses the assistant and locks them in; the assistant confirms. Then the
// stored records, the emails, the notifications and the audit log are
// checked, along with what each role must NOT be able to do, and the
// retention clean-up. Screenshots go to PORTAL_SHOTS (default ./portal-shots).
//
//   node scripts/portal-e2e.mjs
//
// Needs: firebase-tools on PATH, Java, the functions built (npm --prefix
// firebase/functions run build), and Playwright with Chromium.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PROJECT = 'demo-mpmb';
const BUCKET = `${PROJECT}.appspot.com`;
const PORT = 8440;
const AUTH = 'http://127.0.0.1:9099';
const FN = `http://127.0.0.1:5001/${PROJECT}/europe-west2/portalApi`;
const SHOTS = process.env.PORTAL_SHOTS ?? path.join(root, 'portal-shots');

if (process.env.MPMB_E2E_INNER !== '1') {
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
  execSync('npx vite build --mode emulator --outDir dist-portal-e2e', { cwd: root, stdio: 'inherit', env });
  const result = spawn('firebase', ['emulators:exec', '--project', PROJECT, '--only', 'auth,functions,firestore,storage', `MPMB_E2E_INNER=1 PORTAL_SHOTS="${SHOTS}" node ${path.join(root, 'scripts/portal-e2e.mjs')}`], {
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
  const { getStorage } = admin('firebase-admin/storage');
  initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
  const db = getFirestore();
  const bucket = getStorage().bucket();
  fs.mkdirSync(SHOTS, { recursive: true });

  const failures = [];
  const ok = (name, cond, detail = '') => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!cond) failures.push(name);
  };

  const PM = 'pm@leeds.ac.uk';
  const TEAM = 'researcher@leeds.ac.uk';
  const RA = 'sam.reed@example.org';
  execSync(`node ${path.join(root, 'firebase/scripts/set-portal-admin.mjs')} ${PROJECT} ${PM} "Priya Malik"`, { stdio: 'inherit', env: process.env });

  const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', path.join(root, 'dist-portal-e2e')], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  const BASE = `http://127.0.0.1:${PORT}/tools.html?tool=portal`;

  const browser = await playwright.chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const desktop = { viewport: { width: 1280, height: 900 } };
  const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  const shot = async (page, name) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  };

  // The newest sign-in link the auth emulator "sent" to an address.
  const codeFor = async (email) => {
    const r = await (await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`)).json();
    const mine = (r.oobCodes ?? []).filter((c) => c.email === email && c.requestType === 'EMAIL_SIGNIN');
    return mine.at(-1)?.oobCode;
  };
  const signIn = async (page, email) => {
    await page.goto(BASE);
    await page.locator('#portal-email').fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await page.getByText('Check your email').waitFor();
    const code = await codeFor(email);
    await page.goto(`${BASE}&mode=signIn&oobCode=${code}&apiKey=demo-key&lang=en`);
  };
  // A token for direct calls (the negative checks).
  const tokenFor = async (email) => {
    await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=demo-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestType: 'EMAIL_SIGNIN', email, continueUrl: BASE }) });
    const code = await codeFor(email);
    const r = await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink?key=demo-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, oobCode: code }) })).json();
    return r.idToken;
  };
  const call = async (token, action, data = {}) => {
    const r = await fetch(FN, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ data: { ...data, action } }) });
    return r.json();
  };

  // A visit a little ahead: Monday to Thursday, with the Tuesday off and the Wednesday shorter.
  const visitDate = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 10);
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const plus = (iso, n) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const [mon, tue, wed, thu] = [0, 1, 2, 3].map((n) => plus(visitDate, n));
  const shortDate = (iso) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
  const longDate = (iso) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

  try {
    /* ── Accounts ── */
    const pmCtx = await browser.newContext(desktop);
    const pm = await pmCtx.newPage();
    await signIn(pm, PM);
    await pm.getByText('Priya Malik · Project manager').waitFor();
    ok('the project manager signs in with the email link', true);

    const raCtx = await browser.newContext(mobile);
    const ra = await raCtx.newPage();
    await shot(ra, 'mobile-01-sign-in');
    await signIn(ra, RA);
    await ra.getByRole('heading', { name: 'Ask for an account' }).waitFor();
    await ra.locator('#ra-name').fill('Sam Reed');
    await ra.locator('#ra-phone').fill('07700 900123');
    await shot(ra, 'mobile-02-ask-for-account');
    await ra.getByRole('button', { name: 'Ask for an account' }).click();
    await ra.getByText('waiting for the project manager').waitFor();
    ok('a research assistant asks for an account and waits', true);

    const teamCtx = await browser.newContext(desktop);
    const team = await teamCtx.newPage();
    await signIn(team, TEAM);
    await team.getByRole('heading', { name: 'Ask for an account' }).waitFor();
    await team.locator('#ra-name').fill('Robin Chen');
    await team.getByLabel('A member of the research team').check();
    await team.getByRole('button', { name: 'Ask for an account' }).click();
    await team.getByText('waiting for the project manager').waitFor();

    const raToken0 = await tokenFor(RA);
    const pending = await call(raToken0, 'my-summary');
    ok('a pending account cannot see anything yet', pending.error?.status === 'PERMISSION_DENIED', JSON.stringify(pending.error ?? {}));

    await pm.reload();
    await pm.getByText('2 accounts to approve').waitFor();
    await shot(pm, 'desktop-01-pm-overview');
    await pm.goto(`${BASE}#people`);
    await pm.getByText('Asking for an account').waitFor();
    await shot(pm, 'desktop-02-pm-approve');
    const approve = async (name) => {
      const row = pm.locator('li', { hasText: name }).filter({ has: pm.getByRole('button', { name: 'Approve' }) });
      await row.getByRole('button', { name: 'Approve' }).click();
      await pm.locator('li', { hasText: name }).getByRole('button', { name: 'Approve' }).waitFor({ state: 'detached' });
    };
    await approve('Sam Reed');
    await approve('Robin Chen');
    const users = Object.fromEntries((await db.collection('portalUsers').get()).docs.map((d) => [d.data().email, { uid: d.id, ...d.data() }]));
    ok('approval sets the roles asked for', users[RA]?.role === 'ra' && users[TEAM]?.role === 'researcher' && users[RA]?.status === 'active');
    const raUid = users[RA].uid;

    /* ── The research assistant gets ready ── */
    await ra.getByRole('button', { name: 'Check again' }).click();
    await ra.getByRole('heading', { name: 'Getting ready for school visits' }).waitFor();
    await shot(ra, 'mobile-03-ra-checklist');
    await ra.goto(`${BASE}#documents`);
    await ra.getByRole('heading', { name: 'Everyone needs' }).waitFor();
    for (const id of ['dbs', 'health', 'safeguarding']) {
      await ra.locator(`#doc-${id}-all`).setInputFiles({ name: `${id}.pdf`, mimeType: 'application/pdf', buffer: pdf });
      await ra.locator('.mpmb-portal__doc', { has: ra.locator(`#doc-${id}-all`) }).getByText('Waiting to be checked').waitFor({ timeout: 20000 });
    }
    await shot(ra, 'mobile-04-ra-documents');
    const docs = (await db.collection('portalDocs').where('uid', '==', raUid).get()).docs;
    ok('three documents uploaded and registered', docs.length === 3 && docs.every((d) => d.data().status === 'uploaded'));
    const [stored] = await bucket.getFiles({ prefix: `portal/docs/${raUid}/` });
    ok('the copies are in Storage under the person', stored.length === 3);

    await ra.goto(`${BASE}#availability`);
    await ra.getByRole('button', { name: 'Save my availability' }).waitFor();
    const label = `${longDate(visitDate)}: not set`;
    for (let i = 0; i < 3 && !(await ra.getByRole('button', { name: label }).count()); i += 1) await ra.getByRole('button', { name: 'Next month' }).click();
    await ra.getByRole('button', { name: label }).click();
    await ra.getByRole('button', { name: 'Save my availability' }).click();
    await ra.getByText('Saved 1 day').waitFor();
    await shot(ra, 'mobile-05-ra-availability');
    const avail = await db.collection('portalAvailability').doc(`${raUid}_${visitDate}`).get();
    ok('availability saved for the visit day', avail.data()?.value === 'all');

    /* ── What a researcher and an assistant must not do ── */
    const teamToken = await tokenFor(TEAM);
    const raToken = await tokenFor(RA);
    const deniedCopy = await call(teamToken, 'document-url', { docId: docs[0].id });
    ok('the research team cannot open document copies', deniedCopy.error?.status === 'PERMISSION_DENIED', JSON.stringify(deniedCopy.error ?? {}));
    const deniedVerify = await call(teamToken, 'verify-document', { docId: docs[0].id, decision: 'verified' });
    ok('the research team cannot check documents', deniedVerify.error?.status === 'PERMISSION_DENIED');
    const teamPerson = await call(teamToken, 'person', { uid: raUid });
    ok('the research team sees where documents stand, without the details', teamPerson.result?.documents?.length >= 3 && teamPerson.result.documents.every((d) => !('details' in d)) && teamPerson.result.history.length === 0);
    const deniedPeople = await call(raToken, 'people');
    ok('a research assistant cannot list other people', deniedPeople.error?.status === 'PERMISSION_DENIED');
    const deniedPerson = await call(raToken, 'person', { uid: users[TEAM].uid });
    ok('a research assistant cannot see another person', deniedPerson.error?.status === 'PERMISSION_DENIED');
    const direct = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/portalDocs/${docs[0].id}`, { headers: { authorization: `Bearer ${raToken}` } });
    ok('nobody reads the portal’s records directly', direct.status === 403, String(direct.status));
    const file = await fetch(`http://127.0.0.1:9199/v0/b/${BUCKET}/o/${encodeURIComponent(docs[0].data().path)}?alt=media`, { headers: { authorization: `Firebase ${raToken}` } });
    ok('nobody reads the copies directly, not even their owner', file.status === 403, String(file.status));
    const anon = await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    const anonCall = await call(anon.idToken, 'me');
    ok('an anonymous session (the participant pages) is turned away', anonCall.error?.status === 'UNAUTHENTICATED');
    const ownCopy = await call(raToken, 'document-url', { docId: docs[0].id });
    ok('the owner can open their own copy through the portal', typeof ownCopy.result?.url === 'string');

    /* ── The project manager checks the documents ── */
    await pm.goto(`${BASE}#person/${raUid}`);
    await pm.getByRole('heading', { name: 'Sam Reed' }).waitFor();
    await shot(pm, 'desktop-03-pm-check-documents');
    const card = (has) => pm.locator('.mpmb-portal__doc', { has });
    await pm.locator('#chk-dbs-all-num').fill('001234567890');
    await pm.locator('#chk-dbs-all-issue').fill('2025-09-01');
    await card(pm.locator('#chk-dbs-all-num')).getByRole('button', { name: 'Accept' }).click();
    await card(pm.getByText('Enhanced DBS certificate')).locator('.mpmb-portal__badge', { hasText: /^Checked$/ }).waitFor();
    await card(pm.locator('#chk-health-all-note')).getByRole('button', { name: 'Accept' }).click();
    await card(pm.getByText('Health form')).locator('.mpmb-portal__badge', { hasText: /^Checked$/ }).waitFor();
    await pm.locator('#chk-safeguarding-all-exp').fill('2028-09-01');
    await card(pm.locator('#chk-safeguarding-all-exp')).getByRole('button', { name: 'Accept' }).click();
    await card(pm.getByText('Safeguarding training certificate')).locator('.mpmb-portal__badge', { hasText: /^Checked$/ }).waitFor();
    await shot(pm, 'desktop-04-pm-documents-checked');
    const checked = (await db.collection('portalDocs').where('uid', '==', raUid).get()).docs.map((d) => d.data());
    ok('documents checked, with the DBS details recorded', checked.every((d) => d.status === 'verified') && checked.find((d) => d.typeId === 'dbs')?.details?.certificateNumber === '001234567890');
    const pmToken = await tokenFor(PM);
    const pmCopy = await call(pmToken, 'document-url', { docId: docs[0].id });
    ok('the project manager can open a copy', typeof pmCopy.result?.url === 'string');

    /* ── The team: training, pilots, a visit, staffing ── */
    await team.getByRole('button', { name: 'Check again' }).click();
    await team.getByText('Robin Chen · Research team').waitFor();
    await team.goto(`${BASE}#sessions`);
    const record = async (kind, title) => {
      await team.locator('#s-kind').selectOption(kind);
      await team.locator('#s-title').fill(title);
      await team.getByLabel('Sam Reed').check();
      await team.getByRole('button', { name: 'Save' }).click();
      await team.getByText(title).first().waitFor();
    };
    await record('training', 'EEG set-up training');
    await record('training', 'Safeguarding in schools');
    await record('pilot', 'Pilot session at the lab');
    await shot(team, 'desktop-05-team-training');
    await team.goto(`${BASE}#people`);
    await team.locator('li', { hasText: 'Sam Reed' }).getByText('Documents and training done', { exact: true }).waitFor();
    await shot(team, 'desktop-06-team-people');
    ok('the assistant shows as ready once documents, training and pilots are done', true);

    /* ── The team keeps its own details: status, experience, jobs, notes ── */
    await team.goto(`${BASE}#person/${raUid}`);
    await team.getByRole('heading', { name: 'Status, experience and jobs' }).waitFor();
    await team.locator('form', { has: team.locator('#pe-level') }).getByLabel('Ready', { exact: true }).check();
    await team.locator('form', { has: team.locator('#pe-level') }).getByLabel('In training', { exact: true }).check();
    await team.locator('#pe-level').selectOption('3');
    await team.locator('#pe-reason').fill('Led two pilot days');
    await team.locator('form', { has: team.locator('#pe-level') }).getByLabel('EEG', { exact: true }).check();
    await team.locator('#pe-avail').fill('No Friday afternoons');
    await team.getByRole('button', { name: 'Save', exact: true }).click();
    await team.getByText('Level 3: Experienced').first().waitFor();
    await team.locator('#note-new').fill('Very calm with nervous pupils; ask about leading next term.');
    await team.getByRole('button', { name: 'Add the note' }).click();
    await team.getByText('Very calm with nervous pupils').waitFor();
    const samUser = (await db.collection('portalUsers').doc(raUid).get()).data();
    ok('the team sets status tags, experience, jobs and availability notes', samUser.level === 3 && samUser.tags.includes('ready') && samUser.capabilities.join() === 'eeg' && samUser.availabilityNote === 'No Friday afternoons', JSON.stringify(samUser));
    const noteRows = (await db.collection('portalNotes').get()).docs.map((d) => d.data()).filter((n) => n.uid === raUid);
    const noteAudit = (await db.collection('portalAudit').get()).docs.map((d) => d.data().action);
    ok('team notes are dated, with who wrote them, and audited', noteRows.some((n) => n.byName === 'Robin Chen' && n.at) && noteAudit.includes('add-note') && noteAudit.includes('edit-person'), JSON.stringify([noteRows, noteAudit]));

    team.on('dialog', (d) => void d.accept());
    pm.on('dialog', (d) => void d.accept());
    await team.goto(`${BASE}#visits`);
    await team.locator('#v-school').selectOption('GSAL');
    await team.locator('#v-location').fill('Main reception, Alwoodley Gates');
    await team.locator('#v-from').fill(mon);
    await team.locator('#v-to').fill(thu);
    await team.locator('#v-eeg').fill('1');
    await team.locator('#v-copro').fill('0');
    await team.getByLabel(`${longDate(tue)}: the visit runs`).uncheck();
    await team.getByLabel(`${longDate(wed)}: start`).fill('09:00');
    await team.getByLabel(`${longDate(wed)}: end`).fill('12:00');
    await shot(team, 'desktop-13-team-visit-form');
    await team.getByRole('button', { name: 'Add the visit' }).click();
    await team.getByRole('heading', { name: 'Choose who to ask' }).waitFor();
    const visit = (await db.collection('portalVisits').get()).docs[0];
    const vd = visit.data();
    ok('a visit over a period: the Tuesday off, the Wednesday with its own times, the place kept', vd.days.length === 4 && vd.days.filter((d) => d.on).map((d) => d.date).join() === [mon, wed, thu].join() && vd.days.find((d) => d.date === wed).start === '09:00' && vd.location === 'Main reception, Alwoodley Gates' && vd.date === mon && vd.lastDate === thu, JSON.stringify(vd.days));

    /* ── Provisional dates: asking who could do them ── */
    await team.locator('select[aria-label="Visit status"]').selectOption('provisional');
    await team.getByText('Status changed.').waitFor();
    // An email to them, or one they are in blind copy on (announcements to everyone go as one email).
    const raMail = async () => (await db.collection('portalMail').get()).docs.map((d) => d.data()).filter((m) => m.to === RA || String(m.bcc ?? '').split(', ').includes(RA));
    const pushes = async () => (await db.collection('portalPushLog').where('uid', '==', raUid).get()).docs.map((d) => d.data());
    ok('putting dates out as provisional emails and pushes every research assistant', (await raMail()).some((m) => m.kind === 'dates-provisional' && /not yet confirmed/.test(m.subject)) && (await pushes()).some((p) => /^Possible school dates \(not yet confirmed\): The Grammar School at Leeds/.test(p.body)), JSON.stringify(await pushes()));
    ok('the push carries only the school and the dates', (await pushes()).every((p) => !/Sam|Reed|sam\.reed/.test(JSON.stringify(p))));
    const provOffer = await call(teamToken, 'offer', { visitId: visit.id, offers: [{ uid: raUid, role: 'eeg', dates: [mon] }] });
    ok('no offers while the dates are provisional', /provisional/.test(provOffer.error?.message ?? ''), JSON.stringify(provOffer.error ?? {}));
    await ra.goto(`${BASE}#offers`);
    await ra.getByText('Provisional — not confirmed').waitFor();
    await ra.getByRole('radiogroup', { name: `${longDate(mon)}: could you do it?` }).getByRole('radio', { name: 'Can do' }).click();
    await ra.getByRole('radiogroup', { name: `${longDate(wed)}: could you do it?` }).getByRole('radio', { name: 'Maybe' }).click();
    await ra.getByRole('radiogroup', { name: `${longDate(thu)}: could you do it?` }).getByRole('radio', { name: 'Can’t do' }).click();
    await shot(ra, 'mobile-11-ra-provisional');
    await ra.getByRole('button', { name: 'Send my answers' }).click();
    await ra.getByText('Thank you: sent.').waitFor();
    const answers = (await db.collection('portalCanvass').doc(`${visit.id}_${raUid}`).get()).data()?.answers ?? {};
    const availThu = (await db.collection('portalAvailability').doc(`${raUid}_${thu}`).get()).data();
    ok('answers kept day by day, and as availability', answers[mon] === 'yes' && answers[wed] === 'maybe' && answers[thu] === 'no' && availThu?.value === 'no' && availThu?.visitId === visit.id, JSON.stringify(answers));
    await team.reload();
    await team.getByRole('heading', { name: 'Who could do these provisional dates' }).waitFor();
    await shot(team, 'desktop-14-team-canvass');
    const canvass = (await call(teamToken, 'visit', { visitId: visit.id })).result?.canvass ?? [];
    ok('the team sees, per day, who can, might and can’t', canvass.length === 3 && canvass[0].yes.includes('Sam Reed') && canvass[1].maybe.includes('Sam Reed') && canvass[2].no.includes('Sam Reed'), JSON.stringify(canvass));
    await team.locator('select[aria-label="Visit status"]').selectOption('staffing');
    await team.getByText('Status changed.').waitFor();
    ok('confirming the dates tells those who said they could', (await raMail()).some((m) => m.kind === 'dates-confirmed') && (await pushes()).some((p) => /^School dates confirmed/.test(p.body)));

    /* ── Staffing over several days ── */
    await team.reload();
    await team.locator('li', { hasText: 'Sam Reed' }).getByText(/Available 1 of 3 days/).waitFor();
    await shot(team, 'desktop-07-team-staffing');
    const visitView = (await call(teamToken, 'visit', { visitId: visit.id })).result;
    const sam = visitView?.candidates?.find((c) => c.uid === raUid);
    ok('availability shown day by day across the visit', sam?.coverage === 'some' && sam.perDay.map((d) => d.covers).join() === 'yes,unknown,no', JSON.stringify(sam?.perDay));
    // The strongest team arrives ticked: Sam, for EEG, on the day they are free; the team adds the other two days.
    ok('the suggestion ticks the one person who can do it', await team.getByRole('checkbox', { name: /^Sam Reed/ }).isChecked());
    await team.locator('li', { hasText: 'Sam Reed' }).locator('label.mpmb-portal__dayChip', { hasText: shortDate(wed) }).locator('input').check();
    await team.locator('li', { hasText: 'Sam Reed' }).locator('label.mpmb-portal__dayChip', { hasText: shortDate(thu) }).locator('input').check();
    await team.getByRole('button', { name: /Lock in and notify/ }).click();
    await team.getByText('Offered to 1').waitFor();
    await shot(team, 'desktop-08-team-offered');
    const assignment = await db.collection('portalAssignments').doc(`${visit.id}_${raUid}`).get();
    ok('the place is offered, as EEG on the three days', assignment.data()?.role === 'eeg' && assignment.data()?.dates?.join() === [mon, wed, thu].join() && assignment.data()?.status === 'offered' && (await db.collection('portalVisits').doc(visit.id).get()).data().status === 'staffing');
    ok('the offer is pushed too', (await pushes()).some((p) => /^You've been selected/.test(p.title)));

    /* ── The assistant confirms ── */
    await ra.goto(`${BASE}#home`);
    await ra.reload();
    await ra.getByText('You have been selected for a visit').waitFor();
    await shot(ra, 'mobile-06-ra-selected');
    await ra.goto(`${BASE}#offers`);
    await ra.getByRole('button', { name: 'Confirm I can do it' }).waitFor();
    await shot(ra, 'mobile-07-ra-offer');
    await ra.getByRole('button', { name: 'Confirm I can do it' }).click();
    await ra.getByText('Waiting for your answer').waitFor();
    await ra.goto(`${BASE}#my-visits`);
    await ra.getByText('To withdraw, email').first().waitFor();
    await shot(ra, 'mobile-08-ra-my-visits');
    await ra.goto(`${BASE}#notifications`);
    await ra.getByText(/Confirmed: The Grammar School at Leeds/).waitFor();
    await shot(ra, 'mobile-09-ra-notifications');
    const after = await db.collection('portalAssignments').doc(`${visit.id}_${raUid}`).get();
    const visitAfter = await db.collection('portalVisits').doc(visit.id).get();
    ok('confirmed, and the visit is fully staffed', after.data()?.status === 'confirmed' && visitAfter.data()?.status === 'locked');
    const confirmMail = (await raMail()).find((m) => m.kind === 'confirmation');
    ok('the confirmation email is sent, with every day in its subject', /from .* to .*\(3 days\)/.test(confirmMail?.subject ?? ''), confirmMail?.subject ?? '');
    const cancel = await call(raToken, 'respond-offer', { visitId: visit.id, response: 'decline' });
    ok('a research assistant cannot cancel a confirmed place', cancel.error?.status === 'PERMISSION_DENIED' && /email Dr Sarmad Ali/.test(cancel.error.message), JSON.stringify(cancel.error ?? {}));
    const teamRemove = await call(teamToken, 'remove-confirmed', { visitId: visit.id, uid: raUid, reason: 'test' });
    ok('the research team cannot remove a confirmed place', teamRemove.error?.status === 'PERMISSION_DENIED');
    const teamWithdraw = await call(teamToken, 'withdraw-offer', { visitId: visit.id, uid: raUid });
    ok('nor withdraw it as an offer', teamWithdraw.error?.status === 'PERMISSION_DENIED', JSON.stringify(teamWithdraw.error ?? {}));

    /* ── Calendars ── */
    const ics = (await call(teamToken, 'visit-ics', { visitId: visit.id })).result;
    const events = (ics?.ics ?? '').split('BEGIN:VEVENT').length - 1;
    ok('the visit’s calendar file has one event per day it runs, with the place and who is confirmed', events === 3 && /LOCATION:The Grammar School at Leeds\\, Main reception\\, Alwoodley Gates/.test(ics.ics) && /Sam Reed/.test(ics.ics), `${events} events`);
    const all = (await call(teamToken, 'visits-ics')).result;
    ok('a calendar file of every visit coming up', (all?.ics ?? '').split('BEGIN:VEVENT').length - 1 === 3);
    const raIcs = await call(raToken, 'visit-ics', { visitId: visit.id });
    ok('research assistants cannot download the team calendar', raIcs.error?.status === 'PERMISSION_DENIED');

    /* ── A change after confirming: the person confirmed is told ── */
    const cur = (await call(teamToken, 'visit', { visitId: visit.id })).result.visit;
    const changed = await call(teamToken, 'save-visit', { visitId: visit.id, schoolId: cur.schoolId, startDate: cur.startDate, endDate: cur.endDate, start: cur.start, end: cur.end, roleNeeds: cur.roleNeeds, travel: cur.travel, notes: cur.notes, location: 'Sports hall', days: cur.days });
    ok('a change of place is saved', Boolean(changed.result?.visitId), JSON.stringify(changed.error ?? {}));
    ok('the person confirmed is emailed and pushed the change', (await raMail()).some((m) => m.kind === 'visit-changed') && (await pushes()).some((p) => /^Visit changed/.test(p.title)));

    const mail = (await db.collection('portalMail').get()).docs.map((d) => d.data());
    const kinds = (to) => mail.filter((m) => m.to === to).map((m) => m.kind);
    ok('emails: the request to the project manager', kinds(PM).includes('request'));
    ok('emails: approval, offer and confirmation to the assistant', ['approved', 'offer', 'confirmation'].every((k) => kinds(RA).includes(k)), kinds(RA).join(', '));
    const notes = (await db.collection('portalNotifications').get()).docs.map((d) => d.data());
    ok('the team is told about the confirmation', notes.some((n) => n.uid === users[TEAM].uid && /confirmed/.test(n.title)));
    const auditActions = (await db.collection('portalAudit').get()).docs.map((d) => d.data().action);
    ok('the audit log has every step', ['request-access', 'approve', 'upload-document', 'verify-document', 'save-session', 'add-visit', 'offer', 'confirm-offer', 'open-document', 'canvass-answer', 'announce-provisional', 'announce-confirmed'].every((a) => auditActions.includes(a)), [...new Set(auditActions)].join(', '));
    await pm.goto(`${BASE}#audit`);
    await pm.getByText('confirm-offer').first().waitFor();
    await shot(pm, 'desktop-09-pm-audit');
    await pm.goto(`${BASE}#visit/${visit.id}`);
    await pm.getByText('Fully staffed').first().waitFor();
    await shot(pm, 'desktop-10-pm-visit-locked');

    // A second offer on a full visit is refused.
    const full = await call(teamToken, 'offer', { visitId: visit.id, offers: [{ uid: raUid, role: 'eeg', dates: [mon] }] });
    ok('no offers beyond the places on a visit', Boolean(full.error));

    /* ── The project manager removes them (they emailed to withdraw) ── */
    await pm.getByRole('button', { name: 'Remove…' }).first().click();
    await pm.locator('#remove-reason').fill('Emailed to withdraw: unwell');
    await shot(pm, 'desktop-15-pm-remove');
    await pm.getByRole('button', { name: 'Remove Sam Reed' }).click();
    await pm.getByText(/Sam Reed removed from 3 days/).waitFor();
    const removed = (await db.collection('portalAssignments').doc(`${visit.id}_${raUid}`).get()).data();
    ok('the project manager removes a confirmed place, with the reason', removed?.status === 'removed' && removed.removedReason === 'Emailed to withdraw: unwell');
    ok('the place opens again', (await db.collection('portalVisits').doc(visit.id).get()).data().status === 'staffing');
    ok('the person removed is notified, emailed and pushed', (await raMail()).some((m) => m.kind === 'removed') && (await pushes()).some((p) => /^No longer booked/.test(p.title)) && (await db.collection('portalNotifications').where('uid', '==', raUid).get()).docs.some((d) => /No longer booked/.test(d.data().title)));
    ok('removing is in the audit log', (await db.collection('portalAudit').where('action', '==', 'remove-confirmed').get()).size === 1);

    /* ── Mobile versions of team screens, desktop of the assistant's ── */
    const teamMobile = await browser.newContext(mobile);
    const tm = await teamMobile.newPage();
    await signIn(tm, TEAM);
    await tm.getByText('Robin Chen · Research team').waitFor();
    await tm.goto(`${BASE}#visit/${visit.id}`);
    await tm.getByRole('heading', { name: 'Choose who to ask' }).waitFor();
    await shot(tm, 'mobile-10-team-visit');
    const raDesk = await browser.newContext(desktop);
    const rd = await raDesk.newPage();
    await signIn(rd, RA);
    await rd.getByRole('heading', { name: 'Getting ready for school visits' }).waitFor();
    await shot(rd, 'desktop-11-ra-checklist');
    await rd.getByRole('button', { name: 'Lab study' }).click();
    await shot(rd, 'desktop-12-lab-placeholder');
    await ra.goto(`${BASE}#home`);
    await ra.getByRole('heading', { name: 'Save the portal to your Home Screen' }).waitFor();
    await ra.getByRole('heading', { name: 'Save the portal to your Home Screen' }).scrollIntoViewIfNeeded();
    await shot(ra, 'mobile-12-ra-home-screen-help');
    await raCtx.grantPermissions(['notifications'], { origin: `http://127.0.0.1:${PORT}` });
    await ra.goto(`${BASE}#profile`);
    await ra.getByRole('heading', { name: 'Notifications on this device' }).waitFor();
    await ra.locator('.mpmb-portal__push [role=status]').filter({ hasNotText: 'Checking…' }).waitFor();
    await ra.getByLabel('Email me').uncheck();
    await ra.getByRole('button', { name: 'Save' }).click();
    await ra.getByText('Saved.').waitFor();
    await shot(ra, 'mobile-13-ra-notifications-settings');
    ok('each person chooses how they hear about new dates', (await db.collection('portalUsers').doc(raUid).get()).data().notifyPrefs?.newDatesEmail === false);

    /* ── A two-day visit with ten research assistants: jobs on the day ── */
    const uidOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).user_id;
    const samDocs = (await db.collection('portalDocs').where('uid', '==', raUid).get()).docs.map((d) => d.data());
    const crew = [
      ['Amira Khan', ['eeg'], 4], ['Ben Ortiz', ['eeg'], 3], ['Chloe Park', ['eeg'], 3], ['Dev Patel', ['eeg'], 2], ['Ella Morris', ['eeg'], 2],
      ['Finn Walsh', ['eeg'], 1], ['Grace Liu', ['eeg'], 1], ['Hana Sato', ['copro'], 3], ['Isaac Bell', ['copro'], 2], ['Jade Fox', ['eeg', 'copro'], 2],
    ];
    const crewUids = [];
    const [d1, d2] = [plus(visitDate, 7), plus(visitDate, 8)];
    for (const [i, [name, caps, level]] of crew.entries()) {
      const email = `crew${i + 1}@example.org`;
      const uid = uidOf(await tokenFor(email));
      crewUids.push(uid);
      await db.collection('portalUsers').doc(uid).set({ email, name, phone: '', role: 'ra', requested: 'ra', status: 'active', smsOptIn: false, notifyPrefs: { newDatesPush: false, newDatesEmail: false }, capabilities: caps, level, tags: [level >= 3 ? 'ready' : 'in-training'], createdAt: new Date() });
      for (const d of samDocs) await db.collection('portalDocs').add({ ...d, uid, details: d.typeId === 'dbs' ? { ...d.details, certificateNumber: `00999900${String(i).padStart(4, '0')}`, updateService: i % 2 === 0 } : d.details });
      for (const date of [d1, d2]) await db.collection('portalAvailability').doc(`${uid}_${date}`).set({ uid, date, value: i === 3 && date === d2 ? 'am' : 'all', note: '' });
    }
    for (const s of (await db.collection('portalSessions').get()).docs) await s.ref.update({ attendees: [...s.data().attendees, ...crewUids] });
    const crewToken = await tokenFor('crew1@example.org');
    const saved = await call(teamToken, 'save-visit', { schoolId: 'GSAL', startDate: d1, endDate: d2, start: '08:30', end: '15:00', location: 'Sports hall, Alwoodley Gates', notes: '', travel: { arrival: '08:00', taxiFrom: 'School of Psychology, University of Leeds', taxiTime: '07:15', direct: 'Please let Robin know if you are travelling directly.' } });
    const twoDay = saved.result?.visitId;
    ok('a two-day visit takes the usual numbers: 6 EEG and 2 co-production a day', (await db.collection('portalVisits').doc(twoDay).get()).data()?.roleNeeds?.eeg === 6, JSON.stringify(saved.error ?? {}));
    await call(teamToken, 'set-visit-status', { visitId: twoDay, status: 'staffing' });
    const bulk = (await db.collection('portalMail').get()).docs.map((d) => d.data()).filter((m) => /^dates-/.test(m.kind));
    ok('new dates go as one email: research assistants in blind copy, the team copied in once', bulk.length >= 1 && bulk.every((m) => m.to === 'undisclosed-recipients:;' && /brainpop@leeds\.ac\.uk/.test(m.cc) && /S\.A\.Ali1@leeds\.ac\.uk/.test(m.cc)), JSON.stringify(bulk.map((m) => [m.to, m.cc, m.bcc])));

    await team.goto(`${BASE}#people`);
    await team.locator('li', { hasText: 'Amira Khan' }).getByText('Level 4: Lead').waitFor();
    await shot(team, 'people-list-tags-levels');
    await team.goto(`${BASE}#person/${raUid}`);
    await team.getByText('Very calm with nervous pupils').waitFor();
    await shot(team, 'person-page');

    await team.goto(`${BASE}#visit/${twoDay}`);
    await team.getByRole('heading', { name: 'Choose who to ask' }).waitFor();
    const view2 = (await call(teamToken, 'visit', { visitId: twoDay })).result;
    if ((view2?.suggestion ?? []).length !== 9) console.log('suggestion', JSON.stringify(view2?.suggestion), JSON.stringify(view2?.candidates?.map((c) => [c.name, c.eligible, c.reasons, c.availableDates, c.capabilities])));
    await team.getByRole('button', { name: /Lock in and notify \(9\)/ }).waitFor();
    const sug = view2?.suggestion ?? [];
    // Dev can do only the morning of the second day, so the next strongest covers that day.
    const onDay = (role, date) => sug.filter((s) => s.role === role && s.dates.includes(date)).length;
    ok('the strongest team: 6 EEG and 2 co-production each day, the most experienced first, ticked', [d1, d2].every((d) => onDay('eeg', d) === 6 && onDay('copro', d) === 2) && sug.length === 9 && sug.find((s) => s.uid === crewUids[3])?.dates.join() === d1 && sug.find((s) => s.uid === crewUids[0])?.role === 'eeg' && sug.find((s) => s.uid === crewUids[9])?.role === 'eeg', JSON.stringify(sug));
    await shot(team, 'staffing-coverage-suggestion');
    await team.getByRole('button', { name: /Lock in and notify \(9\)/ }).click();
    await team.getByText('Offered to 9').waitFor();
    const places2 = (await db.collection('portalAssignments').where('visitId', '==', twoDay).get()).docs.map((d) => d.data());
    ok('nine offers, each with its job and its days', places2.length === 9 && places2.every((a) => a.status === 'offered') && places2.filter((a) => a.role === 'copro').length === 2 && places2.find((a) => a.uid === crewUids[3])?.dates.join() === d1);
    const offerMails = (await db.collection('portalMail').where('kind', '==', 'offer').get()).docs.map((d) => d.data()).filter((m) => /^crew/.test(m.to));
    ok('offer emails copy in brainpop and Sarmad', offerMails.length === 9 && offerMails.every((m) => /brainpop@leeds\.ac\.uk/.test(m.cc ?? '') && /S\.A\.Ali1/.test(m.cc ?? '')));
    const offerNote = (await db.collection('portalNotifications').where('uid', '==', crewUids[7]).get()).docs.map((d) => d.data()).find((n) => /selected/i.test(n.title + n.body));
    ok('the offer names the job', /Co-production/.test(JSON.stringify(offerNote ?? {})), JSON.stringify(offerNote));

    // One research assistant's view of their offer, then everyone confirms.
    const crewCtx = await browser.newContext(mobile);
    const cr = await crewCtx.newPage();
    await signIn(cr, 'crew8@example.org');
    await cr.getByRole('heading', { name: 'Getting ready for school visits' }).waitFor();
    await cr.goto(`${BASE}#offers`);
    await cr.getByText('Your job: Co-production').waitFor().catch(async (e) => {
      await shot(cr, 'debug-crew-offers');
      console.log('crew page:', (await cr.locator('body').innerText()).slice(0, 1500));
      throw e;
    });
    await shot(cr, 'ra-offer-role-days');
    await cr.getByRole('button', { name: 'Confirm I can do it' }).click();
    await cr.getByText('No offers waiting.').waitFor();
    for (const a of places2) if (a.uid !== crewUids[7]) {
      const i = crewUids.indexOf(a.uid);
      await call(await tokenFor(`crew${i + 1}@example.org`), 'respond-offer', { visitId: twoDay, response: 'confirm' });
    }
    const view3 = (await call(teamToken, 'visit', { visitId: twoDay })).result;
    ok('every day has both numbers confirmed: fully staffed', view3.coverage.length === 2 && view3.coverage.every((c) => c.eeg.confirmed === 6 && c.copro.confirmed === 2 && c.eeg.offered === 0) && (await db.collection('portalVisits').doc(twoDay).get()).data().status === 'locked', JSON.stringify(view3.coverage));
    const teamIcs = (await call(teamToken, 'visit-ics', { visitId: twoDay })).result.ics;
    ok('the team calendar lists who is on each day by job', /EEG \(6 of 6\): /.test(teamIcs) && /Co-production \(2 of 2\): /.test(teamIcs));

    // What the team keeps never reaches research assistants.
    const crewSummary = JSON.stringify((await call(crewToken, 'my-summary')).result ?? {});
    const samSummary = JSON.stringify((await call(raToken, 'my-summary')).result ?? {});
    ok('notes, levels and other tags never reach research assistants', !/Very calm|nervous pupils|levelReason|Led two pilot|In training|"level"|capabilities|No Friday/.test(crewSummary + samSummary) && /"standing":"Ready"/.test(crewSummary), crewSummary.slice(0, 300));
    ok('research assistants cannot read notes or tags', (await call(crewToken, 'person', { uid: raUid })).error?.status === 'PERMISSION_DENIED' && (await call(crewToken, 'add-note', { uid: raUid, text: 'x' })).error?.status === 'PERMISSION_DENIED');

    /* ── The team allocations email ── */
    await call(teamToken, 'set-time-note', { visitId: twoDay, uid: crewUids[1], date: d2, note: 'until 1:00 pm' });
    await team.reload();
    await team.getByRole('button', { name: 'Email the team' }).click();
    await team.getByRole('heading', { name: 'Email the team' }).waitFor();
    await team.locator('#te-allocations').waitFor();
    await shot(team, 'team-email-composer');
    const subj = await team.locator('#te-subject').inputValue();
    ok('the composer fills each day with who is on it, and their time notes', /\(until 1:00 pm\)/.test(await team.locator('#te-allocations').inputValue()) && /Ben Ortiz/.test(await team.locator('#te-allocations').inputValue()), await team.locator('#te-allocations').inputValue());
    ok('the composer fills the subject with the school and dates', /^GSAL team allocations: /.test(subj) || /team allocations/.test(subj), subj);
    await team.getByRole('button', { name: 'Send to the team' }).click();
    await team.getByText(/Sent as one email to 9 people/).waitFor();
    const teamMail = (await db.collection('portalMail').where('kind', '==', 'team-allocations').get()).docs.map((d) => d.data());
    ok('one email to the team, people in blind copy, brainpop and Sarmad copied once', teamMail.length === 1 && teamMail[0].to === TEAM && teamMail[0].bcc.split(', ').length === 9 && /brainpop/.test(teamMail[0].cc), JSON.stringify(teamMail));
    ok('the team are notified that allocations were sent', (await db.collection('portalNotifications').where('uid', '==', crewUids[0]).get()).docs.some((d) => /Team allocations/.test(d.data().title)));
    // A change afterwards: the team should be told again.
    const pmToken2 = await tokenFor(PM);
    await call(pmToken2, 'remove-confirmed', { visitId: twoDay, uid: crewUids[4], reason: 'Exam clash on the second day', dates: [d2] });
    const partly = (await db.collection('portalAssignments').doc(`${twoDay}_${crewUids[4]}`).get()).data();
    ok('the project manager takes someone off one day, keeping the other', partly.status === 'confirmed' && partly.dates.join() === d1 && partly.removedDates.includes(d2));
    ok('changes since the team was last told are flagged', (await call(teamToken, 'visit', { visitId: twoDay })).result.teamEmail?.changedSince === true);

    /* ── The email to the school, and its DBS page ── */
    await call(pmToken2, 'save-school', { id: 'GSAL', name: 'The Grammar School at Leeds', area: 'Alwoodley', requiredDocs: [], contactName: 'Ms Hughes', contactEmails: 'office@gsal.example.org', includeDbs: true });
    const preview = (await call(teamToken, 'school-email-preview', { visitId: twoDay })).result;
    ok('the school email lists who is coming each day, with no DBS numbers', /Amira Khan/.test(preview?.body ?? '') && !/00999900/.test(preview.body) && !/EEG|Co-production/.test(preview.body), preview?.body?.slice(0, 400));
    ok('it warns when the school has no DBS page password', preview.warnings.some((w) => /no DBS page password/.test(w)));
    ok('the research team cannot make a DBS page password', (await call(teamToken, 'make-dbs-password', { schoolId: 'GSAL' })).error?.status === 'PERMISSION_DENIED');
    const made = (await call(pmToken2, 'make-dbs-password', { schoolId: 'GSAL' })).result;
    ok('the project manager makes the school a DBS page password, shown once', typeof made?.password === 'string' && /schools\/dbs\/\?school=/.test(made.link), JSON.stringify(made));
    await team.goto(`${BASE}#visit/${twoDay}`);
    await team.getByRole('button', { name: 'Email the school' }).click();
    await team.getByText('Subject:').waitFor();
    await shot(team, 'school-email-preview');
    await team.getByRole('button', { name: 'Send to the school' }).click();
    await team.getByText(/Emailed office@gsal\.example\.org/).waitFor();
    const schoolMail = (await db.collection('portalMail').where('kind', '==', 'school').get()).docs.map((d) => d.data());
    ok('the school email copies the sender, the withdrawal contact and brainpop, once each', schoolMail.length === 1 && schoolMail[0].cc.split(', ').map((e) => e.toLowerCase()).sort().join() === ['brainpop@leeds.ac.uk', 's.a.ali1@leeds.ac.uk', TEAM].sort().join(), schoolMail[0]?.cc);
    ok('the school email is logged and audited', (await db.collection('portalSchoolEmails').where('visitId', '==', twoDay).get()).size === 1 && (await db.collection('portalAudit').where('action', '==', 'email-school').get()).size === 1);

    const slug = made.link.split('school=')[1];
    const DBS_FN = `http://127.0.0.1:5001/${PROJECT}/europe-west2/schoolDbs`;
    const anonToken = async () => (await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).idToken;
    const dbsCall = async (token, data) => (await fetch(DBS_FN, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ data }) })).json();
    const schoolCtx = await browser.newContext(desktop);
    const sp = await schoolCtx.newPage();
    await sp.goto(`http://127.0.0.1:${PORT}/tools.html?tool=school-dbs&school=${slug}`);
    await sp.locator('#dbs-password').fill('WRONG-WRONG');
    await sp.getByRole('button', { name: 'Show the DBS details' }).click();
    await sp.getByText('That password is not right').waitFor();
    await sp.locator('#dbs-password').fill(made.password);
    await sp.getByRole('button', { name: 'Show the DBS details' }).click();
    await sp.getByText('The Grammar School at Leeds: DBS details').waitFor();
    await sp.getByText('009999000000').first().waitFor();
    await shot(sp, 'school-dbs-page');
    ok('the school’s DBS page shows each person’s checked DBS, after the password', true);
    ok('every view of the DBS page is audited', (await db.collection('portalAudit').where('action', '==', 'school-dbs-view').get()).size >= 1 && Boolean((await db.collection('schoolDbsAccess').doc(slug).get()).data()?.lastViewedAt));
    const anonA = await anonToken();
    const copyRefused = await dbsCall(anonA, { school: slug, password: made.password, action: 'copy', docId: 'x' });
    ok('no certificate copies unless the project manager allows them', copyRefused.error?.status === 'PERMISSION_DENIED', JSON.stringify(copyRefused.error ?? {}));
    let limited = null;
    for (let i = 0; i < 11; i += 1) limited = await dbsCall(anonA, { school: slug, password: 'nope-nope' });
    ok('wrong passwords are limited', /Too many/.test(limited.error?.message ?? ''), JSON.stringify(limited.error ?? {}));
    await call(pmToken2, 'close-dbs-access', { schoolId: 'GSAL' });
    const closed = await dbsCall(await anonToken(), { school: slug, password: made.password });
    ok('closing access stops the password working', /not open/.test(closed.error?.message ?? ''), JSON.stringify(closed.error ?? {}));

    /* ── Attendance and reports (a visit last week) ── */
    const past = plus(new Date().toISOString().slice(0, 10), -7);
    const pastRef = await db.collection('portalVisits').add({ schoolId: 'GSAL', startDate: past, endDate: past, start: '08:30', end: '15:00', days: [{ date: past, on: true, start: '08:30', end: '15:00' }], date: past, lastDate: past, location: 'Main hall', roleNeeds: { eeg: 2, copro: 1 }, travel: {}, notes: '', status: 'locked', version: 0 });
    for (const [uid, role] of [[crewUids[0], 'eeg'], [crewUids[1], 'eeg'], [crewUids[7], 'copro']]) await db.collection('portalAssignments').doc(`${pastRef.id}_${uid}`).set({ visitId: pastRef.id, uid, role, dates: [past], status: 'confirmed' });
    const due = (await call(teamToken, 'visits')).result.attendanceDue;
    ok('the overview reminds about days not marked', due.some((d) => d.visitId === pastRef.id && d.unmarked === 3), JSON.stringify(due));
    await team.goto(`${BASE}#visit/${pastRef.id}`);
    await team.getByRole('heading', { name: 'Attendance' }).waitFor();
    await team.getByLabel(`Amira Khan, ${shortDate(past)}`, { exact: true }).selectOption('attended');
    await team.getByLabel(`Ben Ortiz, ${shortDate(past)}`, { exact: true }).selectOption('late');
    await team.getByLabel('Ben Ortiz: note').fill('Bus delayed, 20 minutes');
    await team.getByLabel(`Hana Sato, ${shortDate(past)}`, { exact: true }).selectOption('absent');
    await shot(team, 'attendance-marking');
    await team.getByRole('button', { name: /Save attendance/ }).click();
    await team.getByText('Saved.').waitFor();
    ok('attendance is marked, with notes, and audited', (await db.collection('portalAttendance').where('visitId', '==', pastRef.id).get()).size === 3 && (await db.collection('portalAudit').where('action', '==', 'mark-attendance').get()).size === 1);
    const report = (await call(teamToken, 'report', { from: plus(past, -1), to: plus(past, 1) })).result;
    const amira = report.people.find((p) => p.uid === crewUids[0]);
    ok('the report counts days attended, absent and hours per person', amira?.attended === 1 && amira.hours === 6.5 && report.people.find((p) => p.uid === crewUids[7])?.absent === 1 && report.totals.attended === 2, JSON.stringify(report.totals));
    await team.goto(`${BASE}#reports`);
    await team.locator('#r-from').fill(plus(past, -1));
    await team.getByRole('button', { name: 'Show' }).click();
    await team.locator('tr', { hasText: 'Amira Khan' }).first().waitFor();
    await shot(team, 'report');
    const [download] = await Promise.all([team.waitForEvent('download'), team.getByRole('button', { name: 'Download (CSV)' }).first().click()]);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    ok('the report downloads as CSV', /^Name,Days offered,Days confirmed,Days attended/.test(csv) && /Amira Khan,/.test(csv), csv.slice(0, 120));
    ok('school days attended show on the profile', (await call(teamToken, 'person', { uid: crewUids[0] })).result.daysAttended === 1);

    /* ── Retention ── */
    const archived = await call(pmToken, 'archive', { uid: raUid });
    ok('the project manager archives someone', archived.result?.ok === true, JSON.stringify(archived.error ?? {}));
    const { housekeeping } = await import(path.join(root, 'firebase/functions/lib/portal.js'));
    const soon = await housekeeping(db, new Date(Date.now() + 30 * 86_400_000));
    ok('copies are kept within the retention period', soon.copiesDeleted === 0);
    const later = await housekeeping(db, new Date(Date.now() + 200 * 86_400_000));
    const [left] = await bucket.getFiles({ prefix: `portal/docs/${raUid}/` });
    const records = (await db.collection('portalDocs').where('uid', '==', raUid).get()).docs.map((d) => d.data());
    ok('after the retention period the copies are deleted and the check records kept', later.copiesDeleted === 3 && left.length === 0 && records.length === 3 && records.every((d) => d.path === null && d.deletedAt));
    const archivedCall = await call(raToken, 'my-summary');
    ok('an archived account is turned away', archivedCall.error?.status === 'PERMISSION_DENIED');
  } catch (error) {
    console.error(error);
    failures.push(String(error?.message ?? error));
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures.length ? `\n${failures.length} FAILED:\n${failures.join('\n')}` : '\nAll portal checks passed.');
  process.exit(failures.length ? 1 : 0);
}
