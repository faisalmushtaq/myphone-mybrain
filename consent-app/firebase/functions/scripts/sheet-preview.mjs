// Renders the portal's Google Sheet from made-up records (src/portalSheets.fixture.ts) as HTML,
// one page per tab, and screenshots the first ones: a look at the layout without Google.
//   npm run build && node scripts/sheet-preview.mjs <out-dir> [tabs=3]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildWorkbook } = require('../lib/portalSheets.js');
const { sampleSheetData } = require('../lib/portalSheets.fixture.js');

const out = process.argv[2] ?? 'sheet-preview';
const count = Number(process.argv[3] ?? 3);
mkdirSync(out, { recursive: true });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cell = (c) => (c !== null && typeof c === 'object' ? c : { v: c });
const tabs = buildWorkbook(sampleSheetData());
function page(tab) {
  const covered = new Set();
  const span = new Map();
  for (const m of tab.merges) {
    span.set(`${m.row}|${m.col}`, m);
    for (let r = m.row; r < m.row + m.rows; r++) for (let c = m.col; c < m.col + m.cols; c++) if (r !== m.row || c !== m.col) covered.add(`${r}|${c}`);
  }
  const cols = Math.max(...tab.rows.map((r) => r.length), tab.widths.length);
  const rows = tab.rows.map((r, ri) => {
    const tds = [];
    for (let ci = 0; ci < cols; ci++) {
      if (covered.has(`${ri}|${ci}`)) continue;
      const x = cell(r[ci] ?? null);
      const m = span.get(`${ri}|${ci}`);
      const style = [x.bg && `background:${x.bg}`, x.fg && `color:${x.fg}`, x.bold && 'font-weight:700', x.italic && 'font-style:italic', x.size && `font-size:${x.size}px`, x.align && `text-align:${x.align.toLowerCase()}`, x.wrap ? 'white-space:normal' : '', ri < tab.frozenRows ? 'position:sticky' : ''].filter(Boolean).join(';');
      const v = x.v === null || x.v === undefined ? '' : esc(x.v);
      const body = x.link ? `<a href="${esc(x.link)}">${v}</a>` : v;
      tds.push(`<td${m ? ` colspan="${m.cols}"` : ''} style="${style}"${x.note ? ` title="${esc(x.note)}" class="noted"` : ''}>${body}</td>`);
    }
    return `<tr><th>${ri + 1}</th>${tds.join('')}</tr>`;
  });
  const letters = Array.from({ length: cols }, (_, i) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : ''));
  const tabBar = tabs.map((t) => `<span class="${t.title === tab.title ? 'on' : ''}">${esc(t.title)}</span>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>${esc(tab.title)}</title><style>
body{margin:0;font:13px Arial,Helvetica,sans-serif;color:#113b3f;background:#fff}
.bar{background:#f1f3f4;padding:6px 10px;font-size:12px;color:#444;border-bottom:1px solid #ddd}
table{border-collapse:collapse;table-layout:fixed}
table{width:max-content}td,th{border:1px solid ${tab.banded ? '#e2e2e2' : '#eef0f0'};padding:3px 6px;height:20px;white-space:nowrap;overflow:hidden;text-overflow:clip;vertical-align:middle}
th{background:#f8f9fa;color:#666;font-weight:400;font-size:11px}
td.noted{background-image:linear-gradient(225deg,#e8710a 5px,transparent 5px)}
${tab.banded ? 'tr:nth-child(odd) td{background-color:#f2f8f7}' : ''}
.tabs{background:#f1f3f4;border-top:1px solid #ccc;padding:4px;font-size:12px;white-space:nowrap;overflow:hidden}
.tabs span{display:inline-block;padding:4px 10px;color:#555}.tabs span.on{background:#fff;color:#006b73;font-weight:700;border-bottom:3px solid #006b73}
</style><div class="bar">MyPhone/MyBrain staff portal (sample records) · ${esc(tab.title)} · frozen ${tab.frozenRows} rows, ${tab.frozenCols} columns</div>
<table><colgroup><col style="width:34px">${letters.map((_, i) => `<col style="width:${tab.widths[i] ?? 100}px">`).join('')}</colgroup>
<tr><th></th>${letters.map((l) => `<th>${l}</th>`).join('')}</tr>${rows.join('')}</table><div class="tabs">${tabBar}</div>`;
}
const files = tabs.map((t, i) => {
  const f = join(out, `${String(i + 1).padStart(2, '0')}-${t.title.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}.html`);
  writeFileSync(f, page(t));
  return f;
});
const { chromium } = require('playwright');
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 });
for (const f of files.slice(0, count)) {
  await p.goto(`file://${f}`);
  await p.screenshot({ path: f.replace(/\.html$/, '.png'), fullPage: true });
  console.log(f.replace(/\.html$/, '.png'));
}
await browser.close();
