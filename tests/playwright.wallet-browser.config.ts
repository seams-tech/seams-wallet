import { defineConfig, devices } from '@playwright/test';

const browserTestOrigin = process.env.SEAMS_TEST_FRONTEND_URL ?? 'http://localhost:4203';
const browserTestPort = new URL(browserTestOrigin).port;

process.env.NO_CADDY = '1';
process.env.SEAMS_TEST_FRONTEND_URL = browserTestOrigin;

export default defineConfig({
  tsconfig: './tsconfig.wallet-browser.json',
  testDir: '.',
  testMatch: [
    '**/wallet-iframe/**/*.test.ts',
    '**/wallet-ui/**/*.test.ts',
    '**/lit-components/**/*.test.ts',
    '**/unit/**/*.test.ts',
  ],
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
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox-ui',
      testMatch: ['**/wallet-ui/**/*.browser.test.ts', '**/wallet-ui/auth-menu.lifecycle.test.ts'],
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit-ui',
      testMatch: ['**/wallet-ui/**/*.browser.test.ts', '**/wallet-ui/auth-menu.lifecycle.test.ts'],
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: `pnpm exec vite browser-app --host 127.0.0.1 --port ${browserTestPort} --strictPort`,
    url: browserTestOrigin,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
