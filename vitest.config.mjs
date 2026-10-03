import { defineConfig } from 'vitest/config';

// Repo-weite Tests (Scanner, Hook). Die Tests der Pakete laufen in den Paketen selbst.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    testTimeout: 30_000,
  },
});
