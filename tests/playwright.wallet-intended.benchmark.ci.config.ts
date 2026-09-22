import ciConfig from './playwright.wallet-intended.ci.config';

export default {
  ...ciConfig,
  testMatch: ['**/e2e/intended-behaviours/**/*.benchmark.test.ts'],
};
