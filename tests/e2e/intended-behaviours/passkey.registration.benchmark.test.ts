import { expect, type ConsoleMessage, type Page, type TestInfo } from '@playwright/test';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import { isPlainObject } from '../../../packages/shared-ts/src/utils/validation';

test('passkey registration through NEAR readiness benchmark', benchmarkNearRegistration);

async function benchmarkNearRegistration(
  { harness, page }: { harness: IntendedBehaviourHarness; page: Page },
  testInfo: TestInfo,
): Promise<void> {
  const timings = new Map<string, number>();
  page.on('console', collectRegistrationTimings.bind(undefined, timings));
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  expect(timings.get('registration_total')).toBeGreaterThan(0);
  expect(timings.get('provisioning_total')).toBeGreaterThan(0);
  expect(timings.get('registration_return')).toBeGreaterThan(0);
  await testInfo.attach('near-registration-timings', {
    body: JSON.stringify(Object.fromEntries(timings), null, 2),
    contentType: 'application/json',
  });
  await harness.signNearTransaction('post_registration');
  await harness.refreshPagePreservingWalletStorage();
  await harness.signNearTransactionAfterRefresh();
}

function collectRegistrationTimings(timings: Map<string, number>, message: ConsoleMessage): void {
  const text = message.text();
  const jsonStart = text.indexOf('{"');
  if (jsonStart < 0 || !text.startsWith('[Registration]')) return;
  let value: unknown;
  try {
    value = JSON.parse(text.slice(jsonStart));
  } catch {
    return;
  }
  if (!isPlainObject(value)) return;
  if (
    value.event === 'near_registration_timing' &&
    value.outcome === 'success' &&
    typeof value.stage === 'string' &&
    typeof value.durationMs === 'number' &&
    Number.isFinite(value.durationMs)
  ) {
    timings.set(value.stage, value.durationMs);
  } else if (
    value.kind === 'registration_timing_summary_v2' &&
    value.status === 'succeeded' &&
    typeof value.totalMs === 'number' &&
    Number.isFinite(value.totalMs)
  ) {
    timings.set('registration_return', value.totalMs);
  }
}
