import { expect, type Page, type TestInfo, type Route } from '@playwright/test';
import { intendedTest as test, waitForWalletIframeConfirmationSettlement } from './harness';
import {
  allowBrowserMicrophone,
  enrollBrowserMicrophone,
  requireActivatedVoiceId,
  voiceIdBrowserAudio,
} from './voiceid-browser-audio';
import { session, saveEvidence, microphoneCount, signTransfer } from './voiceid-selection';
import { readNearIdentity, VoiceIdNearSigningEvidence } from './voiceid-near-signing';
import { VoiceIdArcRpc } from './voiceid-arc-rpc';
import type {} from '../../intended-app/src/voiceIdHelpers';

test.use({ ...voiceIdBrowserAudio, video: 'off', trace: 'off' });
test.setTimeout(240_000);

for (const profile of ['ecdsa_only', 'add_ecdsa_after_voice'] as const) {
  test(`VoiceID unlock and Arc transfer: ${profile}`, async ({
    harness,
    page,
    context,
  }, testInfo) => {
    await allowBrowserMicrophone(context);
    harness.enableVoiceIdPlugin();
    const rpc = new VoiceIdArcRpc();
    await context.route('https://rpc.testnet.arc.io/**', rpc.handle.bind(rpc));
    if (profile === 'ecdsa_only') await harness.registerPasskeyEcdsaOnlyWallet();
    else await harness.registerPasskeyEd25519YaoWallet();
    const nearIdentity = profile === 'add_ecdsa_after_voice' ? await readNearIdentity(page) : null;
    const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
    const activation = page.evaluate(activate);
    await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
    await wallet.locator('body').evaluate(useNaturalPhrases);
    await enrollBrowserMicrophone(page);
    const method = requireActivatedVoiceId(await activation);
    if (profile === 'add_ecdsa_after_voice') {
      await harness.lockWallet();
      expect(await page.evaluate(unlock, method.walletAuthMethodId)).toMatchObject({
        success: true,
      });
      await addEvmFromAccountsMenu(page, testInfo);
    }
    const owner = await page.evaluate(session);
    if (owner.appIdentity.kind !== 'resolved' || !owner.appIdentity.thresholdEcdsaEthereumAddress)
      throw new Error('ECDSA owner identity is unavailable');
    const ownerAddress = owner.appIdentity.thresholdEcdsaEthereumAddress;
    await harness.lockWallet();
    const unlocked = await page.evaluate(unlock, method.walletAuthMethodId);
    expect(unlocked).toMatchObject({
      success: true,
      kind: profile === 'ecdsa_only' ? 'ecdsa_wallet_unlocked' : 'near_wallet_unlocked',
      walletId: method.walletId,
    });
    const active = await page.evaluate(session);
    expect(active.authentication).toMatchObject({ kind: 'authenticated', authMethod: 'voiceid' });
    expect(active.appIdentity).toMatchObject({
      thresholdEcdsaEthereumAddress: ownerAddress,
      nearAccountId: owner.appIdentity.nearAccountId,
    });
    const captures = await wallet.locator('body').evaluate(microphoneCount);
    const blockedFeeLookup = await verifyBlockedFeeLookup(page, testInfo);
    expect(await wallet.locator('body').evaluate(microphoneCount)).toBe(captures);
    expect(rpc.transactions).toHaveLength(0);
    await page.getByRole('button', { name: 'Review Arc testnet transfer', exact: true }).click();
    await expect(
    page.getByRole('button', { name: 'Continue to wallet', exact: true }),
  ).toHaveCount(0);
    await expect(
      wallet.getByRole('button', { name: 'Confirm with VoiceID', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(wallet.locator('.seams-confirmation-surface')).not.toHaveAttribute('inert', '');
    await expect(wallet.locator('.seams-confirmation-surface')).toHaveAttribute(
      'data-seams-confirm-ready',
      'true',
    );
    await expect(
      wallet.getByRole('button', { name: 'Confirm with VoiceID', exact: true }),
    ).toBeEnabled({ timeout: 15_000 });
    await wallet.getByRole('button', { name: 'Confirm with VoiceID', exact: true }).click();
    await expect(page.getByTestId('reviewed-arc-result')).toHaveAttribute(
      'data-state',
      /submitted|failed/,
      {
        timeout: 90_000,
      },
    );
    await expect(page.getByTestId('reviewed-arc-result')).toHaveAttribute(
      'data-state',
      'submitted',
    );
    expect(rpc.transactions).toHaveLength(1);
    expect(rpc.transactions[0].sender.toLowerCase()).toBe(ownerAddress.toLowerCase());
    expect(await wallet.locator('body').evaluate(microphoneCount)).toBe(captures + 1);
    await waitForWalletIframeConfirmationSettlement(page);
    await page.getByRole('button', { name: 'Review Arc testnet transfer', exact: true }).click();
    await expect(
    page.getByRole('button', { name: 'Continue to wallet', exact: true }),
  ).toHaveCount(0);
    await expect(wallet.locator('.seams-confirmation-surface')).not.toHaveAttribute('inert', '');
    await wallet.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByTestId('reviewed-arc-result')).toHaveAttribute('data-state', 'failed');
    expect(rpc.transactions).toHaveLength(1);
    const near = nearIdentity
      ? new VoiceIdNearSigningEvidence(
          process.env.SEAMS_INTENDED_ROUTER_URL || 'http://127.0.0.1:4600',
          nearIdentity,
          'available',
        )
      : null;
    if (near) {
      await near.observe(context);
      await signTransfer(page);
      expect(near.transfers).toHaveLength(1);
    }
    await saveEvidence(testInfo, 'voiceid-arc-transfer.json', {
      status: 'passed',
      profile,
      nearTransfers: near?.transfers ?? [],
      network: 'deterministic_arc_rpc',
      signing: 'real_ecdsa_mpc',
      inference: 'real_redimnet_b1_and_aurora',
      speakerThreshold: 0.5,
      blockedFeeLookup,
      ownerAddress,
      walletId: method.walletId,
      transactions: rpc.transactions,
      cancellationPreventedSecondTransfer: true,
      signerSetup:
        profile === 'add_ecdsa_after_voice'
          ? 'accounts_menu_from_voiceid_session_with_passkey'
          : 'registration',
    });
  });
}
function activate() {
  if (!window.__seamsIntendedVoiceId) throw new Error('Missing VoiceID helper');
  return window.__seamsIntendedVoiceId.activate();
}
function unlock(id: string) {
  if (!window.__seamsIntendedVoiceId) throw new Error('Missing VoiceID helper');
  return window.__seamsIntendedVoiceId.unlock(id);
}
function useNaturalPhrases() {
  window.voiceIdUseNaturalPhrases();
}

async function addEvmFromAccountsMenu(page: Page, testInfo: TestInfo): Promise<void> {
  const menu = page.getByTestId('intended-account-menu');
  await menu.getByRole('button', { name: 'Show account menu', exact: true }).click();
  await menu.locator('[aria-haspopup="menu"]').click();
  await page.getByRole('button', { name: /Accounts/ }).click();
  const accounts = page.getByRole('region', { name: 'Accounts', exact: true });
  await expect(
    accounts.getByRole('button', { name: 'Add EVM account', exact: true }),
  ).toBeEnabled();
  await menu
    .locator('.seams-profile-button-morphable')
    .screenshot({ path: testInfo.outputPath('accounts-before-evm.png'), animations: 'disabled' });
  await accounts.getByRole('button', { name: 'Add EVM account', exact: true }).click();
  await expect(accounts.getByText('EVM account added.', { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(accounts.getByRole('link')).toHaveCount(3);
  await expect(accounts.getByRole('button', { name: 'Add EVM account', exact: true })).toHaveCount(
    0,
  );
  await menu
    .locator('.seams-profile-button-morphable')
    .screenshot({ path: testInfo.outputPath('accounts-with-evm.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Close wallet settings', exact: true }).click();
}

async function blockFeeLookup(route: Route): Promise<void> {
  if (route.request().method() !== 'POST') return route.fallback();
  await route.abort('blockedbyclient');
}

async function verifyBlockedFeeLookup(page: Page, testInfo: TestInfo): Promise<string> {
  const endpoint = 'https://rpc.testnet.arc.io/**';
  await page.route(endpoint, blockFeeLookup);
  try {
    await page.getByRole('button', { name: 'Review Arc testnet transfer', exact: true }).click();
    const result = page.getByTestId('reviewed-arc-result');
    await expect(result).toHaveAttribute('data-state', 'failed');
    await expect(result).toContainText(
      'Could not reach https://rpc.testnet.arc.io to estimate Arc fees.',
    );
    await expect(page.getByRole('button', { name: 'Continue to wallet', exact: true })).toHaveCount(
      0,
    );
    await result.screenshot({ path: testInfo.outputPath('blocked-arc-fee-lookup.png') });
    return await result.innerText();
  } finally {
    await page.unroute(endpoint, blockFeeLookup);
  }
}
