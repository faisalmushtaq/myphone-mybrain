// The embedded build is loaded by the Jekyll page, so Vite's generated
// index.html is not needed and would otherwise be served as a stray page.
import fs from 'node:fs';
import path from 'node:path';
const stray = path.resolve('../assets/consent-app/index.html');
if (fs.existsSync(stray)) fs.unlinkSync(stray);
