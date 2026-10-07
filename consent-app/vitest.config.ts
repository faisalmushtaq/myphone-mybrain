import { defineConfig } from 'vitest/config';

// Unit tests for the browser code (the cleaner's rules, the family form's journey). The functions have their own node:test suite.
// The build-time flags are fixed here as in a live build: no prototype, not the standalone preview.
export default defineConfig({ define: { __PROTOTYPE__: 'false', __STANDALONE__: 'false' }, test: { include: ['src/**/*.test.ts'], environment: 'node' } });
