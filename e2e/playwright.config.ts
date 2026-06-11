import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const PORT = 3100;
const dirname = import.meta.dirname;

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // single shared demo account — keep flows serial
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    // Mobile-first product — primary target is a phone viewport.
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npx tsx src/index.ts',
    cwd: path.resolve(dirname, '../server'),
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: path.resolve(dirname, '.tmp/e2e.db'),
      WEB_DIST_DIR: path.resolve(dirname, '../web/dist'),
      SEED_ON_START: '1',
      JOB_TICK_MS: '1000',
      LOGIN_RATE_LIMIT: '1000', // many UI logins across projects; limiter covered by integration tests
      NODE_ENV: 'development',
    },
  },
});
