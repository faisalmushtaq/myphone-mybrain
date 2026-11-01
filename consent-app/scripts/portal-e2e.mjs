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

  // A visit date a little ahead, on a weekday.
  const visitDate = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 10);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
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
    await team.locator('li', { hasText: 'Sam Reed' }).getByText('Ready', { exact: true }).waitFor();
    await shot(team, 'desktop-06-team-people');
    ok('the assistant shows as ready once documents, training and pilots are done', true);

    await team.goto(`${BASE}#visits`);
    await team.locator('#v-school').selectOption('GSAL');
    await team.locator('#v-date').fill(visitDate);
    await team.locator('#v-needed').fill('1');
    await team.locator('#v-meet').fill('Main reception');
    await team.getByRole('button', { name: 'Add the visit' }).click();
    await team.getByRole('heading', { name: 'Choose who to ask' }).waitFor();
    await team.locator('li', { hasText: 'Sam Reed' }).getByText('All day').waitFor();
    await shot(team, 'desktop-07-team-staffing');
    await team.getByLabel(/Sam Reed/).check();
    await team.getByRole('button', { name: /Lock in and notify/ }).click();
    await team.getByText('Offered to 1').waitFor();
    await shot(team, 'desktop-08-team-offered');
    const visit = (await db.collection('portalVisits').get()).docs[0];
    const assignment = await db.collection('portalAssignments').doc(`${visit.id}_${raUid}`).get();
    ok('the place is offered', assignment.data()?.status === 'offered' && visit.data().status === 'staffing');

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
    await ra.getByText('Confirmed').first().waitFor();
    await shot(ra, 'mobile-08-ra-my-visits');
    await ra.goto(`${BASE}#notifications`);
    await ra.getByText(/Confirmed: The Grammar School at Leeds/).waitFor();
    await shot(ra, 'mobile-09-ra-notifications');
    const after = await db.collection('portalAssignments').doc(`${visit.id}_${raUid}`).get();
    const visitAfter = await db.collection('portalVisits').doc(visit.id).get();
    ok('confirmed, and the visit is fully staffed', after.data()?.status === 'confirmed' && visitAfter.data()?.status === 'locked');

    const mail = (await db.collection('portalMail').get()).docs.map((d) => d.data());
    const kinds = (to) => mail.filter((m) => m.to === to).map((m) => m.kind);
    ok('emails: the request to the project manager', kinds(PM).includes('request'));
    ok('emails: approval, offer and confirmation to the assistant', ['approved', 'offer', 'confirmation'].every((k) => kinds(RA).includes(k)), kinds(RA).join(', '));
    const notes = (await db.collection('portalNotifications').get()).docs.map((d) => d.data());
    ok('the team is told about the confirmation', notes.some((n) => n.uid === users[TEAM].uid && /confirmed/.test(n.title)));
    const auditActions = (await db.collection('portalAudit').get()).docs.map((d) => d.data().action);
    ok('the audit log has every step', ['request-access', 'approve', 'upload-document', 'verify-document', 'save-session', 'add-visit', 'offer', 'confirm-offer', 'open-document'].every((a) => auditActions.includes(a)), [...new Set(auditActions)].join(', '));
    await pm.goto(`${BASE}#audit`);
    await pm.getByText('confirm-offer').first().waitFor();
    await shot(pm, 'desktop-09-pm-audit');
    await pm.goto(`${BASE}#visit/${visit.id}`);
    await pm.getByText('Fully staffed').first().waitFor();
    await shot(pm, 'desktop-10-pm-visit-locked');

    // A second offer on a full visit is refused.
    const full = await call(teamToken, 'offer', { visitId: visit.id, uids: [raUid] });
    ok('no offers beyond the places on a visit', Boolean(full.error));

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
