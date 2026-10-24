import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { base58Encode } from '@shared/utils/base58';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import { startReviewedTransfer, VoiceIdNearSigningEvidence } from './voiceid-near-signing';
import type {} from '../../fixtures/ui/VoiceIdDeviceCaptureProbe';

test('manual VoiceID page allocates its wallet and signs after voice unlock', verifyLivePage);
test.use({ video: 'off', trace: 'off', screenshot: 'off' });
test.setTimeout(180_000);

async function verifyLivePage(
  {
    page,
    context,
    harness,
  }: { page: Page; context: BrowserContext; harness: IntendedBehaviourHarness },
  testInfo: TestInfo,
): Promise<void> {
  const chunks = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve(import.meta.dirname, '../../scripts/build-preact-probe.mjs'),
        'VoiceIdDeviceCaptureProbe.ts',
      ],
      { encoding: 'utf8' },
    ),
  );
  await context.addInitScript({ content: chunks[0].code });
  const initialId = 'voiceid-live-20261024';
  const url = new URL('/voiceid', process.env.SEAMS_INTENDED_APP_URL || 'http://localhost:4201');
  url.searchParams.set('authMethod', 'voiceid');
  url.searchParams.set('walletId', initialId);
  await page.goto(url.href);
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  await expect(
    page.getByRole('button', { name: 'Unlock with passkey', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Create test wallet', exact: true }).click();
  await wallet.getByRole('button', { name: 'Create passkey', exact: true }).click();
  const status = page.getByTestId('live-voiceid-operation');
  await expect(status).toHaveAttribute('data-state', 'succeeded', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Save recovery codes', exact: true }).click();
  await wallet.getByRole('button', { name: 'View recovery codes', exact: true }).click();
  await wallet
    .locator('[data-seams-wallet-recovery-backup-acknowledgement]')
    .check({ timeout: 60_000 });
  await wallet.locator('[data-seams-wallet-recovery-backup-close]').click();
  await expect(status).toHaveAttribute('data-state', 'succeeded', { timeout: 60_000 });
  const walletId = await page.getByTestId('live-voiceid-wallet').innerText();
  expect(walletId).not.toBe(initialId);
  expect(new URL(page.url()).searchParams.get('walletId')).toBe(walletId);
  await expect(
    page.getByRole('button', { name: 'Create test wallet', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Unlock with passkey', exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId('live-voiceid-auth')).toHaveText('passkey');
  const accountId = await page.getByTestId('live-voiceid-account').innerText();
  expect(accountId).toMatch(/^[a-f0-9]{64}$/);
  const identity = {
    walletId,
    accountId,
    publicKey: `ed25519:${base58Encode(Buffer.from(accountId, 'hex'))}`,
  };
  await page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
  await expect(page.getByTestId('live-voiceid-auth')).toHaveText('locked');
  await expect(page.getByTestId('live-voiceid-method')).toHaveText(
    'Unlock with passkey, then activate VoiceID',
  );
  await expect(page.getByRole('button', { name: 'Unlock with VoiceID', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Lock wallet', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Unlock with passkey', exact: true }).click();
  await expect(page.getByTestId('live-voiceid-auth')).toHaveText('passkey', { timeout: 60_000 });
  await wallet.locator('body').evaluate(denyKeychainAccess);
  await page.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await expect(status).toHaveAttribute('data-state', 'failed');
  await expect(status).toContainText('VoiceID needs device setup to access Keychain.');
  await expect(status).toBeInViewport();
  await expect(page.getByTestId('live-voiceid-auth')).toHaveText('passkey');
  await wallet.locator('body').evaluate(rejectActivation);
  await page.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await expect(status).toHaveAttribute('data-state', 'failed');
  await expect(status).toContainText('VoiceID could not verify the spoken approval.');
  await expect(status).toBeInViewport();
  await expect(page.getByTestId('live-voiceid-auth')).toHaveText('passkey');
  await expect(page.getByRole('button', { name: 'Unlock with VoiceID', exact: true })).toBeDisabled();
  await wallet.locator('body').evaluate(approveActivation);
  await page.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await expect(status).toHaveText('VoiceID activated. Lock the wallet, then unlock with VoiceID.');
  await page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
  await expect(page.getByTestId('live-voiceid-auth')).toHaveText('locked');
  await page.getByRole('button', { name: 'Unlock with VoiceID', exact: true }).click();
  await wallet.getByRole('button', { name: 'Unlock with VoiceID', exact: true }).click();
  await expect(page.getByTestId('live-voiceid-auth')).toHaveText('voiceid');
  const evidence = new VoiceIdNearSigningEvidence(
    process.env.SEAMS_INTENDED_ROUTER_URL || 'http://127.0.0.1:4100',
    identity,
    'available',
  );
  await evidence.observe(context);
  await startReviewedTransfer(page);
  await wallet.locator('button.confirm').click();
  await expect(page.getByTestId('reviewed-near-result')).toHaveAttribute(
    'data-state',
    'submitted',
    {
      timeout: 60_000,
    },
  );
  expect(evidence.transfers).toHaveLength(1);
  const budget = await harness.readCurrentWalletSessionStatus();
  expect(budget.status).toBe('active');
  expect(budget.remainingUses).toBe(2);
  const report = testInfo.outputPath('voiceid-live-page.json');
  await writeFile(
    report,
    JSON.stringify(
      {
        status: 'passed',
        initialRequestedId: initialId,
        sdkAllocatedWalletId: walletId,
        defaultAllocationUsed: true,
        pageUrlRetainsAllocatedId: true,
        setupRequiredBeforeUnlock: true,
        ownerLockBeforeActivationRecovered: true,
        rejectedActivationVisibleAndRetrySucceeded: true,
        keychainDenialBeforeCaptureReported: true,
        nativeHost: 'fake_device_key_and_factor',
        microphoneAndKeychainUsed: false,
        authentication: 'voiceid',
        remainingUses: budget.remainingUses,
        signing: 'real_ed25519_yao_mpc',
        chain: 'deterministic_near_rpc',
        identity,
        transfers: evidence.transfers,
      },
      null,
      2,
    ),
  );
  await testInfo.attach('voiceid-live-page.json', {
    path: report,
    contentType: 'application/json',
  });
}

function rejectActivation(): void {
  window.voiceIdDeviceCaptureProbe.setMode('rejected');
}

function approveActivation(): void {
  window.voiceIdDeviceCaptureProbe.setMode('approved');
}

function denyKeychainAccess(): void {
  window.voiceIdDeviceCaptureProbe.setMode('keychain_denied');
}
