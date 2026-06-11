import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Entry scripts exercised manually / in e2e, not unit-testable units.
      exclude: ['src/index.ts', 'src/db/migrate-cli.ts', 'src/db/seed-cli.ts'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
});
