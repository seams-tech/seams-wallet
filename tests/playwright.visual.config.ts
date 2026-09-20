import { defineConfig } from '@playwright/test';
import browserConfig from './playwright.wallet-browser.config';

export default defineConfig(browserConfig, {
  testMatch: ['visual/**/*.visual.ts'],
  outputDir: '../.artifacts/refactor-127/visual-test-results',
  metadata: { captureRunId: new Date().toISOString() },
  projects: [{ name: 'chromium' }],
  use: {
    trace: 'off',
    screenshot: 'off',
    viewport: { width: 1024, height: 900 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
  },
});
