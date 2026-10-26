import { NearRegistrationGate } from './registration-near-gate';
import { intendedTest as test, autoConfirmWalletIframeUntil } from './harness';
import { expect } from '@playwright/test';
import { openSigningKeys } from './ml-dsa-lifecycle-scenario';
import { writeFile } from 'node:fs/promises';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('Signing keys adds NEAR to an ECDSA-only wallet and retains ECDSA signing', async ({
  harness,
  page,
}, testInfo) => {
  testInfo.setTimeout(300_000);
  await harness.registerPasskeyEcdsaOnlyWallet();
  await openSigningKeys(page);
  await expect(page.getByRole('region', { name: /^ECDSA / }).first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'NEAR signing keys', exact: true })).toHaveCount(0);
  await page
    .getByRole('region', { name: /^ECDSA / })
    .first()
    .getByRole('button', { name: 'Key details', exact: true })
    .click();
  const ecdsaDetails = page.getByRole('region', { name: 'ECDSA', exact: true });
  await expect(ecdsaDetails.getByRole('button', { name: 'Export key', exact: true })).toBeVisible();
  await ecdsaDetails.getByRole('button', { name: 'Back', exact: true }).click();
  const nearAddition = page
    .locator('.seams-signing-key-row')
    .filter({ hasText: 'Ed25519 · New NEAR account' });
  const added = expect(
    page.getByRole('region', { name: 'NEAR signing keys', exact: true }),
  ).toBeVisible({ timeout: 120_000 });
  const adding = autoConfirmWalletIframeUntil(page, added, { timeoutMs: 120_000 });
  await nearAddition
    .getByRole('button', { name: 'Add signer', exact: true })
    .click({ timeout: 10_000 });
  await adding;
  const nearKeys = page.getByRole('region', { name: 'NEAR signing keys', exact: true });
  await nearKeys.getByRole('button', { name: 'Add signer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add signing key', exact: true })).toBeFocused();
  await expect(
    page.getByText(
      'Your existing wallet recovery restores this key. Your default signing key stays the same.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await nearKeys
    .getByRole('group', { name: 'Ed25519 signing key', exact: true })
    .getByRole('button', { name: 'Key details', exact: true })
    .click();
  const edDetails = page.getByRole('region', { name: 'Ed25519', exact: true });
  await expect(
    edDetails.getByRole('textbox', { name: 'Ed25519 public key', exact: true }),
  ).not.toHaveValue('');
  await expect(edDetails.getByRole('button', { name: 'Export key', exact: true })).toBeVisible();
  await edDetails.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('region', { name: /^ECDSA / }).first()).toBeVisible();
  await page
    .getByTestId('intended-account-menu')
    .screenshot({ path: testInfo.outputPath('signing-keys.png') });
  await page.keyboard.press('Escape');
  await harness.signTempoTransaction('post_registration');
  const artifact = testInfo.outputPath('signing-keys.json');
  await writeFile(
    artifact,
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        walletId: harness.walletId,
        ecdsaOnlySettings: true,
        addedNearThroughSettings: true,
        retainedEcdsaSigning: true,
        keyDetailNavigation: true,
        cancelledMlDsaCreation: true,
      },
      null,
      2,
    ),
  );
  await testInfo.attach('signing-keys', { path: artifact, contentType: 'application/json' });
});

test('Signing keys shows pending NEAR setup without offering duplicate creation', async ({
  harness,
  page,
  context,
}, testInfo) => {
  testInfo.setTimeout(180_000);
  const gate = new NearRegistrationGate();
  const hold = gate.hold.bind(gate);
  const path = '**/wallets/register/near-provisioning';
  await context.route(path, hold);
  try {
    await harness.registerPasskeyWallet();
    await expect.poll(gate.observed.bind(gate)).toBeGreaterThan(0);
    await openSigningKeys(page);
    const pending = page.getByRole('region', { name: 'NEAR setup', exact: true });
    await expect(pending.getByText('Setup in progress', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add signer', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: /^ECDSA / }).first()).toBeVisible();
    await page
      .getByTestId('intended-account-menu')
      .screenshot({ path: testInfo.outputPath('pending-near.png') });
    gate.release();
    await test.step(
      'Wait for the existing NEAR registration',
      harness.awaitNearReady.bind(harness),
      { timeout: 60_000 },
    );
    await openSigningKeys(page);
    await expect(
      page.getByRole('region', { name: 'NEAR signing keys', exact: true }),
    ).toBeVisible();
    await expect(pending).toHaveCount(0);
    const artifact = testInfo.outputPath('pending-near.json');
    await writeFile(
      artifact,
      JSON.stringify(
        {
          observedAt: new Date().toISOString(),
          pendingSetupVisible: true,
          duplicateCreationAbsent: true,
          ecdsaStillVisible: true,
          nearBecomesAvailable: true,
        },
        null,
        2,
      ),
    );
    await testInfo.attach('pending-near', { path: artifact, contentType: 'application/json' });
  } finally {
    gate.release();
    if (!page.isClosed()) await context.unroute(path, hold);
  }
});
