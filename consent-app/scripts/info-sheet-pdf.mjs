// Makes the information sheet as PDFs, to print or send, from the built
// website's own information page (/information/), so the PDF always says what
// the page says: one for everyone, and one per school (from
// _data/schools.json) whose code and address go to that school's page, with
// the school filled in on the form. Every section is unfolded; the website's
// header, footer and buttons are left out; the "Start now" button becomes a
// QR code and a short address to type.
//
//   node scripts/info-sheet-pdf.mjs <built site folder>
//
// Runs in the website build (.github/workflows/deploy.yml) after Jekyll,
// writing <site>/information/myphone-mybrain-information-sheet.pdf and
// ...-<school slug>.pdf. It uses the machine's Chrome (CHROME_CHANNEL, as on
// GitHub's runners) or the Chromium at CHROMIUM_PATH.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';
import QRCode from 'qrcode';

const here = path.dirname(new URL(import.meta.url).pathname);
const site = path.resolve(process.argv[2] ?? path.join(here, '../../_site'));
const SITE_HOST = 'myphonemybrain.com';
if (!fs.existsSync(path.join(site, 'information/index.html'))) {
  console.error(`No information page in ${site}: build the website first.`);
  process.exit(1);
}

const schools = JSON.parse(fs.readFileSync(path.resolve(here, '../../_data/schools.json'), 'utf8'));
const copy = fs.readFileSync(path.resolve(here, '../src/config/copy.ts'), 'utf8');
const version = copy.match(/parentInformationVersion = \{ version: '([^']+)'/)?.[1] ?? '';

// The built site, served as it is online, so its absolute links (/assets/...) work.
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let file = path.join(site, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(site)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : { channel: process.env.CHROME_CHANNEL ?? 'chrome' });
const page = await browser.newPage();
// Nothing from this run is counted as a visit (the usage beacon is not loaded for this host anyway).
await page.route(/\/__usage|cloudfunctions|googleapis/, (route) => route.abort());

const made = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
const variants = [{ slug: null, name: null }, ...schools.map((s) => ({ slug: s.slug, name: s.name }))];

const PRINT_CSS = `
  @page { size: A4; margin: 16mm 16mm 18mm; }
  html, body { background: #fff !important; }
  body { font-size: 10.5pt; }
  .site-header, .site-footer, .mobile-nav-overlay, .skip-link, .info-sheet__more-hint, .participant-next-step .text-link, .participant-next-step .btn { display: none !important; }
  .page-hero { background: #fff !important; color: #0d3b40 !important; padding: 0 0 6mm !important; min-height: 0 !important; }
  .page-hero * { color: #0d3b40 !important; }
  .page-hero h1 { font-size: 24pt !important; margin: 0 0 3mm !important; }
  .section { padding: 0 !important; }
  .container, .narrow-content { max-width: none !important; padding: 0 !important; }
  details.info-fold { break-inside: auto; border: 0 !important; margin: 0 0 4mm !important; }
  details.info-fold > summary { list-style: none; pointer-events: none; padding: 0 !important; }
  details.info-fold > summary::-webkit-details-marker, details.info-fold > summary::after, details.info-fold > summary::before { display: none !important; content: none !important; }
  details.info-fold > summary h2 { font-size: 17pt !important; margin: 5mm 0 2mm !important; break-after: avoid; }
  h3 { break-after: avoid; }
  li, figure, .pdf-start, .participant-next-step { break-inside: avoid; }
  .consent-route, .consent-routes > li { break-inside: auto !important; }
  .info-sheet, .info-fold, .info-fold__body, .participant-info-section, main, .section { background: #fff !important; box-shadow: none !important; }
  .info-fold__body { padding: 0 !important; }
  figure img, .section-photo-banner img { max-height: 55mm !important; width: auto !important; max-width: 100% !important; object-fit: contain !important; }
  .section-photo-banner, .illustration-banner { height: auto !important; min-height: 0 !important; }
  a { color: inherit !important; text-decoration: none !important; }
  .pdf-start { display: flex; gap: 6mm; align-items: center; margin: 3mm 0; }
  .pdf-start img { width: 30mm; height: 30mm; flex: none; }
  .pdf-start p { margin: 0 0 2mm !important; }
  .pdf-start strong { font-size: 13pt; }
  .pdf-school { font-size: 12pt; font-weight: 700; margin: 0 0 2mm; }
  .pdf-version { margin-top: 8mm; font-size: 8.5pt; color: #555; }
`;

for (const v of variants) {
  const target = v.slug ? `${SITE_HOST}/${v.slug}` : `${SITE_HOST}/information`;
  const qr = await QRCode.toDataURL(`https://${target}`, { margin: 0, width: 360, errorCorrectionLevel: 'M' });
  await page.goto(`${base}/information/`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: PRINT_CSS });
  await page.evaluate(
    ({ qr, target, school, version, made }) => {
      for (const d of document.querySelectorAll('details')) d.open = true;
      // The "Start now" button, on paper: a code to scan and an address to type.
      const box = document.querySelector('.participant-next-step');
      if (box) {
        const start = document.createElement('div');
        start.className = 'pdf-start';
        start.innerHTML = `<img alt="" src="${qr}"><div><p>Scan the code with your phone’s camera, or go to</p><p><strong>${target}</strong></p></div>`;
        box.querySelector('h3')?.after(start);
      }
      if (school) {
        const line = document.createElement('p');
        line.className = 'pdf-school';
        line.textContent = `For parents and carers at ${school}`;
        document.querySelector('.page-hero .container')?.prepend(line);
      }
      const more = document.querySelector('.info-sheet__more-heading');
      if (more) more.textContent = 'More about the study';
      // Links inside the page point to sections that are all here; links elsewhere get their address.
      for (const a of document.querySelectorAll('main a[href]')) {
        const href = a.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || a.closest('.pdf-start') || getComputedStyle(a).display === 'none') continue;
        const url = new URL(href, 'https://myphonemybrain.com');
        if (a.textContent.includes(url.host)) continue;
        const shown = (url.host + url.pathname).replace(/\/$/, '');
        a.insertAdjacentText('afterend', ` (${shown})`);
      }
      const end = document.createElement('p');
      end.className = 'pdf-version';
      end.textContent = `Information sheet${version ? `, version ${version}` : ''}, made ${made}. The latest version is always at myphonemybrain.com/information. Questions: brainpop@leeds.ac.uk.`;
      document.querySelector('main')?.append(end);
    },
    { qr, target, school: v.name, version, made },
  );
  await page.emulateMedia({ media: 'print' });
  const name = `myphone-mybrain-information-sheet${v.slug ? `-${v.slug}` : ''}.pdf`;
  await page.pdf({
    path: path.join(site, 'information', name),
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font-size:8px;color:#666;padding:0 16mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>MyPhone/MyBrain · Information for parents and carers${v.name ? ` · ${v.name}` : ''}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
  });
  console.log(`information/${name}`);
}

await browser.close();
server.close();
