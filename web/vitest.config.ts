import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // The parity suite loads the full national dataset once and runs 24 scenarios.
    testTimeout: 120_000,
  },
});
