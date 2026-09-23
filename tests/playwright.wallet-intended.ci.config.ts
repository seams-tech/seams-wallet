import baseConfig from './playwright.wallet-intended.config';

export default {
  ...baseConfig,
  webServer: {
    command: 'node ./scripts/start-wallet-intended-services.mjs',
    url: `${process.env.SEAMS_INTENDED_APP_URL || 'http://localhost:4201'}/__intended-e2e`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
    timeout: 1_800_000,
  },
};
