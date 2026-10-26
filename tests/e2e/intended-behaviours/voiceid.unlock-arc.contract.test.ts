import { expect } from '@playwright/test';
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
    if (profile === 'add_ecdsa_after_voice') await harness.addPasskeyEcdsaWalletSigner();
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
    await page.getByRole('button', { name: 'Review Arc testnet transfer', exact: true }).click();
    await page.getByRole('button', { name: 'Continue to wallet', exact: true }).click();
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
    await page.getByRole('button', { name: 'Continue to wallet', exact: true }).click();
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
      ownerAddress,
      walletId: method.walletId,
      transactions: rpc.transactions,
      cancellationPreventedSecondTransfer: true,
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
