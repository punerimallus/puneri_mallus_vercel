import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // tests/sql/* boot a real PostgreSQL (PGlite, WASM) per test and apply the baseline schema
    // plus the migration before asserting anything. That is a second or two on an idle machine
    // and well past the 5s default on a busy one, so the timeout is raised for everything
    // rather than letting a loaded CI box fail a passing test.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
