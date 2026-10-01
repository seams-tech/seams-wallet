import { defineConfig, devices } from '@playwright/test';

const hostedBenchmark = process.env.SEAMS_INTENDED_EXTERNAL_GATEWAY === '1';

export default defineConfig({
  tsconfig: './tsconfig.wallet-intended.json',
  testDir: '.',
  testMatch: ['**/e2e/intended-behaviours/**/*.contract.test.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalTimeout: 1_800_000,
  timeout: 420_000,
  expect: { timeout: 15_000 },
  reporter: 'line',
  use: {
    baseURL: process.env.SEAMS_INTENDED_APP_URL || 'http://localhost:4201',
    trace: hostedBenchmark ? 'off' : 'retain-on-failure',
    screenshot: hostedBenchmark ? 'off' : 'only-on-failure',
    video: hostedBenchmark ? 'off' : 'retain-on-failure',
    // Hosted probes in Cloudflare Containers lost HTTP/3 (QUIC) responses on
    // long requests; Chromium then resent the POST after about 30 s. Both
    // arms use HTTP/2 over TCP instead.
    launchOptions: hostedBenchmark ? { args: ['--disable-quic'] } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
