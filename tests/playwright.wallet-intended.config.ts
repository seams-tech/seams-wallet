import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  tsconfig: './tsconfig.wallet-intended.json',
  testDir: '.',
  testMatch: ['**/e2e/intended-behaviours/**/*.contract.test.ts'],
  testIgnore: [
    '**/google-email-otp.recovery.contract.test.ts',
    '**/tenant-root.rotation.contract.test.ts',
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalTimeout: 1_800_000,
  timeout: 420_000,
  expect: { timeout: 15_000 },
  reporter: 'line',
  use: {
    baseURL: process.env.SEAMS_INTENDED_APP_URL || 'http://localhost:4201',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
