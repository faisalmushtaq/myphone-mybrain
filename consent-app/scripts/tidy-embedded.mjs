// The embedded build is loaded by the Jekyll page, so Vite's generated
// index.html is not needed and would otherwise be served as a stray page.
import fs from 'node:fs';
import path from 'node:path';
for (const name of ['index.html', 'lab.html', 'newyear.html']) {
  const stray = path.resolve(`../assets/consent-app/${name}`);
  if (fs.existsSync(stray)) fs.unlinkSync(stray);
}
