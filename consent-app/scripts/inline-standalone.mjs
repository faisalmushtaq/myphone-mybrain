// Turns the standalone build into a single HTML file (script and stylesheet
// inlined) so it can be previewed anywhere without a web server.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('dist-standalone');
const htmlPath = path.join(dir, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_m, src) => {
  const js = fs.readFileSync(path.join(dir, src), 'utf8').replace(/<\/script/g, '<\\/script');
  return `<script type="module">${js}</script>`;
});

html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_m, href) => {
  const css = fs.readFileSync(path.join(dir, href), 'utf8');
  return `<style>${css}</style>`;
});

fs.writeFileSync(path.join(dir, 'preview.html'), html);
console.log(`wrote ${path.join(dir, 'preview.html')} (${Math.round(html.length / 1024)} KB)`);

// Variant for hosts that wrap the page in their own document skeleton: title,
// font link, styles, then the mount point and the inlined script.
const pick = (re) => (html.match(re) ?? [''])[0];
const artifact = [
  '<title>MyPhone/MyBrain Consent Form</title>',
  pick(/<link[^>]*fonts\.googleapis\.com\/css2[^>]*>/),
  '<style>html{-webkit-text-size-adjust:100%}body{margin:0;background:#fbf8ee;color:#113b3f}</style>',
  ...html.match(/<style>[\s\S]*?<\/style>/g).filter((tag) => tag.length > 200),
  '<div id="mpmb-consent-app"></div>',
  pick(/<script type="module">[\s\S]*<\/script>/),
].join('\n');
fs.writeFileSync(path.join(dir, 'artifact.html'), artifact);
console.log(`wrote ${path.join(dir, 'artifact.html')} (${Math.round(artifact.length / 1024)} KB)`);
