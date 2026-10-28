import {
  expect,
  type BrowserContext,
  type Frame,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import type { IntendedBehaviourHarness } from './harness';

declare global {
  interface Window {
    __passkeyBrowserFaults: {
      nextCreate: 'security' | 'cancelled' | 'none';
      nextGet: 'security' | 'cancelled' | 'none';
      observations: { operation: 'create' | 'get'; kind: string }[];
    };
  }
}

function cancelNextPasskey(): void {
  window.__passkeyBrowserFaults.nextGet = 'cancelled';
}

function prepareUnlockSecurityFailure(): void {
  sessionStorage.setItem('seams-e2e-passkey-get-fault', 'security');
}

function observedPasskeyCalls(): { operation: 'create' | 'get'; kind: string }[] {
  return window.__passkeyBrowserFaults.observations;
}

async function walletFrame(page: Page): Promise<Frame> {
  const iframe = await page
    .locator('iframe[allow*="publickey-credentials-get"]')
    .last()
    .elementHandle();
  const frame = await iframe?.contentFrame();
  if (!frame) throw new Error('Wallet iframe is unavailable');
  return frame;
}

export async function verifyBrowserSecurityFailureAndRetry(
  {
    harness,
    context,
    page,
  }: {
    harness: IntendedBehaviourHarness;
    context: BrowserContext;
    page: Page;
  },
  testInfo: TestInfo,
): Promise<void> {
  await context.addInitScript({
    path: fileURLToPath(new URL('./passkey-browser-faults.js', import.meta.url)),
  });

  await expect(harness.registerPasskeyWallet()).rejects.toThrow('Passkeys require trusted HTTPS');
  await expect(page.getByTestId('intended-result-json')).toContainText('trusted HTTPS');
  await expect(page.getByTestId('intended-e2e-page')).not.toHaveAttribute(
    'data-login-state',
    'logged_in',
  );
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await (await walletFrame(page)).evaluate(prepareUnlockSecurityFailure);

  const unlock = harness.unlockPasskeyWallet();
  // The action remains pending while its hosted menu offers a retry.
  const completion = unlock.then(recordUnlockSuccess, recordUnlockFailure);
  const surface = page.locator('iframe[allow*="publickey-credentials-get"]').last().contentFrame();
  await expect(
    surface.getByText('Passkeys require trusted HTTPS', { exact: false }).first(),
  ).toBeVisible();
  const frame = await walletFrame(page);
  await frame.evaluate(cancelNextPasskey);
  await surface.getByRole('button', { name: 'Try again', exact: true }).click();
  await surface.getByRole('button', { name: 'Unlock with passkey', exact: true }).click();
  await expect(
    surface.getByRole('button', { name: 'Unlock with passkey', exact: true }),
  ).toBeEnabled();
  await expect(surface.getByRole('alert')).toHaveCount(0);
  await expect(surface.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  await surface.getByRole('button', { name: 'Unlock with passkey', exact: true }).click();
  const outcome = await completion;
  if (outcome.kind === 'failed') throw outcome.error;

  const calls = await frame.evaluate(observedPasskeyCalls);
  expect(calls).toContainEqual({ operation: 'get', kind: 'security' });
  expect(calls).toContainEqual({ operation: 'get', kind: 'cancelled' });
  expect(calls).toContainEqual({ operation: 'get', kind: 'none' });
  await expect(page.getByTestId('intended-e2e-page')).toHaveAttribute(
    'data-login-state',
    'logged_in',
  );
  const evidence = {
    kind: 'passkey_browser_security_evidence_v1',
    scope:
      'Injected browser rejections with real local Wallet registration and unlock. Native TLS prompt parity is not established.',
    registrationFailureVisible: true,
    unlockFailureVisible: true,
    cancellationSilent: true,
    sameWalletUnlocked: true,
    calls,
    reproduce:
      "SEAMS_INTENDED_SKIP_BUILD=1 node tests/scripts/run-wallet-intended-isolated.mjs -- e2e/intended-behaviours/passkey.unlock.contract.test.ts --grep 'browser security failures remain visible'",
  };
  await writeFile(
    testInfo.outputPath('browser-security.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
}

function recordUnlockSuccess(): { kind: 'succeeded' } {
  return { kind: 'succeeded' };
}

function recordUnlockFailure(error: unknown): { kind: 'failed'; error: unknown } {
  return { kind: 'failed', error };
}
