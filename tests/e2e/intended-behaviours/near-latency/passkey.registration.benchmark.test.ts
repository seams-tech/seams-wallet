import { expect, type ConsoleMessage, type Page, type TestInfo } from '@playwright/test';
import { isPlainObject } from '../../../../packages/shared-ts/src/utils/validation';
import { intendedTest as test, type IntendedBehaviourHarness } from '../harness';

type RegistrationKind = 'near_only' | 'mixed';
type SigningPhase = 'first' | 'warm';
type Timing = { stage: string; durationMs: number };
type SigningTiming = Timing & { operationId: string; outcome: string };
type SigningSample = {
  phase: SigningPhase;
  sdkElapsedMs: number;
  harnessElapsedMs: number;
  signatureVerified: true;
  warmSessionClaimed: boolean;
  passkeyPromptStarted: boolean;
  timings: SigningTiming[];
};

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

for (let sample = 1; sample <= 20; sample += 1) {
  const kinds: RegistrationKind[] =
    sample % 2 === 1 ? ['near_only', 'mixed'] : ['mixed', 'near_only'];
  for (const kind of kinds) {
    test(
      `local NEAR ${kind} sample ${sample}: registration, first and warm signing`,
      benchmarkLocalNear,
    );
  }
}

class NearTimings {
  readonly registration: Timing[] = [];
  signing: SigningTiming[] = [];
  sdkDurations: number[] = [];
  sdkInvocations = 0;

  observe(message: ConsoleMessage): void {
    const text = message.text();
    if (
      !text.startsWith('[Registration]') &&
      !text.startsWith('[WalletCustody]') &&
      !text.startsWith('[SigningFlow][near]') &&
      !text.startsWith('[Intended NEAR benchmark]')
    )
      return;
    const start = text.indexOf('{"');
    if (start < 0) return;
    let value: unknown;
    try {
      value = JSON.parse(text.slice(start));
    } catch {
      return;
    }
    if (!isPlainObject(value)) return;
    if (value.kind === 'registration_timing_summary_v2' && value.status === 'succeeded') {
      if (isDuration(value.totalMs)) {
        this.registration.push({ stage: 'registration_return', durationMs: value.totalMs });
      }
      if (isPlainObject(value.timings) && isDuration(value.timings.authProofMs)) {
        this.registration.push({ stage: 'authentication', durationMs: value.timings.authProofMs });
      }
      return;
    }
    if (!isDuration(value.durationMs)) return;
    if (value.event === 'near_sdk_signing_started') {
      this.sdkInvocations += 1;
      return;
    }
    if (value.event === 'near_sdk_registration_timing') {
      this.registration.push({ stage: 'sdk_registration_return', durationMs: value.durationMs });
      return;
    }
    if (value.event === 'near_sdk_signing_timing') {
      this.sdkDurations.push(value.durationMs);
      return;
    }
    if (typeof value.stage !== 'string') return;
    if (
      value.event === 'ed25519_signing_timing' &&
      typeof value.operationId === 'string' &&
      typeof value.outcome === 'string'
    ) {
      this.signing.push({
        stage: value.stage,
        durationMs: value.durationMs,
        operationId: value.operationId,
        outcome: value.outcome,
      });
    } else if (
      (value.event === 'near_registration_timing' || value.event === 'wallet_custody_timing') &&
      value.outcome === 'success'
    ) {
      this.registration.push({
        stage: `${value.event}/${value.stage}`,
        durationMs: value.durationMs,
      });
    }
  }

  resetSigning(): void {
    this.signing = [];
    this.sdkDurations = [];
    this.sdkInvocations = 0;
  }
}

function isDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

async function measureSigning(
  harness: IntendedBehaviourHarness,
  timings: NearTimings,
  phase: SigningPhase,
): Promise<SigningSample> {
  timings.resetSigning();
  const startedAt = performance.now();
  const auth = await harness.signNearTransaction('post_registration');
  const harnessElapsedMs = performance.now() - startedAt;
  expect(timings.sdkInvocations, 'automatic retries invalidate a sample').toBe(1);
  expect(timings.sdkDurations).toHaveLength(1);
  const signatureTotals = timings.signing.filter(isSignatureTotal);
  expect(signatureTotals).toHaveLength(1);
  expect(signatureTotals[0].outcome).toBe('succeeded');
  expect(auth.passkeyPromptStarted, 'first and warm samples must retain session authority').toBe(
    false,
  );
  expect(auth.warmSessionClaimed).toBe(true);
  return {
    phase,
    sdkElapsedMs: timings.sdkDurations[0],
    harnessElapsedMs,
    signatureVerified: true,
    warmSessionClaimed: auth.warmSessionClaimed,
    passkeyPromptStarted: auth.passkeyPromptStarted,
    timings: [...timings.signing],
  };
}

function isSignatureTotal(timing: SigningTiming): boolean {
  return timing.stage === 'signature_total';
}

async function benchmarkLocalNear(
  { harness, page }: { harness: IntendedBehaviourHarness; page: Page },
  testInfo: TestInfo,
): Promise<void> {
  const selection = /^local NEAR (near_only|mixed) sample (\d+):/.exec(testInfo.title);
  if (!selection) throw new Error('Benchmark title must identify its registration kind and sample');
  const kind = selection[1];
  const sample = Number(selection[2]);
  const timings = new NearTimings();
  page.on('console', timings.observe.bind(timings));
  const signing: SigningSample[] = [];
  const registrationStartedAt = performance.now();
  let registrationHarnessMs: number | null = null;
  let readinessHarnessMs: number | null = null;
  let outcome: 'failed' | 'succeeded' = 'failed';
  try {
    if (kind === 'near_only') await harness.registerPasskeyEd25519YaoWallet();
    else await harness.registerPasskeyWallet();
    registrationHarnessMs = performance.now() - registrationStartedAt;
    if (kind === 'mixed') await harness.awaitNearReady();
    readinessHarnessMs = performance.now() - registrationStartedAt;
    expect(timings.registration.some(isRegistrationReturn)).toBe(true);
    signing.push(await measureSigning(harness, timings, 'first'));
    signing.push(await measureSigning(harness, timings, 'warm'));
    outcome = 'succeeded';
  } finally {
    await testInfo.attach('near-local-latency', {
      body: JSON.stringify(
        {
          kind,
          sample,
          outcome,
          registrationHarnessMs,
          readinessHarnessMs,
          registration: timings.registration,
          signing,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  }
}

function isRegistrationReturn(timing: Timing): boolean {
  return timing.stage === 'sdk_registration_return';
}
