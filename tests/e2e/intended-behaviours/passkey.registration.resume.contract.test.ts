import {
  assertIndependentNearRegistration,
  assertLateNearCompletionKeepsWalletLocked,
} from './registration-near-gate';
import { ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1 } from '@shared/utils/routerAbEd25519Yao';
import { intendedTest as test } from './harness';
import { assertResumedNearRegistration } from './registration-near-resume';

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
