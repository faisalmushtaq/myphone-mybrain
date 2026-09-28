import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Two build modes:
//  - default ("embedded"): output goes to ../assets/consent-app/ and is loaded by the
//    Jekyll page at /take-part/consent/. Fixed file names so the page can reference them.
//  - "standalone": self-contained preview (dist-standalone/) with relative paths and a
//    facsimile of the site header/footer, used for design review outside the Jekyll site.
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
    plugins: [react()],
    base: standalone ? './' : '/assets/consent-app/',
    define: {
      __STANDALONE__: JSON.stringify(standalone),
      // The prototype (mock API + prototype controls) is on unless a production build says otherwise.
      __PROTOTYPE__: JSON.stringify(process.env.MPMB_PROTOTYPE !== 'false'),
    },
    build: {
      outDir: standalone ? 'dist-standalone' : '../assets/consent-app',
      emptyOutDir: true,
      assetsInlineLimit: standalone ? 300 * 1024 : 4096,
      rollupOptions: {
        output: {
          entryFileNames: 'consent-app.js',
          chunkFileNames: 'consent-app-[name].js',
          assetFileNames: (info) => (info.names?.[0] ?? '').endsWith('.css') ? 'consent-app.css' : 'media/[name][extname]',
        },
      },
    },
  };
});
