import { intendedTest as test, type IntendedBehaviourHarness } from './harness';

async function verifyLocalEd25519YaoRegistration({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyEd25519YaoWallet();
}

test(
  'public Ed25519 Yao registration persists a ready signer',
  verifyLocalEd25519YaoRegistration,
);

async function verifyLocalEd25519YaoAddSignerAndSigning({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyEd25519YaoWallet();
  await harness.addPasskeyEd25519YaoWalletSigner();
}

test(
  'public Ed25519 Yao add-signer persists a distinct signer',
  verifyLocalEd25519YaoAddSignerAndSigning,
);

async function verifyEcdsaAddSignerSignsAtOnceAndAfterUnlock({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyEd25519YaoWallet();
  await harness.addPasskeyEcdsaWalletSigner({ loseFinalizeResponseOnce: true });
  await harness.signNearTransaction('post_registration');
  await harness.signTempoTransaction('post_registration');
  await harness.signArcEvmTransaction('post_registration');
  await harness.lockWallet();
  await harness.assertWalletLocked();
  await harness.unlockPasskeyWallet();
  await harness.signNearTransaction('post_unlock');
  await harness.signTempoTransaction('post_unlock');
  await harness.signArcEvmTransaction('post_unlock');
}

test(
  'public ECDSA add-signer lets an Ed25519 wallet sign NEAR, Tempo and Arc at once and after unlock, across a lost finalize response',
  verifyEcdsaAddSignerSignsAtOnceAndAfterUnlock,
);

async function verifyExactTransportRetry({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyEd25519YaoWalletWithExactTransportRetry();
  await harness.signNearTransaction('post_registration');
}

test(
  'uncertain Router transport replays the registration and signs with the ready wallet',
  verifyExactTransportRetry,
);

async function verifyTerminalFailureWithoutRetry({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.assertPasskeyEd25519YaoTerminalFailureWithoutRetry();
}

test('terminal burned execution fails without retry', verifyTerminalFailureWithoutRetry);

async function verifyNearFinalizeResumesFromItsDecision({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyWalletAcrossNearFinalizeStorageLoss();
  await harness.signNearTransaction('post_unlock');
}

test(
  'deferred NEAR finalize that loses storage after its decision resumes from the decision and signs',
  verifyNearFinalizeResumesFromItsDecision,
);

async function verifyInterruptedExportAuthorizationResumes({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.unlockPasskeyWallet();
  await harness.exportEd25519KeyAcrossInterruptedAuthorization();
}

test(
  'an Ed25519 export interrupted after its authorization committed is admitted by the exact retry',
  verifyInterruptedExportAuthorizationResumes,
);
