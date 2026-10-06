import { defineConfig } from 'vitest/config';

// Unit tests for the browser code (the cleaner's rules). The functions have their own node:test suite.
export default defineConfig({ test: { include: ['src/**/*.test.ts'], environment: 'node' } });
