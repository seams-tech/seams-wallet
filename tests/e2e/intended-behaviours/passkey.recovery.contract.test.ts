import { expect, type Request } from '@playwright/test';
import { isPlainObject } from '../../../packages/shared-ts/src/utils/validation';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';

type RecoveryRotationProofObservation = {
  readonly passkeyProof: boolean;
  readonly topLevelExtensionsRedacted: boolean;
  readonly responseExtensionsRedacted: boolean;
};

function recordRecoveryRotationProof(
  observations: RecoveryRotationProofObservation[],
  request: Request,
): void {
  if (
    request.method() !== 'POST' ||
    new URL(request.url()).pathname !== '/wallets/recovery/rotate'
  ) {
    return;
  }
  let body: unknown;
  try {
    body = request.postDataJSON();
  } catch {
    observations.push({
      passkeyProof: false,
      topLevelExtensionsRedacted: false,
      responseExtensionsRedacted: false,
    });
    return;
  }
  const proof = isPlainObject(body) ? body.factorProof : null;
  const credential = isPlainObject(proof) ? proof.webauthn_authentication : null;
  const response = isPlainObject(credential) ? credential.response : null;
  const topLevelExtensions = isPlainObject(credential)
    ? credential.clientExtensionResults
    : undefined;
  const responseExtensions = isPlainObject(response)
    ? response.clientExtensionResults
    : undefined;
  observations.push({
    passkeyProof: isPlainObject(proof) && proof.kind === 'passkey',
    topLevelExtensionsRedacted: topLevelExtensions === null || topLevelExtensions === undefined,
    responseExtensionsRedacted: responseExtensions === null || responseExtensions === undefined,
  });
}

async function runRecoveryAdministrationProbeFromPage(): Promise<unknown> {
  const probe: unknown = Reflect.get(window, '__seamsIntendedE2EProbeRecoveryAdministration');
  if (typeof probe !== 'function') {
    throw new Error('Recovery administration intended-app probe is unavailable');
  }
  return await probe();
}

test('recovery administration rejects missing proof and stale acknowledgement after rotation', async (
  { harness, page },
  testInfo,
) => {
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();

  const rotationProofs: RecoveryRotationProofObservation[] = [];
  page.on('request', recordRecoveryRotationProof.bind(null, rotationProofs));
  const evidence: unknown = await page.evaluate(runRecoveryAdministrationProbeFromPage);
  if (!isPlainObject(evidence)) throw new Error('Recovery administration evidence is invalid');
  expect(evidence).toMatchObject({
    kind: 'recovery_administration_probe_v1',
    missingStatus: { status: 400, code: 'invalid_owner_proof' },
    missingAcknowledgement: { status: 400, code: 'invalid_owner_proof' },
    staleAcknowledgement: { status: 409, code: 'recovery_set_conflict' },
    backupOutstanding: true,
  });
  const initialIssuedAtMs = evidence.initialIssuedAtMs;
  const rotatedIssuedAtMs = evidence.rotatedIssuedAtMs;
  if (typeof initialIssuedAtMs !== 'number' || typeof rotatedIssuedAtMs !== 'number') {
    throw new Error('Recovery administration evidence omitted its issuance times');
  }
  expect(rotatedIssuedAtMs).toBeGreaterThan(initialIssuedAtMs);
  expect(evidence.finalIssuedAtMs).toBe(rotatedIssuedAtMs);
  expect(rotationProofs.length).toBeGreaterThan(0);
  for (const proof of rotationProofs) {
    expect(proof).toEqual({
      passkeyProof: true,
      topLevelExtensionsRedacted: true,
      responseExtensionsRedacted: true,
    });
  }

  await harness.signTempoTransaction('post_registration');
  await testInfo.attach('recovery-administration-proofs', {
    body: JSON.stringify({ ...evidence, rotationProofs }, null, 2),
    contentType: 'application/json',
  });
});

type RecoveryOrigin = {
  readonly name: string;
  readonly register: (harness: IntendedBehaviourHarness) => Promise<void>;
};

async function registerPasskeyFoundedWallet(harness: IntendedBehaviourHarness): Promise<void> {
  await harness.registerPasskeyWallet();
}

async function registerEmailOnlyWallet(harness: IntendedBehaviourHarness): Promise<void> {
  await harness.registerEmailOtpWallet();
}

async function registerCombinedWallet(harness: IntendedBehaviourHarness): Promise<void> {
  await harness.registerEmailOtpWallet();
  await harness.awaitNearReady();
  await harness.addPasskeyAuthMethod();
}

async function verifyPasskeyRecoveryCanAddEmailOtp(
  harness: IntendedBehaviourHarness,
  register: (harness: IntendedBehaviourHarness) => Promise<void>,
): Promise<void> {
  await register(harness);
  await harness.awaitNearReady();
  await harness.recoverPasskeyWalletFromFreshBrowser();
  await harness.assertRecoveryAuthorityIsAdditive('passkey');
  await harness.addEmailOtpAuthMethod();
  await harness.assertLockedPageReloadStaysLocked();
  await harness.unlockWithAddedEmailOtp();
  await harness.signTempoTransaction('post_unlock');
  await harness.signNearTransaction('post_unlock');
  await harness.exportEcdsaKey();
  await harness.exportEd25519Key();
  await harness.exhaustSigningBudget();
  await harness.signNearTransaction('step_up_required');
}

const recoveryOrigins: readonly RecoveryOrigin[] = [
  { name: 'Passkey-founded', register: registerPasskeyFoundedWallet },
  {
    name: 'Email-only',
    register: registerEmailOnlyWallet,
  },
  { name: 'Combined', register: registerCombinedWallet },
];

for (const origin of recoveryOrigins) {
  test(`a fresh browser recovers a ${origin.name} wallet with one code, signs, and refuses reuse`, async ({
    harness,
  }) => {
    await origin.register(harness);
    await harness.awaitNearReady();
    await harness.signTempoTransaction('post_registration');
    await harness.recoverPasskeyWalletFromFreshBrowser();
    await harness.assertRecoveryAuthorityIsAdditive('passkey');
    await harness.assertSourceWalletSessionRemainsActive();
    await harness.refreshPagePreservingWalletStorage();
    await harness.signNearTransaction('post_unlock');
    await harness.signTempoAndArcEvmConcurrently('post_unlock');
    await harness.assertConsumedRecoveryCodeReportedAsUsed();
  });
}

test('a failed finalization leaves its admitted recovery code reusable', async ({ harness }) => {
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.signTempoTransaction('post_registration');
  await harness.recoverPasskeyWalletAfterFailedFinalization();
  await harness.assertRecoveryAuthorityIsAdditive('passkey');
  await harness.assertConsumedRecoveryCodeReportedAsUsed();
});

test('an interrupted recovery attempt is superseded by a retry with the same code, which recovers and signs', async ({
  harness,
}) => {
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.signTempoTransaction('post_registration');
  await harness.recoverPasskeyWalletAfterInterruptedAttempt();
  await harness.assertRecoveryAuthorityIsAdditive('passkey');
  await harness.signNearTransaction('post_unlock');
});

test('a recovery retires the replaced activation: a delayed finalize is refused, a made signature answers, and the recovered wallet signs', async ({
  harness,
}) => {
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.recoverPasskeyWalletRetiringTheReplacedActivation();
  await harness.signNearTransaction('post_unlock');
});

test('a superseded recovery attempt that reaches the SigningWorker late is refused, and the current attempt signs', async ({
  harness,
}) => {
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.recoverPasskeyWalletAcrossALateSupersededAttempt();
  await harness.signNearTransaction('post_unlock');
});

test('a committed Passkey recovery survives a lost finalization response and runtime reset', async ({
  harness,
}) => {
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.signTempoTransaction('post_registration');
  await harness.recoverPasskeyWalletAfterLostFinalizationResponse();
  await harness.assertRecoveryAuthorityIsAdditive('passkey');
});

test('a Passkey-founded wallet recovers with Passkey, adds Email OTP, then signs, exports, and steps up through it', async ({
  harness,
}) => {
  await verifyPasskeyRecoveryCanAddEmailOtp(harness, registerPasskeyFoundedWallet);
});

test('an Email-founded wallet recovers with Passkey, adds Email OTP to the recovery authority, then signs, exports, and steps up through it', async ({
  harness,
}) => {
  await verifyPasskeyRecoveryCanAddEmailOtp(harness, registerEmailOnlyWallet);
});
