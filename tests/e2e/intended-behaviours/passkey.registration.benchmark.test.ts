import {
  expect,
  type ConsoleMessage,
  type Page,
  type TestInfo,
  type BrowserContext,
  type Route,
} from '@playwright/test';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import { isPlainObject } from '../../../packages/shared-ts/src/utils/validation';

const cohorts = [
  { name: 'independent', run: benchmarkNearRegistration },
  { name: 'serialized', run: benchmarkSerializedNearRegistration },
  { name: 'prepared', run: benchmarkNearRegistration },
  { name: 'serial_preparation', run: benchmarkSerialPreparation },
] as const;

// Keep each comparison in one warmed worker and balance ordering across pairs.
for (let pair = 1; pair <= 20; pair += 1) {
  const ordered = pair % 2 === 1 ? cohorts : [...cohorts].reverse();
  for (const cohort of ordered) {
    test(
      `${cohort.name} pair ${pair}: passkey registration through NEAR readiness benchmark`,
      cohort.run,
    );
  }
}

class SerializedNearRegistrationGate {
  private release: () => void = ignoreRelease;
  private readonly joined = new Promise<void>(this.saveRelease.bind(this));

  private saveRelease(resolve: () => void): void {
    this.release = resolve;
  }

  observe(message: ConsoleMessage): void {
    const timings = new Map<string, number>();
    collectRegistrationTimings(timings, message);
    if (timings.has('custody_join')) this.release();
  }

  async holdActivation(route: Route): Promise<void> {
    await this.joined;
    await route.continue();
  }
}

class SerializedPreparationGate {
  private release: () => void = ignoreRelease;
  private readonly prepared = new Promise<void>(this.saveRelease.bind(this));

  private saveRelease(resolve: () => void): void {
    this.release = resolve;
  }

  observe(message: ConsoleMessage): void {
    const timings = new Map<string, number>();
    collectRegistrationTimings(timings, message);
    if (timings.has('session_seal_preparation')) this.release();
  }

  async holdFinalization(route: Route): Promise<void> {
    await this.prepared;
    await route.continue();
  }
}

async function benchmarkSerialPreparation(
  {
    harness,
    page,
    context,
  }: { harness: IntendedBehaviourHarness; page: Page; context: BrowserContext },
  testInfo: TestInfo,
): Promise<void> {
  // Both cohorts perform identical work; this control serializes preparation before finalization.
  const gate = new SerializedPreparationGate();
  page.on('console', gate.observe.bind(gate));
  await context.route('**/wallets/register/near-provisioning', gate.holdFinalization.bind(gate));
  await benchmarkNearRegistration({ harness, page }, testInfo);
}

function ignoreRelease(): void {}

async function benchmarkSerializedNearRegistration(
  {
    harness,
    page,
    context,
  }: { harness: IntendedBehaviourHarness; page: Page; context: BrowserContext },
  testInfo: TestInfo,
): Promise<void> {
  // Restore the former dependency using the same build and backend as the independent cohort.
  const gate = new SerializedNearRegistrationGate();
  page.on('console', gate.observe.bind(gate));
  await context.route('**/wallets/register/activate', gate.holdActivation.bind(gate));
  await benchmarkNearRegistration({ harness, page }, testInfo);
}

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
  expect(timings.get('authentication')).toBeGreaterThan(0);
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
    if (isPlainObject(value.timings) && typeof value.timings.authProofMs === 'number') {
      timings.set('authentication', value.timings.authProofMs);
    }
  }
}
