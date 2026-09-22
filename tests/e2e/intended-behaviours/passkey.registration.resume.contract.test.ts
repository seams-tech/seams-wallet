import { assertIndependentNearRegistration } from './registration-near-gate';
import {
  assertLateNearCompletionKeepsWalletLocked,
  assertPasskeyHydrationOverlapsInstallation,
  assertPasskeySealPreparedBeforeFinalization,
  assertNearReadyTransactionRollsBack,
} from './registration-near-gate';
import {
  ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
} from '@shared/utils/routerAbEd25519Yao';
import { intendedTest as test } from './harness';
import { assertResumedNearRegistration } from './registration-near-resume';

test('Passkey unlock resumes planned NEAR admission after reload', async ({ harness, context }) => {
  await assertResumedNearRegistration({
    harness,
    context,
    factor: 'passkey',
    path: ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1,
    interruption: 'before_request',
  });
});

test('Passkey unlock resumes the exact encrypted NEAR execution after reload', async ({
  harness,
  context,
}) => {
  await assertResumedNearRegistration({
    harness,
    context,
    factor: 'passkey',
    path: ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
    interruption: 'before_request',
  });
});

test('Passkey unlock resumes a lost NEAR execution response after reload', async ({
  harness,
  context,
}) => {
  await assertResumedNearRegistration({
    harness,
    context,
    factor: 'passkey',
    path: ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
    interruption: 'lost_response',
  });
});

test('Passkey unlock resumes a lost NEAR finalization response after reload', async ({
  harness,
  context,
}) => {
  await assertResumedNearRegistration({
    harness,
    context,
    factor: 'passkey',
    path: '/wallets/register/near-provisioning',
    interruption: 'lost_response',
  });
});

test('Passkey unlock resumes persisted joined NEAR material without an execution checkpoint', async ({
  harness,
  context,
}) => {
  await assertResumedNearRegistration({
    harness,
    context,
    factor: 'passkey',
    path: '/wallets/register/near-provisioning',
    interruption: 'before_request',
    retainedCompletion: 'sealed_material',
  });
});

test('Passkey late NEAR finalization preserves wallet lock and resumes on unlock', async ({
  harness,
  context,
}) => {
  await assertLateNearCompletionKeepsWalletLocked({
    harness,
    context,
    factor: 'passkey',
    lockSource: 'same_tab',
  });
});

test('passkey NEAR readiness transaction rollback retains its repair journal', async ({
  harness,
  context,
}) => {
  await assertNearReadyTransactionRollsBack({ harness, context, factor: 'passkey' });
});

test('passkey late NEAR completion respects a lock from another tab', async ({
  harness,
  context,
}) => {
  await assertLateNearCompletionKeepsWalletLocked({
    harness,
    context,
    factor: 'passkey',
    lockSource: 'other_tab',
  });
});

test('a passkey PRF with leading zeroes restores NEAR signing after refresh', async ({
  harness,
  context,
}) => {
  // A deterministic factor exercises integer encoding in the real session-seal round trip.
  await context.addInitScript({
    content: `
    const originalExtensions = PublicKeyCredential.prototype.getClientExtensionResults;
    function extensionsWithLeadingZeroPrf() {
      const extensions = originalExtensions.call(this);
      const first = extensions.prf?.results?.first;
      if (first) new Uint8Array(first).fill(0, 0, 3);
      return extensions;
    }
    PublicKeyCredential.prototype.getClientExtensionResults = extensionsWithLeadingZeroPrf;
  `,
  });
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.signNearTransaction('post_registration');
  await harness.refreshPagePreservingWalletStorage();
  await harness.signNearTransactionAfterRefresh();
});

test('a terminal NEAR execution remains failed under fresh unlock authority while EVM signs', async ({
  harness,
}) => {
  await harness.assertMixedNearTerminalFailureSurvivesUnlock();
});

test('passkey NEAR completion preserves an exhausted EVM signing budget', async ({
  harness,
  context,
}) => {
  await assertIndependentNearRegistration({
    harness,
    context,
    factor: 'passkey',
    path: ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
    exhaustBudget: true,
  });
});

test('passkey hydration overlaps signer installation and gates durable readiness', async ({
  harness,
  context,
}) => {
  await assertPasskeyHydrationOverlapsInstallation({ harness, context, result: 'success' });
});

test('passkey overlapping hydration failure retains a repairable registration', async ({
  harness,
  context,
}) => {
  await assertPasskeyHydrationOverlapsInstallation({ harness, context, result: 'failure' });
});

test('passkey lock during overlapping hydration prevents late readiness', async ({
  harness,
  context,
}) => {
  await assertPasskeyHydrationOverlapsInstallation({ harness, context, result: 'lock' });
});

test('passkey client seal completes before the NEAR finalization response', async ({
  harness,
  context,
}) => {
  await assertPasskeySealPreparedBeforeFinalization({ harness, context });
});
