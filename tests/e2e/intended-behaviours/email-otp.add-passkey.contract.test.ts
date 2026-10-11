import { expect, type Request } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { intendedTest as test, autoConfirmWalletIframeUntil } from './harness';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

/**
 * One product action, the `email_otp_to_passkey` branch.
 *
 * A wallet that unlocks with Email OTP gains a Passkey method on the same
 * authority. The source Email proof and target credential are independently
 * verified by the wallet.
 */
test('an Email OTP wallet can add a passkey as a second way in', async ({ harness }) => {
  await harness.registerEmailOtpWallet();
  await harness.awaitNearReady();
  await harness.addPasskeyAuthMethod();
  /* The source removes what it just added, before anything has unlocked with
     it. That is the direction whose proof comes from the Email OTP sibling.
     Its first commit is refused and the answer lost: the retry must commit on
     the same code, and a replay after it must receive the recorded answer. */
  await harness.revokeSourceAuthMethod('added', { refuseFirstRevocationCommit: true });
  /* The finalize commits but its answer is lost: the retry must receive that
     same addition, not make a second one. */
  await harness.addPasskeyAuthMethod({ loseFinalizeResponseOnce: true });
  await harness.assertRepeatAdditionIsAlreadyConfigured('addPasskeyAuthMethod');
  await harness.assertLockedPageReloadStaysLocked();
  await harness.unlockWithAddedPasskey();
  /* Every signer family the wallet has, then every key family it can export.
     An added method that can only reach one of them is not a second way in. */
  await harness.signTempoTransaction('post_unlock');
  await harness.signNearTransaction('post_unlock');
  await harness.exhaustSigningBudget();
  await harness.signNearTransaction('step_up_required');
  await harness.exportEcdsaKey();
  await harness.exportEd25519Key();
  /* Removing the method that did the adding is the case that matters: the
     wallet must not become unopenable because its founding credential is
     gone. Signing again afterwards is the proof it did not. */
  await harness.revokeSourceAuthMethod();
  await harness.signTempoTransaction('step_up_required');
  await harness.assertFinalAuthMethodCannotBeRevoked();
  /* A method added after registration is still a method: locking must strand it
     across a reload exactly as it strands the one the wallet was created with. */
  await harness.assertLockedPageReloadStaysLocked();
  /* The Email OTP method that did the adding is revoked: its code no longer
     opens the wallet. */
  await harness.assertRevokedEmailOtpCannotUnlock('registered');
});

class AuthMethodRemovalEvidence {
  challenges = 0;

  observe(request: Request): void {
    if (
      request.method() !== 'POST' ||
      new URL(request.url()).pathname !== '/wallet/email-otp/challenge'
    )
      return;
    const body = request.postDataJSON();
    expect(body.operation).toBe('transaction_sign');
    expect(body.operationFingerprintDigest).toEqual(expect.any(String));
    expect(body.walletAuthMethodId).toEqual(expect.any(String));
    this.challenges += 1;
  }
}

test('account menu removes an added passkey through the wallet email prompt and preserves signing', async ({
  harness,
  page,
  context,
}, testInfo) => {
  await harness.registerEmailOtpWallet();
  await harness.awaitNearReady();
  await harness.addPasskeyAuthMethod();
  const evidence = new AuthMethodRemovalEvidence();
  const observe = evidence.observe.bind(evidence);
  context.on('request', observe);
  try {
    const menu = page.getByTestId('intended-account-menu');
    await menu.getByRole('button', { name: 'Show account menu', exact: true }).click();
    await menu.locator('[aria-haspopup="menu"]').click({ timeout: 10_000 });
    await page.getByRole('button', { name: /Linked Devices/ }).click({ timeout: 10_000 });
    const dialog = page.getByRole('dialog', { name: 'Your devices', exact: true });
    const devices = dialog.locator('.seams-linked-devices-modal-item--row');
    await expect(devices).toHaveCount(2);
    await dialog.getByRole('button', { name: /^Remove / }).click();
    await dialog.getByRole('button', { name: 'Yes, remove', exact: true }).click();
    await expect(dialog.getByLabel('Verification code', { exact: true })).toHaveCount(0);
    await autoConfirmWalletIframeUntil(page, expect(devices).toHaveCount(1, { timeout: 60_000 }));
    expect(evidence.challenges).toBe(1);
    await expect(dialog.getByRole('button', { name: /^Remove / })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close linked devices', exact: true }).click();
  } finally {
    context.off('request', observe);
  }
  await harness.signArcEvmTransaction('post_registration');
  const artifactPath = path.resolve(
    testInfo.config.rootDir,
    '../.artifacts/r170/auth-method-menu-removal.json',
  );
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(
    artifactPath,
    JSON.stringify(
      {
        kind: 'auth_method_menu_removal_e2e_v1',
        hostOwnedEmailProof: true,
        operationBoundChallenges: evidence.challenges,
        activeMethodsBefore: 2,
        activeMethodsAfter: 1,
        signedWithSurvivingEmailMethod: true,
        reproduce:
          "SEAMS_INTENDED_PRODUCTION=1 SEAMS_INTENDED_SKIP_BUILD=1 node tests/scripts/run-wallet-intended-isolated.mjs --require-google-token -- e2e/intended-behaviours/email-otp.add-passkey.contract.test.ts --grep 'account menu removes an added passkey through the wallet email prompt and preserves signing'",
      },
      null,
      2,
    ) + '\n',
  );
  await testInfo.attach('auth-method-menu-removal.json', {
    path: artifactPath,
    contentType: 'application/json',
  });
});
