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

// The Email OTP factor lives on the device that enrolled it, so a fresh browser cannot recover
// with it until each device can enroll its own factor (Refactor 252 Slice 3).
test('a fresh browser cannot recover a Combined wallet with Google and Email OTP', async ({
  harness,
}) => {
  await registerCombinedWallet(harness);
  await harness.awaitNearReady();
  await harness.signTempoTransaction('post_registration');
  await harness.recoverGoogleEmailOtpWalletFromFreshBrowser('device_factor_missing');
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
