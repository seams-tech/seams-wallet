import { defineConfig, devices } from '@playwright/test';

const browserTestOrigin = 'http://localhost:4203';

process.env.NO_CADDY = '1';
process.env.W3A_TEST_FRONTEND_URL = browserTestOrigin;

export default defineConfig({
  tsconfig: './tsconfig.wallet-browser.json',
  testDir: '.',
  testMatch: ['**/wallet-iframe/**/*.test.ts', '**/lit-components/**/*.test.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'line',
  use: {
    baseURL: browserTestOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite browser-app --host 127.0.0.1 --port 4203 --strictPort',
    url: browserTestOrigin,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
