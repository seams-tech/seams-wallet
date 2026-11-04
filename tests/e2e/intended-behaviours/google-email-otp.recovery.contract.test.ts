import {
  intendedTest as test,
  type IntendedBehaviourHarness,
  type IntendedRecoveryTargetKind,
} from './harness';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function registerPasskeyFoundedWallet(harness: IntendedBehaviourHarness): Promise<void> {
  await harness.registerPasskeyWallet();
}

async function registerCombinedWallet(harness: IntendedBehaviourHarness): Promise<void> {
  await harness.registerEmailOtpWallet();
  await harness.awaitNearReady();
  await harness.addPasskeyAuthMethod();
}

async function verifyGoogleRecoveryCanAddPasskey(
  harness: IntendedBehaviourHarness,
  register: (harness: IntendedBehaviourHarness) => Promise<void>,
): Promise<void> {
  await register(harness);
  await harness.awaitNearReady();
  await harness.recoverGoogleEmailOtpWalletFromFreshBrowser();
  await harness.assertRecoveryAuthorityIsAdditive('google_email_otp');
  await harness.addPasskeyAuthMethod();
  await harness.assertLockedPageReloadStaysLocked();
  await harness.unlockWithAddedPasskey();
  await harness.signTempoTransaction('post_unlock');
  await harness.signNearTransaction('post_unlock');
  await harness.exportEcdsaKey();
  await harness.exportEd25519Key();
  await harness.exhaustSigningBudget();
  await harness.signNearTransaction('step_up_required');
}

const recoveryTarget: IntendedRecoveryTargetKind = 'google_email_otp';

test('a code held by an active Google recovery reports that it was already used', async ({
  harness,
}) => {
  await harness.registerPasskeyWallet();
  await harness.assertReservedRecoveryCodeReportedAsUsed();
});

test('a fresh browser recovers a Combined wallet with Google and Email OTP, signs, and refuses reuse', async ({
  harness,
}) => {
  await registerCombinedWallet(harness);
  await harness.awaitNearReady();
  await harness.signTempoTransaction('post_registration');
  await harness.recoverGoogleEmailOtpWalletFromFreshBrowser();
  await harness.assertRecoveryAuthorityIsAdditive(recoveryTarget);
  await harness.assertSourceWalletSessionRemainsActive();
  await harness.refreshPagePreservingWalletStorage();
  await harness.signNearTransaction('post_unlock');
  await harness.signTempoAndArcEvmConcurrently('post_unlock');
  await harness.assertConsumedRecoveryCodeReportedAsUsed(recoveryTarget);
});

test('a committed Google recovery survives a lost finalization response and runtime reset', async ({
  harness,
}) => {
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.signTempoTransaction('post_registration');
  await harness.recoverGoogleEmailOtpWalletAfterLostFinalizationResponse();
  await harness.assertRecoveryAuthorityIsAdditive(recoveryTarget);
});

test('a Passkey-founded wallet recovers with Google, adds Passkey despite the older passkey, then signs, exports, and steps up through it', async ({
  harness,
}) => {
  await verifyGoogleRecoveryCanAddPasskey(harness, registerPasskeyFoundedWallet);
});
