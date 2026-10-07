import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// jsPDF (the downloadable copy) optionally pulls in HTML and SVG renderers the form never uses.
const empty = fileURLToPath(new URL('./src/lib/empty.ts', import.meta.url));

// Two build modes:
//  - default ("embedded"): output goes to ../assets/consent-app/ and is loaded by the
//    Jekyll page at /take-part/consent/. Fixed file names so the page can reference them.
//  - "standalone": self-contained preview (dist-standalone/) with relative paths and a
//    facsimile of the site header/footer, used for design review outside the Jekyll site.
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  // The emulator test serves the build from a plain folder, so paths are relative there too.
  const relative = standalone || mode === 'emulator';
  return {
    plugins: [react()],
    resolve: { alias: { canvg: empty, html2canvas: empty, dompurify: empty } },
    base: relative ? './' : '/assets/consent-app/',
    define: {
      __STANDALONE__: JSON.stringify(standalone),
      // The prototype (mock API + prototype controls) is on unless a production build says otherwise.
      __PROTOTYPE__: JSON.stringify(process.env.MPMB_PROTOTYPE !== 'false'),
    },
    build: {
      outDir: standalone ? 'dist-standalone' : '../assets/consent-app',
      emptyOutDir: true,
      assetsInlineLimit: standalone ? 300 * 1024 : 4096,
      // One stylesheet for every app, so the pages can reference a fixed file name.
      cssCodeSplit: false,
      rollupOptions: {
        // The standalone preview is a single inlined page of the family form; every other build
        // also has the lab study's entry and the New Year break preview's.
        input: standalone ? 'index.html' : { 'consent-app': 'index.html', 'lab-app': 'lab.html', 'newyear-app': 'newyear.html' },
        output: {
          // The preview is one inlined file, so the lazily loaded PDF code must be inlined too.
          inlineDynamicImports: standalone,
          entryFileNames: '[name].js',
          chunkFileNames: 'consent-app-[name].js',
          assetFileNames: (info) => (info.names?.[0] ?? '').endsWith('.css') ? 'consent-app.css' : 'media/[name][extname]',
        },
      },
    },
  };
});
