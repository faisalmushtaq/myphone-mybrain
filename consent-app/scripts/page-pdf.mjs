// Makes the website's main information pages as PDFs, to print or send, from
// the built pages themselves, so each PDF always says what its page says
// (7 November 2026). The pages and file names are in _data/page_pdfs.json,
// which the page header also reads for its "Download this page as a PDF"
// link. Every fold is opened; the website's header, footer, menus and forms
// are left out; links show their address. (The information sheet has its own
// script, info-sheet-pdf.mjs, with a version for each school.)
//
//   node scripts/page-pdf.mjs <built site folder>
//
// Runs in the website build (.github/workflows/deploy.yml) after Jekyll,
// writing <site><path><file> for each page. It uses the machine's Chrome
// (CHROME_CHANNEL, as on GitHub's runners) or the Chromium at CHROMIUM_PATH.
// PAGE_PDF_BASE_URL reads a running site instead (for checking the layout by
// hand); the PDFs then go to the folder given.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const here = path.dirname(new URL(import.meta.url).pathname);
const site = path.resolve(process.argv[2] ?? path.join(here, '../../_site'));

const pages = JSON.parse(fs.readFileSync(path.resolve(here, '../../_data/page_pdfs.json'), 'utf8'));
let base = process.env.PAGE_PDF_BASE_URL?.replace(/\/$/, '');
let server = null;
if (!base) {
  if (!fs.existsSync(path.join(site, 'index.html'))) {
    console.error(`No website in ${site}: build it first.`);
    process.exit(1);
  }
  // The built site, served as it is online, so its absolute links (/assets/...) work.
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json' };
  server = http.createServer((req, res) => {
    let file = path.join(site, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(site)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : { channel: process.env.CHROME_CHANNEL ?? 'chrome' });
const page = await browser.newPage();
// Nothing from this run is counted as a visit.
await page.route(/\/__usage|cloudfunctions|googleapis\.com\/(?!css)/, (route) => route.abort());

const made = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });

const PRINT_CSS = `
  @page { size: A4; margin: 16mm 16mm 18mm; }
  html, body { background: #fff !important; }
  body { font-size: 10.5pt; }
  .site-header, .site-footer, .mobile-nav-overlay, .skip-link, .faq-audience-links, .page-hero__pdf, form, .contact-form { display: none !important; }
  .reveal { opacity: 1 !important; transform: none !important; }
  .page-hero { background: #fff !important; color: #0d3b40 !important; padding: 0 0 6mm !important; min-height: 0 !important; }
  .page-hero * { color: #0d3b40 !important; }
  .page-hero h1 { font-size: 24pt !important; margin: 0 0 3mm !important; max-width: none !important; }
  .page-hero::after { display: none !important; }
  .section { padding: 4mm 0 !important; }
  .section-dark, [class*="section-dark"] { padding: 6mm 5mm !important; }
  img { max-height: 70mm !important; width: auto !important; max-width: 100% !important; object-fit: contain !important; }
  details { break-inside: auto; }
  details > summary { list-style: none; }
  details > summary::-webkit-details-marker { display: none; }
  .container, .faq-layout { display: block !important; max-width: none !important; padding: 0 !important; }
  #faq h2 { font-size: 17pt !important; margin: 0 0 3mm !important; }
  .faq-group-title { font-size: 14pt !important; margin: 6mm 0 2mm !important; break-after: avoid; }
  details.faq-item { break-inside: avoid; border: 0 !important; border-bottom: 1px solid #ccd !important; margin: 0 !important; padding: 2mm 0 !important; background: #fff !important; box-shadow: none !important; }
  details.faq-item > summary { list-style: none; pointer-events: none; padding: 0 !important; font-weight: 700; font-size: 11pt; }
  details.faq-item > summary::-webkit-details-marker, details.faq-item > summary::after, details.faq-item > summary::before { display: none !important; content: none !important; }
  details.faq-item .prose { padding: 1mm 0 0 !important; }
  details.faq-item .prose p { margin: 0 0 1.5mm !important; }
  a { color: inherit !important; text-decoration: none !important; }
  .pdf-version { margin-top: 8mm; font-size: 8.5pt; color: #555; }
`;

for (const p of pages) {
  await page.goto(`${base}${p.path}`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: PRINT_CSS });
  await page.evaluate(({ made, title, path }) => {
    for (const d of document.querySelectorAll('details')) d.open = true;
    // Links elsewhere get their address, so they can be typed from paper.
    for (const a of document.querySelectorAll('main a[href]')) {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || getComputedStyle(a).display === 'none') continue;
      const url = new URL(href, 'https://myphonemybrain.com');
      if (a.textContent.includes(url.host)) continue;
      a.insertAdjacentText('afterend', ` (${(url.host + url.pathname).replace(/\/$/, '')})`);
    }
    const end = document.createElement('p');
    end.className = 'pdf-version';
    end.textContent = `${title}, made ${made}. The latest version is always at myphonemybrain.com${path.replace(/\/$/, '')}. Questions: brainpop@leeds.ac.uk.`;
    document.querySelector('main')?.append(end);
  }, { made, title: p.title, path: p.path });
  await page.emulateMedia({ media: 'print' });
  const out = path.join(site, p.path, p.file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.pdf({
    path: out,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font-size:8px;color:#666;padding:0 16mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>MyPhone/MyBrain · ${p.title}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
  });
  console.log(`${p.path}${p.file}`);

}

await browser.close();
server?.close();
